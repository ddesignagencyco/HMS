import { QueryClient, QueryClientProvider } from '@tanstack/react-query';
import { cleanup, fireEvent, render, screen, waitFor } from '@testing-library/react';
import type { ReactNode } from 'react';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { ProviderRatingsScreen } from '@/features/provider/ratings-view';
import type { Reputation } from '@/features/search/api';
import { getDictionary } from '@/lib/dictionaries';
import type { Locale } from '@/lib/utils';

/* Ratings and remarks.

   The trap this file exists to catch: **`reply` is a plain string on this
   endpoint**, not the `{ body, createdAt }` object the *public* remarks route
   returns. Typed as the object, React throws or renders `[object Object]`.

   Also pinned:
   · the overall score is hidden until `ratingCount > 0`, because with no ratings
     it is the Bayesian prior, not something a customer said;
   · a remark an admin withdrew is still listed and labelled — FR-SP-05 says the
     provider keeps seeing it;
   · a reply can be sent once, and the control disappears afterwards because the
     API refuses an edit. */

const dict = getDictionary('en');
const locale: Locale = 'en';

const json = (body: unknown) => new Response(JSON.stringify(body), { status: 200, headers: { 'content-type': 'application/json' } });

const rating = (over: Record<string, unknown> = {}) => ({
  ratingId: 'r1',
  score: 4.5,
  quality: 5,
  punctuality: 4,
  conduct: 5,
  cleanliness: 4,
  createdAt: '2026-10-01T00:00:00.000Z',
  remark: { id: 'm1', body: 'Sorted the same evening.', displayName: 'Bilal A.', published: true, reply: null },
  ...over
});

let payload: { reputation: Reputation; items: unknown[] } = {
  reputation: { score: 4.5, ratingCount: 2, distribution: { '1': 0, '2': 0, '3': 0, '4': 1, '5': 1 }, verifiedJobs: 12, badge: null },
  items: [rating()]
};

const renderScreen = () => {
  const client = new QueryClient({ defaultOptions: { queries: { retry: false, retryDelay: 0, gcTime: 0 } } });
  const Component = ({ children }: { children: ReactNode }) => <QueryClientProvider client={client}>{children}</QueryClientProvider>;
  return render(<ProviderRatingsScreen locale={locale} dict={dict} />, { wrapper: Component });
};

const postCalls = () => (globalThis.fetch as ReturnType<typeof vi.fn>).mock.calls.filter(([, init]) => (init as RequestInit | undefined)?.method === 'POST');

beforeEach(() => {
  payload = {
    reputation: { score: 4.5, ratingCount: 2, distribution: { '1': 0, '2': 0, '3': 0, '4': 1, '5': 1 }, verifiedJobs: 12, badge: null },
    items: [rating()]
  };
  vi.stubGlobal(
    'fetch',
    vi.fn(async (input: RequestInfo | URL, init?: RequestInit) => {
      const url = typeof input === 'string' ? input : String(input);
      if ((init?.method ?? 'GET').toUpperCase() === 'POST') {
        return json(rating({ remark: { id: 'm1', body: 'Sorted the same evening.', displayName: 'Bilal A.', published: true, reply: 'Glad it is sorted.' } }));
      }
      return json(payload);
    })
  );
});

afterEach(() => {
  cleanup();
  vi.unstubAllGlobals();
});

/**
 * The summary card and every rating row both print a score, so a bare
 * `findByText('4.5')` is ambiguous. These two helpers pick the right one rather
 * than loosening the assertion — which score appears where is part of the contract.
 */
const summaryScore = async (value: string): Promise<HTMLElement> => {
  const matches = await screen.findAllByText(value);
  /* The summary figure is `text-2xl`; a row's own score is `text-lg`. */
  const summary = matches.find((node) => node.className.includes('text-2xl'));
  if (summary === undefined) throw new Error(`No summary score for ${value} among ${matches.length} matches`);
  return summary;
};

const rowScores = (value: string): HTMLElement[] => screen.queryAllByText(value).filter((node) => node.className.includes('text-lg'));

