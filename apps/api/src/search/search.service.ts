import { Inject, Injectable, Logger } from '@nestjs/common';
import { Prisma } from '@prisma/client';
import { daySpan, earliestStart, generateSlots, instantFromWallTime, localDateOf, localMidnightOf, paisaToNumber } from '@smart-home/domain';
import { badRequest, notFound } from '../common/domain-error.js';
import { paged, pageWindow, type Paged } from '../common/paging.js';
import { PrismaService } from '../database/prisma.service.js';
import { AppClock } from '../platform/app-clock.js';
import { ReputationService, type Reputation } from '../reputation/reputation.service.js';
import { SettingsService } from '../platform/settings.service.js';
import { localWeekday } from '../booking/slot-time.js';
import type { NextSlotsQuery, ProviderSearchQuery, SlotsQuery } from './search.schemas.js';

export type ProviderSearchResultRow = {
  providerId: string;
  bio: string | null;
  experienceYears: number | null;
  qualification: string | null;
  pricePaisa: number;
  distanceM: number;
  /** Null when nobody has rated this provider yet — rank on it, do not render it as a rating. See `Reputation.score`. */
  ratingScore: number | null;
  ratingCount: number;
  badge: string | null;
  /**
   * Which of the configured signals this provider had no data for. Published rather than hidden so
   * a frontend can say "no rating yet" instead of rendering a zero, and so an operator can see why a
   * heavily-weighted signal is not moving anybody up.
   */
  missingSignals: string[];
  /** Each signal's normalised 0–1 value after the weights below were applied. `null` = no data, excluded from the score. */
  signals: { rating: number; distance: number; completion: number | null; response: number | null; recency: number | null };
};

type ProviderSearchResultRowRaw = Omit<ProviderSearchResultRow, 'pricePaisa' | 'ratingScore' | 'ratingCount' | 'missingSignals' | 'signals'> & {
  pricePaisa: bigint;
  ratingScoreHundredths: number;
  ratingCount: number;
  radiusM: number;
  completedJobs: number;
  noShows: number;
  medianResponseMinutes: number | null;
  lastCompletedAt: Date | null;
};

/** The five signals `ranking.weights` may carry. An unknown key is logged, never silently ranked on. */
export type RankingWeights = Partial<Record<'rating' | 'distance' | 'completion' | 'response' | 'recency', number>>;

/**
 * The keys this build ranks on. `search.test.ts` compares this against the live `ranking.weights`
 * setting, so an operator adding a key to the setting cannot end up with a weight nothing reads.
 */
export const RANKING_SIGNAL_KEYS = ['rating', 'distance', 'completion', 'response', 'recency'] as const;

export type ProviderDetailRow = {
  providerId: string;
  status: string;
  bio: string | null;
  experienceYears: number | null;
  qualification: string | null;
  cityId: number | null;
  radiusM: number;
};

export type ProviderDetailServiceRow = { serviceId: number; slug: string; nameEn: string; pricePaisa: number };
type ProviderDetailServiceRowRaw = Omit<ProviderDetailServiceRow, 'pricePaisa'> & { pricePaisa: bigint };

export type ProviderDetailAreaRow = { areaId: number; name: string };

export type ProviderDetail = ProviderDetailRow & { services: ProviderDetailServiceRow[]; areas: ProviderDetailAreaRow[]; reputation: Reputation };

/**
 * The step slots start on. Half-hourly is what the slot picker has always offered;
 * a same-day customer is usually choosing "the soonest one", not a precise time,
 * and the resolver below narrows the choice to the soonest handful.
 */
const SLOT_STEP_MIN = 30;

@Injectable()
export class SearchService {
  private readonly logger = new Logger(SearchService.name);

  constructor(
    @Inject(PrismaService) private readonly prisma: PrismaService,
    @Inject(SettingsService) private readonly settings: SettingsService,
    @Inject(ReputationService) private readonly reputation: ReputationService,
    @Inject(AppClock) private readonly clock: AppClock
  ) {}

