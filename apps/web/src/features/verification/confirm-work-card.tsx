'use client';

import { CheckCircle2, Info, PhoneCall, ShieldCheck } from 'lucide-react';
import { useRouter } from 'next/navigation';
import { useEffect, useId, useRef, useState, type ReactNode } from 'react';
import { Button, Card, Textarea } from '@/components/ui';
import type { Booking } from '@/features/booking/api';
import { ApiError } from '@/lib/api/problem';
import { isNotFoundError } from '@/lib/api/keys';
import type { Dictionary } from '@/lib/dictionaries';
import { cn, formatMoney, localizedPath, type Locale } from '@/lib/utils';
import {
  MAX_SELF_CONFIRMATION_REMARK,
  type SelfConfirmationAnswers,
  type SelfConfirmationChoice,
  type SelfConfirmationForm,
  type SelfConfirmationQuestion,
  type SelfConfirmationResult,
  type WorkCompleted
} from './api';
import { useSelfConfirmation, useSubmitSelfConfirmation } from './queries';

/* FR-VC-16 — "Confirm the work", on the customer's booking page.

   Read `docs-final/DIRECTION_FRONTEND_CONFIRM_THE_WORK.md` before changing this.
   The rules that shape it:

   · **Shown from `booking.canSelfVerify`, filled in from `canSubmit`.** The GET
     is always 200 for the customer's own booking; an unavailable form is a
     `blockedReason` to show, never an error to render.
   · **The rating and the release are one act.** There is no separate "rate your
     provider" anywhere, and nothing here is editable after it is sent.
   · **The client does not decide the outcome.** "No work was done" or "extra
     money was demanded" forces the problem path and clears the consent, because
     the server escalates those whatever was chosen and 422s the contradiction.
   · **Consent is its own explicit tick**, never folded into the submit button.
   · **The server's `message` is rendered verbatim** on all three outcomes, and a
     cash job never shows a "paid" state from this response.
   · **ESCALATED is reassurance, not failure.** No red, no retry, no second go.
   · **A 409 is routine.** The state moved; re-read it and show `detail`. */

export const CONFIRM_WORK_ANCHOR = 'confirm-work';

const RATING_KEYS = ['quality', 'punctuality', 'conduct', 'cleanliness'] as const;
type RatingKey = (typeof RATING_KEYS)[number];
const SCORES = [1, 2, 3, 4, 5] as const;

/** Fields a 422 can name, so its `errors[].path` lands against the right input. */
type FieldKey = 'workCompleted' | RatingKey | 'extraChargeDemanded' | 'outcome' | 'consentToRelease' | 'remark';
const FIELD_KEYS: readonly FieldKey[] = ['workCompleted', ...RATING_KEYS, 'extraChargeDemanded', 'outcome', 'consentToRelease', 'remark'];

const RELEASING: readonly SelfConfirmationChoice[] = ['SATISFIED', 'WITH_ISSUE'];

/* The defaults the server publishes today, used only when a question is missing
   its `answers`. The order and the presence of each question is the server's. */
const DEFAULT_QUESTIONS: SelfConfirmationQuestion[] = [
  { key: 'workCompleted', label: '', answers: ['FULL', 'PARTIAL', 'NONE'] },
  { key: 'ratings', label: '' },
  { key: 'extraChargeDemanded', label: '', answers: [true, false] },
  { key: 'choice', label: '', answers: ['SATISFIED', 'WITH_ISSUE', 'NOT_ACCEPTABLE'] }
];

/* ---- An answered ESCALATED form, remembered per browser ---------------------
   After an escalation the booking stays AWAITING_VERIFICATION and the server's
   GET answers `canSubmit: true` again — nothing there records that the customer
   already answered (logged for the backend in docs/backend_requirement.md). The
   form is single-use per job, so until the API says so itself, this browser
   remembers the answer and shows the reassurance instead of a fresh form. */

type RememberedEscalation = { message: string; amountPaisa: number | null; paymentMode: 'ONLINE' | 'CASH' };

