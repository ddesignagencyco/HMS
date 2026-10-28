import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import { adminApi } from '@/features/admin/api';
import { casesApi, conductApi, disputesApi, notificationsApi, providerDocumentsApi, settingsApi } from '@/features/admin/cases-api';
import type {
  AppealDecisionInput,
  AppealStatus,
  Channel,
  ComplaintQueueFilters,
  ComplaintSeverity,
  ComplaintStatus,
  ComplaintTransitionInput,
  DisputeResolveInput,
  DisputeStatus,
  NotificationStatus,
  PenaltyStatus,
  ProposePenaltyInput,
  SettingValue
} from '@/features/admin/cases-api';
import { FRESHNESS, adminKeys, isNotFoundError, publicRetry } from '@/lib/api/keys';
import type { Locale } from '@/lib/utils';

/* Server state for cases: complaints, disputes, penalties, appeals, settings,
   templates and the delivery log.
 *
 * Same two rules as the account admin layer:
 *
 * · **No mutation retries.** Each of these decides something about a real person's
 *   money or conduct — a refund, a penalty, a suspension, a template that goes out
 *   to every customer on that event. A replayed write is a second decision.
 * · **Every write invalidates the whole admin subtree**, because these routes cross
 *   cuts: resolving a dispute closes a complaint, applying a penalty creates an
 *   appeal window, and deactivating changes both the users list and the audit log
 *   in the same transaction.
 *
 * Reads keep short freshness. The one exception is settings: it is read on nearly
 * every booking and changes only when an admin changes it, so it is the longest
 * window in the app — but it is still invalidated by its own mutation. */

/* ---- complaints --------------------------------------------------------- */

export function useComplaintQueue(filters: ComplaintQueueFilters, locale: Locale) {
  return useQuery({
    queryKey: [...adminKeys.all, 'complaints', filters.status ?? 'all', filters.severity ?? 'all', filters.open ?? 'all'],
    queryFn: ({ signal }) => casesApi.queue(filters, { signal, locale }),
    /* Deliberately NOT re-sorted in the browser: the API orders open first, SAFETY
       at the top, then by how soon the SLA runs out. That is the server's judgement
       about urgency and re-deriving it here would only disagree with it. */
    staleTime: FRESHNESS.bookingList.staleTime,
    gcTime: FRESHNESS.bookingList.gcTime,
    retry: publicRetry
  });
}

export function useComplaintDetail(id: string | null, locale: Locale) {
  return useQuery({
    queryKey: [...adminKeys.all, 'complaints', 'detail', id ?? ''],
    queryFn: ({ signal }) => casesApi.one(id as string, { signal, locale }),
    enabled: id !== null && id !== '',
    staleTime: FRESHNESS.booking.staleTime,
    gcTime: FRESHNESS.booking.gcTime,
    retry: (failureCount, error) => !isNotFoundError(error) && publicRetry(failureCount, error)
  });
}

/* ---- disputes ----------------------------------------------------------- */

export function useDisputes(status: DisputeStatus | undefined, locale: Locale) {
  return useQuery({
    queryKey: [...adminKeys.all, 'disputes', status ?? 'all'],
    queryFn: ({ signal }) => disputesApi.list(status, { signal, locale }),
    /* Also server-ordered: open first, then oldest. */
    staleTime: FRESHNESS.bookingList.staleTime,
    gcTime: FRESHNESS.bookingList.gcTime,
    retry: publicRetry
  });
}

/* ---- conduct ----------------------------------------------------------- */

export function usePenalties(filters: { status?: PenaltyStatus; providerId?: string }, locale: Locale) {
  return useQuery({
    queryKey: [...adminKeys.all, 'penalties', filters.status ?? 'all', filters.providerId ?? ''],
    queryFn: ({ signal }) => conductApi.list(filters, { signal, locale }),
    staleTime: FRESHNESS.bookingList.staleTime,
    gcTime: FRESHNESS.bookingList.gcTime,
    retry: publicRetry
  });
}

export function useAppeals(status: AppealStatus | undefined, locale: Locale) {
  return useQuery({
    queryKey: [...adminKeys.all, 'appeals', status ?? 'all'],
    queryFn: ({ signal }) => conductApi.appeals(status, { signal, locale }),
    staleTime: FRESHNESS.bookingList.staleTime,
    gcTime: FRESHNESS.bookingList.gcTime,
    retry: publicRetry
  });
}

/* ---- settings ----------------------------------------------------------- */

/**
 * `GET /admin/settings` — the longest stale window in the app.
 *
 * Settings are read on nearly every booking and change only when an admin changes
 * one, so caching them for half an hour costs nothing and saves a query per screen.
 * The write invalidates this key, so an admin never sees a stale value after their
 * own edit.
 */
export function useSettings(q: string | undefined, locale: Locale) {
  return useQuery({
    queryKey: [...adminKeys.all, 'settings', q ?? ''],
    queryFn: ({ signal }) => settingsApi.list(q, { signal, locale }),
    staleTime: FRESHNESS.places.staleTime,
    gcTime: FRESHNESS.places.gcTime,
    retry: publicRetry
  });
}

/* ---- notifications ------------------------------------------------------ */

