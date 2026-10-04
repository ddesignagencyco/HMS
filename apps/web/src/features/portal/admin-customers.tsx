"use client";

import { BadgeCheck, ShieldAlert, UserRound, UsersRound, Wallet } from "lucide-react";
import type { Dictionary } from "@/lib/dictionaries";
import { areas } from "@/lib/data";
import { formatDate, formatMoney, formatNumber, type Locale } from "@/lib/utils";
import {
  Card,
  PageHeader,
  StatCard,
} from "@/components/ui";

/* ------------------------------------------------------------------ *
 * Customers — FR-AD-05, FR-AD-09 (soft deactivation only)
 *
 * The register is a working surface, not a summary: an operator reads
 * the account list top to bottom, so the table runs the full width of
 * the page with nothing beside it.
 * ------------------------------------------------------------------ */

type CustomerRow = {
  id: string;
  name: string;
  phone: string;
  joined: string;
  bookings: number;
  spent: number;
  state: "ACTIVE" | "DEACTIVATED";
  areas: string[];
};

const customers: CustomerRow[] = [
  { id: "cu-1", name: "Ayesha K.", phone: "0300 1234567", joined: "2026-02-11", bookings: 12, spent: 6840000, state: "ACTIVE", areas: ["gulberg-iii"] },
  { id: "cu-2", name: "Omar D.", phone: "0321 7654321", joined: "2026-04-03", bookings: 7, spent: 3910000, state: "ACTIVE", areas: ["askari-10"] },
  { id: "cu-3", name: "Mariam T.", phone: "0333 5551234", joined: "2026-06-21", bookings: 4, spent: 1980000, state: "ACTIVE", areas: ["ferozepur-road"] },
  { id: "cu-4", name: "Rabia F.", phone: "0345 9988776", joined: "2026-01-08", bookings: 1, spent: 950000, state: "DEACTIVATED", areas: ["johar-town"] },
  { id: "cu-5", name: "Hamza S.", phone: "0301 2244668", joined: "2025-11-19", bookings: 21, spent: 11240000, state: "ACTIVE", areas: ["dha-phase-5", "model-town"] },
  { id: "cu-6", name: "Sana R.", phone: "0334 7711299", joined: "2026-07-02", bookings: 2, spent: 1120000, state: "ACTIVE", areas: ["bahria-town"] },
  { id: "cu-7", name: "Bilal A.", phone: "0322 4488011", joined: "2025-08-30", bookings: 34, spent: 18760000, state: "ACTIVE", areas: ["lahore-cantonment", "gulistan-e-jauhar"] },
  { id: "cu-8", name: "Nida M.", phone: "0300 9911223", joined: "2026-05-14", bookings: 5, spent: 2470000, state: "ACTIVE", areas: ["wapdas-town"] },
  { id: "cu-9", name: "Fahad N.", phone: "0345 6655443", joined: "2026-01-27", bookings: 9, spent: 5230000, state: "ACTIVE", areas: ["lake-view"] },
  { id: "cu-10", name: "Zoya H.", phone: "0311 3344556", joined: "2026-08-09", bookings: 1, spent: 480000, state: "DEACTIVATED", areas: ["garden-town"] },
  { id: "cu-11", name: "Kashif J.", phone: "0323 5566778", joined: "2025-12-05", bookings: 17, spent: 9310000, state: "ACTIVE", areas: ["gulberg-iii", "johar-town"] },
  { id: "cu-12", name: "Iqra B.", phone: "0336 2233445", joined: "2026-03-30", bookings: 6, spent: 3120000, state: "ACTIVE", areas: ["ferozepur-road", "model-town"] },
  { id: "cu-13", name: "Adnan T.", phone: "0308 7788990", joined: "2026-06-11", bookings: 3, spent: 1490000, state: "ACTIVE", areas: ["dha-phase-5"] },
  { id: "cu-14", name: "Rukhsana P.", phone: "0341 1122334", joined: "2025-10-22", bookings: 26, spent: 14050000, state: "ACTIVE", areas: ["askari-10", "bahria-town"] },
  { id: "cu-15", name: "Usman G.", phone: "0325 4433221", joined: "2026-09-01", bookings: 1, spent: 620000, state: "ACTIVE", areas: ["gulistan-e-jauhar"] },
  { id: "cu-16", name: "Areeba L.", phone: "0330 9090909", joined: "2025-09-16", bookings: 19, spent: 10240000, state: "DEACTIVATED", areas: ["lahore-cantonment"] },
  { id: "cu-17", name: "Talha W.", phone: "0302 6767676", joined: "2026-04-25", bookings: 8, spent: 4650000, state: "ACTIVE", areas: ["lake-view", "garden-town"] },
  { id: "cu-18", name: "Mahnoor Q.", phone: "0346 1212121", joined: "2026-02-28", bookings: 4, spent: 2210000, state: "ACTIVE", areas: ["wapdas-town", "johar-town"] },
  { id: "cu-19", name: "Danish E.", phone: "0313 4545454", joined: "2025-07-08", bookings: 29, spent: 15830000, state: "ACTIVE", areas: ["model-town"] },
  { id: "cu-20", name: "Sobia Z.", phone: "0322 2323232", joined: "2026-05-03", bookings: 2, spent: 940000, state: "ACTIVE", areas: ["gulberg-iii"] },
];

