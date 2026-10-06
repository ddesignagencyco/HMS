import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import { FRESHNESS, isNotFoundError, providerKeys, publicRetry } from '@/lib/api/keys';
import type { Locale } from '@/lib/utils';
import {
  providerApi,
  type Appeal,
  type Conduct,
  type Earnings,
  type Payout,
  type PayoutAccount,
  type Penalty,
  type ProviderDispute,
  type ProviderDisputeDetail,
  type ProviderOffer,
  type ProviderProfile,
  type ProviderProfileInput,
  type ProviderRatings,
  type ProviderService,
  type ProviderServiceArea,
  type PayoutAccountInput,
  type ProviderDocumentInput,
  type SetProviderServiceInput,
  type TimeOffInput,
  type Wallet
} from './api';

/* Server state for the signed-in professional.

   Two rules the whole module follows:

   · **Nothing retries on a 404.** A dispute or penalty that is not yours is
     indistinguishable from one that does not exist, and retrying only delays a
     correct not-found state.

   · **No mutation ever retries.** Accepting an offer, starting a job or sending
     money must not happen twice because a response was slow. */

const noRetry = { retry: false };

/** Anything that changes the wallet, the offers or the job list invalidates all three. */
const useProviderAction = <TInput, TResult>(perform: (input: TInput) => Promise<TResult>) => {
  const queryClient = useQueryClient();
  return useMutation({
    mutationFn: perform,
    onSuccess: () => {
      void queryClient.invalidateQueries({ queryKey: providerKeys.wallet });
      void queryClient.invalidateQueries({ queryKey: providerKeys.earnings });
      void queryClient.invalidateQueries({ queryKey: providerKeys.payouts });
      void queryClient.invalidateQueries({ queryKey: providerKeys.offers });
    },
    ...noRetry
  });
};

/* ---- Profile ------------------------------------------------------------ */

export const useProviderProfile = (locale: Locale) =>
  useQuery({
    queryKey: providerKeys.profile,
    queryFn: ({ signal }) => providerApi.profile({ signal, locale }),
    staleTime: FRESHNESS.providerProfile.staleTime,
    gcTime: FRESHNESS.providerProfile.gcTime,
    retry: publicRetry
  });

export const useUpdateProviderProfile = (locale: Locale) => {
  const queryClient = useQueryClient();
  return useMutation({
    mutationFn: (input: ProviderProfileInput) => providerApi.updateProfile(input, { locale }),
    onSuccess: () => queryClient.invalidateQueries({ queryKey: providerKeys.profile }),
    ...noRetry
  });
};

/* ---- Services and prices ------------------------------------------------ */

export const useProviderServices = (locale: Locale) =>
  useQuery({
    queryKey: providerKeys.services,
    queryFn: ({ signal }) => providerApi.services({ signal, locale }),
    staleTime: FRESHNESS.providerServices.staleTime,
    gcTime: FRESHNESS.providerServices.gcTime,
    retry: publicRetry
  });

export const useSetServicePrice = (locale: Locale) => {
  const queryClient = useQueryClient();
  return useMutation({
    mutationFn: (input: { serviceId: number } & SetProviderServiceInput) => providerApi.setServicePrice(input.serviceId, { pricePaisa: input.pricePaisa }, { locale }),
    onSuccess: () => queryClient.invalidateQueries({ queryKey: providerKeys.services }),
    ...noRetry
  });
};

export const useRemoveProviderService = (locale: Locale) => {
  const queryClient = useQueryClient();
  return useMutation({
    mutationFn: (serviceId: number) => providerApi.removeService(serviceId, { locale }),
    onSuccess: () => queryClient.invalidateQueries({ queryKey: providerKeys.services }),
    ...noRetry
  });
};

/* ---- Service areas ------------------------------------------------------ */

export const useProviderServiceAreas = (locale: Locale) =>
  useQuery({
    queryKey: providerKeys.serviceAreas,
    queryFn: ({ signal }) => providerApi.serviceAreas({ signal, locale }),
    staleTime: FRESHNESS.providerAreas.staleTime,
    gcTime: FRESHNESS.providerAreas.gcTime,
    retry: publicRetry
  });

/** A full replace, not a per-area add: the API takes the whole set. */
export const useSetServiceAreas = (locale: Locale) => {
  const queryClient = useQueryClient();
  return useMutation({
    mutationFn: (areaIds: number[]) => providerApi.setServiceAreas(areaIds, { locale }),
    onSuccess: () => queryClient.invalidateQueries({ queryKey: providerKeys.serviceAreas }),
    ...noRetry
  });
};

/* ---- Availability and leave --------------------------------------------- */

export const useAvailability = (locale: Locale) =>
  useQuery({
    queryKey: providerKeys.availability,
    queryFn: ({ signal }) => providerApi.availability({ signal, locale }),
    staleTime: FRESHNESS.availability.staleTime,
    gcTime: FRESHNESS.availability.gcTime,
    retry: publicRetry
  });

