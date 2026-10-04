"use client";

import { AlertTriangle, CalendarDays, ClipboardCheck, MapPin, ReceiptText, ShieldCheck, UserRound } from "lucide-react";
import Link from "next/link";
import { useState } from "react";
import type { Dictionary } from "@/lib/dictionaries";
import { areas, bookings, getBooking, getService, providers } from "@/lib/data";
import { formatDateTime, formatMoney, localizedPath, type Locale } from "@/lib/utils";
import { ButtonLink, Card, PageHeader, StatCard, StatusBadge, buttonStyles } from "@/components/ui";

export function CustomerDashboard({ locale, dict }: { locale: Locale; dict: Dictionary }) {
  const active = bookings.filter((booking) => ["SCHEDULED", "IN_PROGRESS", "AWAITING_VERIFICATION", "EN_ROUTE"].includes(booking.status));
  return (
    <div>
      <PageHeader eyebrow={dict.portal.customer} title={dict.portal.dashboard} description={dict.portal.dashboardDescription} />
      <div className="mt-6 grid gap-4 sm:grid-cols-2 xl:grid-cols-4">
        <StatCard icon={ClipboardCheck} label={dict.portal.activeBookings} value={String(active.length)} />
        <StatCard icon={CalendarDays} label={dict.portal.upcomingVisits} value={String(bookings.filter((item) => item.scheduledStart >= "2026-09-25").length)} />
        <StatCard icon={ReceiptText} label={dict.portal.held} value={formatMoney(bookings.filter((item) => item.paymentStatus === "HELD").reduce((sum, item) => sum + item.quotedPaisa, 0), locale)} />
        <StatCard icon={ShieldCheck} label={dict.portal.verification} value="1" />
      </div>
      <Card className="mt-6 overflow-hidden">
        <div className="border-b border-line p-5"><h2 className="font-semibold text-navy">{dict.portal.activeBookings}</h2></div>
        <BookingTable locale={locale} dict={dict} items={active} />
      </Card>
    </div>
  );
}

function BookingTable({ locale, dict, items }: { locale: Locale; dict: Dictionary; items: typeof bookings }) {
  if (items.length === 0) return <p className="p-6 text-sm text-secondary">{dict.common.empty}</p>;
  return (
    <div className="overflow-x-auto">
      <table className="w-full min-w-[720px] text-start text-sm">
        <thead className="bg-slate-50 text-xs text-muted"><tr><th className="p-4 text-start">{dict.common.service}</th><th className="p-4 text-start">{dict.common.professional}</th><th className="p-4 text-start">{dict.common.date}</th><th className="p-4 text-start">{dict.common.status}</th><th className="p-4 text-end">{dict.common.amount}</th><th className="p-4 text-end">{dict.common.actions}</th></tr></thead>
        <tbody className="divide-y divide-line">
          {items.map((booking) => {
            const service = getService(booking.serviceSlug);
            const provider = booking.providerId ? providers.find((item) => item.id === booking.providerId) : null;
            return (
                <tr key={booking.id} className="hover:bg-slate-50">
                  <td className="p-4"><Link href={localizedPath(locale, `/account/bookings/${booking.id}`)} className="font-medium text-navy hover:text-primary-strong">{service?.name[locale] ?? booking.serviceSlug}</Link><p className="mt-1 text-xs text-muted">{booking.code}</p></td>
                  <td className="p-4 text-secondary">{provider?.name ?? dict.portal.newRequest}</td>
                  <td className="p-4 text-secondary">{formatDateTime(booking.scheduledStart, locale)}</td>
                  <td className="p-4"><StatusBadge status={booking.status} label={dict.status[booking.status]} /></td>
                  <td className="p-4 text-end font-semibold text-navy">{formatMoney(booking.finalPaisa ?? booking.quotedPaisa, locale)}</td>
                  {/* FR-CU-07: re-booking pre-fills service, address and provider. */}
                  <td className="p-4 text-end">
                    <Link href={`${localizedPath(locale, `/book/${booking.serviceSlug}`)}?rebook=${booking.id}`} className="text-sm font-semibold text-primary-strong hover:underline">
                      {dict.portal.rebook}
                    </Link>
                  </td>
                </tr>
            );
          })}
        </tbody>
      </table>
    </div>
  );
}

export function CustomerBookings({ locale, dict }: { locale: Locale; dict: Dictionary }) {
  return <div><PageHeader eyebrow={dict.portal.customer} title={dict.portal.bookings} description={dict.portal.bookingsDescription} /><Card className="mt-6 overflow-hidden"><BookingTable locale={locale} dict={dict} items={bookings} /></Card></div>;
}

