import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import {
  plansApi,
  type AdminPlan,
  type CancelResult,
  type CreatePlanInput,
  type MySubscription,
  type Plan,
  type SubscribeInput,
  type SubscribeResult,
  type SubscriptionDetail,
  type UpdatePlanInput
} from '@/features/plans/api';
import { FRESHNESS, accountKeys, adminKeys, planKeys, publicRetry } from '@/lib/api/keys';
import type { Locale } from '@/lib/utils';

/* Server state for maintenance plans.
 *
 * **No mutation here retries.** A retried `POST /plans/:id/subscribe`
 * would create a *second* subscription — the plan purchase is a
 * transaction that inserts a subscription, schedules its visits, opens
 * a payment and posts to the ledger. Nothing about it is idempotent,
 * and `keySuffix: randomUUID()` guarantees a retry is never recognised
 * as the same attempt. Same for a cancel, which moves money.
 *
 * **An admin plan write clears both key families.** Creating or
 * deactivating a plan changes what the admin list shows *and* what the
 * public catalogue shows, so invalidating only `adminKeys.all` would
 * leave a customer-facing price card describing a plan that no longer
 * exists. `planKeys.all` goes with it.
 *
 * **A subscribe or cancel clears the account's subscriptions**, because
 * both change the visit counts on screen — cancelling refunds every
 * pending visit, which is exactly the number the customer is reading. */

export function usePlans(locale: Locale) {
  return useQuery({
    queryKey: planKeys.list,
    queryFn: ({ signal }) => plansApi.listPlans({ signal, locale }),
    staleTime: FRESHNESS.plans.staleTime,
    gcTime: FRESHNESS.plans.gcTime,
    retry: publicRetry
  });
}

export function usePlan(planId: string, locale: Locale) {
  return useQuery({
    queryKey: planKeys.detail(planId),
    queryFn: ({ signal }) => plansApi.getPlan(planId, { signal, locale }),
    staleTime: FRESHNESS.plans.staleTime,
    gcTime: FRESHNESS.plans.gcTime,
    retry: publicRetry,
    enabled: planId !== ''
  });
}

export function useMySubscriptions(locale: Locale) {
  return useQuery({
    queryKey: accountKeys.subscriptions,
    queryFn: ({ signal }) => plansApi.listMySubscriptions({ signal, locale }),
    staleTime: FRESHNESS.subscription.staleTime,
    gcTime: FRESHNESS.subscription.gcTime,
    retry: publicRetry,
    refetchOnWindowFocus: FRESHNESS.subscription.refetchOnWindowFocus ?? false
  });
}

export function useSubscription(id: string, locale: Locale) {
  return useQuery({
    queryKey: accountKeys.subscription(id),
    queryFn: ({ signal }) => plansApi.getSubscription(id, { signal, locale }),
    staleTime: FRESHNESS.subscription.staleTime,
    gcTime: FRESHNESS.subscription.gcTime,
    retry: publicRetry,
    refetchOnWindowFocus: FRESHNESS.subscription.refetchOnWindowFocus ?? false,
    enabled: id !== ''
  });
}

/**
 * Starts the purchase.
 *
 * The caller is responsible for following `checkout.returnUrl` — the
 * subscription is not active until the gateway confirms, so this hook
 * does not treat a success as a completed sale and the screen does not
 * say "you are subscribed" on the strength of it.
 */
export function useSubscribe() {
  const client = useQueryClient();
  return useMutation({
    mutationFn: ({ planId, input }: { planId: string; input: SubscribeInput }) => plansApi.subscribe(planId, input),
    onSuccess: () => {
      void client.invalidateQueries({ queryKey: accountKeys.subscriptions });
    }
  });
}

export function useCancelSubscription() {
  const client = useQueryClient();
  return useMutation({
    mutationFn: ({ id, reason }: { id: string; reason?: string }) => plansApi.cancelSubscription(id, reason),
    onSuccess: (_result, variables) => {
      void client.invalidateQueries({ queryKey: accountKeys.subscriptions });
      void client.invalidateQueries({ queryKey: accountKeys.subscription(variables.id) });
      /* The refund is a ledger movement, so an admin's own plan list —
         which counts active subscriptions — is now stale too. */
      void client.invalidateQueries({ queryKey: adminKeys.all });
    }
  });
}

/* ---- admin -------------------------------------------------------------- */

export function useAdminPlans(locale: Locale) {
  return useQuery({
    queryKey: adminKeys.plans,
    queryFn: ({ signal }) => plansApi.adminListPlans({ signal, locale }),
    /* Short: an operator editing prices must see their own write. */
    staleTime: FRESHNESS.search.staleTime,
    gcTime: FRESHNESS.search.gcTime,
    retry: publicRetry
  });
}

export function useCreatePlan() {
  const client = useQueryClient();
  return useMutation({
    mutationFn: (input: CreatePlanInput) => plansApi.adminCreatePlan(input),
    onSuccess: () => {
      void client.invalidateQueries({ queryKey: adminKeys.plans });
      void client.invalidateQueries({ queryKey: planKeys.all });
    }
  });
}

export function useUpdatePlan() {
  const client = useQueryClient();
  return useMutation({
    mutationFn: ({ planId, input }: { planId: string; input: UpdatePlanInput }) => plansApi.adminUpdatePlan(planId, input),
    onSuccess: () => {
      void client.invalidateQueries({ queryKey: adminKeys.plans });
      void client.invalidateQueries({ queryKey: planKeys.all });
    }
  });
}

export function useDeactivatePlan() {
  const client = useQueryClient();
  return useMutation({
    mutationFn: (planId: string) => plansApi.adminDeactivatePlan(planId),
    onSuccess: () => {
      void client.invalidateQueries({ queryKey: adminKeys.plans });
      /* A deactivated plan leaves `GET /plans` immediately — that query
         filters `is_active = true`. */
      void client.invalidateQueries({ queryKey: planKeys.all });
    }
  });
}

export type { AdminPlan, CancelResult, CreatePlanInput, MySubscription, Plan, SubscribeInput, SubscribeResult, SubscriptionDetail, UpdatePlanInput };