  /**
   * The same lead time checkout enforces (`BookingService.refuseWindow`), read from
   * the same setting. The listing used to hardcode 60 minutes while checkout only
   * required the start to be in the future, so a start time could be offered and
   * then refused — or worse, accepted when the listing said it was unavailable.
   */
  private async earliestBookableStart(): Promise<Date> {
    return earliestStart(this.clock.now(), await this.settings.getNumber('booking.min_notice_min'));
  }

/** The last instant of the customer's local day, for `availableToday`. */
private async endOfLocalDay(): Promise<Date> {
    const today = localMidnightOf(this.clock.now());
    return new Date(today.getTime() + 86_400_000);
  }

  /**
   * FR-SR-05 / SHM-108: which providers have a free slot for this service later today.
   *
   * "Free later today" means exactly that — not "working until midnight". A provider whose day runs
   * 09:00–18:00 is available today at 11:00, so the test is whether a slot of the service's length
   * fits between the notice deadline and the end of one of today's declared windows, once leave and
   * existing bookings have taken their cut. Frees up the whole remainder of one window, so a provider
   * with a busy morning and a free afternoon still counts.
   *
   * Its own query rather than another fragment of the ranking query: the arithmetic is long enough
   * that burying it there would make that query unreadable. Restricting to providers who offer this
   * service and are approved keeps the set small, which is what makes doing the interval maths in
   * TypeScript (seconds, integers) reasonable — no float paisa, no clock arithmetic in SQL.
   */
  private async providersFreeToday(serviceId: number | null, durationMin: number): Promise<string[]> {
    const notice = await this.earliestBookableStart();
    const dayEnd = await this.endOfLocalDay();
    if (notice >= dayEnd) return [];
    const weekday = localWeekday(notice);
    const bufferMin = await this.settings.getNumber('booking.travel_buffer_min');

    const candidates = await this.prisma.$queryRaw<{ providerId: string }[]>(
      Prisma.sql`SELECT DISTINCT p.user_id as "providerId" FROM providers p
        JOIN provider_services ps ON ps.provider_id = p.user_id AND ps.status = 'APPROVED' ${serviceId === null ? Prisma.empty : Prisma.sql`AND ps.service_id = ${serviceId}`}
        WHERE p.status = 'APPROVED' AND p.offer_blocked_reason IS NULL AND p.base_location IS NOT NULL`
    );
    if (candidates.length === 0) return [];

    const ids = candidates.map(row => row.providerId);
    const windows = await this.prisma.$queryRaw<{ providerId: string; from: Date; to: Date }[]>(
      Prisma.sql`SELECT av.provider_id as "providerId",
          (date_trunc('day', ${notice.toISOString()}::timestamptz AT TIME ZONE 'Asia/Karachi') AT TIME ZONE 'Asia/Karachi') + av.start_time as "from",
          (date_trunc('day', ${notice.toISOString()}::timestamptz AT TIME ZONE 'Asia/Karachi') AT TIME ZONE 'Asia/Karachi') + av.end_time as "to"
        FROM provider_availability av WHERE av.provider_id IN (${Prisma.join(ids.map(id => Prisma.sql`${id}::uuid`))}) AND av.weekday = ${weekday}`
    );
    if (windows.length === 0) return [];

    const blocked = await this.prisma.$queryRaw<{ providerId: string; from: Date; to: Date }[]>(
      Prisma.sql`SELECT t.provider_id as "providerId", lower(t.period) as "from", upper(t.period) as "to"
          FROM provider_time_off t WHERE t.provider_id IN (${Prisma.join(ids.map(id => Prisma.sql`${id}::uuid`))}) AND t.period && tstzrange(${notice.toISOString()}::timestamptz, ${dayEnd.toISOString()}::timestamptz, '[)')
        UNION ALL
        SELECT x.provider_id, greatest(x.scheduled_start, ${notice.toISOString()}::timestamptz) as "from",
          least(x.scheduled_end, ${dayEnd.toISOString()}::timestamptz) as "to"
          FROM bookings x WHERE x.provider_id IN (${Prisma.join(ids.map(id => Prisma.sql`${id}::uuid`))})
            AND x.slot && tstzrange(${notice.toISOString()}::timestamptz, ${dayEnd.toISOString()}::timestamptz, '[)')
            AND x.status IN ('PENDING_PAYMENT','REQUESTED','ACCEPTED','SCHEDULED','EN_ROUTE','IN_PROGRESS','QUOTE_REVISION')`
    );

    const secondsOf = (value: Date): number => Math.floor(value.getTime() / 1000);
    const needed = (durationMin + bufferMin * 2) * 60;
    const byProvider = new Map<string, { from: number; to: number }[]>();
    for (const block of blocked) {
      const list = byProvider.get(block.providerId) ?? [];
      list.push({ from: secondsOf(block.from), to: secondsOf(block.to) });
      byProvider.set(block.providerId, list);
    }
    const noticeAt = secondsOf(notice);
    const free: string[] = [];
    for (const window of windows) {
      const from = Math.max(secondsOf(window.from), noticeAt);
      const to = secondsOf(window.to);
      if (to - from < needed) continue;
      // Total occupied time inside the window, merged, so two overlapping bookings are not counted twice.
      const taken = (byProvider.get(window.providerId) ?? [])
        .map(block => ({ from: Math.max(block.from, from), to: Math.min(block.to, to) }))
        .filter(block => block.to > block.from)
        .sort((left, right) => left.from - right.from);
      let occupied = 0;
      let lastTo = from;
      for (const block of taken) {
        const start = Math.max(block.from, lastTo);
        if (block.to > start) {
          occupied += block.to - start;
          lastTo = block.to;
        }
      }
      if (to - from - occupied >= needed) free.push(window.providerId);
    }
    return [...new Set(free)];
  }

