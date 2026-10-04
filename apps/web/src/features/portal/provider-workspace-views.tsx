import {
  Banknote,
  CalendarDays,
  CheckCircle2,
  Clock3,
  FileCheck2,
  MapPin,
  Plane,
  ShieldAlert,
  Star,
  TrendingUp,
  Upload,
  Wallet,
} from "lucide-react";
import type { Dictionary } from "@/lib/dictionaries";
import { areas, getBookingsForProvider, getService, providers, reviews } from "@/lib/data";
import { formatDate, formatDateTime, formatMoney, formatNumber, localizedPath, type Locale } from "@/lib/utils";
import { ButtonLink, Card, PageHeader, Progress, StatCard, StatusBadge } from "@/components/ui";

const me = () => providers[0];

/* ---------------- Today ---------------- */

export function ProviderToday({ locale, dict }: { locale: Locale; dict: Dictionary }) {
  const provider = me();
  const jobs = getBookingsForProvider(provider.id);
  const open = jobs.filter((job) => !["COMPLETED", "CANCELLED"].includes(job.status));
  const done = jobs.filter((job) => job.status === "COMPLETED");

  return (
    <div>
      <PageHeader
        eyebrow={dict.portal.provider}
        title={dict.portal.today}
        description={dict.portal.todayText}
        action={<p className="rounded-[9px] bg-emerald-50 px-3 py-2 text-xs font-semibold text-emerald-700">{dict.home.nextAvailable} {formatDateTime(provider.nextSlot, locale)}</p>}
      />

      <div className="mt-6 grid gap-4 sm:grid-cols-3">
        <StatCard icon={Clock3} label={dict.portal.activeBookings} value={String(open.length)} />
        <StatCard icon={CheckCircle2} label={dict.portal.completedToday} value={String(done.length)} />
        <StatCard icon={TrendingUp} label={dict.portal.todayEarnings} value={formatMoney(done.reduce((sum, job) => sum + (job.finalPaisa ?? job.quotedPaisa), 0), locale)} />
      </div>

      <div className="mt-6 grid gap-5">
        {open.length === 0 ? (
          <Card className="px-6 py-14 text-center"><p className="text-sm text-secondary">{dict.common.empty}</p></Card>
        ) : (
          open.map((job) => {
            const service = getService(job.serviceSlug);
            const area = areas.find((item) => item.slug === job.areaSlug);
            return (
              <Card key={job.id} className="p-5">
                <div className="flex flex-wrap items-start justify-between gap-4">
                  <div>
                    <p className="text-xs font-semibold text-muted">{job.code}</p>
                    <h2 className="mt-1 text-[17px] font-semibold tracking-[-0.025em] text-navy">{service?.name[locale]}</h2>
                    <p className="mt-2 text-sm text-secondary">{job.problem}</p>
                  </div>
                  <StatusBadge status={job.status} label={dict.status[job.status]} />
                </div>
                <dl className="mt-4 grid gap-2 text-sm sm:grid-cols-3">
                  <div className="flex items-center gap-2"><Clock3 className="size-4 shrink-0 text-slate-400" /><dd className="text-secondary">{formatDateTime(job.scheduledStart, locale)}</dd></div>
                  <div className="flex items-center gap-2"><MapPin className="size-4 shrink-0 text-slate-400" /><dd className="text-secondary">{area?.name[locale]}</dd></div>
                  <div className="flex items-center gap-2"><Wallet className="size-4 shrink-0 text-slate-400" /><dd className="font-semibold text-navy">{formatMoney(job.quotedPaisa, locale)}</dd></div>
                </dl>
                <div className="mt-5 flex flex-wrap gap-2 border-t border-line pt-4">
                  <ButtonLink href={localizedPath(locale, `/provider/jobs/${job.id}`)}>{dict.portal.openJob}</ButtonLink>
                  <ButtonLink href={localizedPath(locale, "/provider/offers")} variant="secondary">{dict.portal.offers}</ButtonLink>
                </div>
              </Card>
            );
          })
        )}
      </div>
    </div>
  );
}

/* ---------------- Calendar (FR-SP-07) ---------------- */