export const useSetAvailability = (locale: Locale) => {
  const queryClient = useQueryClient();
  return useMutation({
    mutationFn: (blocks: { weekday: number; startTime: string; endTime: string }[]) => providerApi.setAvailability(blocks, { locale }),
    onSuccess: () => queryClient.invalidateQueries({ queryKey: providerKeys.availability }),
    ...noRetry
  });
};

export const useTimeOff = (locale: Locale) =>
  useQuery({
    queryKey: providerKeys.timeOff,
    queryFn: ({ signal }) => providerApi.timeOff({ signal, locale }),
    staleTime: FRESHNESS.availability.staleTime,
    gcTime: FRESHNESS.availability.gcTime,
    retry: publicRetry
  });

export const useAddTimeOff = (locale: Locale) => {
  const queryClient = useQueryClient();
  return useMutation({
    mutationFn: (input: TimeOffInput) => providerApi.addTimeOff(input, { locale }),
    onSuccess: () => queryClient.invalidateQueries({ queryKey: providerKeys.timeOff }),
    ...noRetry
  });
};

export const useRemoveTimeOff = (locale: Locale) => {
  const queryClient = useQueryClient();
  return useMutation({
    mutationFn: (id: string) => providerApi.removeTimeOff(id, { locale }),
    onSuccess: () => queryClient.invalidateQueries({ queryKey: providerKeys.timeOff }),
    ...noRetry
  });
};

/* ---- Offers ------------------------------------------------------------ */

export const useProviderOffers = (locale: Locale) =>
  useQuery({
    queryKey: providerKeys.offers,
    queryFn: ({ signal }) => providerApi.offers({ signal, locale }),
    /* No stale window: an offer has an `expiresAt` and a cached one may already
       be gone. Declining one the server has withdrawn is worse than a re-read. */
    staleTime: FRESHNESS.offers.staleTime,
    gcTime: FRESHNESS.offers.gcTime,
    refetchOnWindowFocus: FRESHNESS.offers.refetchOnWindowFocus,
    retry: publicRetry
  });

export const useAcceptOffer = (locale: Locale) => useProviderAction((offerId: string) => providerApi.acceptOffer(offerId, { locale }));

export const useDeclineOffer = (locale: Locale) => useProviderAction((input: { offerId: string; reason?: string }) => providerApi.declineOffer(input.offerId, input.reason, { locale }));

/** The offers that have not lapsed. `expiresAt` is the server's, never a guess. */
export const liveOffers = (offers: ProviderOffer[], now: number = Date.now()): ProviderOffer[] => offers.filter((offer) => new Date(offer.expiresAt).getTime() > now);

/* ---- Money -------------------------------------------------------------- */

export const useEarnings = (locale: Locale) =>
  useQuery({
    queryKey: providerKeys.earnings,
    queryFn: ({ signal }) => providerApi.earnings({ signal, locale }),
    staleTime: FRESHNESS.earnings.staleTime,
    gcTime: FRESHNESS.earnings.gcTime,
    retry: publicRetry
  });

export const useWallet = (locale: Locale) =>
  useQuery({
    queryKey: providerKeys.wallet,
    queryFn: ({ signal }) => providerApi.wallet({ signal, locale }),
    staleTime: FRESHNESS.earnings.staleTime,
    gcTime: FRESHNESS.earnings.gcTime,
    retry: publicRetry
  });

export const usePayouts = (locale: Locale) =>
  useQuery({
    queryKey: providerKeys.payouts,
    queryFn: ({ signal }) => providerApi.payouts({ signal, locale }),
    staleTime: FRESHNESS.payouts.staleTime,
    gcTime: FRESHNESS.payouts.gcTime,
    retry: publicRetry
  });

export const useRequestPayout = (locale: Locale) => useProviderAction((input: { amountPaisa: number; payoutAccountId: string }) => providerApi.requestPayout(input, { locale }));

export const usePayoutAccounts = (locale: Locale) =>
  useQuery({
    queryKey: providerKeys.payoutAccounts,
    queryFn: ({ signal }) => providerApi.payoutAccounts({ signal, locale }),
    staleTime: FRESHNESS.payouts.staleTime,
    gcTime: FRESHNESS.payouts.gcTime,
    retry: publicRetry
  });

export const useAddPayoutAccount = (locale: Locale) => {
  const queryClient = useQueryClient();
  return useMutation({
    mutationFn: (input: PayoutAccountInput) => providerApi.addPayoutAccount(input, { locale }),
    onSuccess: () => queryClient.invalidateQueries({ queryKey: providerKeys.payoutAccounts }),
    ...noRetry
  });
};

export const usePayDebt = (locale: Locale) => useProviderAction((amountPaisa: number) => providerApi.payDebt(amountPaisa, { locale }));

/* ---- Documents ----------------------------------------------------------- */

export const useProviderDocuments = (locale: Locale) =>
  useQuery({
    queryKey: providerKeys.documents,
    queryFn: ({ signal }) => providerApi.documents({ signal, locale }),
    staleTime: FRESHNESS.providerProfile.staleTime,
    gcTime: FRESHNESS.providerProfile.gcTime,
    retry: publicRetry
  });

