/* Maintenance plans — `apps/api/src/plans/*`, added in SHM-089.
 *
 * Eleven routes in three surfaces, and the shapes below are read off
 * `plans.service.ts` rather than off a screen, because four tables'
 * worth of schema (`plans`, `plan_services`, `subscriptions`,
 * `plan_visits`) used to sit in the database entirely unread and the
 * only reason the previous `/plans`, `/account/plans` and
 * `/admin/plans` screens could not be built was that nothing read
 * them.
 *
 * **The split the guards draw, exactly as the server draws it.**
 *
 * · `GET /plans` and `GET /plans/:id` are `@Public()`. A plan
 *   catalogue is marketing surface; it must render for a signed-out
 *   visitor. Neither route filters on the caller.
 * · `POST /plans/:id/subscribe` is `roles: ['CUSTOMER']`. A
 *   professional cannot hold a plan.
 * · `GET /me/subscriptions` is `roles: ['CUSTOMER']` and reads the
 *   caller from the token — there is no customer id in the path, and
 *   adding one would invent a contract.
 * · `GET /subscriptions/:id` and `POST /subscriptions/:id/cancel`
 *   are `@Authenticated()` with **no role list**. The tenant check is
 *   in the service: staff (ADMIN/FINANCE/AGENT) may read or cancel
 *   anyone's, and anyone else gets a 404 when the row is not theirs —
 *   a 404 rather than a 403, deliberately, so the route does not
 *   confirm that someone else's subscription exists.
 * · `GET/POST /admin/plans`, `GET/PATCH/DELETE /admin/plans/:id` are
 *   `roles: ['ADMIN'], totpRequired: true`, like every other admin
 *   route.
 *
 * **A plan's price is never derived here.** `pricePaisa` is the
 * stored figure and `distributePlanVisits` in `@smart-home/domain`
 * already split it across the visits at the moment of purchase, to
 * the exact paisa. The browser is told the plan price, the number of
 * visits the server scheduled, and how many of each remain — it is
 * never asked to divide one by the other, because a client-side
 * division of money is precisely the rounding this domain forbids.
 *
 * **What a plan deliberately does not carry.** There is no image, no
 * badge, no "most popular" flag, no savings figure and no tier rank.
 * `listPublicPlans` selects `id, nameEn, nameUr, description,
 * pricePaisa, durationMonths, isActive` and the joined service rows —
 * nothing else exists to show, so the card renders what the server
 * sent and stops. The old public page invented three tiers with prices
 * (Rs 4,900 / 8,900 / 14,900) and visit counts that no row in the
 * database agreed with; that array is gone.
 *
 * **description has no Urdu counterpart.** The plans table is
 * ame_en, ame_ur, description — one description column, not a
 * pair — so on the Urdu catalogue the name and the service names are Urdu
 * while the description is whatever the administrator typed. That asymmetry is
 * the database's, written up as B5 rather than papered over: the value is
 * rendered as returned.
 *
 * **Subscribe returns a checkout, not a confirmed plan.**
 * `subscribe()` writes the subscription, schedules the visits and
 * creates a `PLAN` payment inside one transaction, then calls
 * `payments.startCheckout`, so the response carries
 * `checkout.returnUrl`. Following that URL is what actually takes the
 * money: the subscription only becomes `ACTIVE` when the gateway
 * callback arrives and `capturePlan` runs. The screen therefore routes
 * to the checkout rather than declaring success. */

import { apiRequest, type ApiRequest } from '@/lib/api/client';
import type { Locale } from '@/lib/utils';

/** `subscription_status` as the database spells it. */
export const SUBSCRIPTION_STATUSES = ['ACTIVE', 'CANCELLED', 'EXPIRED'] as const;

/** `plan_visit_status`. A visit moves PENDING → BOOKED → CONSUMED, or to REFUNDED / FORFEITED. */
export const PLAN_VISIT_STATUSES = ['PENDING', 'BOOKED', 'CONSUMED', 'FORFEITED', 'REFUNDED'] as const;

