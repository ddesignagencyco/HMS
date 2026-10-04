"use client";

import { Clock3, MapPin } from "lucide-react";
import { useState } from "react";
import type { Dictionary } from "@/lib/dictionaries";
import type { Booking } from "@/lib/types";
import { areas, getService } from "@/lib/data";
import { formatDateTime, formatMoney, type Locale } from "@/lib/utils";
import { Card, PageHeader, buttonStyles } from "@/components/ui";

export function ProviderOffers({ locale, dict, offers }: { locale: Locale; dict: Dictionary; offers: Booking[] }) {
  const [state, setState] = useState<Record<string, "accepted" | "declined">>({});

  return (
    <div>
      <PageHeader eyebrow={dict.portal.provider} title={dict.portal.offers} description={dict.portal.offersDescription} />
      <div className="mt-6 grid gap-4">
        {offers.map((offer) => {
          const service = getService(offer.serviceSlug);
          const area = areas.find((item) => item.slug === offer.areaSlug);
          const result = state[offer.id];
          return (
            <Card key={offer.id} className="p-5">
              <div className="flex flex-col gap-4 lg:flex-row lg:items-center lg:justify-between">
                <div className="min-w-0">
                  <p className="text-xs font-semibold text-muted">{offer.code} · {dict.portal.newRequest}</p>
                  <h2 className="mt-1 text-lg font-semibold text-navy">{service?.name[locale]}</h2>
                  <p className="mt-2 max-w-2xl text-sm leading-6 text-secondary">{offer.problem}</p>
                  <div className="mt-3 flex flex-wrap gap-4 text-xs text-muted"><span className="inline-flex items-center gap-1.5"><MapPin className="size-3.5" />{area?.name[locale]}</span><span className="inline-flex items-center gap-1.5"><Clock3 className="size-3.5" />{formatDateTime(offer.scheduledStart, locale)}</span><span>{formatMoney(offer.quotedPaisa, locale)}</span></div>
                </div>
                {result ? <p className={`text-sm font-semibold ${result === "accepted" ? "text-emerald-700" : "text-rose-700"}`}>{result === "accepted" ? "Accepted locally" : "Declined locally"}</p> : <div className="flex shrink-0 gap-2"><button type="button" onClick={() => setState((current) => ({ ...current, [offer.id]: "declined" }))} className={buttonStyles({ variant: "secondary" })}>{dict.portal.decline}</button><button type="button" onClick={() => setState((current) => ({ ...current, [offer.id]: "accepted" }))} className={buttonStyles()}>{dict.portal.accept}</button></div>}
              </div>
            </Card>
          );
        })}
        {offers.length === 0 ? <Card className="p-8 text-center text-sm text-secondary">{dict.common.empty}</Card> : null}
      </div>
    </div>
  );
}
