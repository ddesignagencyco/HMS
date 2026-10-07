"use client";

import { ChevronDown, Globe2, LogOut, MapPin as MapPinIcon, Menu, Phone, Plus, ShieldCheck, UserRound, X } from "lucide-react";
import Link from "next/link";
import { usePathname, useRouter } from "next/navigation";
import { useEffect, useState } from "react";
import toast from "react-hot-toast";
import type { Dictionary } from "@/lib/dictionaries";
import { cn, localizedPath, type Locale } from "@/lib/utils";
import { buttonStyles } from "@/components/ui";
import { useSession } from "@/features/auth/session";
import { homePathForRoles } from "@/features/auth/routing";
import { BrandMark } from "@/components/brand-mark";

export function SiteHeader({ locale, dict }: { locale: Locale; dict: Dictionary }) {
  const pathname = usePathname();
  const router = useRouter();
  const { status, roles, signOut } = useSession();
  const [open, setOpen] = useState(false);
  const [accountOpen, setAccountOpen] = useState(false);
  const [scrolled, setScrolled] = useState(false);

  /* A dropdown is a promise that there is a menu. Clicking away or pressing Escape
     has to close it, and it must not survive a navigation. */
  useEffect(() => {
    if (!accountOpen) return;
    const close = () => setAccountOpen(false);
    const onKey = (event: KeyboardEvent) => {
      if (event.key === "Escape") close();
    };
    document.addEventListener("click", close);
    document.addEventListener("keydown", onKey);
    return () => {
      document.removeEventListener("click", close);
      document.removeEventListener("keydown", onKey);
    };
  }, [accountOpen]);

  useEffect(() => {
    const onScroll = () => setScrolled(window.scrollY > 8);
    onScroll();
    window.addEventListener("scroll", onScroll, { passive: true });
    return () => window.removeEventListener("scroll", onScroll);
  }, []);

  /* One word per item, and only routes that exist. A second word is a sentence
     somebody has to finish, and the underline is what says where you are. */
  const homeHref = localizedPath(locale);
  const links = [
    { href: homeHref, label: dict.nav.home },
    { href: localizedPath(locale, "/providers"), label: dict.nav.search },
    { href: localizedPath(locale, "/services"), label: dict.nav.servicesShort },
    { href: localizedPath(locale, "/plans"), label: dict.nav.plansShort },
  ];

  /* Bookings is a portal route, so it only appears once there is an account to
     look at them in. Offering it to a signed-out visitor would be a link to the
     sign-in page wearing a different label. */
  const signedIn = status === "authenticated";
  const bookingsHref = localizedPath(locale, "/account/bookings");
  const shownLinks = signedIn ? [...links, { href: bookingsHref, label: dict.nav.bookings }] : links;

  // const otherLocale: Locale = locale === "en" ? "ur" : "en";
  /* The public contact number. A single place, so the strip and the footer can
     never disagree; kept out of the dictionary because it is not translated. */
  const supportPhone = "+92 300 1234567";

  /* Three states, not two: while the session question is in flight nobody yet
     knows whether this browser has a session, so the header holds a placeholder
     rather than offering sign-in to somebody who is already signed in — which is
     the state every full page load renders before the answer arrives. */
  const sessionSettled = status !== "loading";
  const accountHref = homePathForRoles(roles, locale);

  /**
   * The underline means "you are here" and nothing else.
   *
   * A section counts as active on its own route and on everything nested under
   * it, so `/account/bookings/123` still marks Bookings — comparing the whole
   * path would make every item go inactive the moment a detail page opened. The
   * boundary is a following slash, not `startsWith`, so `/services-archive` can
   * never light up Services.
   */
  const isActive = (href: string): boolean =>
    href === homeHref ? pathname === homeHref : pathname === href || pathname.startsWith(`${href}/`);

  const leave = async () => {
    await signOut();
    toast.success(dict.auth.signedOut);
    router.replace(localizedPath(locale));
  };

  /* Hover is allowed to change colour. It is not allowed to draw the underline —
     an underline that appears under the pointer says "this is where you are", and
     two underlines at once is worse than none. */
  const navLink = (href: string, label: string) => {
    const active = isActive(href);
    return (
      <Link
        key={href}
        href={href}
        aria-current={active ? "page" : undefined}
        className={cn(
          "relative inline-flex min-h-11 items-center rounded-[9px] px-3 text-sm font-medium transition-colors duration-200",
          active ? "text-navy" : "text-secondary hover:text-navy",
        )}
      >
        {label}
        <span
          aria-hidden="true"
          className={cn(
            "absolute inset-x-3 bottom-1 h-px origin-left bg-primary transition-transform duration-200 ease-out motion-reduce:transition-none",
            active ? "scale-x-100" : "scale-x-0",
          )}
        />
      </Link>
    );
  };

  const [langOpen, setLangOpen] = useState(false);
  const [langOpenMobile, setLangOpenMobile] = useState(false);

  useEffect(() => {
    if (!langOpen) return;
    const close = () => setLangOpen(false);
    const onKey = (event: KeyboardEvent) => {
      if (event.key === "Escape") close();
    };
    document.addEventListener("click", close);
    document.addEventListener("keydown", onKey);
    return () => {
      document.removeEventListener("click", close);
      document.removeEventListener("keydown", onKey);
    };
  }, [langOpen]);

  useEffect(() => {
    if (!langOpenMobile) return;
    const close = () => setLangOpenMobile(false);
    const onKey = (event: KeyboardEvent) => {
      if (event.key === "Escape") close();
    };
    document.addEventListener("click", close);
    document.addEventListener("keydown", onKey);
    return () => {
      document.removeEventListener("click", close);
      document.removeEventListener("keydown", onKey);
    };
  }, [langOpenMobile]);

  const otherLocale: Locale = locale === "en" ? "ur" : "en";
  const localeHref = pathname.replace(/^\/(en|ur)/, `/${otherLocale}`);

  return (
    <header
      className={cn(
        "sticky top-[var(--demo-bar-h,0px)] z-40 border-b transition-[background-color,box-shadow,border-color] duration-300 ease-out",
        scrolled
          ? "border-line bg-white/92 shadow-[0_1px_12px_rgba(15,23,42,0.05)] backdrop-blur-[12px]"
          : "border-transparent bg-white",
      )}
    >
      <div className="hidden border-b border-white/10 bg-navy text-white lg:block">
        <div className="container-shell flex h-10 items-center justify-between gap-4 text-xs">
          <div className="flex items-center gap-5">
            <a href={`tel:${supportPhone.replace(/\s/g, "")}`} className="inline-flex items-center gap-2 text-white/85 transition-colors hover:text-white">
              <Phone className="size-3.5" aria-hidden="true" />
              <span className="tabular-nums" dir="ltr">{supportPhone}</span>
              <span className="sr-only">{dict.nav.phoneLabel}</span>
            </a>
            <Link href={localizedPath(locale, "/contact")} className="text-white/85 transition-colors hover:text-white">
              {dict.nav.support}
            </Link>
          </div>

          <div className="relative">
            <button
              type="button"
              onClick={(event) => {
                event.stopPropagation();
                setLangOpen((was) => !was);
              }}
              aria-expanded={langOpen}
              aria-label={dict.nav.languageMenu}
              className="flex items-center gap-1.5 rounded-md border border-line bg-navy px-2.5 py-1.5 text-sm text-white/85 transition-colors hover:bg-navy/30"
            >
              <Globe2 className="size-3.5" aria-hidden="true" />
              <span>{otherLocale === "ur" ? "اردو" : "English"}</span>
              <ChevronDown className="size-3" />
            </button>

            {langOpen ? (
              <div role="menu" className="absolute left-0 top-[calc(100%+0.5rem)] z-10 w-32 rounded-[12px] bg-white p-1.5 shadow-lifted border border-line" style={{ minWidth: 100 }}>
                <div role="none" className="flex items-center gap-3 px-2 py-1 text-xs text-slate-500" style={{ borderBottom: "1px solid #e5e7eb" }}>
                  <button
                    role="menuitem"
                    type="button"
                    onClick={() => {
                      void router.push(localizedPath("en"));
                      setLangOpen(false);
                    }}
                    className="flex-1 rounded-none px-0 py-0 bg-transparent text-navy hover:bg-slate-100"
                  >
                    English
                  </button>
                  <button
                    role="menuitem"
                    type="button"
                    onClick={() => {
                      void router.push(localizedPath("ur"));
                      setLangOpen(false);
                    }}
                    className="flex-1 rounded-none px-0 py-0 bg-transparent text-navy hover:bg-slate-100"
                  >
                    اردو
                  </button>
                </div>
              </div>
            ) : null}
          </div>
        </div>
      </div>

      <div className="container-shell flex h-[72px] items-center justify-between gap-4">
        {/* The mark carries the brand. The wordmark beside it was the old
            implementation's habit, and it is what made this header read as
            something that had been half-migrated. */}
        <Link href={homeHref} aria-label={dict.nav.brandLabel} title={dict.nav.brandLabel} className="flex min-w-0 shrink-0 items-center">
          <BrandMark className="size-10" />
        </Link>

        <nav className="hidden items-center gap-1 xl:flex" aria-label={dict.nav.menu}>
          {shownLinks.map((link) => navLink(link.href, link.label))}
        </nav>

        <div className="hidden items-center gap-2 xl:flex">
          {!sessionSettled ? (
            <span className="skeleton size-11 rounded-full" aria-hidden="true" />
          ) : signedIn ? (
            <div className="relative">
              <button
                type="button"
                onClick={() => setAccountOpen((was) => !was)}
                aria-expanded={accountOpen}
                aria-haspopup="menu"
                aria-label={dict.nav.accountMenu}
                className="grid size-11 place-items-center rounded-full border border-line text-navy transition-colors hover:bg-slate-50"
              >
                <UserRound className="size-5" />
              </button>

              {accountOpen ? (
                <div role="menu" className="absolute end-0 top-[calc(100%+0.5rem)] z-50 w-52 rounded-[12px] border border-line bg-white p-1.5 shadow-lifted">
                  <Link role="menuitem" href={accountHref} onClick={() => setAccountOpen(false)} className="flex items-center gap-2.5 rounded-[9px] px-3 py-2.5 text-sm font-medium text-navy hover:bg-slate-50">
                    <UserRound className="size-4 text-muted" aria-hidden="true" />
                    {dict.nav.profile}
                  </Link>
                  <Link role="menuitem" href={localizedPath(locale, "/account/addresses")} onClick={() => setAccountOpen(false)} className="flex items-center gap-2.5 rounded-[9px] px-3 py-2.5 text-sm font-medium text-navy hover:bg-slate-50">
                    <MapPinIcon className="size-4 text-muted" aria-hidden="true" />
                    {dict.nav.addresses}
                  </Link>
                  <Link role="menuitem" href={localizedPath(locale, "/account/security")} onClick={() => setAccountOpen(false)} className="flex items-center gap-2.5 rounded-[9px] px-3 py-2.5 text-sm font-medium text-navy hover:bg-slate-50">
                    <ShieldCheck className="size-4 text-muted" aria-hidden="true" />
                    {dict.nav.security}
                  </Link>
                  <button role="menuitem" type="button" onClick={() => { setAccountOpen(false); void leave(); }} className="flex w-full items-center gap-2.5 rounded-[9px] px-3 py-2.5 text-sm font-medium text-navy hover:bg-slate-50">
                    <LogOut className="size-4 text-muted" aria-hidden="true" />
                    {dict.nav.signOut}
                  </button>
                </div>
              ) : null}
            </div>
          ) : (
            <Link href={localizedPath(locale, "/auth/sign-in")} className={buttonStyles({ variant: "secondary" })}>
              {dict.nav.signIn}
            </Link>
          )}
          <Link href={localizedPath(locale, "/services")} className={buttonStyles()}>
            <Plus className="size-4" aria-hidden="true" />
            {dict.nav.bookService}
          </Link>
        </div>

        <button
          type="button"
          onClick={() => setOpen(true)}
          aria-label={dict.nav.menu}
          className="grid size-11 place-items-center rounded-[9px] border border-line text-navy xl:hidden"
        >
          <Menu className="size-5" aria-hidden="true" />
        </button>
      </div>

      {open ? (
        <div className="fixed inset-0 z-50 bg-navy/40 xl:hidden" role="dialog" aria-modal="true" aria-label={dict.nav.menu}>
          <div className="absolute inset-x-4 top-4 rounded-[14px] border border-line bg-white p-5 shadow-lifted">
            <div className="flex items-center justify-between">
              <span className="flex items-center gap-2.5 font-bold text-navy" aria-label={dict.nav.brandLabel}>
                <BrandMark />
              </span>
              <div className="flex items-center gap-2">
                <Link href={localeHref} className={buttonStyles({ variant: "secondary", className: "h-11 border-line text-navy" })}>
                  {otherLocale === "ur" ? "اردو" : "English"}
                </Link>
                <button type="button" onClick={() => setOpen(false)} className="grid size-11 place-items-center rounded-[9px] border border-line" aria-label={dict.nav.close}>
                  <X className="size-5" aria-hidden="true" />
                </button>
              </div>
            </div>
            <nav className="mt-5 grid gap-1" aria-label={dict.nav.menu}>
              {shownLinks.map((link) => {
                const active = isActive(link.href);
                return (
                  <Link
                    key={link.href}
                    href={link.href}
                    onClick={() => setOpen(false)}
                    aria-current={active ? "page" : undefined}
                    className={cn(
                      "flex items-center justify-between gap-3 rounded-[9px] px-3 py-3 text-sm font-medium",
                      active ? "bg-blue-50 text-primary-strong" : "text-navy hover:bg-slate-50",
                    )}
                  >
                    {link.label}
                    {active ? <span aria-hidden="true" className="h-px w-4 bg-primary" /> : null}
                  </Link>
                );
              })}
            </nav>
            <div className="mt-5 grid gap-3 border-t border-line pt-5">
              {!sessionSettled ? (
                <span className="skeleton h-11 w-full rounded-[9px]" aria-hidden="true" />
              ) : signedIn ? (
                <>
                  <Link href={accountHref} className={buttonStyles({ className: "w-full" })}>{dict.nav.myAccount}</Link>
                  <button type="button" onClick={leave} className={buttonStyles({ variant: "quiet", className: "w-full" })}>
                    <LogOut className="size-4" aria-hidden="true" />
                    {dict.nav.signOut}
                  </button>
                </>
              ) : (
                <Link href={localizedPath(locale, "/auth/sign-in")} className={buttonStyles({ className: "w-full" })}>{dict.nav.signIn}</Link>
              )}
            </div>
          </div>
        </div>
      ) : null}
    </header>
  );
}