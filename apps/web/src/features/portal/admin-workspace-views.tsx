"use client";

import {
  Activity,
  BadgeCheck,
  Ban,
  BookOpen,
  Building2,
  CircleDollarSign,
  ClipboardCheck,
  FileCheck2,
  Gauge,
  History,
  Lock,
  Plus,
  ScrollText,
  Settings2,
  ShieldAlert,
  SlidersHorizontal,
  TriangleAlert,
  UsersRound,
  X,
} from "lucide-react";
import { useState } from "react";
import type { Dictionary } from "@/lib/dictionaries";
import type { PricingModel, Service } from "@/lib/types";
import { bookings, categories, getService, providers, services } from "@/lib/data";
import { formatDate, formatDateTime, formatDuration, formatMoney, formatNumber, getText, type Locale } from "@/lib/utils";
import {
  Card,
  PageHeader,
  StatCard,
  StatusBadge,
} from "@/components/ui";

/* ------------------------------------------------------------------ *
 * Operations board — FR-AD-12. Every count is derived from the same
 * rows the rest of the product reads, never a stored total.
 * ------------------------------------------------------------------ */

export function AdminOps({ locale, dict }: { locale: Locale; dict: Dictionary }) {

  const open = bookings.filter((b) => b.status !== "COMPLETED" && b.status !== "CANCELLED");
  const held = bookings.filter((b) => b.paymentStatus === "HELD").reduce((s, b) => s + b.quotedPaisa, 0);
  const awaitingCall = bookings.filter((b) => b.status === "AWAITING_VERIFICATION");

  const lanes = [
    { key: "requested", label: dict.admin.laneRequested, count: bookings.filter((b) => b.status === "REQUESTED").length, tone: "bg-amber-500" },
    { key: "scheduled", label: dict.admin.laneScheduled, count: bookings.filter((b) => b.status === "SCHEDULED").length, tone: "bg-blue-500" },
    { key: "progress", label: dict.admin.laneInProgress, count: bookings.filter((b) => b.status === "IN_PROGRESS" || b.status === "EN_ROUTE").length, tone: "bg-primary" },
    { key: "verify", label: dict.admin.laneVerification, count: awaitingCall.length, tone: "bg-purple-500" },
    { key: "disputed", label: dict.admin.laneDisputed, count: bookings.filter((b) => b.status === "DISPUTED").length, tone: "bg-rose-500" },
  ];
  const rows = [...open].sort((left, right) => right.scheduledStart.localeCompare(left.scheduledStart));

  return (
    <div>
      <PageHeader eyebrow={dict.portal.admin} title={dict.admin.ops} description={dict.admin.opsText} />

      <div className="mt-6 grid gap-4 sm:grid-cols-2 xl:grid-cols-4">
        <StatCard icon={Activity} label={dict.portal.totalBookings} value={String(bookings.length)} />
        <StatCard icon={CircleDollarSign} label={dict.portal.held} value={formatMoney(held, locale)} />
        <StatCard icon={ClipboardCheck} label={dict.admin.awaitingCall} value={String(awaitingCall.length)} />
        <StatCard icon={UsersRound} label={dict.home.statPros} value={String(providers.length)} />
      </div>

      <div className="mt-6 grid gap-3 sm:grid-cols-2 lg:grid-cols-5">
        {lanes.map((lane) => (
          <Card key={lane.key} className="p-4">
            <div className="flex items-center gap-2">
              <span className={`size-2.5 rounded-full ${lane.tone}`} aria-hidden="true" />
              <p className="text-xs font-semibold text-muted">{lane.label}</p>
            </div>
            <p className="mt-2 text-2xl font-semibold tracking-[-0.04em] text-navy tabular-nums">
              {formatNumber(lane.count, locale)}
            </p>
          </Card>
        ))}
      </div>

      <Card className="mt-6 overflow-hidden">
        <div className="flex flex-wrap items-center justify-between gap-3 border-b border-line p-5">
          <h2 className="font-semibold text-navy">{dict.admin.liveBookings}</h2>
          <p className="text-xs text-muted">{dict.admin.countsNote}</p>
        </div>
        <div className="overflow-x-auto">
          <table className="w-full min-w-[760px] text-sm">
            <thead className="bg-slate-50 text-xs text-muted">
              <tr>
                <th className="p-4 text-start">{dict.common.service}</th>
                <th className="p-4 text-start">{dict.common.professional}</th>
                <th className="p-4 text-start">{dict.common.date}</th>
                <th className="p-4 text-start">{dict.common.status}</th>
                <th className="p-4 text-end">{dict.common.amount}</th>
              </tr>
            </thead>
            <tbody className="divide-y divide-line">
              {rows.map((booking) => {
                const provider = booking.providerId
                  ? providers.find((p) => p.id === booking.providerId)
                  : null;
                return (
                  <tr key={booking.id} className="hover:bg-slate-50">
                    <td className="p-4">
                      <p className="font-medium text-navy">{getService(booking.serviceSlug)?.name[locale]}</p>
                      <p className="mt-1 font-mono text-xs text-muted">{booking.code}</p>
                    </td>
                    <td className="p-4 text-secondary">{provider?.name ?? dict.admin.unassigned}</td>
                    <td className="p-4 text-secondary">{formatDateTime(booking.scheduledStart, locale)}</td>
                    <td className="p-4">
                      <StatusBadge status={booking.status} label={dict.status[booking.status]} />
                    </td>
                    <td className="p-4 text-end font-semibold text-navy tabular-nums">
                      {formatMoney(booking.quotedPaisa, locale)}
                    </td>
                  </tr>
                );
              })}
            </tbody>
          </table>
        </div>
      </Card>
    </div>
  );
}

