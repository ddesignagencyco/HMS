import { Inject, Injectable } from '@nestjs/common';
import { Prisma } from '@prisma/client';
import { badRequest, notFound } from '../common/domain-error.js';
import { PrismaService } from '../database/prisma.service.js';

export type FavouriteItem = { providerId: string; firstName: string; lastName: string; providerStatus: string; favouritedAt: string };

/**
 * SHM-020 favourites: a customer's shortlist of approved providers. The
 * `favourites` join table is the only state, so add is idempotent and remove is a
 * plain delete. A provider must be APPROVED before it can be favourited — a
 * PENDING_APPROVAL one is invisible anyway, and shortlisting one that is later
 * REJECTED would leave a dead entry.
 */
@Injectable()
export class FavouritesService {
  constructor(@Inject(PrismaService) private readonly prisma: PrismaService) {}

  async list(customerId: string): Promise<FavouriteItem[]> {
    return this.prisma.$queryRaw<FavouriteItem[]>(
      Prisma.sql`SELECT f.provider_id as "providerId", u.first_name as "firstName", u.last_name as "lastName",
          p.status::text as "providerStatus", f.created_at as "favouritedAt"
        FROM favourites f
        JOIN providers p ON p.user_id = f.provider_id
        JOIN users u ON u.id = f.provider_id
        WHERE f.customer_id = ${customerId}::uuid
        ORDER BY f.created_at DESC`
    );
  }

  async add(customerId: string, providerId: string): Promise<{ favourited: true }> {
    const rows = await this.prisma.$queryRaw<{ status: string }[]>(Prisma.sql`SELECT status FROM providers WHERE user_id = ${providerId}::uuid`);
    const provider = rows[0];
    if (provider === undefined || provider.status !== 'APPROVED') throw notFound('Provider');
    await this.prisma.$executeRaw(
      Prisma.sql`INSERT INTO favourites(customer_id, provider_id) VALUES (${customerId}::uuid, ${providerId}::uuid) ON CONFLICT (customer_id, provider_id) DO NOTHING`
    );
    return { favourited: true };
  }

  async remove(customerId: string, providerId: string): Promise<void> {
    const removed = await this.prisma.$executeRaw(Prisma.sql`DELETE FROM favourites WHERE customer_id = ${customerId}::uuid AND provider_id = ${providerId}::uuid`);
    if (removed === 0) throw badRequest('That provider is not in your favourites');
  }
}
