import { Inject, Injectable } from '@nestjs/common';
import { Prisma } from '@prisma/client';
import { generateSlots, instantFromWallTime } from '@smart-home/domain';
import { badRequest, notFound } from '../common/domain-error.js';
import { PrismaService } from '../database/prisma.service.js';
import { ReputationService, type Reputation } from '../reputation/reputation.service.js';
import { SettingsService } from '../platform/settings.service.js';
import type { ProviderSearchQuery, SlotsQuery } from './search.schemas.js';

export type ProviderSearchResultRow = { providerId: string; bio: string | null; experienceYears: number | null; qualification: string | null; pricePaisa: number; distanceM: number; ratingScore: number; ratingCount: number; badge: string | null };

type ProviderSearchResultRowRaw = Omit<ProviderSearchResultRow, 'pricePaisa' | 'ratingScore' | 'ratingCount'> & { pricePaisa: bigint; ratingScoreHundredths: number; ratingCount: number; radiusM: number };

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

/** A customer cannot book a start time that is about to happen. */
const MIN_NOTICE_MIN = 60;

@Injectable()
export class SearchService {
  constructor(
    @Inject(PrismaService) private readonly prisma: PrismaService,
    @Inject(SettingsService) private readonly settings: SettingsService,
    @Inject(ReputationService) private readonly reputation: ReputationService
  ) {}

  /**
   * FR-SR / SHM-025: the start times a customer can book with one provider on one local day: the provider's declared
   * hours, minus leave and existing bookings (with the travel buffer), for the length of this service. Booking creation
   * re-checks all of it and the database has the final word, so a slot listed here can still lose a race — that is a
   * 409 SLOT_TAKEN at checkout, never a double booking.
   */
  async listSlots(providerId: string, query: SlotsQuery): Promise<{ date: string; durationMin: number; items: { start: string; end: string }[] }> {
    const [year, month, day] = query.date.split('-').map(part => Number.parseInt(part, 10)) as [number, number, number];
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
      stepMin: 30,
      bufferMin,
      earliest: new Date(Date.now() + MIN_NOTICE_MIN * 60_000)
    });
    return { date: query.date, durationMin: service.durationMin, items: slots.map(slot => ({ start: slot.start.toISOString(), end: slot.end.toISOString() })) };
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
      return { ...row, pricePaisa: Number(row.pricePaisa), ratingScore: ratingScoreHundredths / 100, ratingCount: row.ratingCount };
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

    return { ...profile, services: servicesRaw.map(row => ({ ...row, pricePaisa: Number(row.pricePaisa) })), areas, reputation: await this.reputation.reputation(this.prisma, providerId) };
  }
}
