"use client";

import Image from "next/image";
import { useEffect, useRef, useState } from "react";
import type { ImageAsset } from "@/lib/types";
import { RouteCircuit } from "@/components/decorative";
import { DrawGraphic } from "@/components/motion/draw-graphic";
import { cn, formatNumber, getText, type Locale } from "@/lib/utils";

/* One journey. The photograph is deliberately smaller than the steps it sits
   beside, so the process reads as content rather than as a picture.

   The timeline is a single rail owned by the list itself, drawn from one
   parent-level element that spans the whole column and fills as the section
   is read. Nodes sit on that rail at one exact offset, and every step carries
   the same vertical rhythm, so nothing drifts between steps. */
export function ProcessJourney({
  steps,
  image,
  locale,
}: {
  steps: { title: string; text: string }[];
  image: ImageAsset;
  locale: Locale;
}) {
  const listRef = useRef<HTMLOListElement | null>(null);
  const [active, setActive] = useState(0);

  useEffect(() => {
    const list = listRef.current;
    if (!list) return;
    const items = Array.from(list.querySelectorAll<HTMLElement>(":scope > li"));
    const reduce = window.matchMedia("(prefers-reduced-motion: reduce)").matches;

    const observer = new IntersectionObserver(
      (entries) => {
        for (const entry of entries) {
          if (!entry.isIntersecting) continue;
          const index = items.indexOf(entry.target as HTMLElement);
          if (index >= 0) setActive(index);
        }
      },
      { rootMargin: "-45% 0px -45% 0px" },
    );
    items.forEach((item) => observer.observe(item));

    /* Rail progress: one continuous fill for the whole column. */
    const rail = list.querySelector<HTMLElement>("[data-rail-fill]");
    const onScroll = () => {
      if (!rail) return;
      const box = list.getBoundingClientRect();
      const line = window.innerHeight * 0.55;
      const span = box.height || 1;
      const progress = Math.max(0, Math.min(1, (line - box.top) / span));
      rail.style.transform = `scaleY(${reduce ? Math.max(0.28, progress) : progress})`;
    };
    onScroll();
    window.addEventListener("scroll", onScroll, { passive: true });
    window.addEventListener("resize", onScroll);

    return () => {
      observer.disconnect();
      window.removeEventListener("scroll", onScroll);
      window.removeEventListener("resize", onScroll);
    };
  }, []);

  return (
    <div className="grid gap-10 lg:grid-cols-[minmax(0,0.82fr)_minmax(0,1.18fr)] lg:items-stretch lg:gap-16">
      <figure className="relative m-0 h-full overflow-hidden rounded-[16px] bg-navy-900 ring-1 ring-white/10 lg:max-h-[440px]">
        <div className="relative aspect-[16/11] w-full lg:h-full lg:aspect-auto">
          <Image
            src={image.url}
            alt={getText(image.alt, locale)}
            fill
            sizes="(max-width: 1023px) 100vw, 34vw"
            className="object-cover object-[50%_35%]"
          />
          <div className="pointer-events-none absolute inset-0 bg-gradient-to-t from-navy-950/80 via-navy-950/10 to-transparent" />

          <DrawGraphic duration={1400} threshold={0.2}>
            <div className="pointer-events-none absolute bottom-4 end-4 text-blue-300/45">
              <RouteCircuit className="h-auto w-[124px]" />
            </div>
          </DrawGraphic>

          <div className="absolute bottom-4 start-4 inline-flex items-center gap-2 rounded-xl bg-navy-950/85 px-3 py-1.5 text-[11.5px] font-medium text-white shadow-lg backdrop-blur-sm ring-1 ring-white/15">
            <span className="size-2 rounded-full bg-emerald-400 animate-pulse" aria-hidden="true" />
            <span>{locale === "ur" ? "تصدیق شدہ آن سائٹ کاریگر" : "Verified On-Site Service"}</span>
          </div>
        </div>
      </figure>

      <ol ref={listRef} className="relative flex flex-col justify-center">
        {/* the one rail, owned by the list, spanning every step */}
        <span aria-hidden="true" className="absolute start-[17px] top-4 bottom-4 w-px bg-white/12" />
        <span
          aria-hidden="true"
          data-rail-fill
          className="absolute start-[17px] top-4 bottom-4 w-px origin-top bg-gradient-to-b from-yellow-500 to-yellow-500/40 motion-reduce:transition-none"
        />

        {steps.map((step, index) => (
          <li key={step.title} className="relative flex items-start gap-4 py-5 first:pt-0 last:pb-0 sm:gap-5 sm:py-6">
            <span
              data-active={index <= active}
              className={cn(
                "relative z-10 grid size-9 shrink-0 place-items-center rounded-full border bg-navy-950 text-xs font-semibold tabular-nums transition-colors duration-500 ease-[cubic-bezier(0.22,1,0.36,1)] motion-reduce:transition-none",
                index === active
                  ? "border-yellow-500 text-yellow-500"
                  : index < active
                    ? "border-yellow-500/45 text-yellow-500"
                    : "border-white/18 text-slate-500",
              )}
            >
              {formatNumber(index + 1, locale).padStart(2, "0")}
            </span>
            <div className="min-w-0 pt-1.5">
              <h3
                className={cn(
                  "text-[19px] font-semibold leading-6 tracking-[-0.025em] transition-colors duration-500 motion-reduce:transition-none",
                  index <= active ? "text-white" : "text-slate-400",
                )}
              >
                {step.title}
              </h3>
              <p className="mt-2 max-w-xl text-pretty text-sm leading-6 text-slate-400">{step.text}</p>
            </div>
          </li>
        ))}
      </ol>
    </div>
  );
}
