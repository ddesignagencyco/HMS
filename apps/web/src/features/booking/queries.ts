import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { FRESHNESS, accountKeys, bookingKeys, isNotFoundError, publicRetry } from "@/lib/api/keys";
import type { Locale } from "@/lib/utils";
import { accountApi, type CreateAddressInput, type UpdateAddressInput } from "@/features/account/api";
import { bookingApi, type AddEvidenceInput, type BookingListStatus, type CreateBookingInput, type QuoteInput } from "@/features/booking/api";

/* Server state for the authenticated account.

   Two things here are not the usual shape and both are deliberate:

   Â· **Nothing retries on a 404.** `GET /bookings/:id` answers 404 for a booking
     that is not yours, and 404 is how this API says "does not exist" â€” it never
     confirms another person's booking. Retrying would only delay a correct
     not-found state.

   Â· **The quote is a mutation.** `POST /bookings/quote` is a POST because it is
     priced against the signed-in customer's outstanding balance, but it creates
     nothing. Treating it as a mutation keeps it out of the cache: a cached
     quote is a quote for an old basket, and the whole reason to re-read it is
     that the inputs just changed. */

/** A mutation must not be retried â€” it may already have taken effect. */
const noRetry = { retry: false };

export function useAddresses(locale: Locale, enabled = true) {
  return useQuery({
    queryKey: accountKeys.addresses,
    queryFn: ({ signal }) => accountApi.listAddresses({ signal, locale }),
    enabled,
    staleTime: FRESHNESS.addresses.staleTime,
    gcTime: FRESHNESS.addresses.gcTime,
    retry: publicRetry,
  });
}

export function useCreateAddress(locale: Locale) {
  const queryClient = useQueryClient();
  return useMutation({
    mutationFn: (input: CreateAddressInput) => accountApi.createAddress(input, { locale }),
    /* A new default un-defaults the old one inside the same transaction, so the
       whole list is refetched rather than patched â€” otherwise the list would
       show two defaults until something else invalidated it. */
    onSuccess: () => queryClient.invalidateQueries({ queryKey: accountKeys.addresses }),
    ...noRetry,
  });
}

export function useUpdateAddress(locale: Locale) {
  const queryClient = useQueryClient();
  return useMutation({
    mutationFn: ({ id, input }: { id: string; input: UpdateAddressInput }) => accountApi.updateAddress(id, input, { locale }),
    onSuccess: () => queryClient.invalidateQueries({ queryKey: accountKeys.addresses }),
    ...noRetry,
  });
}

export function useArchiveAddress(locale: Locale) {
  const queryClient = useQueryClient();
  return useMutation({
    mutationFn: (addressId: string) => accountApi.archiveAddress(addressId, { locale }),
    onSuccess: () => queryClient.invalidateQueries({ queryKey: accountKeys.addresses }),
    ...noRetry,
  });
}

export function useMyBookings(status: BookingListStatus | undefined, locale: Locale) {
  return useQuery({
    queryKey: bookingKeys.list(status),
    queryFn: ({ signal }) => bookingApi.listMine(status, { signal, locale }),
    staleTime: FRESHNESS.bookingList.staleTime,
    gcTime: FRESHNESS.bookingList.gcTime,
    retry: publicRetry,
  });
}

export function useBooking(bookingId: string | null, locale: Locale) {
  return useQuery({
    queryKey: bookingKeys.detail(bookingId ?? ""),
    queryFn: ({ signal }) => bookingApi.get(bookingId as string, { signal, locale }),
    enabled: bookingId !== null && bookingId !== "",
    staleTime: FRESHNESS.booking.staleTime,
    gcTime: FRESHNESS.booking.gcTime,
    retry: (failureCount, error) => !isNotFoundError(error) && publicRetry(failureCount, error),
  });
}

/**
 * Prices the current basket. Refetch on demand rather than on a timer: the quote
 * changes when the professional, the emergency flag or the coupon changes, and
 * never on its own.
 */