/**
 * Records a document. `documentSubmitSchema` refuses both and neither of
 * `contentBase64` / `storageKey`, so this takes the presigned key the uploads
 * screen produces.
 */
export const useSubmitDocument = (locale: Locale) => {
  const queryClient = useQueryClient();
  return useMutation({
    mutationFn: (input: ProviderDocumentInput) => providerApi.submitDocument(input, { locale }),
    onSuccess: () => {
      void queryClient.invalidateQueries({ queryKey: providerKeys.documents });
      /* The CNIC banner reads from the same response, so a fresh CNIC number
         changes whether `cnicVerified` is true. */
      void queryClient.invalidateQueries({ queryKey: providerKeys.profile });
    },
    ...noRetry
  });
};

/* ---- Reputation --------------------------------------------------------- */

export const useProviderRatings = (locale: Locale) =>
  useQuery({
    queryKey: providerKeys.ratings,
    queryFn: ({ signal }) => providerApi.ratings({ signal, locale }),
    staleTime: FRESHNESS.ratings.staleTime,
    gcTime: FRESHNESS.ratings.gcTime,
    retry: publicRetry
  });

/** One reply per remark, and it is not editable afterwards — the API enforces it. */
export const useReplyToRemark = (locale: Locale) => {
  const queryClient = useQueryClient();
  return useMutation({
    mutationFn: (input: { remarkId: string; body: string }) => providerApi.replyToRemark(input.remarkId, input.body, { locale }),
    onSuccess: () => queryClient.invalidateQueries({ queryKey: providerKeys.ratings }),
    ...noRetry
  });
};

/* ---- Conduct ------------------------------------------------------------ */

export const useConduct = (locale: Locale) =>
  useQuery({
    queryKey: providerKeys.conduct,
    queryFn: ({ signal }) => providerApi.conduct({ signal, locale }),
    staleTime: FRESHNESS.conduct.staleTime,
    gcTime: FRESHNESS.conduct.gcTime,
    retry: publicRetry
  });

export const usePenalties = (locale: Locale) =>
  useQuery({
    queryKey: providerKeys.penalties,
    queryFn: ({ signal }) => providerApi.penalties({ signal, locale }),
    staleTime: FRESHNESS.penalties.staleTime,
    gcTime: FRESHNESS.penalties.gcTime,
    retry: publicRetry
  });

export const useReplyToPenalty = (locale: Locale) => {
  const queryClient = useQueryClient();
  return useMutation({
    mutationFn: (input: { penaltyId: string; body: string }) => providerApi.replyToPenalty(input.penaltyId, input.body, { locale }),
    onSuccess: () => queryClient.invalidateQueries({ queryKey: providerKeys.penalties }),
    ...noRetry
  });
};

export const useAppealPenalty = (locale: Locale) => {
  const queryClient = useQueryClient();
  return useMutation({
    mutationFn: (input: { penaltyId: string; grounds: string }) => providerApi.appealPenalty(input.penaltyId, input.grounds, { locale }),
    onSuccess: () => {
      void queryClient.invalidateQueries({ queryKey: providerKeys.penalties });
      void queryClient.invalidateQueries({ queryKey: providerKeys.conduct });
    },
    ...noRetry
  });
};

/* ---- Disputes ----------------------------------------------------------- */

export const useDisputes = (locale: Locale) =>
  useQuery({
    queryKey: providerKeys.disputes,
    queryFn: ({ signal }) => providerApi.disputes({ signal, locale }),
    staleTime: FRESHNESS.disputes.staleTime,
    gcTime: FRESHNESS.disputes.gcTime,
    retry: (failureCount, error) => !isNotFoundError(error) && publicRetry(failureCount, error)
  });

export const useDispute = (id: string | null, locale: Locale) =>
  useQuery({
    queryKey: providerKeys.dispute(id ?? ''),
    queryFn: ({ signal }) => providerApi.dispute(id as string, { signal, locale }),
    enabled: id !== null && id !== '',
    staleTime: FRESHNESS.disputes.staleTime,
    gcTime: FRESHNESS.disputes.gcTime,
    retry: (failureCount, error) => !isNotFoundError(error) && publicRetry(failureCount, error)
  });

export const useReplyToDispute = (locale: Locale) => {
  const queryClient = useQueryClient();
  return useMutation({
    mutationFn: (input: { disputeId: string; body: string }) => providerApi.replyToDispute(input.disputeId, input.body, { locale }),
    onSuccess: (_result, input) => {
      void queryClient.invalidateQueries({ queryKey: providerKeys.dispute(input.disputeId) });
      void queryClient.invalidateQueries({ queryKey: providerKeys.disputes });
    },
    ...noRetry
  });
};

/* Re-exported so a page can type a row without importing two modules. */
export type {
  Appeal,
  Conduct,
  Earnings,
  Payout,
  PayoutAccount,
  Penalty,
  ProviderDispute,
  ProviderDisputeDetail,
  ProviderOffer,
  ProviderProfile,
  ProviderRatings,
  ProviderService,
  ProviderServiceArea,
  Wallet
};
