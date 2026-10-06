'use client';

import { CheckCircle2, Clock3, Pencil, Plus, ShieldCheck, XCircle } from 'lucide-react';
import { useMemo, useState } from 'react';
import { Button, Card, Input, Label, PageHeader } from '@/components/ui';
import { SelectField } from '@/components/select-field';
import { useAllServices } from '@/features/catalogue/queries';
import type { CatalogueServiceWithCategory } from '@/features/catalogue/api';
import { useProviderServices, useRemoveProviderService, useSetServicePrice } from '@/features/provider/queries';
import type { ProviderService, ProviderServiceApproval } from '@/features/provider/api';
import type { Dictionary } from '@/lib/dictionaries';
import { cn, formatDuration, formatMoney, formatNumber, type Locale } from '@/lib/utils';

/* The services a professional offers, and what they charge for each.

   `GET /provider/services` returns the bindings this provider has created —
   `serviceId, serviceSlug, serviceNameEn, pricePaisa, status` — and deliberately
   **not** the price band, the duration or the Urdu service name. Those live on
   the catalogue, so this screen joins `serviceId` against
   `catalogueApi.listAllServices()` (the same fan-out `/services` uses) for the
   band and the display name.

   The band matters: `upsertMine` refuses a price outside
   `[minPricePaisa, maxPricePaisa]` with a 400, so the input is constrained to it
   and the server is the final word regardless. Never widen the input past the
   band to be permissive — the API will not accept it.

   Every row here is a *binding the provider created*. The catalogue itself is
   chosen elsewhere (admin approval of each offer); this screen is only "what am
   I offering, and at what price". */

const APPROVAL_TONE: Record<ProviderServiceApproval, string> = {
  APPROVED: 'bg-emerald-50 text-emerald-700',
  PENDING: 'bg-amber-50 text-amber-700',
  REJECTED: 'bg-rose-50 text-rose-700'
};

