'use client';

/* Admin plan management — `/admin/plans/*`, all `roles: ['ADMIN'],
 * totpRequired: true`.
 *
 * This screen previously rendered a dashed card saying "maintenance
 * plans are not available yet", which was true when it was written: four
 * tables existed that no route touched. SHM-089 added
 * `PlansAdminController`, so the five routes are now consumed for real.
 *
 * **Create writes the whole plan; update patches four fields.**
 * `planCreateSchema` requires `nameEn`, `nameUr`, `description`,
 * `pricePaisa`, `durationMonths` and a non-empty `services` array.
 * `planUpdateSchema` accepts any subset of those *except* `services` —
 * there is no route to change a plan's service list after creation. So
 * the editor has two modes and the difference is stated on screen: the
 * create form collects services, the edit form does not offer a control
 * that could not save.
 *
 * **Price is entered and displayed in paisa.** `basePricePaisa` and
 * friends are paisa everywhere in this API and `pricePaisa` is no
 * exception — the schema is `z.number().int().positive()`, so a decimal
 * is a 422. The field therefore takes paisa and the hint shows the
 * rupee equivalent as a reading aid only; the number sent is the number
 * typed. Converting in the browser and storing rupees would put a
 * rounding step between the customer and the ledger.
 *
 * **`DELETE` is a deactivation.** `adminDeactivatePlan` runs
 * `UPDATE plans SET is_active = false`. Nothing is deleted, no
 * subscription is cancelled, and no refund is issued, so the control
 * says "deactivate" and the confirmation says exactly what it does and
 * does not do. Republishing is a `PATCH` with `isActive: true` — the
 * route is a soft toggle in both directions, never a delete.
 *
 * **The active-subscription count is the server's.** It arrives as
 * `COUNT(*) FILTER (WHERE status = 'ACTIVE')` on the admin list, and is
 * shown as returned rather than recomputed from a page of rows. */

import { useState } from 'react';
import { useQueryClient } from '@tanstack/react-query';
import { Loader2, Pencil, Plus, Trash2 } from 'lucide-react';
import { Badge, Button, Card, PageHeader } from '@/components/ui';
import { useAllServices } from '@/features/catalogue/queries';
import type { CatalogueService } from '@/features/catalogue/api';
import { adminKeys } from '@/lib/api/keys';
import { detailOf, toastError, toastSuccess } from '@/features/auth/auth-feedback';
import type { Dictionary } from '@/lib/dictionaries';
import { formatMoney, formatNumber, type Locale } from '@/lib/utils';
import { useAdminPlans, useCreatePlan, useDeactivatePlan, useUpdatePlan } from '@/features/plans/queries';
import type { AdminPlan, CreatePlanInput } from '@/features/plans/api';

/** One row of the create form's service editor. */
/** `rowKey` is stable for the life of the row and is what React keys on.
 *
 *  These rows are keyed by array index and are removed from the middle of the
 *  list. React reuses the DOM node of row 2 for row 3, and because all three
 *  controls are controlled, the caret and the typed value jump to the wrong
 *  service. It also made every row's three fields answer to the same accessible
 *  name — "Service", "Visits", "Interval days" — with nothing distinguishing one
 *  row from the next, so a screen-reader user could not tell which service a
 *  field belonged to. */
type ServiceDraft = { rowKey: string; serviceId: string; visitsIncluded: string; intervalDays: string };

let nextRowKey = 0;
const newRowKey = (): string => {
  nextRowKey += 1;
  return `plan-service-${nextRowKey}`;
};

const emptyDraft = (firstServiceId: string): ServiceDraft => ({ rowKey: newRowKey(), serviceId: firstServiceId, visitsIncluded: '2', intervalDays: '180' });

/* The form's own state. Kept as strings because an `<input type=number>`
 * holds text, and coercing mid-keystroke is how "1." becomes 1 and the
 * caret jumps. The conversion to a number happens once, on submit. */
type FormState = {
  nameEn: string;
  nameUr: string;
  description: string;
  pricePaisa: string;
  durationMonths: string;
  services: ServiceDraft[];
};

const toForm = (plan: AdminPlan): FormState => ({
  nameEn: plan.nameEn,
  nameUr: plan.nameUr,
  description: plan.description,
  pricePaisa: String(plan.pricePaisa),
  durationMonths: String(plan.durationMonths),
  services: []
});

const blank = (firstServiceId: string): FormState => ({
  nameEn: '',
  nameUr: '',
  description: '',
  pricePaisa: '',
  durationMonths: '12',
  services: [emptyDraft(firstServiceId)]
});

