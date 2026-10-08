"use client";

import { motion, useMotionTemplate, useMotionValue, useReducedMotion, useSpring, useTransform } from "motion/react";
import { useRef } from "react";
import { cn } from "@/lib/utils";

/* Mouse-follow depth. The card tilts in real 3D; anything marked with
   data-tilt-depth inside it is pushed forward on the Z axis, so the tilt
   produces genuine parallax between the media, the copy and the surface.
   Springs do the work, so every card settles instead of snapping. */
export function TiltCard({
  children,
  className,
  surfaceClassName,
  intensity = 9,
}: {
  children: React.ReactNode;
  className?: string;
  surfaceClassName?: string;
  intensity?: number;
}) {
  const surface = useRef<HTMLDivElement | null>(null);
  const reduce = useReducedMotion();

  const x = useMotionValue(0.5);
  const y = useMotionValue(0.5);
  const engaged = useMotionValue(0);

  const spring = { stiffness: 230, damping: 24, mass: 0.5 } as const;

  const rotateX = useSpring(useTransform(y, [0, 1], [intensity, -intensity]), spring);
  const rotateY = useSpring(useTransform(x, [0, 1], [-intensity, intensity]), spring);
  const hover = useSpring(engaged, { stiffness: 190, damping: 22, mass: 0.5 });

  const glareX = useTransform(x, [0, 1], ["4%", "96%"]);
  const glareY = useTransform(y, [0, 1], ["4%", "96%"]);
  const glare = useMotionTemplate`radial-gradient(56% 56% at ${glareX} ${glareY}, rgba(255,255,255,0.85), transparent 70%)`;
  const glareOpacity = useTransform(hover, [0, 1], [0, 0.55]);

  const shadowX = useTransform(x, [0, 1], [18, -18]);
  const shadowY = useTransform(y, [0, 1], [30, -8]);
  const shadowBlur = useTransform(hover, [0, 1], [20, 52]);
  const shadowSpread = useTransform(hover, [0, 1], [-8, 0]);
  const shadowAlpha = useTransform(hover, [0, 1], [0.08, 0.3]);
  const shadow = useMotionTemplate`${shadowX}px ${shadowY}px ${shadowBlur}px ${shadowSpread}px rgba(11,27,63,${shadowAlpha})`;

  if (reduce) {
    return <div className={className}>{children}</div>;
  }

  return (
    <div className={cn("[perspective:1100px] lift", className)}>
      <motion.div
        ref={surface}
        data-tilt=""
        onPointerEnter={(event) => {
          if (event.pointerType === "mouse") engaged.set(1);
        }}
        onPointerMove={(event) => {
          if (event.pointerType !== "mouse") return;
          const box = surface.current?.getBoundingClientRect();
          if (!box) return;
          x.set(Math.min(1, Math.max(0, (event.clientX - box.left) / box.width)));
          y.set(Math.min(1, Math.max(0, (event.clientY - box.top) / box.height)));
        }}
        onPointerLeave={() => {
          x.set(0.5);
          y.set(0.5);
          engaged.set(0);
        }}
        style={{ rotateX, rotateY, boxShadow: shadow, transformStyle: "preserve-3d" }}
        className={cn("relative h-full overflow-hidden rounded-[14px] ring-1 ring-navy/[0.06]", surfaceClassName)}
      >
        {children}
        <motion.span
          aria-hidden="true"
          style={{ backgroundImage: glare, opacity: glareOpacity }}
          className="pointer-events-none absolute inset-0 z-30 rounded-[14px] mix-blend-soft-light"
        />
      </motion.div>
    </div>
  );
}
