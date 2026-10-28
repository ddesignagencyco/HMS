import { cn } from "@/lib/utils";

export function Badge({ className, children }: { className?: string; children: React.ReactNode }) {
  return <span className={cn("inline-flex items-center gap-1.5 rounded-full bg-slate-100 px-2.5 py-1 text-xs font-semibold text-secondary", className)}>{children}</span>;
}

export function StatusBadge({ status, label }: { status: string; label: string }) {
  const tone =
    status === "VERIFIED" || status === "COMPLETED" || status === "RELEASED" || status === "APPROVED" || status === "ACTIVE" || status === "PAID"
      ? "bg-emerald-50/90 text-emerald-800 ring-1 ring-inset ring-emerald-600/20"
      : status === "DISPUTED" || status === "CANCELLED" || status === "BLOCKED" || status === "SUSPENDED" || status === "FAILED" || status === "REJECTED"
        ? "bg-rose-50/90 text-rose-800 ring-1 ring-inset ring-rose-600/20"
        : status === "AWAITING_VERIFICATION" || status === "PENDING" || status === "REQUESTED" || status === "HOLD" || status === "WARNING"
          ? "bg-amber-50/90 text-amber-900 ring-1 ring-inset ring-amber-600/20"
          : "bg-blue-50/90 text-blue-800 ring-1 ring-inset ring-blue-600/20";
  return (
    <span className={cn("inline-flex items-center gap-1.5 rounded-full px-2.5 py-0.5 text-xs font-semibold tracking-tight shadow-2xs", tone)}>
      <span className="size-1.5 rounded-full bg-current opacity-75" />
      {label}
    </span>
  );
}
