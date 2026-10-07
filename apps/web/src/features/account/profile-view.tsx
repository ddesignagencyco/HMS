'use client';

import { useState } from 'react';
import { ShieldCheck, UserRound } from 'lucide-react';
import { Button, Card, PageHeader } from '@/components/ui';
import { Field } from '@/features/auth/auth-fields';
import { detailOf, toastError, toastSuccess } from '@/features/auth/auth-feedback';
import { maskEmail, maskPhone } from '@/features/auth/target';
import { useSession } from '@/features/auth/session';
import { useDeactivateAccount, useUpdateProfile } from '@/features/account/me-queries';
import type { ProfileUpdateInput } from '@/features/account/me-api';
import type { AuthUser } from '@/features/auth/api';
import { isLocale, type Locale } from '@/lib/utils';
import type { Dictionary } from '@/lib/dictionaries';

/* The signed-in person's own profile.
 *
 * Every field here comes from `GET /auth/session` — the one query the whole app
 * already depends on — so there is no second source of truth for who is looking at
 * this screen. The previous version rendered literals: "Ayesha Khan",
 * "0300 1234567", "Gulberg III", none of which were the person looking at them.
 *
 * What changed when `PATCH /me` arrived (me.controller.ts → me.service.ts):
 *
 * · **First name, last name and language are editable.** The screen used to say
 *   they "cannot be edited here" and show a badge instead. They can. The badge is
 *   gone and there is a real form that writes through the API, with the response's
 *   fresh `AuthenticatedUser` written into the session cache — so the header, which
 *   renders this name, is right immediately rather than on the next reload.
 *
 * · **The phone number and email still are not editable, and that is stated.**
 *   They are login identifiers: `profileUpdateSchema` is `.strict()` and does not
 *   accept them, and they change through the OTP flow. A disabled field with a
 *   label saying why is honest; an input that accepted typing and silently
 *   discarded it would not be.
 *
 * · **Deactivation is a real button.** `POST /me/deactivate` anonymises the name,
 *   phone and email, drops TOTP and revokes every session, while bookings and
 *   ledger rows stay — they are financial records (FR-CU-08/09). The screen states
 *   exactly that, asks for confirmation inline (not `window.confirm`, so the
 *   consequence is readable and dismissible with the keyboard), and ends the local
 *   session on success.
 *
 * Masking stays (NFR-PR-01): the full number belongs to the person reading it, but
 * a screen that prints one in full is a screen that eventually leaks one. */

type Row = { label: string; value: string | null };

/** The three keys `PATCH /me` accepts, and the only ones this form ever sends. */
type ProfileUpdateKey = 'firstName' | 'lastName' | 'locale';

/** `locale` on the authenticated user is a string; `PATCH /me` wants the union. */
const asLocale = (value: string): Locale => (isLocale(value) ? value : 'en');

export function ProfileDetails({ dict, locale = 'en' }: { dict: Dictionary; locale?: Locale }) {
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

  return (
    <div>
      <PageHeader
        eyebrow={dict.portal.customer}
        title={dict.portal.profile}
        action={
          <span className="inline-flex min-h-11 items-center gap-2 rounded-[9px] border border-line px-4 text-sm font-semibold text-muted">
            <UserRound className="size-4" aria-hidden="true" />
            {dict.portal.profileEditContactLocked}
          </span>
        }
      />

      <div className="mt-6 grid gap-5 lg:grid-cols-[1fr_400px]">
        <div className="grid gap-5">
          {/* The editable half is its own component so its state is *initialised*
              from the user rather than synchronised to it. An effect that copied
              props into state on every change is the documented cascading-render
              anti-pattern, and this form genuinely needs the reset: a successful
              save replaces the session user, and the fields must follow it to the
              new name. Remounting on that value is the honest way to say "this
              form belongs to this version of the name". */}
          <ProfileNameForm key={nameKey(user)} user={user} locale={locale} dict={dict} />
          <ContactCard user={user} dict={dict} />
        </div>

        <DeactivateCard locale={locale} dict={dict} />
      </div>
    </div>
  );
}

/** Changes when anything the form is seeded from changes — including a save. */
const nameKey = (user: AuthUser): string => `${user.firstName} | ${user.lastName} | ${user.locale}`;

