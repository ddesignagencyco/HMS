import { ArrowRight, CheckCircle2, CalendarClock, Repeat2, Sparkles } from "lucide-react";
import { notFound } from "next/navigation";
import Link from "next/link";
import { Container, PageBanner, Section, SectionHeader, buttonStyles } from "@/components/ui";
import { getDictionary } from "@/lib/dictionaries";
import { cn, formatMoney, isLocale, localizedPath } from "@/lib/utils";

/* Tier data is structural, not copy: the label and every bullet come from the
   dictionary so both locales read naturally instead of interpolating an
   English fragment into an Urdu sentence. */
const tiers = [
  { id: "care", icon: CalendarClock, price: 4900, visits: 2, featured: false, points: ["Two visits a year", "One job per visit", "Same verified pro each time", "Plan balance releases per visit"] },
  { id: "plus", icon: CheckCircle2, price: 8900, visits: 4, featured: true, points: ["Four visits a year", "Priority booking slots", "Same verified pro each time", "Free call-out on every visit"] },
  { id: "cover", icon: Sparkles, price: 14900, visits: 6, featured: false, points: ["Six visits a year", "Emergency-eligible jobs included", "Priority booking slots", "Annual plumbing safety check"] },
] as const;

const stepOrder = ["choose", "schedule", "release"] as const;

export default async function PlansPage({ params }: { params: Promise<{ locale: string }> }) {
  const { locale } = await params;
  if (!isLocale(locale)) notFound();
  const dict = getDictionary(locale);

  return (
    <>
      <PageBanner
        eyebrow={dict.plansPage.eyebrow}
        title={dict.plansPage.titleLead}
        titleAccent={dict.plansPage.titleAccent}
        description={dict.plansPage.description}
      />

      {/* Tiers lead. The banner already states the offer, so the first band
          goes straight to the cards instead of repeating the same heading. */}
      <Section tone="light" size="feature">
        <Container>
          <div className="grid gap-5 lg:grid-cols-3">
            {tiers.map(({ icon: Icon, id, price, visits, featured, points }) => (
              <div
                key={id}
                className={cn(
                  "relative flex h-full flex-col rounded-[14px] bg-white p-6 ring-1 transition-transform duration-200 ease-[cubic-bezier(0.22,1,0.36,1)] hover:-translate-y-[3px]",
                  featured ? "ring-2 ring-primary" : "ring-navy/[0.06]",
                )}
              >
                {featured ? (
                  <span className="absolute -top-3 start-6 rounded-full bg-primary px-3 py-1 text-[11px] font-bold uppercase tracking-[0.1em] text-white">
                    {dict.plansPage.popular}
                  </span>
                ) : null}
                <span className="grid size-11 place-items-center rounded-[10px] bg-blue-50 text-primary-strong">
                  <Icon className="size-5" aria-hidden="true" />
                </span>
                <h2 className="mt-4 text-[19px] font-semibold tracking-[-0.03em] text-navy">{dict.plansPage.names[id]}</h2>
                <p className="mt-3 flex items-baseline gap-2">
                  <strong className="text-[32px] font-semibold tracking-[-0.04em] text-navy tabular-nums">
                    {formatMoney(price * 100, locale)}
                  </strong>
                  <span className="text-sm text-muted">{dict.plansPage.perYear}</span>
                </p>
                <p className="mt-1 text-sm text-secondary">
                  {visits} {dict.plansPage.visits} · {dict.plansPage.everySixMonths}
                </p>
                <ul className="mt-6 grid gap-2.5">
                  {points.map((point) => (
                    <li key={point} className="flex items-start gap-2.5 text-sm leading-6 text-secondary">
                      <CheckCircle2 className="mt-0.5 size-4 shrink-0 text-emerald-600" aria-hidden="true" />
                      {dict.plansPage.points[point] ?? point}
                    </li>
                  ))}
                </ul>
                <Link
                  href={localizedPath(locale, "/auth/register")}
                  className={buttonStyles({ variant: featured ? "primary" : "secondary", className: "mt-8 w-full" })}
                >
                  {dict.plansPage.choose}
                </Link>
              </div>
            ))}
          </div>
          <p className="mt-6 text-sm text-muted">{dict.plansPage.coverageNote}</p>
        </Container>
      </Section>

      {/* How it works sits on its own light band, so the two navy fields
          never stack into one flat mass. */}
      <Section tone="surface" size="default">
        <Container>
          <div className="grid gap-10 lg:grid-cols-[minmax(0,0.85fr)_minmax(0,1.15fr)] lg:items-center lg:gap-16">
            <div>
              <SectionHeader
                variant="left"
                eyebrow={dict.plansPage.howEyebrow}
                title={dict.plansPage.howTitle}
                description={dict.plansPage.howText}
              />
              <Link href={localizedPath(locale, "/services")} className={buttonStyles({ variant: "secondary", className: "group mt-7" })}>
                <Repeat2 className="size-4" aria-hidden="true" />
                {dict.home.browseServices}
                <ArrowRight className="size-4 arrow-slide rtl:rotate-180" aria-hidden="true" />
              </Link>
            </div>
            <ol className="grid gap-3">
              {stepOrder.map((key, index) => (
                <li key={key} className="flex gap-4 rounded-[12px] border border-line bg-white p-5">
                  <span className="grid size-8 shrink-0 place-items-center rounded-full bg-navy text-[13px] font-semibold text-white tabular-nums">
                    {index + 1}
                  </span>
                  <div>
                    <h3 className="text-[16px] font-semibold tracking-[-0.02em] text-navy">{dict.plansPage.steps[key].title}</h3>
                    <p className="mt-1.5 text-sm leading-6 text-secondary">{dict.plansPage.steps[key].text}</p>
                  </div>
                </li>
              ))}
            </ol>
          </div>
        </Container>
      </Section>

      <Section tone="light" size="feature">
        <Container>
          <div className="relative isolate overflow-hidden rounded-[20px] bg-navy-950 px-6 py-14 text-center text-white sm:px-12 sm:py-16">
            <div className="pointer-events-none absolute inset-0 -z-10 bg-[radial-gradient(58%_78%_at_50%_0%,rgba(37,99,235,0.32),transparent_68%)]" />
            <div className="relative mx-auto flex max-w-2xl flex-col items-center">
              <p className="eyebrow eyebrow-dark justify-center">{dict.plansPage.ctaEyebrow}</p>
              <h2 className="title-page mt-5 text-white">
                {dict.plansPage.ctaTitleLead} <span className="text-yellow-500">{dict.plansPage.ctaTitleAccent}</span>
              </h2>
              <p className="mt-5 max-w-xl text-pretty text-base leading-7 text-slate-300">{dict.plansPage.ctaDescription}</p>
              <div className="mt-9 flex w-full flex-col items-center gap-3 sm:w-auto sm:flex-row sm:justify-center">
                <Link href={localizedPath(locale, "/auth/register")} className={buttonStyles({ variant: "accent", size: "lg", className: "group w-full sm:w-auto" })}>
                  {dict.plansPage.ctaPrimary}
                  <ArrowRight className="size-4 arrow-slide rtl:rotate-180" aria-hidden="true" />
                </Link>
                <Link href={localizedPath(locale, "/services")} className={buttonStyles({ variant: "outline-light", size: "lg", className: "w-full sm:w-auto" })}>
                  {dict.plansPage.ctaSecondary}
                </Link>
              </div>
            </div>
          </div>
        </Container>
      </Section>
    </>
  );
}
