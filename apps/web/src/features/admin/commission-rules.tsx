"use client";

/* `/admin/catalogue` → commission rules.
 *
 * **`/admin/catalogue/commission-rules` existed and nothing read it.** Commission
 * is snapshotted per booking at pricing time, so a rule that is never managed
 * here is not a missing convenience: it is a rate nobody on the platform can see,
 * cannot change, and cannot explain six months later when a provider asks why
 * that job paid commission.
 *
 * Three things about the model that this screen is built around:
 *
 * · **Rates are basis points, not percentages.** 100bp is 1%, so 15% is 1500. A
 *   form that sends `15` sets a 0.15% commission and would look almost right,
 *   which is the worst kind of wrong on a money screen.
 *
 * · **Creating does not replace.** A live rule stays live until it is closed.
 *   Changing a rate in place would make every booking already priced under the old
 *   rate unexplainable, so this is two deliberate actions — open a new one, close
 *   the old — and the list shows both states side by side.
 *
 * · **Global, category and provider rules overlap and the most specific wins**
 *   (`catalogue.service.ts:319` filters, `pricing.service.ts` resolves). So the
 *   list is not "the current rate", and highlighting one row as *the* rate would
 *   misdescribe how pricing works. Open ones are grouped; closed ones are history.
 */

import { Loader2, Percent, Plus, X } from "lucide-react";
import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { useState } from "react";
import toast from "react-hot-toast";
import { Button, Card, Label } from "@/components/ui";
import {
  adminApi,
  type CommissionRule,
  type CommissionRuleInput,
} from "@/features/admin/api";
import { adminKeys, FRESHNESS, publicRetry } from "@/lib/api/keys";
import type { Dictionary } from "@/lib/dictionaries";
import { formatDate, formatNumber, type Locale } from "@/lib/utils";

const SCOPES: CommissionRule["scope"][] = ["GLOBAL", "CATEGORY", "PROVIDER"];

/** 10,000bp is the schema's ceiling — 100%. */
const MAX_RATE_BP = 10_000;

export function useCommissionRules(scope: CommissionRule["scope"] | undefined, locale: Locale) {
  return useQuery({
    queryKey: adminKeys.commissionRules(scope),
    queryFn: ({ signal }) => adminApi.listCommissionRules(scope === undefined ? {} : { scope }, { signal, locale }),
    staleTime: FRESHNESS.categories.staleTime,
    gcTime: FRESHNESS.categories.gcTime,
    retry: publicRetry
  });
}

/**
 * Basis points to a percentage string, for display only.
 *
 * `1500` → `15%`. Handled as a number and divided, not string-manipulated, so
 * 1_650 becomes 16.5% rather than a mangled "16.50%" with the wrong scale.
 */
const bpToPercent = (rateBp: number): string => `${formatNumber(rateBp / 100, "en")}%`;

/* ---- create ----------------------------------------------------------- */

type Draft = {
  scope: CommissionRule["scope"];
  ratePercent: string;
  categoryId: string;
  providerId: string;
};

const EMPTY_DRAFT: Draft = { scope: "GLOBAL", ratePercent: "", categoryId: "", providerId: "" };

