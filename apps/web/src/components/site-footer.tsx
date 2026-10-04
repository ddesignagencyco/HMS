import { BadgeCheck, ShieldCheck } from "lucide-react";
import Link from "next/link";
import type { Dictionary } from "@/lib/dictionaries";
import { localizedPath, type Locale } from "@/lib/utils";
import { Container } from "@/components/ui";
import { BrandMark } from "@/components/brand-mark";

export function SiteFooter({ locale, dict }: { locale: Locale; dict: Dictionary }) {
  const columns = [
    {
      title: dict.footer.services,
      links: [
        { label: dict.nav.services, href: localizedPath(locale, "/services") },
        { label: dict.nav.professionals, href: localizedPath(locale, "/providers") },
        { label: dict.nav.plans, href: localizedPath(locale, "/plans") },
      ],
    },
    {
      title: dict.footer.company,
      links: [
        { label: dict.nav.howWeVerify, href: localizedPath(locale, "/how-verification-works") },
        { label: dict.portal.customer, href: localizedPath(locale, "/account") },
        { label: dict.portal.provider, href: localizedPath(locale, "/provider") },
      ],
    },
    {
      title: dict.footer.support,
      links: [
        { label: dict.trackPage.titleLead, href: localizedPath(locale, "/track") },
        { label: dict.portal.bookings, href: localizedPath(locale, "/account/bookings") },
        { label: dict.footer.contact, href: localizedPath(locale, "/contact") },
      ],
    },
  ];

  return (
    <footer className="relative overflow-hidden bg-navy text-white">
      <div aria-hidden="true" className="pointer-events-none absolute inset-0">
        <div
          className="absolute inset-0"
          style={{ background: "radial-gradient(52% 60% at 78% 8%, rgba(37,99,235,0.16), transparent 64%)" }}
        />
      </div>

      <Container className="relative grid gap-12 py-16 md:grid-cols-[1.1fr_1.9fr] md:gap-16">
        <div>
          <Link href={localizedPath(locale)} className="inline-flex items-center gap-2.5">
            <BrandMark tone="light" />
            <span className="text-[15px] font-bold tracking-[-0.03em] text-white">{dict.brand.name}</span>
          </Link>
          <p className="mt-5 max-w-sm text-sm leading-6 text-slate-300">{dict.footer.about}</p>
          <div className="mt-6 flex flex-wrap items-center gap-x-5 gap-y-3 text-sm">
            <span className="inline-flex items-center gap-2 text-slate-300">
              <BadgeCheck className="size-4 text-yellow-500" aria-hidden="true" />
              {dict.providers.verified}
            </span>
            <span className="inline-flex items-center gap-2 text-slate-300">
              <ShieldCheck className="size-4 text-yellow-500" aria-hidden="true" />
              {dict.home.trustTwo}
            </span>
          </div>
        </div>

        <div className="grid grid-cols-2 gap-8 sm:grid-cols-3">
          {columns.map((column) => (
            <div key={column.title}>
              <h2 className="text-[11px] font-bold uppercase tracking-[0.16em] text-slate-400">{column.title}</h2>
              <ul className="mt-4 grid gap-3 text-sm">
                {column.links.map((link) => (
                  <li key={link.label}>
                    <Link href={link.href} className="text-slate-300 transition-colors duration-200 hover:text-white">
                      {link.label}
                    </Link>
                  </li>
                ))}
              </ul>
            </div>
          ))}
        </div>
      </Container>

      <Container className="relative flex flex-col gap-3 border-t border-white/10 py-6 text-xs text-slate-400 sm:flex-row sm:items-center sm:justify-between">
        <p>
          © 2026 {dict.brand.name}. {dict.footer.rights}
        </p>
        <div className="flex gap-5">
          <Link href={localizedPath(locale, "/privacy")} className="transition-colors duration-200 hover:text-white">{dict.footer.privacy}</Link>
          <Link href={localizedPath(locale, "/terms")} className="transition-colors duration-200 hover:text-white">{dict.footer.terms}</Link>
        </div>
      </Container>
    </footer>
  );
}