/* ------------------------------------------------------------------ *
 * Approvals — FR-AD-02, FR-AD-10, FR-AD-11
 * ------------------------------------------------------------------ */

const initialApplicants = [
  { id: "app-1", name: "Tariq Mehmood", trade: "plumbing", experience: 7, docs: 3, docsVerified: 3, submitted: "2026-09-20", rating: 0, state: "PENDING" },
  { id: "app-2", name: "Hina Yousaf", trade: "carpentry", experience: 4, docs: 3, docsVerified: 2, submitted: "2026-09-19", rating: 0, state: "PENDING" },
  { id: "app-3", name: "Zain Abbas", trade: "electrical", experience: 11, docs: 2, docsVerified: 2, submitted: "2026-09-18", rating: 0, state: "PENDING" },
  { id: "app-4", name: "Bilal Nawaz", trade: "appliance", experience: 2, docs: 3, docsVerified: 1, submitted: "2026-09-12", rating: 0, state: "REJECTED" },
];

export function AdminApprovals({ locale, dict }: { locale: Locale; dict: Dictionary }) {
  const [list, setList] = useState(initialApplicants);

  const pending = list.filter((a) => a.state === "PENDING");
  const ready = pending.filter((a) => a.docsVerified === a.docs);

  const handleApprove = (id: string) => {
    setList((prev) =>
      prev.map((app) => (app.id === id ? { ...app, state: "APPROVED" } : app))
    );
  };

  const handleReject = (id: string) => {
    setList((prev) =>
      prev.map((app) => (app.id === id ? { ...app, state: "REJECTED" } : app))
    );
  };

  const handleVerifyOneDoc = (id: string) => {
    setList((prev) =>
      prev.map((app) =>
        app.id === id && app.docsVerified < app.docs
          ? { ...app, docsVerified: app.docsVerified + 1 }
          : app
      )
    );
  };

  const rows = [...list].sort((left, right) => right.submitted.localeCompare(left.submitted));

  return (
    <div>
      <PageHeader eyebrow={dict.portal.admin} title={dict.admin.approvals} description={dict.admin.approvalsText} />

      <div className="mt-6 grid gap-4 sm:grid-cols-2 xl:grid-cols-4">
        <StatCard icon={ClipboardCheck} label={dict.admin.pendingApproval} value={String(pending.length)} />
        <StatCard icon={BadgeCheck} label={dict.admin.readyToApprove} value={String(ready.length)} />
        <StatCard icon={FileCheck2} label={dict.admin.documentsToCheck} value={String(pending.reduce((s, a) => s + (a.docs - a.docsVerified), 0))} />
        <StatCard icon={Ban} label={dict.admin.rejected} value={String(list.filter((a) => a.state === "REJECTED").length)} />
      </div>

      <div className="mt-6 grid gap-5">
        {rows.map((applicant) => {
          const allDocs = applicant.docsVerified === applicant.docs;
          const rejected = applicant.state === "REJECTED";
          const approved = applicant.state === "APPROVED";
          return (
            <Card key={applicant.id} className="p-5">
              <div className="flex flex-wrap items-start justify-between gap-4">
                <div>
                  <h2 className="text-[17px] font-semibold tracking-[-0.025em] text-navy">{applicant.name}</h2>
                  <p className="mt-1 text-xs font-semibold uppercase tracking-[0.1em] text-muted">
                    {getText(categories.find((c) => c.slug === applicant.trade)?.name ?? { en: applicant.trade, ur: applicant.trade }, locale)} · {dict.providers.experience.replace("{years}", String(applicant.experience))}
                  </p>
                  <p className="mt-2 text-xs text-muted">{dict.admin.submitted} {formatDate(applicant.submitted, locale)}</p>
                </div>
                <span className={`rounded-full px-2.5 py-1 text-[11px] font-semibold ${
                  approved
                    ? "bg-blue-50 text-primary-strong ring-1 ring-primary/20"
                    : rejected
                    ? "bg-rose-50 text-rose-700"
                    : allDocs
                    ? "bg-emerald-50 text-emerald-700"
                    : "bg-amber-50 text-amber-800"
                }`}>
                  {approved ? dict.admin.approvalStates.APPROVED : rejected ? dict.admin.rejected : allDocs ? dict.admin.readyToApprove : dict.admin.pendingDocsShort}
                </span>
              </div>

              <div className="mt-5">
                <div className="flex items-center justify-between text-xs text-muted">
                  <span>{dict.admin.documentCheck}</span>
                  <span className="tabular-nums">{applicant.docsVerified} / {applicant.docs}</span>
                </div>
                <div className="mt-2 h-1.5 overflow-hidden rounded-full bg-slate-100">
                  <div className={`h-full rounded-full ${allDocs ? "bg-emerald-500" : "bg-amber-500"}`} style={{ width: `${(applicant.docsVerified / applicant.docs) * 100}%` }} />
                </div>
              </div>

              <div className="mt-5 flex flex-wrap items-center gap-2 border-t border-line pt-4">
                <button
                  type="button"
                  disabled={!allDocs || rejected || approved}
                  onClick={() => handleApprove(applicant.id)}
                  className="min-h-10 rounded-[9px] bg-primary px-4 text-xs font-semibold text-white transition hover:bg-primary-strong disabled:pointer-events-none disabled:opacity-40"
                >
                  {approved ? dict.admin.approvalStates.APPROVED : dict.admin.approve}
                </button>
                <button
                  type="button"
                  disabled={rejected || allDocs || approved}
                  onClick={() => handleVerifyOneDoc(applicant.id)}
                  className="min-h-10 rounded-[9px] border border-line px-4 text-xs font-semibold text-navy transition hover:bg-slate-50 disabled:pointer-events-none disabled:opacity-40"
                >
                  {dict.admin.verifyNextDoc}
                </button>
                <button
                  type="button"
                  disabled={rejected || approved}
                  onClick={() => handleReject(applicant.id)}
                  className="min-h-10 rounded-[9px] border border-line px-4 text-xs font-semibold text-rose-600 transition hover:border-rose-300 hover:bg-rose-50 disabled:pointer-events-none disabled:opacity-40"
                >
                  {dict.admin.reject}
                </button>
                {!allDocs && !rejected && !approved ? <p className="text-xs text-amber-700">{dict.admin.approveBlocked}</p> : null}
              </div>
            </Card>
          );
        })}
      </div>
    </div>
  );
}

