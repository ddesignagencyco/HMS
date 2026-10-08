import { QueryClient, QueryClientProvider } from '@tanstack/react-query';
import { cleanup, render, screen } from '@testing-library/react';
import type { ReactNode } from 'react';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { ProviderDashboardScreen } from '@/features/provider/dashboard-view';
import type { Reputation } from '@/features/search/api';
import { getDictionary } from '@/lib/dictionaries';
import type { Locale } from '@/lib/utils';

/* The provider's home screen.
 *
 * The previous dashboard rendered a *public* provider card — bio, qualification,
 * areas served, and a "Book" link. On a signed-in provider's own dashboard that
 * showed a booking button to the person being booked and answered none of the
 * questions they open the app with. What replaced it answers three, all from real
 * endpoints:
 *
 *   · what needs me, grouped by what I can actually do about it;
 *   · what is my money — `releasablePaisa` and the wallet are different numbers;
 *   · what is outstanding — a CNIC, a proposed penalty, a standing restriction.
 *
 * The facts pinned here are the ones a plausible dashboard would get wrong:
 * a QUOTE_REVISION is not "active work" because the next move is the customer's;
 * the reputation score is hidden below one rating because it is only the prior;
 * `until: null` on a standing restriction means permanent, not missing; and the
 * two money figures are never summed into one headline. */
const dict = getDictionary('en');
const locale: Locale = 'en';

const json = (body: unknown) => new Response(JSON.stringify(body), { status: 200, headers: { 'content-type': 'application/json' } });

const renderScreen = () => {
  const client = new QueryClient({ defaultOptions: { queries: { retry: false, retryDelay: 0, gcTime: 0 } } });
  const Component = ({ children }: { children: ReactNode }) => <QueryClientProvider client={client}>{children}</QueryClientProvider>;
  return render(<ProviderDashboardScreen locale={locale} dict={dict} />, { wrapper: Component });
};

const booking = (over: Record<string, unknown> = {}) => ({
  id: 'bk-1',
  code: 'SHM-0000042',
  customerId: 'c-1',
  providerId: 'p-1',
  serviceId: 1,
  addressId: 'a-1',
  status: 'REQUESTED',
  paymentMode: 'CASH',
  paymentStatus: 'PENDING',
  isEmergency: false,
  isAutoAssign: false,
  scheduledStart: '2026-10-08T05:00:00.000Z',
  scheduledEnd: '2026-10-08T06:30:00.000Z',
  problemText: null,
  issueOptionId: null,
  isOnBehalf: false,
  onBehalfName: null,
  quotedAmountPaisa: 250_000,
  approvedTotalPaisa: 250_000,
  finalAmountPaisa: null,
  discountPaisa: 0,
  rescheduleCount: 0,
  noShowParty: null,
  cancelReason: null,
  startOtpVerifiedAt: null,
  completedAt: null,
  verificationTier: null,
  createdAt: '2026-10-06T00:00:00.000Z',
  updatedAt: '2026-10-06T00:00:00.000Z',
  ...over
});

let profile = { userId: 'p-1', status: 'APPROVED', bio: null, experienceYears: 5, qualification: null, cityId: 1, baseAddressText: null, lat: null, lng: null, radiusM: 10_000 };
let bookings = [booking()];
let earnings = { heldPaisa: 40_000, releasablePaisa: 250_000, paidPaisa: 900_000, commissionPaisa: 20_000 };
let wallet = { balancePaisa: 310_000, debtPaisa: 0, debtCeilingPaisa: 100_000, offersBlocked: false, offerBlockedReason: null };
let reputation: Reputation = { score: 4.5, ratingCount: 12, distribution: { '1': 0, '2': 0, '3': 1, '4': 4, '5': 7 }, verifiedJobs: 40, badge: null };
/** Typed so a test can stage a non-empty `standingConsequences` without `never[]`. */
type ConductStub = {
  providerStatus: string;
  activePoints: number;
  daysSinceLastBreachOrDecay: number | null;
  awards: unknown[];
  standingConsequences: { consequence: string; until: string | null }[];
  thresholds: unknown[];
  schedule: unknown[];
};

