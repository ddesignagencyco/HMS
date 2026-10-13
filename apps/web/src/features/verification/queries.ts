import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import { ApiError } from '@/lib/api/problem';
import { FRESHNESS, bookingKeys, isNotFoundError, publicRetry } from '@/lib/api/keys';
import type { Locale } from '@/lib/utils';
import { selfConfirmationApi, type SelfConfirmationAnswers } from './api';

/**
 * The "confirm the work" form for one booking (FR-VC-16).
 *
 * `enabled` is the caller's `booking.canSelfVerify`: there is nothing to ask for
 * on a booking the state machine says cannot be self-verified. Kept on the
 * booking's freshness, because an agent claiming the call flips `canSubmit`
 * without anything else on the booking moving.
 */
export function useSelfConfirmation(bookingId: string, enabled: boolean, locale: Locale) {
  return useQuery({
    queryKey: bookingKeys.selfConfirmation(bookingId),
    queryFn: ({ signal }) => selfConfirmationApi.describe(bookingId, { signal, locale }),
    enabled: enabled && bookingId !== '',
    staleTime: FRESHNESS.booking.staleTime,
    gcTime: FRESHNESS.booking.gcTime,
    /* 404 is "not your booking" — retrying only delays routing away. */
    retry: (failureCount, error) => !isNotFoundError(error) && publicRetry(failureCount, error)
  });
}

/**
 * Submits the form. Never retried: it may release money.
 *
 * Both a success and a 409 refresh every booking read. A success moves the
 * booking on (or, for ESCALATED, re-routes its verification); a 409 means the
 * state already moved — an agent picked up, or the job settled — and the screen
 * must re-read it rather than try again.
 */
export function useSubmitSelfConfirmation(bookingId: string, locale: Locale) {
  const queryClient = useQueryClient();
  return useMutation({
    mutationFn: (answers: SelfConfirmationAnswers) => selfConfirmationApi.submit(bookingId, answers, locale),
    onSuccess: () => queryClient.invalidateQueries({ queryKey: bookingKeys.all }),
    onError: (error) => {
      if (error instanceof ApiError && error.status === 409) void queryClient.invalidateQueries({ queryKey: bookingKeys.all });
    },
    retry: false
  });
}