export function useNotificationLog(filters: { userId?: string; eventKey?: string; channel?: Channel; status?: NotificationStatus; limit?: number }, locale: Locale) {
  return useQuery({
    queryKey: [...adminKeys.all, 'notifications', filters.channel ?? 'all', filters.status ?? 'all', filters.eventKey ?? '', filters.userId ?? ''],
    queryFn: ({ signal }) => notificationsApi.log(filters, { signal, locale }),
    staleTime: FRESHNESS.bookingList.staleTime,
    gcTime: FRESHNESS.bookingList.gcTime,
    retry: publicRetry
  });
}

export function useTemplates(filters: { eventKey?: string; channel?: Channel; locale?: 'en' | 'ur' }, locale: Locale) {
  return useQuery({
    queryKey: [...adminKeys.all, 'templates', filters.channel ?? 'all', filters.eventKey ?? ''],
    queryFn: ({ signal }) => notificationsApi.templates(filters, { signal, locale }),
    /* Templates change rarely and a stale body is a customer-facing risk, so this
       is shorter than settings but longer than a queue. */
    staleTime: FRESHNESS.categoryServices.staleTime,
    gcTime: FRESHNESS.categoryServices.gcTime,
    retry: publicRetry
  });
}

/* ---- provider documents ------------------------------------------------- */

export function useProviderDocuments(providerId: string | null, locale: Locale) {
  return useQuery({
    queryKey: [...adminKeys.all, 'provider-documents', providerId ?? ''],
    queryFn: ({ signal }) => providerDocumentsApi.listForProvider(providerId as string, { signal, locale }),
    enabled: providerId !== null && providerId !== '',
    staleTime: FRESHNESS.providerProfile.staleTime,
    gcTime: FRESHNESS.providerProfile.gcTime,
    retry: (failureCount, error) => !isNotFoundError(error) && publicRetry(failureCount, error)
  });
}

/* ---- writes -------------------------------------------------------------- */

/** One helper for every privileged write; see the note at the top of the file. */
const useDecision = <TInput, TResult>(perform: (input: TInput) => Promise<TResult>) => {
  const queryClient = useQueryClient();
  return useMutation({
    mutationFn: perform,
    /* The whole admin subtree, not just this screen: see the note above. */
    onSuccess: () => queryClient.invalidateQueries({ queryKey: adminKeys.all }),
    retry: false
  });
};

/* complaints */
export const useAssignComplaint = (locale: Locale) => useDecision((input: { id: string; assigneeId?: string }) => casesApi.assign(input.id, input.assigneeId, { locale }));

export const useTransitionComplaint = (locale: Locale) => useDecision((input: { id: string; transition: ComplaintTransitionInput }) => casesApi.transition(input.id, input.transition, { locale }));

export const useOpenDispute = (locale: Locale) => useDecision((id: string) => casesApi.openDispute(id, { locale }));

/* disputes */
export const useResolveDispute = (locale: Locale) => useDecision((input: { id: string; resolution: DisputeResolveInput }) => disputesApi.resolve(input.id, input.resolution, { locale }));

/* conduct */
export const useProposePenalty = (locale: Locale) => useDecision((input: ProposePenaltyInput) => conductApi.propose(input, { locale }));

export const useApplyPenalty = (locale: Locale) => useDecision((id: string) => conductApi.apply(id, { locale }));

export const useWithdrawPenalty = (locale: Locale) => useDecision((input: { id: string; reason: string }) => conductApi.withdraw(input.id, input.reason, { locale }));

export const useDecideAppeal = (locale: Locale) => useDecision((input: { id: string; decision: AppealDecisionInput }) => conductApi.decideAppeal(input.id, input.decision, { locale }));

/* settings */
export const useUpdateSetting = (locale: Locale) => useDecision((input: { key: string; value: SettingValue }) => settingsApi.update(input.key, input.value, { locale }));

/* templates */
export const usePreviewTemplate = (locale: Locale) =>
  useDecision((input: { body: string; subject?: string | null; variables?: Record<string, string> }) => notificationsApi.preview(input, { locale }));

export const useSaveTemplate = (locale: Locale) =>
  useDecision((input: { id?: string; eventKey?: string; channel?: Channel; locale?: 'en' | 'ur'; subject?: string | null; body: string; isActive?: boolean }) =>
    input.id === undefined
      ? notificationsApi.create(
          {
            body: input.body,
            eventKey: input.eventKey as string,
            channel: input.channel as Channel,
            locale: input.locale as 'en' | 'ur',
            ...(input.subject === undefined ? {} : { subject: input.subject }),
            ...(input.isActive === undefined ? {} : { isActive: input.isActive })
          },
          { locale }
        )
      : notificationsApi.update(
          input.id,
          { body: input.body, ...(input.subject === undefined ? {} : { subject: input.subject }), ...(input.isActive === undefined ? {} : { isActive: input.isActive }) },
          { locale }
        )
  );

/* provider documents */
export const useReviewDocument = (locale: Locale) =>
  useDecision((input: { documentId: string; status: 'VERIFIED' | 'REJECTED'; note?: string }) =>
    providerDocumentsApi.review(input.documentId, { status: input.status, ...(input.note === undefined ? {} : { note: input.note }) }, { locale })
  );

/* providers, reused from the account layer so the approval screen and the register
   invalidate each other. */
export { useApproveProvider, useRejectProvider, useBlockProvider, useUnblockProvider, useDeactivateProvider, useAdminProviders, useAdminUsers } from '@/features/admin/queries';
export { useApproveProviderService, useRejectProviderService } from '@/features/admin/queries';
export { adminApi };
export type { ComplaintSeverity, ComplaintStatus, DisputeStatus, PenaltyStatus };
