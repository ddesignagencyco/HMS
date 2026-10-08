import { DrawGraphic } from "@/components/motion/draw-graphic";

/* Three authored boundary shapes and a straight edge. They are deliberately
   different from one another so a long page never reads as one repeated
   curve: the mass sits left, then mirrors right, then flattens out. Straight
   edges are just as much a choice as curved ones — they are used where a
   quiet, honest cut is better than a gesture. */

export type WaveShape = "left" | "right" | "shallow";

const paths: Record<WaveShape, { edge: string; accent: string }> = {
  /* The neighbouring surface sits deep on the left and lifts to the right. */
  left: {
    edge: "M0 0 H1440 V4 C1180 10 880 34 590 62 C330 86 130 92 0 90 Z",
    accent: "M0 90 C130 92 330 86 590 62",
  },
  /* The mirror: mass on the right, lifting toward the left. */
  right: {
    edge: "M0 0 H1440 V90 C1310 92 1110 86 850 62 C560 34 260 10 0 4 Z",
    accent: "M1440 90 C1310 92 1110 86 850 62",
  },
  /* Barely a curve — a long, shallow swell that only hints at a boundary. */
  shallow: {
    edge: "M0 0 H1440 V18 C1120 30 780 38 460 32 C250 28 100 22 0 18 Z",
    accent: "M180 26 C520 36 900 34 1240 24",
  },
};

export function WaveBoundary({
  fill,
  shape = "shallow",
  accent = true,
  className,
}: {
  /** Colour of the neighbouring surface, matched exactly. */
  fill: string;
  shape?: WaveShape;
  accent?: boolean;
  className?: string;
}) {
  const { edge, accent: accentPath } = paths[shape];

  return (
    <div
      aria-hidden="true"
      className={`wave-boundary pointer-events-none absolute inset-x-0 top-0 z-[1] select-none overflow-hidden ${className ?? ""}`}
    >
      <svg viewBox="0 0 1440 100" preserveAspectRatio="none" className="block h-full w-full" fill={fill}>
        <path d={edge} />
      </svg>

      {accent ? (
        <DrawGraphic duration={1100} threshold={0.1}>
          <svg
            viewBox="0 0 1440 100"
            preserveAspectRatio="none"
            className="absolute inset-0 block h-full w-full"
            fill="none"
            stroke="var(--color-blue-500)"
            strokeOpacity="0.22"
            strokeWidth="1.25"
            vectorEffect="non-scaling-stroke"
            strokeLinecap="round"
          >
            <path d={accentPath} />
          </svg>
        </DrawGraphic>
      ) : null}
    </div>
  );
}
