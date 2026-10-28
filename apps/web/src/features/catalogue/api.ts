/* GET /catalogue/categories, /categories/:slug/services, /services/:slug

   Money is integer paisa end to end (packages/contracts/src/money.ts); it is
   never a float and never divided here. `pricingModel` and `timeUnit` decide
   how a price may legitimately be described — see `pricing.ts`.

   This layer is deliberately thin and it never invents a response. A failure is
   allowed to reach the caller, because the caller can tell the difference:

     · 404  → the slug or category does not exist → a not-found state
     · 500  → the API is unwell → an inline error with a retry

   An earlier version caught every error here and answered from a hardcoded
   `catalogue-data.ts` instead. That made a total outage indistinguishable from a
   healthy site, and it answered an unknown slug with a *different real service*
   — so `/services/no-such-service` rendered "Leak Repair" with its price and
   warranty, and a customer could have booked it. Never substitute data here. */

import { apiRequest } from "@/lib/api/client";
import type { Locale } from "@/lib/utils";

export type Category = {
  id: number;
  slug: string;
  nameEn: string;
  nameUr: string;
  sortOrder: number;
  defaultWarrantyDays: number;
  isActive: boolean;
};

export type PricingModel = "FLAT" | "TIME_BASED" | "INSPECTION_FIRST";
export type TimeUnit = "HOUR" | "DAY" | null;

export type CatalogueService = {
  id: number;
  categoryId: number;
  slug: string;
  nameEn: string;
  nameUr: string;
  description: string;
  pricingModel: string;
  timeUnit: string | null;
  basePricePaisa: number;
  minPricePaisa: number;
  maxPricePaisa: number;
  visitFeePaisa: number;
  expectedDurationMin: number;
  isEmergencyEligible: boolean;
  isPlanEligible: boolean;
  warrantyDays: number;
  isHighRisk: boolean;
  isActive: boolean;
};

export type ChecklistItem = {
  id: number;
  position: number;
  labelEn: string;
  labelUr: string;
  requiresPhoto: boolean;
};

export type ServiceDetail = CatalogueService & {
  checklist: ChecklistItem[];
  /** The common faults list, included on the detail response itself. Also
      available standalone via `getIssueOptions`. */
  issueOptions?: IssueOption[];
};

export type IssueOption = {
  id: number;
  slug: string;
  labelEn: string;
  labelUr: string;
  position: number;
};

export type CatalogueOptions = { signal?: AbortSignal; locale?: Locale };

const read = <T>(path: string, options: CatalogueOptions = {}) =>
  apiRequest<T>(path, {
    method: "GET",
    ...(options.locale === undefined ? {} : { locale: options.locale }),
    ...(options.signal === undefined ? {} : { signal: options.signal }),
    auth: false,
    refreshOnExpiry: false,
  });

export type CatalogueServiceWithCategory = CatalogueService & {
  categorySlug: string;
  categoryNameEn: string;
  categoryNameUr: string;
};

export const catalogueApi = {
  listCategories: (options?: CatalogueOptions) => read<{ items: Category[] }>("/catalogue/categories", options),

  listServicesInCategory: (slug: string, options?: CatalogueOptions) =>
    read<{ items: CatalogueService[] }>(`/catalogue/categories/${encodeURIComponent(slug)}/services`, options),

  /**
   * Every active service, by fanning out across the per-category endpoint.
   *
   * The API has no "all services" route, and inventing one client-side would be
   * a guess about the contract. This walks the published category list instead —
   * real calls, real shapes. If any single category fails the whole thing fails,
   * because a partial catalogue presented as a complete one is the same lie as
   * substituting made-up rows.
   */
  listAllServices: async (options?: CatalogueOptions): Promise<{ items: CatalogueServiceWithCategory[] }> => {
    const categories = await catalogueApi.listCategories(options);
    const lists = await Promise.all(
      categories.items
        .filter((category) => category.isActive)
        .map(async (category) => {
          const page = await catalogueApi.listServicesInCategory(category.slug, options);
          return page.items.map((service) => ({
            ...service,
            categorySlug: category.slug,
            categoryNameEn: category.nameEn,
            categoryNameUr: category.nameUr,
          }));
        }),
    );
    return { items: lists.flat() };
  },

  getService: (slug: string, options?: CatalogueOptions) =>
    read<ServiceDetail>(`/catalogue/services/${encodeURIComponent(slug)}`, options),

  /** The common faults a customer can pick from when booking this service,
      seeded by the admin. It is a convenience, never a constraint: the customer
      may still write their own description. */
  getIssueOptions: (slug: string, options?: CatalogueOptions) =>
    read<{ items: IssueOption[] }>(`/catalogue/services/${encodeURIComponent(slug)}/issue-options`, options),
};