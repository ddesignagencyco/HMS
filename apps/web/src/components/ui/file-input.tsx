"use client";

/* A styled file picker.
 *
 * `<input type="file">` renders as the browser's own control, and that control
 * is not styleable: `className="text-sm"` only changes the font of the
 * "Choose File" text, leaving a grey native button that matches nothing else on
 * the page. The four upload sites were each rendering that raw control.
 *
 * This wraps it in the app's own button styling. The input itself is kept in
 * the DOM and kept focusable — not `display:none` — so keyboard and screen
 * reader users still reach it. The visible surface is a `<label>` styled as a
 * button, and focus is drawn on the input so the ring lands on the label via
 * `peer-focus-visible:`.
 *
 * Two things a raw input gets wrong that are handled here:
 *
 * **The chosen filename is announced.** A native control shows "C:\Users\..." in
 * a system font and reads as nothing at all to a screen reader. `fileName`
 * states it in the app's own type, in both locales.
 *
 * **Re-picking the same file fires again.** The native control does not emit a
 * change event when the selection is unchanged, so a professional who attaches
 * the wrong photo, removes it and re-picks it would see nothing happen. The
 * value is cleared after every pick. */

import { Upload } from "lucide-react";
import { useId, useState } from "react";
import { buttonStyles } from "@/components/ui/button";
import { cn } from "@/lib/utils";

export function FileInput({
  id,
  label,
  accept,
  multiple = false,
  disabled = false,
  chooseLabel,
  selectedLabel,
  onPick,
  className,
}: {
  id?: string;
  /** Rendered above the control. Omit when the button text says enough. */
  label?: React.ReactNode;
  accept?: string;
  multiple?: boolean;
  disabled?: boolean;
  /** The button's text when nothing is chosen, e.g. "Choose file". */
  chooseLabel: string;
  /** Prefixed onto the chosen filename, e.g. "Selected:" / "3 files chosen". */
  selectedLabel?: string;
  onPick: (files: File[]) => void;
  className?: string;
}) {
  const generatedId = useId();
  const inputId = id ?? generatedId;
  const [names, setNames] = useState<string[]>([]);

  return (
    <div className={cn("grid gap-2", className)}>
      {label !== undefined ? (
        <label htmlFor={inputId} className="text-sm font-medium leading-none text-navy">
          {label}
        </label>
      ) : null}

      <div className="flex flex-wrap items-center gap-3">
        <input
          id={inputId}
          type="file"
          accept={accept}
          multiple={multiple}
          disabled={disabled}
          className="peer sr-only"
          onChange={(event) => {
            const chosen = Array.from(event.target.files ?? []);
            /* Cleared on every pick, so choosing the same file twice in a row
               still fires a change event. */
            event.target.value = "";
            if (chosen.length === 0) {
              setNames([]);
              return;
            }
            setNames(chosen.map((file) => file.name));
            onPick(chosen);
          }}
        />
        <label
          htmlFor={inputId}
          className={cn(
            buttonStyles({ variant: "secondary", size: "sm" }),
            "cursor-pointer",
            /* The real control is `sr-only`, so it carries no pointer events of
               its own; these two states come off the input via `peer-`. */
            "peer-disabled:pointer-events-none peer-disabled:opacity-55",
            "peer-focus-visible:outline-none peer-focus-visible:ring-4 peer-focus-visible:ring-blue-100",
          )}
        >
          <Upload className="size-3.5" aria-hidden="true" />
          {chooseLabel}
        </label>

        {names.length > 0 ? (
          <span className="min-w-0 text-xs text-secondary">
            {selectedLabel !== undefined ? `${selectedLabel} ` : ""}
            <span className="break-all">{names.length === 1 ? names[0] : `${names.length} files`}</span>
          </span>
        ) : null}
      </div>
    </div>
  );
}