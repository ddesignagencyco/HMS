"use client";

import { useEffect, useRef, useState } from "react";
import { formatNumber, type Locale } from "@/lib/utils";

/* Metric numbers rise from zero once, when the block enters view. */
export function CountUp({
  value,
  locale,
  decimals = 0,
  duration = 1200,
  className,
}: {
  value: number;
  locale: Locale;
  decimals?: number;
  duration?: number;
  className?: string;
}) {
  const ref = useRef<HTMLSpanElement | null>(null);
  const [display, setDisplay] = useState(0);

  useEffect(() => {
    const node = ref.current;
    if (!node) return;

    if (window.matchMedia("(prefers-reduced-motion: reduce)").matches) {
      const frame = requestAnimationFrame(() => setDisplay(value));
      return () => cancelAnimationFrame(frame);
    }

    let frame = 0;
    let start = 0;
    const observer = new IntersectionObserver(
      ([entry]) => {
        if (!entry.isIntersecting) return;
        observer.disconnect();
        const tick = (now: number) => {
          if (!start) start = now;
          const progress = Math.min(1, (now - start) / duration);
          const eased = 1 - Math.pow(1 - progress, 3);
          setDisplay(value * eased);
          if (progress < 1) frame = requestAnimationFrame(tick);
        };
        frame = requestAnimationFrame(tick);
      },
      { threshold: 0.4 },
    );
    observer.observe(node);

    return () => {
      observer.disconnect();
      if (frame) cancelAnimationFrame(frame);
    };
  }, [value, duration]);

  const text = decimals > 0 ? display.toFixed(decimals) : formatNumber(Math.round(display), locale);

  return (
    <span ref={ref} className={className}>
      {text}
    </span>
  );
}
