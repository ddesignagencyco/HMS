import { ArrowRight, CheckCircle2, CalendarClock, Repeat2, Sparkles } from "lucide-react";
import { notFound } from "next/navigation";
import Link from "next/link";
import { Container, PageBanner, Section, SectionHeader, buttonStyles } from "@/components/ui";
import { getDictionary } from "@/lib/dictionaries";
import { cn, formatMoney, isLocale, localizedPath } from "@/lib/utils";
import type { Metadata } from "next";
import { pageMetadata } from "@/lib/seo";

/* Tier data is structural, not copy: the label and every bullet come from the
   dictionary so both locales read naturally instead of interpolating an
   English fragment into an Urdu sentence. */
const tiers = [
  { id: "care", icon: CalendarClock, price: 4900, visits: 2, featured: false, points: ["Two visits a year", "One job per visit", "Same verified pro each time", "Plan balance releases per visit"] },
  { id: "plus", icon: CheckCircle2, price: 8900, visits: 4, featured: true, points: ["Four visits a year", "Priority booking slots", "Same verified pro each time", "Free call-out on every visit"] },
  { id: "cover", icon: Sparkles, price: 14900, visits: 6, featured: false, points: ["Six visits a year", "Emergency-eligible jobs included", "Priority booking slots", "Annual plumbing safety check"] },
] as const;

const stepOrder = ["choose", "schedule", "release"] as const;

export async function generateMetadata({ params }: { params: Promise<{ locale: string }> }): Promise<Metadata> {
  const { locale } = await params;
  const dict = getDictionary(isLocale(locale) ? locale : "en");
  return pageMetadata(locale, "/plans", `${dict.plansPage.titleLead} ${dict.plansPage.titleAccent}`, dict.plansPage.description);
}

export default async function PlansPage({ params }: { params: Promise<{ locale: string }> }) {
  const { locale } = await params;
  /* Every other page in this app 404s on an unknown locale; this one
     cannot, because the catalogue below is a client component that needs
     a `Locale` rather than a string. */
  if (locale !== 'en' && locale !== 'ur') notFound();
  return <PlansCatalogue locale={locale} />;
}