export type SubscriptionStatus = (typeof SUBSCRIPTION_STATUSES)[number];
export type PlanVisitStatus = (typeof PLAN_VISIT_STATUSES)[number];

/**
 * One line of a plan: a catalogue service, how many visits of it are
 * included, and how far apart they fall.
 *
 * `serviceNameEn` / `serviceNameUr` are joined in the SQL from
 * `services`, so the card can name the service without a second
 * request. The catalogue id is still carried, because a customer's
 * visit schedule reports `serviceId` and the two have to be joinable.
 */
export type PlanService = {
  serviceId: number;
  serviceNameEn: string;
  serviceNameUr: string;
  visitsIncluded: number;
  intervalDays: number;
};

/** The admin list joins `serviceNameEn` but not the Urdu name — it is the same row, read with fewer columns. */
export type AdminPlanService = Omit<PlanService, 'serviceNameUr'>;

/** `GET /plans` and `GET /plans/:id`. Both are `@Public()`. */
export type Plan = {
  id: string;
  nameEn: string;
  nameUr: string;
  description: string;
  /** Stored price, in paisa. Already a number — `paisaToNumber` on the server. */
  pricePaisa: number;
  durationMonths: number;
  isActive: boolean;
  services: PlanService[];
};

/**
 * `GET /admin/plans`.
 *
 * Every plan, active or not, newest first, each carrying the count of
 * `ACTIVE` subscriptions — a `COUNT(*) FILTER (WHERE status =
 * 'ACTIVE')` in the same query, so the figure is the server's and not
 * a client-side count of a page that was only 200 rows long.
 *
 * The service rows here select `serviceNameEn` but **not**
 * `serviceNameUr`, unlike the public list. An Urdu admin listing a
 * plan's services sees the English service name because that is the
 * column the query returns; this type says so rather than pretending
 * otherwise.
 */
export type AdminPlan = {
  id: string;
  nameEn: string;
  nameUr: string;
  description: string;
  pricePaisa: number;
  durationMonths: number;
  isActive: boolean;
  createdAt: string;
  activeSubscriptionsCount: number;
  services: AdminPlanService[];
};

/** `planCreateSchema` — `.strict()`, and `services` must not be empty. */
export type CreatePlanInput = {
  nameEn: string;
  nameUr: string;
  description: string;
  pricePaisa: number;
  durationMonths: number;
  services: { serviceId: number; visitsIncluded: number; intervalDays: number }[];
};

/** `planUpdateSchema` — `.strict()`, every key optional. Services are **not** editable here. */
export type UpdatePlanInput = {
  nameEn?: string;
  nameUr?: string;
  description?: string;
  pricePaisa?: number;
  durationMonths?: number;
  isActive?: boolean;
};

/**
 * `planSubscribeSchema` — `.strict()`.
 *
 * `addressId` is required and must be one of the caller's own
 * unarchived addresses: the service checks `customer_id` and
 * `archived_at IS NULL` itself and answers 400 rather than 403 when it
 * does not match, so the screen offers only the real list.
 *
 * `preferredProviderId` is nullable and, when given, must resolve to a
 * provider whose status is `APPROVED`.
 */
export type SubscribeInput = {
  addressId: string;
  preferredProviderId?: string | null;
  returnUrl?: string;
};

/**
 * `POST /plans/:id/subscribe`.
 *
 * `subscriptionId` and `paymentId` exist before the money moves. The
 * plan becomes billable only when the checkout completes, so this is
 * treated as "checkout started", never as "you are subscribed".
 */
export type SubscribeResult = {
  subscriptionId: string;
  paymentId: string;
  startsAt: string;
  endsAt: string;
  /** How many visits the server scheduled — a count, not money. */
  visitsCount: number;
  checkout: { returnUrl: string; [key: string]: unknown };
};

