"use client";

import { AlertCircle, Eye, EyeOff, Loader2 } from "lucide-react";
import { useId, useState } from "react";
import { Input, Label, buttonStyles } from "@/components/ui";
import { cn } from "@/lib/utils";

/* Every input on the authentication pages is one of these two. They take the
   props React Hook Form's `register` returns plus the message for the field, so
   the text under the control and the control's aria-describedby are always the
   same string, and a server-side field error is displayed on the same control
   the client validates. */

type FieldShellProps = {
  label: string;
  hint?: string;
  error?: string;
  className?: string;
  startIcon?: React.ReactNode;
} & Omit<React.ComponentProps<typeof Input>, "className">;

const errorStyles = "border-rose-400 focus:border-rose-500 focus-visible:border-rose-500";

function FieldFooter({ error, hint, hintId, errorId }: { error?: string; hint?: string; hintId?: string; errorId?: string }) {
  if (error !== undefined) {
    return (
      <p id={errorId} role="alert" className="flex items-center gap-1.5 text-xs font-medium text-rose-600 animate-in fade-in duration-200">
        <AlertCircle className="size-3.5 shrink-0" aria-hidden="true" />
        <span>{error}</span>
      </p>
    );
  }
  if (hint === undefined) return null;
  return (
    <p id={hintId} className="text-[11px] leading-4 text-muted">
      {hint}
    </p>
  );
}

export function Field({ label, hint, error, className, id, startIcon, ...props }: FieldShellProps) {
  const generated = useId();
  const fieldId = id ?? generated;
  const hintId = hint === undefined ? undefined : `${fieldId}-hint`;
  const errorId = error === undefined ? undefined : `${fieldId}-error`;

  return (
    <div className={cn("grid gap-1", className)}>
      <Label htmlFor={fieldId} className="text-[11.5px] font-semibold text-slate-800">
        {label}
      </Label>
      <div className="relative">
        {startIcon ? (
          <span className="pointer-events-none absolute inset-y-0 start-0 grid w-9 place-items-center text-slate-400 transition-colors" aria-hidden="true">
            {startIcon}
          </span>
        ) : null}
        <Input
          id={fieldId}
          aria-invalid={error === undefined ? undefined : true}
          aria-describedby={[errorId, hintId].filter(Boolean).join(" ") || undefined}
          className={cn(
            "min-h-[38px] rounded-[8px] text-[13.5px] border border-slate-200 bg-white transition-colors outline-none focus:outline-none focus-visible:outline-none focus:ring-0 focus-visible:ring-0 focus:border-primary",
            startIcon && "ps-9",
            error !== undefined && errorStyles,
          )}
          {...props}
        />
      </div>
      <FieldFooter error={error} hint={hint} hintId={hintId} errorId={errorId} />
    </div>
  );
}

export function PasswordField({
  label,
  hint,
  error,
  className,
  id,
  showLabel,
  hideLabel,
  startIcon,
  ...props
}: FieldShellProps & { showLabel: string; hideLabel: string }) {
  const [visible, setVisible] = useState(false);
  const generated = useId();
  const fieldId = id ?? generated;
  const hintId = hint === undefined ? undefined : `${fieldId}-hint`;
  const errorId = error === undefined ? undefined : `${fieldId}-error`;

  return (
    <div className={cn("grid gap-1", className)}>
      <Label htmlFor={fieldId} className="text-[11.5px] font-semibold text-slate-800">
        {label}
      </Label>
      <div className="relative">
        {startIcon ? (
          <span className="pointer-events-none absolute inset-y-0 start-0 grid w-9 place-items-center text-slate-400 transition-colors" aria-hidden="true">
            {startIcon}
          </span>
        ) : null}
        <Input
          id={fieldId}
          type={visible ? "text" : "password"}
          aria-invalid={error === undefined ? undefined : true}
          aria-describedby={[errorId, hintId].filter(Boolean).join(" ") || undefined}
          className={cn(
            "min-h-[38px] rounded-[8px] text-[13.5px] border border-slate-200 bg-white transition-colors pe-10 outline-none focus:outline-none focus-visible:outline-none focus:ring-0 focus-visible:ring-0 focus:border-primary",
            startIcon && "ps-9",
            error !== undefined && errorStyles,
          )}
          {...props}
        />
        <button
          type="button"
          onMouseDown={(e) => e.preventDefault()}
          onClick={() => setVisible((current) => !current)}
          aria-label={visible ? hideLabel : showLabel}
          aria-pressed={visible}
          className="absolute inset-y-0 end-0 grid w-10 place-items-center rounded-[8px] text-slate-400 transition-colors hover:text-slate-700 outline-none focus:outline-none"
        >
          {visible ? <EyeOff className="size-4" aria-hidden="true" /> : <Eye className="size-4" aria-hidden="true" />}
        </button>
      </div>
      <FieldFooter error={error} hint={hint} hintId={hintId} errorId={errorId} />
    </div>
  );
}

/** The single submit control, so a pending request always disables it. */
export function SubmitButton({
  pending,
  pendingLabel,
  children,
  className,
}: {
  pending: boolean;
  pendingLabel: string;
  children: React.ReactNode;
  className?: string;
}) {
  return (
    <button
      type="submit"
      disabled={pending}
      className={buttonStyles({
        className: cn(
          /* `transition-all` was here, and it is the reason this card felt like it
             was shaking. It animates *every* animatable property, so the 1px hover
             lift in the shared button contract, the spinner swap and the disabled
             fade were all being interpolated together — and anything else that
             happened to change got a transition it never asked for. The same
             explicit list the shared button styles use, and nothing else. */
          "w-full min-h-[40px] rounded-[9px] font-semibold text-[13.5px] shadow-xs transition-[background-color,border-color,color,box-shadow,transform] duration-150 ease-out motion-reduce:transition-none active:translate-y-0 disabled:opacity-60 outline-none focus:outline-none focus-visible:outline-none focus:ring-0 focus-visible:ring-0",
          className,
        ),
      })}
    >
      {pending ? (
        <span className="inline-flex items-center justify-center gap-2">
          <Loader2 className="size-4 animate-spin" aria-hidden="true" />
          <span>{pendingLabel}</span>
        </span>
      ) : (
        <span className="inline-flex items-center justify-center gap-2">
          {children}
        </span>
      )}
    </button>
  );
}