export function BookingDetailView({ locale, dict, id }: { locale: Locale; dict: Dictionary; id: string }) {
  const booking = getBooking(id);
  const [complaintOpen, setComplaintOpen] = useState(false);
  const [complaintCategory, setComplaintCategory] = useState("scope");
  const [complaintText, setComplaintText] = useState("");
  const [complaintSubmitted, setComplaintSubmitted] = useState(false);

  const [warrantyOpen, setWarrantyOpen] = useState(false);
  const [warrantySubmitted, setWarrantySubmitted] = useState(false);

  if (!booking) return <p className="text-sm text-secondary">{dict.common.empty}</p>;
  const service = getService(booking.serviceSlug);
  const area = areas.find((item) => item.slug === booking.areaSlug);
  const provider = booking.providerId ? providers.find((item) => item.id === booking.providerId) : null;

  return (
    <div>
      <PageHeader
        eyebrow={booking.code}
        title={service?.name[locale] ?? booking.serviceSlug}
        description={booking.problem}
        action={<StatusBadge status={booking.status} label={dict.status[booking.status]} />}
      />

      <div className="mt-6 grid gap-6 lg:grid-cols-[1.2fr_0.8fr]">
        <div className="space-y-6">
          <Card className="p-5">
            <h2 className="font-semibold text-navy">{dict.common.status} Tracking</h2>
            <ol className="mt-5 grid gap-4">
              {["REQUESTED", "SCHEDULED", "IN_PROGRESS", booking.status].map((status, index) => (
                <li key={`${status}-${index}`} className="flex items-center gap-3 text-sm">
                  <span className="grid size-8 place-items-center rounded-full bg-blue-50 text-xs font-bold text-primary-strong">
                    {index + 1}
                  </span>
                  <div>
                    <span className="font-medium text-navy">{dict.status[status as keyof typeof dict.status] ?? status}</span>
                    <p className="text-xs text-muted">
                      {status === "REQUESTED"
                        ? "Booking registered and offered to top matching professional"
                        : status === "SCHEDULED"
                        ? "Assigned tradesman confirmed arrival window"
                        : status === "IN_PROGRESS"
                        ? "Start OTP verified and work under execution"
                        : "Current live stage on the platform"}
                    </p>
                  </div>
                </li>
              ))}
            </ol>
          </Card>

          {/* Assigned Tradesman Card */}
          <Card className="p-5">
            <h2 className="font-semibold text-navy">{dict.common.professional}</h2>
            <div className="mt-4 flex items-center justify-between">
              <div className="flex items-center gap-3">
                <div className="grid size-11 place-items-center rounded-full bg-blue-50 font-bold text-primary-strong">
                  {provider?.name.slice(0, 2) ?? "PR"}
                </div>
                <div>
                  <p className="font-semibold text-navy">{provider?.name ?? "Assigned Professional"}</p>
                  <p className="text-xs text-muted">CNIC & Background Verified · Lahore</p>
                </div>
              </div>
              <span className="rounded-full bg-emerald-50 px-2.5 py-1 text-xs font-semibold text-emerald-700">
                Verified Pro
              </span>
            </div>
          </Card>
        </div>

        <div className="grid content-start gap-4">
          <Card className="p-5">
            <h2 className="font-semibold text-navy">{dict.booking.scheduleTitle}</h2>
            <p className="mt-3 flex items-center gap-2 text-sm text-secondary">
              <CalendarDays className="size-4 text-primary" />
              {formatDateTime(booking.scheduledStart, locale)}
            </p>
            <p className="mt-2 flex items-center gap-2 text-sm text-secondary">
              <MapPin className="size-4 text-primary" />
              {area?.name[locale]}
            </p>
          </Card>

          <Card className="p-5">
            <h2 className="font-semibold text-navy">Payment & Protection</h2>
            <div className="mt-3 flex justify-between text-sm">
              <span className="text-muted">{dict.common.amount}</span>
              <span className="font-semibold text-navy">{formatMoney(booking.finalPaisa ?? booking.quotedPaisa, locale)}</span>
            </div>
            <div className="mt-2 flex justify-between text-sm">
              <span className="text-muted">{dict.common.status}</span>
              <span className="font-semibold text-emerald-700">{booking.paymentStatus}</span>
            </div>
            <p className="mt-3 rounded-[8px] bg-slate-50 p-2.5 text-xs text-muted">
              Funds are held safely in escrow and only released after your verification approval.
            </p>
          </Card>

          {/* Action Row: Dispute/Complaint & Warranty Claim */}
          <div className="space-y-2">
            <button
              type="button"
              onClick={() => setComplaintOpen(true)}
              className="inline-flex min-h-11 w-full items-center justify-center gap-2 rounded-[9px] border border-rose-300 bg-rose-50 px-4 text-sm font-semibold text-rose-700 transition hover:bg-rose-100"
            >
              <AlertTriangle className="size-4" />
              File a Complaint or Dispute (M10)
            </button>

            <button
              type="button"
              onClick={() => setWarrantyOpen(true)}
              className="inline-flex min-h-11 w-full items-center justify-center gap-2 rounded-[9px] border border-line bg-white px-4 text-sm font-semibold text-navy transition hover:bg-slate-50"
            >
              <ShieldCheck className="size-4 text-emerald-600" />
              Request Warranty Visit (CL-22)
            </button>

            <ButtonLink href={localizedPath(locale, "/account/bookings")} variant="secondary" className="w-full">
              {dict.common.back}
            </ButtonLink>
          </div>
        </div>
      </div>

      {/* Complaint / Dispute Modal */}
      {complaintOpen && (
        <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/50 p-4 backdrop-blur-xs">
          <div className="w-full max-w-lg rounded-[14px] bg-white p-6 shadow-xl">
            <div className="flex items-center justify-between border-b border-line pb-3">
              <h3 className="text-base font-bold text-navy flex items-center gap-2">
                <AlertTriangle className="size-5 text-rose-600" />
                Submit Formal Complaint (SRS §7.2)
              </h3>
              <button
                type="button"
                onClick={() => setComplaintOpen(false)}
                className="rounded-md p-1 text-muted hover:text-navy"
              >
                ✕
              </button>
            </div>

            {complaintSubmitted ? (
              <div className="py-8 text-center">
                <div className="mx-auto grid size-12 place-items-center rounded-full bg-emerald-50 text-emerald-600">
                  ✓
                </div>
                <h4 className="mt-3 text-base font-bold text-navy">Complaint Registered: CMP-8921</h4>
                <p className="mt-2 text-xs text-secondary leading-relaxed">
                  Our operations team has received your report. Escrow payout is paused, and a resolution agent will contact you within the 24h SLA.
                </p>
                <button
                  type="button"
                  onClick={() => {
                    setComplaintSubmitted(false);
                    setComplaintOpen(false);
                  }}
                  className="mt-5 rounded-[8px] bg-primary px-5 py-2 text-xs font-semibold text-white"
                >
                  Close
                </button>
              </div>
            ) : (
              <div className="mt-4 space-y-4">
                <div>
                  <label className="block text-xs font-semibold text-navy">Issue Category</label>
                  <select
                    value={complaintCategory}
                    onChange={(e) => setComplaintCategory(e.target.value)}
                    className="mt-1 w-full rounded-[8px] border border-line p-2 text-sm text-navy"
                  >
                    <option value="scope">Scope disputed / incomplete work</option>
                    <option value="overcharge">Attempted off-platform overcharge</option>
                    <option value="noshow">Tradesman no-show or late arrival</option>
                    <option value="safety">Unsafe work or property damage</option>
                  </select>
                </div>

                <div>
                  <label className="block text-xs font-semibold text-navy">Description & Evidence Details</label>
                  <textarea
                    rows={4}
                    value={complaintText}
                    onChange={(e) => setComplaintText(e.target.value)}
                    placeholder="Describe what occurred on site..."
                    className="mt-1 w-full rounded-[8px] border border-line p-2.5 text-sm text-navy focus:border-primary focus:outline-none"
                  />
                </div>

                <div className="flex justify-end gap-2 border-t border-line pt-3">
                  <button
                    type="button"
                    onClick={() => setComplaintOpen(false)}
                    className="rounded-[8px] border border-line px-4 py-2 text-xs font-semibold text-navy"
                  >
                    Cancel
                  </button>
                  <button
                    type="button"
                    disabled={complaintText.length < 10}
                    onClick={() => setComplaintSubmitted(true)}
                    className="rounded-[8px] bg-rose-600 px-4 py-2 text-xs font-semibold text-white disabled:opacity-50"
                  >
                    Submit Formal Dispute
                  </button>
                </div>
              </div>
            )}
          </div>
        </div>
      )}

      {/* Warranty Claim Modal */}
      {warrantyOpen && (
        <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/50 p-4 backdrop-blur-xs">
          <div className="w-full max-w-lg rounded-[14px] bg-white p-6 shadow-xl">
            <div className="flex items-center justify-between border-b border-line pb-3">
              <h3 className="text-base font-bold text-navy flex items-center gap-2">
                <ShieldCheck className="size-5 text-emerald-600" />
                Request Warranty Rework (CL-22)
              </h3>
              <button
                type="button"
                onClick={() => setWarrantyOpen(false)}
                className="rounded-md p-1 text-muted hover:text-navy"
              >
                ✕
              </button>
            </div>

            {warrantySubmitted ? (
              <div className="py-8 text-center">
                <div className="mx-auto grid size-12 place-items-center rounded-full bg-emerald-50 text-emerald-600">
                  ✓
                </div>
                <h4 className="mt-3 text-base font-bold text-navy">Rework Dispatched</h4>
                <p className="mt-2 text-xs text-secondary leading-relaxed">
                  Booking status reopened to <strong>REWORK_REQUIRED</strong>. A fresh start OTP has been generated for the revisit at no additional fee.
                </p>
                <button
                  type="button"
                  onClick={() => {
                    setWarrantySubmitted(false);
                    setWarrantyOpen(false);
                  }}
                  className="mt-5 rounded-[8px] bg-primary px-5 py-2 text-xs font-semibold text-white"
                >
                  Done
                </button>
              </div>
            ) : (
              <div className="mt-4 space-y-4">
                <div className="rounded-[8px] bg-emerald-50 p-3 text-xs text-emerald-800">
                  <strong>30-Day Platform Warranty Active:</strong> Rework visits for identical recurring defects are 100% free of charge under SRS CL-22.
                </div>
                <div>
                  <label className="block text-xs font-semibold text-navy">Describe the Recurring Defect</label>
                  <textarea
                    rows={3}
                    placeholder="E.g., The pipe fitting started leaking again from the joint..."
                    className="mt-1 w-full rounded-[8px] border border-line p-2.5 text-sm text-navy focus:border-primary focus:outline-none"
                  />
                </div>
                <div className="flex justify-end gap-2 border-t border-line pt-3">
                  <button
                    type="button"
                    onClick={() => setWarrantyOpen(false)}
                    className="rounded-[8px] border border-line px-4 py-2 text-xs font-semibold text-navy"
                  >
                    Cancel
                  </button>
                  <button
                    type="button"
                    onClick={() => setWarrantySubmitted(true)}
                    className="rounded-[8px] bg-emerald-600 px-4 py-2 text-xs font-semibold text-white"
                  >
                    Confirm Warranty Revisit
                  </button>
                </div>
              </div>
            )}
          </div>
        </div>
      )}
    </div>
  );
}