const escalationKey = (bookingId: string) => `shm.confirmWork.escalated.${bookingId}`;

const readEscalation = (bookingId: string): RememberedEscalation | null => {
  try {
    const raw = window.localStorage.getItem(escalationKey(bookingId));
    return raw === null ? null : (JSON.parse(raw) as RememberedEscalation);
  } catch {
    return null;
  }
};

const rememberEscalation = (bookingId: string, value: RememberedEscalation): void => {
  try {
    window.localStorage.setItem(escalationKey(bookingId), JSON.stringify(value));
  } catch {
    /* Private mode or full storage: the in-memory result still shows this visit. */
  }
};

/* ---- The section the booking page renders --------------------------------- */

/** `answers` is null only for an escalation remembered from an earlier visit, which shows no rating. */
type Settled = { result: SelfConfirmationResult; answers: SelfConfirmationAnswers | null; amountPaisa: number | null };

export function ConfirmWorkSection({
  locale,
  dict,
  booking,
  onRaiseComplaint
}: {
  locale: Locale;
  dict: Dictionary;
  booking: Booking;
  /** Opens the booking page's own complaint form — offered after an escalation, never forced. */
  onRaiseComplaint: () => void;
}) {
  /* Held here rather than in the form: a submission moves the booking on, the
     refetched row says `canSelfVerify: false`, and the thank-you must outlive the
     flag that put the form on screen. */
  const [settled, setSettled] = useState<Settled | null>(null);
  const [movedOn, setMovedOn] = useState<string | null>(null);
  /* The booking is read client-side only, so this never runs during SSR. */
  const [remembered] = useState<RememberedEscalation | null>(() => readEscalation(booking.id));

  /* An escalation that has since been worked moves the booking out of
     AWAITING_VERIFICATION; the remembered answer is spent then. */
  useEffect(() => {
    if (!booking.canSelfVerify && remembered !== null && settled === null) {
      try {
        window.localStorage.removeItem(escalationKey(booking.id));
      } catch {
        /* nothing to clean */
      }
    }
  }, [booking.canSelfVerify, booking.id, remembered, settled]);

  const visible = booking.canSelfVerify || settled !== null || movedOn !== null;

  const headingRef = useRef<HTMLHeadingElement>(null);
  /* `/account/bookings/:id#confirm-work` is the entry point the list and the
     dashboard link to: land on the card, focused, not at the top of the page. */
  useEffect(() => {
    if (!visible || typeof window === 'undefined' || window.location.hash !== `#${CONFIRM_WORK_ANCHOR}`) return;
    const heading = headingRef.current;
    if (heading === null) return;
    heading.scrollIntoView?.({ block: 'start', behavior: 'smooth' });
    heading.focus({ preventScroll: true });
  }, [visible]);

  if (!visible) return null;

  let body: ReactNode;
  if (settled !== null) {
    body = <OutcomePanel locale={locale} dict={dict} settled={settled} onRaiseComplaint={onRaiseComplaint} />;
  } else if (remembered !== null && booking.canSelfVerify) {
    body = (
      <OutcomePanel
        locale={locale}
        dict={dict}
        settled={{
          result: { outcome: 'ESCALATED', bookingId: booking.id, bookingStatus: booking.status, message: remembered.message, booking },
          answers: null,
          amountPaisa: remembered.amountPaisa
        }}
        onRaiseComplaint={onRaiseComplaint}
      />
    );
  } else if (!booking.canSelfVerify && movedOn !== null) {
    body = <Notice tone="info" icon={Info} title={dict.confirmWork.movedOnTitle} text={movedOn} />;
  } else {
    body = (
      <ConfirmWorkForm
        locale={locale}
        dict={dict}
        booking={booking}
        movedOn={movedOn}
        onMovedOn={setMovedOn}
        onSettled={(next) => {
          if (next.result.outcome === 'ESCALATED') {
            rememberEscalation(booking.id, { message: next.result.message, amountPaisa: next.amountPaisa, paymentMode: next.result.booking.paymentMode });
          }
          setMovedOn(null);
          setSettled(next);
        }}
      />
    );
  }

  return (
    <section id={CONFIRM_WORK_ANCHOR} aria-labelledby={`${CONFIRM_WORK_ANCHOR}-title`} className="scroll-mt-24">
    <Card className="border-primary/30 p-5 shadow-sm ring-1 ring-primary/10 sm:p-6">
      <p className="text-xs font-semibold uppercase tracking-wide text-primary-strong">{dict.confirmWork.eyebrow}</p>
      <h2 id={`${CONFIRM_WORK_ANCHOR}-title`} ref={headingRef} tabIndex={-1} className="mt-1 text-lg font-semibold text-navy focus:outline-none">
        {dict.confirmWork.title}
      </h2>
      <div className="mt-4">{body}</div>
    </Card>
    </section>
  );
}

