"use client";

import { MapPin, Search } from "lucide-react";
import { useRouter } from "next/navigation";
import { useMemo, useState } from "react";
import type { Dictionary } from "@/lib/dictionaries";
import { localizedPath, type Locale } from "@/lib/utils";
import { SelectField } from "@/components/select-field";
import { buttonStyles } from "@/components/ui";
import { useCategories, useCategoryServices } from "@/features/catalogue/queries";
import { useCities } from "@/features/places/queries";
import { cityCentre } from "@/features/search/location";
import { SEARCH_PARAM } from "@/features/search/types";

/* The homepage search. It hands off to `/providers`, which is the only screen
   that talks to `/search/providers` — this one only collects the service and
   the city and puts them in the URL, so the results page owns the request.

   The city is resolved to an approximate centre point here for the same reason
   as on the results page: the places endpoints publish no coordinates. */

export function HeroSearch({ locale, dict }: { locale: Locale; dict: Dictionary }) {
  const router = useRouter();
  const [service, setService] = useState("");
  const [city, setCity] = useState("");

  const categories = useCategories(locale);
  const cities = useCities(locale);
  const firstCategory = categories.data?.items[0]?.slug ?? null;
  const services = useCategoryServices(firstCategory, locale);

  const serviceOptions = useMemo(
    () => [
      { value: "", label: dict.home.searchHint },
      ...(services.data?.items ?? []).map((item) => ({ value: item.slug, label: locale === "ur" ? item.nameUr : item.nameEn })),
    ],
    [dict.home.searchHint, locale, services.data],
  );

  const cityOptions = useMemo(
    () => [
      { value: "", label: dict.booking.chooseArea },
      ...(cities.data?.items ?? []).map((item) => ({ value: String(item.id), label: item.name })),
    ],
    [cities.data, dict.booking.chooseArea],
  );

  const submit = () => {
    const params = new URLSearchParams();
    if (service !== "") params.set(SEARCH_PARAM.service, service);
    const chosen = cities.data?.items.find((item) => item.id === Number(city));
    const centre = chosen === undefined ? null : cityCentre(chosen);
    if (chosen !== undefined) {
      params.set(SEARCH_PARAM.city, String(chosen.id));
      if (centre !== null) {
        params.set(SEARCH_PARAM.lat, String(centre.lat));
        params.set(SEARCH_PARAM.lng, String(centre.lng));
      }
    }
    const query = params.toString();
    router.push(query === "" ? localizedPath(locale, "/providers") : `${localizedPath(locale, "/providers")}?${query}`);
  };

  return (
    <form
      className="rounded-[16px] border border-line bg-white p-4 shadow-float sm:p-5"
      onSubmit={(event) => {
        event.preventDefault();
        submit();
      }}
    >
      <div className="grid items-end gap-2.5 md:grid-cols-[1.15fr_0.85fr_auto] md:gap-4">
        <div className="grid gap-2">
          <label htmlFor="hero-service" className="text-xs font-semibold uppercase tracking-[0.12em] text-muted">
            {dict.home.searchService}
          </label>
          <SelectField
            id="hero-service"
            value={service}
            onChange={setService}
            options={serviceOptions}
            placeholder={dict.home.searchHint}
          />
        </div>
        <div className="grid gap-2">
          <label htmlFor="hero-city" className="flex items-center gap-1.5 text-xs font-semibold uppercase tracking-[0.12em] text-muted">
            <MapPin className="size-3.5" />
            {dict.search.cityLabel}
          </label>
          <SelectField id="hero-city" value={city} onChange={setCity} options={cityOptions} placeholder={dict.search.cityPlaceholder} />
        </div>
        <button type="submit" className={buttonStyles({ className: "min-h-12 w-full px-6 md:w-auto" })}>
          <Search className="size-4" />
          {dict.home.findProfessional}
        </button>
      </div>
    </form>
  );
}