/**
 * `GET /me/subscriptions`.
 *
 * The visit counts are four separate `COUNT(pv.id) FILTER (WHERE
 * status = ...)` columns. They are counts of visits, never paisa, and
 * they come from one grouped query, so the four numbers always add up
 * to `totalVisits` — which is worth asserting in a test, because a
 * screen that shows "3 of 4 remaining" is making an arithmetic claim
 * about money-adjacent quantities.
 */
export type MySubscription = {
  id: string;
  planId: string;
  planNameEn: string;
  planNameUr: string;
  status: string;
  startsAt: string;
  endsAt: string;
  cancelledAt: string | null;
  createdAt: string;
  addressLabel: string;
  addressLine1: string;
  preferredProviderId: string | null;
  totalVisits: number;
  pendingVisits: number;
  bookedVisits: number;
  consumedVisits: number;
  refundedVisits: number;
};

/** One scheduled visit on a subscription's schedule. */
export type SubscriptionVisit = {
  id: string;
  serviceId: number;
  serviceNameEn: string;
  dueDate: string;
  status: PlanVisitStatus;
  /** This visit's slice of the plan price. Exact paisa, fixed at purchase. */
  valuePaisa: number;
  bookingId: string | null;
};

/** `GET /subscriptions/:id` — the plan price comes from `plans`, not from the sum of the visits. */
export type SubscriptionDetail = {
  id: string;
  customerId: string;
  planId: string;
  planNameEn: string;
  planNameUr: string;
  planPricePaisa: number;
  status: string;
  startsAt: string;
  endsAt: string;
  cancelledAt: string | null;
  createdAt: string;
  addressId: string;
  addressLabel: string;
  addressLine1: string;
  preferredProviderId: string | null;
  visits: SubscriptionVisit[];
};

/**
 * `POST /subscriptions/:id/cancel`.
 *
 * `refundPaisa` is what the server computed from the visits it locked:
 * `calculatePlanCancellationRefund` refunds the `PENDING` ones and
 * leaves `BOOKED` and `CONSUMED` alone, because those visits are
 * either spoken for or already done. The screen shows this figure as
 * returned. It never recomputes it, and there is no preview endpoint
 * to call first — so the button states the rule rather than quoting a
 * number it cannot know in advance.
 */
export type CancelResult = {
  id: string;
  status: 'CANCELLED';
  refundedVisitsCount: number;
  refundPaisa: number;
};

export type PlanOptions = { signal?: AbortSignal; locale?: Locale };

const call = <T>(path: string, request: ApiRequest = {}, options?: PlanOptions) =>
  apiRequest<T>(path, {
    ...request,
    ...(options?.locale === undefined ? {} : { locale: options.locale }),
    ...(options?.signal === undefined ? {} : { signal: options.signal })
  });

const planPath = (planId: string, suffix = ''): string => `/plans/${encodeURIComponent(planId)}${suffix}`;
const subscriptionPath = (id: string, suffix = ''): string => `/subscriptions/${encodeURIComponent(id)}${suffix}`;

