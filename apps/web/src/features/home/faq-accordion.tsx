"use client";

import { ChevronDown } from "lucide-react";
import { useState } from "react";
import { cn } from "@/lib/utils";

export function FaqAccordion({ items, tone = "light" }: { items: { question: string; answer: string }[]; tone?: "light" | "dark" }) {
  const [open, setOpen] = useState(0);
  const dark = tone === "dark";

  return (
    <div>
      {items.map((item, index) => {
        const expanded = open === index;
        return (
          <div key={item.question} className={cn(index < items.length - 1 && "border-b", dark ? "border-white/12" : "border-line")}>
            <h3>
              <button
                type="button"
                onClick={() => setOpen(expanded ? -1 : index)}
                className={cn(
                  "group flex min-h-[60px] w-full items-center justify-between gap-6 py-4 text-start text-[15px] font-semibold leading-6 transition-colors duration-200 focus-visible:outline-none sm:min-h-[64px]",
                  dark
                    ? "text-white hover:text-yellow-500 focus-visible:text-yellow-500"
                    : "text-navy hover:text-primary-strong focus-visible:text-primary-strong",
                )}
                aria-expanded={expanded}
              >
                <span className="min-w-0">{item.question}</span>
                <ChevronDown
                  className={cn(
                    "size-4 shrink-0 transition-transform duration-300 ease-out",
                    dark
                      ? cn("text-slate-500 group-hover:text-yellow-500", expanded && "rotate-180 text-yellow-500")
                      : cn("text-slate-400 group-hover:text-primary", expanded && "rotate-180 text-primary"),
                  )}
                  aria-hidden="true"
                />
              </button>
            </h3>
            <div
              className={cn(
                "grid transition-[grid-template-rows,opacity] duration-300 ease-out motion-reduce:transition-none",
                expanded ? "grid-rows-[1fr] opacity-100" : "grid-rows-[0fr] opacity-0",
              )}
            >
              <div className="overflow-hidden">
                <p className={cn("max-w-2xl pb-5 pe-10 text-sm leading-6", dark ? "text-slate-300" : "text-secondary")}>
                  {item.answer}
                </p>
              </div>
            </div>
          </div>
        );
      })}
    </div>
  );
}
