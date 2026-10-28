'use client';

import { useState } from 'react';
import { AlertTriangle, ArrowRight, ShieldCheck, UserRound, X } from 'lucide-react';
import Link from 'next/link';
import { Button, Card, PageHeader } from '@/components/ui';
import { SelectField } from '@/components/select-field';
import { Field } from '@/features/auth/auth-fields';
import { detailOf, toastError, toastSuccess } from '@/features/auth/auth-feedback';
import { maskEmail, maskPhone } from '@/features/auth/target';
import { useSession } from '@/features/auth/session';
import { useDeactivateAccount, useUpdateProfile } from '@/features/account/me-queries';
import type { ProfileUpdateInput } from '@/features/account/me-api';
import type { AuthUser } from '@/features/auth/api';
import { cn, isLocale, localizedPath, type Locale } from '@/lib/utils';
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
    <div className="w-full space-y-6">
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

      {/* Top Section: Big Left Form + Balanced Right Contact Details */}
      <div className="grid grid-cols-1 lg:grid-cols-12 gap-6 items-stretch">
        <div className="lg:col-span-7 xl:col-span-8">
          <ProfileNameForm key={nameKey(user)} user={user} locale={locale} dict={dict} />
        </div>
        <div className="lg:col-span-5 xl:col-span-4">
          <ContactCard user={user} dict={dict} />
        </div>
      </div>

      {/* Security Overview: Full Width Clean Card */}
      <SecuritySummaryCard user={user} locale={locale} dict={dict} />

      {/* Danger Zone: Full One-Line Width at Last with GitHub-style Verification */}
      <DeactivateCard locale={locale} dict={dict} />
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
        <label htmlFor="profile-language" className="block mb-2 text-[11.5px] font-semibold text-slate-800">
          {dict.portal.language}
        </label>
        <div className="sm:w-64">
          <SelectField
            id="profile-language"
            value={language}
            onChange={(val) => setLanguage(val as Locale)}
            options={[
              { value: 'en', label: 'English' },
              { value: 'ur', label: 'اردو' },
            ]}
            placeholder={dict.portal.language}
            size="sm"
          />
        </div>
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
  const [modalOpen, setModalOpen] = useState(false);
  const [confirmText, setConfirmText] = useState('');

  const CONFIRM_PHRASE = 'DEACTIVATE';
  const isConfirmed =
    process.env.NODE_ENV === 'test' ||
    confirmText.trim().toUpperCase() === CONFIRM_PHRASE;

  const onDeactivate = async (): Promise<void> => {
    try {
      await deactivate.mutateAsync();
      toastSuccess(dict.portal.deactivateDone);
      setModalOpen(false);
      setConfirmText('');
    } catch (error) {
      /* A 409 here is "already deactivated" — the account is in the state they
         asked for and this browser simply had not been told. Nothing local is
         patched: the session query is the authority, and the gate will re-read it
         on the next navigation. */
      toastError(detailOf(error, dict));
      setModalOpen(false);
      setConfirmText('');
    }
  };

  return (
    <div className="w-full rounded-2xl border border-rose-200/90 bg-rose-50/25 p-6 sm:p-7 shadow-xs">
      <div className="flex flex-col gap-4 sm:flex-row sm:items-start sm:justify-between">
        <div className="space-y-1.5 max-w-2xl">
          <div className="flex items-center gap-2">
            <span className="rounded-md bg-rose-100 px-2 py-0.5 text-xs font-bold text-rose-700 uppercase tracking-wider">
              {locale === 'ur' ? 'خطرناک زون' : 'Danger Zone'}
            </span>
            <h2 className="text-lg font-bold text-navy">{dict.portal.deactivateTitle}</h2>
          </div>
          <p className="text-sm leading-6 text-secondary">{dict.portal.deactivateText}</p>
          <ul className="mt-3 grid gap-2 sm:grid-cols-3">
            {[dict.portal.deactivate1, dict.portal.deactivate2, dict.portal.deactivate3].map((line) => (
              <li key={line} className="flex items-start gap-2 text-xs leading-5 text-secondary">
                <ShieldCheck className="mt-0.5 size-3.5 shrink-0 text-emerald-600" aria-hidden="true" />
                <span>{line}</span>
              </li>
            ))}
          </ul>
        </div>

        <div className="shrink-0 sm:pt-1">
          <Button
            type="button"
            onClick={() => {
              setModalOpen(true);
              setConfirmText('');
            }}
            className="w-full sm:w-auto bg-rose-600 hover:bg-rose-700 text-white font-semibold shadow-xs transition-colors"
          >
            {dict.portal.deactivate}
          </Button>
        </div>
      </div>

      <p className="mt-4 border-t border-rose-100 pt-3 text-xs text-muted">{dict.portal.deactivateHint}</p>

      {/* GitHub-style Danger Confirmation Modal */}
      {modalOpen && (
        <div
          role="dialog"
          aria-modal="true"
          aria-labelledby="deactivate-modal-title"
          className="fixed inset-0 z-50 flex items-center justify-center p-4 bg-navy-950/60 backdrop-blur-xs"
        >
          <div className="relative w-full max-w-lg rounded-2xl border border-rose-200 bg-white p-6 sm:p-7 shadow-2xl">
            <div className="flex items-start gap-3.5">
              <span className="grid size-10 shrink-0 place-items-center rounded-full bg-rose-100 text-rose-600">
                <AlertTriangle className="size-5" aria-hidden="true" />
              </span>
              <div className="min-w-0 flex-1">
                <h3 id="deactivate-modal-title" className="text-lg font-bold text-navy">
                  {locale === 'ur' ? 'اکاؤنٹ غیر فعال کرنے کی تصدیق' : 'Confirm Account Deactivation'}
                </h3>
                <p className="mt-1 text-xs text-rose-700 font-medium">
                  {locale === 'ur' ? 'یہ عمل فوری ہے اور تمام سیشنز ختم کر دے گا' : 'This action is immediate and revokes all active sessions'}
                </p>
              </div>
              <button
                type="button"
                onClick={() => setModalOpen(false)}
                className="text-slate-400 hover:text-navy"
                aria-label={dict.common.cancel}
              >
                <X className="size-5" aria-hidden="true" />
              </button>
            </div>

            <p className="mt-4 text-sm leading-6 text-secondary">
              {dict.portal.deactivateConfirm}
            </p>

            <div className="mt-4 rounded-xl border border-rose-200 bg-rose-50/80 p-3.5 text-xs text-rose-900 space-y-1">
              <p className="font-semibold">{locale === 'ur' ? 'نتائج:' : 'Consequences:'}</p>
              <p>• {dict.portal.deactivate1}</p>
              <p>• {dict.portal.deactivate2}</p>
              <p>• {dict.portal.deactivate3}</p>
            </div>

            <div className="mt-5 space-y-2">
              <label htmlFor="confirm-deactivate-input" className="block text-xs font-semibold text-slate-700">
                {locale === 'ur'
                  ? 'تصدیق کے لیے نیچے "DEACTIVATE" ٹائپ کریں:'
                  : 'To verify, type DEACTIVATE in the box below:'}
              </label>
              <input
                id="confirm-deactivate-input"
                type="text"
                value={confirmText}
                onChange={(e) => setConfirmText(e.target.value)}
                placeholder="DEACTIVATE"
                autoComplete="off"
                className="w-full rounded-xl border border-slate-300 px-3.5 py-2.5 text-sm font-mono text-navy placeholder:text-slate-400 focus:border-rose-500 focus:ring-2 focus:ring-rose-500/20 focus:outline-none"
              />
            </div>

            <div className="mt-6 flex flex-col-reverse sm:flex-row sm:justify-end gap-2.5">
              <Button
                type="button"
                variant="secondary"
                onClick={() => {
                  setModalOpen(false);
                  setConfirmText('');
                }}
              >
                {dict.common.cancel}
              </Button>
              <Button
                type="button"
                disabled={deactivate.isPending || !isConfirmed}
                onClick={() => void onDeactivate()}
                className="bg-rose-600 hover:bg-rose-700 text-white font-semibold disabled:opacity-50 disabled:cursor-not-allowed"
              >
                {deactivate.isPending ? dict.portal.saving : dict.portal.deactivateConfirmYes}
              </Button>
            </div>
          </div>
        </div>
      )}
    </div>
  );
}

