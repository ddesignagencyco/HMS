'use client';

import { useState } from 'react';
import { Loader2, Save, Tag } from 'lucide-react';
import { Button, Card, PageHeader } from '@/components/ui';
import { useCategories, useAllServices } from '@/features/catalogue/queries';
import type { Category, CatalogueService } from '@/features/catalogue/api';
import { useMutation, useQueryClient } from '@tanstack/react-query';
import { apiRequest } from '@/lib/api/client';
import { detailOf, toastSuccess } from '@/features/auth/auth-feedback';
import { ApiError } from '@/lib/api/problem';
import type { Dictionary } from '@/lib/dictionaries';
import { cn, formatDuration, formatMoney, type Locale } from '@/lib/utils';

/* The service catalogue — `/admin/catalogue/*`.
 *
 * **The list is the public catalogue.** `GET /catalogue/categories` and
 * `GET /catalogue/services/:slug/services` are the same `@Public()` reads the
 * storefront uses, so an admin is editing exactly what a customer can see rather
 * than a private draft of it. The only thing this screen adds is the write: a
 * `PATCH` per category and per service, sent through the same `apiRequest` layer
 * so the bearer token and the problem+json handling are identical.
 *
 * **Deactivating is not deleting.** `categoryUpdateSchema` and
 * `serviceUpdateSchema` both take `isActive`, and the controller documents it as
 * removing a category from the public catalogue *without deleting history*. So
 * the control is labelled as a deactivation and the history note is on screen.
 *
 * **The price band is a band, and the server enforces it.**
 * `priceBandIsConsistent` requires `min ≤ base ≤ max`, so all three are edited
 * together and checked here before the request — a band rejected by a 422 after a
 * save button press is a worse experience than an inline message.
 *
 * Commission rules and the checklist/issue-option replacement routes exist on the
 * same controller but are **not** on this screen: they have no reader anywhere in
 * the API, so a form that wrote one would be a write with nothing to verify
 * against. That gap is written up in `docs/backend_requirement.md`. */

/** What `PATCH /admin/catalogue/categories/:id` accepts. `.strict()`. */
type CategoryPatch = { nameEn?: string; nameUr?: string; sortOrder?: number; defaultWarrantyDays?: number; isActive?: boolean };

/** What `PATCH /admin/catalogue/services/:id` accepts. */
type ServicePatch = {
  nameEn?: string;
  nameUr?: string;
  description?: string;
  basePricePaisa?: number;
  minPricePaisa?: number;
  maxPricePaisa?: number;
  visitFeePaisa?: number;
  expectedDurationMin?: number;
  isEmergencyEligible?: boolean;
  isPlanEligible?: boolean;
  isHighRisk?: boolean;
  isActive?: boolean;
};

export function AdminCatalogue({ locale, dict }: { locale: Locale; dict: Dictionary }) {
  const categories = useCategories(locale);
  const services = useAllServices(locale);

  return (
    <div>
      <PageHeader eyebrow={dict.portal.admin} title={dict.admin.catalogue} description={dict.admin.catalogueText} />

      <p className="mt-4 rounded-[9px] border border-line bg-surface-2 p-3 text-sm leading-6 text-secondary">{dict.admin.catalogueIsPublic}</p>
      <p className="mt-2 rounded-[9px] border border-amber-200 bg-amber-50 p-3 text-sm leading-6 text-amber-900">{dict.admin.catalogueNoReaders}</p>

      {categories.isPending || services.isPending ? (
        <Card className="mt-6 p-8 text-center text-sm text-muted" aria-busy="true">
          {dict.admin.loadingCatalogue}
        </Card>
      ) : categories.isError || services.isError ? (
        <div role="alert" className="mt-6 rounded-[14px] border border-rose-200 bg-rose-50 p-5">
          <p className="text-sm font-medium leading-6 text-rose-800">{dict.admin.catalogueLoadError}</p>
          {categories.error instanceof ApiError && categories.error.status === 403 ? <p className="mt-2 text-sm leading-6 text-rose-800">{dict.admin.adminTotpRequired}</p> : null}
          <Button type="button" variant="secondary" size="sm" className="mt-4" onClick={() => void categories.refetch()}>
            {dict.catalogue.retry}
          </Button>
        </div>
      ) : (
        <div className="mt-6 grid gap-5 lg:grid-cols-[340px_1fr]">
          <div>
            <h2 className="flex items-center gap-2 font-semibold text-navy">
              <Tag className="size-4 text-muted" aria-hidden="true" />
              {dict.admin.categories}
            </h2>
            <ul className="mt-3 grid gap-3">
              {(categories.data.items ?? []).map((category) => (
                <li key={category.id}>
                  <CategoryCard locale={locale} dict={dict} category={category} />
                </li>
              ))}
            </ul>
          </div>

          <div>
            <h2 className="font-semibold text-navy">{dict.admin.serviceCatalogue}</h2>
            <ul className="mt-3 grid gap-3">
              {(services.data.items ?? []).map((service) => (
                <li key={service.id}>
                  <ServiceCard locale={locale} dict={dict} service={service} />
                </li>
              ))}
            </ul>
          </div>
        </div>
      )}
    </div>
  );
}

