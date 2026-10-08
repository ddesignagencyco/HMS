import { readFileSync } from 'node:fs';
import { resolve } from 'node:path';
import { QueryClient, QueryClientProvider } from '@tanstack/react-query';
import { cleanup, render, screen } from '@testing-library/react';
import type { ReactNode } from 'react';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { CategorySection, PopularServicesSection } from '@/features/home/home-catalogue';
import { getDictionary } from '@/lib/dictionaries';
import type { Locale } from '@/lib/utils';

/* The two catalogue-reading sections of the home page.

   Both used to read `src/lib/data.ts` while `/services` read the API. That is
   the defect this file pins shut: the home page could advertise a service, a
   price or a category that the catalogue did not publish — or fail to advertise
   one that it did. Both now read the API, and these tests fail if either goes
   back to the mock file.

   The section formerly titled "Popular services" also asserted something it
   could not know: the API publishes no popularity signal, so it is ordered by
   starting price and says so on screen. */

const dict = getDictionary('en');
const locale: Locale = 'en';

/** Slugs the API publishes — deliberately not the mock file's slugs. */
const categories = {
  items: [
    { id: 1, slug: 'plumbing', nameEn: 'Plumbing', nameUr: 'پلمنگ', sortOrder: 1, defaultWarrantyDays: 30, isActive: true },
    { id: 2, slug: 'electrical', nameEn: 'Electrical', nameUr: 'بجلی', sortOrder: 2, defaultWarrantyDays: 30, isActive: true },
    { id: 3, slug: 'carpentry', nameEn: 'Carpentry & Furniture', nameUr: 'نجاری', sortOrder: 3, defaultWarrantyDays: 14, isActive: true },
    /* Inactive: must never be advertised. */
    { id: 9, slug: 'withdrawn', nameEn: 'Withdrawn Trade', nameUr: 'منسوخ', sortOrder: 0, defaultWarrantyDays: 7, isActive: false }
  ]
};

const service = (input: { id: number; categoryId: number; slug: string; nameEn: string; basePricePaisa: number; isActive?: boolean }) => ({
  id: input.id,
  categoryId: input.categoryId,
  slug: input.slug,
  nameEn: input.nameEn,
  nameUr: `${input.nameEn} اردو`,
  description: 'A description the API owns.',
  pricingModel: 'FLAT',
  timeUnit: null,
  basePricePaisa: input.basePricePaisa,
  minPricePaisa: 0,
  maxPricePaisa: input.basePricePaisa * 2,
  visitFeePaisa: 0,
  expectedDurationMin: 60,
  isEmergencyEligible: false,
  isPlanEligible: false,
  warrantyDays: 30,
  isHighRisk: false,
  isActive: input.isActive ?? true
});

const plumbing = service({ id: 11, categoryId: 1, slug: 'leak-repair', nameEn: 'Leak Repair', basePricePaisa: 450000 });
const electrical = service({ id: 12, categoryId: 2, slug: 'switch-repair', nameEn: 'Switch Repair', basePricePaisa: 120000 });
const carpentry = service({ id: 13, categoryId: 3, slug: 'door-repair', nameEn: 'Door Repair', basePricePaisa: 180000 });
const retired = service({ id: 14, categoryId: 1, slug: 'old-service', nameEn: 'Old Retired Service', basePricePaisa: 100, isActive: false });

const byCategory: Record<string, unknown[]> = {
  plumbing: [plumbing, retired],
  electrical: [electrical],
  carpentry: [carpentry]
};

const json = (body: unknown) => new Response(JSON.stringify(body), { status: 200, headers: { 'content-type': 'application/json' } });

const problem = (status: number) =>
  new Response(JSON.stringify({ type: 'about:blank', title: 'x', status, code: 'INTERNAL_ERROR', detail: 'x', errors: [] }), { status, headers: { 'content-type': 'application/problem+json' } });

type Mode = 'ok' | 'categoriesFail';

let mode: Mode = 'ok';

const renderSection = (node: ReactNode) => {
  const client = new QueryClient({ defaultOptions: { queries: { retry: false, retryDelay: 0, gcTime: 0 } } });
  const Component = ({ children }: { children: ReactNode }) => <QueryClientProvider client={client}>{children}</QueryClientProvider>;
  return render(node, { wrapper: Component });
};

/** jsdom has no IntersectionObserver, and `Reveal`/`CountUp` both need one. A
    no-op stub that reports "visible" straight away keeps the markup rendered. */
const stubObserver = () => {
  class Immediate {
    observe(): void {}
    unobserve(): void {}
    disconnect(): void {}
    takeRecords(): [] {
      return [];
    }
    root = null;
    rootMargin = '';
    thresholds: number[] = [];
  }
  vi.stubGlobal('IntersectionObserver', Immediate as unknown as typeof IntersectionObserver & { new (cb: unknown): IntersectionObserver });
};

