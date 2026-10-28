import { QueryClient, QueryClientProvider } from '@tanstack/react-query';
import { cleanup, fireEvent, render, screen, waitFor } from '@testing-library/react';
import type { ReactNode } from 'react';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { ProviderConductScreen } from '@/features/provider/conduct-view';
import { getDictionary } from '@/lib/dictionaries';
import type { Locale } from '@/lib/utils';

/* Conduct record and penalties.

   The facts this pins, each a place a plausible screen would mislead:

   · **A PROPOSED penalty is not a charge.** `POST /admin/penalties` fines nobody.
     The screen must say so in as many words, and must not offer an appeal —
     appealing is only possible once it has been APPLIED.
   · **`reply` is `{ reply }`, not `{ body }`** — `replySchema` is `.strict()`, so
     the wrong key is a 422 on the one request that matters most.
   · **The demerit schedule is served by the API**, bilingual. The previous screen
     hardcoded it in the dictionary, which meant it could drift from `breach_types`
     and could never show a breach an admin had just activated. A test renders the
     Urdu screen and asserts the platform's own `nameUr` appears — not a
     client-side translation of the English name.
   · **`activePoints` is not the length of the award list.** Points decay, expire
     and get voided by an appeal, and the history is still listed. */
const dict = getDictionary('en');
const locale: Locale = 'en';

const json = (body: unknown) => new Response(JSON.stringify(body), { status: 200, headers: { 'content-type': 'application/json' } });

const renderScreen = (loc: Locale = locale) => {
  const client = new QueryClient({ defaultOptions: { queries: { retry: false, retryDelay: 0, gcTime: 0 } } });
  const Component = ({ children }: { children: ReactNode }) => <QueryClientProvider client={client}>{children}</QueryClientProvider>;
  return render(<ProviderConductScreen locale={loc} dict={getDictionary(loc)} />, { wrapper: Component });
};

const breach = (over: Record<string, unknown> = {}) => ({
  code: 'OVERCHARGE',
  nameEn: 'Charging beyond the approved quote',
  nameUr: 'منظور شدہ سے زیادہ رقم وصول کرنا',
  category: 'INTEGRITY',
  points: 10,
  consequence: 'fullRefund',
  ...over
});

const record = (over: Record<string, unknown> = {}) => ({
  providerStatus: 'APPROVED',
  activePoints: 10,
  daysSinceLastBreachOrDecay: 4,
  awards: [
    {
      id: 'a1',
      breachCode: 'OVERCHARGE',
      pointsAwarded: 15,
      pointsRemaining: 10,
      awardedAt: '2026-08-01T00:00:00.000Z',
      expiresAt: '2027-01-28T00:00:00.000Z',
      voided: false,
      active: true
    }
  ],
  standingConsequences: [],
  thresholds: [
    { points: 10, consequence: 'WARNING' },
    { points: 20, consequence: 'DEMOTION_30D' },
    { points: 60, consequence: 'PERMANENT_BLOCK' }
  ],
  schedule: [breach()],
  ...over
});

const penalty = (over: Record<string, unknown> = {}) => ({
  id: 'p1',
  providerId: '00000000-0000-4000-8000-000000000098',
  breachCode: 'OVERCHARGE',
  breachName: 'Charging beyond the approved quote',
  category: 'INTEGRITY',
  points: 10,
  status: 'PROPOSED',
  bookingCode: 'BK-1001',
  finePaisa: 200_000,
  replyDueAt: '2026-10-08T00:00:00.000Z',
  providerReply: null,
  repliedAt: null,
  evidence: { note: 'Customer confirmed on the verification call' },
  appliedAt: null,
  createdAt: '2026-10-06T00:00:00.000Z',
  ...over
});

let conduct = record();
let penalties = [penalty()];

const postsTo = (fragment: string) =>
  (globalThis.fetch as ReturnType<typeof vi.fn>).mock.calls.filter(([url, init]) => String(url).includes(fragment) && (init as RequestInit | undefined)?.method === 'POST');

beforeEach(() => {
  conduct = record();
  penalties = [penalty()];
  vi.stubGlobal(
    'fetch',
    vi.fn(async (input: RequestInfo | URL, init?: RequestInit) => {
      const url = typeof input === 'string' ? input : String(input);
      if ((init?.method ?? 'GET').toUpperCase() === 'POST') return json(penalty({ status: 'APPLIED' }));
      if (url.includes('/provider/penalties')) return json({ items: penalties });
      if (url.includes('/provider/conduct')) return json(conduct);
      throw new Error(`unrouted ${url}`);
    })
  );
});