/* ------------------------------------------------------------------ *
 * Catalogue — FR-CAT-01, FR-CAT-02, FR-CAT-05, FR-CAT-07
 * ------------------------------------------------------------------ */

export function AdminCatalogue({ locale, dict }: { locale: Locale; dict: Dictionary }) {
  const [modalOpen, setModalOpen] = useState(false);
  const [serviceList, setServiceList] = useState(services);

  const [nameEn, setNameEn] = useState("");
  const [nameUr, setNameUr] = useState("");
  const [category, setCategory] = useState(categories[0].slug);
  const [pricingModel, setPricingModel] = useState<PricingModel>("FLAT");
  const [basePrice, setBasePrice] = useState("2500");
  const [maxPrice, setMaxPrice] = useState("3500");
  const [duration, setDuration] = useState("60");
  const [emergency, setEmergency] = useState(true);
  const [warranty, setWarranty] = useState("30");

  const handleAddService = (e: React.FormEvent) => {
    e.preventDefault();
    const targetCat = categories.find((c) => c.slug === category) ?? categories[0];
    const newService: Service = {
      id: `srv-${Date.now()}`,
      categoryId: targetCat.id,
      categorySlug: category,
      slug: nameEn.toLowerCase().replace(/\s+/g, "-"),
      name: { en: nameEn, ur: nameUr || nameEn },
      description: { en: `${nameEn} performed by verified pros.`, ur: `${nameUr || nameEn} کا معیاری کام` },
      pricingModel,
      basePricePaisa: parseInt(basePrice || "0", 10) * 100,
      maxPricePaisa: parseInt(maxPrice || basePrice || "0", 10) * 100,
      visitFeePaisa: 50000,
      expectedDurationMin: parseInt(duration || "60", 10),
      warrantyDays: parseInt(warranty || "0", 10),
      emergency,
      planEligible: true,
      image: targetCat.image,
      checklist: [
        { en: "Inspect & diagnose problem", ur: "مسئلہ کی جانچ کریں" },
        { en: "Test resolution with customer", ur: "گاہک کے ساتھ تسلی کریں" },
      ],
    };
    setServiceList([newService, ...serviceList]);
    setModalOpen(false);
    setNameEn("");
    setNameUr("");
  };

  const rows = [...serviceList].sort((left, right) => left.name[locale].localeCompare(right.name[locale], locale));

  return (
    <div>
      <PageHeader
        eyebrow={dict.portal.admin}
        title={dict.admin.catalogue}
        description={dict.admin.catalogueText}
        action={
          <button
            type="button"
            onClick={() => setModalOpen(true)}
            className="inline-flex min-h-11 items-center gap-2 rounded-[9px] bg-primary px-5 text-sm font-semibold text-white transition hover:bg-primary-strong shadow-xs"
          >
            <Plus className="size-4" aria-hidden="true" />
            {dict.admin.addService}
          </button>
        }
      />

      <div className="mt-6 grid gap-4 sm:grid-cols-3">
        <StatCard icon={Building2} label={dict.admin.categories} value={String(categories.length)} />
        <StatCard icon={SlidersHorizontal} label={dict.admin.services} value={String(serviceList.length)} />
        <StatCard icon={CircleDollarSign} label={dict.admin.commissionRate} value={`${formatNumber(15, locale)}%`} />
      </div>

      <Card className="mt-6 overflow-hidden">
        <div className="border-b border-line p-5"><h2 className="font-semibold text-navy">{dict.admin.serviceCatalogue}</h2></div>
        <div className="overflow-x-auto">
          <table className="w-full min-w-[900px] text-sm">
            <thead className="bg-slate-50 text-xs text-muted">
              <tr>
                <th className="p-4 text-start">{dict.common.service}</th>
                <th className="p-4 text-start">{dict.admin.category}</th>
                <th className="p-4 text-start">{dict.admin.pricingModel}</th>
                <th className="p-4 text-start">{dict.admin.baseToMax}</th>
                <th className="p-4 text-start">{dict.common.durationLabel}</th>
                <th className="p-4 text-start">{dict.admin.flags}</th>
              </tr>
            </thead>
            <tbody className="divide-y divide-line">
              {rows.map((service) => {
                const cat = categories.find((c) => c.slug === service.categorySlug);
                return (
                  <tr key={service.id} className="hover:bg-slate-50">
                    <td className="p-4">
                      <p className="font-medium text-navy">{service.name[locale]}</p>
                      <p className="mt-1 font-mono text-xs text-muted">{service.slug}</p>
                    </td>
                    <td className="p-4 text-secondary">{cat?.name[locale]}</td>
                    <td className="p-4 font-mono text-xs text-secondary">
                      {dict.admin.pricingModels[service.pricingModel ?? "FLAT"]}
                    </td>
                    <td className="p-4 text-secondary tabular-nums">
                      {formatMoney(service.basePricePaisa, locale)} – {formatMoney(service.maxPricePaisa, locale)}
                    </td>
                    <td className="p-4 text-secondary tabular-nums">{formatDuration(service.expectedDurationMin, locale)}</td>
                    <td className="p-4">
                      <div className="flex flex-wrap gap-1.5">
                        {service.emergency ? <span className="rounded-full bg-amber-50 px-2 py-0.5 text-[10px] font-semibold text-amber-800">{dict.common.emergency}</span> : null}
                        {service.planEligible ? <span className="rounded-full bg-blue-50 px-2 py-0.5 text-[10px] font-semibold text-primary-strong">{dict.home.statServices}</span> : null}
                        <span className="rounded-full bg-slate-100 px-2 py-0.5 text-[10px] font-semibold text-muted">{dict.common.warranty.replace("{days}", String(service.warrantyDays))}</span>
                      </div>
                    </td>
                  </tr>
                );
              })}
            </tbody>
          </table>
        </div>
      </Card>

      <Card className="mt-6 p-5">
        <h2 className="font-semibold text-navy">{dict.admin.commissionResolution}</h2>
        <p className="mt-2 text-sm leading-6 text-secondary">{dict.admin.commissionResolutionText}</p>
        <ul className="mt-4 grid gap-2 font-mono text-xs text-secondary">
          <li className="rounded-[6px] bg-slate-50 px-3 py-2">provider &gt; category &gt; global &nbsp;·&nbsp; snapshotted on the booking as commission_rate_bp</li>
        </ul>
      </Card>

      {/* Add Service Modal */}
      {modalOpen && (
        <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/50 p-4 backdrop-blur-xs">
          <div className="w-full max-w-xl max-h-[90vh] overflow-y-auto rounded-[14px] bg-white p-6 shadow-xl">
            <div className="flex items-center justify-between border-b border-line pb-3">
              <h3 className="text-base font-bold text-navy flex items-center gap-2">
                <BookOpen className="size-5 text-primary" />
                Add Catalogue Service (FR-CAT-01 / CL-01)
              </h3>
              <button
                type="button"
                onClick={() => setModalOpen(false)}
                className="rounded-md p-1 text-muted hover:text-navy"
              >
                <X className="size-5" />
              </button>
            </div>

            <form onSubmit={handleAddService} className="mt-4 space-y-4">
              <div className="grid grid-cols-1 gap-4 sm:grid-cols-2">
                <div>
                  <label className="block text-xs font-semibold text-navy">Service Name (English)</label>
                  <input
                    type="text"
                    required
                    placeholder="e.g. Inverter AC Gas Refill"
                    value={nameEn}
                    onChange={(e) => setNameEn(e.target.value)}
                    className="mt-1 w-full rounded-[8px] border border-line p-2 text-sm text-navy focus:border-primary focus:outline-none"
                  />
                </div>
                <div>
                  <label className="block text-xs font-semibold text-navy">Service Name (Urdu)</label>
                  <input
                    type="text"
                    placeholder="انورٹر اے سی گیس ریفل"
                    dir="rtl"
                    value={nameUr}
                    onChange={(e) => setNameUr(e.target.value)}
                    className="mt-1 w-full rounded-[8px] border border-line p-2 text-sm text-navy focus:border-primary focus:outline-none"
                  />
                </div>
              </div>

              <div className="grid grid-cols-1 gap-4 sm:grid-cols-2">
                <div>
                  <label className="block text-xs font-semibold text-navy">Category</label>
                  <select
                    value={category}
                    onChange={(e) => setCategory(e.target.value)}
                    className="mt-1 w-full rounded-[8px] border border-line p-2 text-sm text-navy"
                  >
                    {categories.map((c) => (
                      <option key={c.slug} value={c.slug}>
                        {c.name[locale]}
                      </option>
                    ))}
                  </select>
                </div>
                <div>
                  <label className="block text-xs font-semibold text-navy">Pricing Model (CL-01)</label>
                  <select
                    value={pricingModel}
                    onChange={(e) => setPricingModel(e.target.value as PricingModel)}
                    className="mt-1 w-full rounded-[8px] border border-line p-2 text-sm text-navy"
                  >
                    <option value="FLAT">FLAT (Fixed Price)</option>
                    <option value="TIME_BASED">TIME_BASED (Hourly / Daily Rate)</option>
                    <option value="INSPECTION_FIRST">INSPECTION_FIRST (Visit Fee + Quote)</option>
                  </select>
                </div>
              </div>

              <div className="grid grid-cols-3 gap-3">
                <div>
                  <label className="block text-xs font-semibold text-navy">Base Price (PKR)</label>
                  <input
                    type="number"
                    value={basePrice}
                    onChange={(e) => setBasePrice(e.target.value)}
                    className="mt-1 w-full rounded-[8px] border border-line p-2 text-sm text-navy"
                  />
                </div>
                <div>
                  <label className="block text-xs font-semibold text-navy">Max Price (PKR)</label>
                  <input
                    type="number"
                    value={maxPrice}
                    onChange={(e) => setMaxPrice(e.target.value)}
                    className="mt-1 w-full rounded-[8px] border border-line p-2 text-sm text-navy"
                  />
                </div>
                <div>
                  <label className="block text-xs font-semibold text-navy">Duration (min)</label>
                  <input
                    type="number"
                    value={duration}
                    onChange={(e) => setDuration(e.target.value)}
                    className="mt-1 w-full rounded-[8px] border border-line p-2 text-sm text-navy"
                  />
                </div>
              </div>

              <div className="flex flex-wrap items-center gap-6 border-t border-line pt-3">
                <label className="flex items-center gap-2 text-xs font-medium text-navy cursor-pointer">
                  <input
                    type="checkbox"
                    checked={emergency}
                    onChange={(e) => setEmergency(e.target.checked)}
                    className="size-4 rounded border-line text-primary focus:ring-primary"
                  />
                  Same-day / Emergency Eligible (+25% surcharge)
                </label>

                <div className="flex items-center gap-2 text-xs font-medium text-navy">
                  <span>Warranty:</span>
                  <select
                    value={warranty}
                    onChange={(e) => setWarranty(e.target.value)}
                    className="rounded-[6px] border border-line p-1 text-xs"
                  >
                    <option value="0">No Warranty</option>
                    <option value="15">15 Days</option>
                    <option value="30">30 Days</option>
                    <option value="60">60 Days</option>
                  </select>
                </div>
              </div>

              <div className="flex justify-end gap-2 border-t border-line pt-4">
                <button
                  type="button"
                  onClick={() => setModalOpen(false)}
                  className="rounded-[8px] border border-line px-4 py-2 text-xs font-semibold text-navy"
                >
                  Cancel
                </button>
                <button
                  type="submit"
                  className="rounded-[8px] bg-primary px-5 py-2 text-xs font-semibold text-white shadow-xs hover:bg-primary-strong"
                >
                  Save & Publish Service
                </button>
              </div>
            </form>
          </div>
        </div>
      )}
    </div>
  );
}

