"use client";

import { Banknote, BarChart3, Bell, BriefcaseBusiness, CalendarDays, ChevronDown, CircleDollarSign, ClipboardCheck, CreditCard, FileCheck2, Gavel, Gauge, Globe2, Heart, History, Home, Landmark, LayoutDashboard, Lock, LogOut, MapPinned, Menu, MessageSquare, PhoneCall, ReceiptText, RefreshCcw, Repeat2, Scale, ScrollText, Settings, Settings2, ShieldAlert, ShieldCheck, SlidersHorizontal, Star, Sun, TriangleAlert, UserRound, UsersRound, Wallet, Wrench, X } from "lucide-react";
import Link from "next/link";
import { usePathname, useRouter } from "next/navigation";
import { useEffect, useRef, useState } from "react";
import type { Dictionary } from "@/lib/dictionaries";
import { cn, localizedPath, type Locale } from "@/lib/utils";
import { useSession } from "@/features/auth/session";
import { NotificationBell } from "@/components/notification-bell";

/* Every item here points at a page this app actually renders, so nothing is
   invented to fill the rail and no entry needs a data lookup to exist. */
const roleConfig = {
  customer: { label: "customer", icon: Home },
  provider: { label: "provider", icon: BriefcaseBusiness },
  agent: { label: "agent", icon: ClipboardCheck },
  admin: { label: "admin", icon: ShieldCheck },
  finance: { label: "finance", icon: CreditCard },
} as const;

type Role = keyof typeof roleConfig;

/* The role is the first segment after the locale, never a substring.
   Matching on `includes` sent `/admin/providers` to the professional
   rail, because "providers" contains "provider". */
function getRole(pathname: string): Role {
  const section = pathname.split("/").filter(Boolean)[1];
  if (section === "provider" || section === "agent" || section === "finance" || section === "admin") {
    return section;
  }
  return "customer";
}