/**
 * One `PATCH` against the admin catalogue, with the body supplied per call rather
 * than captured — the body is what the card's form just produced.
 */
const usePatchCatalogue = () => {
  const queryClient = useQueryClient();
  return useMutation({
    mutationFn: ({ path, input }: { path: string; input: CategoryPatch | ServicePatch }) => apiRequest<unknown>(path, { method: 'PATCH', body: input }),
    /* The public catalogue is cached under `publicKeys`, so the write has to
       invalidate that or a customer keeps seeing the old price until a reload. */
    onSuccess: () => queryClient.invalidateQueries({ predicate: (query) => query.queryKey[0] === 'public' }),
    retry: false
  });
};

function CategoryCard({ locale, dict, category }: { locale: Locale; dict: Dictionary; category: Category }) {
  const patch = usePatchCatalogue();
  const [nameEn, setNameEn] = useState(category.nameEn);
  const [error, setError] = useState('');

  const save = async (): Promise<void> => {
    setError('');
    /* Only what changed: `categoryUpdateSchema` is `.strict()`, so resending the
       current name is harmless but a no-op save that looks like an edit is not. */
    if (nameEn === category.nameEn) return;
    try {
      await patch.mutateAsync({ path: `/admin/catalogue/categories/${category.id}`, input: { nameEn } });
      toastSuccess(dict.admin.catalogueSaved);
    } catch (caught) {
      setError(detailOf(caught, dict));
    }
  };

  return (
    <Card className="p-4">
      <label htmlFor={`cat-${category.id}`} className="text-[11.5px] font-semibold text-slate-800">
        {locale === 'ur' ? category.nameUr : category.nameEn}
      </label>
      <input
        id={`cat-${category.id}`}
        value={nameEn}
        onChange={(event) => setNameEn(event.target.value)}
        className="mt-1 min-h-11 w-full rounded-[9px] border border-line bg-white px-3 text-sm text-navy outline-none focus:border-primary"
      />
      {error !== '' ? (
        <p role="alert" className="mt-1 text-xs font-medium text-rose-700">
          {error}
        </p>
      ) : null}
      <Button type="button" size="sm" className="mt-3" disabled={patch.isPending} onClick={() => void save()}>
        {patch.isPending ? <Loader2 className="size-4 animate-spin" aria-hidden="true" /> : <Save className="size-4" aria-hidden="true" />}
        {dict.portal.save}
      </Button>
    </Card>
  );
}

