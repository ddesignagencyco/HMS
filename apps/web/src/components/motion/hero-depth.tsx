"use client";

import { useEffect, useRef, useState } from "react";
import { cn } from "@/lib/utils";

/* Gentle dimensional depth in the hero: the photograph and the blueprint
   drift a few pixels in opposite directions. Desktop pointers only,
   never a 3D tilt, disabled for touch and reduced motion. */
export function HeroDepth({
  children,
  className,
  depth = 4,
}: {
  children: React.ReactNode;
  className?: string;
  depth?: number;
}) {
  const ref = useRef<HTMLDivElement | null>(null);
  const [offset, setOffset] = useState({ x: 0, y: 0 });

  useEffect(() => {
    const node = ref.current;
    if (!node) return;

    const reduced = window.matchMedia("(prefers-reduced-motion: reduce)");
    const fine = window.matchMedia("(hover: hover) and (pointer: fine)");
    if (reduced.matches || !fine.matches) return;

    let frame = 0;
    const onMove = (event: PointerEvent) => {
      if (frame) return;
      frame = requestAnimationFrame(() => {
        frame = 0;
        const rect = node.getBoundingClientRect();
        const x = (event.clientX - (rect.left + rect.width / 2)) / (rect.width / 2);
        const y = (event.clientY - (rect.top + rect.height / 2)) / (rect.height / 2);
        setOffset({
          x: Math.max(-1, Math.min(1, x)) * depth,
          y: Math.max(-1, Math.min(1, y)) * depth,
        });
      });
    };
    const onLeave = () => setOffset({ x: 0, y: 0 });

    window.addEventListener("pointermove", onMove, { passive: true });
    window.addEventListener("pointerleave", onLeave);
    return () => {
      if (frame) cancelAnimationFrame(frame);
      window.removeEventListener("pointermove", onMove);
      window.removeEventListener("pointerleave", onLeave);
    };
  }, [depth]);

  return (
    <div
      ref={ref}
      className={cn("transition-transform duration-500 ease-[cubic-bezier(0.22,1,0.36,1)] motion-reduce:transform-none motion-reduce:transition-none", className)}
      style={{ transform: `translate3d(${offset.x.toFixed(2)}px, ${offset.y.toFixed(2)}px, 0)` }}
    >
      {children}
    </div>
  );
}