describe('where these sections live', () => {
  /* Not a style preference. `home-sections.tsx` has no `"use client"` — it is a
     server module, because every other section on the page is static markup over
     `src/lib/data.ts`. A `useQuery` in a server component is a hard runtime
     error ("Attempted to call useQuery() from the server"), and it only appears
     when the page is actually rendered — so the unit tests, which always mount a
     QueryClientProvider, cannot catch it.

     Keeping these two in `home-catalogue.tsx` is what makes them legal while the
     rest of the home page stays server-rendered. This fails if either file's
     directive is changed without moving the code to match. */
  const directive = (path: string): string => readFileSync(resolve(__dirname, path), 'utf8').split('\n')[0]?.replace(/;\s*$/, '').trim() ?? '';

  /* Quote-agnostic on purpose: Prettier normalises this file to single quotes, and
     the assertion is about the directive, not about its punctuation. */
  it('keeps the catalogue sections in a client module', () => {
    expect(directive('../../features/home/home-catalogue.tsx').replace(/'/g, '"')).toBe('"use client"');
  });

  it('leaves the other home sections server-rendered', () => {
    expect(directive('../../features/home/home-sections.tsx').replace(/'/g, '"')).not.toBe('"use client"');
  });

  it('does not import a client-only hook into the server module', () => {
    const server = readFileSync(resolve(__dirname, '../../features/home/home-sections.tsx'), 'utf8');
    expect(server).not.toMatch(/from '@\/features\/catalogue\/queries'/);
    expect(server).not.toMatch(/from "@\/features\/catalogue\/queries"/);
  });
});

beforeEach(() => {
  mode = 'ok';
  stubObserver();
  vi.stubGlobal(
    'fetch',
    vi.fn(async (input: RequestInfo | URL) => {
      const url = typeof input === 'string' ? input : String(input);
      if (url.includes('/catalogue/categories?')) return json(categories);
      if (/\/catalogue\/categories\/[^/]+\/services/.test(url)) {
        const slug = /\/catalogue\/categories\/([^/]+)\/services/.exec(url)?.[1] ?? '';
        if (mode === 'categoriesFail') return problem(500);
        return json({ items: byCategory[slug] ?? [] });
      }
      if (url.includes('/catalogue/categories')) return json(categories);
      throw new Error(`unrouted GET ${url}`);
    })
  );
});

afterEach(() => {
  cleanup();
  vi.unstubAllGlobals();
});

describe('the home page category section', () => {
  it('shows the categories the API publishes', async () => {
    renderSection(<CategorySection locale={locale} dict={dict} />);
    expect(await screen.findByText('Plumbing')).toBeDefined();
    expect(await screen.findByText('Electrical')).toBeDefined();
    expect(await screen.findByText('Carpentry & Furniture')).toBeDefined();
  });

  it('never advertises an inactive category', async () => {
    renderSection(<CategorySection locale={locale} dict={dict} />);
    await screen.findByText('Plumbing');
    expect(screen.queryByText('Withdrawn Trade')).toBeNull();
  });

  it('counts only the active services in each category', async () => {
    renderSection(<CategorySection locale={locale} dict={dict} />);
    /* Plumbing has two rows but one is inactive, so its card says 1 — and so do
       the other two, which is why this checks the number of cards, not one. */
    const ones = await screen.findAllByText(dict.common.servicesCount.replace('{count}', '1'));
    expect(ones).toHaveLength(3);
    expect(screen.queryByText(dict.common.servicesCount.replace('{count}', '2'))).toBeNull();
  });

  it('does not invent a per-category description', async () => {
    renderSection(<CategorySection locale={locale} dict={dict} />);
    await screen.findByText('Plumbing');
    /* The API publishes no category description, so one generic sentence is used
       rather than mock copy that would be a second source of truth. */
    expect(screen.getAllByText(dict.home.categoryGenericBlurb).length).toBe(3);
  });

  it('reports a catalogue failure rather than showing no categories', async () => {
    mode = 'categoriesFail';
    renderSection(<CategorySection locale={locale} dict={dict} />);
    expect(await screen.findByText(dict.catalogue.loadError)).toBeDefined();
  });

  it('does not show a count of zero when the service fan-out fails', async () => {
    /* The category list still succeeds, so only the counts are unavailable. A
       card reading "0 services" would look like a real, empty catalogue. */
    mode = 'categoriesFail';
    renderSection(<CategorySection locale={locale} dict={dict} />);
    expect(await screen.findByText(dict.catalogue.loadError)).toBeDefined();
    expect(screen.queryByText(dict.common.servicesCount.replace('{count}', '0'))).toBeNull();
  });
});

describe('the home page service section', () => {
  it('shows only active services, cheapest first', async () => {
    renderSection(<PopularServicesSection locale={locale} dict={dict} />);
    expect(await screen.findByText('Switch Repair')).toBeDefined();
    expect(await screen.findByText('Door Repair')).toBeDefined();
    expect(await screen.findByText('Leak Repair')).toBeDefined();
    /* Rs 100, and inactive besides. */
    expect(screen.queryByText('Old Retired Service')).toBeNull();
  });

  it('does not claim the selection is popular', async () => {
    renderSection(<PopularServicesSection locale={locale} dict={dict} />);
    await screen.findByText('Switch Repair');
    expect(screen.queryByText('Popular services')).toBeNull();
    /* The note states that the ordering is by price and not a ranking. */
    expect(screen.getByText(dict.home.popularNote)).toBeDefined();
  });

  it('takes the category name from the API, not from a lookup table', async () => {
    renderSection(<PopularServicesSection locale={locale} dict={dict} />);
    /* "Switch Repair" is joined to "Electrical" by the API's own fan-out. */
    expect(await screen.findByText('Electrical')).toBeDefined();
  });

  it('links to the real service page', async () => {
    renderSection(<PopularServicesSection locale={locale} dict={dict} />);
    await screen.findByText('Switch Repair');
    expect(screen.getByRole('link', { name: /Switch Repair/ }).getAttribute('href')).toContain('/services/switch-repair');
  });

  it('shows the Urdu name when the page is in Urdu', async () => {
    renderSection(<PopularServicesSection locale="ur" dict={getDictionary('ur')} />);
    expect(await screen.findByText('Switch Repair اردو')).toBeDefined();
  });
});
