"use client";

import { Circle } from "lucide-react";
import { RadioGroup as RadioGroupPrimitive } from "radix-ui";
import { cn } from "@/lib/utils";

export function RadioGroup({ className, ...props }: React.ComponentProps<typeof RadioGroupPrimitive.Root>) {
  return <RadioGroupPrimitive.Root className={cn("grid gap-2", className)} {...props} />;
}

/**
 * The ring is `border-muted` (#64748b), not `border-line`.
 *
 * `--color-line` is #e2e8f0 — slate-200 — which against white is **1.28:1**.
 * WCAG 2.1 AA asks 3:1 for the boundary of an interactive control (1.4.11
 * Non-text Contrast); a radio at 1.28:1 does not read as a control at all. On
 * the booking payment step this made both options look like plain paragraphs
 * with no radio beside them, which is exactly what it was reported as.
 *
 * `border-muted` is slate-500 at **4.76:1** on white, comfortably past 3:1, and
 * it is an existing token — no new colour is introduced.
 *
 * The size went 16px → 20px for the same reason: a 1px ring at 16px on a white
 * card is hard to acquire visually even at correct contrast, and this control
 * sits inside a list the customer is being asked to choose between.
 *
 * The dot is `fill-primary` at 60% of the ring rather than a small icon, so the
 * checked state is unmistakable at a glance.
 */
export function RadioGroupItem({ className, ...props }: React.ComponentProps<typeof RadioGroupPrimitive.Item>) {
  return (
    <RadioGroupPrimitive.Item
      className={cn(
        "aspect-square size-5 shrink-0 rounded-full border-2 border-muted bg-white text-primary transition",
        "focus-visible:outline-none focus-visible:ring-4 focus-visible:ring-blue-100",
        "hover:border-muted/80",
        "disabled:cursor-not-allowed disabled:opacity-50",
        "data-[state=checked]:border-primary",
        className,
      )}
      {...props}
    >
      <RadioGroupPrimitive.Indicator className="flex size-full items-center justify-center">
        <span className="block size-2.5 rounded-full bg-primary" />
      </RadioGroupPrimitive.Indicator>
    </RadioGroupPrimitive.Item>
  );
}