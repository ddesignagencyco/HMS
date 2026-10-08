"use client";

import { AlertTriangle, BadgeCheck, ClipboardCheck, Loader2, ArrowRight, PhoneCall, TriangleAlert, Smartphone, MessageSquare } from "lucide-react";
import { useRouter } from "next/navigation";
import { useQuery, useMutation, useQueryClient } from "@tanstack/react-query";
import type { Dictionary } from "@/lib/dictionaries";
import { formatDateTime, formatNumber, localizedPath, type Locale } from "@/lib/utils";
import { agentApi, type AgentQueueEntry } from "@/features/portal/api";
import {
  Card,
  PageHeader,
  StatCard,
  StatusBadge,
} from "@/components/ui";

export function AgentQueue({ locale, dict }: { locale: Locale; dict: Dictionary }) {
  const router = useRouter();
  const queryClient = useQueryClient();

  const { data, isLoading, isError, error, refetch } = useQuery({
    queryKey: ["agent", "queue"],
    queryFn: () => agentApi.queue({ locale }),
  });

  const claimMutation = useMutation({
    mutationFn: (id: string) => agentApi.claim(id, { locale }),
    onSuccess: (res, id) => {
      queryClient.invalidateQueries({ queryKey: ["agent", "queue"] });
      const targetId = res?.item?.id ?? id;
      router.push(localizedPath(locale, `/agent/verification/${targetId}`));
    },
  });

  const queue: AgentQueueEntry[] = data?.items ?? [];
  const attemptsCount = queue.reduce((sum, item) => sum + (item.attempts ?? 0), 0);
  const breachedCount = queue.filter((item) => item.slaBreached || item.status === "DISPUTED").length;

  return (
    <div>
      <PageHeader eyebrow={dict.portal.agent} title={dict.portal.queueTitle} description={dict.portal.queueDescription} />
      <div className="mt-6 grid gap-4 sm:grid-cols-3">
        <StatCard icon={ClipboardCheck} label={dict.portal.callsToday} value={isLoading ? "..." : String(attemptsCount)} />
        <StatCard icon={AlertTriangle} label={dict.portal.disputes} value={isLoading ? "..." : String(breachedCount)} />
        <StatCard icon={BadgeCheck} label={dict.portal.passed} value={isLoading ? "..." : String(queue.length)} />
      </div>

      <Card className="mt-6 overflow-hidden">
        <div className="flex items-center justify-between border-b border-line p-4">
          <h2 className="text-sm font-semibold text-navy">{dict.portal.queue} ({queue.length})</h2>
          <button
            type="button"
            onClick={() => refetch()}
            className="text-xs font-semibold text-primary-strong hover:underline"
          >
            Refresh Queue
          </button>
        </div>

        {isLoading ? (
          <div className="flex items-center justify-center p-12 text-sm text-muted">
            <Loader2 className="mr-2 size-5 animate-spin text-primary" />
            Loading verification queue...
          </div>
        ) : isError ? (
          <div className="p-8 text-center text-sm">
            <p className="text-rose-600">Failed to load agent queue: {(error as Error)?.message || "Unknown error"}</p>
            <button
              type="button"
              onClick={() => refetch()}
              className="mt-3 rounded-[8px] bg-slate-100 px-3 py-1.5 text-xs font-semibold text-navy hover:bg-slate-200"
            >
              Retry
            </button>
          </div>
        ) : queue.length === 0 ? (
          <div className="p-12 text-center text-sm text-muted">
            <ClipboardCheck className="mx-auto mb-2 size-8 text-slate-300" />
            <p className="font-medium text-navy">Queue is currently clear</p>
            <p className="mt-1 text-xs">No Tier A bookings are waiting for agent phone verification right now.</p>
          </div>
        ) : (
          <div className="overflow-x-auto">
            <table className="w-full min-w-[760px] text-sm">
              <thead className="bg-slate-50 text-xs text-muted">
                <tr>
                  <th className="p-4 text-start">{dict.common.service}</th>
                  <th className="p-4 text-start">Tier / Priority</th>
                  <th className="p-4 text-start">SLA Remaining</th>
                  <th className="p-4 text-start">{dict.common.status}</th>
                  <th className="p-4 text-end">{dict.common.actions}</th>
                </tr>
              </thead>
              <tbody className="divide-y divide-line">
                {queue.map((item) => (
                  <tr key={item.id} className="hover:bg-slate-50">
                    <td className="p-4">
                      <p className="font-medium text-navy">{item.serviceName}</p>
                      <p className="font-mono text-xs text-muted">{item.bookingCode}</p>
                    </td>
                    <td className="p-4 text-xs">
                      <span className="rounded bg-blue-50 px-2 py-0.5 font-semibold text-primary-strong">
                        {item.tier}
                      </span>
                      <span className="ml-2 text-muted">P{item.priority}</span>
                    </td>
                    <td className="p-4 text-xs text-secondary">
                      {item.slaBreached ? (
                        <span className="font-semibold text-rose-600">Breached</span>
                      ) : item.slaRemainingMinutes !== undefined ? (
                        <span>{item.slaRemainingMinutes} min</span>
                      ) : (
                        item.slaDueAt ? formatDateTime(item.slaDueAt, locale) : "-"
                      )}
                    </td>
                    <td className="p-4">
                      <StatusBadge status={item.status} label={item.status} />
                    </td>
                    <td className="p-4 text-end">
                      <div className="flex items-center justify-end gap-2">
                        <button
                          type="button"
                          disabled={claimMutation.isPending}
                          onClick={() => claimMutation.mutate(item.id)}
                          className="inline-flex items-center gap-1 rounded-[7px] bg-primary px-3 py-1.5 text-xs font-semibold text-white shadow-xs transition hover:bg-primary-strong disabled:opacity-50"
                        >
                          {claimMutation.isPending ? "Claiming..." : dict.portal.console}
                          <ArrowRight className="size-3" />
                        </button>
                      </div>
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        )}
      </Card>
    </div>
  );
}

export function AgentAttempts({ locale, dict }: { locale: Locale; dict: Dictionary }) {
  const queue = useQuery({
    queryKey: ["agent", "queue"],
    queryFn: () => agentApi.queue({ locale }),
  });

  const items = queue.data?.items ?? [];
  const itemsWithAttempts = items.filter((row) => row.attempts > 0);
  const totalAttempts = items.reduce((sum, row) => sum + row.attempts, 0);
  const breachedCount = items.filter((row) => row.slaBreached).length;

  return (
    <div>
      <PageHeader eyebrow={dict.portal.agent} title={dict.agent.attempts} description={dict.agent.attemptsText} />

      <div className="mt-6 grid gap-4 sm:grid-cols-2 xl:grid-cols-4">
        <StatCard icon={PhoneCall} label={dict.agent.attemptsLogged} value={String(totalAttempts)} />
        <StatCard icon={TriangleAlert} label="SLA Breached" value={String(breachedCount)} />
        <StatCard icon={BadgeCheck} label="Calls with Attempts" value={String(itemsWithAttempts.length)} />
        <StatCard icon={MessageSquare} label="Total in Queue" value={String(items.length)} />
      </div>

      <div className="mt-6 flex items-start gap-3 rounded-[12px] border border-blue-200 bg-blue-50 px-4 py-3">
        <Smartphone className="mt-0.5 size-4 shrink-0 text-primary-strong" aria-hidden="true" />
        <p className="text-sm leading-6 text-navy">{dict.agent.fallbackNote}</p>
      </div>

      <Card className="mt-6 overflow-hidden">
        <div className="border-b border-line p-5"><h2 className="font-semibold text-navy">{dict.agent.attemptLog}</h2></div>
        {queue.isPending ? (
          <div className="p-8 text-center text-sm text-secondary">Loading verification queue attempts...</div>
        ) : queue.isError ? (
          <div className="p-8 text-center text-sm text-rose-700">Failed to load verification attempts from server.</div>
        ) : items.length === 0 ? (
          <div className="p-8 text-center text-sm text-secondary">No verification calls in queue.</div>
        ) : (
          <div className="overflow-x-auto">
            <table className="w-full min-w-[760px] text-sm">
              <thead className="bg-slate-50 text-xs text-muted">
                <tr>
                  <th className="p-4 text-start">{dict.finance.booking}</th>
                  <th className="p-4 text-start">Service</th>
                  <th className="p-4 text-start">Tier</th>
                  <th className="p-4 text-end">{dict.agent.attemptNo}</th>
                  <th className="p-4 text-start">SLA Due</th>
                  <th className="p-4 text-start">Status</th>
                </tr>
              </thead>
              <tbody className="divide-y divide-line">
                {items.map((row) => {
                  const tone = row.slaBreached ? "bg-rose-50 text-rose-700" : row.attempts > 0 ? "bg-amber-50 text-amber-800" : "bg-emerald-50 text-emerald-700";
                  return (
                    <tr key={row.id} className="hover:bg-slate-50">
                      <td className="p-4 font-mono text-xs font-semibold text-navy">{row.bookingCode}</td>
                      <td className="p-4 text-secondary">{row.serviceName}</td>
                      <td className="p-4 text-secondary tabular-nums">{row.tier}</td>
                      <td className="p-4 text-end text-secondary tabular-nums font-semibold">{formatNumber(row.attempts, locale)}</td>
                      <td className="p-4 font-mono text-xs text-secondary">{row.slaDueAt ? row.slaDueAt.replace("T", " ").slice(0, 19) : "—"}</td>
                      <td className="p-4"><span className={`rounded-full px-2.5 py-1 text-[11px] font-semibold ${tone}`}>{row.slaBreached ? "BREACHED" : row.status}</span></td>
                    </tr>
                  );
                })}
              </tbody>
            </table>
          </div>
        )}
      </Card>
    </div>
  );
}
