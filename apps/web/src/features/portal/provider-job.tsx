"use client";

import { useState } from "react";
import {
  Camera,
  Check,
  CheckCircle2,
  CircleAlert,
  ClipboardCheck,
  FileText,
  Lock,
  MapPin,
  Package,
  PhoneCall,
  PlayCircle,
  ShieldCheck,
  Truck,
  Wallet,
} from "lucide-react";
import type { Dictionary } from "@/lib/dictionaries";
import type { Booking, Text } from "@/lib/types";
import { getService } from "@/lib/data";
import { formatDateTime, formatMoney, formatNumber, type Locale } from "@/lib/utils";
import { Button, Card, PageHeader, StatusBadge } from "@/components/ui";

const OTP_LENGTH = 6;
const MAX_OTP_TRIES = 5;
const REQUIRED_PHOTOS = 1;

/* The evidence floor from the SRS, in the only order it is allowed to
   happen: depart, start OTP, before photos, checklist, revisions, after
   photos, complete. Nothing can be skipped, and the invoice cannot exceed
   the approved total. */
export function ProviderJob({ locale, dict, booking }: { locale: Locale; dict: Dictionary; booking: Booking }) {
  const service = getService(booking.serviceSlug);
  const checklist = service?.checklist ?? [];

  const [stage, setStage] = useState(0);
  const [checkedIn, setCheckedIn] = useState(false);
  const [otp, setOtp] = useState("");
  const [otpError, setOtpError] = useState("");
  const [otpTries, setOtpTries] = useState(0);
  const [otpLocked, setOtpLocked] = useState(false);
  const [beforePhotos, setBeforePhotos] = useState<string[]>([]);
  const [ticked, setTicked] = useState<Record<string, boolean>>({});
  const [parts, setParts] = useState<{ label: string; qty: number; cost: number }[]>([]);
  const [revision, setRevision] = useState({ label: "", cost: 0 });
  const [revisionApproved, setRevisionApproved] = useState(false);
  const [afterPhotos, setAfterPhotos] = useState<string[]>([]);
  const [rejected, setRejected] = useState(false);
  const [collected, setCollected] = useState(false);

  const base = service?.basePricePaisa ?? 0;
  const visitFee = service?.visitFeePaisa ?? 0;
  const approvedTotal = booking.quotedPaisa;
  const revisionTotal = revisionApproved ? revision.cost : 0;
  const partsTotal = parts.reduce((sum, part) => sum + part.qty * part.cost, 0);
  const cap = approvedTotal + revisionTotal;
  const finalTotal = rejected ? visitFee : Math.min(approvedTotal, base + partsTotal);

  const allTicked = checklist.every((item) => ticked[item.en]);
  const evidenceReady = checkedIn && beforePhotos.length >= REQUIRED_PHOTOS && allTicked && afterPhotos.length >= REQUIRED_PHOTOS;
  const overCap = base + partsTotal + revisionTotal > cap;

  const stages = [
    { key: "depart", label: dict.job.depart, icon: Truck },
    { key: "otp", label: dict.job.startOtp, icon: ShieldCheck },
    { key: "checkin", label: dict.job.geofenceCheckIn, icon: MapPin },
    { key: "before", label: dict.job.beforePhotos, icon: Camera },
    { key: "checklist", label: dict.job.checklist, icon: ClipboardCheck },
    { key: "parts", label: dict.job.parts, icon: Package },
    { key: "revision", label: dict.job.revision, icon: FileText },
    { key: "after", label: dict.job.afterPhotos, icon: Camera },
    { key: "complete", label: dict.job.complete, icon: CheckCircle2 },
    { key: "cash", label: dict.job.collectCash, icon: Wallet },
  ];

  const canAdvance = () => {
    switch (stage) {
      case 0: return true;
      /* A wrong code must not disable the button, otherwise the fifth attempt
         could never be made. Only the lockout stops the stage. */
      case 1: return !otpLocked && otp.length === OTP_LENGTH;
      case 2: return checkedIn;
      case 3: return beforePhotos.length >= REQUIRED_PHOTOS;
      case 4: return allTicked;
      case 5: return true;
      case 6: return true;
      case 7: return afterPhotos.length >= REQUIRED_PHOTOS;
      case 8: return evidenceReady && !overCap;
      default: return booking.paymentMode === "CASH" ? !collected : true;
    }
  };

  const advance = () => {
    if (stage === 1) {
      if (otpLocked) return;
      if (otp !== "482913") {
        const tries = otpTries + 1;
        setOtpTries(tries);
        if (tries >= MAX_OTP_TRIES) {
          setOtpLocked(true);
          setOtpError(dict.job.otpLocked);
        } else {
          setOtpError(dict.job.otpWrong.replace("{left}", String(MAX_OTP_TRIES - tries)));
        }
        return;
      }
      setOtpError("");
    }
    setStage((current) => Math.min(current + 1, stages.length - 1));
  };

  return (
    <div>
      <PageHeader
        eyebrow={`${booking.code} · ${dict.portal.jobs}`}
        title={service?.name[locale] ?? booking.serviceSlug}
        description={booking.problem}
        action={<StatusBadge status={booking.status} label={dict.status[booking.status]} />}
      />

      <div className="mt-6 grid gap-6 lg:grid-cols-[1fr_320px]">
        <div className="grid gap-5">
          <ol className="no-scrollbar flex gap-2 overflow-x-auto pb-1">
            {stages.map((item, index) => {
              const Icon = item.icon;
              const done = index < stage;
              const active = index === stage;
              return (
                <li key={item.key} className="flex shrink-0 items-center gap-2">
                  <span
                    className={`flex items-center gap-2 rounded-full border px-3 py-2 text-xs font-semibold transition ${
                      done
                        ? "border-emerald-200 bg-emerald-50 text-emerald-800"
                        : active
                          ? "border-primary bg-blue-50 text-primary-strong"
                          : "border-line bg-white text-muted"
                    }`}
                  >
                    {done ? <Check className="size-3.5" aria-hidden="true" /> : <Icon className="size-3.5" aria-hidden="true" />}
                    <span className="whitespace-nowrap">{item.label}</span>
                  </span>
                </li>
              );
            })}
          </ol>

          <Card className="p-6">
            {stage === 0 ? (
              <Step>
                <h2 className="text-lg font-semibold text-navy">{dict.job.departTitle}</h2>
                <p className="mt-1.5 text-sm leading-6 text-secondary">{dict.job.departText}</p>
                <p className="mt-5 flex items-start gap-2 rounded-[9px] bg-blue-50 p-3 text-sm text-navy">
                  <PhoneCall className="mt-0.5 size-4 shrink-0 text-primary-strong" aria-hidden="true" />
                  {dict.job.departNotify}
                </p>
              </Step>
            ) : null}

            {stage === 1 ? (
              <Step>
                <h2 className="text-lg font-semibold text-navy">{dict.job.otpTitle}</h2>
                <p className="mt-1.5 text-sm leading-6 text-secondary">{dict.job.otpText}</p>
                <label htmlFor="job-otp" className="mt-5 block text-xs font-semibold text-secondary">
                  {dict.job.otpLabel}
                </label>
                <input
                  id="job-otp"
                  inputMode="numeric"
                  maxLength={OTP_LENGTH}
                  value={otp}
                  disabled={otpLocked}
                  onChange={(event) => {
                    setOtp(event.target.value.replace(/\D/g, ""));
                    setOtpError("");
                  }}
                  placeholder="000000"
                  className="focus-none mt-2 w-full rounded-[9px] border border-line px-3 py-3 text-center font-mono text-xl tracking-[0.4em] text-navy disabled:bg-slate-50"
                />
                {otpLocked ? (
                  <p className="mt-3 flex items-center gap-2 rounded-[9px] bg-amber-50 p-3 text-sm text-amber-800">
                    <Lock className="size-4 shrink-0" aria-hidden="true" />
                    {dict.job.otpLockedHint}
                  </p>
                ) : otpError ? (
                  <p className="mt-3 rounded-[9px] bg-rose-50 p-3 text-sm text-rose-700">{otpError}</p>
                ) : (
                  <p className="mt-3 text-xs text-muted">{dict.job.otpHint}</p>
                )}
              </Step>
            ) : null}

            {stage === 2 ? (
              <Step>
                <h2 className="text-lg font-semibold text-navy">{dict.job.geofenceTitle}</h2>
                <p className="mt-1.5 text-sm leading-6 text-secondary">{dict.job.geofenceText}</p>
                <div className="mt-5 grid gap-2 sm:grid-cols-2">
                  {[
                    { k: "address", v: "Gulberg III, Lahore" },
                    { k: "radius", v: dict.job.geofenceRadius },
                    { k: "distance", v: "84 m" },
                    { k: "buffer", v: dict.job.travelBuffer },
                  ].map((row) => (
                    <div key={row.k} className="rounded-[9px] border border-line px-3 py-2.5">
                      <p className="text-[11px] font-semibold uppercase tracking-[0.1em] text-muted">{dict.job.metrics[row.k as "address"]}</p>
                      <p className="mt-1 text-sm font-medium text-navy">{row.v}</p>
                    </div>
                  ))}
                </div>
                <Button type="button" onClick={() => setCheckedIn(true)} disabled={checkedIn} className="mt-5">
                  {checkedIn ? dict.job.checkedIn : dict.job.checkInNow}
                </Button>
                {checkedIn ? (
                  <p className="mt-4 flex items-center gap-2 rounded-[9px] bg-emerald-50 p-3 text-sm font-semibold text-emerald-700">
                    <CheckCircle2 className="size-4" aria-hidden="true" />
                    {dict.job.checkedInAt} {formatDateTime(new Date().toISOString(), locale)}
                  </p>
                ) : null}
              </Step>
            ) : null}

            {stage === 3 || stage === 7 ? (
              <Step>
                <h2 className="text-lg font-semibold text-navy">{stage === 3 ? dict.job.beforeTitle : dict.job.afterTitle}</h2>
                <p className="mt-1.5 text-sm leading-6 text-secondary">{stage === 3 ? dict.job.beforeText : dict.job.afterText}</p>
                <PhotoGrid
                  photos={stage === 3 ? beforePhotos : afterPhotos}
                  onAdd={() => (stage === 3 ? setBeforePhotos((p) => [...p, `before-${p.length + 1}`]) : setAfterPhotos((p) => [...p, `after-${p.length + 1}`]))}
                  label={dict.job.addPhoto}
                  caption={dict.job.serverStamped}
                />
                <p className="mt-4 flex items-start gap-2 rounded-[9px] bg-slate-50 p-3 text-xs leading-5 text-secondary">
                  <CircleAlert className="mt-0.5 size-3.5 shrink-0" aria-hidden="true" />
                  {dict.job.resumableNote}
                </p>
              </Step>
            ) : null}

            {stage === 4 ? (
              <Step>
                <h2 className="text-lg font-semibold text-navy">{dict.job.checklistTitle}</h2>
                <p className="mt-1.5 text-sm leading-6 text-secondary">{dict.job.checklistText}</p>
                <ul className="mt-5 grid gap-2.5">
                  {checklist.map((item, index) => {
                    const on = ticked[item.en] === true;
                    return (
                      <li key={item.en}>
                        <label
                          className={`flex cursor-pointer items-start gap-3 rounded-[10px] border p-3.5 transition ${
                            on ? "border-emerald-200 bg-emerald-50" : "border-line hover:border-slate-300"
                          }`}
                        >
                          <input
                            type="checkbox"
                            checked={on}
                            onChange={(event) => setTicked((current) => ({ ...current, [item.en]: event.target.checked }))}
                            className="mt-0.5 size-4 accent-primary"
                          />
                          <span className="min-w-0 flex-1">
                            <span className="block text-sm text-navy">{item[locale]}</span>
                            {index === 1 ? <span className="mt-1 block text-xs font-semibold text-amber-700">{dict.job.photoRequired}</span> : null}
                          </span>
                          {on ? <CheckCircle2 className="mt-0.5 size-4 shrink-0 text-emerald-700" aria-hidden="true" /> : null}
                        </label>
                      </li>
                    );
                  })}
                </ul>
                {!allTicked ? <p className="mt-4 text-sm text-amber-700">{dict.job.checklistBlocked}</p> : null}
              </Step>
            ) : null}

            {stage === 5 ? (
              <Step>
                <h2 className="text-lg font-semibold text-navy">{dict.job.partsTitle}</h2>
                <p className="mt-1.5 text-sm leading-6 text-secondary">{dict.job.partsText}</p>
                <div className="mt-5 grid gap-2 sm:grid-cols-[1fr_5rem_7rem_auto]">
                  <input
                    value={revision.label}
                    onChange={(event) => setRevision((r) => ({ ...r, label: event.target.value }))}
                    placeholder={dict.job.partName}
                    className="focus-none min-h-11 rounded-[9px] border border-line px-3 text-sm"
                  />
                  <input
                    inputMode="numeric"
                    value={parts.length ? "" : "1"}
                    readOnly
                    className="focus-none min-h-11 rounded-[9px] border border-line px-3 text-center text-sm"
                    aria-label={dict.job.qty}
                  />
                  <input
                    inputMode="numeric"
                    value={revision.cost ? String(revision.cost) : ""}
                    onChange={(event) => setRevision((r) => ({ ...r, cost: Number(event.target.value.replace(/\D/g, "")) || 0 }))}
                    placeholder="0"
                    className="focus-none min-h-11 rounded-[9px] border border-line px-3 text-end text-sm tabular-nums"
                    aria-label={dict.job.cost}
                  />
                  <button
                    type="button"
                    onClick={() => {
                      if (!revision.label.trim()) return;
                      setParts((list) => [...list, { label: revision.label, qty: 1, cost: revision.cost }]);
                      setRevision({ label: "", cost: 0 });
                    }}
                    className="min-h-11 rounded-[9px] border border-navy bg-navy px-4 text-sm font-semibold text-white"
                  >
                    {dict.job.addLine}
                  </button>
                </div>
                {parts.length > 0 ? (
                  <ul className="mt-4 divide-y divide-line rounded-[9px] border border-line">
                    {parts.map((part, index) => (
                      <li key={`${part.label}-${index}`} className="flex items-center justify-between gap-3 px-3 py-2.5 text-sm">
                        <span className="text-navy">{part.label}</span>
                        <span className="font-semibold text-navy tabular-nums">{formatMoney(part.cost, locale)}</span>
                      </li>
                    ))}
                  </ul>
                ) : null}
              </Step>
            ) : null}

            {stage === 6 ? (
              <Step>
                <h2 className="text-lg font-semibold text-navy">{dict.job.revisionTitle}</h2>
                <p className="mt-1.5 text-sm leading-6 text-secondary">{dict.job.revisionText}</p>

                <div className="mt-5 grid gap-2 sm:grid-cols-[1fr_8rem_auto]">
                  <input
                    value={revision.label}
                    onChange={(event) => setRevision((r) => ({ ...r, label: event.target.value }))}
                    placeholder={dict.job.extraWork}
                    className="focus-none min-h-11 rounded-[9px] border border-line px-3 text-sm"
                  />
                  <input
                    inputMode="numeric"
                    value={revision.cost ? String(revision.cost) : ""}
                    onChange={(event) => setRevision((r) => ({ ...r, cost: Number(event.target.value.replace(/\D/g, "")) || 0 }))}
                    placeholder="0"
                    className="focus-none min-h-11 rounded-[9px] border border-line px-3 text-end text-sm tabular-nums"
                    aria-label={dict.job.cost}
                  />
                  <button
                    type="button"
                    onClick={() => setRevisionApproved(false)}
                    className="min-h-11 rounded-[9px] border border-line px-4 text-sm font-semibold text-navy"
                  >
                    {dict.job.sendForApproval}
                  </button>
                </div>

                {revision.cost > 0 ? (
                  <div className="mt-4 rounded-[10px] border border-amber-200 bg-amber-50 p-4">
                    <p className="text-sm font-semibold text-amber-900">{revision.label || dict.job.extraWork}</p>
                    <p className="mt-1 text-sm text-amber-800">{formatMoney(revision.cost, locale)}</p>
                    <div className="mt-3 flex flex-wrap items-center gap-2">
                      <button
                        type="button"
                        onClick={() => setRevisionApproved(true)}
                        disabled={revisionApproved}
                        className="min-h-10 rounded-[9px] bg-primary px-4 text-xs font-semibold text-white disabled:opacity-50"
                      >
                        {revisionApproved ? dict.job.customerApproved : dict.job.simulateApproval}
                      </button>
                      <span className="text-xs text-amber-800">
                        {revisionApproved ? dict.job.approvedNote : dict.job.approvalBlocked}
                      </span>
                    </div>
                  </div>
                ) : null}
              </Step>
            ) : null}

            {stage === 8 ? (
              <Step>
                <h2 className="text-lg font-semibold text-navy">{dict.job.invoiceTitle}</h2>
                <p className="mt-1.5 text-sm leading-6 text-secondary">{dict.job.invoiceText}</p>

                <label className="mt-5 flex cursor-pointer items-start gap-3 rounded-[10px] border border-line p-3.5 text-sm">
                  <input type="checkbox" checked={rejected} onChange={(event) => setRejected(event.target.checked)} className="mt-0.5 size-4 accent-primary" />
                  <span>
                    <span className="block font-medium text-navy">{dict.job.inspectionOnly}</span>
                    <span className="mt-0.5 block text-secondary">{dict.job.inspectionOnlyText}</span>
                  </span>
                </label>

                <dl className="mt-5 divide-y divide-line border-y border-line text-sm">
                  <Line label={dict.common.service} value={formatMoney(base, locale)} />
                  {visitFee > 0 ? <Line label={dict.booking.visitFee} value={formatMoney(visitFee, locale)} /> : null}
                  {partsTotal > 0 ? <Line label={dict.job.parts} value={formatMoney(partsTotal, locale)} /> : null}
                  {revisionTotal > 0 ? <Line label={dict.job.revision} value={`+ ${formatMoney(revisionTotal, locale)}`} tone="text-amber-700" /> : null}
                  <Line label={dict.job.approvedTotal} value={formatMoney(cap, locale)} muted />
                  <Line label={dict.common.total} value={formatMoney(finalTotal, locale)} strong />
                </dl>

                {overCap ? <p className="mt-4 rounded-[9px] bg-rose-50 p-3 text-sm text-rose-700">{dict.job.capBreached}</p> : null}
                {rejected ? <p className="mt-4 rounded-[9px] bg-blue-50 p-3 text-sm text-navy">{dict.job.visitFeeOnly}</p> : null}

                <div className="mt-5 grid gap-2 sm:grid-cols-2">
                  {([
                    ["geofence", checkedIn],
                    ["before", beforePhotos.length >= REQUIRED_PHOTOS],
                    ["checklist", allTicked],
                    ["after", afterPhotos.length >= REQUIRED_PHOTOS],
                  ] as const).map(([key, ok]) => (
                    <p key={key} className={`flex items-center gap-2 text-xs ${ok ? "text-emerald-700" : "text-rose-600"}`}>
                      {ok ? <CheckCircle2 className="size-3.5" aria-hidden="true" /> : <CircleAlert className="size-3.5" aria-hidden="true" />}
                      {dict.job.evidenceFloor[key]}
                    </p>
                  ))}
                </div>
              </Step>
            ) : null}

            {stage === 9 ? (
              <Step>
                <h2 className="text-lg font-semibold text-navy">{dict.job.cashTitle}</h2>
                <p className="mt-1.5 text-sm leading-6 text-secondary">{dict.job.cashText}</p>
                <p className="mt-5 rounded-[12px] border border-emerald-200 bg-emerald-50 p-4 text-center">
                  <span className="block text-xs font-semibold uppercase tracking-[0.12em] text-emerald-800">{dict.job.collect}</span>
                  <span className="mt-1 block text-3xl font-semibold tracking-[-0.04em] text-emerald-900">{formatMoney(finalTotal, locale)}</span>
                </p>
                {collected ? (
                  <p className="mt-4 flex items-center gap-2 rounded-[9px] bg-emerald-50 p-3 text-sm font-semibold text-emerald-700">
                    <CheckCircle2 className="size-4" aria-hidden="true" />
                    {dict.job.commissionPosted}
                  </p>
                ) : (
                  <Button type="button" onClick={() => setCollected(true)} className="mt-5 w-full">{dict.job.paymentReceived}</Button>
                )}
              </Step>
            ) : null}

            {stage < stages.length - 1 ? (
              <>
                {stage === 4 && !allTicked ? (
                  <p className="mt-5 rounded-[9px] bg-amber-50 p-3 text-sm text-amber-800">{dict.job.checklistBlocked}</p>
                ) : null}
                {stage === 8 && (!evidenceReady || overCap) ? (
                  <p className="mt-5 rounded-[9px] bg-rose-50 p-3 text-sm text-rose-700">{overCap ? dict.job.capBreached : dict.job.evidenceIncomplete}</p>
                ) : null}
                <Button type="button" onClick={advance} disabled={!canAdvance()} className="mt-6 w-full">
                  {dict.job.continueAction}
                </Button>
              </>
            ) : (
              <p className="mt-6 flex items-center justify-center gap-2 rounded-[10px] bg-emerald-50 p-4 text-sm font-semibold text-emerald-700">
                <CheckCircle2 className="size-4" aria-hidden="true" />
                {dict.job.jobClosed}
              </p>
            )}
          </Card>
        </div>

        <aside className="grid content-start gap-4">
          <Card className="p-5">
            <p className="text-sm text-muted">{dict.common.date}</p>
            <p className="mt-1 font-semibold text-navy">{formatDateTime(booking.scheduledStart, locale)}</p>
            <p className="mt-4 text-sm text-muted">{dict.common.amount}</p>
            <p className="mt-1 font-semibold text-navy">{formatMoney(approvedTotal, locale)}</p>
            <p className="mt-4 flex items-center gap-1.5 border-t border-line pt-4 text-xs text-muted">
              <PlayCircle className="size-3.5" aria-hidden="true" />
              {dict.job.stage} {formatNumber(stage + 1, locale)} / {formatNumber(stages.length, locale)}
            </p>
          </Card>

          <Card className="p-5">
            <p className="flex items-center gap-2 text-sm font-semibold text-navy">
              <ClipboardCheck className="size-4" aria-hidden="true" />
              {dict.services.included}
            </p>
            <ul className="mt-3 grid gap-2 text-sm text-secondary">
              {checklist.map((item: Text) => (
                <li key={item.en}>· {item[locale]}</li>
              ))}
            </ul>
          </Card>
        </aside>
      </div>
    </div>
  );
}

