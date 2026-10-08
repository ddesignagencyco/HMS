"use client";

import { Check, ChevronDown, RotateCcw, Search, SlidersHorizontal, X } from "lucide-react";
import { useEffect, useId, useState } from "react";
import type { Dictionary } from "@/lib/dictionaries";
import { Checkbox } from "@/components/ui/checkbox";
import { SelectField } from "@/components/select-field";
import { buttonStyles } from "@/components/ui/button";
import { cn, formatNumber, type Locale } from "@/lib/utils";

/* ------------------------------------------------------------------ *
 * Filters
 *
 * One filter language for every list in the product: a grouped panel
 * on wide screens, the same groups in a side drawer below the
 * `lg` breakpoint, and one apply/reset pair shared by both.
 *
 * Two rules the components enforce, so no screen has to remember them:
 *
 * 1. Nothing scrolls. A filter group is never given a max-height or an
 *    overflow container. A long filter list grows the panel and the
 *    document scrolls instead, so a control is never trapped in a box
 *    the visitor has to hunt inside. The drawer is the same: the
 *    overlay is the scroll surface, the panel is `min-h` content.
 *
 * 2. Groups collapse. Every group is a disclosure so a long list starts
 *    folded, and the open/closed state is the visitor's, not a default
 *    they fight on every page load.
 * ------------------------------------------------------------------ */

export type FilterLabels = {
  filters: string;
  title: string;
  close: string;
  open: string;
  apply: string;
  reset: string;
  activeCount: string;
  showResults: string;
  search: string;
  min: string;
  max: string;
};

/* Every page builds the same label set from `dict.common`, so the copy a
   visitor reads on a filter panel is identical everywhere. */
export function filterLabels(common: Dictionary["common"]): FilterLabels {
  return {
    filters: common.filters,
    title: common.filterTitle,
    close: common.closeFilters,
    open: common.openFilters,
    apply: common.applyFilters,
    reset: common.resetFilters,
    activeCount: common.activeFilters,
    showResults: common.resultsCount,
    search: common.search,
    min: common.min,
    max: common.max,
  };
}

/* ---- Panel ---------------------------------------------------------- */

/* The desktop rail. Deliberately not sticky and deliberately not capped:
   a sticky rail is only safe behind a scroller, and a scroller inside a
   filter list is exactly the trap this component exists to avoid. So the
   rail is an ordinary block that grows with its groups, and the document
   is the only scroll surface on the page. */
export function FilterPanel({
  labels,
  activeCount,
  children,
  footer,
  className,
}: {
  labels: FilterLabels;
  activeCount: number;
  children: React.ReactNode;
  /** Informative rail content shown under the controls. */
  footer?: React.ReactNode;
  className?: string;
}) {
  return (
    <aside className={cn("rounded-[14px] border border-line bg-white p-5", className)}>
      <div className="flex items-center justify-between gap-3 border-b border-line pb-4">
        <p className="flex items-center gap-2 text-sm font-semibold text-navy">
          <SlidersHorizontal className="size-4 text-primary" aria-hidden="true" />
          {labels.filters}
        </p>
        {activeCount > 0 ? (
          <span className="rounded-full bg-blue-50 px-2 py-0.5 text-[11px] font-semibold text-primary-strong tabular-nums">
            {labels.activeCount.replace("{count}", String(activeCount))}
          </span>
        ) : null}
      </div>

      <FilterGroups>{children}</FilterGroups>

      {footer ? <div className="mt-6 border-t border-line pt-5">{footer}</div> : null}
    </aside>
  );
}

/* Groups stack with a hairline between them and no gap collapse, so a
   collapsed list reads as one rail rather than a stack of cards. */
function FilterGroups({ children }: { children: React.ReactNode }) {
  return <div className="[&>*+*]:mt-4 [&>*+*]:border-t [&>*+*]:border-line [&>*+*]:pt-4">{children}</div>;
}

/* ---- Drawer --------------------------------------------------------- */