  /**
   * FR-SR / SHM-025: the start times a customer can book with one provider on one local day: the provider's declared
   * hours, minus leave and existing bookings (with the travel buffer), for the length of this service. Booking creation
   * re-checks all of it and the database has the final word, so a slot listed here can still lose a race — that is a
   * 409 SLOT_TAKEN at checkout, never a double booking.
   */
  async listSlots(providerId: string, query: SlotsQuery): Promise<{ date: string; durationMin: number; items: { start: string; end: string }[] }> {
    const [year, month, day] = query.date.split('-').map((part) => Number.parseInt(part, 10)) as [number, number, number];
    const dayStart = instantFromWallTime({ year, month, day, hour: 0, minute: 0 });
    if (Number.isNaN(dayStart.getTime()) || new Date(Date.UTC(year, month - 1, day)).getUTCDate() !== day) throw badRequest('date is not a real calendar day');
    const dayEnd = new Date(dayStart.getTime() + 24 * 3_600_000);

    const services = await this.prisma.$queryRaw<{ durationMin: number }[]>(
      Prisma.sql`SELECT s.expected_duration_min as "durationMin" FROM provider_services ps JOIN providers p ON p.user_id = ps.provider_id JOIN services s ON s.id = ps.service_id
        WHERE ps.provider_id = ${providerId}::uuid AND ps.service_id = ${query.serviceId} AND ps.status = 'APPROVED' AND p.status = 'APPROVED' AND s.is_active = true`
    );
    const service = services[0];
    if (service === undefined) throw notFound('Provider');

    const weekday = new Date(Date.UTC(year, month - 1, day)).getUTCDay();
    const windows = await this.prisma.$queryRaw<{ start: string; end: string }[]>(
      Prisma.sql`SELECT to_char(start_time, 'HH24:MI') as start, to_char(end_time, 'HH24:MI') as end FROM provider_availability WHERE provider_id = ${providerId}::uuid AND weekday = ${weekday} ORDER BY start_time`
    );
    const bufferMin = await this.settings.getNumber('booking.travel_buffer_min');
    const window = Prisma.sql`tstzrange(${new Date(dayStart.getTime() - bufferMin * 60_000).toISOString()}::timestamptz, ${new Date(dayEnd.getTime() + bufferMin * 60_000).toISOString()}::timestamptz, '[)')`;
    const leave = await this.prisma.$queryRaw<{ start: Date; end: Date }[]>(
      Prisma.sql`SELECT lower(period) as start, upper(period) as end FROM provider_time_off WHERE provider_id = ${providerId}::uuid AND period && ${window}`
    );
    const bookings = await this.prisma.$queryRaw<{ start: Date; end: Date }[]>(
      Prisma.sql`SELECT scheduled_start as start, scheduled_end as end FROM bookings
        WHERE provider_id = ${providerId}::uuid AND slot && ${window} AND status IN ('PENDING_PAYMENT','REQUESTED','ACCEPTED','SCHEDULED','EN_ROUTE','IN_PROGRESS','QUOTE_REVISION')`
    );

    const slots = generateSlots({
      date: { year, month, day },
      windows,
      blocked: leave,
      bookings,
      durationMin: service.durationMin,
      stepMin: SLOT_STEP_MIN,
      bufferMin,
      earliest: await this.earliestBookableStart()
    });
    return { date: query.date, durationMin: service.durationMin, items: slots.map((slot) => ({ start: slot.start.toISOString(), end: slot.end.toISOString() })) };
  }

