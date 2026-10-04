import { cn } from "@/lib/utils";

/* Hunar mark: a house elevation with a verified tick and one yellow
   construction detail. Drawn rather than iconographic so it stays crisp
   at favicon size and matches the blueprint language. */
export function BrandMark({ className, tone = "navy" }: { className?: string; tone?: "navy" | "light" }) {
  const dark = tone === "navy";
  return (
    <span
      className={cn(
        "grid size-9 shrink-0 place-items-center rounded-[10px]",
        dark ? "bg-navy text-white" : "bg-white text-navy",
        className,
      )}
      aria-hidden="true"
    >
      <svg viewBox="0 0 32 32" className="size-5" fill="none" stroke="currentColor" strokeWidth="1.6" strokeLinecap="round" strokeLinejoin="round">
        <path d="M5 14.5 16 6l11 8.5" />
        <path d="M8 13.5V26h16V13.5" />
        <path d="M13 26v-6.5a3 3 0 0 1 6 0V26" />
        <path d="M4.5 15.5h2M25.5 15.5h2" strokeDasharray="1.5 2" />
        <path d="m21.5 4.5 1.2 2.4 2.4 1.2-2.4 1.2-1.2 2.4-1.2-2.4-2.4-1.2 2.4-1.2z" className="fill-yellow-500 text-yellow-500" strokeWidth="1.2" />
      </svg>
    </span>
  );
}
