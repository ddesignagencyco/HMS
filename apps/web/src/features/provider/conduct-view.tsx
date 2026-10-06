'use client';

import { AlertTriangle, Gavel, Scale, ShieldAlert, ShieldCheck } from 'lucide-react';
import { useState } from 'react';
import { Button, Card, Label, PageHeader, Textarea } from '@/components/ui';
import { useConduct, usePenalties, useReplyToPenalty, useAppealPenalty } from '@/features/provider/queries';
import type { BreachType, ConductAward, Penalty } from '@/features/provider/api';
import type { Dictionary } from '@/lib/dictionaries';
import { cn, formatDate, formatMoney, type Locale } from '@/lib/utils';

/* The conduct record and the penalties on it.
 *
 * This screen exists because a professional needs to know two things that are kept
 * apart by the API and are easy to blur together:
 *
 * · **A penalty is proposed before it is anything.** `POST /admin/penalties` does
 *   not fine anybody. It records the evidence and opens a 48-hour window for the
 *   provider's reply, and an admin can withdraw it. So a PROPOSED row is not a
 *   charge and must not be styled like one.
 * · **A demerit point is separate from the penalty.** `demerit_awards` is its own
 *   history: points decay, expire after 180 days, and are voided outright when an
 *   appeal succeeds. `activePoints` is the sum of what is *still* on the record,
 *   while the award list is the whole history. Showing the list length as the
 *   total would be wrong.
 *
 * The schedule and the thresholds both come from the API. The previous screen
 * hardcoded the demerit table in the dictionary, which meant it could disagree
 * with `breach_types` and could never show a breach an admin had just activated.
 * `breach_types` carries `name_ur` too, so the Urdu screen shows the platform's
 * own wording rather than a client-side translation.
 *
 * Two rights, both single-use, and the API refuses the second attempt:
 *   · **reply** — once, and only while PROPOSED.
 *   · **appeal** — once, and only once the penalty is APPLIED. */

/**
 * A consequence code, as a sentence.
 *
 * The code is a free-text value out of `breach_types` and `threshold_events`, so an
 * admin can activate a band this build has never heard of. The dictionary lookup is
 * a nicety, not a guarantee — anything unknown falls through to the raw code
 * rather than rendering an empty cell next to a real fine.
 */
const consequenceLabel = (dict: Dictionary, code: string): string => (dict.portal.conductConsequences as Record<string, string>)[code] ?? code;

