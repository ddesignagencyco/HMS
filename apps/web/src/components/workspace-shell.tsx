"use client";

import { Banknote, BarChart3, Bell, BriefcaseBusiness, CalendarDays, CircleDollarSign, ClipboardCheck, CreditCard, FileCheck2, Gavel, Gauge, Heart, History, Home, Landmark, LayoutDashboard, Lock, LogOut, MapPinned, Menu, PhoneCall, ReceiptText, RefreshCcw, Repeat2, Scale, ScrollText, Settings, Settings2, ShieldAlert, ShieldCheck, SlidersHorizontal, Star, Sun, TriangleAlert, UserRound, UsersRound, Wallet, Wrench, X } from "lucide-react";
import Link from "next/link";
import { usePathname, useRouter } from "next/navigation";
import { useEffect, useState } from "react";
import type { Dictionary } from "@/lib/dictionaries";
import { bookings } from "@/lib/data";
import { cn, localizedPath, type Locale } from "@/lib/utils";
import { useSession } from "@/features/auth/session";

/* The console link has to point at a booking that is actually waiting on a
   verification call, otherwise it lands on the wrong record. */
const pendingVerificationId =
  bookings.find((booking) => booking.status === "AWAITING_VERIFICATION")?.id ?? bookings[0].id;

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
  const role = getRole(pathname);
  const Icon = roleConfig[role].icon;
  const base = `/${locale}/${role === "customer" ? "account" : role}`;
  const nav = role === "customer"
    ? [
        { href: base, label: dict.portal.overview, icon: LayoutDashboard },
        { href: `${base}/bookings`, label: dict.portal.bookings, icon: ClipboardCheck },
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
            { href: `${base}/verification/${pendingVerificationId}`, label: dict.portal.console, icon: ClipboardCheck },
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

  const isActive = (href: string) => (href === base ? pathname === href : pathname.startsWith(href));

  /* Revokes the refresh token on the server and drops every cached query before
     leaving, so the next person at this browser starts from nothing. */
  const leave = async () => {
    setNavOpen(false);
    await endSession();
    router.replace(localizedPath(locale));
  };

  const brand = (compact = false) => (
    <div className={cn("flex items-center gap-2.5", compact ? "p-0" : "p-5 lg:p-6")}>
      <span className="grid size-10 shrink-0 place-items-center rounded-[9px] bg-yellow-500 text-navy-950">
        <Wrench className="size-4" />
      </span>
      <div className="min-w-0">
        <p className="truncate font-bold text-white">{user ? `${user.firstName} ${user.lastName}`.trim() : dict.brand.name}</p>
        <p className="truncate text-xs text-white/55">{dict.portal[role]}</p>
      </div>
    </div>
  );

  const signOut = (
    <div className="border-t border-white/10 px-4 py-4">
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
      {/* Desktop: the same rail, pinned to the inline start. */}
      <aside className="sticky top-[var(--demo-bar-h,0px)] hidden h-[calc(100dvh-var(--demo-bar-h,0px))] flex-col border-e border-white/10 bg-navy-950 text-white lg:flex">
        <div className="border-b border-white/10">{brand()}</div>
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
        {signOut}
      </aside>

      <div className="min-w-0">
        {/* Mobile: a single top bar, and the rail becomes a drawer. */}
        <header className="sticky top-[var(--demo-bar-h,0px)] z-40 flex h-16 items-center gap-3 border-b border-line bg-white px-4 lg:hidden">
          <button
            type="button"
            onClick={() => setNavOpen(true)}
            aria-label={dict.nav.menu}
            aria-expanded={navOpen}
            className="grid size-11 shrink-0 place-items-center rounded-[9px] border border-line text-navy"
          >
            <Menu className="size-5" aria-hidden="true" />
          </button>
          <p className="flex min-w-0 items-center gap-2 text-sm font-semibold text-navy">
            <Icon className="size-4 shrink-0" aria-hidden="true" />
            <span className="truncate">{dict.portal[role]}</span>
          </p>
          <span className="ms-auto grid size-9 shrink-0 place-items-center rounded-full bg-navy text-white">
            <UserRound className="size-4" aria-hidden="true" />
          </span>
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
              <div className="flex items-center justify-between gap-2 border-b border-white/10 p-4">
                {brand(true)}
                <button
                  type="button"
                  onClick={() => setNavOpen(false)}
                  aria-label={dict.nav.close}
                  className="grid size-11 shrink-0 place-items-center rounded-[9px] border border-white/15"
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
              {signOut}
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