/* ---- The form ---------------------------------------------------------------- */

function ConfirmWorkForm({
  locale,
  dict,
  booking,
  movedOn,
  onMovedOn,
  onSettled
}: {
  locale: Locale;
  dict: Dictionary;
  booking: Booking;
  movedOn: string | null;
  onMovedOn: (detail: string | null) => void;
  onSettled: (settled: Settled) => void;
}) {
  const t = dict.confirmWork;
  const router = useRouter();
  const form = useSelfConfirmation(booking.id, true, locale);
  const submit = useSubmitSelfConfirmation(booking.id, locale);
  const formId = useId();

  const [workCompleted, setWorkCompleted] = useState<WorkCompleted | null>(null);
  const [ratings, setRatings] = useState<Record<RatingKey, number | null>>({ quality: null, punctuality: null, conduct: null, cleanliness: null });
  const [extraCharge, setExtraCharge] = useState<boolean | null>(null);
  const [choice, setChoice] = useState<SelfConfirmationChoice | null>(null);
  const [consent, setConsent] = useState(false);
  const [remark, setRemark] = useState('');
  const [errors, setErrors] = useState<Partial<Record<FieldKey, string>>>({});
  const [formError, setFormError] = useState('');

  /* Someone else's booking is indistinguishable from a missing one: route away. */
  const notFound = isNotFoundError(form.error) || (submit.error instanceof ApiError && submit.error.status === 404);
  useEffect(() => {
    if (notFound) router.replace(localizedPath(locale, '/account/bookings'));
  }, [notFound, router, locale]);

  if (form.isPending) {
    return (
      <div aria-busy="true" aria-live="polite" className="grid gap-3">
        <span className="sr-only">{t.loading}</span>
        <span className="skeleton h-4 w-3/4 rounded-[9px]" />
        <span className="skeleton h-24 w-full rounded-[12px]" />
      </div>
    );
  }

  if (form.isError) {
    if (notFound) return null;
    return (
      <div className="grid gap-3">
        <p className="text-sm leading-6 text-secondary">{t.loadFailed}</p>
        <div>
          <Button type="button" variant="secondary" size="sm" onClick={() => void form.refetch()}>
            {t.retryLoad}
          </Button>
        </div>
      </div>
    );
  }

  const data: SelfConfirmationForm = form.data;
  const cash = data.paymentMode === 'CASH';
  const amount = data.amountPaisa === null ? null : formatMoney(data.amountPaisa, locale);
  const provider = data.providerFirstName ?? t.providerFallback;

  /* Unavailable is an answer, not an error: the server's sentence, no button,
     and nothing styled as a failure. Whether it reads as "settled" or "wait for
     us" comes from the booking's own money state, never from the string. */
  if (!data.canSubmit) {
    const paid = booking.paymentStatus === 'RELEASED' || booking.paymentStatus === 'CASH_SETTLED';
    return (
      <div className="grid gap-3">
        {movedOn !== null ? <p className="text-sm leading-6 text-secondary">{movedOn}</p> : null}
        <Notice
          tone={paid ? 'success' : 'info'}
          icon={paid ? CheckCircle2 : PhoneCall}
          title={paid ? t.settledTitle : t.unavailableTitle}
          text={data.blockedReason ?? ''}
        />
      </div>
    );
  }

  const questions = data.questions.length > 0 ? data.questions : DEFAULT_QUESTIONS;
  const question = <K extends SelfConfirmationQuestion['key']>(key: K) =>
    (questions.find((entry) => entry.key === key) ?? DEFAULT_QUESTIONS.find((entry) => entry.key === key)) as Extract<SelfConfirmationQuestion, { key: K }>;

  /* The integrity guard, mirrored so the form cannot express a contradiction the
     server would 422: either answer forces "not acceptable". */
  const forced: 'noWork' | 'extraCharge' | null = workCompleted === 'NONE' ? 'noWork' : extraCharge === true ? 'extraCharge' : null;
  const effectiveChoice: SelfConfirmationChoice | null = forced !== null ? 'NOT_ACCEPTABLE' : choice;
  const releasing = effectiveChoice !== null && RELEASING.includes(effectiveChoice);

  const clearError = (...keys: FieldKey[]) =>
    setErrors((current) => {
      const next = { ...current };
      for (const key of keys) delete next[key];
      return next;
    });

  const pickWork = (value: WorkCompleted) => {
    setWorkCompleted(value);
    /* Forcing the problem path takes the consent with it, so it cannot come back
       already ticked if the customer changes their mind. */
    if (value === 'NONE') setConsent(false);
    clearError('workCompleted', 'outcome', 'consentToRelease');
  };
  const pickExtra = (value: boolean) => {
    setExtraCharge(value);
    if (value) setConsent(false);
    clearError('extraChargeDemanded', 'outcome', 'consentToRelease');
  };
  const pickChoice = (value: SelfConfirmationChoice) => {
    setChoice(value);
    if (!RELEASING.includes(value)) setConsent(false);
    clearError('outcome', 'consentToRelease');
  };
  const pickScore = (key: RatingKey, value: number) => {
    setRatings((current) => ({ ...current, [key]: value }));
    clearError(key);
  };

  const validate = (): Partial<Record<FieldKey, string>> => {
    const found: Partial<Record<FieldKey, string>> = {};
    if (workCompleted === null) found.workCompleted = t.required.workCompleted;
    /* All four, always — including on the "not acceptable" path. */
    for (const key of RATING_KEYS) if (ratings[key] === null) found[key] = t.required.ratings;
    if (extraCharge === null) found.extraChargeDemanded = t.required.extraChargeDemanded;
    if (effectiveChoice === null) found.outcome = t.required.outcome;
    if (releasing && !consent) found.consentToRelease = t.required.consentToRelease;
    return found;
  };

  const onSubmit = async () => {
    setFormError('');
    onMovedOn(null);
    const found = validate();
    setErrors(found);
    if (Object.keys(found).length > 0) {
      setFormError(t.fixErrors);
      return;
    }

    const answers: SelfConfirmationAnswers = {
      workCompleted: workCompleted as WorkCompleted,
      quality: ratings.quality as number,
      punctuality: ratings.punctuality as number,
      conduct: ratings.conduct as number,
      cleanliness: ratings.cleanliness as number,
      extraChargeDemanded: extraCharge as boolean,
      consentToRelease: releasing && consent,
      outcome: effectiveChoice as SelfConfirmationChoice,
      remark
    };

    try {
      const result = await submit.mutateAsync(answers);
      onSettled({ result, answers, amountPaisa: data.amountPaisa });
    } catch (error) {
      if (!(error instanceof ApiError)) {
        setFormError(t.submitFailed);
        return;
      }
      if (error.status === 404) return; // routed away by the effect above
      if (error.status === 409) {
        /* Routine: an agent picked up, or the job settled. The mutation has
           already asked for a re-read; say what the server said, and do not retry. */
        onMovedOn(error.problem.detail);
        return;
      }
      if (error.status === 422) {
        const mapped: Partial<Record<FieldKey, string>> = {};
        const unplaced: string[] = [];
        for (const entry of error.problem.errors) {
          if ((FIELD_KEYS as readonly string[]).includes(entry.path)) mapped[entry.path as FieldKey] ??= entry.message;
          else unplaced.push(entry.message);
        }
        setErrors(mapped);
        setFormError(unplaced.length > 0 ? unplaced.join(' ') : Object.keys(mapped).length > 0 ? t.fixErrors : error.problem.detail);
        return;
      }
      setFormError(error.problem.detail || t.submitFailed);
    }
  };

  const consentText = cash
    ? amount === null
      ? t.consentLabelCashNoAmount
      : t.consentLabelCash.replace('{amount}', amount)
    : amount === null
      ? t.consentLabelNoAmount
      : t.consentLabel.replace('{amount}', amount);

  const submitLabel = submit.isPending ? t.submitting : effectiveChoice === 'NOT_ACCEPTABLE' ? t.submitEscalate : cash ? t.submitCash : t.submitRelease;
  const errorId = (key: FieldKey) => `${formId}-${key}-error`;
  const workAnswers = question('workCompleted').answers ?? (['FULL', 'PARTIAL', 'NONE'] as WorkCompleted[]);
  const extraAnswers = question('extraChargeDemanded').answers ?? [true, false];
  const choiceAnswers = question('choice').answers ?? ['SATISFIED', 'WITH_ISSUE', 'NOT_ACCEPTABLE'];

  const sections: Record<SelfConfirmationQuestion['key'], ReactNode> = {
    workCompleted: (
      <Question key="workCompleted" legend={t.workLegend} error={errors.workCompleted} errorId={errorId('workCompleted')}>
        <div className="grid gap-2 sm:grid-cols-3">
          {workAnswers.map((value) => (
            <Choice
              key={value}
              name={`${formId}-work`}
              checked={workCompleted === value}
              onChange={() => pickWork(value as WorkCompleted)}
              describedBy={errors.workCompleted ? errorId('workCompleted') : undefined}
            >
              {t[`work${value}` as 'workFULL' | 'workPARTIAL' | 'workNONE'] ?? value}
            </Choice>
          ))}
        </div>
      </Question>
    ),
    ratings: (
      <div key="ratings" className="grid gap-4">
        <div>
          <p className="text-sm font-semibold text-navy">{t.ratingsLegend}</p>
          <p className="mt-1 text-xs leading-5 text-muted">{t.ratingsHint}</p>
        </div>
        {RATING_KEYS.map((key) => (
          <Question key={key} legend={t[key]} error={errors[key]} errorId={errorId(key)} compact>
            <div className="grid grid-cols-5 gap-1.5">
              {SCORES.map((score) => (
                <Choice
                  key={score}
                  name={`${formId}-${key}`}
                  checked={ratings[key] === score}
                  onChange={() => pickScore(key, score)}
                  describedBy={errors[key] ? errorId(key) : undefined}
                  ariaLabel={`${score} — ${t[`score${score}`]}`}
                  compact
                >
                  <span className="block text-base font-bold tabular-nums">{score}</span>
                  <span className="block text-[10px] font-medium leading-tight sm:text-[11px]">{t[`score${score}`]}</span>
                </Choice>
              ))}
            </div>
          </Question>
        ))}
      </div>
    ),
    extraChargeDemanded: (
      <Question key="extraChargeDemanded" legend={t.extraLegend} error={errors.extraChargeDemanded} errorId={errorId('extraChargeDemanded')}>
        <div className="grid gap-2 sm:grid-cols-2">
          {extraAnswers.map((value) => (
            <Choice
              key={String(value)}
              name={`${formId}-extra`}
              checked={extraCharge === value}
              onChange={() => pickExtra(value)}
              describedBy={errors.extraChargeDemanded ? errorId('extraChargeDemanded') : undefined}
            >
              {value ? dict.common.yes : dict.common.no}
            </Choice>
          ))}
        </div>
      </Question>
    ),
    choice: (
      <Question key="choice" legend={t.choiceLegend} error={errors.outcome} errorId={errorId('outcome')}>
        {forced !== null ? (
          <p role="status" className="mb-3 flex items-start gap-2 rounded-[9px] bg-amber-50 p-3 text-sm leading-6 text-amber-900">
            <Info className="mt-0.5 size-4 shrink-0" aria-hidden="true" />
            {forced === 'noWork' ? t.forcedNoWork : t.forcedExtraCharge}
          </p>
        ) : null}
        <div className="grid gap-2">
          {choiceAnswers.map((value) => {
            const hint =
              cash && value === 'SATISFIED' ? t.cashChoiceSATISFIEDHint : cash && value === 'WITH_ISSUE' ? t.cashChoiceWITH_ISSUEHint : t[`choice${value}Hint`];
            return (
              <Choice
                key={value}
                name={`${formId}-choice`}
                checked={effectiveChoice === value}
                disabled={forced !== null && value !== 'NOT_ACCEPTABLE'}
                onChange={() => pickChoice(value)}
                describedBy={errors.outcome ? errorId('outcome') : undefined}
                align="start"
              >
                <span className="block font-semibold">{t[`choice${value}`]}</span>
                <span className="mt-0.5 block text-xs font-normal leading-5 text-secondary">{hint}</span>
              </Choice>
            );
          })}
        </div>
      </Question>
    )
  };

  return (
    <form
      noValidate
      onSubmit={(event) => {
        event.preventDefault();
        void onSubmit();
      }}
      className="grid gap-6"
    >
      <div className="grid gap-3">
        <p className="text-sm leading-6 text-secondary">{(cash ? t.introCash : t.intro).replace('{provider}', provider)}</p>
        {amount !== null ? (
          <dl className="flex flex-wrap items-baseline justify-between gap-2 rounded-[10px] bg-surface-2 px-4 py-3 text-sm">
            <dt className="text-muted">{cash ? t.amountDue : t.amountHeld}</dt>
            <dd className="font-semibold tabular-nums text-navy">{amount}</dd>
          </dl>
        ) : null}
      </div>

      {movedOn !== null ? <Notice tone="info" icon={Info} title={t.movedOnTitle} text={movedOn} /> : null}

      {questions.map((entry) => sections[entry.key] ?? null)}

      {/* Only on the release path, and only ever ticked by the customer. Choosing
          the problem path takes it away and clears it. */}
      {releasing ? (
        <div className="grid gap-1.5">
          <label
            className={cn(
              'flex cursor-pointer items-start gap-3 rounded-[10px] border p-3.5 text-sm font-medium text-navy transition-colors',
              consent ? 'border-primary bg-blue-50/60' : 'border-line bg-white hover:border-slate-300',
              errors.consentToRelease ? 'border-rose-300' : null
            )}
          >
            <input
              type="checkbox"
              checked={consent}
              onChange={(event) => {
                setConsent(event.target.checked);
                clearError('consentToRelease');
              }}
              aria-invalid={errors.consentToRelease ? true : undefined}
              aria-describedby={errors.consentToRelease ? errorId('consentToRelease') : `${formId}-consent-hint`}
              className="mt-0.5 size-4 shrink-0 accent-[var(--color-primary)]"
            />
            <span>
              <ShieldCheck className="me-1.5 inline size-4 align-[-3px] text-primary" aria-hidden="true" />
              {consentText}
            </span>
          </label>
          <p id={`${formId}-consent-hint`} className="text-xs leading-5 text-muted">
            {t.consentHint}
          </p>
          {errors.consentToRelease ? <FieldError id={errorId('consentToRelease')} text={errors.consentToRelease} /> : null}
        </div>
      ) : null}

      <div className="grid gap-2">
        <div className="flex items-baseline justify-between gap-2">
          <label htmlFor={`${formId}-remark`} className="text-sm font-semibold text-navy">
            {t.remarkLabel}
          </label>
          <span className="text-xs tabular-nums text-muted">
            {t.remarkCount.replace('{count}', String(remark.length)).replace('{max}', String(MAX_SELF_CONFIRMATION_REMARK))}
          </span>
        </div>
        <Textarea
          id={`${formId}-remark`}
          value={remark}
          maxLength={MAX_SELF_CONFIRMATION_REMARK}
          onChange={(event) => {
            setRemark(event.target.value);
            clearError('remark');
          }}
          aria-describedby={`${formId}-remark-hint`}
          aria-invalid={errors.remark ? true : undefined}
        />
        <p id={`${formId}-remark-hint`} className="text-xs leading-5 text-muted">
          {t.remarkHint}
        </p>
        {errors.remark ? <FieldError id={errorId('remark')} text={errors.remark} /> : null}
      </div>

      {formError !== '' ? (
        <p role="alert" className="rounded-[9px] bg-rose-50 p-3 text-sm leading-6 text-rose-800">
          {formError}
        </p>
      ) : null}

      <div className="grid gap-2">
        <Button type="submit" disabled={submit.isPending} className="w-full sm:w-auto sm:justify-self-start">
          {submitLabel}
        </Button>
        <p className="text-xs leading-5 text-muted">{t.finalNote}</p>
      </div>
    </form>
  );
}

