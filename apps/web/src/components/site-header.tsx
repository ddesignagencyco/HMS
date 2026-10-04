"use client";

import { Globe2, LogOut, Menu, UserRound, X } from "lucide-react";
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
  const [scrolled, setScrolled] = useState(false);

  useEffect(() => {
    const onScroll = () => setScrolled(window.scrollY > 8);
    onScroll();
    window.addEventListener("scroll", onScroll, { passive: true });
    return () => window.removeEventListener("scroll", onScroll);
  }, []);
  const links = [
    { href: localizedPath(locale, "/services"), label: dict.nav.services },
    { href: localizedPath(locale, "/providers"), label: dict.nav.professionals },
    { href: localizedPath(locale, "/plans"), label: dict.nav.plans },
    { href: localizedPath(locale, "/how-verification-works"), label: dict.nav.howWeVerify },
  ];
  const otherLocale: Locale = locale === "en" ? "ur" : "en";
  const localeHref = pathname.replace(/^\/(en|ur)/, `/${otherLocale}`);
  const signedIn = status === "authenticated";
  const accountHref = homePathForRoles(roles, locale);

  const leave = async () => {
    await signOut();
    toast.success(dict.auth.signedOut);
    router.replace(localizedPath(locale));
  };

  return (
    <header
      className={cn(
        "sticky top-[var(--demo-bar-h,0px)] z-40 border-b transition-[background-color,box-shadow,border-color] duration-300 ease-out",
        scrolled
          ? "border-line bg-white/92 shadow-[0_1px_12px_rgba(15,23,42,0.05)] backdrop-blur-[12px]"
          : "border-transparent bg-white",
      )}
    >
      <div className="container-shell flex h-[72px] items-center justify-between gap-4">
        <Link href={localizedPath(locale)} className="flex items-center gap-2.5">
          <BrandMark />
          <span className="text-lg font-bold tracking-[-0.03em] text-navy">{dict.brand.name}</span>
        </Link>

        <nav className="hidden items-center gap-1 xl:flex" aria-label={dict.brand.name}>
          {links.map((link) => (
            <Link
              key={link.href}
              href={link.href}
              className="link-motion group/nav relative inline-flex min-h-11 items-center rounded-[9px] px-3 text-sm font-medium text-secondary transition-colors duration-200 hover:text-navy"
            >
              {link.label}
              <span
                aria-hidden="true"
                className="absolute inset-x-2.5 bottom-1 h-px origin-left scale-x-0 bg-primary transition-transform duration-200 ease-out group-hover/nav:scale-x-100 motion-reduce:transition-none xl:inset-x-3"
              />
            </Link>
          ))}
        </nav>

        <div className="hidden items-center gap-2 lg:flex">
          <Link href={localeHref} className={buttonStyles({ variant: "quiet", className: "px-3" })}>
            <Globe2 className="size-4" />
            {otherLocale === "ur" ? "اردو" : "EN"}
          </Link>
          {signedIn ? (
            <>
              <Link href={accountHref} className={buttonStyles({ variant: "secondary" })}>
                <UserRound className="size-4" />
                {dict.nav.myAccount}
              </Link>
              <button type="button" onClick={leave} className={buttonStyles({ variant: "quiet" })}>
                {dict.nav.signOut}
              </button>
            </>
          ) : (
            <Link href={localizedPath(locale, "/auth/sign-in")} className={buttonStyles({ variant: "secondary" })}>
              {dict.nav.signIn}
            </Link>
          )}
          <Link href={localizedPath(locale, "/services")} className={buttonStyles()}>
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
              <span className="flex items-center gap-2.5 font-bold text-navy"><BrandMark />{dict.brand.name}</span>
              <button type="button" onClick={() => setOpen(false)} className="grid size-11 place-items-center rounded-[9px] border border-line" aria-label={dict.nav.close}>
                <X className="size-5" aria-hidden="true" />
              </button>
            </div>
            <nav className="mt-5 grid gap-1" aria-label="Mobile navigation">
              {links.map((link) => (
                <Link key={link.href} href={link.href} onClick={() => setOpen(false)} className="rounded-[9px] px-3 py-3 text-sm font-medium text-navy hover:bg-slate-50">
                  {link.label}
                </Link>
              ))}
            </nav>
            <div className="mt-5 grid grid-cols-2 gap-3 border-t border-line pt-5">
              <Link href={localeHref} className={buttonStyles({ variant: "secondary" })}>{otherLocale === "ur" ? "اردو" : "EN"}</Link>
              {signedIn ? (
                <>
                  <Link href={accountHref} className={buttonStyles()}>{dict.nav.myAccount}</Link>
                  <button type="button" onClick={leave} className={buttonStyles({ variant: "quiet", className: "col-span-2 w-full" })}>
                    <LogOut className="size-4" aria-hidden="true" />
                    {dict.nav.signOut}
                  </button>
                </>
              ) : (
                <Link href={localizedPath(locale, "/auth/sign-in")} className={buttonStyles()}>{dict.nav.signIn}</Link>
              )}
            </div>
          </div>
        </div>
      ) : null}
    </header>
  );
}