const slots = ["08:00", "10:00", "12:00", "14:00", "16:00", "18:00"] as const;

const week = [
  { day: "Mon", date: "21", free: 4, leave: false },
  { day: "Tue", date: "22", free: 5, leave: false },
  { day: "Wed", date: "23", free: 2, leave: false },
  { day: "Thu", date: "24", free: 0, leave: true },
  { day: "Fri", date: "25", free: 3, leave: false },
  { day: "Sat", date: "26", free: 6, leave: false },
  { day: "Sun", date: "27", free: 0, leave: false },
] as const;

export function ProviderCalendar({ dict }: { dict: Dictionary }) {
  const booked = getBookingsForProvider(me().id).length;

  return (
    <div>
      <PageHeader eyebrow={dict.portal.provider} title={dict.portal.calendar} description={dict.portal.calendarText} />

      <div className="mt-6 grid gap-4 sm:grid-cols-3">
        <StatCard icon={CalendarDays} label={dict.portal.freeSlots} value="20" />
        <StatCard icon={Plane} label={dict.portal.leave} value="1" />
        <StatCard icon={Clock3} label={dict.portal.bookedThisWeek} value={String(booked)} />
      </div>

      <Card className="mt-6 overflow-hidden">
        <div className="flex flex-wrap items-center justify-between gap-3 border-b border-line p-5">
          <h2 className="font-semibold text-navy">{dict.portal.weeklyAvailability}</h2>
          <p className="text-xs text-muted">{dict.portal.travelBufferNote}</p>
        </div>

        <div className="overflow-x-auto">
          <table className="w-full min-w-[720px] text-sm">
            <thead className="bg-slate-50 text-xs text-muted">
              <tr><th className="p-4 text-start">{dict.common.date}</th>{slots.map((slot) => <th key={slot} className="p-3 text-center tabular-nums">{slot}</th>)}</tr>
            </thead>
            <tbody className="divide-y divide-line">
              {week.map((row) => (
                <tr key={row.day} className={row.leave ? "bg-amber-50/50" : ""}>
                  <td className="p-4">
                    <p className="font-semibold text-navy">{row.day}</p>
                    <p className="text-xs text-muted tabular-nums">{row.date}</p>
                  </td>
                  {slots.map((slot, index) => {
                    if (row.leave) return <td key={slot} className="p-3 text-center text-[11px] font-semibold text-amber-700">{dict.portal.onLeave}</td>;
                    const bookedSlot = index < row.free;
                    return (
                      <td key={slot} className="p-3 text-center">
                        <span className={`inline-grid size-8 place-items-center rounded-full text-[11px] font-semibold ${bookedSlot ? "bg-primary/10 text-primary-strong" : "bg-slate-100 text-muted"}`}>
                          {bookedSlot ? <CheckCircle2 className="size-4" /> : "-"}
                        </span>
                      </td>
                    );
                  })}
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      </Card>

      <Card className="mt-6 p-5">
        <h2 className="font-semibold text-navy">{dict.portal.leave}</h2>
        <div className="mt-4 flex flex-wrap items-center gap-3 rounded-[9px] border border-amber-200 bg-amber-50 px-4 py-3">
          <Plane className="size-4 shrink-0 text-amber-700" aria-hidden="true" />
          <div className="min-w-0 flex-1">
            <p className="text-sm font-semibold text-amber-900">{dict.portal.leaveRange}</p>
            <p className="text-xs text-amber-800">{dict.portal.leaveBlocked}</p>
          </div>
          <button type="button" className="min-h-10 rounded-[9px] border border-amber-300 bg-white px-3 text-xs font-semibold text-amber-800">{dict.portal.editLeave}</button>
        </div>
      </Card>
    </div>
  );
}

/* ---------------- Areas (FR-SP-08) ---------------- */

export function ProviderAreas({ locale, dict }: { locale: Locale; dict: Dictionary }) {
  const provider = me();
  const mine = areas.filter((item) => provider.areas.includes(item.slug));
  const open = areas.filter((item) => !provider.areas.includes(item.slug));

  return (
    <div>
      <PageHeader eyebrow={dict.portal.provider} title={dict.portal.serviceArea} description={dict.portal.serviceAreaText} />

      <div className="mt-6 grid gap-4 sm:grid-cols-3">
        <StatCard icon={MapPin} label={dict.providers.areasServed} value={String(mine.length)} />
        <StatCard icon={TrendingUp} label={dict.portal.travelRadius} value={`${dict.portal.radiusValue}`} />
        <StatCard icon={CheckCircle2} label={dict.portal.base} value={dict.portal.baseValue} />
      </div>

      <Card className="mt-6 p-5">
        <h2 className="font-semibold text-navy">{dict.portal.servedAreas}</h2>
        <p className="mt-1.5 text-sm text-secondary">{dict.portal.radiusNote}</p>
        <ul className="mt-4 grid gap-2 sm:grid-cols-2 lg:grid-cols-3">
          {mine.map((area) => (
            <li key={area.slug} className="flex items-center gap-2.5 rounded-[9px] border border-line px-3 py-2.5">
              <CheckCircle2 className="size-4 shrink-0 text-emerald-600" aria-hidden="true" />
              <span className="text-sm font-medium text-navy">{area.name[locale]}</span>
            </li>
          ))}
        </ul>
      </Card>

      <Card className="mt-6 p-5">
        <h2 className="font-semibold text-navy">{dict.portal.addAreas}</h2>
        <p className="mt-1.5 text-sm text-secondary">{dict.portal.addAreasText}</p>
        <ul className="mt-4 grid gap-2 sm:grid-cols-2 lg:grid-cols-3">
          {open.map((area) => (
            <li key={area.slug} className="flex items-center justify-between gap-2 rounded-[9px] border border-dashed border-line px-3 py-2.5">
              <span className="text-sm text-secondary">{area.name[locale]}</span>
              <button type="button" className="min-h-9 rounded-[8px] border border-line px-3 text-xs font-semibold text-primary-strong transition hover:bg-blue-50">{dict.portal.add}</button>
            </li>
          ))}
        </ul>
      </Card>
    </div>
  );
}

/* ---------------- Documents (FR-SP-06) ---------------- */

const documents = [
  { id: "cnic-front", name: "cnicFront", status: "VERIFIED", note: "verifiedOn" },
  { id: "cnic-back", name: "cnicBack", status: "VERIFIED", note: "verifiedOn" },
  { id: "trade", name: "tradeCertificate", status: "VERIFIED", note: "verifiedOn" },
  { id: "character", name: "characterCertificate", status: "PENDING", note: "pendingNote" },
] as const;

export function ProviderDocuments({ locale, dict }: { locale: Locale; dict: Dictionary }) {
  const pending = documents.filter((doc) => doc.status === "PENDING").length;

  return (
    <div>
      <PageHeader eyebrow={dict.portal.provider} title={dict.portal.documents} description={dict.portal.documentsText} />

      <div className="mt-6 grid gap-4 sm:grid-cols-3">
        <StatCard icon={FileCheck2} label={dict.portal.verifiedDocs} value={String(documents.length - pending)} />
        <StatCard icon={Clock3} label={dict.portal.pendingDocs} value={String(pending)} />
        <StatCard icon={ShieldAlert} label={dict.portal.approvalBlock} value={pending > 0 ? dict.common.yes : dict.common.no} />
      </div>

      <div className="mt-6 grid gap-5 md:grid-cols-2">
        {documents.map((doc) => {
          const verified = doc.status === "VERIFIED";
          return (
            <Card key={doc.id} className="p-5">
              <div className="flex items-start justify-between gap-3">
                <div>
                  <h2 className="font-semibold text-navy">{dict.portal.docs[doc.name]}</h2>
                  <p className="mt-1.5 text-sm text-secondary">
                    {verified ? dict.portal.docsNote[doc.note].replace("{date}", formatDate("2026-09-12", locale)) : dict.portal.docsNote.pendingNote}
                  </p>
                </div>
                <span className={`shrink-0 rounded-full px-2.5 py-1 text-[11px] font-semibold ${verified ? "bg-emerald-50 text-emerald-700" : "bg-amber-50 text-amber-800"}`}>
                  {verified ? dict.portal.verified : dict.portal.pending}
                </span>
              </div>
              <div className="mt-5 flex items-center gap-2 border-t border-line pt-4">
                <button type="button" className="inline-flex min-h-10 items-center gap-2 rounded-[9px] border border-line px-3 text-xs font-semibold text-navy transition hover:bg-slate-50">
                  <Upload className="size-4" aria-hidden="true" />
                  {dict.portal.replace}
                </button>
                {verified ? <span className="text-xs text-muted">{dict.portal.viewDocument}</span> : null}
              </div>
            </Card>
          );
        })}
      </div>
    </div>
  );
}

/* ---------------- Earnings (FR-SP-10) ---------------- */

export function ProviderEarnings({ locale, dict }: { locale: Locale; dict: Dictionary }) {
  const jobs = getBookingsForProvider(me().id);
  const held = jobs.filter((job) => job.paymentStatus === "HELD").reduce((sum, job) => sum + job.quotedPaisa, 0);
  const released = jobs.filter((job) => job.paymentStatus === "RELEASED").reduce((sum, job) => sum + (job.finalPaisa ?? job.quotedPaisa), 0);
  const commission = Math.round((held + released) * 0.12);
  const paid = 1842000;

  const rows = [
    { label: dict.portal.held, value: held, tone: "text-navy" },
    { label: dict.portal.releasable, value: released, tone: "text-emerald-700" },
    { label: dict.portal.commission, value: -commission, tone: "text-rose-600" },
    { label: dict.portal.paidOut, value: paid, tone: "text-secondary" },
  ];

  return (
    <div>
      <PageHeader eyebrow={dict.portal.provider} title={dict.portal.earnings} description={dict.portal.earningsText} action={<ButtonLink href={localizedPath(locale, "/provider/payouts")}>{dict.portal.requestPayout}</ButtonLink>} />

      <div className="mt-6 grid gap-4 sm:grid-cols-2 xl:grid-cols-4">
        {rows.map((row) => (
          <StatCard key={row.label} icon={Wallet} label={row.label} value={formatMoney(Math.abs(row.value), locale)} />
        ))}
      </div>

      <Card className="mt-6 overflow-hidden">
        <div className="border-b border-line p-5"><h2 className="font-semibold text-navy">{dict.portal.perBooking}</h2></div>
        <div className="overflow-x-auto">
          <table className="w-full min-w-[640px] text-sm">
            <thead className="bg-slate-50 text-xs text-muted"><tr><th className="p-4 text-start">{dict.common.service}</th><th className="p-4 text-start">{dict.common.date}</th><th className="p-4 text-start">{dict.common.status}</th><th className="p-4 text-end">{dict.common.amount}</th></tr></thead>
            <tbody className="divide-y divide-line">
              {jobs.map((job) => (
                <tr key={job.id} className="hover:bg-slate-50">
                  <td className="p-4 font-medium text-navy">{getService(job.serviceSlug)?.name[locale] ?? job.serviceSlug}</td>
                  <td className="p-4 text-secondary">{formatDateTime(job.scheduledStart, locale)}</td>
                  <td className="p-4"><StatusBadge status={job.status} label={dict.status[job.status]} /></td>
                  <td className="p-4 text-end font-semibold text-navy tabular-nums">{formatMoney(job.finalPaisa ?? job.quotedPaisa, locale)}</td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      </Card>

      <Card className="mt-6 p-5">
        <h2 className="font-semibold text-navy">{dict.portal.ledgerNote}</h2>
        <p className="mt-2 text-sm leading-6 text-secondary">{dict.portal.ledgerNoteText}</p>
      </Card>
    </div>
  );
}

/* ---------------- Payouts (FR-SP-11) ---------------- */

const payoutHistory = [
  { id: "po-1", amount: 420000, date: "2026-09-12", status: "PAID" },
  { id: "po-2", amount: 610000, date: "2026-09-05", status: "PAID" },
  { id: "po-3", amount: 385000, date: "2026-08-29", status: "PAID" },
] as const;

export function ProviderPayouts({ locale, dict }: { locale: Locale; dict: Dictionary }) {
  const minimum = 500000;
  const released = 1280000;

  return (
    <div>
      <PageHeader eyebrow={dict.portal.provider} title={dict.portal.payouts} description={dict.portal.payoutsText} />

      <div className="mt-6 grid gap-4 sm:grid-cols-3">
        <StatCard icon={Wallet} label={dict.portal.releasableBalance} value={formatMoney(released, locale)} />
        <StatCard icon={Banknote} label={dict.portal.minimumPayout} value={formatMoney(minimum, locale)} />
        <StatCard icon={CheckCircle2} label={dict.portal.paidToBank} value={formatMoney(payoutHistory.reduce((sum, row) => sum + row.amount, 0), locale)} />
      </div>

      <Card className="mt-6 p-5 sm:p-6">
        <h2 className="font-semibold text-navy">{dict.portal.requestPayout}</h2>
        <p className="mt-1.5 text-sm text-secondary">{dict.portal.payoutHint}</p>
        <div className="mt-5 flex flex-wrap items-center gap-3 rounded-[9px] border border-line bg-slate-50 px-4 py-3">
          <Banknote className="size-4 shrink-0 text-slate-400" aria-hidden="true" />
          <div className="min-w-0 flex-1">
            <p className="text-sm font-semibold text-navy">{dict.portal.bankAccount}</p>
            <p className="font-mono text-xs text-muted">**** 4471</p>
          </div>
          <button type="button" className="min-h-10 rounded-[9px] border border-line bg-white px-3 text-xs font-semibold text-navy">{dict.common.edit}</button>
        </div>
        {/* The payout is blocked by a real rule — the balance is under the
            minimum — so the button is omitted rather than shown permanently
            dead, and the reason carries the number it needs. */}
        <p className="mt-5 flex items-start gap-2 rounded-[10px] bg-amber-50 p-3.5 text-xs leading-5 text-amber-900">
          <Banknote className="mt-0.5 size-4 shrink-0" aria-hidden="true" />
          {dict.portal.payoutBlocked.replace("{amount}", formatMoney(minimum, locale))}
        </p>
      </Card>

      <Card className="mt-6 overflow-hidden">
        <div className="border-b border-line p-5"><h2 className="font-semibold text-navy">{dict.portal.payoutHistory}</h2></div>
        <div className="overflow-x-auto">
          <table className="w-full min-w-[520px] text-sm">
            <thead className="bg-slate-50 text-xs text-muted"><tr><th className="p-4 text-start">{dict.common.date}</th><th className="p-4 text-start">{dict.common.status}</th><th className="p-4 text-end">{dict.common.amount}</th></tr></thead>
            <tbody className="divide-y divide-line">
              {payoutHistory.map((row) => (
                <tr key={row.id}><td className="p-4 text-secondary">{formatDate(row.date, locale)}</td><td className="p-4"><span className="rounded-full bg-emerald-50 px-2.5 py-1 text-[11px] font-semibold text-emerald-700">{dict.portal.paid}</span></td><td className="p-4 text-end font-semibold text-navy tabular-nums">{formatMoney(row.amount, locale)}</td></tr>
              ))}
            </tbody>
          </table>
        </div>
      </Card>
    </div>
  );
}

/* ---------------- Ratings (FR-SP-04/05, FR-RT-05) ---------------- */

const buckets = [
  { stars: 5, count: 104 },
  { stars: 4, count: 18 },
  { stars: 3, count: 4 },
  { stars: 2, count: 1 },
  { stars: 1, count: 1 },
] as const;

export function ProviderRatings({ locale, dict }: { locale: Locale; dict: Dictionary }) {
  const provider = me();
  const mine = reviews.filter((review) => review.providerId === provider.id);
  const total = buckets.reduce((sum, row) => sum + row.count, 0);

  return (
    <div>
      <PageHeader eyebrow={dict.portal.provider} title={dict.portal.ratings} description={dict.portal.ratingsText} />

      <div className="mt-6 grid gap-5 lg:grid-cols-[320px_1fr]">
        <Card className="p-6">
          <p className="text-[52px] font-semibold leading-none tracking-[-0.04em] text-navy tabular-nums">{provider.rating.toFixed(1)}</p>
          <div className="mt-2 flex items-center gap-1" aria-label={`${dict.common.rating}: ${provider.rating}`}>
            {[1, 2, 3, 4, 5].map((n) => (
              <Star key={n} className={`size-4 ${n <= Math.round(provider.rating) ? "fill-yellow-500 text-yellow-500" : "text-slate-200"}`} aria-hidden="true" />
            ))}
          </div>
          <p className="mt-2 text-sm text-muted">{dict.providers.jobs.replace("{count}", formatNumber(provider.ratingCount, locale))}</p>
          <p className="mt-5 border-t border-line pt-4 text-xs leading-5 text-secondary">{dict.portal.ratingsSource}</p>
        </Card>

        <Card className="p-6">
          <h2 className="font-semibold text-navy">{dict.portal.distribution}</h2>
          <ul className="mt-5 grid gap-3">
            {buckets.map((row) => (
              <li key={row.stars} className="flex items-center gap-3">
                <span className="w-12 shrink-0 text-sm text-secondary tabular-nums">{row.stars} *...</span>
                <Progress value={(row.count / total) * 100} className="flex-1" />
                <span className="w-10 shrink-0 text-end text-sm text-muted tabular-nums">{formatNumber(row.count, locale)}</span>
              </li>
            ))}
          </ul>
        </Card>
      </div>

      <Card className="mt-6 overflow-hidden">
        <div className="border-b border-line p-5"><h2 className="font-semibold text-navy">{dict.portal.recentRemarks}</h2></div>
        <ul className="divide-y divide-line">
          {mine.length === 0 ? <li className="p-6"><p className="text-sm text-secondary">{dict.common.empty}</p></li> : mine.map((review) => (
            <li key={review.id} className="p-5">
              <div className="flex flex-wrap items-center justify-between gap-3">
                <div className="flex items-center gap-2">
                  <span className="text-sm font-semibold text-navy">{review.name}</span>
                  <span className="flex items-center gap-0.5" aria-label={`${dict.common.rating}: ${review.score}`}>
                    <Star className="size-3.5 fill-yellow-500 text-yellow-500" aria-hidden="true" />
                    <span className="text-xs font-semibold text-secondary tabular-nums">{review.score.toFixed(1)}</span>
                  </span>
                </div>
                <time dateTime={review.createdAt} className="text-xs text-muted">{formatDate(review.createdAt, locale)}</time>
              </div>
              <p className="mt-2.5 text-sm leading-6 text-secondary">{review.body}</p>
              <p className="mt-2 text-xs text-muted">{getService(review.serviceSlug)?.name[locale]}</p>
            </li>
          ))}
        </ul>
        <p className="border-t border-line bg-slate-50 px-5 py-3 text-xs text-muted">{dict.portal.remarksMasked}</p>
      </Card>
    </div>
  );
}

/* ---------------- Conduct (FR-SP-14) ---------------- */

/* SRS 8.2 demerit schedule and 8.3 active-point thresholds. */
const demerits = [
  { id: "LATE_30", category: "RELIABILITY", points: 1, consequence: "none", awarded: "2026-08-14", expires: "2027-02-14" },
  { id: "REWORK_VERIFIED", category: "QUALITY", points: 4, consequence: "reworkOwnCost", awarded: "2026-07-02", expires: "2027-01-02" },
  { id: "NO_SHOW", category: "RELIABILITY", points: 8, consequence: "fullRefund", awarded: "2026-04-19", expires: "2026-10-19" },
] as const;

const CEILING = 60;

const thresholds = [
  { at: 0, band: "good" },
  { at: 10, band: "warning" },
  { at: 20, band: "demotion" },
  { at: 30, band: "suspend7" },
  { at: 45, band: "suspend30" },
  { at: 60, band: "blocked" },
] as const;

export function ProviderConduct({ locale, dict }: { locale: Locale; dict: Dictionary }) {
  const active = demerits.reduce((sum, row) => sum + row.points, 0);
  const passed = [...thresholds].reverse().find((row) => active >= row.at) ?? thresholds[0];
  const upcoming = thresholds.find((row) => row.at > active) ?? null;
  const left = Math.max(0, (upcoming?.at ?? CEILING) - active);

  return (
    <div>
      <PageHeader eyebrow={dict.portal.provider} title={dict.portal.conduct} description={dict.portal.conductText} />

      <div className="mt-6 grid gap-4 sm:grid-cols-3">
        <StatCard icon={ShieldAlert} label={dict.portal.activePoints} value={`${active} / ${CEILING}`} />
        <StatCard icon={CheckCircle2} label={dict.portal.standing} value={dict.portal.bands[passed.band]} />
        <StatCard icon={Clock3} label={dict.portal.nextExpiry} value={formatDate("2026-10-19", locale)} />
      </div>

      <Card className="mt-6 p-5 sm:p-6">
        <div className="flex items-center justify-between gap-4">
          <h2 className="font-semibold text-navy">{dict.portal.pointsToCeiling}</h2>
          <span className="text-sm font-semibold text-navy tabular-nums">{active} / {CEILING}</span>
        </div>
        <div className="relative mt-4">
          <div className="h-2.5 overflow-hidden rounded-full bg-slate-100">
            <div
              className={`h-full rounded-full transition-all duration-500 ${active >= 45 ? "bg-rose-600" : active >= 20 ? "bg-amber-500" : "bg-yellow-500"}`}
              style={{ width: `${Math.min(100, (active / CEILING) * 100)}%` }}
            />
          </div>
          <ul className="mt-2 flex justify-between">
            {thresholds.slice(1).map((row) => (
              <li key={row.at} className="text-[10px] font-semibold text-muted tabular-nums">
                {formatNumber(row.at, locale)}
              </li>
            ))}
          </ul>
        </div>
        {upcoming ? (
          <p className="mt-3 text-xs leading-5 text-secondary">
            {dict.portal.ceilingNote
              .replace("{amount}", String(left))
              .replace("{threshold}", String(upcoming.at))
              .replace("{consequence}", dict.portal.bands[upcoming.band])}
          </p>
        ) : (
          <p className="mt-3 text-xs leading-5 text-rose-700">{dict.portal.blockedNote}</p>
        )}
      </Card>

      <Card className="mt-6 overflow-hidden">
        <div className="border-b border-line p-5"><h2 className="font-semibold text-navy">{dict.portal.awards}</h2></div>
        <ul className="divide-y divide-line">
          {demerits.map((row) => (
            <li key={row.id} className="flex flex-wrap items-start justify-between gap-4 p-5">
              <div className="min-w-0">
                <div className="flex flex-wrap items-center gap-2">
                  <p className="font-mono text-xs font-semibold text-primary-strong">{row.id}</p>
                  <span className="rounded-full bg-slate-100 px-2 py-0.5 text-[10px] font-semibold tracking-[0.08em] text-muted">
                    {dict.portal.categories[row.category]}
                  </span>
                </div>
                <p className="mt-1.5 text-sm text-navy">{dict.portal.demerits[row.id]}</p>
                <p className="mt-1 text-xs text-muted">
                  {dict.portal.awardedOn} {formatDate(row.awarded, locale)} | {dict.portal.consequences[row.consequence]}
                </p>
              </div>
              <div className="flex items-center gap-4">
                <span className="rounded-full bg-rose-50 px-2.5 py-1 text-xs font-semibold text-rose-700 tabular-nums">+{row.points}</span>
                <div className="text-end">
                  <p className="text-xs text-muted">{dict.portal.expires}</p>
                  <p className="text-sm text-secondary">{formatDate(row.expires, locale)}</p>
                </div>
              </div>
            </li>
          ))}
        </ul>
        <p className="border-t border-line bg-slate-50 px-5 py-3 text-xs text-muted">{dict.portal.decayNote}</p>
      </Card>

      <Card className="mt-6 p-5">
        <h2 className="font-semibold text-navy">{dict.portal.rightOfReply}</h2>
        <p className="mt-2 text-sm leading-6 text-secondary">{dict.portal.rightOfReplyText}</p>
        <ButtonLink href={localizedPath(locale, "/provider/profile")} variant="secondary" className="mt-4">{dict.portal.contactSupport}</ButtonLink>
      </Card>
    </div>
  );
}