function CommissionRuleForm({ locale, dict }: { locale: Locale; dict: Dictionary }) {
  const queryClient = useQueryClient();
  const [draft, setDraft] = useState<Draft>(EMPTY_DRAFT);
  const [error, setError] = useState<string | null>(null);

  const create = useMutation({
    mutationFn: (input: CommissionRuleInput) => adminApi.createCommissionRule(input, { locale }),
    onSuccess: () => {
      void queryClient.invalidateQueries({ queryKey: adminKeys.commissionRules() });
      /* The scoped variants are separate cache entries, so a GLOBAL write has to
         clear CATEGORY and PROVIDER views too or an admin would keep seeing a
         stale list until they changed the filter. */
      for (const scope of SCOPES) void queryClient.invalidateQueries({ queryKey: adminKeys.commissionRules(scope) });
      toast.success(dict.admin.commissionCreated);
      setDraft(EMPTY_DRAFT);
      setError(null);
    },
    onError: (cause: Error) => setError(cause.message || dict.admin.commissionCreateFailed),
    retry: false
  });

  /**
   * Percentage text → basis points.
   *
   * Returns null for anything that is not a number in range, so the form can say
   * so itself rather than sending 15 and setting a 0.15% commission.
   */
  const toBasisPoints = (raw: string): number | null => {
    const trimmed = raw.trim();
    if (trimmed === "") return null;
    const percent = Number(trimmed);
    if (!Number.isFinite(percent)) return null;
    const bp = Math.round(percent * 100);
    return bp >= 0 && bp <= MAX_RATE_BP ? bp : null;
  };

  const rateBp = toBasisPoints(draft.ratePercent);
  const field =
    "mt-1.5 w-full rounded-[9px] border border-line bg-white px-3 py-2.5 text-sm text-navy outline-none focus:border-primary focus:ring-4 focus:ring-blue-100";

  const submit = (event: React.FormEvent) => {
    event.preventDefault();
    setError(null);

    if (rateBp === null) {
      setError(dict.admin.commissionRateInvalid);
      return;
    }
    /* `commissionRuleCreateSchema` refuses a scope/target mismatch, so the form
       checks it first and the message names the field rather than saying 422. */
    if (draft.scope === "CATEGORY" && draft.categoryId.trim() === "") {
      setError(dict.admin.commissionNeedsCategory);
      return;
    }
    if (draft.scope === "PROVIDER" && draft.providerId.trim() === "") {
      setError(dict.admin.commissionNeedsProvider);
      return;
    }
    if (draft.scope === "GLOBAL" && (draft.categoryId.trim() !== "" || draft.providerId.trim() !== "")) {
      /* GLOBAL with a target is the same 422 from the other direction. */
      setError(dict.admin.commissionGlobalHasNoTarget);
      return;
    }

    create.mutate({
      scope: draft.scope,
      rateBp,
      categoryId: draft.scope === "CATEGORY" ? Number(draft.categoryId) : null,
      providerId: draft.scope === "PROVIDER" ? draft.providerId.trim() : null
    });
  };

  return (
    <Card className="p-5">
      <h2 className="font-semibold text-navy">{dict.admin.commissionNewTitle}</h2>
      <p className="mt-1 text-sm leading-6 text-secondary">{dict.admin.commissionNewText}</p>

      <form className="mt-5 grid gap-4 sm:grid-cols-2" onSubmit={submit}>
        <div>
          <Label htmlFor="commission-scope">{dict.admin.commissionScope}</Label>
          <select
            id="commission-scope"
            className={field}
            value={draft.scope}
            onChange={(event) => setDraft((state) => ({ ...state, scope: event.target.value as Draft["scope"] }))}
          >
            {SCOPES.map((scope) => (
              <option key={scope} value={scope}>
                {dict.admin.commissionScopes[scope]}
              </option>
            ))}
          </select>
        </div>

        <div>
          <Label htmlFor="commission-rate">{dict.admin.commissionRate}</Label>
          <input
            id="commission-rate"
            type="number"
            inputMode="decimal"
            step="0.01"
            min="0"
            max="100"
            className={field}
            value={draft.ratePercent}
            onChange={(event) => setDraft((state) => ({ ...state, ratePercent: event.target.value }))}
            placeholder="15"
            required
          />
          {rateBp !== null ? (
            <p className="mt-1.5 text-xs text-muted">{dict.admin.commissionBpPreview.replace("{bp}", formatNumber(rateBp, locale))}</p>
          ) : null}
        </div>

        {draft.scope === "CATEGORY" ? (
          <div>
            <Label htmlFor="commission-category">{dict.admin.commissionCategoryId}</Label>
            <input
              id="commission-category"
              type="number"
              inputMode="numeric"
              min="1"
              className={field}
              value={draft.categoryId}
              onChange={(event) => setDraft((state) => ({ ...state, categoryId: event.target.value }))}
              required
            />
          </div>
        ) : null}

        {draft.scope === "PROVIDER" ? (
          <div className="sm:col-span-2">
            <Label htmlFor="commission-provider">{dict.admin.commissionProviderId}</Label>
            <input
              id="commission-provider"
              type="text"
              className={`${field} font-mono text-xs`}
              value={draft.providerId}
              onChange={(event) => setDraft((state) => ({ ...state, providerId: event.target.value }))}
              placeholder="00000000-0000-4000-8000-000000000000"
              required
            />
          </div>
        ) : null}

        {error !== null ? (
          <p role="alert" className="text-sm leading-6 text-rose-700 sm:col-span-2">
            {error}
          </p>
        ) : null}

        <div className="sm:col-span-2">
          <Button type="submit" disabled={create.isPending}>
            {create.isPending ? (
              <Loader2 className="size-4 animate-spin" aria-hidden="true" />
            ) : (
              <Plus className="size-4" aria-hidden="true" />
            )}
            {create.isPending ? dict.admin.commissionSaving : dict.admin.commissionCreate}
          </Button>
        </div>
      </form>
    </Card>
  );
}

