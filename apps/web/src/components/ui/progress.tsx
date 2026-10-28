"use client";

import { Progress as ProgressPrimitive } from "radix-ui";
import { cn } from "@/lib/utils";

export function Progress({ className, value, ...props }: React.ComponentProps<typeof ProgressPrimitive.Root>) {
  return (
    <ProgressPrimitive.Root
      className={cn("relative h-1.5 w-full overflow-hidden rounded-full bg-slate-200", className)}
      value={value}
      {...props}
    >
      <ProgressPrimitive.Indicator
        className="h-full w-full flex-1 bg-primary transition-transform duration-300 ease-out"
        style={{ transform: `translateX(-${100 - (value ?? 0)}%)` }}
      />
    </ProgressPrimitive.Root>
  );
}