export function ProviderConductScreen({ locale, dict }: { locale: Locale; dict: Dictionary }) {
  const record = useConduct(locale);
  const penalties = usePenalties(locale);
  const reply = useReplyToPenalty(locale);
  const appeal = useAppealPenalty(locale);

  const [replyDrafts, setReplyDrafts] = useState<Record<string, string>>({});
  const [appealDrafts, setAppealDrafts] = useState<Record<string, string>>({});
  const [localError, setLocalError] = useState('');
  const [notice, setNotice] = useState('');

  const sendReply = async (penalty: Penalty): Promise<void> => {
    setLocalError('');
    setNotice('');
    const text = (replyDrafts[penalty.id] ?? '').trim();
    if (text === '') {
      setLocalError(dict.portal.replyRequired);
      return;
    }
    try {
      await reply.mutateAsync({ penaltyId: penalty.id, body: text });
      setNotice(dict.portal.penaltyReplySent);
      setReplyDrafts((previous) => ({ ...previous, [penalty.id]: '' }));
    } catch (error) {
      setLocalError(error instanceof Error ? error.message : dict.portal.penaltyReplyFailed);
    }
  };

  const sendAppeal = async (penalty: Penalty): Promise<void> => {
    setLocalError('');
    setNotice('');
    /* `appealSchema` requires 10 characters minimum. Saying so here beats a 422. */
    const text = (appealDrafts[penalty.id] ?? '').trim();
    if (text.length < 10) {
      setLocalError(dict.portal.appealTooShort);
      return;
    }
    try {
      await appeal.mutateAsync({ penaltyId: penalty.id, grounds: text });
      setNotice(dict.portal.penaltyAppealSent);
      setAppealDrafts((previous) => ({ ...previous, [penalty.id]: '' }));
    } catch (error) {
      setLocalError(error instanceof Error ? error.message : dict.portal.penaltyAppealFailed);
    }
  };

  if (record.isPending) {
    return (
      <div aria-busy="true" aria-live="polite" className="grid gap-3">
        <span className="skeleton h-8 w-56 rounded-[9px]" />
        <span className="skeleton h-56 w-full rounded-[12px]" />
      </div>
    );
  }

  if (record.isError) {
    return (
      <div>
        <PageHeader eyebrow={dict.portal.provider} title={dict.portal.conduct} />
        <div role="alert" className="mt-6 rounded-[14px] border border-rose-200 bg-rose-50 p-5">
          <p className="text-sm font-medium leading-6 text-rose-800">{dict.portal.conductLoadError}</p>
          <Button type="button" variant="secondary" size="sm" className="mt-4" onClick={() => void record.refetch()}>
            {dict.catalogue.retry}
          </Button>
        </div>
      </div>
    );
  }

  const { activePoints, daysSinceLastBreachOrDecay, awards, standingConsequences, thresholds, schedule } = record.data;
  const clean = activePoints === 0 && standingConsequences.length === 0;

  /**
   * The breach name for a locale, for both a schedule row and a penalty row.
   *
   * `Penalties` is a separate request and its `breachName` is always `name_en`,
   * so on its own the Urdu screen would print an English breach name next to an
   * Urdu page. `schedule` comes back on the same screen and is bilingual, so
   * joining on `breachCode` recovers the Urdu wording without a second call. When
   * a breach is not on the active schedule — retired, or deactivated since the
   * penalty was raised — the English name is the best available and is what gets
   * shown rather than a blank.
   */
  const breachNames = new Map(schedule.map((entry) => [entry.code, entry]));
  const nameFor = (code: string, englishFallback: string): string => {
    const entry = breachNames.get(code);
    if (entry === undefined) return englishFallback;
    return locale === 'ur' ? entry.nameUr : entry.nameEn;
  };

  return (
    <div>
      <PageHeader eyebrow={dict.portal.provider} title={dict.portal.conduct} description={dict.portal.conductText} />

      <div className="mt-6 grid gap-5 lg:grid-cols-[320px_minmax(0,1fr)]">
        <div className="grid content-start gap-5">
          <Card className="p-6">
            <p className="text-sm text-muted">{dict.portal.activePointsLabel}</p>
            <p className={cn('mt-2 text-3xl font-semibold tabular-nums', clean ? 'text-emerald-700' : 'text-amber-700')}>{activePoints}</p>
            {daysSinceLastBreachOrDecay !== null ? (
              <p className="mt-2 text-sm leading-6 text-secondary">{dict.portal.daysClean.replace('{count}', String(daysSinceLastBreachOrDecay))}</p>
            ) : (
              <p className="mt-2 text-sm leading-6 text-secondary">{dict.portal.noBreachOnRecord}</p>
            )}
          </Card>

          {standingConsequences.length === 0 ? (
            <Card className="p-6">
              <h2 className="flex items-center gap-2 font-semibold text-navy">
                <ShieldCheck className="size-4 text-emerald-600" aria-hidden="true" />
                {dict.portal.noStandingRestriction}
              </h2>
            </Card>
          ) : (
            standingConsequences.map((standing) => (
              <Card key={`${standing.consequence}-${standing.until ?? 'forever'}`} className="border-rose-200 bg-rose-50 p-6">
                <h2 className="flex items-center gap-2 font-semibold text-rose-900">
                  <ShieldAlert className="size-4" aria-hidden="true" />
                  {consequenceLabel(dict, standing.consequence)}
                </h2>
                <p className="mt-2 text-sm text-rose-800">
                  {standing.until === null ? dict.portal.permanentRestriction : dict.portal.restrictionUntil.replace('{date}', formatDate(standing.until, locale))}
                </p>
              </Card>
            ))
          )}
        </div>

        <div className="grid gap-5">
          {localError !== '' ? (
            <p role="alert" className="flex items-start gap-2 rounded-[10px] bg-rose-50 p-4 text-sm leading-6 text-rose-800">
              <AlertTriangle className="mt-0.5 size-4 shrink-0" aria-hidden="true" />
              {localError}
            </p>
          ) : null}
          {notice !== '' ? (
            <p role="status" className="rounded-[10px] bg-emerald-50 p-4 text-sm text-emerald-800">
              {notice}
            </p>
          ) : null}

          <Card className="p-6">
            <h2 className="font-semibold text-navy">{dict.portal.penaltiesTitle}</h2>
            <p className="mt-2 text-sm leading-6 text-secondary">{dict.portal.penaltiesText}</p>

            {penalties.data === undefined ? null : penalties.data.items.length === 0 ? (
              <p className="mt-4 rounded-[9px] border border-line bg-surface-2 p-4 text-sm text-secondary">{dict.portal.noPenalties}</p>
            ) : (
              <ul className="mt-4 grid gap-3">
                {penalties.data.items.map((penalty) => (
                  <li key={penalty.id} className="rounded-[11px] border border-line p-4">
                    <div className="flex flex-wrap items-start justify-between gap-2">
                      <div className="min-w-0">
                        <p className="font-medium text-navy">{nameFor(penalty.breachCode, penalty.breachName)}</p>
                        <p className="mt-0.5 text-xs text-muted">
                          {dict.portal.penaltyRaisedOn.replace('{date}', formatDate(penalty.createdAt, locale))}
                          {penalty.bookingCode === null ? '' : ` · ${dict.portal.penaltyJob} ${penalty.bookingCode}`}
                        </p>
                      </div>
                      <span
                        className={cn(
                          'shrink-0 rounded-full px-2.5 py-1 text-[11px] font-semibold',
                          penalty.status === 'PROPOSED'
                            ? 'bg-blue-50 text-primary-strong'
                            : penalty.status === 'APPLIED' || penalty.status === 'APPEALED'
                              ? 'bg-amber-50 text-amber-800'
                              : penalty.status === 'REVERSED' || penalty.status === 'WITHDRAWN'
                                ? 'bg-emerald-50 text-emerald-700'
                                : 'bg-slate-100 text-slate-700'
                        )}
                      >
                        {dict.portal.penaltyStatus[penalty.status]}
                      </span>
                    </div>

                    <dl className="mt-3 grid gap-1 text-xs sm:grid-cols-2">
                      <div className="flex justify-between gap-3">
                        <dt className="text-muted">{dict.portal.demeritPointsLabel}</dt>
                        <dd className="font-medium text-navy tabular-nums">{penalty.points}</dd>
                      </div>
                      <div className="flex justify-between gap-3">
                        <dt className="text-muted">{dict.portal.fineLabel}</dt>
                        <dd className="font-medium text-navy">{formatMoney(penalty.finePaisa, locale)}</dd>
                      </div>
                    </dl>

                    {/* A proposal is not a charge. Saying so prevents a professional
                        reading "PROPOSED" as money already gone. */}
                    {penalty.status === 'PROPOSED' ? (
                      <p className="mt-3 rounded-[8px] bg-blue-50 p-3 text-xs leading-5 text-primary-strong">
                        {dict.portal.proposedExplainer.replace('{date}', formatDate(penalty.replyDueAt, locale))}
                      </p>
                    ) : null}

                    {penalty.providerReply !== null && penalty.providerReply !== '' ? (
                      <p className="mt-3 rounded-[8px] bg-surface-2 p-3 text-xs leading-5 text-secondary">
                        <span className="font-semibold text-navy">{dict.portal.yourReplyWas}: </span>
                        {penalty.providerReply}
                      </p>
                    ) : null}

                    {penalty.status === 'PROPOSED' && penalty.providerReply === null ? (
                      <div className="mt-4 grid gap-2">
                        <Label htmlFor={`reply-${penalty.id}`}>{dict.portal.replyToPenalty}</Label>
                        <Textarea
                          id={`reply-${penalty.id}`}
                          value={replyDrafts[penalty.id] ?? ''}
                          onChange={(event) => setReplyDrafts({ ...replyDrafts, [penalty.id]: event.target.value })}
                          placeholder={dict.portal.replyPlaceholder}
                        />
                        <div>
                          <Button type="button" size="sm" onClick={() => void sendReply(penalty)} disabled={reply.isPending}>
                            {dict.portal.sendReply}
                          </Button>
                        </div>
                      </div>
                    ) : null}

                    {penalty.status === 'APPLIED' ? (
                      <div className="mt-4 grid gap-2">
                        <Label htmlFor={`appeal-${penalty.id}`}>{dict.portal.appealGroundsLabel}</Label>
                        <Textarea
                          id={`appeal-${penalty.id}`}
                          value={appealDrafts[penalty.id] ?? ''}
                          onChange={(event) => setAppealDrafts({ ...appealDrafts, [penalty.id]: event.target.value })}
                          placeholder={dict.portal.appealPlaceholder}
                        />
                        <p className="text-xs leading-5 text-muted">{dict.portal.appealOnceNote}</p>
                        <div>
                          <Button type="button" variant="secondary" size="sm" onClick={() => void sendAppeal(penalty)} disabled={appeal.isPending}>
                            {dict.portal.appealPenalty}
                          </Button>
                        </div>
                      </div>
                    ) : null}

                    {penalty.status === 'UPHELD' || penalty.status === 'REVERSED' ? <p className="mt-3 text-xs leading-5 text-secondary">{dict.portal.appealDecided}</p> : null}
                  </li>
                ))}
              </ul>
            )}
          </Card>

          <Card className="p-6">
            <h2 className="font-semibold text-navy">{dict.portal.awardsTitle}</h2>
            {awards.length === 0 ? (
              <p className="mt-3 text-sm text-secondary">{dict.portal.noAwards}</p>
            ) : (
              <ul className="mt-4 grid gap-2">
                {awards.map((award) => (
                  <AwardRow key={award.id} award={award} locale={locale} dict={dict} />
                ))}
              </ul>
            )}
            <p className="mt-4 text-xs leading-5 text-muted">{dict.portal.pointsExpireNote}</p>
          </Card>

          <Card className="p-6">
            <h2 className="flex items-center gap-2 font-semibold text-navy">
              <Scale className="size-4 text-muted" aria-hidden="true" />
              {dict.portal.scheduleTitle}
            </h2>
            <p className="mt-2 text-sm leading-6 text-secondary">{dict.portal.scheduleText}</p>

            <div className="mt-4 overflow-x-auto">
              <table className="w-full min-w-[520px] border-collapse text-sm">
                <thead>
                  <tr className="border-b border-line text-start text-xs text-muted">
                    <th scope="col" className="py-2 pe-3 text-start font-medium">
                      {dict.portal.breachLabel}
                    </th>
                    <th scope="col" className="px-3 py-2 text-start font-medium">
                      {dict.portal.categoryLabel}
                    </th>
                    <th scope="col" className="px-3 py-2 text-end font-medium">
                      {dict.portal.demeritPointsLabel}
                    </th>
                    <th scope="col" className="py-2 ps-3 text-start font-medium">
                      {dict.portal.directConsequenceLabel}
                    </th>
                  </tr>
                </thead>
                <tbody>
                  {schedule.map((breach) => (
                    <tr key={breach.code} className="border-b border-line last:border-0">
                      <th scope="row" className="py-2.5 pe-3 text-start font-medium text-navy">
                        {/* The platform's own Urdu wording, not a client translation
                            of the English name. */}
                        {locale === 'ur' ? breach.nameUr : breach.nameEn}
                      </th>
                      <td className="px-3 py-2.5 text-secondary">{breach.category}</td>
                      <td className="px-3 py-2.5 text-end tabular-nums text-secondary">{breach.points}</td>
                      <td className="py-2.5 ps-3 text-secondary">{breach.consequence === null ? '—' : consequenceLabel(dict, breach.consequence)}</td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>

            <h3 className="mt-6 flex items-center gap-2 text-sm font-semibold text-navy">
              <Gavel className="size-3.5 text-muted" aria-hidden="true" />
              {dict.portal.thresholdsTitle}
            </h3>
            <ol className="mt-3 grid gap-1.5 text-sm text-secondary">
              {thresholds.map((threshold) => (
                <li key={threshold.points} className="flex justify-between gap-3 border-b border-line py-1.5 last:border-0">
                  <span className="tabular-nums">{threshold.points}</span>
                  <span>{consequenceLabel(dict, threshold.consequence)}</span>
                </li>
              ))}
            </ol>
          </Card>
        </div>
      </div>
    </div>
  );
}

/**
 * One award, shown as history rather than as a balance.
 *
 * `pointsRemaining` is what counts towards the total and `pointsAwarded` is what
 * it started at — a row that has decayed to zero is still listed, because "this
 * came off six months ago" is exactly what a professional wants to be able to
 * see. An award voided by a successful appeal says so instead of pretending it
 * never happened.
 */
function AwardRow({ award, locale, dict }: { award: ConductAward; locale: Locale; dict: Dictionary }) {
  return (
    <li className="flex flex-wrap items-center justify-between gap-2 border-b border-line py-2.5 last:border-0">
      <div className="min-w-0">
        <p className="text-sm font-medium text-navy">{award.breachCode}</p>
        <p className="mt-0.5 text-xs text-muted">
          {dict.portal.awardedOn.replace('{date}', formatDate(award.awardedAt, locale))}
          {' · '}
          {dict.portal.expiresOn.replace('{date}', formatDate(award.expiresAt, locale))}
        </p>
      </div>
      <div className="flex items-center gap-2">
        {award.voided ? <span className="rounded-full bg-emerald-50 px-2.5 py-1 text-[11px] font-semibold text-emerald-700">{dict.portal.voidedByAppeal}</span> : null}
        <span className={cn('rounded-full px-2.5 py-1 text-[11px] font-semibold tabular-nums', award.active ? 'bg-amber-50 text-amber-800' : 'bg-slate-100 text-slate-600')}>
          {dict.portal.pointsLeft.replace('{remaining}', String(award.pointsRemaining)).replace('{awarded}', String(award.pointsAwarded))}
        </span>
      </div>
    </li>
  );
}

export type { BreachType };