/* ---- the list --------------------------------------------------------- */

function RuleRow({
  rule,
  locale,
  dict,
  onEnd,
  ending
}: {
  rule: CommissionRule;
  locale: Locale;
  dict: Dictionary;
  onEnd: (rule: CommissionRule) => void;
  ending: boolean;
}) {
  const open = rule.effectiveTo === null;
  const target =
    rule.scope === "GLOBAL"
      ? dict.admin.commissionScopes.GLOBAL
      : rule.scope === "CATEGORY"
        ? `${dict.admin.commissionScopes.CATEGORY} #${rule.categoryId}`
        : `${dict.admin.commissionScopes.PROVIDER} ${rule.providerId?.slice(0, 8) ?? "—"}`;

  return (
    <li className={`rounded-[9px] border p-4 ${open ? "border-line bg-white" : "border-line bg-slate-50"}`}>
      <div className="flex flex-wrap items-start justify-between gap-3">
        <div className="min-w-0">
          <p className="flex flex-wrap items-center gap-2">
            <span className="text-lg font-semibold text-navy tabular-nums">{bpToPercent(rule.rateBp)}</span>
            <span
              className={`rounded-full px-2.5 py-0.5 text-[11px] font-semibold ${
                open ? "bg-emerald-50 text-emerald-700" : "bg-slate-100 text-muted"
              }`}
            >
              {open ? dict.admin.commissionOpen : dict.admin.commissionClosed}
            </span>
          </p>
          <p className="mt-1 text-sm text-secondary">{target}</p>
          <p className="mt-0.5 text-xs text-muted">
            {formatDate(rule.effectiveFrom, locale)} →{" "}
            {rule.effectiveTo === null ? dict.admin.commissionStillRunning : formatDate(rule.effectiveTo, locale)}
          </p>
        </div>

        {open ? (
          <Button type="button" variant="secondary" size="sm" disabled={ending} onClick={() => onEnd(rule)}>
            {ending ? (
              <Loader2 className="size-3.5 animate-spin" aria-hidden="true" />
            ) : (
              <X className="size-3.5" aria-hidden="true" />
            )}
            {dict.admin.commissionClose}
          </Button>
        ) : (
          <span className="text-xs text-muted">{dict.admin.commissionNoDelete}</span>
        )}
      </div>
    </li>
  );
}

