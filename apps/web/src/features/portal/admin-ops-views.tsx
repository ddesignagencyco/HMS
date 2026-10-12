"use client";

import { BadgeCheck, MessageSquare, PhoneCall, Smartphone, TriangleAlert } from "lucide-react";
import type { Dictionary } from "@/lib/dictionaries";
import { formatNumber, type Locale } from "@/lib/utils";
import { Card, PageHeader, StatCard } from "@/components/ui";

/* ------------------------------------------------------------------ *
 * Agent attempts — FR-VC-06, three failures across two bands then the
 * Tier B link is sent exactly once.
 * ------------------------------------------------------------------ */

const attempts = [
  { id: "at-1", booking: "bk-1030", band: "08-12", at: "2026-09-25T09:12:00+05:00", outcome: "noAnswer", attempt: 1 },
  { id: "at-2", booking: "bk-1030", band: "08-12", at: "2026-09-25T10:40:00+05:00", outcome: "noAnswer", attempt: 2 },
  { id: "at-3", booking: "bk-1030", band: "12-17", at: "2026-09-25T13:05:00+05:00", outcome: "noAnswer", attempt: 3 },
  { id: "at-4", booking: "bk-1030", band: "12-17", at: "2026-09-25T13:06:00+05:00", outcome: "linkSent", attempt: 4 },
  { id: "at-5", booking: "bk-1034", band: "17-22", at: "2026-09-24T18:22:00+05:00", outcome: "connected", attempt: 1 },
  { id: "at-6", booking: "bk-1036", band: "08-12", at: "2026-09-24T09:41:00+05:00", outcome: "connected", attempt: 1 },
] as const;

export function AgentAttempts({ locale, dict }: { locale: Locale; dict: Dictionary }) {
  const linkSent = attempts.filter((a) => a.outcome === "linkSent").length;

  return (
    <div>
      <PageHeader eyebrow={dict.portal.agent} title={dict.agent.attempts} description={dict.agent.attemptsText} />

      <div className="mt-6 grid gap-4 sm:grid-cols-2 xl:grid-cols-4">
        <StatCard icon={PhoneCall} label={dict.agent.attemptsLogged} value={String(attempts.length)} />
        <StatCard icon={TriangleAlert} label={dict.agent.noAnswers} value={String(attempts.filter((a) => a.outcome === "noAnswer").length)} />
        <StatCard icon={BadgeCheck} label={dict.agent.connected} value={String(attempts.filter((a) => a.outcome === "connected").length)} />
        <StatCard icon={MessageSquare} label={dict.agent.linksSent} value={String(linkSent)} />
      </div>

      <div className="mt-6 flex items-start gap-3 rounded-[12px] border border-blue-200 bg-blue-50 px-4 py-3">
        <Smartphone className="mt-0.5 size-4 shrink-0 text-primary-strong" aria-hidden="true" />
        <p className="text-sm leading-6 text-navy">{dict.agent.fallbackNote}</p>
      </div>

      <Card className="mt-6 overflow-hidden">
        <div className="border-b border-line p-5"><h2 className="font-semibold text-navy">{dict.agent.attemptLog}</h2></div>
        <div className="overflow-x-auto">
          <table className="w-full min-w-[760px] text-sm">
            <thead className="bg-slate-50 text-xs text-muted">
              <tr>
                <th className="p-4 text-start">{dict.finance.booking}</th>
                <th className="p-4 text-start">{dict.common.date}</th>
                <th className="p-4 text-start">{dict.agent.band}</th>
                <th className="p-4 text-end">{dict.agent.attemptNo}</th>
                <th className="p-4 text-start">{dict.agent.outcome}</th>
              </tr>
            </thead>
            <tbody className="divide-y divide-line">
              {attempts.map((row) => {
                const tone = row.outcome === "connected" ? "bg-emerald-50 text-emerald-700" : row.outcome === "linkSent" ? "bg-blue-50 text-primary-strong" : "bg-slate-100 text-secondary";
                return (
                  <tr key={row.id} className="hover:bg-slate-50">
                    <td className="p-4 font-mono text-xs font-semibold text-navy">{row.booking}</td>
                    <td className="p-4 font-mono text-xs text-secondary">{row.at.replace("T", " ").replace("+05:00", "")}</td>
                    <td className="p-4 text-secondary tabular-nums">{row.band}</td>
                    <td className="p-4 text-end text-secondary tabular-nums">{formatNumber(row.attempt, locale)}</td>
                    <td className="p-4"><span className={`rounded-full px-2.5 py-1 text-[11px] font-semibold ${tone}`}>{dict.agent.outcomes[row.outcome]}</span></td>
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