export function FilterDrawer({
  open,
  labels,
  activeCount,
  onClose,
  onApply,
  onReset,
  children,
  className,
}: {
  open: boolean;
  labels: FilterLabels;
  activeCount: number;
  onClose: () => void;
  onApply: () => void;
  onReset: () => void;
  children: React.ReactNode;
  className?: string;
}) {
  /* Escape closes, and the document behind must not scroll while the
     panel is up. Same contract as the workspace rail. */
  useEffect(() => {
    if (!open) return;
    const onKey = (event: KeyboardEvent) => {
      if (event.key === "Escape") onClose();
    };
    document.addEventListener("keydown", onKey);
    const previous = document.body.style.overflow;
    document.body.style.overflow = "hidden";
    return () => {
      document.removeEventListener("keydown", onKey);
      document.body.style.overflow = previous;
    };
  }, [open, onClose]);

  if (!open) return null;

  return (
    <div className="fixed inset-0 z-50 lg:hidden">
      <button
        type="button"
        aria-label={labels.close}
        onClick={onClose}
        className="absolute inset-0 bg-navy/60 backdrop-blur-xs"
      />
      {/* The overlay is the scroll surface and the panel is sized by its
          content, so the groups are never boxed into a scroller. */}
      <div className="absolute inset-0 overflow-y-auto overscroll-contain">
        <div
          role="dialog"
          aria-modal="true"
          aria-label={labels.title}
          className={cn(
            "ms-auto flex min-h-full w-full max-w-sm flex-col bg-white shadow-lifted",
            className,
          )}
        >
          <div className="sticky top-0 z-10 flex items-center justify-between gap-3 border-b border-line bg-white px-5 py-4">
            <p className="flex items-center gap-2 text-base font-semibold text-navy">
              <SlidersHorizontal className="size-4 text-primary" aria-hidden="true" />
              {labels.title}
              {activeCount > 0 ? (
                <span className="rounded-full bg-blue-50 px-2 py-0.5 text-[11px] font-semibold text-primary-strong tabular-nums">
                  {labels.activeCount.replace("{count}", String(activeCount))}
                </span>
              ) : null}
            </p>
            <button
              type="button"
              onClick={onClose}
              aria-label={labels.close}
              className="grid size-9 shrink-0 place-items-center rounded-lg border border-line text-secondary transition hover:bg-slate-100"
            >
              <X className="size-5" aria-hidden="true" />
            </button>
          </div>

          <div className="p-5">
            <FilterGroups>{children}</FilterGroups>
          </div>

          <div className="sticky bottom-0 mt-auto border-t border-line bg-white p-5">
            <FilterActions labels={labels} onApply={onApply} onReset={onReset} />
          </div>
        </div>
      </div>
    </div>
  );
}

/* ---- Trigger -------------------------------------------------------- */

export function FilterTrigger({
  labels,
  activeCount,
  onOpen,
  trailing,
  className,
}: {
  labels: FilterLabels;
  activeCount: number;
  onOpen: () => void;
  trailing?: React.ReactNode;
  className?: string;
}) {
  return (
    <div className={cn("mb-6 flex flex-wrap items-center justify-between gap-3 lg:hidden", className)}>
      <button
        type="button"
        onClick={onOpen}
        aria-expanded={false}
        className="inline-flex min-h-11 items-center gap-2.5 rounded-[10px] border border-navy/15 bg-white px-4 py-2 text-sm font-semibold text-navy shadow-sm transition-all hover:border-primary/40 hover:bg-slate-50"
      >
        <SlidersHorizontal className="size-4 text-primary" aria-hidden="true" />
        {labels.filters}
        {activeCount > 0 ? (
          <span className="flex size-5 items-center justify-center rounded-full bg-primary text-[11px] font-bold text-white tabular-nums">
            {activeCount}
          </span>
        ) : null}
      </button>
      {trailing ? <span className="text-xs font-medium text-secondary">{trailing}</span> : null}
    </div>
  );
}

/* ---- Group ---------------------------------------------------------- */

