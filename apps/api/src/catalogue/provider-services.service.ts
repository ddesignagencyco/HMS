import { Inject, Injectable } from '@nestjs/common';
import { Prisma } from '@prisma/client';
import { paisaToNumber } from '@smart-home/domain';
import { notFound, validationFailed } from '../common/domain-error.js';
import { PrismaService } from '../database/prisma.service.js';
import { AuditService } from '../platform/audit.service.js';
import type { ProviderServiceListQuery } from './catalogue.schemas.js';

export type ProviderServiceRow = { providerId: string; serviceId: number; serviceSlug: string; serviceNameEn: string; pricePaisa: number; status: string; createdAt: Date };

type ProviderServiceRowRaw = Omit<ProviderServiceRow, 'pricePaisa'> & { pricePaisa: bigint };

const toRow = (raw: ProviderServiceRowRaw): ProviderServiceRow => ({ ...raw, pricePaisa: paisaToNumber(raw.pricePaisa) });

const ROW_COLUMNS = Prisma.sql`ps.provider_id as "providerId", ps.service_id as "serviceId", s.slug as "serviceSlug", s.name_en as "serviceNameEn", ps.price_paisa as "pricePaisa", ps.status, ps.created_at as "createdAt"`;

@Injectable()
export class ProviderServicesService {
  constructor(
    @Inject(PrismaService) private readonly prisma: PrismaService,
    @Inject(AuditService) private readonly audit: AuditService
  ) {}

  async listMine(providerId: string): Promise<ProviderServiceRow[]> {
    const raw = await this.prisma.$queryRaw<ProviderServiceRowRaw[]>(
      Prisma.sql`SELECT ${ROW_COLUMNS} FROM provider_services ps JOIN services s ON s.id = ps.service_id WHERE ps.provider_id = ${providerId}::uuid ORDER BY ps.created_at DESC`
    );
    return raw.map(toRow);
  }

  async upsertMine(providerId: string, serviceId: number, pricePaisa: number): Promise<ProviderServiceRow> {
    const services = await this.prisma.$queryRaw<{ minPricePaisa: bigint; maxPricePaisa: bigint }[]>(
      Prisma.sql`SELECT min_price_paisa as "minPricePaisa", max_price_paisa as "maxPricePaisa" FROM services WHERE id = ${serviceId} AND is_active = true`
    );
    const service = services[0];
    if (service === undefined) throw notFound('Service');
    if (pricePaisa < paisaToNumber(service.minPricePaisa) || pricePaisa > paisaToNumber(service.maxPricePaisa)) {
      throw validationFailed([{ path: 'pricePaisa', code: 'out_of_band', message: `pricePaisa must be between ${service.minPricePaisa} and ${service.maxPricePaisa} for this service` }]);
    }
    // BE-031 (decision): a service the provider removed and then re-adds at the SAME price keeps the approval it had when it was
    // removed. Nothing the admin reviewed has changed (same service, same price), so making them approve it again would be busywork
    // for the admin and an unexplained outage for the provider (a PENDING service is not offered in search). Any other case starts
    // PENDING as before: a new price, a service that was never approved or was rejected, or one never offered by this provider.
    // The removal is a hard delete, so what the binding looked like is read back from the audit row written when it was removed.
    const raw = await this.prisma.$transaction(async tx => {
      const status = (await this.restorableStatus(tx, providerId, serviceId, pricePaisa)) ?? 'PENDING';
      return tx.$queryRaw<ProviderServiceRowRaw[]>(
        Prisma.sql`INSERT INTO provider_services(provider_id, service_id, price_paisa, status)
          VALUES (${providerId}::uuid, ${serviceId}, ${BigInt(pricePaisa)}, ${status}::approval_status)
          ON CONFLICT (provider_id, service_id) DO UPDATE SET price_paisa = EXCLUDED.price_paisa
          RETURNING provider_id as "providerId", service_id as "serviceId", price_paisa as "pricePaisa", status, created_at as "createdAt"`
      );
    });
    const row = raw[0];
    if (row === undefined) throw new Error('Provider service upsert did not return a row');
    const withService = await this.prisma.$queryRaw<{ serviceSlug: string; serviceNameEn: string }[]>(Prisma.sql`SELECT slug as "serviceSlug", name_en as "serviceNameEn" FROM services WHERE id = ${serviceId}`);
    return toRow({ ...row, ...withService[0]! });
  }

  async removeMine(providerId: string, serviceId: number): Promise<void> {
    await this.prisma.$transaction(async tx => {
      const removed = await tx.$queryRaw<{ status: string; pricePaisa: bigint }[]>(
        Prisma.sql`DELETE FROM provider_services WHERE provider_id = ${providerId}::uuid AND service_id = ${serviceId} RETURNING status::text as status, price_paisa as "pricePaisa"`
      );
      const binding = removed[0];
      if (binding === undefined) throw notFound('Provider service binding');
      // What the binding was, so a re-add at the same price can keep its approval (BE-031).
      await this.audit.append(
        { actorUserId: providerId, actorRole: 'PROVIDER', action: 'provider_service.remove', entityType: 'provider_service', entityId: `${providerId}:${serviceId}`, before: { status: binding.status, pricePaisa: paisaToNumber(binding.pricePaisa) } },
        tx
      );
    });
  }

  /** The status to restore on a re-add: 'APPROVED' only if the most recent removal of this binding was of an approved one at this very price. */
  private async restorableStatus(tx: Prisma.TransactionClient, providerId: string, serviceId: number, pricePaisa: number): Promise<'APPROVED' | null> {
    const rows = await tx.$queryRaw<{ before: { status?: unknown; pricePaisa?: unknown } | null }[]>(
      Prisma.sql`SELECT before FROM audit_log WHERE action = 'provider_service.remove' AND entity_type = 'provider_service' AND entity_id = ${`${providerId}:${serviceId}`} ORDER BY id DESC LIMIT 1`
    );
    const before = rows[0]?.before;
    return before?.status === 'APPROVED' && before.pricePaisa === pricePaisa ? 'APPROVED' : null;
  }

  async listForAdmin(filter: ProviderServiceListQuery): Promise<ProviderServiceRow[]> {
    const raw = await this.prisma.$queryRaw<ProviderServiceRowRaw[]>(
      Prisma.sql`SELECT ${ROW_COLUMNS} FROM provider_services ps JOIN services s ON s.id = ps.service_id
        WHERE (${filter.status ?? null}::approval_status IS NULL OR ps.status = ${filter.status ?? null}::approval_status)
        ORDER BY ps.created_at`
    );
    return raw.map(toRow);
  }

  async setStatus(providerId: string, serviceId: number, status: 'APPROVED' | 'REJECTED', actorUserId: string): Promise<ProviderServiceRow> {
    const raw = await this.prisma.$queryRaw<ProviderServiceRowRaw[]>(
      Prisma.sql`UPDATE provider_services ps SET status = ${status}::approval_status
        FROM services s
        WHERE ps.provider_id = ${providerId}::uuid AND ps.service_id = ${serviceId} AND s.id = ps.service_id
        RETURNING ${ROW_COLUMNS}`
    );
    const row = raw[0];
    if (row === undefined) throw notFound('Provider service binding');
    await this.audit.append({ actorUserId, actorRole: 'ADMIN', action: status === 'APPROVED' ? 'provider_service.approve' : 'provider_service.reject', entityType: 'provider_service', entityId: `${providerId}:${serviceId}`, after: { status } });
    return toRow(row);
  }
}