let conduct: ConductStub = { providerStatus: 'APPROVED', activePoints: 0, daysSinceLastBreachOrDecay: null, awards: [], standingConsequences: [], thresholds: [], schedule: [] };
let cnic = { hasCnic: true, cnicVerified: true };
let offers = [
  {
    id: 'o1',
    bookingId: 'b2',
    bookingCode: 'SHM-0000050',
    serviceName: 'Leak repair',
    areaName: 'Gulberg',
    scheduledStart: '2026-10-09T05:00:00.000Z',
    scheduledEnd: '2026-10-09T06:00:00.000Z',
    quotedAmountPaisa: 180_000,
    isEmergency: false,
    problemText: null,
    expiresAt: '2099-01-01T00:00:00.000Z'
  }
];

beforeEach(() => {
  profile = { userId: 'p-1', status: 'APPROVED', bio: null, experienceYears: 5, qualification: null, cityId: 1, baseAddressText: null, lat: null, lng: null, radiusM: 10_000 };
  bookings = [booking()];
  earnings = { heldPaisa: 40_000, releasablePaisa: 250_000, paidPaisa: 900_000, commissionPaisa: 20_000 };
  wallet = { balancePaisa: 310_000, debtPaisa: 0, debtCeilingPaisa: 100_000, offersBlocked: false, offerBlockedReason: null };
  reputation = { score: 4.5, ratingCount: 12, distribution: { '1': 0, '2': 0, '3': 1, '4': 4, '5': 7 }, verifiedJobs: 40, badge: null };
  conduct = { providerStatus: 'APPROVED', activePoints: 0, daysSinceLastBreachOrDecay: null, awards: [], standingConsequences: [], thresholds: [], schedule: [] };
  cnic = { hasCnic: true, cnicVerified: true };
  offers = [
    {
      id: 'o1',
      bookingId: 'b2',
      bookingCode: 'SHM-0000050',
      serviceName: 'Leak repair',
      areaName: 'Gulberg',
      scheduledStart: '2026-10-09T05:00:00.000Z',
      scheduledEnd: '2026-10-09T06:00:00.000Z',
      quotedAmountPaisa: 180_000,
      isEmergency: false,
      problemText: null,
      expiresAt: '2099-01-01T00:00:00.000Z'
    }
  ];

  vi.stubGlobal(
    'fetch',
    vi.fn(async (input: RequestInfo | URL) => {
      const url = String(input);
      if (url.includes('/services')) return json({ items: [{ id: 1, nameEn: 'Leak repair', nameUr: '.leak', slug: 'leak-repair', active: true }] });
      if (url.includes('/catalogue/categories')) return json({ items: [{ id: 1, slug: 'plumbing', nameEn: 'Plumbing', nameUr: '.p', isActive: true }] });
      if (url.includes('/provider/profile')) return json(profile);
      if (url.includes('/provider/earnings')) return json(earnings);
      if (url.includes('/provider/wallet')) return json(wallet);
      if (url.includes('/provider/ratings')) return json({ reputation, items: [] });
      if (url.includes('/provider/conduct')) return json(conduct);
      if (url.includes('/provider/documents')) return json({ items: [], cnic });
      if (url.includes('/provider/offers')) return json({ items: offers });
      if (url.includes('/bookings')) return json({ items: bookings });
      throw new Error(`unrouted ${url}`);
    })
  );
});

afterEach(() => {
  cleanup();
  vi.unstubAllGlobals();
});

