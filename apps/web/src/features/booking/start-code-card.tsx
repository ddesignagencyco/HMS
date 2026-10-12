'use client';

import { AlertTriangle, Check, Clock, Copy, KeyRound, MessageSquare, RotateCw } from 'lucide-react';
import { useCallback, useEffect, useState } from 'react';
import { Button, Card } from '@/components/ui';
import type { Booking, BookingStatus } from '@/features/booking/api';
import { useRequestStartCode } from '@/features/booking/queries';
import { canRequestStartCode } from '@/features/booking/status';
import { ApiError } from '@/lib/api/problem';
import type { Dictionary } from '@/lib/dictionaries';
import { cn, type Locale } from '@/lib/utils';

export type StartCodeCardProps = {
  locale: Locale;
  dict: Dictionary;
  booking: Pick<Booking, 'id' | 'status'>;
  variant?: 'card' | 'compact';
  className?: string;
};

const formatCountdown = (seconds: number): string => {
  const mins = Math.floor(seconds / 60);
  const secs = seconds % 60;
  return `${mins}:${secs.toString().padStart(2, '0')}`;
};

/**
 * Start code display for the customer.
 *
 * Requirements & Footguns:
 * 1. Generates a NEW code on every request (the stored code is an HMAC hash).
 * 2. Each new code INVALIDATES any previously issued code immediately.
 *    DO NOT poll or auto-refresh in the background!
 *    Any refresh must be a deliberate user tap.
 * 3. Shown to CUSTOMER role only.
 * 4. Hidden once status is IN_PROGRESS or later (409 Conflict if attempted).
 * 5. High-contrast, large fixed-width digits easily legible across a doorway in daylight.
 */