afterEach(() => {
  cleanup();
  vi.unstubAllGlobals();
});

describe('provider conduct record', () => {
  it('shows the active points from the API', async () => {
    renderScreen();
    expect((await screen.findAllByText('10')).length).toBeGreaterThan(0);
    expect(screen.getByText(dict.portal.daysClean.replace('{count}', '4'))).toBeDefined();
  });

  it('says plainly that there is nothing on the record', async () => {
    conduct = record({ activePoints: 0, daysSinceLastBreachOrDecay: null, awards: [] });
    renderScreen();
    expect(await screen.findByText(dict.portal.noBreachOnRecord)).toBeDefined();
    expect(screen.getByText(dict.portal.noStandingRestriction)).toBeDefined();
  });

  it('treats a null `until` as permanent, not as a missing date', async () => {
    conduct = record({ standingConsequences: [{ consequence: 'PERMANENT_BLOCK', until: null }] });
    renderScreen();
    expect(await screen.findByText(dict.portal.permanentRestriction)).toBeDefined();
  });

  it('names the date a temporary restriction ends', async () => {
    conduct = record({ standingConsequences: [{ consequence: 'SUSPENSION_7D', until: '2026-10-20T00:00:00.000Z' }] });
    renderScreen();
    expect(await screen.findByText(dict.portal.conductConsequences.SUSPENSION_7D)).toBeDefined();
    expect(screen.getByText(new RegExp('In force until'))).toBeDefined();
  });

  it('lists the award history with what is left of it', async () => {
    renderScreen();
    expect(await screen.findByText('OVERCHARGE')).toBeDefined();
    /* 15 awarded, 10 still on the record — the two must not be conflated. */
    expect(screen.getByText(dict.portal.pointsLeft.replace('{remaining}', '10').replace('{awarded}', '15'))).toBeDefined();
  });

  it('marks an award voided by an appeal instead of hiding it', async () => {
    conduct = record({
      activePoints: 0,
      awards: [
        {
          id: 'a1',
          breachCode: 'OVERCHARGE',
          pointsAwarded: 15,
          pointsRemaining: 0,
          awardedAt: '2026-08-01T00:00:00.000Z',
          expiresAt: '2027-01-28T00:00:00.000Z',
          voided: true,
          active: false
        }
      ]
    });
    renderScreen();
    expect(await screen.findByText(dict.portal.voidedByAppeal)).toBeDefined();
  });

  it('reports a failure to load the record', async () => {
    vi.stubGlobal(
      'fetch',
      vi.fn(async (input: RequestInfo | URL) => {
        const url = String(input);
        if (url.includes('/provider/conduct')) {
          return new Response(JSON.stringify({ type: 'about:blank', title: 'x', status: 500, code: 'INTERNAL_ERROR', detail: 'x', errors: [] }), {
            status: 500,
            headers: { 'content-type': 'application/problem+json' }
          });
        }
        return json({ items: [] });
      })
    );
    renderScreen();
    expect(await screen.findByText(dict.portal.conductLoadError)).toBeDefined();
  });
});

describe('the demerit schedule', () => {
  it('renders the schedule the API served rather than a local table', async () => {
    renderScreen();
    /* Appears twice: once as the schedule row, once as the penalty's name. Both
       come from `breach_types`, which is the point. */
    expect((await screen.findAllByText('Charging beyond the approved quote')).length).toBe(2);
    expect(screen.getByText('INTEGRITY')).toBeDefined();
  });

  it("shows the platform's own Urdu name on the Urdu screen", async () => {
    renderScreen('ur');
    /* Twice — the schedule row and the penalty row. The penalty's own
       `breachName` is always `name_en`, so this only holds because the screen
       joins on `breachCode` against the bilingual schedule. If it were a
       client-side translation it would read like the English string. */
    expect((await screen.findAllByText('منظور شدہ سے زیادہ رقم وصول کرنا')).length).toBe(2);
    expect(screen.queryByText('Charging beyond the approved quote')).toBeNull();
  });

  it('falls back to the English name for a breach no longer on the schedule', async () => {
    /* A penalty can outlive a breach being deactivated. Blanking the name would
       be worse than showing the English one. */
    conduct = record({ schedule: [] });
    penalties = [penalty({ breachCode: 'RETIRED', breachName: 'A retired breach' })];
    renderScreen();
    expect(await screen.findByText('A retired breach')).toBeDefined();
  });

  it('shows a breach the client has never heard of, via its own name', async () => {
    conduct = record({ schedule: [breach({ code: 'BRAND_NEW', nameEn: 'A brand new breach', nameUr: 'نیا خلافِ شرط', category: 'SAFETY' })] });
    renderScreen();
    expect(await screen.findByText('A brand new breach')).toBeDefined();
  });

  it('falls back to the raw consequence code rather than an empty cell', async () => {
    conduct = record({ thresholds: [{ points: 99, consequence: 'SOMETHING_NEW' }] });
    renderScreen();
    expect(await screen.findByText('SOMETHING_NEW')).toBeDefined();
  });

  it('lists the thresholds the API sent', async () => {
    renderScreen();
    expect(await screen.findByText(dict.portal.conductConsequences.PERMANENT_BLOCK)).toBeDefined();
  });
});