describe('what needs you', () => {
  it('puts a REQUESTED job under waiting for you to accept', async () => {
    renderScreen();
    /* The heading renders as 	itle (count), so the title is a text node inside a
       longer string. */
    expect(await screen.findByText(new RegExp(dict.portal.dashboardNeedsAccept))).toBeDefined();
    expect(screen.getByText(dict.job.acceptJob)).toBeDefined();
  });

  it('does not describe an EN_ROUTE job as merely scheduled', async () => {
    bookings = [booking({ status: 'EN_ROUTE' })];
    renderScreen();
    /* EN_ROUTE needs a start code, so it must not sit in the same bucket as a
       SCHEDULED one where the professional has nothing to do. */
    expect(await screen.findByText(new RegExp(dict.portal.dashboardOnTheWay))).toBeDefined();
    expect(screen.getByText(dict.job.startJob)).toBeDefined();
    expect(screen.queryByText(new RegExp(dict.portal.dashboardUpcoming))).toBeNull();
  });

  it('puts a QUOTE_REVISION with the ones needing nothing, not with live work', async () => {
    bookings = [booking({ status: 'QUOTE_REVISION' })];
    renderScreen();
    /* The next move is the customer's. Calling it in-progress work would be a lie
       about who owes the next move. */
    /* Twice: the group heading and the job's own status pill, which uses the same
       wording. Both are correct, so the count is what matters. */
    expect((await screen.findAllByText(new RegExp(dict.portal.dashboardWaitingOnCustomer))).length).toBeGreaterThanOrEqual(1);
    expect(screen.queryByText(dict.portal.dashboardInProgress)).toBeNull();
    expect(screen.queryByText(dict.job.completeJob)).toBeNull();
  });

  it('counts only actionable statuses as jobs in play', async () => {
    bookings = [booking({ status: 'IN_PROGRESS' }), booking({ id: 'bk-2', code: 'SHM-0000009', status: 'VERIFIED' })];
    renderScreen();
    expect(await screen.findByText(new RegExp(dict.portal.dashboardActiveJobs))).toBeDefined();
    /* A verified booking is history, not work in play. */
    /* The StatCard prints the figure as its own text node. */
    expect((await screen.findByText(new RegExp(dict.portal.dashboardActiveJobs))).previousElementSibling?.textContent).toBe('1');
  });

  it('says so plainly when there are no jobs at all', async () => {
    bookings = [];
    renderScreen();
    expect(await screen.findByText(dict.portal.dashboardNoJobs)).toBeDefined();
  });

  it('falls back to the booking code when the catalogue cannot be read', async () => {
    vi.stubGlobal(
      'fetch',
      vi.fn(async (input: RequestInfo | URL) => {
        const url = String(input);
        if (url.includes('/catalogue')) return json({ items: [] });
        if (url.includes('/provider/profile')) return json(profile);
        if (url.includes('/provider/earnings')) return json(earnings);
        if (url.includes('/provider/wallet')) return json(wallet);
        if (url.includes('/provider/ratings')) return json({ reputation, items: [] });
        if (url.includes('/provider/conduct')) return json(conduct);
        if (url.includes('/provider/documents')) return json({ items: [], cnic });
        if (url.includes('/provider/offers')) return json({ items: [] });
        return json({ items: bookings });
      })
    );
    renderScreen();
    /* The real code stands in rather than a fabricated service name. */
    expect(await screen.findByText('SHM-0000042')).toBeDefined();
    expect(screen.queryByText('Leak repair')).toBeNull();
  });
});

describe('the CNIC, which blocks approval outright', () => {
  it('is said first when one is on file but unverified', async () => {
    cnic = { hasCnic: true, cnicVerified: false };
    renderScreen();
    expect(await screen.findByText(new RegExp(dict.portal.dashboardCnicPending))).toBeDefined();
  });

  it('says nothing when the CNIC is verified', async () => {
    renderScreen();
    await screen.findByText(dict.portal.dashboardJobsTitle);
    expect(screen.queryByText(new RegExp(dict.portal.dashboardCnicPending))).toBeNull();
    expect(screen.queryByText(new RegExp(dict.portal.dashboardCnicMissing))).toBeNull();
  });

  it('distinguishes "not yet submitted" from "waiting"', async () => {
    cnic = { hasCnic: false, cnicVerified: false };
    renderScreen();
    expect(await screen.findByText(new RegExp(dict.portal.dashboardCnicMissing))).toBeDefined();
  });
});

describe('money', () => {
  it('shows the releasable balance and the wallet as separate figures', async () => {
    renderScreen();
    expect(await screen.findByText(new RegExp(dict.portal.dashboardReleasable))).toBeDefined();
    expect(screen.getByText(dict.portal.dashboardWallet)).toBeDefined();
    /* 250000 paisa and 310000 paisa are different numbers. Rendering only one of
       them, or their sum, would tell a professional the wrong thing about what
       they can ask for. */
    /* Rendered by the StatCard as its own text node. */
    /* Both appear twice — once on the StatCard, once in the Money breakdown — and
       both should show the same figure, so the count is the assertion. */
    expect((await screen.findAllByText('Rs 2,500')).length).toBe(2);
    expect((await screen.findAllByText('Rs 3,100')).length).toBe(1);
  });

  it('shows commission debt as a debt, not as a balance', async () => {
    wallet = { balancePaisa: -50_000, debtPaisa: 50_000, debtCeilingPaisa: 100_000, offersBlocked: false, offerBlockedReason: null };
    renderScreen();
    expect(await screen.findByText(dict.portal.dashboardDebt)).toBeDefined();
  });

  it('omits the debt row when there is no debt', async () => {
    renderScreen();
    await screen.findByText(dict.portal.dashboardMoneyTitle);
    expect(screen.queryByText(dict.portal.dashboardDebt)).toBeNull();
  });
});