export function FilterGroup({
  title,
  children,
  defaultOpen = true,
  trailing,
}: {
  title: string;
  children: React.ReactNode;
  defaultOpen?: boolean;
  trailing?: React.ReactNode;
}) {
  const [open, setOpen] = useState(defaultOpen);
  const panelId = useId();

  return (
    <div>
      <button
        type="button"
        onClick={() => setOpen((value) => !value)}
        aria-expanded={open}
        aria-controls={panelId}
        className="flex w-full items-center justify-between gap-3 text-start"
      >
        <span className="text-sm font-semibold text-navy">{title}</span>
        <span className="flex items-center gap-2">
          {trailing}
          <ChevronDown
            className={cn(
              "size-4 shrink-0 text-muted transition-transform duration-200",
              open && "rotate-180",
            )}
            aria-hidden="true"
          />
        </span>
      </button>
      {open ? (
        <div id={panelId} className="mt-3 grid gap-3">
          {children}
        </div>
      ) : null}
    </div>
  );
}

/* ---- Controls ------------------------------------------------------- */

export function FilterSearch({
  id,
  label,
  value,
  placeholder,
  onChange,
  onSubmit,
}: {
  id: string;
  label: string;
  value: string;
  placeholder?: string;
  onChange: (value: string) => void;
  onSubmit?: () => void;
}) {
  return (
    <div className="grid gap-2">
      <label htmlFor={id} className="text-xs font-semibold text-secondary">
        {label}
      </label>
      <span className="flex min-h-11 items-center gap-2 rounded-[9px] border border-line px-3 transition-colors focus-within:border-primary/40">
        <Search className="size-4 shrink-0 text-slate-400" aria-hidden="true" />
        <input
          id={id}
          type="search"
          value={value}
          onChange={(event) => onChange(event.target.value)}
          onKeyDown={(event) => {
            if (event.key === "Enter") onSubmit?.();
          }}
          placeholder={placeholder ?? label}
          className="focus-none w-full bg-transparent text-sm font-normal text-navy outline-none"
        />
      </span>
    </div>
  );
}

export function FilterSelect({
  id,
  label,
  value,
  options,
  placeholder,
  onChange,
}: {
  id: string;
  label: string;
  value: string;
  options: { value: string; label: string }[];
  placeholder: string;
  onChange: (value: string) => void;
}) {
  return (
    <div className="grid gap-2">
      <label htmlFor={id} className="text-xs font-semibold text-secondary">
        {label}
      </label>
      <SelectField
        id={id}
        value={value}
        onChange={onChange}
        options={options}
        placeholder={placeholder}
      />
    </div>
  );
}

export type FilterOption = { value: string; label: string; count?: number };

/* A checkbox row with an optional live count, so a group can show what
   picking it would actually leave on the table. */
export function FilterCheckboxGroup({
  options,
  selected,
  onToggle,
  name,
  locale,
}: {
  options: FilterOption[];
  selected: string[];
  onToggle: (value: string) => void;
  /** Prefix for generated ids; required so the drawer and the rail
      never share a label target. */
  name: string;
  locale: Locale;
}) {
  if (options.length === 0) return null;
  return (
    <div className="grid gap-2.5">
      {options.map((option) => {
        const id = `${name}-${option.value}`;
        const checked = selected.includes(option.value);
        return (
          <label
            key={option.value}
            htmlFor={id}
            className="flex cursor-pointer items-center gap-3 text-sm text-secondary"
          >
            <Checkbox
              id={id}
              checked={checked}
              onCheckedChange={() => onToggle(option.value)}
            />
            <span className="min-w-0 flex-1">{option.label}</span>
            {option.count !== undefined ? (
              <span className="shrink-0 text-xs text-muted tabular-nums">
                ({formatNumber(option.count, locale)})
              </span>
            ) : null}
          </label>
        );
      })}
    </div>
  );
}

/* Two number fields rather than a slider: a typed bound is exact, and a
   slider that has to be dragged to an approximate value is worse than
   either. Money is integer paisa everywhere else in the product, so the
   fields speak rupees and the caller converts. */
