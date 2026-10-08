// apps/api/src/booking/booking.row.ts
import { Prisma } from '@prisma/client';
import { paisaToNumber } from '@smart-home/domain';

export type BookingRow = {
  id: string;
  code: string;
  customerId: string;
  providerId: string | null;
  serviceId: number;
  addressId: string;
  status: string;
  paymentMode: string;
  paymentStatus: string;
  isEmergency: boolean;
  isAutoAssign: boolean;
  scheduledStart: Date;
  scheduledEnd: Date;
  problemText: string | null;
  issueOptionId: number | null;
  /**
   * Whether someone other than the customer will receive the provider. The
   * booker's account still pays and still owns the job; this flag and the name are
   * only who to knock on. The contact number is deliberately *not* on this row —
   * see `on-behalf.ts`: it is read through one method that applies the masking rule,
   * so no provider-facing endpoint can return it by accident.
   */
  isOnBehalf: boolean;
  onBehalfName: string | null;
  quotedAmountPaisa: number;
  approvedTotalPaisa: number;
  finalAmountPaisa: number | null;
  discountPaisa: number;
  rescheduleCount: number;
  noShowParty: string | null;
  cancelReason: string | null;
  startOtpVerifiedAt: Date | null;
  completedAt: Date | null;
  verificationTier: string | null;
  createdAt: Date;
  updatedAt: Date;
};

export type BookingRowRaw = Omit<BookingRow, 'quotedAmountPaisa' | 'approvedTotalPaisa' | 'finalAmountPaisa' | 'discountPaisa'> & {
  quotedAmountPaisa: bigint;
  approvedTotalPaisa: bigint;
  finalAmountPaisa: bigint | null;
  discountPaisa: bigint;
};

/**
 * The line items a booking was priced for, as stored by `create()` from the
 * quote. `unit_price_paisa` and `amount_paisa` are the same value for every row
 * written today (quantity is always 1); both are kept because the invoice and
 * any future per-unit pricing read them separately.
 */
export type BookingItemRow = { id: string; kind: string; description: string; quantity: number; unitPricePaisa: number; amountPaisa: number };

/**
 * Names rather than ids. `BOOKING_COLUMNS` above stays bare because it is used
 * in `RETURNING` clauses, where a join is not possible; this projection and its
 * `BOOKING_READ_JOIN` are for the two read endpoints (`GET /bookings` and
 * `GET /bookings/:id`), where the extra text costs nothing.
 *
 * `qualification` and not `users.first_name`: the public search contract
 * deliberately never publishes a provider's name (§2.2 of the search notes), so
 * the booking row stays consistent with what the rest of the product may show.
 * The service name is published in both languages like every other catalogue
 * label, because the customer reads it.
 */
export type BookingReadRow = BookingRow & {
  serviceName: string | null;
  serviceNameUr: string | null;
  serviceSlug: string | null;
  providerQualification: string | null;
  addressLabel: string | null;
  addressLine1: string | null;
  addressLine2: string | null;
  areaName: string | null;
};

export type BookingReadRaw = Omit<BookingReadRow, 'quotedAmountPaisa' | 'approvedTotalPaisa' | 'finalAmountPaisa' | 'discountPaisa'> & {
  quotedAmountPaisa: bigint;
  approvedTotalPaisa: bigint;
  finalAmountPaisa: bigint | null;
  discountPaisa: bigint;
};

export const BOOKING_READ_JOIN = Prisma.sql`FROM bookings b
  LEFT JOIN services s ON s.id = b.service_id
  LEFT JOIN providers p ON p.user_id = b.provider_id
  LEFT JOIN addresses a ON a.id = b.address_id
  LEFT JOIN areas ar ON ar.id = a.area_id`;

/** Qualifies `BOOKING_COLUMNS` with the `bookings b` alias that `BOOKING_READ_JOIN` introduces. */
export const BOOKING_READ_COLUMNS = Prisma.sql`b.id, b.code, b.customer_id as "customerId", b.provider_id as "providerId", b.service_id as "serviceId", b.address_id as "addressId",
  b.status, b.payment_mode as "paymentMode", b.scheduled_start as "scheduledStart", b.scheduled_end as "scheduledEnd", b.problem_text as "problemText",
  b.issue_option_id as "issueOptionId", b.is_on_behalf as "isOnBehalf", b.on_behalf_name as "onBehalfName",
  b.quoted_amount_paisa as "quotedAmountPaisa", b.approved_total_paisa as "approvedTotalPaisa", b.final_amount_paisa as "finalAmountPaisa", b.discount_paisa as "discountPaisa", b.payment_status as "paymentStatus", b.is_emergency as "isEmergency", b.is_auto_assign as "isAutoAssign",
  b.completed_at as "completedAt", b.verification_tier as "verificationTier",
  b.reschedule_count as "rescheduleCount", b.no_show_party as "noShowParty", b.cancel_reason as "cancelReason", b.start_otp_verified_at as "startOtpVerifiedAt",
  b.created_at as "createdAt", b.updated_at as "updatedAt",
  s.name_en as "serviceName", s.name_ur as "serviceNameUr", s.slug as "serviceSlug",
  p.qualification as "providerQualification",
  a.label as "addressLabel", a.line1 as "addressLine1", a.line2 as "addressLine2", ar.name as "areaName"`;

export const BOOKING_COLUMNS = Prisma.sql`id, code, customer_id as "customerId", provider_id as "providerId", service_id as "serviceId", address_id as "addressId",
  status, payment_mode as "paymentMode", scheduled_start as "scheduledStart", scheduled_end as "scheduledEnd", problem_text as "problemText",
  issue_option_id as "issueOptionId", is_on_behalf as "isOnBehalf", on_behalf_name as "onBehalfName",
  quoted_amount_paisa as "quotedAmountPaisa", approved_total_paisa as "approvedTotalPaisa", final_amount_paisa as "finalAmountPaisa", discount_paisa as "discountPaisa", payment_status as "paymentStatus", is_emergency as "isEmergency", is_auto_assign as "isAutoAssign",
  completed_at as "completedAt", verification_tier as "verificationTier",
  reschedule_count as "rescheduleCount", no_show_party as "noShowParty", cancel_reason as "cancelReason", start_otp_verified_at as "startOtpVerifiedAt",
  created_at as "createdAt", updated_at as "updatedAt"`;

/** bigint paisa to number paisa; the only place the database's numeric type is narrowed. */
const withMoney = <T extends { quotedAmountPaisa: bigint; approvedTotalPaisa: bigint; finalAmountPaisa: bigint | null; discountPaisa: bigint }>(
  raw: T
): Omit<T, 'quotedAmountPaisa' | 'approvedTotalPaisa' | 'finalAmountPaisa' | 'discountPaisa'> & {
  quotedAmountPaisa: number;
  approvedTotalPaisa: number;
  finalAmountPaisa: number | null;
  discountPaisa: number;
} => ({
  ...raw,
  quotedAmountPaisa: paisaToNumber(raw.quotedAmountPaisa),
  approvedTotalPaisa: paisaToNumber(raw.approvedTotalPaisa),
  finalAmountPaisa: raw.finalAmountPaisa === null ? null : paisaToNumber(raw.finalAmountPaisa),
  discountPaisa: paisaToNumber(raw.discountPaisa)
});

export const toBookingRow = (raw: BookingRowRaw): BookingRow => withMoney(raw);

export const toBookingReadRow = (raw: BookingReadRaw): BookingReadRow => withMoney(raw);