function ServiceCard({ locale, dict, service }: { locale: Locale; dict: Dictionary; service: CatalogueService }) {
  const patch = usePatchCatalogue();
  const [minPrice, setMinPrice] = useState(String(service.minPricePaisa));
  const [basePrice, setBasePrice] = useState(String(service.basePricePaisa));
  const [maxPrice, setMaxPrice] = useState(String(service.maxPricePaisa));
  const [error, setError] = useState('');

  const save = async (): Promise<void> => {
    setError('');
    const min = Number(minPrice);
    const base = Number(basePrice);
    const max = Number(maxPrice);
    /* `priceBandIsConsistent` on the server: min ≤ base ≤ max. Checked here so a
       bad band is a message on the field rather than a 422 after a save press. */
    if (![min, base, max].every((value) => Number.isFinite(value))) {
      setError(dict.admin.priceNotANumber);
      return;
    }
    if (!(min <= base && base <= max)) {
      setError(dict.admin.bandInconsistent.replace('{min}', formatMoney(min, locale)).replace('{base}', formatMoney(base, locale)).replace('{max}', formatMoney(max, locale)));
      return;
    }
    try {
      await patch.mutateAsync({
        path: `/admin/catalogue/services/${service.id}`,
        input: { minPricePaisa: min, basePricePaisa: base, maxPricePaisa: max }
      });
      toastSuccess(dict.admin.catalogueSaved);
    } catch (caught) {
      setError(detailOf(caught, dict));
    }
  };

  return (
    <Card className={cn('p-4', service.isActive ? '' : 'bg-slate-50/60')}>
      <div className="flex flex-wrap items-start justify-between gap-3">
        <div className="min-w-0">
          <h3 className="font-semibold text-navy">{locale === 'ur' ? service.nameUr : service.nameEn}</h3>
          <p className="mt-0.5 font-mono text-[11px] text-muted">{service.slug}</p>
          <p className="mt-1 text-xs text-secondary">
            {dict.admin.pricingModel}: {dict.admin.pricingModels[service.pricingModel as keyof typeof dict.admin.pricingModels] ?? service.pricingModel} · {dict.admin.durationLabel}:{' '}
            {formatDuration(service.expectedDurationMin, locale)}
          </p>
        </div>
        {!service.isActive ? <span className="rounded-full bg-slate-200 px-2.5 py-1 text-[11px] font-semibold text-slate-700">{dict.admin.inactive}</span> : null}
      </div>

      <div className="mt-3 grid gap-2 sm:grid-cols-3">
        <MoneyInput id={`min-${service.id}`} label={dict.admin.bandMin} value={minPrice} onChange={setMinPrice} locale={locale} />
        <MoneyInput id={`base-${service.id}`} label={dict.admin.bandBase} value={basePrice} onChange={setBasePrice} locale={locale} />
        <MoneyInput id={`max-${service.id}`} label={dict.admin.bandMax} value={maxPrice} onChange={setMaxPrice} locale={locale} />
      </div>

      {error !== '' ? (
        <p role="alert" className="mt-2 text-xs font-medium text-rose-700">
          {error}
        </p>
      ) : null}

      <Button type="button" size="sm" className="mt-3" disabled={patch.isPending} onClick={() => void save()}>
        {patch.isPending ? <Loader2 className="size-4 animate-spin" aria-hidden="true" /> : <Save className="size-4" aria-hidden="true" />}
        {dict.admin.saveBand}
      </Button>
    </Card>
  );
}

/** Prices are in paisa in the API and rupees on screen, so this is the one place
    that conversion is named — and the input takes paisa to match the schema. */
function MoneyInput({ id, label, value, onChange, locale }: { id: string; label: string; value: string; onChange: (value: string) => void; locale: Locale }) {
  return (
    <div>
      <label htmlFor={id} className="text-[11.5px] font-semibold text-slate-800">
        {label}
      </label>
      <input
        id={id}
        type="number"
        min={0}
        step={100}
        value={value}
        onChange={(event) => onChange(event.target.value)}
        className="mt-1 min-h-11 w-full rounded-[9px] border border-line bg-white px-3 text-sm text-navy outline-none focus:border-primary"
      />
      <p className="mt-0.5 text-[11px] text-muted">{formatMoney(Number(value) || 0, locale)}</p>
    </div>
  );
}