describe('provider ratings', () => {
  it('shows the score once there is a real rating', async () => {
    renderScreen();
    expect((await summaryScore('4.5')).textContent).toBe('4.5');
    expect(screen.getByText(dict.portal.fromRatings.replace('{count}', '2'))).toBeDefined();
    /* And the single rating row carries its own copy of the same figure. */
    expect(rowScores('4.5')).toHaveLength(1);
  });

  it('withholds the score while the API returns null, because nobody has rated yet', async () => {
    payload = {
      reputation: { score: null, ratingCount: 0, distribution: { '1': 0, '2': 0, '3': 0, '4': 0, '5': 0 }, verifiedJobs: 0, badge: null },
      items: []
    };
    renderScreen();
    expect(await screen.findByText(dict.portal.noRatingsYet)).toBeDefined();
    /* The score is null, so nothing may stand in for it. */
    expect(screen.queryByText('NaN')).toBeNull();
    expect(screen.queryByText('0.0')).toBeNull();
    /* The list says when one will appear instead of repeating the summary's
       own "no ratings yet" a second time. */
    expect(screen.getByText(dict.portal.noRatingsListHint)).toBeDefined();
  });

  /* The count is not the guard: this API can answer with a count and a null
     score, and the prior note belongs to a score that exists. */
  it('withholds the score even when a count is reported alongside a null', async () => {
    payload = {
      reputation: { score: null, ratingCount: 3, distribution: { '1': 0, '2': 0, '3': 0, '4': 1, '5': 2 }, verifiedJobs: 5, badge: null },
      items: []
    };
    renderScreen();
    expect(await screen.findByText(dict.portal.noRatingsYet)).toBeDefined();
    expect(screen.queryByText('NaN')).toBeNull();
  });

  it('renders the remark and its display name', async () => {
    renderScreen();
    expect(await screen.findByText('Sorted the same evening.')).toBeDefined();
    expect(screen.getByText(/Bilal A\./)).toBeDefined();
  });

  it('shows an existing reply as a plain string, not an object', async () => {
    payload = {
      reputation: payload.reputation,
      items: [rating({ remark: { id: 'm1', body: 'Sorted.', displayName: 'Bilal A.', published: true, reply: 'Glad it is sorted.' } })]
    };
    renderScreen();
    expect(await screen.findByText('Glad it is sorted.')).toBeDefined();
    expect(document.body.textContent).not.toContain('[object');
  });

  it('labels a withdrawn remark rather than hiding it', async () => {
    payload = {
      reputation: payload.reputation,
      items: [rating({ remark: { id: 'm1', body: 'Removed remark.', displayName: 'Bilal A.', published: false, reply: null } })]
    };
    renderScreen();
    expect(await screen.findByText(dict.portal.remarkWithdrawn)).toBeDefined();
    expect(screen.getByText('Removed remark.')).toBeDefined();
  });

  it('renders a rating that has no remark at all', async () => {
    payload = { reputation: payload.reputation, items: [rating({ remark: null })] };
    renderScreen();
    expect((await summaryScore('4.5')).textContent).toBe('4.5');
    expect(screen.queryByLabelText(dict.portal.replyToRemark)).toBeNull();
  });

  it('shows all four criteria from the API row', async () => {
    renderScreen();
    await summaryScore('4.5');
    expect(screen.getByText(dict.portal.criteria.quality)).toBeDefined();
    expect(screen.getByText(dict.portal.criteria.punctuality)).toBeDefined();
    expect(screen.getByText(dict.portal.criteria.conduct)).toBeDefined();
    expect(screen.getByText(dict.portal.criteria.cleanliness)).toBeDefined();
  });

  it('sends one reply and then withdraws the control', async () => {
    renderScreen();
    fireEvent.change(await screen.findByLabelText(dict.portal.replyToRemark), {
      target: { value: 'Glad it is sorted.' }
    });
    fireEvent.click(screen.getByRole('button', { name: dict.portal.sendReply }));

    await waitFor(() => expect(postCalls()).toHaveLength(1));
    expect(JSON.parse(String((postCalls()[0][1] as RequestInit).body))).toEqual({ body: 'Glad it is sorted.' });
    /* One reply per remark, never editable — so the box is gone, not prefilled. */
    expect(await screen.findByText(dict.portal.replySent)).toBeDefined();
    expect(screen.queryByLabelText(dict.portal.replyToRemark)).toBeNull();
  });

  it('refuses an empty reply before sending it', async () => {
    renderScreen();
    await screen.findByLabelText(dict.portal.replyToRemark);
    fireEvent.click(screen.getByRole('button', { name: dict.portal.sendReply }));
    expect(await screen.findByText(dict.portal.replyRequired)).toBeDefined();
    expect(postCalls()).toHaveLength(0);
  });

  it('reports a failure to load ratings', async () => {
    vi.stubGlobal(
      'fetch',
      vi.fn(
        async () =>
          new Response(JSON.stringify({ type: 'about:blank', title: 'x', status: 500, code: 'INTERNAL_ERROR', detail: 'x', errors: [] }), {
            status: 500,
            headers: { 'content-type': 'application/problem+json' }
          })
      )
    );
    renderScreen();
    expect(await screen.findByText(dict.portal.ratingsLoadError)).toBeDefined();
  });
});