/* ------------------------------------------------------------------ *
 * Complaints — FR-CP-02, FR-CP-03, FR-CP-08
 * ------------------------------------------------------------------ */

const complaints = [
  { id: "cp-1", booking: "bk-1031", code: "SHM-0001031", subject: "scopeDisputed", severity: "HIGH", state: "UNDER_REVIEW", opened: "2026-09-24", sla: 24 },
  { id: "cp-2", booking: "bk-1036", code: "SHM-0001036", subject: "noShow", severity: "NORMAL", state: "AWAITING_RESPONSE", opened: "2026-09-22", sla: 72 },
  { id: "cp-3", booking: "bk-1030", code: "SHM-0001030", subject: "unsafeWork", severity: "SAFETY", state: "OPEN", opened: "2026-09-25", sla: 1 },
  { id: "cp-4", booking: "bk-1034", code: "SHM-0001034", subject: "overcharged", severity: "NORMAL", state: "RESOLVED", opened: "2026-09-15", sla: 72 },
  { id: "cp-5", booking: "bk-1029", code: "SHM-0001029", subject: "noShow", severity: "HIGH", state: "OPEN", opened: "2026-09-25", sla: 24 },
  { id: "cp-6", booking: "bk-1033", code: "SHM-0001033", subject: "scopeDisputed", severity: "SAFETY", state: "UNDER_REVIEW", opened: "2026-09-23", sla: 1 },
  { id: "cp-7", booking: "bk-1032", code: "SHM-0001032", subject: "overcharged", severity: "NORMAL", state: "AWAITING_RESPONSE", opened: "2026-09-20", sla: 72 },
  { id: "cp-8", booking: "bk-1027", code: "SHM-0001027", subject: "unsafeWork", severity: "HIGH", state: "RESOLVED", opened: "2026-09-11", sla: 24 },
] as const;

