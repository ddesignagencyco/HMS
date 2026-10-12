import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import { FRESHNESS, accountKeys, bookingKeys, isNotFoundError, publicRetry } from '@/lib/api/keys';
import type { Locale } from '@/lib/utils';
import { accountApi, type CreateAddressInput, type UpdateAddressInput } from '@/features/account/api';
import { bookingApi, type AddEvidenceInput, type BookingListStatus, type CreateBookingInput, type QuoteInput } from '@/features/booking/api';

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
    retry: publicRetry
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
    ...noRetry
  });
}

export function useUpdateAddress(locale: Locale) {
  const queryClient = useQueryClient();
  return useMutation({
    mutationFn: ({ id, input }: { id: string; input: UpdateAddressInput }) => accountApi.updateAddress(id, input, { locale }),
    onSuccess: () => queryClient.invalidateQueries({ queryKey: accountKeys.addresses }),
    ...noRetry
  });
}

export function useArchiveAddress(locale: Locale) {
  const queryClient = useQueryClient();
  return useMutation({
    mutationFn: (addressId: string) => accountApi.archiveAddress(addressId, { locale }),
    onSuccess: () => queryClient.invalidateQueries({ queryKey: accountKeys.addresses }),
    ...noRetry
  });
}

export function useMyBookings(status: BookingListStatus | undefined, locale: Locale) {
  return useQuery({
    queryKey: bookingKeys.list(status),
    queryFn: ({ signal }) => bookingApi.listMine(status, { signal, locale }),
    staleTime: FRESHNESS.bookingList.staleTime,
    gcTime: FRESHNESS.bookingList.gcTime,
    retry: publicRetry
  });
}

export function useBooking(bookingId: string | null, locale: Locale) {
  return useQuery({
    queryKey: bookingKeys.detail(bookingId ?? ''),
    queryFn: ({ signal }) => bookingApi.get(bookingId as string, { signal, locale }),
    enabled: bookingId !== null && bookingId !== '',
    staleTime: FRESHNESS.booking.staleTime,
    gcTime: FRESHNESS.booking.gcTime,
    retry: (failureCount, error) => !isNotFoundError(error) && publicRetry(failureCount, error)
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
    ...noRetry
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
    ...noRetry
  });
}

/** Every booking action refreshes both the detail and the list. */
const useBookingAction = <TInput, TResult>(perform: (input: TInput) => Promise<TResult>) => {
  const queryClient = useQueryClient();
  return useMutation({
    mutationFn: perform,
    onSuccess: () => queryClient.invalidateQueries({ queryKey: bookingKeys.all }),
    ...noRetry
  });
};

export const useCancelBooking = (locale: Locale) => useBookingAction((input: { id: string; reason?: string }) => bookingApi.cancel(input.id, input.reason, { locale }));

export const useRescheduleBooking = (locale: Locale) => useBookingAction((input: { id: string; scheduledStart: string; scheduledEnd: string }) => bookingApi.reschedule(input.id, input, { locale }));

export const useApproveRevision = (locale: Locale) => useBookingAction((bookingId: string) => bookingApi.approveRevision(bookingId, { locale }));

export const useRejectRevision = (locale: Locale) => useBookingAction((bookingId: string) => bookingApi.rejectRevision(bookingId, { locale }));

export const useWarrantyClaim = (locale: Locale) => useBookingAction((input: { id: string; reason: string }) => bookingApi.warrantyClaim(input.id, input.reason, { locale }));

export const useReportNoShow = (locale: Locale) => useBookingAction((input: { id: string; party: 'CUSTOMER' | 'PROVIDER' }) => bookingApi.reportNoShow(input.id, input.party, { locale }));

/* ---- Provider actions on a booking ---------------------------------------- */

export const useAcceptBooking = (locale: Locale) => useBookingAction((id: string) => bookingApi.accept(id, { locale }));

export const useDeclineBooking = (locale: Locale) => useBookingAction((id: string) => bookingApi.decline(id, { locale }));