  /**
   * Same-day / next-hour booking: "when is this provider next free?" — the answer
   * a customer asking "can I book for the next hour?" actually needs.
   *
   * `listSlots` answers "what can I book on *this* date?", which is the wrong
   * question at 21:00 on a Tuesday: the customer does not have a date in mind,
   * they want the soonest start. This walks forward from today across
   * `booking.next_slot_days` local days, generating each day's real slots and
   * returning the soonest `limit` of them, so the first entry is the earliest
   * time this provider can be at the door.
   *
   * The lead time and day-span rules are the same ones checkout applies, so a slot
   * returned here is one checkout will accept; the database's exclusion constraint
   * still has the last word, so a slot can lose a race and become a 409.
   */
  async listNextSlots(providerId: string, query: NextSlotsQuery): Promise<{ durationMin: number; items: { start: string; end: string }[] }> {
    const services = await this.prisma.$queryRaw<{ durationMin: number }[]>(
      Prisma.sql`SELECT s.expected_duration_min as "durationMin" FROM provider_services ps JOIN providers p ON p.user_id = ps.provider_id JOIN services s ON s.id = ps.service_id
        WHERE ps.provider_id = ${providerId}::uuid AND ps.service_id = ${query.serviceId} AND ps.status = 'APPROVED' AND p.status = 'APPROVED' AND s.is_active = true`
    );
    const service = services[0];
    if (service === undefined) throw notFound('Provider');

    const bufferMin = await this.settings.getNumber('booking.travel_buffer_min');
    const earliest = await this.earliestBookableStart();
    const days = await this.settings.getNumber('booking.next_slot_days');
    const maxDaySpan = await this.settings.getNumber('booking.max_day_span');

    const now = this.clock.now();
    // The calendar the resolver can see: local midnight today through `next_slot_days` later.
    const today = localMidnightOf(now);
    const horizon = new Date(today.getTime() + days * 86_400_000);
    const blockers = await this.prisma.$queryRaw<{ start: Date; end: Date }[]>(
      Prisma.sql`SELECT lower(period) as start, upper(period) as end FROM provider_time_off WHERE provider_id = ${providerId}::uuid AND period && tstzrange(${now.toISOString()}::timestamptz, ${horizon.toISOString()}::timestamptz, '[)')
        UNION ALL
        SELECT scheduled_start as start, scheduled_end as end FROM bookings
          WHERE provider_id = ${providerId}::uuid AND slot && tstzrange(${now.toISOString()}::timestamptz, ${horizon.toISOString()}::timestamptz, '[)')
            AND status IN ('PENDING_PAYMENT','REQUESTED','ACCEPTED','SCHEDULED','EN_ROUTE','IN_PROGRESS','QUOTE_REVISION')`
    );
    const leave = blockers.filter((blocker) => blocker.start.getTime() <= now.getTime() && blocker.end.getTime() > now.getTime());
    const booked = blockers.filter((blocker) => blocker.start.getTime() > now.getTime());

    const found: { start: string; end: string }[] = [];
    for (let offset = 0; offset < days && found.length < query.limit; offset += 1) {
      const date = localDateOf(new Date(today.getTime() + offset * 86_400_000));
      const weekday = new Date(Date.UTC(date.year, date.month - 1, date.day)).getUTCDay();
      const windows = await this.prisma.$queryRaw<{ start: string; end: string }[]>(
        Prisma.sql`SELECT to_char(start_time, 'HH24:MI') as start, to_char(end_time, 'HH24:MI') as end FROM provider_availability WHERE provider_id = ${providerId}::uuid AND weekday = ${weekday} ORDER BY start_time`
      );
      if (windows.length === 0) continue;
      const slots = generateSlots({
        date,
        windows,
        blocked: leave,
        bookings: booked,
        durationMin: service.durationMin,
        stepMin: SLOT_STEP_MIN,
        bufferMin,
        earliest
      });
      for (const slot of slots) {
        if (daySpan(slot.start, slot.end) > maxDaySpan) continue;
        found.push({ start: slot.start.toISOString(), end: slot.end.toISOString() });
        if (found.length >= query.limit) break;
      }
    }
    return { durationMin: service.durationMin, items: found };
  }