export function AdminComplaints({ locale, dict }: { locale: Locale; dict: Dictionary }) {
  const openStates = ["OPEN", "UNDER_REVIEW", "AWAITING_RESPONSE"];

  const rows = [...complaints].sort((left, right) => right.opened.localeCompare(left.opened));

  return (
    <div>
      <PageHeader eyebrow={dict.portal.admin} title={dict.admin.complaints} description={dict.admin.complaintsText} />

      <div className="mt-6 grid gap-4 sm:grid-cols-2 xl:grid-cols-4">
        <StatCard icon={ScrollText} label={dict.admin.openComplaints} value={String(complaints.filter((c) => openStates.includes(c.state)).length)} />
        <StatCard icon={ShieldAlert} label={dict.admin.safetyComplaints} value={String(complaints.filter((c) => c.severity === "SAFETY" && openStates.includes(c.state)).length)} />
        <StatCard icon={Gauge} label={dict.admin.slaBreaches} value="0" />
        <StatCard icon={BadgeCheck} label={dict.admin.resolved} value={String(complaints.filter((c) => c.state === "RESOLVED").length)} />
      </div>

      <Card className="mt-6 overflow-hidden">
        <div className="flex flex-wrap items-center justify-between gap-3 border-b border-line p-5">
          <h2 className="font-semibold text-navy">{dict.admin.queue}</h2>
          <p className="text-xs text-muted">{dict.admin.slaNote}</p>
        </div>
        <ul className="divide-y divide-line">
          {rows.map((row) => {
            const isSafety = row.severity === "SAFETY";
            const isOpen = openStates.includes(row.state);
            const tone = row.severity === "SAFETY" ? "bg-rose-50 text-rose-700" : row.severity === "HIGH" ? "bg-amber-50 text-amber-800" : "bg-slate-100 text-secondary";
            return (
              <li key={row.id} className={isSafety ? "bg-rose-50/30 p-5" : "p-5"}>
                <div className="flex flex-wrap items-start justify-between gap-4">
                  <div className="min-w-0">
                    <div className="flex flex-wrap items-center gap-2">
                      <p className="font-mono text-xs font-semibold text-navy">{row.code}</p>
                      <span className={`rounded-full px-2 py-0.5 text-[10px] font-semibold uppercase tracking-[0.08em] ${tone}`}>
                        {dict.admin.severity[row.severity]}
                      </span>
                      <span className={`rounded-full px-2 py-0.5 text-[10px] font-semibold ${isOpen ? "bg-blue-50 text-primary-strong" : "bg-emerald-50 text-emerald-700"}`}>
                        {dict.admin.complaintStates[row.state]}
                      </span>
                    </div>
                    <p className="mt-2 text-sm font-medium text-navy">{dict.admin.subjects[row.subject]}</p>
                    <p className="mt-1 text-xs text-muted">
                      {dict.admin.opened} {formatDate(row.opened, locale)} · {dict.admin.sla} {formatNumber(row.sla, locale)}h
                    </p>
                  </div>
                  {isSafety ? <p className="text-xs font-semibold text-rose-700">{dict.admin.safetyJumpsFirst}</p> : null}
                </div>
                {isOpen ? (
                  <div className="mt-4 flex flex-wrap gap-2 border-t border-line pt-4">
                    <button type="button" className="min-h-10 rounded-[9px] bg-primary px-4 text-xs font-semibold text-white transition hover:bg-primary-strong">{dict.admin.takeAction}</button>
                    <button type="button" className="min-h-10 rounded-[9px] border border-line px-4 text-xs font-semibold text-navy transition hover:bg-slate-50">{dict.admin.askForPhotos}</button>
                    <button type="button" className="min-h-10 rounded-[9px] border border-line px-4 text-xs font-semibold text-rose-600 transition hover:border-rose-300 hover:bg-rose-50">{dict.admin.escalate}</button>
                  </div>
                ) : null}
              </li>
            );
          })}
        </ul>
        <p className="border-t border-line bg-slate-50 px-5 py-3 text-xs text-muted">{dict.admin.replyWindowNote}</p>
      </Card>
    </div>
  );
}