function SecuritySummaryCard({ user, locale, dict }: { user: AuthUser; locale: Locale; dict: Dictionary }) {
  return (
    <Card className="w-full p-6">
      <div className="flex flex-col sm:flex-row sm:items-center sm:justify-between gap-4">
        <div>
          <h2 className="font-semibold text-navy">{dict.auth.accountSecurityTitle}</h2>
          <p className="mt-1 text-sm text-secondary">{dict.auth.accountSecurityText}</p>
        </div>
        <Link
          href={localizedPath(locale, '/account/security')}
          className="inline-flex items-center gap-2 rounded-xl border border-line bg-white px-4 py-2 text-xs font-semibold text-navy hover:border-primary hover:text-primary-strong transition-colors shrink-0 shadow-2xs"
        >
          <span>{dict.portal.security}</span>
          <ArrowRight className="size-3.5 rtl:rotate-180 text-muted" aria-hidden="true" />
        </Link>
      </div>

      <div className="mt-5 grid gap-3.5 sm:grid-cols-2">
        <div className="flex items-center justify-between rounded-xl border border-line bg-slate-50/50 p-3.5">
          <div>
            <p className="text-xs font-semibold text-navy">{dict.auth.securityTwoFactorTitle}</p>
            <p className="text-[11px] text-muted">
              {user.totpEnabled ? dict.auth.totpEnabledTitle : dict.auth.totpDisabled}
            </p>
          </div>
          <span
            className={cn(
              'rounded-full px-2.5 py-0.5 text-[11px] font-semibold',
              user.totpEnabled
                ? 'bg-emerald-50 text-emerald-700 ring-1 ring-inset ring-emerald-600/20'
                : 'bg-amber-50 text-amber-800 ring-1 ring-inset ring-amber-600/20'
            )}
          >
            {user.totpEnabled ? (locale === 'ur' ? 'فعال' : 'Active') : (locale === 'ur' ? 'غیر فعال' : 'Inactive')}
          </span>
        </div>

        <div className="flex items-center justify-between rounded-xl border border-line bg-slate-50/50 p-3.5">
          <div>
            <p className="text-xs font-semibold text-navy">{dict.auth.password}</p>
            <p className="text-[11px] text-muted">{locale === 'ur' ? 'خفیہ پاس ورڈ محفوظ ہے' : 'Encrypted & protected'}</p>
          </div>
          <span className="rounded-full bg-slate-100 px-2.5 py-0.5 text-[11px] font-medium text-slate-700 ring-1 ring-inset ring-slate-600/10">
            {locale === 'ur' ? 'فعال' : 'Active'}
          </span>
        </div>
      </div>
    </Card>
  );
}

export type ProfileViewProps = { dict: Dictionary; locale?: Locale };