  /**
 * FR-SR-02..07 / SHM-108. Every filter below is a *hard* filter applied before ranking, never a
 * tie-breaker: a customer who narrows to "under PKR 2,000" does not want the cheapest first with the
 * rest of the list ignored.
 *
 * The ranking itself is still the narrower formula described on `searchProviders` — completion rate,
 * response speed and recency have no input data yet, so their weights are left out and the rest
 * renormalised rather than counting zeros as a signal.
 */
async searchProviders(query: ProviderSearchQuery, customerId?: string): Promise<Paged<ProviderSearchResultRow>> {
    // BE-010: no serviceSlug = "professionals near me": every approved offer counts, a provider appears once at their lowest price.
    let service: { id: number; durationMin: number } | null = null;
    if (query.serviceSlug !== undefined) {
      const services = await this.prisma.$queryRaw<{ id: number; durationMin: number }[]>(Prisma.sql`SELECT id, expected_duration_min as "durationMin" FROM services WHERE slug = ${query.serviceSlug} AND is_active = true`);
      service = services[0] ?? null;
      if (service === null) throw notFound('Service');
    }
    const serviceId = service?.id ?? null;

    // `addressId` resolves here rather than in the web app: the customer has already given us this
    // address, and a search centred on the wrong point is worse than no search at all.
    let lat = query.lat;
    let lng = query.lng;
    if (query.addressId !== undefined) {
      const addresses = await this.prisma.$queryRaw<{ lat: number; lng: number }[]>(
        Prisma.sql`SELECT ST_Y(location::geometry) as lat, ST_X(location::geometry) as lng FROM addresses WHERE id = ${query.addressId}::uuid AND customer_id = ${customerId ?? null}::uuid`
      );
      const address = addresses[0];
      if (address === undefined) throw notFound('Address');
      lat = address.lat;
      lng = address.lng;
    }

    const point = Prisma.sql`ST_SetSRID(ST_MakePoint(${lng!}, ${lat!}), 4326)::geography`;
    const prior = await this.settings.getNumber('rating.bayesian_prior');
    const priorWeight = await this.settings.getNumber('rating.bayesian_weight');
    const recentWeight = await this.settings.getNumber('rating.recent_weight');

    // FR-SR-05: "today" is the customer's local day, and "free later today" is answered by the helper
    // above, which shares the same availability, leave and booking inputs `listNextSlots` uses.
    let freeToday: string[] | null = null;
    if (query.availableToday === true) {
      let durationMin = service?.durationMin ?? 0;
      if (service === null) {
        const shortest = await this.prisma.$queryRaw<{ d: number | null }[]>(Prisma.sql`SELECT min(expected_duration_min)::int as d FROM services WHERE is_active = true`);
        durationMin = shortest[0]?.d ?? 60;
      }
      freeToday = await this.providersFreeToday(serviceId, durationMin);
    }
    // One price per provider: the offer for the chosen service, or the lowest approved offer across services.
    const offers =
      serviceId === null
        ? Prisma.sql`(SELECT psx.provider_id, min(psx.price_paisa) as price_paisa FROM provider_services psx JOIN services sx ON sx.id = psx.service_id AND sx.is_active = true WHERE psx.status = 'APPROVED' GROUP BY psx.provider_id)`
        : Prisma.sql`(SELECT psx.provider_id, psx.price_paisa FROM provider_services psx WHERE psx.service_id = ${serviceId} AND psx.status = 'APPROVED')`;

    const raw = await this.prisma.$queryRaw<ProviderSearchResultRowRaw[]>(
      Prisma.sql`SELECT p.user_id as "providerId", p.bio, p.experience_years as "experienceYears", p.qualification, ps.price_paisa as "pricePaisa",
          ST_Distance(p.base_location, ${point}) as "distanceM", p.radius_m as "radiusM", p.tier_badge as badge,
          rs.n as "ratingCount",
          round((${Math.round(prior * 100) * priorWeight} + rs.num) / (${priorWeight} + rs.den))::int as "ratingScoreHundredths",
          cs.completed as "completedJobs", cs.no_shows as "noShows", cs.median_response as "medianResponseMinutes", cs.last_completed as "lastCompletedAt"
        FROM providers p
        JOIN ${offers} ps ON ps.provider_id = p.user_id
        -- The same weighted score the reputation endpoint publishes (CL-17): the last 20 ratings count ${recentWeight}x, then a pull toward the prior.
        LEFT JOIN LATERAL (
          SELECT count(*)::int as n,
            coalesce(sum(x.hundredths * CASE WHEN x.rn <= 20 THEN ${recentWeight} ELSE 1 END), 0)::float8 as num,
            coalesce(sum(CASE WHEN x.rn <= 20 THEN ${recentWeight} ELSE 1 END), 0)::float8 as den
          FROM (SELECT round(score * 100)::int as hundredths, row_number() OVER (ORDER BY created_at DESC, id DESC) as rn FROM ratings WHERE provider_id = p.user_id) x
        ) rs ON true
        -- The three signals that had no inputs before M5/M8 shipped (SHM-109). Each is null rather than
        -- zero when there is no history, because "has never done a job" is not the same claim as
        -- "finishes the jobs they take".
        LEFT JOIN LATERAL (
          SELECT count(*) FILTER (WHERE x.status = 'CLOSED')::int as completed,
            count(*) FILTER (WHERE x.no_show_party = 'PROVIDER')::int as no_shows,
            max(x.completed_at) as last_completed,
            percentile_disc(0.5) WITHIN GROUP (ORDER BY extract(epoch FROM (x.responded_at - x.created_at)) / 60)::int as median_response
          FROM (
            SELECT bk.status, bk.no_show_party, bk.completed_at,
              (SELECT min(o.responded_at) FROM booking_offers o WHERE o.booking_id = bk.id AND o.status <> 'EXPIRED') as responded_at,
              bk.created_at
            FROM bookings bk WHERE bk.provider_id = p.user_id
          ) x
        ) cs ON true
        WHERE p.status = 'APPROVED' AND p.offer_blocked_reason IS NULL AND p.base_location IS NOT NULL AND ST_DWithin(p.base_location, ${point}, p.radius_m)
          ${query.minExperienceYears === undefined ? Prisma.empty : Prisma.sql`AND coalesce(p.experience_years, 0) >= ${query.minExperienceYears}`}
          ${query.minCompletedJobs === undefined ? Prisma.empty : Prisma.sql`AND (SELECT count(*) FROM bookings done WHERE done.provider_id = p.user_id AND done.status = 'CLOSED' AND done.completed_at IS NOT NULL) >= ${query.minCompletedJobs}`}
          ${query.minPricePaisa === undefined ? Prisma.empty : Prisma.sql`AND ps.price_paisa >= ${BigInt(query.minPricePaisa)}`}
          ${query.maxPricePaisa === undefined ? Prisma.empty : Prisma.sql`AND ps.price_paisa <= ${BigInt(query.maxPricePaisa)}`}
          ${query.verifiedDocsOnly === true
            ? Prisma.sql`AND EXISTS (SELECT 1 FROM provider_documents d WHERE d.provider_id = p.user_id AND d.status = 'VERIFIED')`
            : Prisma.empty}
          ${freeToday === null ? Prisma.empty : Prisma.sql`AND p.user_id IN (${freeToday.length === 0 ? Prisma.sql`SELECT NULL::uuid WHERE false` : Prisma.join(freeToday.map(id => Prisma.sql`${id}::uuid`))})`}`
    );
    // FR-SR-06 / SHM-109: every configured weight is applied, or the setting no longer carries it.
    //
    // Until now `ranking.weights` advertised five signals and the code used two — completion, response
    // and recency had no inputs, so their weights were silently renormalised away and an operator
    // tuning them saw nothing happen. They have inputs now (finished bookings, offer response times,
    // last completion date), so all five are wired. A signal with no data for a given provider is
    // **excluded from that provider's score and listed in `missingSignals`**, not counted as zero: a
    // provider who has never done a job should not be punished for it as though they had failed one.
    const weights = (await this.settings.get<RankingWeights>('ranking.weights')) ?? {};
    const known = new Set(['rating', 'distance', 'completion', 'response', 'recency']);
    const ignored = Object.keys(weights).filter(key => !known.has(key));
    if (ignored.length > 0) this.logger.warn(`ranking.weights has keys this build does not apply: ${ignored.join(', ')} — trim them or rank nobody on them`);

    const now = this.clock.now();
    const recencyHorizonDays = 180;
    const slowResponseMinutes = 240; // 4 hours: past this a provider is the slow end of the range.
    const signalsFor = (row: ProviderSearchResultRowRaw): ProviderSearchResultRow['signals'] => {
      const completion = row.completedJobs > 0 ? Math.max(0, 1 - row.noShows / row.completedJobs) : null;
      const response = row.medianResponseMinutes === null ? null : Math.max(0, 1 - row.medianResponseMinutes / slowResponseMinutes);
      const days = row.lastCompletedAt === null ? null : (now.getTime() - row.lastCompletedAt.getTime()) / 86_400_000;
      const recency = days === null ? null : Math.max(0, 1 - days / recencyHorizonDays);
      return {
        rating: row.ratingScoreHundredths / 500,
        distance: Math.max(0, 1 - row.distanceM / Math.max(row.radiusM, 1)),
        completion,
        response,
        recency
      };
    };
    const score = (signals: ProviderSearchResultRow['signals']): number => {
      let total = 0;
      let weight = 0;
      for (const [key, value] of Object.entries(signals)) {
        const configured = weights[key as keyof RankingWeights];
        if (configured === undefined || value === null) continue;
        total += configured * value;
        weight += configured;
      }
      return weight === 0 ? 0 : total / weight;
    };
    const minRatingHundredths = query.minRating === undefined || query.minRating <= 0 ? null : Math.round(query.minRating * 100);
    const scored = raw
      .filter(row => minRatingHundredths === null || (row.ratingCount > 0 && row.ratingScoreHundredths >= minRatingHundredths))
      .map(row => ({ row, signals: signalsFor(row) }));
    const byWeighted = (left: (typeof scored)[number], right: (typeof scored)[number]): number => score(right.signals) - score(left.signals) || left.row.distanceM - right.row.distanceM;
    // BE-010: an explicit sort leads; the weighted ranking (then distance) breaks ties, so the order is always deterministic.
    const rated = (item: (typeof scored)[number]): number => (item.row.ratingCount === 0 ? -1 : item.row.ratingScoreHundredths);
    const primary: ((left: (typeof scored)[number], right: (typeof scored)[number]) => number) | null =
      query.sort === 'distance' ? (l, r) => l.row.distanceM - r.row.distanceM
      : query.sort === 'rating' ? (l, r) => rated(r) - rated(l)
      : query.sort === 'price_asc' ? (l, r) => Number(l.row.pricePaisa - r.row.pricePaisa)
      : query.sort === 'price_desc' ? (l, r) => Number(r.row.pricePaisa - l.row.pricePaisa)
      : query.sort === 'experience' ? (l, r) => (r.row.experienceYears ?? -1) - (l.row.experienceYears ?? -1)
      : null;
    scored.sort((left, right) => (primary === null ? 0 : primary(left, right)) || byWeighted(left, right));
    const window = pageWindow(query, null);
    const slice = window.limit === null ? scored : scored.slice(window.offset, window.offset + window.limit);
    const items = slice.map(({ row, signals }) => {
      const { ratingScoreHundredths, radiusM, completedJobs, noShows, medianResponseMinutes, lastCompletedAt, ...rest } = row;
      void radiusM;
      void completedJobs;
      void noShows;
      void medianResponseMinutes;
      void lastCompletedAt;
      const missingSignals = (Object.keys(signals) as (keyof typeof signals)[]).filter(key => signals[key] === null);
      // Ranked above on the prior-pulled number; published as null when no rating
      // exists, for the same reason as `Reputation.score` — a figure derived only
      // from the prior is not something anybody has said about them.
      return { ...rest, pricePaisa: paisaToNumber(row.pricePaisa), ratingScore: row.ratingCount === 0 ? null : ratingScoreHundredths / 100, ratingCount: row.ratingCount, signals, missingSignals };
    });
    return paged(items, scored.length, window);
  }

