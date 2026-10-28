import { WaveBoundary, type WaveShape } from "@/components/layout/wave-boundary";
import { cn } from "@/lib/utils";

export type SectionSize = "compact" | "default" | "feature";
export type SectionTone = "light" | "surface" | "dark";

type Wave = {
  /** Colour of the neighbouring surface, matched exactly. */
  fill: string;
  /** Which of the three authored curves to use. */
  shape?: WaveShape;
  depth?: { sm?: number; md?: number; lg?: number };
};

const toneClass: Record<SectionTone, string> = {
  light: "bg-white text-navy",
  surface: "bg-surface text-navy",
  dark: "bg-navy-950 text-white",
};

const sizeClass: Record<SectionSize, string> = {
  compact: "section-compact",
  default: "section-default",
  feature: "section-feature",
};

const waveVars = (wave?: Wave) =>
  wave
    ? ({
        "--wave-sm": `${wave.depth?.sm ?? 24}px`,
        "--wave-md": `${wave.depth?.md ?? 44}px`,
        "--wave-lg": `${wave.depth?.lg ?? 72}px`,
      } as React.CSSProperties)
    : undefined;

export function Section({
  children,
  size = "default",
  tone = "light",
  className,
  id,
  waveTop,
}: {
  children: React.ReactNode;
  size?: SectionSize;
  tone?: SectionTone;
  className?: string;
  id?: string;
  /** Top edge only. The bottom of a section is always a straight edge. */
  waveTop?: Wave;
}) {
  return (
    <section
      id={id}
      style={waveVars(waveTop)}
      className={cn(
        "relative overflow-hidden",
        toneClass[tone],
        sizeClass[size],
        waveTop && "section-wave-top",
        className,
      )}
    >
      {waveTop ? <WaveBoundary fill={waveTop.fill} shape={waveTop.shape} /> : null}
      {children}
    </section>
  );
}

export function Eyebrow({ children, tone = "light", className }: { children: React.ReactNode; tone?: "light" | "dark"; className?: string }) {
  return <p className={cn("eyebrow", tone === "dark" ? "eyebrow-dark" : "eyebrow-light", className)}>{children}</p>;
}

/* Four layouts, one rhythm: eyebrow -> heading -> description -> content.
   `full` is the one that lifts the 40rem measure cap, so a long description
   can run the whole container instead of being squeezed into a narrow rail. */
const headerLayout = {
  left: "header-stack",
  split: "header-stack-split",
  center: "header-stack mx-auto max-w-3xl items-center text-center",
  full: "header-stack",
} as const;

const descriptionTone = {
  light: "text-secondary",
  surface: "text-secondary",
  dark: "text-slate-300",
} as const;

const titleTone = {
  light: "text-navy",
  surface: "text-navy",
  dark: "text-white",
} as const;

export function SectionHeader({
  eyebrow,
  title,
  titleAccent,
  description,
  action,
  variant = "split",
  tone = "light",
  accentTone = "light",
  className,
}: {
  eyebrow?: string;
  title: string;
  titleAccent?: string;
  accentTone?: "light" | "dark";
  description?: string;
  action?: React.ReactNode;
  variant?: keyof typeof headerLayout;
  tone?: SectionTone;
  className?: string;
}) {
  return (
    <div className={cn(headerLayout[variant], className)}>
      <div className={cn("header-copy", variant === "center" && "max-w-2xl", variant === "full" && "max-w-none")}>
        {eyebrow ? (
          <p className={cn("eyebrow", tone === "dark" ? "eyebrow-dark" : "eyebrow-light")}>{eyebrow}</p>
        ) : null}
        <h2 className={cn("title-section", titleTone[tone])}>
          {title}
          {titleAccent ? (
            <span className={accentTone === "dark" ? "text-yellow-500" : "text-primary-strong"}> {titleAccent}</span>
          ) : null}
        </h2>
        {description ? <p className={cn("text-pretty text-base leading-7", descriptionTone[tone])}>{description}</p> : null}
      </div>
      {action ? <div className={cn("shrink-0", variant === "center" && "mt-2")}>{action}</div> : null}
    </div>
  );
}
