import { cn } from "@/lib/utils";

export function Badge({ className, children }: { className?: string; children: React.ReactNode }) {
  return <span className={cn("inline-flex items-center gap-1.5 rounded-full bg-slate-100 px-2.5 py-1 text-xs font-semibold text-secondary", className)}>{children}</span>;
}

export function StatusBadge({ status, label }: { status: string; label: string }) {
  const tone =
    status === "VERIFIED" || status === "COMPLETED" || status === "RELEASED"
      ? "bg-emerald-50 text-emerald-700"
      : status === "DISPUTED" || status === "CANCELLED"
        ? "bg-rose-50 text-rose-700"
        : status === "AWAITING_VERIFICATION"
          ? "bg-amber-50 text-amber-800"
          : "bg-blue-50 text-blue-700";
  return <span className={cn("inline-flex items-center gap-1.5 rounded-full px-2.5 py-1 text-xs font-semibold", tone)}><span className="size-1.5 rounded-full bg-current" />{label}</span>;
}