export function WorkspaceShell({ locale, dict, children }: { locale: Locale; dict: Dictionary; children: React.ReactNode }) {
  const pathname = usePathname();
  const router = useRouter();
  const { user, signOut: endSession } = useSession();
  const [navOpen, setNavOpen] = useState(false);
  const [profileOpen, setProfileOpen] = useState(false);
  const profileMenuRef = useRef<HTMLDivElement>(null);
  const role = getRole(pathname);
  const Icon = roleConfig[role].icon;

  const otherLocale: Locale = locale === "en" ? "ur" : "en";
  const localeHref = pathname.replace(/^\/(en|ur)/, `/${otherLocale}`);
  const base = `/${locale}/${role === "customer" ? "account" : role}`;
  const nav = role === "customer"
    ? [
        { href: base, label: dict.portal.overview, icon: LayoutDashboard },
        { href: `${base}/bookings`, label: dict.portal.bookings, icon: ClipboardCheck },
        { href: `${base}/messages`, label: locale === "ur" ? "پیغامات" : "Messages", icon: MessageSquare },
        { href: `${base}/addresses`, label: dict.portal.addresses, icon: MapPinned },
        { href: `${base}/plans`, label: dict.portal.plans, icon: Repeat2 },
        { href: `${base}/favourites`, label: dict.portal.favourites, icon: Heart },
        { href: `${base}/profile`, label: dict.portal.profile, icon: Settings },
        { href: `${base}/security`, label: dict.portal.security, icon: ShieldCheck },
      ]
    : role === "provider"
      ? [
          { href: base, label: dict.portal.overview, icon: LayoutDashboard },
          { href: `${base}/today`, label: dict.portal.today, icon: Sun },
          { href: `${base}/offers`, label: dict.portal.offers, icon: ReceiptText },
          { href: `${base}/messages`, label: locale === "ur" ? "پیغامات" : "Messages", icon: MessageSquare },
          { href: `${base}/calendar`, label: dict.portal.calendar, icon: CalendarDays },
          { href: `${base}/services`, label: dict.portal.services, icon: Wrench },
          { href: `${base}/areas`, label: dict.portal.serviceArea, icon: MapPinned },
          { href: `${base}/documents`, label: dict.portal.documents, icon: FileCheck2 },
          { href: `${base}/earnings`, label: dict.portal.earnings, icon: Wallet },
          { href: `${base}/payouts`, label: dict.portal.payouts, icon: Banknote },
          { href: `${base}/ratings`, label: dict.portal.ratings, icon: Star },
          { href: `${base}/conduct`, label: dict.portal.conduct, icon: ShieldAlert },
          { href: `${base}/profile`, label: dict.portal.profile, icon: Settings },
        ]
        : role === "agent"
        ? [
            { href: base, label: dict.portal.queue, icon: LayoutDashboard },
            { href: `${base}/attempts`, label: dict.agent.attempts, icon: PhoneCall },
          ]
        : role === "finance"
          ? [
              { href: base, label: dict.portal.overview, icon: LayoutDashboard },
              { href: `${base}/escrow`, label: dict.portal.escrow, icon: Landmark },
              { href: `${base}/releases`, label: dict.finance.releases, icon: Scale },
              { href: `${base}/refunds`, label: dict.finance.refunds, icon: RefreshCcw },
              { href: `${base}/payouts`, label: dict.portal.payouts, icon: Banknote },
              { href: `${base}/cash`, label: dict.finance.cash, icon: CircleDollarSign },
              { href: `${base}/debts`, label: dict.finance.debts, icon: TriangleAlert },
              { href: `${base}/ledger`, label: dict.finance.ledger, icon: ReceiptText },
            ]
          : [
              { href: `/${locale}/admin`, label: dict.portal.admin, icon: LayoutDashboard },
              { href: `/${locale}/admin/ops`, label: dict.admin.ops, icon: Gauge },
              { href: `/${locale}/admin/approvals`, label: dict.admin.approvals, icon: ClipboardCheck },
              { href: `/${locale}/admin/providers`, label: dict.admin.allProviders, icon: UsersRound },
              { href: `/${locale}/admin/customers`, label: dict.admin.customers, icon: UserRound },
              { href: `/${locale}/admin/catalogue`, label: dict.admin.catalogue, icon: SlidersHorizontal },
              { href: `/${locale}/admin/complaints`, label: dict.admin.complaints, icon: ScrollText },
              { href: `/${locale}/admin/disputes`, label: dict.admin.disputes, icon: Gavel },
              { href: `/${locale}/admin/penalties`, label: dict.admin.penalties, icon: TriangleAlert },
              { href: `/${locale}/admin/appeals`, label: dict.admin.appeals, icon: Scale },
              { href: `/${locale}/admin/plans`, label: dict.portal.plans, icon: Repeat2 },
              { href: `/${locale}/admin/reports`, label: dict.admin.reports, icon: BarChart3 },
              { href: `/${locale}/admin/roles`, label: dict.admin.roles, icon: Lock },
              { href: `/${locale}/admin/templates`, label: dict.admin.templates, icon: Bell },
              { href: `/${locale}/admin/settings`, label: dict.admin.settings, icon: Settings2 },
              { href: `/${locale}/admin/audit`, label: dict.admin.audit, icon: History },
            ];

  /* Escape closes the drawer, and the page behind it must not scroll while it
     is open. Navigation closes it from the link handlers rather than from a
     pathname effect, which would be a second render after the fact. */
  useEffect(() => {
    if (!navOpen) return;
    const onKey = (event: KeyboardEvent) => {
      if (event.key === "Escape") setNavOpen(false);
    };
    document.addEventListener("keydown", onKey);
    const previous = document.body.style.overflow;
    document.body.style.overflow = "hidden";
    return () => {
      document.removeEventListener("keydown", onKey);
      document.body.style.overflow = previous;
    };
  }, [navOpen]);

  useEffect(() => {
    if (!profileOpen) return;
    const handleClick = (e: MouseEvent) => {
      if (profileMenuRef.current && !profileMenuRef.current.contains(e.target as Node)) {
        setProfileOpen(false);
      }
    };
    const onKey = (e: KeyboardEvent) => {
      if (e.key === "Escape") setProfileOpen(false);
    };
    document.addEventListener("mousedown", handleClick);
    document.addEventListener("keydown", onKey);
    return () => {
      document.removeEventListener("mousedown", handleClick);
      document.removeEventListener("keydown", onKey);
    };
  }, [profileOpen]);

  const isActive = (href: string) => (href === base ? pathname === href : pathname.startsWith(href));

  /* Revokes the refresh token on the server and drops every cached query before
     leaving, so the next person at this browser starts from nothing. */
  const leave = async () => {
    setNavOpen(false);
    await endSession();
    router.replace(localizedPath(locale));
  };

  const brand = () => (
    <div className="flex min-w-0 flex-1 items-center gap-3">
      <span className="grid size-9 shrink-0 place-items-center rounded-[9px] bg-yellow-500 text-navy-950 font-bold">
        <Wrench className="size-4" />
      </span>
      <div className="min-w-0 flex-1">
        <p className="truncate font-bold text-white text-sm leading-tight">{user ? `${user.firstName} ${user.lastName}`.trim() : dict.brand.name}</p>
        <p className="truncate text-xs text-white/55 capitalize leading-tight">{dict.portal[role]}</p>
      </div>
    </div>
  );

  const bottomActions = (
    <div className="grid gap-1 border-t border-white/10 px-4 py-4">
      <Link
        href={localizedPath(locale, "/")}
        className="flex min-h-11 w-full items-center gap-2 rounded-[9px] px-3 text-sm font-medium text-white/65 transition hover:bg-white/5 hover:text-white"
      >
        <Globe2 className="size-4" />
        {dict.portal.backToSite}
      </Link>
      <button
        type="button"
        onClick={leave}
        className="flex min-h-11 w-full items-center gap-2 rounded-[9px] px-3 text-sm font-medium text-white/65 transition hover:bg-white/5 hover:text-white"
      >
        <LogOut className="size-4" />
        {dict.portal.exit}
      </button>
    </div>
  );

  return (
    <div className="min-h-screen bg-page lg:grid lg:grid-cols-[264px_1fr]">
      {/* Desktop sidebar rail */}
      <aside className="sticky top-[var(--demo-bar-h,0px)] hidden h-[calc(100dvh-var(--demo-bar-h,0px))] flex-col border-e border-white/10 bg-navy-950 text-white lg:flex">
        <div className="flex h-16 shrink-0 items-center border-b border-white/10 px-5">{brand()}</div>
        <div className="min-h-0 flex-1 overflow-y-auto p-4">
          <p className="px-3 text-[10px] font-bold uppercase tracking-[0.16em] text-white/40">{dict.portal.sessionLabel}</p>
          <nav className="mt-3 grid gap-1" aria-label={dict.portal[role]}>
            {nav.map(({ href, label, icon: NavIcon }) => (
              <Link
                key={href}
                href={href}
                aria-current={isActive(href) ? "page" : undefined}
                className={cn(
                  "flex min-h-11 items-center gap-2 rounded-[9px] px-3 text-sm font-medium transition",
                  isActive(href) ? "bg-white/10 text-white ring-1 ring-inset ring-white/15" : "text-white/65 hover:bg-white/5 hover:text-white",
                )}
              >
                <NavIcon className="size-4 shrink-0" aria-hidden="true" />
                {label}
              </Link>
            ))}
          </nav>
        </div>
        {bottomActions}
      </aside>

      <div className="min-w-0">
        {/* Unified Top Dashboard Header for all dashboards */}
        <header className="sticky top-[var(--demo-bar-h,0px)] z-30 flex h-16 items-center justify-between border-b border-line bg-white px-4 sm:px-6 lg:px-8 shadow-xs">
          {/* Left: Mobile hamburger + active role / section title */}
          <div className="flex items-center gap-3 min-w-0">
            <button
              type="button"
              onClick={() => setNavOpen(true)}
              aria-label={dict.nav.menu}
              aria-expanded={navOpen}
              className="grid size-10 shrink-0 place-items-center rounded-[9px] border border-line text-navy hover:bg-slate-50 lg:hidden"
            >
              <Menu className="size-5" aria-hidden="true" />
            </button>
            <div className="flex items-center gap-2.5 min-w-0">
              <div className="grid size-8 shrink-0 place-items-center rounded-[8px] bg-slate-100 text-navy">
                <Icon className="size-4 shrink-0" aria-hidden="true" />
              </div>
              <p className="truncate text-sm font-bold text-navy capitalize">
                {dict.portal[role]}
              </p>
            </div>
          </div>

          {/* Right: Site link, Language switcher, Notification Bell, User Menu */}
          <div className="flex items-center gap-2 sm:gap-3">
            <Link
              href={localizedPath(locale, "/")}
              className="inline-flex h-9 items-center gap-1.5 rounded-[8px] border border-line bg-white px-3 text-xs font-semibold text-secondary transition hover:bg-slate-50 hover:text-navy"
              title={dict.portal.backToSite}
            >
              <Globe2 className="size-3.5" />
              <span className="hidden sm:inline">{dict.portal.backToSite}</span>
            </Link>

            <Link
              href={localeHref}
              className="inline-flex h-9 items-center justify-center rounded-[8px] border border-line bg-white px-2.5 text-xs font-semibold text-secondary transition hover:bg-slate-50 hover:text-navy"
              title={otherLocale === "ur" ? "اردو" : "English"}
            >
              <span>{otherLocale === "ur" ? "اردو" : "EN"}</span>
            </Link>

            <NotificationBell locale={locale} />

            <div className="relative" ref={profileMenuRef}>
              <button
                type="button"
                onClick={() => setProfileOpen((was) => !was)}
                aria-expanded={profileOpen}
                aria-label="User profile menu"
                className="flex items-center gap-2 rounded-[9px] border border-line bg-white p-1 pe-2 sm:pe-2.5 transition hover:bg-slate-50"
              >
                <span className="grid size-7 shrink-0 place-items-center rounded-full bg-navy text-xs font-bold text-white">
                  {user ? `${user.firstName[0]}${user.lastName[0]}`.toUpperCase() : "U"}
                </span>
                <span className="hidden max-w-[100px] truncate text-xs font-semibold text-navy sm:inline-block">
                  {user ? user.firstName : dict.nav.profile}
                </span>
                <ChevronDown className="size-3 text-muted" />
              </button>

              {profileOpen && (
                <div
                  role="menu"
                  className="absolute end-0 top-[calc(100%+0.5rem)] z-50 w-52 rounded-[12px] border border-line bg-white p-1.5 shadow-lifted"
                >
                  <div className="border-b border-line px-3 py-2">
                    <p className="truncate text-xs font-bold text-navy">{user ? `${user.firstName} ${user.lastName}`.trim() : "Account"}</p>
                    <p className="truncate text-[11px] text-muted">{user?.email || user?.phoneE164 || dict.portal[role]}</p>
                  </div>
                  <Link
                    role="menuitem"
                    href={
                      role === "customer"
                        ? localizedPath(locale, "/account/profile")
                        : role === "provider"
                        ? localizedPath(locale, "/provider/profile")
                        : role === "admin"
                        ? localizedPath(locale, "/admin/settings")
                        : localizedPath(locale, `/${role}`)
                    }
                    onClick={() => setProfileOpen(false)}
                    className="flex items-center gap-2.5 rounded-[8px] px-3 py-2 text-xs font-medium text-navy hover:bg-slate-50"
                  >
                    <Settings className="size-3.5 text-muted" />
                    {dict.nav.profile}
                  </Link>
                  <button
                    role="menuitem"
                    type="button"
                    onClick={() => { setProfileOpen(false); void leave(); }}
                    className="flex w-full items-center gap-2.5 rounded-[8px] px-3 py-2 text-xs font-medium text-rose-600 hover:bg-rose-50"
                  >
                    <LogOut className="size-3.5 text-rose-500" />
                    {dict.portal.exit}
                  </button>
                </div>
              )}
            </div>
          </div>
        </header>

        {navOpen ? (
          <div className="fixed inset-0 z-50 lg:hidden">
            <button
              type="button"
              aria-label={dict.nav.close}
              onClick={() => setNavOpen(false)}
              className="absolute inset-0 bg-navy/50"
            />
            <div
              role="dialog"
              aria-modal="true"
              aria-label={dict.portal[role]}
              className="absolute inset-y-0 start-0 flex w-[85%] max-w-[320px] flex-col bg-navy-950 text-white shadow-lifted"
            >
              <div className="flex h-16 shrink-0 items-center justify-between gap-2 border-b border-white/10 px-4">
                {brand()}
                <button
                  type="button"
                  onClick={() => setNavOpen(false)}
                  aria-label={dict.nav.close}
                  className="grid size-10 shrink-0 place-items-center rounded-[9px] border border-white/15 text-white/80 hover:text-white"
                >
                  <X className="size-5" aria-hidden="true" />
                </button>
              </div>
              <div className="min-h-0 flex-1 overflow-y-auto p-4">
                <p className="px-3 text-[10px] font-bold uppercase tracking-[0.16em] text-white/40">{dict.portal.sessionLabel}</p>
                <nav className="mt-3 grid gap-1" aria-label={dict.portal[role]}>
                  {nav.map(({ href, label, icon: NavIcon }) => (
                    <Link
                      key={href}
                      href={href}
                      onClick={() => setNavOpen(false)}
                      aria-current={isActive(href) ? "page" : undefined}
                      className={cn(
                        "flex min-h-11 items-center gap-2 rounded-[9px] px-3 text-sm font-medium transition",
                        isActive(href) ? "bg-white/10 text-white ring-1 ring-inset ring-white/15" : "text-white/65 hover:bg-white/5 hover:text-white",
                      )}
                    >
                      <NavIcon className="size-4 shrink-0" aria-hidden="true" />
                      {label}
                    </Link>
                  ))}
                </nav>
              </div>
              {bottomActions}
            </div>
          </div>
        ) : null}

        {/* Registers and tables in the console are the work surface, so
            the page runs the full width the rail leaves it. */}
        <main className="relative min-w-0 overflow-x-hidden px-4 py-6 sm:px-6 sm:py-8 lg:px-8 lg:py-10">
          {children}
        </main>
      </div>
    </div>
  );
}