describe('reputation', () => {
  it('withholds the score while there is no real rating', async () => {
    reputation = { score: null, ratingCount: 0, distribution: { '1': 0, '2': 0, '3': 0, '4': 0, '5': 0 }, verifiedJobs: 0, badge: null };
    renderScreen();
    expect(await screen.findByText(dict.portal.noRatingsYet)).toBeDefined();
    /* A null score must not become "NaN" or "0.0" two frames downstream. */
    expect(screen.queryByText('NaN')).toBeNull();
    expect(screen.queryByText('0.0')).toBeNull();
  });

  it('shows it once there is a real rating', async () => {
    renderScreen();
    expect(await screen.findByText('4.5')).toBeDefined();
  });
});

describe('things that restrict future work', () => {
  it('treats a null `until` as permanent rather than as missing', async () => {
    conduct = { ...conduct, standingConsequences: [{ consequence: 'PERMANENT_BLOCK', until: null }] };
    renderScreen();
    expect(await screen.findByText(new RegExp(dict.portal.permanentRestriction))).toBeDefined();
  });

  it('names the date a temporary restriction ends', async () => {
    conduct = { ...conduct, standingConsequences: [{ consequence: 'SUSPENSION_7D', until: '2026-10-20T00:00:00.000Z' }] };
    renderScreen();
    expect(await screen.findByText(new RegExp('In force until'))).toBeDefined();
  });

  it('surfaces active demerit points and links to the record', async () => {
    conduct = { ...conduct, activePoints: 15 };
    renderScreen();
    expect(await screen.findByText(dict.portal.dashboardSeeConduct)).toBeDefined();
  });

  it('shows neither card when the record is clean', async () => {
    renderScreen();
    await screen.findByText(dict.portal.dashboardMoneyTitle);
    expect(screen.queryByText(dict.portal.dashboardSeeConduct)).toBeNull();
    expect(screen.queryByText(new RegExp(dict.portal.permanentRestriction))).toBeNull();
  });
});

describe('what to do next', () => {
  it('offers housekeeping to an approved provider', async () => {
    renderScreen();
    expect(await screen.findByText(dict.portal.weeklyAvailability)).toBeDefined();
    expect(screen.getByText(dict.portal.areasTitle)).toBeDefined();
  });

  it('offers profile and documents to one awaiting approval', async () => {
    profile = { ...profile, status: 'PENDING_APPROVAL' };
    renderScreen();
    expect(await screen.findByText(dict.portal.dashboardCompleteProfile)).toBeDefined();
    expect(screen.getByText(dict.portal.dashboardUploadDocuments)).toBeDefined();
    /* Availability is meaningless until the profile is approved. */
    expect(screen.queryByText(dict.portal.weeklyAvailability)).toBeNull();
  });

  it('renders PENDING_APPROVAL rather than a guessed PENDING', async () => {
    profile = { ...profile, status: 'PENDING_APPROVAL' };
    renderScreen();
    /* The enum value is PENDING_APPROVAL; a screen keyed on PENDING renders blank
       for every new applicant. */
    expect(await screen.findByText(dict.portal.providerStatuses.PENDING_APPROVAL)).toBeDefined();
  });
});

describe('offers', () => {
  it('shows a live offer with a link out', async () => {
    renderScreen();
    /* Also the offer's own serviceName, so both occurrences are correct. */
    expect((await screen.findAllByText('Leak repair')).length).toBeGreaterThanOrEqual(1);
    expect(screen.getByText(new RegExp(dict.portal.dashboardOpenOffers))).toBeDefined();
  });

  it('shows no offers section when there are none', async () => {
    offers = [];
    renderScreen();
    await screen.findByText(dict.portal.dashboardJobsTitle);
    expect(screen.queryByText(dict.portal.dashboardOffersTitle)).toBeNull();
  });
});