export const useDepartBooking = (locale: Locale) => useBookingAction((id: string) => bookingApi.depart(id, { locale }));

export const useStartBooking = (locale: Locale) =>
  useBookingAction((input: { id: string; code: string; lat?: number; lng?: number; accuracyM?: number }) =>
    bookingApi.start(input.id, { code: input.code, lat: input.lat, lng: input.lng, accuracyM: input.accuracyM }, { locale })
  );

export const useCompleteBooking = (locale: Locale) =>
  useBookingAction((input: { id: string; finalAmountPaisa?: number; lat?: number; lng?: number; accuracyM?: number }) =>
    bookingApi.complete(input.id, { finalAmountPaisa: input.finalAmountPaisa, lat: input.lat, lng: input.lng, accuracyM: input.accuracyM }, { locale })
  );

export const useCashReceived = (locale: Locale) => useBookingAction((id: string) => bookingApi.cashReceived(id, { locale }));

/**
 * Ticks one step done.
 *
 * `evidenceId` is required by the server for a photo step (`422` without it) and
 * ignored for the rest, so it is only sent when the caller has one. On success the
 * checklist is refetched rather than patched locally: `done`, `evidenceId` and
 * `doneAt` are all server-stamped, and a locally guessed tick would claim a
 * timestamp and an evidence link the server never recorded.
 */
export const useMarkChecklistDone = (locale: Locale) => {
  const queryClient = useQueryClient();
  return useMutation({
    mutationFn: (input: { id: string; itemId: number; evidenceId?: string }) => bookingApi.markChecklistDone(input.id, input.itemId, input.evidenceId, { locale }),
    onSuccess: (_result, variables) => queryClient.invalidateQueries({ queryKey: bookingKeys.checklist(variables.id) }),
    ...noRetry
  });
};

/**
 * The service's checklist for this booking.
 *
 * Fetched regardless of status on purpose. The route answers at any status, and
 * gating the *query* on `IN_PROGRESS` would leave the list absent from the cache
 * at exactly the moment the professional needs to see it. What is rendered is a
 * separate decision, made where the status is known.
 *
 * Cached on the booking's own key rather than the detail's, because ticking a step
 * must invalidate this list and nothing else — refetching the whole booking to
 * redraw four ticks would be wasteful and would re-fetch the chat thread with it.
 */
export function useChecklist(bookingId: string | null, locale: Locale) {
  return useQuery({
    queryKey: bookingKeys.checklist(bookingId ?? ''),
    queryFn: ({ signal }) => bookingApi.listChecklist(bookingId as string, { signal, locale }),
    enabled: bookingId !== null && bookingId !== '',
    /* Ticking a step changes it, so it is never cached for long. */
    staleTime: FRESHNESS.messages.staleTime,
    gcTime: FRESHNESS.messages.gcTime,
    /* 404 means "not your booking", exactly as the detail does. */
    retry: (failureCount, error) => !isNotFoundError(error) && publicRetry(failureCount, error)
  });
}

/**
 * Where this job is.
 *
 * `enabled` is left to the caller, because the route is deliberately closed to a
 * provider while the booking is still REQUESTED — they are being asked to commit
 * to a job they may not yet be told where. Asking anyway would produce a 404 for
 * every open offer, so the query waits until the caller knows the job is theirs.
 */
export function useServiceAddress(bookingId: string | null, enabled: boolean, locale: Locale) {
  return useQuery({
    queryKey: bookingKeys.serviceAddress(bookingId ?? ''),
    queryFn: ({ signal }) => bookingApi.serviceAddress(bookingId as string, { signal, locale }),
    enabled: enabled && bookingId !== null && bookingId !== '',
    staleTime: FRESHNESS.booking.staleTime,
    gcTime: FRESHNESS.booking.gcTime,
    /* 404 is a designed answer, not a fault: the address is withheld while the job
       can still change hands. Retrying would only delay the correct not-found. */
    retry: false
  });
}

