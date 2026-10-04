import { notFound } from "next/navigation";
import { PageBanner, Container, Section, SectionHeader, Card, buttonStyles } from "@/components/ui";
import { AtmosphericBackground } from "@/components/layout/atmospheric-background";
import { getDictionary } from "@/lib/dictionaries";
import { isLocale, localizedPath } from "@/lib/utils";
import Link from "next/link";
import { ArrowRight, CalendarCheck, CheckCircle2, ClipboardList, MapPin, PhoneCall, ReceiptText, ShieldCheck, Sparkles } from "lucide-react";

const steps = [
  { icon: ClipboardList, step: "01", title: "You book and pay", body: "Choose the service, your area and a slot. Online payment is captured into escrow, never straight to the tradesman." },
  { icon: MapPin, step: "02", title: "The job runs", body: "Work starts only after a start OTP from your phone, with geofenced check-in and before photos on the record." },
  { icon: PhoneCall, step: "03", title: "We call you", body: "Completion puts the job in a verification queue. An agent calls you, or you confirm by one tap on a link." },
  { icon: CheckCircle2, step: "04", title: "Payment releases", body: "Only a passing outcome releases the money. Silence for 72 hours auto-releases it, and no rating is recorded." },
] as const;

const rules = [
  { icon: ShieldCheck, title: "Your rating only comes from a real call", body: "There is no in-app star form. A rating cannot exist without a verification record behind it." },
  { icon: ReceiptText, title: "The final bill can never exceed the quote", body: "Extra work needs a revised quote you approve first. The platform refunds any excess at release." },
  { icon: CalendarCheck, title: "An unreachable you never blocks a pro", body: "Three failed attempts across two bands hand the job back to an agent, and the link is sent exactly once." },
];

export default async function HowVerificationWorksPage({ params }: { params: Promise<{ locale: string }> }) {
  const { locale } = await params;
  if (!isLocale(locale)) notFound();
  const dict = getDictionary(locale);

  return (
    <>
      <PageBanner
        eyebrow={dict.verifyPage.eyebrow}
        title={dict.verifyPage.titleLead}
        titleAccent={dict.verifyPage.titleAccent}
        description={dict.verifyPage.description}
      />

      <Section tone="light" size="default">
        <Container>
          <SectionHeader variant="left" title={dict.verifyPage.whyTitle} description={dict.verifyPage.whyText} />
          <div className="header-gap grid gap-5 sm:grid-cols-2 lg:grid-cols-4">
            {steps.map(({ icon: Icon, step, title, body }) => (
              <Card key={step} className="relative flex h-full flex-col p-6">
                <span className="text-xs font-bold tracking-[0.16em] text-primary-strong tabular-nums">{step}</span>
                <span className="mt-4 grid size-11 place-items-center rounded-[10px] bg-blue-50 text-primary-strong">
                  <Icon className="size-5" aria-hidden="true" />
                </span>
                <h2 className="mt-4 text-[17px] font-semibold tracking-[-0.025em] text-navy">{title}</h2>
                <p className="mt-2 text-sm leading-6 text-secondary">{body}</p>
              </Card>
            ))}
          </div>
        </Container>
      </Section>

      <Section tone="dark" size="feature">
        <AtmosphericBackground variant="managed" />
        <Container className="relative">
          <SectionHeader
            variant="left"
            tone="dark"
            eyebrow={dict.verifyPage.rulesEyebrow}
            title={dict.verifyPage.rulesTitle}
            accentTone="dark"
          />
          <ul className="header-gap grid gap-5 lg:grid-cols-3">
            {rules.map(({ icon: Icon, title, body }) => (
              <li key={title} className="flex h-full flex-col rounded-[14px] border border-white/10 bg-white/[0.04] p-6">
                <span className="grid size-11 place-items-center rounded-[10px] bg-yellow-500/15 text-yellow-500">
                  <Icon className="size-5" aria-hidden="true" />
                </span>
                <h3 className="mt-4 text-[17px] font-semibold tracking-[-0.025em] text-white">{title}</h3>
                <p className="mt-2 text-sm leading-6 text-slate-300">{body}</p>
              </li>
            ))}
          </ul>

          <div className="mt-10 flex flex-wrap items-center gap-4 border-t border-white/12 pt-8">
            <Link href={localizedPath(locale, "/track")} className={buttonStyles({ variant: "accent", className: "group lift-sm" })}>
              <ReceiptText className="size-4" aria-hidden="true" />
              {dict.trackPage.submit}
            </Link>
            <p className="text-sm text-slate-400">{dict.verifyPage.callHours}</p>
          </div>
        </Container>
      </Section>

      {/* the same contained conversion moment the homepage closes on */}
      <Section tone="light" size="default">
        <Container>
          <div className="relative isolate overflow-hidden rounded-[20px] bg-navy-950 px-6 py-12 text-center text-white sm:px-12 sm:py-14">
            <div className="pointer-events-none absolute inset-0 -z-10 bg-[radial-gradient(58%_78%_at_50%_0%,rgba(37,99,235,0.32),transparent_68%)]" />
            <div className="relative mx-auto flex max-w-2xl flex-col items-center">
              <h2 className="title-lead text-white">
                {dict.verifyPage.ctaTitle}
              </h2>
              <p className="mt-4 max-w-xl text-pretty text-base leading-7 text-slate-300">{dict.verifyPage.ctaText}</p>
              <div className="mt-8 flex w-full flex-col items-center gap-3 sm:w-auto sm:flex-row sm:justify-center">
                <Link
                  href={localizedPath(locale, "/services")}
                  className={buttonStyles({ variant: "accent", size: "lg", className: "group w-full sm:w-auto" })}
                >
                  <Sparkles className="size-4" aria-hidden="true" />
                  {dict.nav.bookService}
                  <ArrowRight className="size-4 arrow-slide rtl:rotate-180" aria-hidden="true" />
                </Link>
                <Link
                  href={localizedPath(locale, "/plans")}
                  className={buttonStyles({ variant: "outline-light", size: "lg", className: "w-full sm:w-auto" })}
                >
                  {dict.nav.plans}
                </Link>
              </div>
            </div>
          </div>
        </Container>
      </Section>
    </>
  );
}
