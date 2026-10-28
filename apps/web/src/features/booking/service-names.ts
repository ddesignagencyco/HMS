import { useMemo } from "react";
import { useAllServices } from "@/features/catalogue/queries";
import type { Locale } from "@/lib/utils";

/* Booking rows carry a `serviceId` and no readable name.

   `GET /bookings` projects `service_id` and nothing else — no service name, no
   provider name, no address (backend_requirement.md §3.4). So a booking list
   cannot render "Leak repair" from its own response; it has to join the id
   against the catalogue.

   That join is a real call to a real endpoint (`listAllServices`, which itself
   fans out across the published categories because the API has no all-services
   route), and it is best-effort in one direction only:

   · A service the catalogue does not publish — withdrawn, or belonging to a
     category that is no longer active — is left **unmapped**, and the caller
     shows an honest placeholder rather than a bare number.
   · The catalogue failing does not fail the booking list. A booking that exists
     is the important fact; its name is a decoration, and losing the decoration
     must not hide the booking.

   An empty result is therefore not "no bookings" — it is "no names yet". */

export function useServiceNames(locale: Locale): Record<number, string> {
  const services = useAllServices(locale);

  return useMemo(() => {
    const map: Record<number, string> = {};
    for (const service of services.data?.items ?? []) {
      map[service.id] = locale === "ur" ? service.nameUr : service.nameEn;
    }
    return map;
  }, [locale, services.data]);
}