/** One shared input style, so the create and edit forms cannot drift apart. */
const fieldClass = 'mt-1.5 w-full rounded-[9px] border border-line bg-white px-3 py-2.5 text-sm text-navy';

/* ---------------------------------------------------------------- create */

function CreateForm({ services, dict, onDone }: { services: CatalogueService[]; dict: Dictionary; onDone: () => void }) {
  const create = useCreatePlan();
  const [state, setState] = useState<FormState>(() => blank(String(services[0]?.id ?? '')));

  /* Only plan-eligible services are offered. `adminCreatePlan` verifies
   * `is_active = true` on the server, but it does not require plan
   * eligibility, so the picker narrows to the services the catalogue
   * itself flags as plan-eligible rather than letting an admin attach a
   * service that can never be plan-delivered. */
  const eligible = services.filter((service) => service.isPlanEligible);
  const pool = eligible.length > 0 ? eligible : services;

  const patch = (next: Partial<FormState>) => setState((current) => ({ ...current, ...next }));
  const patchService = (rowKey: string, next: Partial<ServiceDraft>) =>
    setState((current) => ({ ...current, services: current.services.map((row) => (row.rowKey === rowKey ? { ...row, ...next } : row)) }));

  const price = Number(state.pricePaisa);
  const months = Number(state.durationMonths);
  const rows = state.services
    .map((row) => ({ serviceId: Number(row.serviceId), visitsIncluded: Number(row.visitsIncluded), intervalDays: Number(row.intervalDays) }))
    .filter(
      (row) => Number.isInteger(row.serviceId) && row.serviceId > 0 && Number.isInteger(row.visitsIncluded) && row.visitsIncluded > 0 && Number.isInteger(row.intervalDays) && row.intervalDays > 0
    );

  /* The same rules the Zod schema enforces, checked here so a 422 is not
   * the first thing an admin learns about their own form. */
  const complete =
    state.nameEn.trim() !== '' &&
    state.nameUr.trim() !== '' &&
    state.description.trim() !== '' &&
    Number.isInteger(price) &&
    price > 0 &&
    Number.isInteger(months) &&
    months > 0 &&
    rows.length === state.services.length;

  const submit = () => {
    if (!complete) return;
    const input: CreatePlanInput = {
      nameEn: state.nameEn.trim(),
      nameUr: state.nameUr.trim(),
      description: state.description.trim(),
      pricePaisa: price,
      durationMonths: months,
      services: rows
    };
    create.mutate(input, {
      onSuccess: () => {
        toastSuccess(dict.admin.plansCreated);
        onDone();
      },
      onError: (error) => toastError(detailOf(error, dict))
    });
  };

  return (
    <Card className="mt-4 p-5">
      <h2 className="font-semibold text-navy">{dict.admin.plansCreateTitle}</h2>

      <div className="mt-4 grid gap-4 sm:grid-cols-2">
        <div>
          <label className="text-xs font-medium text-secondary" htmlFor="np-name-en">
            {dict.admin.plansNameEn}
          </label>
          <input id="np-name-en" value={state.nameEn} onChange={(e) => patch({ nameEn: e.target.value })} className={fieldClass} />
        </div>
        <div>
          <label className="text-xs font-medium text-secondary" htmlFor="np-name-ur">
            {dict.admin.plansNameUr}
          </label>
          <input id="np-name-ur" value={state.nameUr} onChange={(e) => patch({ nameUr: e.target.value })} className={fieldClass} dir="rtl" />
        </div>
        <div className="sm:col-span-2">
          <label className="text-xs font-medium text-secondary" htmlFor="np-desc">
            {dict.admin.plansDescription}
          </label>
          <textarea id="np-desc" rows={3} value={state.description} onChange={(e) => patch({ description: e.target.value })} className={fieldClass} />
        </div>
        <div>
          <label className="text-xs font-medium text-secondary" htmlFor="np-price">
            {dict.admin.plansPricePaisa}
          </label>
          <input id="np-price" inputMode="numeric" value={state.pricePaisa} onChange={(e) => patch({ pricePaisa: e.target.value })} className={fieldClass} />
          <p className="mt-1 text-xs text-muted">{dict.admin.plansPriceHint}</p>
        </div>
        <div>
          <label className="text-xs font-medium text-secondary" htmlFor="np-months">
            {dict.admin.plansDurationMonths}
          </label>
          <input id="np-months" inputMode="numeric" value={state.durationMonths} onChange={(e) => patch({ durationMonths: e.target.value })} className={fieldClass} />
        </div>
      </div>

      <h3 className="mt-6 text-sm font-semibold text-navy">{dict.admin.plansServices}</h3>
      <div className="mt-2 grid gap-2">
        {state.services.map((row) => (
          <div key={row.rowKey} className="grid gap-2 sm:grid-cols-[minmax(0,1fr)_7rem_9rem_auto]">
            {/* The row number is folded into each control's name so the three
                fields of one service are distinguishable from the next row's. */}
            <select
              value={row.serviceId}
              onChange={(e) => patchService(row.rowKey, { serviceId: e.target.value })}
              className={fieldClass}
              aria-label={`${dict.admin.plansService} ${state.services.indexOf(row) + 1}`}
            >
              <option value="">{dict.admin.plansService}</option>
              {pool.map((service) => (
                <option key={service.id} value={service.id}>
                  {service.nameEn}
                </option>
              ))}
            </select>
            <input
              inputMode="numeric"
              value={row.visitsIncluded}
              onChange={(e) => patchService(row.rowKey, { visitsIncluded: e.target.value })}
              className={fieldClass}
              aria-label={`${dict.admin.plansVisits} ${state.services.indexOf(row) + 1}`}
              placeholder={dict.admin.plansVisits}
            />
            <input
              inputMode="numeric"
              value={row.intervalDays}
              onChange={(e) => patchService(row.rowKey, { intervalDays: e.target.value })}
              className={fieldClass}
              aria-label={`${dict.admin.plansIntervalDays} ${state.services.indexOf(row) + 1}`}
              placeholder={dict.admin.plansIntervalDays}
            />
            <Button
              variant="secondary"
              size="sm"
              disabled={state.services.length === 1}
              aria-label={`${dict.admin.plansRemoveService} ${state.services.indexOf(row) + 1}`}
              onClick={() => setState((c) => ({ ...c, services: c.services.filter((candidate) => candidate.rowKey !== row.rowKey) }))}
            >
              {dict.admin.plansRemoveService}
            </Button>
          </div>
        ))}
      </div>
      <Button variant="secondary" size="sm" className="mt-3" onClick={() => setState((c) => ({ ...c, services: [...c.services, emptyDraft(String(pool[0]?.id ?? ''))] }))}>
        <Plus className="size-4" aria-hidden="true" />
        {dict.admin.plansAddService}
      </Button>
      {state.services.length === 0 ? <p className="mt-2 text-xs text-amber-800">{dict.admin.plansNoServices}</p> : null}

      <div className="mt-5 flex gap-2">
        <Button disabled={!complete || create.isPending} onClick={submit}>
          {create.isPending ? <Loader2 className="size-4 animate-spin" aria-hidden="true" /> : null}
          {create.isPending ? dict.admin.plansCreating : dict.admin.plansCreateAction}
        </Button>
        <Button variant="secondary" onClick={onDone}>
          {dict.common.cancel}
        </Button>
      </div>
    </Card>
  );
}