/* ---- After submit --------------------------------------------------------------- */

function OutcomePanel({ locale, dict, settled, onRaiseComplaint }: { locale: Locale; dict: Dictionary; settled: Settled; onRaiseComplaint: () => void }) {
  const t = dict.confirmWork;
  const { result, answers, amountPaisa } = settled;

  if (result.outcome === 'ESCALATED') {
    /* Not an error and not a dispute: nothing moved, a person has it now. The
       one reassurance this screen owes is that the money is still held. */
    const cash = result.booking.paymentMode === 'CASH';
    const held = cash ? t.escalatedCash : amountPaisa === null ? t.escalatedHeldNoAmount : t.escalatedHeld.replace('{amount}', formatMoney(amountPaisa, locale));
    return (
      <div role="status" className="grid gap-4">
        <div className="flex items-start gap-3">
          <span className="grid size-10 shrink-0 place-items-center rounded-full bg-blue-50 text-primary-strong" aria-hidden="true">
            <PhoneCall className="size-5" />
          </span>
          <div className="min-w-0">
            <p className="font-semibold text-navy">{t.escalatedTitle}</p>
            <p className="mt-1 text-sm leading-6 text-secondary">{result.message}</p>
          </div>
        </div>
        <p className="flex items-start gap-2 rounded-[10px] bg-surface-2 p-3.5 text-sm font-medium leading-6 text-navy">
          <ShieldCheck className="mt-0.5 size-4 shrink-0 text-primary" aria-hidden="true" />
          {held}
        </p>
        <p className="text-xs leading-5 text-muted">{t.escalatedNothingMore}</p>
        <div>
          <Button type="button" variant="secondary" size="sm" onClick={onRaiseComplaint}>
            {t.raiseComplaint}
          </Button>
        </div>
      </div>
    );
  }

  /* The cash response never means "paid": it authorises the handover, and the
     provider confirms receipt. Decided from the payment mode, not the wording. */
  const cashPending = result.booking.paymentMode === 'CASH' && result.bookingStatus !== 'PAYMENT_RELEASED';
  return (
    <div role="status" className="grid gap-4">
      <div className="flex items-start gap-3">
        <span className="grid size-10 shrink-0 place-items-center rounded-full bg-emerald-50 text-emerald-700" aria-hidden="true">
          <CheckCircle2 className="size-5" />
        </span>
        <div className="min-w-0">
          <p className="font-semibold text-navy">{cashPending ? t.doneCashTitle : t.doneTitle}</p>
          <p className="mt-1 text-sm leading-6 text-secondary">{result.message}</p>
          {result.outcome === 'CONFIRMED_WITH_ISSUE' && cashPending ? <p className="mt-1 text-sm leading-6 text-secondary">{t.withIssueNote}</p> : null}
          {cashPending ? <p className="mt-1 text-sm font-medium leading-6 text-navy">{t.cashNextStep}</p> : null}
        </div>
      </div>

      <div className="rounded-[10px] border border-line p-4">
        <p className="text-xs font-semibold uppercase tracking-wide text-muted">{t.yourRating}</p>
        <dl className="mt-3 grid gap-2 text-sm sm:grid-cols-2">
          {RATING_KEYS.map((key) => (
            <div key={key} className="flex items-baseline justify-between gap-2">
              <dt className="text-secondary">{t[key]}</dt>
              <dd className="font-semibold tabular-nums text-navy">{answers?.[key]} / 5</dd>
            </div>
          ))}
        </dl>
        {/* The remark as the customer typed it — no name beside it, full or otherwise. */}
        {answers?.remark !== undefined && answers.remark.trim() !== '' ? (
          <blockquote className="mt-3 border-s-2 border-line ps-3 text-sm italic leading-6 text-secondary">{answers.remark.trim()}</blockquote>
        ) : null}
      </div>
      <p className="text-xs leading-5 text-muted">{t.finalNote}</p>
    </div>
  );
}