export function StartCodeCard({ locale, dict, booking, variant = 'card', className }: StartCodeCardProps) {
  const requestStartCode = useRequestStartCode(locale);

  const [code, setCode] = useState<string | null>(null);
  const [expiresAt, setExpiresAt] = useState<number | null>(null);
  const [remainingSeconds, setRemainingSeconds] = useState<number>(0);
  const [copied, setCopied] = useState(false);
  const [smsSentNotice, setSmsSentNotice] = useState(false);
  const [jobAlreadyStarted, setJobAlreadyStarted] = useState(false);
  const [errorMessage, setErrorMessage] = useState<string | null>(null);

  // If status moved to IN_PROGRESS or later, or not eligible, hide the component.
  const eligible = canRequestStartCode(booking.status) && !jobAlreadyStarted;

  // Countdown timer for code expiry. Never auto-refreshes when expired!
  useEffect(() => {
    if (expiresAt === null) return undefined;

    const updateTimer = () => {
      const now = Date.now();
      const left = Math.max(0, Math.round((expiresAt - now) / 1000));
      setRemainingSeconds(left);
    };

    updateTimer();
    const interval = setInterval(updateTimer, 1000);
    return () => clearInterval(interval);
  }, [expiresAt]);

  const handleFetchCode = useCallback(
    async (viaSms = false) => {
      setErrorMessage(null);
      setSmsSentNotice(false);

      try {
        const result = await requestStartCode.mutateAsync(booking.id);
        setCode(result.code);
        setExpiresAt(Date.now() + result.expiresInSeconds * 1000);
        setRemainingSeconds(result.expiresInSeconds);
        if (viaSms) {
          setSmsSentNotice(true);
        }
      } catch (err) {
        if (err instanceof ApiError && err.status === 409) {
          setJobAlreadyStarted(true);
          setErrorMessage(dict.booking.startCodeStarted);
        } else if (err instanceof Error) {
          setErrorMessage(err.message);
        } else {
          setErrorMessage(dict.booking.startCodeFailed);
        }
      }
    },
    [booking.id, dict.booking.startCodeFailed, dict.booking.startCodeStarted, requestStartCode]
  );

  const handleCopy = useCallback(async () => {
    if (!code) return;
    try {
      if (typeof navigator !== 'undefined' && navigator.clipboard?.writeText) {
        await navigator.clipboard.writeText(code);
        setCopied(true);
        setTimeout(() => setCopied(false), 2000);
      }
    } catch {
      // Ignore clipboard write failure
    }
  }, [code]);

  if (!eligible) {
    if (jobAlreadyStarted) {
      return (
        <div role="status" className={cn('rounded-[12px] border border-amber-200 bg-amber-50 p-4 text-sm text-amber-900', className)}>
          {dict.booking.startCodeStarted}
        </div>
      );
    }
    return null;
  }

  const isPending = requestStartCode.isPending;
  const isExpired = code !== null && remainingSeconds <= 0;

  if (variant === 'compact') {
    return (
      <div
        className={cn(
          'rounded-[12px] border border-slate-200 bg-gradient-to-r from-slate-900 via-slate-800 to-slate-900 p-4 text-white shadow-sm',
          className
        )}
      >
        <div className="flex flex-wrap items-center justify-between gap-3">
          <div className="min-w-0">
            <div className="flex items-center gap-2">
              <KeyRound className="size-4 text-amber-400" aria-hidden="true" />
              <h3 className="text-sm font-semibold text-white">{dict.booking.startCodeTitle}</h3>
            </div>
            <p className="mt-0.5 text-xs text-slate-300">{dict.booking.startCodeDescription}</p>
          </div>

          {code === null ? (
            <div className="flex flex-wrap gap-2">
              <Button
                type="button"
                size="sm"
                className="bg-amber-400 text-slate-950 hover:bg-amber-300 font-semibold"
                onClick={() => void handleFetchCode(false)}
                disabled={isPending}
              >
                <KeyRound className="size-3.5" aria-hidden="true" />
                {dict.booking.startCodeShowButton}
              </Button>
            </div>
          ) : (
            <div className="flex items-center gap-3">
              <div
                className="flex items-center gap-1.5 font-mono text-2xl font-black tracking-widest text-amber-300 bg-slate-950 px-3 py-1.5 rounded-lg border border-slate-700 select-all"
                aria-label={`Start code ${code}`}
              >
                {code}
              </div>
              <Button
                type="button"
                variant="secondary"
                size="sm"
                onClick={() => void handleCopy()}
                aria-label={dict.booking.startCodeCopy}
                className="bg-slate-800 text-white hover:bg-slate-700 border-slate-700"
              >
                {copied ? <Check className="size-3.5 text-emerald-400" /> : <Copy className="size-3.5" />}
                {copied ? dict.booking.startCodeCopied : dict.booking.startCodeCopy}
              </Button>
            </div>
          )}
        </div>

        {code !== null ? (
          <div className="mt-3 flex flex-wrap items-center justify-between gap-2 border-t border-slate-800 pt-2.5 text-xs text-slate-400">
            <span className="flex items-center gap-1.5">
              <Clock className="size-3.5" aria-hidden="true" />
              {isExpired ? (
                <span className="font-medium text-rose-400">{dict.booking.startCodeExpired}</span>
              ) : (
                <span>{dict.booking.startCodeCountdown.replace('{time}', formatCountdown(remainingSeconds))}</span>
              )}
            </span>
            <div className="flex items-center gap-2">
              <button
                type="button"
                onClick={() => void handleFetchCode(false)}
                disabled={isPending}
                className="flex items-center gap-1 text-xs text-amber-300 hover:text-amber-200 underline disabled:opacity-50"
              >
                <RotateCw className={cn('size-3', isPending && 'animate-spin')} aria-hidden="true" />
                {dict.booking.startCodeRefreshButton}
              </button>
            </div>
          </div>
        ) : null}

        {errorMessage ? (
          <p role="alert" className="mt-2 text-xs text-rose-400">
            {errorMessage}
          </p>
        ) : null}
      </div>
    );
  }

  return (
    <Card className={cn('overflow-hidden border-2 border-primary/20 shadow-md', className)}>
      <div className="bg-gradient-to-r from-slate-900 via-slate-800 to-navy p-5 text-white">
        <div className="flex items-center gap-2.5">
          <div className="grid size-9 place-items-center rounded-lg bg-amber-400 text-slate-950 shadow-sm">
            <KeyRound className="size-5" aria-hidden="true" />
          </div>
          <div>
            <h2 className="text-base font-bold tracking-tight text-white">{dict.booking.startCodeTitle}</h2>
            <p className="text-xs text-slate-300">{dict.booking.startCodeDescription}</p>
          </div>
        </div>
      </div>

      <div className="p-5 sm:p-6">
        {code === null ? (
          <div className="grid gap-4 text-center sm:text-start">
            <p className="text-sm leading-6 text-secondary">{dict.booking.startCodeInvalidationWarning}</p>
            <div className="flex flex-wrap gap-3">
              <Button
                type="button"
                size="lg"
                onClick={() => void handleFetchCode(false)}
                disabled={isPending}
                className="gap-2"
              >
                <KeyRound className={cn('size-4', isPending && 'animate-spin')} aria-hidden="true" />
                {dict.booking.startCodeShowButton}
              </Button>
              <Button
                type="button"
                variant="secondary"
                size="lg"
                onClick={() => void handleFetchCode(true)}
                disabled={isPending}
                className="gap-2"
              >
                <MessageSquare className="size-4" aria-hidden="true" />
                {dict.booking.startCodeResendSmsButton}
              </Button>
            </div>
          </div>
        ) : (
          <div className="grid gap-5">
            {/* High-contrast, large digits easily read across a doorway in daylight */}
            <div className="flex flex-col items-center justify-center rounded-[14px] bg-slate-950 p-6 text-center shadow-inner">
              <p className="text-xs font-semibold uppercase tracking-widest text-slate-400">
                {dict.booking.startCodeTitle}
              </p>

              <div
                className="my-4 flex items-center justify-center gap-2 sm:gap-3"
                role="region"
                aria-label={`Start code: ${code}`}
                data-testid="start-code-display"
              >
                {code.split('').map((digit, idx) => (
                  <span
                    key={idx}
                    className="flex size-12 sm:size-15 items-center justify-center rounded-xl border border-slate-800 bg-slate-900 font-mono text-3xl sm:text-4xl font-extrabold text-amber-300 shadow-md select-all"
                  >
                    {digit}
                  </span>
                ))}
              </div>

              <div className="flex flex-wrap items-center justify-center gap-4">
                <Button
                  type="button"
                  variant="secondary"
                  size="sm"
                  onClick={() => void handleCopy()}
                  className="bg-slate-800 text-white hover:bg-slate-700 border-slate-700"
                >
                  {copied ? <Check className="size-3.5 text-emerald-400" /> : <Copy className="size-3.5" />}
                  {copied ? dict.booking.startCodeCopied : dict.booking.startCodeCopy}
                </Button>

                <div className="flex items-center gap-1.5 text-xs text-slate-300">
                  <Clock className="size-3.5 text-slate-400" aria-hidden="true" />
                  {isExpired ? (
                    <span className="font-semibold text-rose-400">{dict.booking.startCodeExpired}</span>
                  ) : (
                    <span>{dict.booking.startCodeCountdown.replace('{time}', formatCountdown(remainingSeconds))}</span>
                  )}
                </div>
              </div>
            </div>

            {/* Invalidation warning note: Refresh invalidates previous code */}
            <div className="rounded-[10px] border border-amber-200 bg-amber-50 p-3 text-xs leading-5 text-amber-900">
              <p className="font-medium">{dict.booking.startCodeInvalidationWarning}</p>
            </div>

            {/* Deliberate Refresh / Re-send controls */}
            <div className="flex flex-wrap items-center justify-between gap-3 border-t border-line pt-4">
              <div className="flex flex-wrap gap-2">
                <Button
                  type="button"
                  variant="secondary"
                  size="sm"
                  onClick={() => void handleFetchCode(false)}
                  disabled={isPending}
                  className="gap-1.5"
                >
                  <RotateCw className={cn('size-3.5', isPending && 'animate-spin')} aria-hidden="true" />
                  {dict.booking.startCodeRefreshButton}
                </Button>
                <Button
                  type="button"
                  variant="ghost"
                  size="sm"
                  onClick={() => void handleFetchCode(true)}
                  disabled={isPending}
                  className="gap-1.5 text-secondary"
                >
                  <MessageSquare className="size-3.5" aria-hidden="true" />
                  {dict.booking.startCodeResendSmsButton}
                </Button>
              </div>
            </div>
          </div>
        )}

        {smsSentNotice ? (
          <p role="status" className="mt-3 rounded-[8px] border border-emerald-200 bg-emerald-50 p-2.5 text-xs font-medium text-emerald-800">
            {dict.booking.startCodeSmsSent}
          </p>
        ) : null}

        {errorMessage ? (
          <p role="alert" className="mt-3 flex items-start gap-2 rounded-[8px] border border-rose-200 bg-rose-50 p-3 text-xs leading-5 text-rose-800">
            <AlertTriangle className="mt-0.5 size-4 shrink-0" aria-hidden="true" />
            {errorMessage}
          </p>
        ) : null}
      </div>
    </Card>
  );
}