/* ------------------------------------------------------------------ *
 * Settings — FR-AD-15, the whole Section 13 catalogue
 * ------------------------------------------------------------------ */

const settings: { br: string; key: string; value: string; group: keyof Dictionary["admin"]["settingGroups"] }[] = [
  { br: "BR-01", key: "booking.offer_timeout_min", value: "15", group: "booking" },
  { br: "BR-02", key: "booking.free_cancel_hours", value: "4", group: "booking" },
  { br: "BR-03", key: "booking.late_cancel_fee", value: "PKR 500", group: "booking" },
  { br: "BR-06", key: "booking.max_offers", value: "5", group: "booking" },
  { br: "BR-08", key: "booking.travel_buffer_min", value: "30", group: "booking" },
  { br: "BR-09", key: "evidence.geofence_radius_m", value: "200", group: "evidence" },
  { br: "BR-11", key: "verification.sla_min", value: "30", group: "verification" },
  { br: "BR-12", key: "verification.cash_sla_min", value: "15", group: "verification" },
  { br: "BR-13", key: "verification.calling_hours", value: "08:00-22:00 PKT", group: "verification" },
  { br: "BR-15", key: "verification.max_attempts", value: "3 in 24 h", group: "verification" },
  { br: "BR-16", key: "verification.auto_release_hours", value: "72", group: "verification" },
  { br: "BR-25", key: "verification.force_tier_a", value: "true", group: "verification" },
  { br: "BR-35", key: "commission.default_pct", value: "15 %", group: "money" },
  { br: "BR-36", key: "emergency.surcharge_pct", value: "25 %", group: "money" },
  { br: "BR-37", key: "cash.debt_ceiling", value: "PKR 5 000", group: "money" },
  { br: "BR-50", key: "payout.cycle", value: "Weekly, Monday 10:00", group: "money" },
  { br: "BR-51", key: "payout.min_amount", value: "PKR 1 000", group: "money" },
  { br: "BR-40", key: "rating.recent_weight", value: "2 (last 20)", group: "quality" },
  { br: "BR-45", key: "demerit.expiry_days / decay_days", value: "180 / 30", group: "quality" },
  { br: "BR-46", key: "penalty.reply_hours", value: "48", group: "quality" },
  { br: "BR-55", key: "recording.retention_days", value: "180", group: "quality" },
  { br: "BR-56", key: "complaint.sla_hours", value: "SAFETY 1 / HIGH 24 / NORMAL 72", group: "quality" },
  { br: "BR-60", key: "ranking.weights", value: "rating .35 / distance .25 / completion .20 / response .10 / recency .10", group: "ranking" },
];