/* ---- Small pieces ---------------------------------------------------------- */

function Notice({ tone, icon: Icon, title, text }: { tone: 'info' | 'success'; icon: typeof Info; title: string; text: string }) {
  return (
    <div role="status" className={cn('flex items-start gap-3 rounded-[10px] p-4', tone === 'success' ? 'bg-emerald-50' : 'bg-surface-2')}>
      <Icon className={cn('mt-0.5 size-5 shrink-0', tone === 'success' ? 'text-emerald-700' : 'text-primary-strong')} aria-hidden="true" />
      <div className="min-w-0">
        <p className="font-semibold text-navy">{title}</p>
        {text !== '' ? <p className="mt-1 text-sm leading-6 text-secondary">{text}</p> : null}
      </div>
    </div>
  );
}

function Question({ legend, error, errorId, compact = false, children }: { legend: string; error?: string; errorId: string; compact?: boolean; children: ReactNode }) {
  return (
    <fieldset aria-invalid={error ? true : undefined} className="min-w-0">
      <legend className={cn('font-semibold text-navy', compact ? 'text-xs text-secondary' : 'text-sm')}>{legend}</legend>
      <div className={compact ? 'mt-1.5' : 'mt-3'}>{children}</div>
      {error ? <FieldError id={errorId} text={error} /> : null}
    </fieldset>
  );
}