function ProfileNameForm({ user, locale, dict }: { user: AuthUser; locale: Locale; dict: Dictionary }) {
  const save = useUpdateProfile(locale);
  const [firstName, setFirstName] = useState(user.firstName);
  const [lastName, setLastName] = useState(user.lastName);
  const [language, setLanguage] = useState<Locale>(asLocale(user.locale));

  const onSave = async (): Promise<void> => {
    /* Only what changed is sent. An empty patch is a 422 —
       `profileUpdateSchema` refuses `Object.keys(input).length === 0` — and
       resending unchanged fields would make a no-op save look like an edit. */
    const input: Partial<Record<ProfileUpdateKey, string>> = {};
    if (firstName.trim() !== user.firstName) input.firstName = firstName.trim();
    if (lastName.trim() !== user.lastName) input.lastName = lastName.trim();
    if (asLocale(user.locale) !== language) input.locale = language;

    if (Object.keys(input).length === 0) return;

    try {
      /* The union on `ProfileUpdateInput` exists so that an empty patch is not
         expressible in the type. This is that same check, three lines up — the
         cast is where the guarantee is cashed in, not a way around it. */
      await save.mutateAsync(input as ProfileUpdateInput);
      toastSuccess(dict.portal.profileSaved);
    } catch (error) {
      toastError(detailOf(error, dict));
    }
  };

  return (
    <Card className="p-6">
      <h2 className="font-semibold text-navy">{dict.portal.profileEditName}</h2>
      <p className="mt-1.5 text-sm leading-6 text-secondary">{dict.portal.profileEditNameNote}</p>

      <div className="mt-4 grid gap-3 sm:grid-cols-2">
        <Field label={dict.auth.firstName} value={firstName} onChange={(event) => setFirstName(event.target.value)} autoComplete="given-name" maxLength={80} />
        <Field label={dict.auth.lastNameOptional} value={lastName} onChange={(event) => setLastName(event.target.value)} autoComplete="family-name" maxLength={80} />
      </div>

      {/* `locale` is the only other writable field, and it is an enum of two — a
          select, not a free-text box that could send the third value and be
          refused. */}
      <div className="mt-3">
        <label htmlFor="profile-language" className="text-[11.5px] font-semibold text-slate-800">
          {dict.portal.language}
        </label>
        <select
          id="profile-language"
          value={language}
          onChange={(event) => setLanguage(event.target.value as Locale)}
          className="mt-1 min-h-[38px] w-full rounded-[8px] border border-slate-200 bg-white px-3 text-[13.5px] text-navy outline-none focus:border-primary sm:w-64"
        >
          <option value="en">English</option>
          <option value="ur">اردو</option>
        </select>
      </div>

      <div className="mt-4 flex flex-wrap items-center gap-3">
        <Button type="button" disabled={save.isPending} onClick={() => void onSave()}>
          {save.isPending ? dict.portal.saving : dict.portal.save}
        </Button>
        <p className="text-xs leading-5 text-muted">{dict.portal.profileManagedBySignup}</p>
      </div>
    </Card>
  );
}

function ContactCard({ user, dict }: { user: AuthUser; dict: Dictionary }) {
  const rows: Row[] = [
    /* Both masked, and both degrade to the raw value only when there is too
       little of it to mask meaningfully. */
    { label: dict.auth.phone, value: user.phoneE164 === null ? null : maskPhone(user.phoneE164) },
    { label: dict.auth.email, value: user.email === null ? null : maskEmail(user.email) },
    /* `providerStatus` is published by the API on the authenticated user, and it is
       null for anyone who is not a professional. A null is shown as such rather
       than being turned into a guess at an approval state. */
    {
      label: dict.portal.providerStatus,
      value: user.providerStatus === null ? dict.portal.notPublished : user.providerStatus.replaceAll('_', ' ').toLowerCase()
    },
    { label: dict.portal.accountType, value: user.roles.join(', ') }
  ];

  return (
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
  );
}

/** FR-CU-09: deactivation anonymises the PII and keeps the bookings and the
    ledger. `POST /me/deactivate` is that endpoint, so this is a control with its
    consequence written out, rather than a paragraph about a policy the platform
    cannot carry out. */
function DeactivateCard({ locale, dict }: { locale: Locale; dict: Dictionary }) {
  const deactivate = useDeactivateAccount(locale);
  const [confirming, setConfirming] = useState(false);

  const onDeactivate = async (): Promise<void> => {
    try {
      await deactivate.mutateAsync();
      toastSuccess(dict.portal.deactivateDone);
      setConfirming(false);
    } catch (error) {
      /* A 409 here is "already deactivated" — the account is in the state they
         asked for and this browser simply had not been told. Nothing local is
         patched: the session query is the authority, and the gate will re-read it
         on the next navigation. */
      toastError(detailOf(error, dict));
      setConfirming(false);
    }
  };

  return (
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

      <div className="mt-6">
        {confirming ? (
          <div role="group" aria-label={dict.portal.deactivate} className="rounded-[9px] border border-rose-200 bg-rose-50 p-3">
            <p className="text-sm leading-6 text-rose-800">{dict.portal.deactivateConfirm}</p>
            <div className="mt-3 flex flex-wrap gap-2">
              <Button type="button" disabled={deactivate.isPending} onClick={() => void onDeactivate()} className="bg-rose-700 hover:bg-rose-800">
                {dict.portal.deactivateConfirmYes}
              </Button>
              <Button type="button" variant="secondary" onClick={() => setConfirming(false)}>
                {dict.common.cancel}
              </Button>
            </div>
          </div>
        ) : (
          <Button type="button" variant="secondary" onClick={() => setConfirming(true)}>
            {dict.portal.deactivate}
          </Button>
        )}
      </div>

      <p className="mt-3 text-xs text-muted">{dict.portal.deactivateHint}</p>
    </Card>
  );
}

export type ProfileViewProps = { dict: Dictionary; locale?: Locale };