export const plansApi = {
  /* ---- public ---------------------------------------------------------- */

  /** `@Public()`. Active plans only, cheapest first, each with its service rows. */
  listPlans: (options?: PlanOptions) => call<{ items: Plan[] }>('/plans', { auth: false }, options),

  /** `@Public()`. 404 for an inactive plan — the `is_active = true` predicate is part of the read. */
  getPlan: (planId: string, options?: PlanOptions) => call<Plan>(planPath(planId), { auth: false }, options),

  /* ---- customer -------------------------------------------------------- */

  /** `CUSTOMER` only. Creates the subscription, schedules the visits, and starts the checkout. */
  subscribe: (planId: string, input: SubscribeInput, options?: PlanOptions) => call<SubscribeResult>(planPath(planId, '/subscribe'), { method: 'POST', body: { ...input } }, options),

  /** `CUSTOMER` only, keyed on the caller. Newest first. */
  listMySubscriptions: (options?: PlanOptions) => call<{ items: MySubscription[] }>('/me/subscriptions', {}, options),

  /** Staff may read anyone's; anyone else gets 404 for a row that is not theirs. */
  getSubscription: (id: string, options?: PlanOptions) => call<SubscriptionDetail>(subscriptionPath(id), {}, options),

  /** Idempotence is not offered: a second cancel answers 400 "already cancelled". */
  cancelSubscription: (id: string, reason?: string, options?: PlanOptions) =>
    call<CancelResult>(subscriptionPath(id, '/cancel'), { method: 'POST', body: reason === undefined || reason === '' ? {} : { reason } }, options),

  /* ---- admin ----------------------------------------------------------- */

  /** ADMIN + TOTP. Every plan, active or not, newest first. */
  adminListPlans: (options?: PlanOptions) => call<{ items: AdminPlan[] }>('/admin/plans', {}, options),

  adminGetPlan: (planId: string, options?: PlanOptions) => call<AdminPlan>(`/admin/plans/${encodeURIComponent(planId)}`, {}, options),

  /** Every field required. The service rejects a service id that is not `is_active = true`. */
  adminCreatePlan: (input: CreatePlanInput, options?: PlanOptions) => call<{ id: string } & CreatePlanInput>('/admin/plans', { method: 'POST', body: { ...input } }, options),

  /**
   * Patch, not replace. Only the keys sent change; the service reads the
   * current row under `FOR UPDATE` and coalesces.
   *
   * **`services` is not in `planUpdateSchema`.** A plan's service list
   * can be set at creation and cannot be changed afterwards through
   * this route. That is a real limitation of the API, so the admin
   * screen does not offer a service editor: a control that cannot save
   * would be worse than an absent one.
   */
  adminUpdatePlan: (planId: string, input: UpdatePlanInput, options?: PlanOptions) =>
    call<{ id: string } & Required<UpdatePlanInput>>(`/admin/plans/${encodeURIComponent(planId)}`, { method: 'PATCH', body: { ...input } }, options),

  /**
   * `DELETE`, and it is a deactivation: `UPDATE plans SET is_active =
   * false`. Nothing is removed and existing subscriptions are untouched,
   * so this is labelled "deactivate" everywhere it appears.
   */
  adminDeactivatePlan: (planId: string, options?: PlanOptions) => call<{ id: string; isActive: boolean }>(`/admin/plans/${encodeURIComponent(planId)}`, { method: 'DELETE' }, options)
};

/** The plan's name in the reader's language, falling back to the other rather than to the id. */
export const planName = (plan: { nameEn: string; nameUr: string }, locale: Locale): string => (locale === 'ur' ? plan.nameUr || plan.nameEn : plan.nameEn || plan.nameUr) || '';

/** The same for a service row, which carries both names on the public list. */
export const planServiceName = (service: PlanService | AdminPlanService, locale: Locale): string =>
  locale === 'ur' && 'serviceNameUr' in service ? service.serviceNameUr || service.serviceNameEn : service.serviceNameEn;

/** Total visits a plan includes, summed from its own service rows. This is a count, not money. */
export const planTotalVisits = (services: readonly { visitsIncluded: number }[]): number => services.reduce((sum, service) => sum + service.visitsIncluded, 0);

/**
 * Visits a customer has left to spend.
 *
 * `pending + booked` is what can still happen. `consumed` is done and
 * `refunded` is gone, so both are excluded — and this is stated rather
 * than summed in the UI, because "3 of 4 visits remaining" on a plan
 * that has already refunded one is a different sentence from the same
 * four numbers.
 */
export const subscriptionRemainingVisits = (subscription: MySubscription): number => subscription.pendingVisits + subscription.bookedVisits;
