// apps/api/src/booking/on-behalf.ts
/**
 * Booking for someone who is not the customer: the booker's account still pays,
 * rates and disputes the job, but the provider has to be able to reach the person
 * who will actually answer the door. Without this the provider is knocking for a
 * stranger.
 *
 * The contact number never rides on `BookingRow`. Every provider-facing endpoint in
 * the booking module returns that row, so a number on it would be handed to a
 * provider by any of them, including the offer list where the provider is only
 * deciding whether to take the job at all. Instead the number is read through
 * `BookingService.onBehalfContact`, which is the one place that decides who may see
 * it and in what form.
 *
 * NFR-PR-01 and TASKS_FRONTEND.md ("every screen that shows a phone number must show
 * the masked one") mean masked by default; the full number goes only to the
 * provider who has accepted the job, and to the customer who entered it.
 */

export type OnBehalfContact = { name: string; phone: string; revealed: boolean };

/**
 * `+923001234567` -> `+92•••••••567`. The country code stays so the provider can tell
 * a Pakistan number from a wrong one, and the last three digits stay because they
 * are what someone confirms over the phone; everything between is the part that
 * actually reaches the person.
 */
export const maskPhoneE164 = (phoneE164: string): string => {
  const hasPlus = phoneE164.startsWith('+');
  const digits = hasPlus ? phoneE164.slice(1) : phoneE164;
  if (digits.length <= 3) return `${hasPlus ? '+' : ''}${'•'.repeat(digits.length)}`;
  return `${hasPlus ? '+' : ''}${'•'.repeat(digits.length - 3)}${digits.slice(-3)}`;
};

/**
 * Who may see the number in full: the customer who booked it, and the provider once
 * the job is theirs. `ACCEPTED` is that point — before it the provider is choosing
 * between jobs and has no contractual claim on anyone's contact details.
 */
export const maySeeFullContact = (viewer: { userId: string; isCustomer: boolean; isProvider: boolean }, booking: { customerId: string; providerId: string | null; status: string }): boolean => {
  if (viewer.isCustomer && viewer.userId === booking.customerId) return true;
  return viewer.isProvider && viewer.userId === booking.providerId && booking.status !== 'REQUESTED';
};

export const contactFor = (input: { name: string; phone: string }, revealed: boolean): OnBehalfContact => ({
  name: input.name,
  phone: revealed ? input.phone : maskPhoneE164(input.phone),
  revealed
});