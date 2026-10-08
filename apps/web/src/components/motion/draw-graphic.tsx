"use client";

import { useEffect, useRef, useState } from "react";
import { cn } from "@/lib/utils";

/* Signature interaction: technical drawings draw themselves once when
   they enter the viewport. Stroke drawing only — no fill, no glow. */
export function DrawGraphic({
  children,
  className,
  duration = 1200,
  threshold = 0.25,
}: {
  children: React.ReactNode;
  className?: string;
  duration?: number;
  threshold?: number;
}) {
  const ref = useRef<HTMLDivElement | null>(null);
  const [drawn, setDrawn] = useState(false);

  useEffect(() => {
    const node = ref.current;
    if (!node) return;

    if (window.matchMedia("(prefers-reduced-motion: reduce)").matches) {
      const frame = requestAnimationFrame(() => setDrawn(true));
      return () => cancelAnimationFrame(frame);
    }

    const observer = new IntersectionObserver(
      ([entry]) => {
        if (entry.isIntersecting) {
          setDrawn(true);
          observer.disconnect();
        }
      },
      { threshold },
    );
    observer.observe(node);
    return () => observer.disconnect();
  }, [threshold]);

  return (
    <div
      ref={ref}
      data-draw={drawn ? "drawn" : "pending"}
      className={cn("draw-group", className)}
      style={{ "--draw-duration": `${duration}ms` } as React.CSSProperties}
    >
      {children}
    </div>
  );
}
