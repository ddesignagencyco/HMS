'use client';

import { ShieldCheck, UserRound } from 'lucide-react';
import { Card, PageHeader } from '@/components/ui';
import { maskEmail, maskPhone } from '@/features/auth/target';
import { useSession } from '@/features/auth/session';
import type { Dictionary } from '@/lib/dictionaries';
import type { Locale } from '@/lib/utils';

/* The customer's own profile.

   Everything on this screen comes from `GET /auth/me` — the one query the whole
   app already depends on — so there is no second source of truth for who the
   signed-in person is. The previous version rendered literals: "Ayesha Khan",
   "0300 1234567", "Gulberg III", none of which were the person looking at them.

   Two things this screen deliberately does *not* do:

   · **It shows a masked number (NFR-PR-01).** The full number is the person's own,
     but the same screen is reachable in contexts where it is shown to somebody
     else, and a screen that prints a full number is a screen that eventually
     leaks one. The masked form is also what every other screen in the product
     already renders.

   · **It offers no password change.** There is no authenticated password-update
     route on the API — see BACKEND_REQUIREMENTS.md §1. The security screen carries
     TOTP enrolment, which is the only self-service credential change that exists.
     A disabled button labelled "change password" would be a promise the backend
     cannot keep. */

type Row = { label: string; value: string | null };

export function ProfileDetails({ dict }: { dict: Dictionary }) {
  const { status, user } = useSession();

  if (status === 'loading') {
    return (
      <div aria-busy="true" aria-live="polite" className="grid gap-3">
        <span className="skeleton h-8 w-56 rounded-[9px]" />
        <span className="skeleton h-52 w-full rounded-[12px]" />
      </div>
    );
  }

  if (user === null) {
    /* The workspace gate normally sends an anonymous visitor to sign-in, so this
       is only reachable while a session is being torn down. Saying nothing beats
       rendering an empty shell labelled "profile". */
    return null;
  }

  const rows: Row[] = [
    { label: dict.auth.name, value: `${user.firstName} ${user.lastName}`.trim() },
    /* Both masked, and both degrade to the raw value only when there is too
       little of it to mask meaningfully. */
    { label: dict.auth.phone, value: user.phoneE164 === null ? null : maskPhone(user.phoneE164) },
    { label: dict.auth.email, value: user.email === null ? null : maskEmail(user.email) },
    { label: dict.portal.language, value: user.locale.toUpperCase() },
    /* `providerStatus` is hardcoded to `null` by the API today (BACKEND_REQUIREMENTS
       §1.2), so for a professional it renders "unknown" rather than a guess. */
    {
      label: dict.portal.providerStatus,
      value: user.providerStatus === null ? dict.portal.notPublished : user.providerStatus.replaceAll('_', ' ').toLowerCase()
    },
    { label: dict.portal.accountType, value: user.roles.join(', ') }
  ];

  return (
    <div>
      <PageHeader
        eyebrow={dict.portal.customer}
        title={dict.portal.profile}
        action={
          <span className="inline-flex min-h-11 items-center gap-2 rounded-[9px] border border-line px-4 text-sm font-semibold text-muted">
            <UserRound className="size-4" aria-hidden="true" />
            {dict.portal.profileManagedBySignup}
          </span>
        }
      />

      <div className="mt-6 grid gap-5 lg:grid-cols-[1fr_400px]">
        <Card className="p-6">
          <dl className="grid gap-4 text-sm">
            {rows.map((row, index) => (
              <div key={row.label} className={index === rows.length - 1 ? 'flex justify-between gap-4' : 'flex justify-between gap-4 border-b border-line pb-3'}>
                <dt className="text-muted">{row.label}</dt>
                <dd className="text-end font-medium text-navy">{row.value ?? dict.portal.notPublished}</dd>
              </div>
            ))}
          </dl>
          <p className="mt-5 text-xs leading-5 text-muted">{dict.portal.maskedDetailNote}</p>
        </Card>

        {/* FR-CU-09: deactivate anonymises PII, keeps bookings and the ledger.
            No endpoint exists for it yet, so it is stated as the policy rather than
            offered as a button that would do nothing. */}
        <Card className="p-6">
          <h2 className="font-semibold text-navy">{dict.portal.deactivateTitle}</h2>
          <p className="mt-2 text-sm leading-6 text-secondary">{dict.portal.deactivateText}</p>
          <ul className="mt-4 grid gap-2">
            {[dict.portal.deactivate1, dict.portal.deactivate2, dict.portal.deactivate3].map((line) => (
              <li key={line} className="flex items-start gap-2.5 text-sm leading-6 text-secondary">
                <ShieldCheck className="mt-0.5 size-4 shrink-0 text-emerald-600" aria-hidden="true" />
                {line}
              </li>
            ))}
          </ul>
          <p className="mt-6 rounded-[9px] border border-line bg-surface-2 p-3 text-sm leading-6 text-secondary">{dict.portal.deactivateUnavailable}</p>
          <p className="mt-3 text-xs text-muted">{dict.portal.deactivateHint}</p>
        </Card>
      </div>
    </div>
  );
}

/** Kept for the page signature; the screen no longer needs the locale. */
export type ProfileViewProps = { dict: Dictionary; locale?: Locale };
