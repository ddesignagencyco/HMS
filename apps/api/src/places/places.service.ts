import { Inject, Injectable } from '@nestjs/common';
import { Prisma } from '@prisma/client';
import { notFound } from '../common/domain-error.js';
import { PrismaService } from '../database/prisma.service.js';

export type CityRow = { id: number; name: string; timezone: string; lat: number | null; lng: number | null };
export type AreaRow = { id: number; cityId: number; name: string; lat: number | null; lng: number | null };

@Injectable()
export class PlacesService {
  constructor(@Inject(PrismaService) private readonly prisma: PrismaService) {}

  /**
   * The centroid is projected out because an area is the smallest location a
   * customer can name, and both the provider search and address creation need a
   * point rather than an id. A city has no column of its own, so its centre is
   * the mean of the centroids of its areas, and both points are nullable: an
   * area with no centroid yet is returned, not hidden.
   */
  async listActiveCities(): Promise<CityRow[]> {
    return this.prisma.$queryRaw<CityRow[]>(Prisma.sql`
      SELECT c.id, c.name, c.timezone,
             ST_Y(ST_Centroid(ST_Collect(a.centroid::geometry))) as lat,
             ST_X(ST_Centroid(ST_Collect(a.centroid::geometry))) as lng
        FROM cities c
        LEFT JOIN areas a ON a.city_id = c.id AND a.is_active = true AND a.centroid IS NOT NULL
       WHERE c.is_active = true
       GROUP BY c.id
       ORDER BY c.name`);
  }

  async listActiveAreas(cityId: number): Promise<AreaRow[]> {
    const cities = await this.prisma.$queryRaw<{ id: number }[]>(Prisma.sql`SELECT id FROM cities WHERE id = ${cityId} AND is_active = true`);
    if (cities.length === 0) throw notFound('City');
    return this.prisma.$queryRaw<AreaRow[]>(Prisma.sql`
      SELECT id, city_id as "cityId", name,
             ST_Y(centroid::geometry) as lat, ST_X(centroid::geometry) as lng
        FROM areas WHERE city_id = ${cityId} AND is_active = true ORDER BY name`);
  }
}