function FieldError({ id, text }: { id: string; text: string }) {
  return (
    <p id={id} className="mt-1.5 text-xs font-medium leading-5 text-rose-700">
      {text}
    </p>
  );
}

/** A native radio dressed as a tile: a real radio group for assistive tech, a big target for a thumb. */
function Choice({
  name,
  checked,
  onChange,
  disabled = false,
  describedBy,
  ariaLabel,
  compact = false,
  align = 'center',
  children
}: {
  name: string;
  checked: boolean;
  onChange: () => void;
  disabled?: boolean;
  describedBy?: string;
  ariaLabel?: string;
  compact?: boolean;
  align?: 'center' | 'start';
  children: ReactNode;
}) {
  return (
    <label className={cn('relative block', disabled ? 'cursor-not-allowed' : 'cursor-pointer')}>
      <input
        type="radio"
        name={name}
        checked={checked}
        onChange={onChange}
        disabled={disabled}
        aria-describedby={describedBy}
        aria-label={ariaLabel}
        className="peer sr-only"
      />
      <span
        className={cn(
          'block rounded-[9px] border text-sm font-semibold transition-colors duration-150',
          'peer-focus-visible:ring-4 peer-focus-visible:ring-blue-100',
          compact ? 'min-h-14 px-1 py-2 text-center' : align === 'start' ? 'min-h-12 px-3.5 py-2.5 text-start' : 'min-h-12 px-3 py-3 text-center',
          checked ? 'border-primary bg-blue-50 text-primary-strong' : 'border-line bg-white text-secondary hover:border-slate-300 hover:bg-slate-50',
          disabled ? 'opacity-50 hover:border-line hover:bg-white' : null
        )}
      >
        {children}
      </span>
    </label>
  );
}