export function AdminCustomers({ locale, dict }: { locale: Locale; dict: Dictionary }) {
  const activeCustomers = customers.filter((row) => row.state === "ACTIVE");

  return (
    <div>
      <PageHeader
        eyebrow={dict.portal.admin}
        title={dict.admin.customers}
        description={dict.admin.customersText}
        action={
          <button
            type="button"
            className="inline-flex min-h-11 items-center gap-2 rounded-[9px] border border-line bg-white px-4 text-sm font-semibold text-navy transition hover:bg-slate-50"
          >
            <UserRound className="size-4" aria-hidden="true" />
            {dict.admin.addCustomer}
          </button>
        }
      />

      <div className="mt-6 grid gap-4 sm:grid-cols-2 xl:grid-cols-4">
        <StatCard icon={UsersRound} label={dict.admin.totalCustomers} value={formatNumber(customers.length, locale)} />
        <StatCard icon={BadgeCheck} label={dict.admin.activeCustomers} value={formatNumber(activeCustomers.length, locale)} />
        <StatCard
          icon={Wallet}
          label={dict.admin.lifetimeValue}
          value={formatMoney(customers.reduce((sum, row) => sum + row.spent, 0), locale)}
        />
        <StatCard
          icon={ShieldAlert}
          label={dict.admin.deactivated}
          value={formatNumber(customers.length - activeCustomers.length, locale)}
        />
      </div>

      <Card className="mt-6 overflow-hidden">
        <div className="flex flex-wrap items-center justify-between gap-3 border-b border-line p-5">
          <h2 className="font-semibold text-navy">{dict.admin.customerRegister}</h2>
          <p className="text-xs text-muted">{dict.admin.noHardDelete}</p>
        </div>

        <div className="overflow-x-auto">
          <table className="w-full min-w-[820px] text-sm">
            <thead className="bg-slate-50 text-xs text-muted">
              <tr>
                <th className="p-4 text-start">{dict.admin.name}</th>
                <th className="p-4 text-start">{dict.admin.phone}</th>
                <th className="p-4 text-start">{dict.common.area}</th>
                <th className="p-4 text-end">{dict.portal.totalBookings}</th>
                <th className="p-4 text-end">{dict.common.amount}</th>
                <th className="p-4 text-start">{dict.common.status}</th>
              </tr>
            </thead>
            <tbody className="divide-y divide-line">
              {customers.map((row) => {
                const area = areas.find((item) => item.slug === row.areas[0]);
                const off = row.state === "DEACTIVATED";
                return (
                  <tr key={row.id} className={off ? "bg-slate-50/60" : "hover:bg-slate-50"}>
                    <td className="p-4">
                      <p className="font-medium text-navy">{row.name}</p>
                      <p className="mt-1 text-xs text-muted">
                        {dict.admin.joined} {formatDate(row.joined, locale)}
                      </p>
                    </td>
                    <td className="p-4 font-mono text-xs text-secondary">
                      {off ? row.phone.replace(/\d/g, "x") : row.phone}
                    </td>
                    <td className="p-4 text-secondary">{area?.name[locale]}</td>
                    <td className="p-4 text-end text-secondary tabular-nums">
                      {formatNumber(row.bookings, locale)}
                    </td>
                    <td className="p-4 text-end font-semibold text-navy tabular-nums">
                      {formatMoney(row.spent, locale)}
                    </td>
                    <td className="p-4">
                      <span
                        className={`rounded-full px-2.5 py-1 text-[11px] font-semibold ${
                          off ? "bg-slate-100 text-muted" : "bg-emerald-50 text-emerald-700"
                        }`}
                      >
                        {off ? dict.admin.deactivated : dict.portal.active}
                      </span>
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
