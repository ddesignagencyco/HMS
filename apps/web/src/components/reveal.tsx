"use client";

import { motion, useReducedMotion } from "motion/react";

/* ------------------------------------------------------------------ *
 * Scroll reveal — one motion language for the whole product, driven by
 * springs so nothing lands hard.
 * section: y 18 · 620ms      card: y 14 · 520ms
 * copy:    y 10 · 480ms      media: scale 1.04 · 820ms
 * ------------------------------------------------------------------ */

type RevealVariant = "section" | "card" | "copy" | "media" | "from-start" | "from-end";

type Preset = { x?: number; y?: number; scale?: number; duration: number };

const presets: Record<RevealVariant, Preset> = {
  section: { y: 18, duration: 0.62 },
  card: { y: 14, duration: 0.52 },
  copy: { y: 10, duration: 0.48 },
  media: { scale: 1.04, duration: 0.82 },
  "from-start": { x: -26, duration: 0.64 },
  "from-end": { x: 26, duration: 0.64 },
};

const surfaces = {
  div: motion.div,
  section: motion.section,
  li: motion.li,
  span: motion.span,
} as const;

export function Reveal({
  children,
  className,
  delay = 0,
  as = "div",
  variant = "section",
}: {
  children: React.ReactNode;
  className?: string;
  delay?: number;
  as?: keyof typeof surfaces;
  variant?: RevealVariant;
}) {
  const reduce = useReducedMotion();
  const preset = presets[variant];
  const Surface = surfaces[as];

  return (
    <Surface
      initial={reduce ? false : { opacity: 0, x: preset.x ?? 0, y: preset.y ?? 0, scale: preset.scale ?? 1 }}
      whileInView={reduce ? undefined : { opacity: 1, x: 0, y: 0, scale: 1 }}
      viewport={{ once: true, amount: 0.15, margin: "0px 0px -6% 0px" }}
      transition={{ duration: preset.duration, delay: delay / 1000, ease: [0.22, 1, 0.36, 1] }}
      className={className}
    >
      {children}
    </Surface>
  );
}