export function AdminSettings({ dict }: { dict: Dictionary }) {
  const groups = Object.keys(dict.admin.settingGroups) as (keyof Dictionary["admin"]["settingGroups"])[];

  return (
    <div>
      <PageHeader
        eyebrow={dict.portal.admin}
        title={dict.admin.settings}
        description={dict.admin.settingsText}
        action={
          <button type="button" className="inline-flex min-h-11 items-center gap-2 rounded-[9px] bg-primary px-5 text-sm font-semibold text-white transition hover:bg-primary-strong">
            <Settings2 className="size-4" aria-hidden="true" />
            {dict.admin.saveChanges}
          </button>
        }
      />

      <div className="mt-6 flex items-start gap-3 rounded-[12px] border border-blue-200 bg-blue-50 px-4 py-3">
        <Lock className="mt-0.5 size-4 shrink-0 text-primary-strong" aria-hidden="true" />
        <p className="text-sm leading-6 text-navy">{dict.admin.noDeployNote}</p>
      </div>

      <div className="mt-6 grid items-start gap-5">
        {groups.map((group) => (
          <Card key={group} className="overflow-hidden">
            <div className="flex items-center justify-between border-b border-line px-5 py-4">
              <h2 className="font-semibold text-navy">{dict.admin.settingGroups[group]}</h2>
              <span className="rounded-full bg-slate-100 px-2 py-0.5 text-[11px] font-semibold text-muted tabular-nums">
                {settings.filter((s) => s.group === group).length}
              </span>
            </div>
            <ul className="divide-y divide-line">
              {settings.filter((s) => s.group === group).map((row) => {
                const isLong = row.value.length > 16;
                return (
                  <li key={row.br} className="flex items-center gap-4 px-5 py-3">
                    <span className="w-16 shrink-0 font-mono text-[11px] font-semibold text-primary-strong">{row.br}</span>
                    <p className="min-w-0 flex-1 truncate font-mono text-xs text-secondary" title={row.key}>{row.key}</p>
                    {isLong ? (
                      <span className="shrink-0 rounded-[7px] border border-line bg-slate-50 px-2.5 py-1.5 text-xs font-semibold text-navy">
                        {row.value}
                      </span>
                    ) : (
                      <input
                        readOnly
                        value={row.value}
                        aria-label={row.key}
                        className="focus-none w-28 shrink-0 rounded-[7px] border border-line bg-slate-50 px-2.5 py-1.5 text-end text-xs font-semibold text-navy tabular-nums"
                      />
                    )}
                  </li>
                );
              })}
            </ul>
          </Card>
        ))}
      </div>
    </div>
  );
}

/* ------------------------------------------------------------------ *
 * Audit — FR-AD-14, append-only
 * ------------------------------------------------------------------ */