/* ------------------------------------------------------------------ edit */

function EditForm({ plan, dict, onDone }: { plan: AdminPlan; dict: Dictionary; onDone: () => void }) {
  const update = useUpdatePlan();
  const [state, setState] = useState<FormState>(() => toForm(plan));

  const price = Number(state.pricePaisa);
  const months = Number(state.durationMonths);
  const valid = state.nameEn.trim() !== '' && state.nameUr.trim() !== '' && state.description.trim() !== '' && Number.isInteger(price) && price > 0 && Number.isInteger(months) && months > 0;

  const submit = () => {
    if (!valid) return;
    /* Only the four fields the patch schema accepts are sent. `services`
     * is not among them, which is why this form has no service rows. */
    update.mutate(
      { planId: plan.id, input: { nameEn: state.nameEn.trim(), nameUr: state.nameUr.trim(), description: state.description.trim(), pricePaisa: price, durationMonths: months } },
      {
        onSuccess: () => {
          toastSuccess(dict.admin.plansSaved);
          onDone();
        },
        onError: (error) => toastError(detailOf(error, dict))
      }
    );
  };

  return (
    <Card className="mt-4 p-5">
      <h2 className="font-semibold text-navy">{dict.admin.plansEditTitle}</h2>
      <div className="mt-4 grid gap-4 sm:grid-cols-2">
        <div>
          <label className="text-xs font-medium text-secondary" htmlFor={`ep-name-en-${plan.id}`}>
            {dict.admin.plansNameEn}
          </label>
          <input id={`ep-name-en-${plan.id}`} value={state.nameEn} onChange={(e) => setState((c) => ({ ...c, nameEn: e.target.value }))} className={fieldClass} />
        </div>
        <div>
          <label className="text-xs font-medium text-secondary" htmlFor={`ep-name-ur-${plan.id}`}>
            {dict.admin.plansNameUr}
          </label>
          <input id={`ep-name-ur-${plan.id}`} value={state.nameUr} onChange={(e) => setState((c) => ({ ...c, nameUr: e.target.value }))} className={fieldClass} dir="rtl" />
        </div>
        <div className="sm:col-span-2">
          <label className="text-xs font-medium text-secondary" htmlFor={`ep-desc-${plan.id}`}>
            {dict.admin.plansDescription}
          </label>
          <textarea id={`ep-desc-${plan.id}`} rows={3} value={state.description} onChange={(e) => setState((c) => ({ ...c, description: e.target.value }))} className={fieldClass} />
        </div>
        <div>
          <label className="text-xs font-medium text-secondary" htmlFor={`ep-price-${plan.id}`}>
            {dict.admin.plansPricePaisa}
          </label>
          <input id={`ep-price-${plan.id}`} inputMode="numeric" value={state.pricePaisa} onChange={(e) => setState((c) => ({ ...c, pricePaisa: e.target.value }))} className={fieldClass} />
        </div>
        <div>
          <label className="text-xs font-medium text-secondary" htmlFor={`ep-months-${plan.id}`}>
            {dict.admin.plansDurationMonths}
          </label>
          <input id={`ep-months-${plan.id}`} inputMode="numeric" value={state.durationMonths} onChange={(e) => setState((c) => ({ ...c, durationMonths: e.target.value }))} className={fieldClass} />
        </div>
      </div>

      <p className="mt-4 rounded-[9px] border border-amber-200 bg-amber-50 p-3 text-sm leading-6 text-amber-900">{dict.admin.plansServicesFixed}</p>

      <div className="mt-5 flex gap-2">
        <Button disabled={!valid || update.isPending} onClick={submit}>
          {update.isPending ? <Loader2 className="size-4 animate-spin" aria-hidden="true" /> : null}
          {update.isPending ? dict.admin.plansSaving : dict.admin.plansSave}
        </Button>
        <Button variant="secondary" onClick={onDone}>
          {dict.common.cancel}
        </Button>
      </div>
    </Card>
  );
}

