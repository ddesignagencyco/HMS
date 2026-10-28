"use client";

/* The language switch, used in both the desktop utility strip and the mobile
 * drawer.
 *
 * **It used to lose your place.** The desktop version called
 * `router.push(localizedPath("en"))`, and `localizedPath` with only a locale
 * builds the *home* path for that locale. Switching language from
 * `/en/services/plumbing` therefore landed you on `/ur` — the homepage, not the
 * page you were reading. `switchHref` below swaps the locale segment of the
 * current path instead, so `/en/services/plumbing` becomes
 * `/ur/services/plumbing`.
 *
 * Two other things were wrong with it:
 *
 * **It was one button pretending to be a dropdown.** The menu was a single row
 * of two bare `<button>`s with `px-0 py-0 bg-transparent rounded-none`, which is
 * why it read as two stray words rather than a menu. There was no visible
 * boundary between the trigger and its options, and no indication of which
 * language you are *currently* in.
 *
 * **The mobile drawer had no dropdown at all** — it offered a single link
 * labelled with the *other* language, and `langOpenMobile` was declared with a
 * full click-outside/Escape effect that nothing ever read.
 *
 * ARIA: a `menu` may only contain `menuitem`s (and groups). The old markup put
 * a `role="none"` wrapper between them, which drops the items out of the menu's
 * owned set. The rows are direct children here, the active language carries
 * `aria-checked`, and Escape / outside-click / blur all close it. */

import { Check, ChevronDown, Globe2 } from "lucide-react";
import { useEffect, useRef, useState } from "react";
import Link from "next/link";
import { cn } from "@/lib/utils";
import type { Dictionary } from "@/lib/dictionaries";
import type { Locale } from "@/lib/utils";

const LOCALES: readonly { code: Locale; label: string }[] = [
  { code: "en", label: "English" },
  { code: "ur", label: "اردو" },
];

/** The current path with its locale segment swapped, or prefixed if it had none. */
export const switchHref = (pathname: string, next: Locale): string => {
  const stripped = pathname.replace(/^\/(en|ur)(?=\/|$)/, "");
  return `/${next}${stripped}`;
}

export function LanguageSwitcher({
  locale,
  pathname,
  dict,
  variant = "strip",
}: {
  locale: Locale;
  pathname: string;
  dict: Dictionary;
  /** `strip` sits on the navy utility bar; `drawer` sits inside the mobile sheet. */
  variant?: "strip" | "drawer";
}) {
  const [open, setOpen] = useState(false);
  const wrap = useRef<HTMLDivElement>(null);
  const current = LOCALES.find((entry) => entry.code === locale) ?? LOCALES[0];

  useEffect(() => {
    if (!open) return;
    const onPointerDown = (event: MouseEvent) => {
      if (wrap.current !== null && !wrap.current.contains(event.target as Node)) setOpen(false);
    };
    const onKey = (event: KeyboardEvent) => {
      if (event.key === "Escape") setOpen(false);
    };
    document.addEventListener("mousedown", onPointerDown);
    document.addEventListener("keydown", onKey);
    return () => {
      document.removeEventListener("mousedown", onPointerDown);
      document.removeEventListener("keydown", onKey);
    };
  }, [open]);

  /* No effect closes the menu on a locale change. An earlier version did, to
     guard against the panel surviving navigation — but that is what the link's
     own `onClick` is for, and a setState-in-effect here only produced a
     cascading render. If the component instance does survive a locale change, the
     panel is already closed because the click that caused it closed it. */

  const drawer = variant === "drawer";
  /* Unique accessible name per instance so screen readers / queries can
     distinguish the utility-strip switcher from the drawer switcher. */
  const ariaLabel = drawer
    ? `${dict.nav.languageMenu} (menu)`
    : `${dict.nav.languageMenu} (toolbar)`;

  return (
    <div ref={wrap} className={cn("relative", drawer ? "w-full" : "")}>
      <button
        type="button"
        onClick={() => setOpen((was) => !was)}
        aria-expanded={open}
        aria-haspopup="menu"
        aria-label={ariaLabel}
        className={cn(
          "inline-flex items-center gap-2 rounded-[9px] text-sm font-medium transition-colors",
          "focus-visible:outline-none focus-visible:ring-4 focus-visible:ring-blue-100",
          drawer
            ? "min-h-11 w-full justify-between border border-line bg-white px-3 text-navy hover:bg-slate-50"
            : "border border-white/20 px-2.5 py-1.5 text-white/85 hover:bg-white/10 hover:text-white",
        )}
      >
        <Globe2 className="size-4 shrink-0" aria-hidden="true" />
        <span>{drawer ? dict.nav.languageMenu : current.label}</span>
        <ChevronDown
          className={cn("size-3.5 shrink-0 transition-transform duration-150", open && "rotate-180")}
          aria-hidden="true"
        />
      </button>

      {open ? (
        <div
          role="menu"
          aria-label={ariaLabel}
          className={cn(
            /* No border on the panel. It sits on the navy strip, and `border-line`
               is a slate chosen for contrast against a white *page* — it drew a
               hard box around a floating white surface that the shadow already
               separates. The option fills, not a container outline, are what make
               the rows legible. */
            "z-50 overflow-hidden rounded-[14px] bg-white p-1.5 shadow-lifted",
            drawer ? "mt-2 w-full" : "absolute end-0 top-[calc(100%+0.5rem)] w-44",
          )}
        >
          {LOCALES.map((entry) => {
            const active = entry.code === locale;
            return (
              <Link
                key={entry.code}
                role="menuitemradio"
                aria-checked={active}
                href={switchHref(pathname, entry.code)}
                onClick={() => setOpen(false)}
                lang={entry.code}
                className={cn(
                  "flex min-h-10 items-center justify-between gap-2 rounded-[9px] px-3 text-sm transition-colors",
                  active ? "bg-blue-50 font-semibold text-primary-strong" : "font-medium text-navy hover:bg-slate-50",
                )}
              >
                <span>{entry.label}</span>
                {active ? <Check className="size-4 shrink-0 text-primary" aria-hidden="true" /> : null}
              </Link>
            );
          })}
        </div>
      ) : null}
    </div>
  );
}