describe('penalties', () => {
  it('states that a proposed penalty has not been charged', async () => {
    renderScreen();
    expect(await screen.findByText(dict.portal.penaltyStatus.PROPOSED)).toBeDefined();
    /* The exact sentence matters: "PROPOSED" read alone sounds like a charge. */
    expect(screen.getByText(new RegExp('Nothing has been charged'))).toBeDefined();
  });

  it('sends the reply under `reply`, not `body`', async () => {
    renderScreen();
    fireEvent.change(await screen.findByLabelText(dict.portal.replyToPenalty), {
      target: { value: 'The customer asked for extra work and paid cash.' }
    });
    fireEvent.click(screen.getByRole('button', { name: dict.portal.sendReply }));

    await waitFor(() => expect(postsTo('/provider/penalties/p1/reply')).toHaveLength(1));
    /* `replySchema` is `.strict()` — `{ body }` would be a 422. */
    expect(JSON.parse(String((postsTo('/provider/penalties/p1/reply')[0][1] as RequestInit).body))).toEqual({
      reply: 'The customer asked for extra work and paid cash.'
    });
  });

  it('refuses an empty reply before sending it', async () => {
    renderScreen();
    await screen.findByLabelText(dict.portal.replyToPenalty);
    fireEvent.click(screen.getByRole('button', { name: dict.portal.sendReply }));
    expect(await screen.findByText(dict.portal.replyRequired)).toBeDefined();
    expect(postsTo('/reply')).toHaveLength(0);
  });

  it('offers no appeal while the penalty is only proposed', async () => {
    renderScreen();
    await screen.findByText(dict.portal.penaltyStatus.PROPOSED);
    /* Appealing is for an APPLIED penalty; offering it earlier would be a 409. */
    expect(screen.queryByLabelText(dict.portal.appealGroundsLabel)).toBeNull();
  });

  it('offers an appeal once the penalty is applied, and refuses grounds under ten characters', async () => {
    penalties = [penalty({ status: 'APPLIED', appliedAt: '2026-10-06T02:00:00.000Z' })];
    renderScreen();
    fireEvent.change(await screen.findByLabelText(dict.portal.appealGroundsLabel), { target: { value: 'because' } });
    fireEvent.click(screen.getByRole('button', { name: dict.portal.appealPenalty }));
    /* `appealSchema` requires min(10). Saying so beats a 422. */
    expect(await screen.findByText(dict.portal.appealTooShort)).toBeDefined();
    expect(postsTo('/appeal')).toHaveLength(0);
  });

  it('submits an appeal with the grounds', async () => {
    penalties = [penalty({ status: 'APPLIED', appliedAt: '2026-10-06T02:00:00.000Z' })];
    renderScreen();
    fireEvent.change(await screen.findByLabelText(dict.portal.appealGroundsLabel), {
      target: { value: 'The photos show the work was completed and signed off.' }
    });
    fireEvent.click(screen.getByRole('button', { name: dict.portal.appealPenalty }));

    await waitFor(() => expect(postsTo('/provider/penalties/p1/appeal')).toHaveLength(1));
    expect(JSON.parse(String((postsTo('/provider/penalties/p1/appeal')[0][1] as RequestInit).body))).toEqual({
      grounds: 'The photos show the work was completed and signed off.'
    });
  });

  it('shows the reply already on file instead of a second box', async () => {
    penalties = [penalty({ status: 'APPLIED', providerReply: 'I did the extra work.', repliedAt: '2026-10-06T01:00:00.000Z' })];
    renderScreen();
    expect(await screen.findByText('I did the extra work.')).toBeDefined();
    /* A reply is once-only; offering the box again would be a 409. */
    expect(screen.queryByLabelText(dict.portal.replyToPenalty)).toBeNull();
  });

  it('says so when there has never been a penalty', async () => {
    penalties = [];
    renderScreen();
    expect(await screen.findByText(dict.portal.noPenalties)).toBeDefined();
  });
});