export function AddressesView({ locale, dict }: { locale: Locale; dict: Dictionary }) {
  return (
    <div>
      <PageHeader eyebrow={dict.portal.customer} title={dict.portal.addresses} action={<button className={buttonStyles()}><MapPin className="size-4" />{dict.portal.addAddress}</button>} />
      <div className="mt-6 grid gap-4 md:grid-cols-2">
        {areas.slice(0, 4).map((area, index) => <Card key={area.id} className="p-5"><div className="flex items-start justify-between gap-3"><div><h2 className="font-semibold text-navy">{area.name[locale]}</h2><p className="mt-2 text-sm text-secondary">House {24 + index}, Street {7 + index}, {area.name[locale]}</p><p className="mt-1 text-xs text-muted">Default · {index === 0 ? "Yes" : "No"}</p></div><MapPin className="size-5 text-primary" /></div></Card>)}
      </div>
    </div>
  );
}

export function ProfileView({ dict }: { dict: Dictionary }) {
  return (
    <div>
      <PageHeader eyebrow={dict.portal.customer} title={dict.portal.profile} action={<button className={buttonStyles()}><UserRound className="size-4" />{dict.portal.editProfile}</button>} />
      <div className="mt-6 grid gap-5 lg:grid-cols-[1fr_400px]">
        <Card className="p-6">
          <dl className="grid gap-4 text-sm"><div className="flex justify-between border-b border-line pb-3"><dt className="text-muted">{dict.auth.name}</dt><dd className="font-medium text-navy">Ayesha Khan</dd></div><div className="flex justify-between border-b border-line pb-3"><dt className="text-muted">{dict.auth.phone}</dt><dd className="text-navy">0300 1234567</dd></div><div className="flex justify-between"><dt className="text-muted">{dict.common.area}</dt><dd className="text-navy">Gulberg III</dd></div></dl>
        </Card>

        {/* FR-CU-09: deactivate anonymises PII, keeps bookings and the ledger. */}
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
          <button type="button" className="mt-6 min-h-11 w-full rounded-[9px] border border-rose-300 bg-rose-50 text-sm font-semibold text-rose-700 transition hover:bg-rose-100">
            {dict.portal.deactivate}
          </button>
          <p className="mt-3 text-xs text-muted">{dict.portal.deactivateHint}</p>
        </Card>
      </div>
    </div>
  );
}