export function CommissionRulesPanel({ locale, dict }: { locale: Locale; dict: Dictionary }) {
  const queryClient = useQueryClient();
  const rules = useCommissionRules(undefined, locale);
  const [confirmingId, setConfirmingId] = useState<string | null>(null);

  const end = useMutation({
    mutationFn: (id: string) => adminApi.endCommissionRule(id, { locale }),
    onSuccess: () => {
      for (const scope of SCOPES) void queryClient.invalidateQueries({ queryKey: adminKeys.commissionRules(scope) });
      void queryClient.invalidateQueries({ queryKey: adminKeys.all });
      toast.success(dict.admin.commissionClosed);
      setConfirmingId(null);
    },
    onError: (cause: Error) => toast.error(cause.message || dict.admin.commissionCloseFailed),
    retry: false
  });

  const items = rules.data?.items ?? [];
  const open = items.filter((rule) => rule.effectiveTo === null);
  const closed = items.filter((rule) => rule.effectiveTo !== null);

  return (
    <div className="mt-8 border-t border-line pt-8">
      <div className="flex flex-wrap items-center gap-2">
        <Percent className="size-5 text-muted" aria-hidden="true" />
        <h2 className="text-lg font-semibold text-navy">{dict.admin.commissionTitle}</h2>
      </div>
      <p className="mt-1 max-w-3xl text-sm leading-6 text-secondary">{dict.admin.commissionText}</p>

      <div className="mt-6 grid gap-6 lg:grid-cols-[minmax(0,1fr)_22rem]">
        <div>
          <Card className="p-5">
            <h3 className="font-semibold text-navy">{dict.admin.commissionOpenRules}</h3>
            {rules.isLoading ? (
              <p className="mt-3 text-sm text-muted" aria-busy="true">
                {dict.portal.financeLoading}
              </p>
            ) : rules.isError ? (
              <div role="alert" className="mt-3 rounded-[9px] border border-rose-200 bg-rose-50 p-4">
                <p className="text-sm leading-6 text-rose-800">
                  {rules.error instanceof Error ? rules.error.message : dict.finance.loadError}
                </p>
                <Button type="button" variant="secondary" size="sm" className="mt-3" onClick={() => void rules.refetch()}>
                  {dict.catalogue.retry}
                </Button>
              </div>
            ) : open.length === 0 ? (
              <p className="mt-3 text-sm leading-6 text-secondary">{dict.admin.commissionNoOpenRules}</p>
            ) : (
              <ul className="mt-3 space-y-3">
                {open.map((rule) => (
                  <RuleRow
                    key={rule.id}
                    rule={rule}
                    locale={locale}
                    dict={dict}
                    ending={confirmingId === rule.id}
                    onEnd={(target) => setConfirmingId(target.id)}
                  />
                ))}
              </ul>
            )}
          </Card>

          <Card className="mt-5 p-5">
            <h3 className="font-semibold text-navy">{dict.admin.commissionClosedRules}</h3>
            <p className="mt-1 text-xs leading-5 text-muted">{dict.admin.commissionHistoryNote}</p>
            {closed.length === 0 ? (
              <p className="mt-3 text-sm leading-6 text-secondary">{dict.admin.commissionNoClosedRules}</p>
            ) : (
              <ul className="mt-3 space-y-3">
                {closed.map((rule) => (
                  <RuleRow key={rule.id} rule={rule} locale={locale} dict={dict} onEnd={() => undefined} ending={false} />
                ))}
              </ul>
            )}
          </Card>
        </div>

        <div>
          <CommissionRuleForm locale={locale} dict={dict} />
        </div>
      </div>

      {/* Closing a rule is an audited decision about money, so it is confirmed by
          naming the rate rather than by a generic "are you sure". */}
      {confirmingId !== null ? (
        <div
          role="dialog"
          aria-modal="true"
          aria-labelledby="close-commission-heading"
          className="fixed inset-0 z-50 grid place-items-center bg-navy-950/40 p-6"
        >
          <Card className="w-full max-w-md p-6">
            <h3 id="close-commission-heading" className="font-semibold text-navy">
              {dict.admin.commissionCloseTitle}
            </h3>
            <p className="mt-2 text-sm leading-6 text-secondary">{dict.admin.commissionCloseText}</p>
            <div className="mt-6 flex gap-2">
              <Button
                type="button"
                disabled={end.isPending}
                onClick={() => {
                  end.mutate(confirmingId);
                }}
              >
                {end.isPending ? <Loader2 className="size-4 animate-spin" aria-hidden="true" /> : null}
                {dict.admin.commissionCloseConfirm}
              </Button>
              <Button type="button" variant="secondary" disabled={end.isPending} onClick={() => setConfirmingId(null)}>
                {dict.common.cancel}
              </Button>
            </div>
          </Card>
        </div>
      ) : null}
    </div>
  );
}