/* `GET /customer/addresses` and `POST /customer/addresses`.

   Booking cannot start without one of these: `POST /bookings` takes an
   `addressId`, not a free-text address. So this module is a booking dependency
   first and a portal feature second — which is why it lives under `account/`
   and not inside the booking flow.

   Two contract facts the UI has to respect:

   · **Every address needs a map point.** `lat` and `lng` are required together
     on create, and there is no geocoding endpoint. The only honest sources are
     the person's own device location or the city centre approximation already
     used by provider search (`features/search/location.ts`) — both labelled, and
     neither presented as the person's actual address.

   · **`areaId` must be an active area**, so it comes from the places API and is
     never typed freehand. An unknown id is a 404, not a validation message. */

import { apiRequest, type ApiRequest } from "@/lib/api/client";
import type { Locale } from "@/lib/utils";

export type Address = {
  id: string;
  label: string;
  line1: string;
  line2: string | null;
  areaId: number;
  /** The stored point. Not the address text — a geocoded pin. */
  lat: number;
  lng: number;
  notes: string | null;
  isDefault: boolean;
  createdAt: string;
};

/** `.strict()` on the server: every field here is required but `isDefault`. */
export type CreateAddressInput = {
  label: string;
  line1: string;
  line2?: string;
  areaId: number;
  lat: number;
  lng: number;
  notes?: string;
  isDefault?: boolean;
};

export type UpdateAddressInput = Partial<Omit<CreateAddressInput, "isDefault">> & { isDefault?: boolean };

export type AddressOptions = { signal?: AbortSignal; locale?: Locale };

const call = <T>(path: string, request: ApiRequest = {}, options?: AddressOptions) =>
  apiRequest<T>(path, {
    ...request,
    ...(options?.locale === undefined ? {} : { locale: options.locale }),
    ...(options?.signal === undefined ? {} : { signal: options.signal }),
  });

/** Only defined keys are sent: `addressUpdateSchema` is `.strict()`. */
const compact = <T extends Record<string, unknown>>(input: T): Partial<T> => {
  const out: Record<string, unknown> = {};
  for (const [key, value] of Object.entries(input)) if (value !== undefined) out[key] = value;
  return out as Partial<T>;
};

export const accountApi = {
  /** Default address first, then newest. Never archived ones. */
  listAddresses: (options?: AddressOptions) => call<{ items: Address[] }>("/customer/addresses", {}, options),

  /** Marking one default silently un-defaults the others, in the same transaction. */
  createAddress: (input: CreateAddressInput, options?: AddressOptions) =>
    call<Address>(
      "/customer/addresses",
      { method: "POST", body: compact({ ...input, isDefault: input.isDefault ?? false }) },
      options,
    ),

  updateAddress: (addressId: string, input: UpdateAddressInput, options?: AddressOptions) =>
    call<Address>(
      `/customer/addresses/${encodeURIComponent(addressId)}`,
      { method: "PATCH", body: compact(input) },
      options,
    ),

  /** 204. Archives rather than deletes, so booking history keeps its reference. */
  archiveAddress: (addressId: string, options?: AddressOptions) =>
    call<undefined>(`/customer/addresses/${encodeURIComponent(addressId)}`, { method: "DELETE" }, options),
};

/** How an address reads on one line: label, then the street line, then the area. */
export const addressLine = (address: Address, areaName?: string): string =>
  [address.label, address.line1, address.line2, areaName].filter((part): part is string => typeof part === "string" && part !== "").join(", ");