export function ProviderServicesScreen({ locale, dict }: { locale: Locale; dict: Dictionary }) {
  const offered = useProviderServices(locale);
  const catalogue = useAllServices(locale);
  const setPrice = useSetServicePrice(locale);
  const remove = useRemoveProviderService(locale);

  const [editingId, setEditingId] = useState<number | null>(null);
  const [draftPrice, setDraftPrice] = useState<string>('');
  const [adding, setAdding] = useState(false);
  const [addingId, setAddingId] = useState<number | null>(null);
  const [localError, setLocalError] = useState('');

  /* serviceId → catalogue row, for the band, the Urdu name and the duration. */
  const byId = useMemo(() => {
    const map = new Map<number, CatalogueServiceWithCategory>();
    for (const service of catalogue.data?.items ?? []) map.set(service.id, service);
    return map;
  }, [catalogue.data]);

  const save = async (serviceId: number): Promise<void> => {
    setLocalError('');
    const paisa = Math.round(Number(draftPrice) * 100);
    if (!Number.isFinite(paisa) || paisa < 0) {
      setLocalError(dict.portal.priceInvalid);
      return;
    }
    try {
      await setPrice.mutateAsync({ serviceId, pricePaisa: paisa });
      setEditingId(null);
    } catch (error) {
      setLocalError(error instanceof Error ? error.message : dict.portal.priceSaveFailed);
    }
  };

  const stopOffering = async (service: ProviderService): Promise<void> => {
    setLocalError('');
    try {
      await remove.mutateAsync(service.serviceId);
    } catch (error) {
      setLocalError(error instanceof Error ? error.message : dict.portal.removeFailed);
    }
  };

  if (offered.isPending || catalogue.isPending) {
    return (
      <div aria-busy="true" aria-live="polite" className="grid gap-3">
        <span className="skeleton h-8 w-56 rounded-[9px]" />
        <span className="skeleton h-40 w-full rounded-[12px]" />
      </div>
    );
  }

  if (offered.isError) {
    return (
      <div>
        <PageHeader eyebrow={dict.portal.provider} title={dict.portal.services} />
        <div role="alert" className="mt-6 rounded-[14px] border border-rose-200 bg-rose-50 p-5">
          <p className="text-sm font-medium leading-6 text-rose-800">{dict.portal.servicesLoadError}</p>
          <Button type="button" variant="secondary" size="sm" className="mt-4" onClick={() => void offered.refetch()}>
            {dict.catalogue.retry}
          </Button>
        </div>
      </div>
    );
  }

  const bindings = offered.data.items;

  return (
    <div>
      <PageHeader
        eyebrow={dict.portal.provider}
        title={dict.portal.services}
        description={dict.portal.providerServicesDescription}
        action={
          <Button type="button" size="sm" onClick={() => setAdding((v) => !v)}>
            <Plus className="size-4" aria-hidden="true" />
            {dict.portal.addService}
          </Button>
        }
      />

      {adding ? (
        <Card className="mt-6 p-5">
          <Label htmlFor="add-service">{dict.portal.addService}</Label>
          <div className="mt-2 flex flex-wrap items-center gap-3">
            <SelectField
              id="add-service"
              value={addingId === null ? '' : String(addingId)}
              onChange={(value) => setAddingId(value === '' ? null : Number(value))}
              options={(catalogue.data?.items ?? [])
                .filter((service) => !bindings.some((b) => b.serviceId === service.id))
                .map((service) => ({
                  value: String(service.id),
                  label: locale === 'ur' ? service.nameUr : service.nameEn
                }))}
              placeholder={dict.portal.chooseService}
            />
            <Button
              type="button"
              onClick={() => {
                if (addingId !== null) {
                  /* Starting from the catalogue base price keeps the first save
                     inside the band — the API rejects anything outside it. */
                  const service = byId.get(addingId);
                  setDraftPrice(String((service?.basePricePaisa ?? 0) / 100));
                  setEditingId(addingId);
                  setAdding(false);
                  setAddingId(null);
                }
              }}
              disabled={addingId === null}
            >
              {dict.portal.addService}
            </Button>
            <Button type="button" variant="secondary" onClick={() => setAdding(false)}>
              {dict.common.cancel}
            </Button>
          </div>
        </Card>
      ) : null}

      {bindings.length === 0 && !adding ? (
        <Card className="mt-6 p-8 text-center text-sm text-secondary">{dict.portal.noServicesYet}</Card>
      ) : (
        <ul className="mt-6 grid gap-4 md:grid-cols-2">
          {bindings.map((binding) => {
            const catalogueRow = byId.get(binding.serviceId);
            const min = (catalogueRow?.minPricePaisa ?? 0) / 100;
            const max = (catalogueRow?.maxPricePaisa ?? 0) / 100;
            const isEditing = editingId === binding.serviceId;
            const name = catalogueRow ? (locale === 'ur' ? catalogueRow.nameUr : catalogueRow.nameEn) : binding.serviceNameEn;
            return (
              <li key={binding.serviceId}>
                <Card className="flex h-full flex-col p-5">
                  <div className="flex items-start justify-between gap-3">
                    <div className="min-w-0">
                      <h2 className="font-semibold text-navy">{name}</h2>
                      <div className="mt-1 flex flex-wrap items-center gap-2">
                        <span className={cn('rounded-full px-2 py-0.5 text-[11px] font-semibold', APPROVAL_TONE[binding.status])}>{dict.portal.serviceApproval[binding.status]}</span>
                        {catalogueRow !== undefined ? (
                          <span className="inline-flex items-center gap-1 text-xs text-muted">
                            <Clock3 className="size-3" aria-hidden="true" />
                            {formatDuration(catalogueRow.expectedDurationMin, locale)}
                          </span>
                        ) : null}
                      </div>
                    </div>
                  </div>

                  {binding.status === 'APPROVED' ? (
                    <p className="mt-3 inline-flex items-center gap-1.5 text-xs text-emerald-700">
                      <CheckCircle2 className="size-3.5" aria-hidden="true" />
                      {dict.portal.serviceApprovedNote}
                    </p>
                  ) : binding.status === 'REJECTED' ? (
                    <p className="mt-3 inline-flex items-center gap-1.5 text-xs text-rose-700">
                      <XCircle className="size-3.5" aria-hidden="true" />
                      {dict.portal.serviceRejectedNote}
                    </p>
                  ) : (
                    <p className="mt-3 inline-flex items-center gap-1.5 text-xs text-amber-700">
                      <ShieldCheck className="size-3.5" aria-hidden="true" />
                      {dict.portal.servicePendingNote}
                    </p>
                  )}

                  <div className="mt-4 border-t border-line pt-4">
                    {isEditing ? (
                      <div className="grid gap-3">
                        <div className="grid gap-2">
                          <Label htmlFor={`price-${binding.serviceId}`}>{dict.portal.yourPrice}</Label>
                          <Input id={`price-${binding.serviceId}`} inputMode="numeric" value={draftPrice} onChange={(event) => setDraftPrice(event.target.value)} />
                          <p className="text-xs text-muted">
                            {dict.portal.priceBandHint.replace('{min}', formatMoney(Math.round(min * 100), locale)).replace('{max}', formatMoney(Math.round(max * 100), locale))}
                          </p>
                        </div>
                        <div className="flex gap-2">
                          <Button type="button" size="sm" onClick={() => void save(binding.serviceId)} disabled={setPrice.isPending}>
                            {dict.portal.save}
                          </Button>
                          <Button type="button" variant="secondary" size="sm" onClick={() => setEditingId(null)}>
                            {dict.common.cancel}
                          </Button>
                        </div>
                      </div>
                    ) : (
                      <div className="flex items-end justify-between gap-3">
                        <div>
                          <p className="text-[11px] uppercase tracking-[0.12em] text-muted">{dict.portal.yourPrice}</p>
                          <p className="text-lg font-semibold text-navy">{formatMoney(binding.pricePaisa, locale)}</p>
                        </div>
                        <div className="flex gap-2">
                          <Button
                            type="button"
                            variant="secondary"
                            size="sm"
                            onClick={() => {
                              setDraftPrice(String(binding.pricePaisa / 100));
                              setEditingId(binding.serviceId);
                            }}
                            aria-label={`${dict.portal.editPrice}: ${name}`}
                          >
                            <Pencil className="size-4" aria-hidden="true" />
                            {dict.portal.editPrice}
                          </Button>
                          <Button type="button" variant="ghost" size="sm" onClick={() => void stopOffering(binding)} aria-label={`${dict.portal.stopOffering}: ${name}`}>
                            {dict.portal.stopOffering}
                          </Button>
                        </div>
                      </div>
                    )}
                  </div>
                </Card>
              </li>
            );
          })}
        </ul>
      )}

      {localError !== '' ? (
        <p role="alert" className="mt-4 rounded-[9px] bg-rose-50 p-3 text-sm text-rose-700">
          {localError}
        </p>
      ) : null}

      <p className="mt-6 text-xs leading-5 text-muted">{dict.portal.servicesCountNote.replace('{count}', formatNumber(bindings.length, locale))}</p>
    </div>
  );
}
