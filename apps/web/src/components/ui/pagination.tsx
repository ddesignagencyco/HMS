"use client";

import { ChevronLeft, ChevronRight } from "lucide-react";
import { useCallback, useMemo, useState } from "react";
import type { Dictionary } from "@/lib/dictionaries";
import { buttonStyles } from "@/components/ui/button";
import { SelectField } from "@/components/select-field";
import { formatNumber, type Locale } from "@/lib/utils";
import { cn } from "@/lib/utils";

/* ------------------------------------------------------------------ *
 * Pagination
 *
 * One list-paging language for every register, catalogue and explorer
 * in the product. The hook owns the arithmetic (page window, range,
 * clamping) so a page only has to hand over a filtered array; the
 * component owns the chrome, so the same control cannot drift between
 * two screens.
 *
 * The window is deliberately asymmetric: the first page, the last
 * page, and a neighbour either side of the current one, with a single
 * ellipsis between any two runs that are not adjacent. A long register
 * therefore never renders forty buttons, and the current page is never
 * more than one click from either edge.
 * ------------------------------------------------------------------ */

export function pageWindow(current: number, total: number): (number | "gap")[] {
  const pages: (number | "gap")[] = [];
  for (let page = 1; page <= total; page += 1) {
    if (page === 1 || page === total || Math.abs(page - current) <= 1) {
      pages.push(page);
    } else if (pages[pages.length - 1] !== "gap") {
      pages.push("gap");
    }
  }
  return pages;
}

export type UsePaginationOptions = {
  /** Length of the already-filtered array. */
  total: number;
  /** Rows per page before the visitor changes it. */
  perPage?: number;
  /** Values offered in the per-page select. */
  perPageOptions?: number[];
  /** Element scrolled back into view on every page change. */
  anchorRef?: React.RefObject<HTMLElement | null>;
};

export function usePagination({
  total,
  perPage: initialPerPage = 10,
  perPageOptions,
  anchorRef,
}: UsePaginationOptions) {
  const [perPage, setPerPageState] = useState(initialPerPage);
  const [page, setPage] = useState(1);

  const totalPages = Math.max(1, Math.ceil(total / perPage));
  /* Filtering can shrink the list under the visitor's feet, so the page
     number is clamped rather than trusted. */
  const currentPage = Math.min(Math.max(page, 1), totalPages);

  const goToPage = useCallback(
    (next: number) => {
      setPage(Math.min(Math.max(next, 1), totalPages));
      anchorRef?.current?.scrollIntoView({ block: "start", behavior: "smooth" });
    },
    [anchorRef, totalPages],
  );

  const changePerPage = useCallback((value: string) => {
    const next = Number(value);
    if (Number.isFinite(next) && next > 0) {
      setPerPageState(next);
      setPage(1);
    }
  }, []);

  /* Called whenever a filter commits, so a narrower result set never
     lands the visitor on an empty page. */
  const resetPage = useCallback(() => setPage(1), []);

  const start = total === 0 ? 0 : (currentPage - 1) * perPage + 1;
  const end = Math.min(currentPage * perPage, total);

  return {
    page: currentPage,
    perPage,
    totalPages,
    total,
    start,
    end,
    goToPage,
    changePerPage,
    resetPage,
    perPageOptions: perPageOptions ?? [10, 20, 50],
    slice: <T,>(items: T[]) => items.slice((currentPage - 1) * perPage, currentPage * perPage),
  };
}

export type PaginationState = ReturnType<typeof usePagination>;

export type PaginationLabels = {
  /** aria-label for the nav landmark. */
  pagination: string;
  perPage: string;
  showingRange: string;
  previous: string;
  next: string;
  pageOf: string;
  /** Visible label on the previous control. */
  back: string;
  /** Visible label on the next control. */
  forward: string;
};

/* Same contract as the filter labels: one place builds the copy so a
   pager can never be worded differently on two screens. */
export function paginationLabels(common: Dictionary["common"]): PaginationLabels {
  return {
    pagination: common.pagination,
    perPage: common.perPage,
    showingRange: common.showingRange,
    previous: common.previousPage,
    next: common.nextPage,
    pageOf: common.pageOf,
    back: common.back,
    forward: common.next,
  };
}

export function Pagination({
  locale,
  labels,
  page,
  totalPages,
  total,
  start,
  end,
  perPage,
  perPageOptions,
  onPageChange,
  onPerPageChange,
  selectId,
  className,
}: {
  locale: Locale;
  labels: PaginationLabels;
  page: number;
  totalPages: number;
  total: number;
  start: number;
  end: number;
  perPage: number;
  perPageOptions: number[];
  onPageChange: (page: number) => void;
  onPerPageChange: (value: string) => void;
  selectId: string;
  className?: string;
}) {
  const options = useMemo(
    () => perPageOptions.map((size) => ({ value: String(size), label: String(size) })),
    [perPageOptions],
  );

  const pageButtonStyles = (isActive: boolean) =>
    buttonStyles({ variant: isActive ? "primary" : "ghost", className: "min-h-10 min-w-10 px-3" });

  return (
    <nav
      aria-label={labels.pagination}
      className={cn("mt-8 flex flex-wrap items-center justify-between gap-4 border-t border-line pt-6", className)}
    >
      <div className="flex flex-wrap items-center gap-2">
        <label htmlFor={selectId} className="text-xs text-muted">
          {labels.perPage}
        </label>
        <SelectField
          id={selectId}
          value={String(perPage)}
          onChange={onPerPageChange}
          options={options}
          placeholder={String(perPage)}
          /* Fixed and never shrinking: a flexible control in a wrapping row
             collapses until the value is ellipsised, which is the one thing
             a count control must never do. */
          className="w-24 shrink-0"
        />
        <p className="text-xs text-muted">
          {labels.showingRange
            .replace("{from}", formatNumber(start, locale))
            .replace("{to}", formatNumber(end, locale))
            .replace("{count}", formatNumber(total, locale))}
        </p>
      </div>

      <div className="flex flex-wrap items-center gap-1.5">
        <button
          type="button"
          onClick={() => onPageChange(page - 1)}
          disabled={page === 1}
          aria-label={labels.previous}
          className={buttonStyles({ variant: "secondary", className: "min-h-10 px-2.5" })}
        >
          <ChevronLeft className="size-4 rtl:rotate-180" aria-hidden="true" />
          <span className="sr-only sm:not-sr-only">{labels.back}</span>
        </button>

        {pageWindow(page, totalPages).map((entry, index) =>
          entry === "gap" ? (
            <span key={`gap-${index}`} className="px-1 text-sm text-muted">
              …
            </span>
          ) : (
            <button
              key={entry}
              type="button"
              onClick={() => onPageChange(entry)}
              aria-current={entry === page ? "page" : undefined}
              aria-label={labels.pageOf.replace("{page}", String(entry)).replace("{total}", String(totalPages))}
              className={pageButtonStyles(entry === page)}
            >
              {formatNumber(entry, locale)}
            </button>
          ),
        )}

        <button
          type="button"
          onClick={() => onPageChange(page + 1)}
          disabled={page === totalPages}
          aria-label={labels.next}
          className={buttonStyles({ variant: "secondary", className: "min-h-10 px-2.5" })}
        >
          <span className="sr-only sm:not-sr-only">{labels.forward}</span>
          <ChevronRight className="size-4 rtl:rotate-180" aria-hidden="true" />
        </button>
      </div>
    </nav>
  );
}
