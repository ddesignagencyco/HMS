// apps/api/src/booking/booking.row.ts
import { Prisma } from '@prisma/client';

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

export const BOOKING_COLUMNS = Prisma.sql`id, code, customer_id as "customerId", provider_id as "providerId", service_id as "serviceId", address_id as "addressId",
  status, payment_mode as "paymentMode", scheduled_start as "scheduledStart", scheduled_end as "scheduledEnd", problem_text as "problemText",
  issue_option_id as "issueOptionId", is_on_behalf as "isOnBehalf", on_behalf_name as "onBehalfName",
  quoted_amount_paisa as "quotedAmountPaisa", approved_total_paisa as "approvedTotalPaisa", final_amount_paisa as "finalAmountPaisa", discount_paisa as "discountPaisa", payment_status as "paymentStatus", is_emergency as "isEmergency", is_auto_assign as "isAutoAssign",
  completed_at as "completedAt", verification_tier as "verificationTier",
  reschedule_count as "rescheduleCount", no_show_party as "noShowParty", cancel_reason as "cancelReason", start_otp_verified_at as "startOtpVerifiedAt",
  created_at as "createdAt", updated_at as "updatedAt"`;

export const toBookingRow = (raw: BookingRowRaw): BookingRow => ({
  ...raw,
  quotedAmountPaisa: Number(raw.quotedAmountPaisa),
  approvedTotalPaisa: Number(raw.approvedTotalPaisa),
  finalAmountPaisa: raw.finalAmountPaisa === null ? null : Number(raw.finalAmountPaisa),
  discountPaisa: Number(raw.discountPaisa)
});