const audit = [
  { id: "au-1", at: "2026-09-25T16:40:00+05:00", actor: "agent.sadia", action: "VERIFICATION_SUBMITTED", entity: "bk-1030", ip: "10.4.2.19" },
  { id: "au-2", at: "2026-09-25T15:12:00+05:00", actor: "finance.owais", action: "PAYOUT_APPROVED", entity: "po-2044", ip: "10.4.2.31" },
  { id: "au-3", at: "2026-09-25T14:05:00+05:00", actor: "admin.kamran", action: "PROVIDER_APPROVED", entity: "prv-imran-appliance", ip: "10.4.2.07" },
  { id: "au-4", at: "2026-09-25T11:48:00+05:00", actor: "system", action: "AUTO_RELEASE_ELIGIBLE", entity: "bk-1029", ip: "127.0.0.1" },
  { id: "au-5", at: "2026-09-24T19:20:00+05:00", actor: "admin.kamran", action: "REMARK_UNPUBLISHED", entity: "rev-008", ip: "10.4.2.07" },
  { id: "au-6", at: "2026-09-24T17:02:00+05:00", actor: "system", action: "SETTING_CHANGED", entity: "BR-12", ip: "127.0.0.1" },
  { id: "au-7", at: "2026-09-24T15:36:00+05:00", actor: "agent.sadia", action: "PENALTY_PROPOSED", entity: "pn-2", ip: "10.4.2.19" },
  { id: "au-8", at: "2026-09-24T13:02:00+05:00", actor: "admin.kamran", action: "CATALOGUE_UPDATED", entity: "srv-ac-gas-refill", ip: "10.4.2.07" },
  { id: "au-9", at: "2026-09-23T18:44:00+05:00", actor: "finance.owais", action: "REFUND_APPROVED", entity: "bk-1026", ip: "10.4.2.31" },
  { id: "au-10", at: "2026-09-23T16:10:00+05:00", actor: "system", action: "PLAN_PURCHASE", entity: "plan-care-plus", ip: "127.0.0.1" },
  { id: "au-11", at: "2026-09-23T10:28:00+05:00", actor: "admin.usman", action: "ROLE_CHANGED", entity: "staff-014", ip: "10.4.2.44" },
  { id: "au-12", at: "2026-09-22T09:14:00+05:00", actor: "agent.hina", action: "VERIFICATION_SUBMITTED", entity: "bk-1031", ip: "10.4.2.51" },
];

export function AdminAudit({ dict }: { dict: Dictionary }) {
  const rows = [...audit].sort((left, right) => right.at.localeCompare(left.at));

  return (
    <div>
      <PageHeader eyebrow={dict.portal.admin} title={dict.admin.audit} description={dict.admin.auditText} />

      <div className="mt-6 grid gap-4 sm:grid-cols-2 xl:grid-cols-4">
        <StatCard icon={History} label={dict.admin.entries} value={String(audit.length)} />
        <StatCard icon={Lock} label={dict.admin.mutable} value="0" />
        <StatCard icon={UsersRound} label={dict.admin.actors} value={String(new Set(audit.map((a) => a.actor)).size)} />
        <StatCard icon={ShieldAlert} label={dict.admin.deletions} value="0" />
      </div>

      <div className="mt-6 flex items-start gap-3 rounded-[12px] border border-amber-200 bg-amber-50 px-4 py-3">
        <TriangleAlert className="mt-0.5 size-4 shrink-0 text-amber-700" aria-hidden="true" />
        <p className="text-sm leading-6 text-amber-900">{dict.admin.appendOnlyNote}</p>
      </div>

      <Card className="mt-6 overflow-hidden">
        <div className="overflow-x-auto">
          <table className="w-full min-w-[820px] text-sm">
            <thead className="bg-slate-50 text-xs text-muted">
              <tr>
                <th className="p-4 text-start">{dict.admin.when}</th>
                <th className="p-4 text-start">{dict.admin.actor}</th>
                <th className="p-4 text-start">{dict.admin.action}</th>
                <th className="p-4 text-start">{dict.admin.entity}</th>
                <th className="p-4 text-start">{dict.admin.ip}</th>
              </tr>
            </thead>
            <tbody className="divide-y divide-line">
              {rows.map((row) => (
                <tr key={row.id} className="hover:bg-slate-50">
                  <td className="p-4 font-mono text-xs text-secondary">{row.at.replace("T", " ").replace("+05:00", "")}</td>
                  <td className="p-4">
                    <span className={`rounded-full px-2 py-0.5 text-[10px] font-semibold ${row.actor === "system" ? "bg-slate-100 text-muted" : "bg-blue-50 text-primary-strong"}`}>{row.actor}</span>
                  </td>
                  <td className="p-4 font-mono text-xs font-semibold text-navy">{row.action}</td>
                  <td className="p-4 font-mono text-xs text-secondary">{row.entity}</td>
                  <td className="p-4 font-mono text-xs text-muted">{row.ip}</td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      </Card>
    </div>
  );
}