export const useCreateRevision = (locale: Locale) =>
  useBookingAction((input: { id: string; deltaPaisa: number; reason: string }) => bookingApi.createRevision(input.id, { deltaPaisa: input.deltaPaisa, reason: input.reason }, { locale }));

/* The contact is masked until the provider accepts — this is the customer/provider
   seeing who the job is for, not a public read. */
export const useOnBehalfContact = (id: string | null, locale: Locale) =>
  useQuery({
    queryKey: [...bookingKeys.detail(id ?? ''), 'on-behalf'],
    queryFn: ({ signal }) => bookingApi.onBehalfContact(id as string, { signal, locale }),
    enabled: id !== null && id !== '',
    staleTime: FRESHNESS.booking.staleTime,
    gcTime: FRESHNESS.booking.gcTime,
    retry: (failureCount, error) => !isNotFoundError(error) && publicRetry(failureCount, error)
  });

/** FR-BK-03: at most five problem photos, and only before the job starts. */
export const MAX_PROBLEM_PHOTOS = 5;

/**
 * `GET /bookings/:id/evidence` — every photo on the booking, oldest first.
 *
 * This is a *reader*. It used to have no reader at all: the hook that shares the
 * old name was the upload mutation, so nothing in the app could display a photo it
 * had just uploaded. Evidence is insert-only and the server stamps `receivedAt`,
 * so the list is also the only authority on whether the before/after pair the
 * completion gate needs is on file.
 */
export function useEvidenceList(bookingId: string | null, locale: Locale) {
  return useQuery({
    queryKey: [...bookingKeys.detail(bookingId ?? ''), 'evidence'],
    queryFn: ({ signal }) => bookingApi.listEvidence(bookingId as string, { signal, locale }),
    enabled: bookingId !== null && bookingId !== '',
    staleTime: FRESHNESS.messages.staleTime,
    gcTime: FRESHNESS.messages.gcTime,
    /* A booking you cannot see 404s, exactly as the detail does. */
    retry: (failureCount, error) => !isNotFoundError(error) && publicRetry(failureCount, error)
  });
}

/**
 * `POST /bookings/:id/evidence`.
 *
 * Named for what it does. It was `useBookingEvidence`, which read like the reader
 * above and sent anyone looking for the photo list to a mutation.
 */
export function useAddEvidence(locale: Locale) {
  const queryClient = useQueryClient();
  return useMutation({
    mutationFn: (input: { id: string; payload: AddEvidenceInput }) => bookingApi.addEvidence(input.id, input.payload, { locale }),
    onSuccess: (_result, input) => {
      /* Evidence is not on the booking row, so there is no list to patch — but the
         photo list and the detail are both derived from it and both stale now. */
      void queryClient.invalidateQueries({ queryKey: [...bookingKeys.detail(input.id), 'evidence'] });
      void queryClient.invalidateQueries({ queryKey: bookingKeys.detail(input.id) });
    },
    ...noRetry
  });
}

export function useBookingMessages(bookingId: string | null, locale: Locale, enabled = true) {
  return useQuery({
    queryKey: [...bookingKeys.detail(bookingId ?? ''), 'messages'],
    queryFn: ({ signal }) => bookingApi.listMessages(bookingId as string, { signal, locale }),
    enabled: enabled && bookingId !== null && bookingId !== '',
    /* Reading is a side effect, so this is never served from cache on its own. */
    staleTime: FRESHNESS.messages.staleTime,
    gcTime: FRESHNESS.messages.gcTime,
    refetchOnWindowFocus: FRESHNESS.messages.refetchOnWindowFocus,
    retry: (failureCount, error) => !isNotFoundError(error) && publicRetry(failureCount, error)
  });
}

export const useSendMessage = (locale: Locale) => {
  const queryClient = useQueryClient();
  return useMutation({
    mutationFn: (input: { id: string; body: string }) => bookingApi.sendMessage(input.id, input.body, { locale }),
    onSuccess: (_result, input) => queryClient.invalidateQueries({ queryKey: [...bookingKeys.detail(input.id), 'messages'] }),
    ...noRetry
  });
};
