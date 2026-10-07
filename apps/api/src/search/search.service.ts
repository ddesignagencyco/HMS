import { Inject, Injectable } from '@nestjs/common';
import { Prisma } from '@prisma/client';
import { daySpan, earliestStart, generateSlots, instantFromWallTime, localDateOf, localMidnightOf, paisaToNumber } from '@smart-home/domain';
import { badRequest, notFound } from '../common/domain-error.js';
import { PrismaService } from '../database/prisma.service.js';
import { AppClock } from '../platform/app-clock.js';
import { ReputationService, type Reputation } from '../reputation/reputation.service.js';
import { SettingsService } from '../platform/settings.service.js';
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
};

type ProviderSearchResultRowRaw = Omit<ProviderSearchResultRow, 'pricePaisa' | 'ratingScore' | 'ratingCount'> & {
  pricePaisa: bigint;
  ratingScoreHundredths: number;
  ratingCount: number;
  radiusM: number;
};

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
   * Ranked by distance only: the fuller FR-SR-06 formula (rating, completion
   * rate, response speed, recent activity) has no real inputs yet, since
   * ratings (M9) and bookings (M5) don't exist. Adding weighted terms for
   * data that is always zero would just be a fake tie-breaker, so distance
   * is the whole ranking for now.
   */
  async searchProviders(query: ProviderSearchQuery): Promise<ProviderSearchResultRow[]> {
    const services = await this.prisma.$queryRaw<{ id: number }[]>(Prisma.sql`SELECT id FROM services WHERE slug = ${query.serviceSlug} AND is_active = true`);
    const service = services[0];
    if (service === undefined) throw notFound('Service');

    const point = Prisma.sql`ST_SetSRID(ST_MakePoint(${query.lng}, ${query.lat}), 4326)::geography`;
    const prior = await this.settings.getNumber('rating.bayesian_prior');
    const priorWeight = await this.settings.getNumber('rating.bayesian_weight');
    const recentWeight = await this.settings.getNumber('rating.recent_weight');
    const raw = await this.prisma.$queryRaw<ProviderSearchResultRowRaw[]>(
      Prisma.sql`SELECT p.user_id as "providerId", p.bio, p.experience_years as "experienceYears", p.qualification, ps.price_paisa as "pricePaisa",
          ST_Distance(p.base_location, ${point}) as "distanceM", p.radius_m as "radiusM", p.tier_badge as badge,
          rs.n as "ratingCount",
          round((${Math.round(prior * 100) * priorWeight} + rs.num) / (${priorWeight} + rs.den))::int as "ratingScoreHundredths"
        FROM providers p
        JOIN provider_services ps ON ps.provider_id = p.user_id AND ps.service_id = ${service.id} AND ps.status = 'APPROVED'
        -- The same weighted score the reputation endpoint publishes (CL-17): the last 20 ratings count ${recentWeight}x, then a pull toward the prior.
        LEFT JOIN LATERAL (
          SELECT count(*)::int as n,
            coalesce(sum(x.hundredths * CASE WHEN x.rn <= 20 THEN ${recentWeight} ELSE 1 END), 0)::float8 as num,
            coalesce(sum(CASE WHEN x.rn <= 20 THEN ${recentWeight} ELSE 1 END), 0)::float8 as den
          FROM (SELECT round(score * 100)::int as hundredths, row_number() OVER (ORDER BY created_at DESC, id DESC) as rn FROM ratings WHERE provider_id = p.user_id) x
        ) rs ON true
        WHERE p.status = 'APPROVED' AND p.offer_blocked_reason IS NULL AND p.base_location IS NOT NULL AND ST_DWithin(p.base_location, ${point}, p.radius_m)`
    );
    // FR-SR-06: rank by the admin-configured weights over the inputs that exist today — rating and distance. (Completion rate, response speed
    // and recency have no data yet; their weights are left out and the rest renormalised, rather than counting zeros as a signal.)
    const weights = (await this.settings.get<{ rating?: number; distance?: number }>('ranking.weights')) ?? {};
    const ratingWeight = weights.rating ?? 0.35;
    const distanceWeight = weights.distance ?? 0.25;
    const rank = (row: ProviderSearchResultRowRaw): number => {
      const rating = row.ratingScoreHundredths / 500;
      const closeness = Math.max(0, 1 - row.distanceM / Math.max(row.radiusM, 1));
      return (ratingWeight * rating + distanceWeight * closeness) / (ratingWeight + distanceWeight);
    };
    raw.sort((left, right) => rank(right) - rank(left) || left.distanceM - right.distanceM);
    return raw.map(({ ratingScoreHundredths, radiusM, ...row }) => {
      void radiusM;
      // Ranked above on the prior-pulled number; published as null when no rating
      // exists, for the same reason as `Reputation.score` — a figure derived only
      // from the prior is not something anybody has said about them.
      return { ...row, pricePaisa: paisaToNumber(row.pricePaisa), ratingScore: row.ratingCount === 0 ? null : ratingScoreHundredths / 100, ratingCount: row.ratingCount };
    });
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