export function FilterRange({
  idPrefix,
  labels,
  min,
  max,
  step = 1,
  value,
  onChange,
}: {
  idPrefix: string;
  labels: { min: string; max: string };
  min: number;
  max: number;
  step?: number;
  value: [number, number];
  onChange: (value: [number, number]) => void;
}) {
  const lowId = `${idPrefix}-min`;
  const highId = `${idPrefix}-max`;

  const clamp = (raw: string, fallback: number) => {
    const parsed = Number(raw);
    if (!Number.isFinite(parsed)) return fallback;
    return Math.min(Math.max(parsed, min), max);
  };

  return (
    <div className="grid gap-2">
      <div className="grid grid-cols-2 gap-2">
        <div className="grid gap-1.5">
          <label htmlFor={lowId} className="text-[11px] font-semibold uppercase tracking-[0.1em] text-muted">
            {labels.min}
          </label>
          <input
            id={lowId}
            type="number"
            inputMode="numeric"
            min={min}
            max={max}
            step={step}
            value={value[0]}
            onChange={(event) => onChange([clamp(event.target.value, value[0]), Math.max(value[1], clamp(event.target.value, value[0]))])}
            className="focus-none min-h-11 w-full rounded-[9px] border border-line px-3 text-sm text-navy tabular-nums"
          />
        </div>
        <div className="grid gap-1.5">
          <label htmlFor={highId} className="text-[11px] font-semibold uppercase tracking-[0.1em] text-muted">
            {labels.max}
          </label>
          <input
            id={highId}
            type="number"
            inputMode="numeric"
            min={min}
            max={max}
            step={step}
            value={value[1]}
            onChange={(event) => onChange([Math.min(value[0], clamp(event.target.value, value[1])), clamp(event.target.value, value[1])])}
            className="focus-none min-h-11 w-full rounded-[9px] border border-line px-3 text-sm text-navy tabular-nums"
          />
        </div>
      </div>
    </div>
  );
}

export function FilterActions({
  labels,
  onApply,
  onReset,
  className,
}: {
  labels: FilterLabels;
  onApply: () => void;
  onReset: () => void;
  className?: string;
}) {
  return (
    <div className={cn("grid grid-cols-[1fr_auto] gap-2 border-t border-line pt-4", className)}>
      <button type="button" onClick={onApply} className={buttonStyles({ className: "w-full" })}>
        <Check className="size-4" aria-hidden="true" />
        {labels.apply}
      </button>
      <button
        type="button"
        onClick={onReset}
        aria-label={labels.reset}
        className={buttonStyles({ variant: "secondary", className: "px-3" })}
      >
        <RotateCcw className="size-4" aria-hidden="true" />
      </button>
    </div>
  );
}

/* ---- Summary -------------------------------------------------------- */

/* Applied filters as removable chips. Draft state is not shown here:
   a chip that is not yet filtering anything is a lie about the table. */
export function ActiveFilterChips({
  chips,
  removeLabel,
  clearLabel,
  onRemove,
  onClear,
  className,
}: {
  chips: { key: string; label: string }[];
  /** Takes `{label}`, so the accessible name reads the filter out. */
  removeLabel: string;
  clearLabel: string;
  onRemove: (key: string) => void;
  onClear: () => void;
  className?: string;
}) {
  if (chips.length === 0) return null;
  return (
    <div className={cn("flex flex-wrap items-center gap-2", className)}>
      {chips.map((chip) => (
        <button
          key={chip.key}
          type="button"
          onClick={() => onRemove(chip.key)}
          className="inline-flex min-h-9 items-center gap-1.5 rounded-full border border-line bg-white px-3 text-xs font-semibold text-navy transition hover:border-primary/40 hover:bg-slate-50"
        >
          {chip.label}
          <X className="size-3.5 text-muted" aria-hidden="true" />
          <span className="sr-only">{removeLabel.replace("{label}", chip.label)}</span>
        </button>
      ))}
      <button
        type="button"
        onClick={onClear}
        className="inline-flex min-h-9 items-center gap-1.5 px-2 text-xs font-semibold text-primary-strong transition hover:underline"
      >
        <RotateCcw className="size-3.5" aria-hidden="true" />
        {clearLabel}
      </button>
    </div>
  );
}
