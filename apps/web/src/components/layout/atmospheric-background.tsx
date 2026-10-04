import { cn } from "@/lib/utils";

export type AtmosphereVariant = "hero" | "trust" | "process" | "managed" | "faq";

/* Dark sections carry light, nothing else: one soft radial field each.
   No illustrations, no grids, no boxes, no repeated textures. */

const base = "pointer-events-none absolute inset-0 overflow-hidden";

const fields: Record<AtmosphereVariant, React.CSSProperties> = {
  hero: {
    background:
      "radial-gradient(58% 62% at 74% 22%, rgba(37,99,235,0.17), transparent 62%), radial-gradient(46% 52% at 8% 96%, rgba(30,64,175,0.10), transparent 66%)",
  },
  trust: {
    background:
      "radial-gradient(48% 58% at 78% 46%, rgba(37,99,235,0.16), transparent 64%), radial-gradient(40% 46% at 6% 92%, rgba(30,64,175,0.08), transparent 68%)",
  },
  process: {
    background:
      "radial-gradient(52% 60% at 22% 34%, rgba(37,99,235,0.13), transparent 66%), radial-gradient(38% 44% at 92% 88%, rgba(30,64,175,0.08), transparent 70%)",
  },
  managed: {
    background:
      "radial-gradient(44% 52% at 72% 52%, rgba(37,99,235,0.14), transparent 66%), radial-gradient(34% 40% at 4% 8%, rgba(30,64,175,0.07), transparent 70%)",
  },
  faq: {
    background: "radial-gradient(52% 60% at 50% 6%, rgba(37,99,235,0.09), transparent 70%)",
  },
};

export function AtmosphericBackground({ variant, className }: { variant: AtmosphereVariant; className?: string }) {
  return (
    <div aria-hidden="true" className={cn(base, className)}>
      <div className="absolute inset-0" style={fields[variant]} />
    </div>
  );
}