  async getProviderDetail(providerId: string): Promise<ProviderDetail> {
    const profiles = await this.prisma.$queryRaw<ProviderDetailRow[]>(
      Prisma.sql`SELECT user_id as "providerId", status, bio, experience_years as "experienceYears", qualification, city_id as "cityId", radius_m as "radiusM"
        FROM providers WHERE user_id = ${providerId}::uuid AND status = 'APPROVED'`
    );
    const profile = profiles[0];
    if (profile === undefined) throw notFound('Provider');

    const servicesRaw = await this.prisma.$queryRaw<ProviderDetailServiceRowRaw[]>(
      Prisma.sql`SELECT s.id as "serviceId", s.slug, s.name_en as "nameEn", ps.price_paisa as "pricePaisa"
        FROM provider_services ps JOIN services s ON s.id = ps.service_id
        WHERE ps.provider_id = ${providerId}::uuid AND ps.status = 'APPROVED' AND s.is_active = true
        ORDER BY s.name_en`
    );
    const areas = await this.prisma.$queryRaw<ProviderDetailAreaRow[]>(
      Prisma.sql`SELECT a.id as "areaId", a.name FROM provider_service_areas psa JOIN areas a ON a.id = psa.area_id WHERE psa.provider_id = ${providerId}::uuid ORDER BY a.name`
    );

    return { ...profile, services: servicesRaw.map((row) => ({ ...row, pricePaisa: paisaToNumber(row.pricePaisa) })), areas, reputation: await this.reputation.reputation(this.prisma, providerId) };
  }
}
