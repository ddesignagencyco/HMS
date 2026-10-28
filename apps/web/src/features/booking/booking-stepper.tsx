"use client";

import { Check } from "lucide-react";
import { Progress } from "@/components/ui";
import { cn } from "@/lib/utils";

export function BookingStepper({
  steps,
  currentStep,
  onStepClick,
  labels,
}: {
  steps: number;
  currentStep: number;
  onStepClick?: (step: number) => void;
  labels: string[];
}) {
  const progress = steps > 1 ? (currentStep / (steps - 1)) * 100 : 0;

  return (
    <div className="rounded-[14px] border border-line bg-white p-4 sm:p-6 shadow-xs">
      {/* Mobile Stepper View: Clean segmented progress bar + step title (Never clips/wraps) */}
      <div className="sm:hidden">
        <div className="flex items-center justify-between">
          <span className="text-[11px] font-bold uppercase tracking-wider text-primary-strong">
            Step {currentStep + 1} of {steps}
          </span>
          <span className="text-xs font-semibold text-muted">
            {Math.round(((currentStep + 1) / steps) * 100)}% Complete
          </span>
        </div>
        <p className="mt-1 text-base font-bold text-navy">
          {labels[currentStep]}
        </p>

        {/* Segmented Progress Pills for Mobile */}
        <div className="mt-3 grid grid-cols-6 gap-1.5">
          {labels.map((_, i) => (
            <button
              key={i}
              type="button"
              disabled={i > currentStep || !onStepClick}
              onClick={() => onStepClick?.(i)}
              className={cn(
                "h-2 rounded-full transition-all duration-200",
                i < currentStep && "bg-primary hover:bg-primary-strong",
                i === currentStep && "bg-yellow-500 ring-2 ring-yellow-200",
                i > currentStep && "bg-slate-200 opacity-60",
              )}
              aria-label={`Step ${i + 1}: ${labels[i]}`}
            />
          ))}
        </div>
      </div>

      {/* Desktop Stepper View (sm and up): Full 6-step numbered circle rail */}
      <div className="hidden sm:block">
        <div className="mb-5 flex items-center justify-between gap-4">
          <p className="text-xs font-bold uppercase tracking-[0.16em] text-primary-strong">Booking Progress</p>
          <p className="text-sm font-semibold text-navy">
            Step {currentStep + 1} of {steps} · {labels[currentStep]}
          </p>
        </div>

        <div className="relative">
          <Progress value={progress} className="absolute inset-x-0 top-[19px] h-1" aria-label="Booking progress" />
          <ol className="relative grid grid-cols-6">
            {labels.map((label, index) => {
              const done = index < currentStep;
              const active = index === currentStep;
              const clickable = Boolean(onStepClick) && index <= currentStep;
              const content = (
                <>
                  <span
                    className={cn(
                      "grid size-10 place-items-center rounded-full border-2 text-sm font-semibold transition",
                      done && "border-primary bg-primary text-primary-foreground",
                      active && "border-primary bg-white text-primary ring-4 ring-blue-100",
                      !done && !active && "border-line bg-white text-muted",
                    )}
                  >
                    {done ? <Check className="size-4" aria-hidden="true" /> : index + 1}
                  </span>
                  <span
                    className={cn(
                      "mt-2 block text-center text-xs font-medium leading-tight",
                      done && "text-primary-strong",
                      active && "text-navy font-semibold",
                      !done && !active && "text-muted",
                    )}
                  >
                    {label}
                  </span>
                </>
              );

              return (
                <li key={label} className="flex flex-col items-center">
                  {clickable ? (
                    <button
                      type="button"
                      onClick={() => onStepClick?.(index)}
                      className="flex w-full flex-col items-center rounded-[8px] px-1 py-1 text-center focus-visible:outline-none focus-visible:ring-4 focus-visible:ring-blue-100"
                      aria-current={active ? "step" : undefined}
                    >
                      {content}
                    </button>
                  ) : (
                    <div className="flex w-full flex-col items-center px-1 py-1 text-center" aria-current={active ? "step" : undefined}>
                      {content}
                    </div>
                  )}
                </li>
              );
            })}
          </ol>
        </div>
      </div>
    </div>
  );
}