/* ------------------------------------------------------------------ page */

export function AdminPlans({ locale, dict }: { locale: Locale; dict: Dictionary }) {
  const plans = useAdminPlans(locale);
  const services = useAllServices(locale);
  const client = useQueryClient();

  const [creating, setCreating] = useState(false);
  const [editing, setEditing] = useState<string | null>(null);
  const [confirming, setConfirming] = useState<string | null>(null);

  /* Republishing is a `PATCH` with `isActive: true` — the same route the
   * edit form uses, and the same invalidation, so it reuses `useUpdatePlan`
   * rather than growing a second mutation that differs only in one field. */
  const republishMutation = useUpdatePlan();
  const deactivate = useDeactivatePlan();

  const items = plans.data?.items ?? [];

  const run = (planId: string) => {
    deactivate.mutate(planId, {
      onSuccess: () => {
        setConfirming(null);
        toastSuccess(dict.admin.plansDeactivated);
      },
      onError: (error) => toastError(detailOf(error, dict))
    });
  };

  const republish = (planId: string) => {
    republishMutation.mutate(
      { planId, input: { isActive: true } },
      {
        onSuccess: () => toastSuccess(dict.admin.plansRepublished),
        onError: (error) => toastError(detailOf(error, dict))
      }
    );
  };

  return (
    <div>
      <PageHeader eyebrow={dict.portal.admin} title={dict.portal.plans} description={dict.admin.plansText} />

      <div className="mt-4 flex flex-wrap gap-2">
        <Button
          size="sm"
          onClick={() => {
            setCreating((value) => !value);
            setEditing(null);
          }}
          disabled={services.isPending}
        >
          <Plus className="size-4" aria-hidden="true" />
          {dict.admin.plansCreate}
        </Button>
      </div>

      {creating && !services.isError ? (
        <CreateForm
          services={services.data?.items ?? []}
          dict={dict}
          onDone={() => {
            setCreating(false);
            void client.invalidateQueries({ queryKey: adminKeys.plans });
          }}
        />
      ) : null}

      {plans.isPending ? (
        <Card className="mt-6 p-8 text-center text-sm text-muted" aria-busy="true">
          {dict.admin.plansLoading}
        </Card>
      ) : plans.isError ? (
        /* A 403 here is `totpRequired` failing, never "there are no
           plans" — see the note in `features/admin/api.ts`. */
        <div role="alert" className="mt-6 rounded-[14px] border border-rose-200 bg-rose-50 p-5">
          <p className="text-sm font-medium leading-6 text-rose-800">{dict.admin.plansLoadError}</p>
        </div>
      ) : items.length === 0 ? (
        <Card className="mt-6 border-dashed p-8 text-center">
          <p className="text-sm leading-6 text-secondary">{dict.admin.plansEmpty}</p>
        </Card>
      ) : (
        <div className="mt-6 grid gap-4">
          {items.map((plan) => (
            <Card key={plan.id} className="p-5">
              <div className="flex flex-wrap items-start justify-between gap-3">
                <div>
                  <h2 className="font-semibold text-navy">{locale === 'ur' ? plan.nameUr || plan.nameEn : plan.nameEn || plan.nameUr}</h2>
                  <p className="mt-1 text-sm text-secondary">{plan.description}</p>
                </div>
                {plan.isActive ? (
                  <Badge className="bg-emerald-50 text-emerald-700">{dict.admin.plansPublished}</Badge>
                ) : (
                  <Badge className="bg-amber-50 text-amber-800">{dict.admin.plansInactive}</Badge>
                )}
              </div>

              <dl className="mt-4 flex flex-wrap gap-x-6 gap-y-1.5 text-sm">
                <div className="flex gap-1.5">
                  <dt className="text-muted">{dict.admin.plansPricePaisa}</dt>
                  <dd className="font-medium text-navy tabular-nums">{formatMoney(plan.pricePaisa, locale)}</dd>
                </div>
                <div className="flex gap-1.5">
                  <dt className="text-muted">{dict.admin.plansDurationMonths}</dt>
                  <dd className="font-medium text-navy tabular-nums">{formatNumber(plan.durationMonths, locale)}</dd>
                </div>
                <div className="flex gap-1.5">
                  <dt className="text-muted">{dict.admin.plansActiveSubs}</dt>
                  {/* The server's `COUNT(*) FILTER (WHERE status =
                      'ACTIVE')`, not a count of this page. */}
                  <dd className="font-medium text-navy tabular-nums">{formatNumber(plan.activeSubscriptionsCount, locale)}</dd>
                </div>
              </dl>

              {plan.services.length > 0 ? (
                <ul className="mt-3 flex flex-wrap gap-2">
                  {plan.services.map((service) => (
                    <li key={service.serviceId}>
                      <Badge>
                        {service.serviceNameEn} · {formatNumber(service.visitsIncluded, locale)} × {formatNumber(service.intervalDays, locale)}d
                      </Badge>
                    </li>
                  ))}
                </ul>
              ) : null}

              <div className="mt-4 flex flex-wrap gap-2">
                <Button
                  variant="secondary"
                  size="sm"
                  onClick={() => {
                    setEditing((current) => (current === plan.id ? null : plan.id));
                    setCreating(false);
                  }}
                >
                  <Pencil className="size-4" aria-hidden="true" />
                  {dict.admin.plansEditAction}
                </Button>
                {plan.isActive ? (
                  <Button variant="secondary" size="sm" onClick={() => setConfirming((current) => (current === plan.id ? null : plan.id))}>
                    <Trash2 className="size-4" aria-hidden="true" />
                    {dict.admin.plansDeactivate}
                  </Button>
                ) : (
                  <Button variant="secondary" size="sm" disabled={republishMutation.isPending} onClick={() => republish(plan.id)}>
                    {dict.admin.plansReactivate}
                  </Button>
                )}
              </div>

              {editing === plan.id ? <EditForm plan={plan} dict={dict} onDone={() => setEditing(null)} /> : null}

              {confirming === plan.id ? (
                <div className="mt-4 rounded-[12px] border border-amber-200 bg-amber-50 p-4">
                  <p className="text-sm font-semibold text-amber-900">{dict.admin.plansDeactivateConfirm}</p>
                  <p className="mt-1.5 text-sm leading-6 text-amber-900">{dict.admin.plansDeactivateExplain}</p>
                  <div className="mt-4 flex gap-2">
                    <Button size="sm" disabled={deactivate.isPending} onClick={() => run(plan.id)}>
                      {deactivate.isPending ? <Loader2 className="size-4 animate-spin" aria-hidden="true" /> : null}
                      {dict.admin.plansDeactivate}
                    </Button>
                    <Button size="sm" variant="secondary" onClick={() => setConfirming(null)}>
                      {dict.common.cancel}
                    </Button>
                  </div>
                </div>
              ) : null}
            </Card>
          ))}
        </div>
      )}
    </div>
  );
}