function Step({ children }: { children: React.ReactNode }) {
  return <div>{children}</div>;
}

function Line({ label, value, muted, strong, tone }: { label: string; value: string; muted?: boolean; strong?: boolean; tone?: string }) {
  return (
    <div className="flex items-center justify-between gap-4 py-2.5">
      <dt className={muted ? "text-xs text-muted" : "text-secondary"}>{label}</dt>
      <dd className={`tabular-nums ${strong ? "text-lg font-semibold text-navy" : tone ?? (muted ? "text-xs text-muted" : "font-medium text-navy")}`}>{value}</dd>
    </div>
  );
}

function PhotoGrid({ photos, onAdd, label, caption }: { photos: string[]; onAdd: () => void; label: string; caption: string }) {
  const samplePhotos = [
    "https://images.unsplash.com/photo-1584622650111-993a426fbf0a?auto=format&fit=crop&w=300&q=80",
    "https://images.unsplash.com/photo-1581244277943-fe4a9c777189?auto=format&fit=crop&w=300&q=80",
    "https://images.unsplash.com/photo-1621905251189-08b45d6a269e?auto=format&fit=crop&w=300&q=80",
  ];

  return (
    <div className="mt-5">
      <div className="grid grid-cols-2 gap-3 sm:grid-cols-4">
        {photos.map((photo, i) => (
          <div key={photo} className="relative aspect-square overflow-hidden rounded-[10px] border border-line bg-slate-900 shadow-xs">
            {/* eslint-disable-next-line @next/next/no-img-element */}
            <img
              src={samplePhotos[i % samplePhotos.length]}
              alt={`Evidence ${i + 1}`}
              className="h-full w-full object-cover opacity-90"
            />
            <div className="absolute inset-x-0 bottom-0 bg-gradient-to-t from-black/80 to-transparent p-2 text-[10px] text-white">
              <span className="font-mono">Server-stamped</span>
              <span className="block text-[9px] text-emerald-400">✓ Uploaded</span>
            </div>
          </div>
        ))}
        <button
          type="button"
          onClick={onAdd}
          className="flex aspect-square flex-col items-center justify-center rounded-[10px] border-2 border-dashed border-primary/40 bg-blue-50/50 p-3 text-primary transition hover:border-primary hover:bg-blue-50"
        >
          <Camera className="size-6 text-primary" aria-hidden="true" />
          <span className="mt-2 text-center text-xs font-bold leading-tight">
            {label}
          </span>
          <span className="mt-0.5 text-[10px] text-muted">Tap to snap</span>
        </button>
      </div>
      <p className="mt-2.5 text-xs text-muted">{caption}</p>
    </div>
  );
}