export function useQuote(input: QuoteInput | null, locale: Locale) {
  return useMutation({
    mutationFn: (payload: QuoteInput) => bookingApi.quote(payload, { locale }),
    ...noRetry,
  });
}

/**
 * Creates the booking.
 *
 * The list is invalidated rather than optimistically appended, because the
 * create response is authoritative but the list may be filtered by a status the
 * new booking does not match â€” appending it anyway would put a booking on screen
 * that the filter asked not to show.
 */
export function useCreateBooking(locale: Locale) {
  const queryClient = useQueryClient();
  return useMutation({
    mutationFn: (input: CreateBookingInput) => bookingApi.create(input, { locale }),
    onSuccess: () => queryClient.invalidateQueries({ queryKey: bookingKeys.all }),
    ...noRetry,
  });
}

/** Every booking action refreshes both the detail and the list. */
const useBookingAction = <TInput, TResult>(perform: (input: TInput) => Promise<TResult>) => {
  const queryClient = useQueryClient();
  return useMutation({
    mutationFn: perform,
    onSuccess: () => queryClient.invalidateQueries({ queryKey: bookingKeys.all }),
    ...noRetry,
  });
};

export const useCancelBooking = (locale: Locale) =>
  useBookingAction((input: { id: string; reason?: string }) => bookingApi.cancel(input.id, input.reason, { locale }));

export const useRescheduleBooking = (locale: Locale) =>
  useBookingAction((input: { id: string; scheduledStart: string; scheduledEnd: string }) => bookingApi.reschedule(input.id, input, { locale }));

export const useApproveRevision = (locale: Locale) => useBookingAction((bookingId: string) => bookingApi.approveRevision(bookingId, { locale }));

export const useRejectRevision = (locale: Locale) => useBookingAction((bookingId: string) => bookingApi.rejectRevision(bookingId, { locale }));

export const useWarrantyClaim = (locale: Locale) =>
  useBookingAction((input: { id: string; reason: string }) => bookingApi.warrantyClaim(input.id, input.reason, { locale }));

export const useReportNoShow = (locale: Locale) =>
  useBookingAction((input: { id: string; party: "CUSTOMER" | "PROVIDER" }) => bookingApi.reportNoShow(input.id, input.party, { locale }));

/** FR-BK-03: at most five problem photos, and only before the job starts. */
export const MAX_PROBLEM_PHOTOS = 5;

export function useBookingEvidence(locale: Locale) {
  const queryClient = useQueryClient();
  return useMutation({
    mutationFn: (input: { id: string; payload: AddEvidenceInput }) => bookingApi.addEvidence(input.id, input.payload, { locale }),
    /* The evidence list is not on the booking row, so there is no cached list to
       patch here. The detail is invalidated because the photo count and the
       booking's own view of the visit are derived from it elsewhere. */
    onSuccess: (_result, input) => queryClient.invalidateQueries({ queryKey: bookingKeys.detail(input.id) }),
    ...noRetry,
  });
}

export function useBookingMessages(bookingId: string | null, locale: Locale, enabled = true) {
  return useQuery({
    queryKey: [...bookingKeys.detail(bookingId ?? ""), "messages"],
    queryFn: ({ signal }) => bookingApi.listMessages(bookingId as string, { signal, locale }),
    enabled: enabled && bookingId !== null && bookingId !== "",
    /* Reading is a side effect, so this is never served from cache on its own. */
    staleTime: FRESHNESS.messages.staleTime,
    gcTime: FRESHNESS.messages.gcTime,
    refetchOnWindowFocus: FRESHNESS.messages.refetchOnWindowFocus,
    retry: (failureCount, error) => !isNotFoundError(error) && publicRetry(failureCount, error),
  });
}

export const useSendMessage = (locale: Locale) => {
  const queryClient = useQueryClient();
  return useMutation({
    mutationFn: (input: { id: string; body: string }) => bookingApi.sendMessage(input.id, input.body, { locale }),
    onSuccess: (_result, input) => queryClient.invalidateQueries({ queryKey: [...bookingKeys.detail(input.id), "messages"] }),
    ...noRetry,
  });
};