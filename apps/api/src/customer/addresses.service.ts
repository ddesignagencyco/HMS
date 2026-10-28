import { Inject, Injectable } from '@nestjs/common';
import { Prisma } from '@prisma/client';
import { DomainError, notFound } from '../common/domain-error.js';
import { PrismaService } from '../database/prisma.service.js';
import type { AddressCreateInput, AddressUpdateInput } from './customer.schemas.js';

/** Every terminal/closed `booking_status` -- once a booking reaches one of these, it no longer locks its address. */
const TERMINAL_BOOKING_STATUSES = Prisma.sql`'UNFULFILLED','ABANDONED','CANCELLED_CUSTOMER','CANCELLED_PROVIDER','NO_SHOW','REFUNDED','CLOSED'`;

export type AddressRow = { id: string; label: string; line1: string; line2: string | null; areaId: number; lat: number; lng: number; notes: string | null; isDefault: boolean; createdAt: Date };

const ADDRESS_COLUMNS = Prisma.sql`id, label, line1, line2, area_id as "areaId", ST_Y(location::geometry) as lat, ST_X(location::geometry) as lng, notes, is_default as "isDefault", created_at as "createdAt"`;

@Injectable()
export class AddressesService {
  constructor(@Inject(PrismaService) private readonly prisma: PrismaService) {}

  async listMine(customerId: string): Promise<AddressRow[]> {
    return this.prisma.$queryRaw<AddressRow[]>(
      Prisma.sql`SELECT ${ADDRESS_COLUMNS} FROM addresses WHERE customer_id = ${customerId}::uuid AND archived_at IS NULL ORDER BY is_default DESC, created_at DESC`
    );
  }

  async create(customerId: string, input: AddressCreateInput): Promise<AddressRow> {
    await this.assertAreaActive(input.areaId);
    return this.prisma.$transaction(async tx => {
      if (input.isDefault) await this.clearDefault(tx, customerId);
      const rows = await tx.$queryRaw<AddressRow[]>(
        Prisma.sql`INSERT INTO addresses(customer_id, label, line1, line2, area_id, location, notes, is_default)
          VALUES (${customerId}::uuid, ${input.label}, ${input.line1}, ${input.line2 ?? null}, ${input.areaId},
            ST_SetSRID(ST_MakePoint(${input.lng}, ${input.lat}), 4326)::geography, ${input.notes ?? null}, ${input.isDefault})
          RETURNING ${ADDRESS_COLUMNS}`
      );
      const row = rows[0];
      if (row === undefined) throw new Error('Address insert did not return a row');
      return row;
    });
  }

  async update(customerId: string, id: string, input: AddressUpdateInput): Promise<AddressRow> {
    if (input.areaId !== undefined) await this.assertAreaActive(input.areaId);
    const hasPoint = input.lat !== undefined && input.lng !== undefined;
    const touchesLocation = input.line1 !== undefined || input.line2 !== undefined || input.areaId !== undefined || hasPoint;
    if (touchesLocation) await this.assertNotLockedByOnBehalfBooking(id);
    return this.prisma.$transaction(async tx => {
      if (input.isDefault === true) await this.clearDefault(tx, customerId, id);
      const rows = await tx.$queryRaw<AddressRow[]>(
        Prisma.sql`UPDATE addresses SET
            label = COALESCE(${input.label ?? null}, label),
            line1 = COALESCE(${input.line1 ?? null}, line1),
            line2 = COALESCE(${input.line2 ?? null}, line2),
            area_id = COALESCE(${input.areaId ?? null}, area_id),
            location = ${hasPoint ? Prisma.sql`ST_SetSRID(ST_MakePoint(${input.lng}, ${input.lat}), 4326)::geography` : Prisma.sql`location`},
            notes = COALESCE(${input.notes ?? null}, notes),
            is_default = COALESCE(${input.isDefault ?? null}, is_default)
          WHERE id = ${id}::uuid AND customer_id = ${customerId}::uuid AND archived_at IS NULL
          RETURNING ${ADDRESS_COLUMNS}`
      );
      const row = rows[0];
      if (row === undefined) throw notFound('Address');
      return row;
    });
  }

  async archive(customerId: string, id: string): Promise<void> {
    await this.assertNotLockedByOnBehalfBooking(id);
    const affected = await this.prisma.$executeRaw(
      Prisma.sql`UPDATE addresses SET archived_at = now() WHERE id = ${id}::uuid AND customer_id = ${customerId}::uuid AND archived_at IS NULL`
    );
    if (affected === 0) throw notFound('Address');
  }

  /**
   * "Book this for someone else" locks the address: the provider is being sent to that
   * door, so the customer must not be able to move it, retitle its street, or archive it
   * out from under them while the booking is still live. The lock lifts itself once the
   * booking reaches a terminal status -- no separate unlock step to forget.
   */
  private async assertNotLockedByOnBehalfBooking(addressId: string): Promise<void> {
    const locked = await this.prisma.$queryRaw<{ id: string }[]>(
      Prisma.sql`SELECT id FROM bookings WHERE address_id = ${addressId}::uuid AND is_on_behalf = true AND status NOT IN (${TERMINAL_BOOKING_STATUSES}) LIMIT 1`
    );
    if (locked.length > 0) {
      throw new DomainError('ADDRESS_LOCKED', "This address cannot be changed while it is in use for an active booking made on someone else's behalf.");
    }
  }

  private async assertAreaActive(areaId: number): Promise<void> {
    const areas = await this.prisma.$queryRaw<{ id: number }[]>(Prisma.sql`SELECT id FROM areas WHERE id = ${areaId} AND is_active = true`);
    if (areas.length === 0) throw notFound('Area');
  }

  private async clearDefault(tx: Prisma.TransactionClient, customerId: string, exceptId?: string): Promise<void> {
    await tx.$executeRaw(
      exceptId === undefined
        ? Prisma.sql`UPDATE addresses SET is_default = false WHERE customer_id = ${customerId}::uuid AND is_default = true`
        : Prisma.sql`UPDATE addresses SET is_default = false WHERE customer_id = ${customerId}::uuid AND is_default = true AND id != ${exceptId}::uuid`
    );
  }
}
