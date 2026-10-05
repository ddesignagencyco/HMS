import { Clock, ExternalLink, Mail, MapPin, PhoneCall, Ticket } from "lucide-react";
import type { LucideIcon } from "lucide-react";
import { notFound } from "next/navigation";
import { PageBanner, Section } from "@/components/ui";
import { Container } from "@/components/ui/primitives";
import { getDictionary } from "@/lib/dictionaries";
import { isLocale } from "@/lib/utils";

/* Contact details for the deployment. Replace both before launch — the tel:
   and mailto: links below are wired to these values. */
const SUPPORT_PHONE = "+92 42 3577 0000";
const SUPPORT_EMAIL = "support@smarthome.pk";

const channelIcons: Record<string, LucideIcon> = {
  phone: PhoneCall,
  email: Mail,
  visit: MapPin,
};

export default async function ContactPage({ params }: { params: Promise<{ locale: string }> }) {
  const { locale } = await params;
  if (!isLocale(locale)) notFound();
  const dict = getDictionary(locale);

  return (
    <>
      <PageBanner
        eyebrow={dict.legal.contactEyebrow}
        title={dict.legal.contactTitle}
        description={dict.legal.contactIntro}
      />
      <Section size="default" tone="light">
        <Container>
          <div className="grid gap-4 sm:grid-cols-3">
            {Object.entries(dict.legal.contactChannels).map(([key, channel]) => {
              const Icon = channelIcons[key] ?? PhoneCall;
              return (
                <div key={channel.title} className="rounded-[14px] border border-line bg-white p-5 shadow-[0_4px_18px_rgba(15,23,42,0.04)]">
                  <span className="grid size-10 place-items-center rounded-[9px] bg-yellow-50 text-navy ring-1 ring-inset ring-yellow-500/25">
                    <Icon className="size-5" aria-hidden="true" />
                  </span>
                  <h2 className="mt-4 text-[17px] font-semibold tracking-[-0.025em] text-navy">{channel.title}</h2>
                  <p className="mt-2 text-sm leading-6 text-secondary">{channel.body}</p>
                </div>
              );
            })}
          </div>

          <div className="mt-6 grid gap-5 lg:grid-cols-2">
            {/* Both actions are real: the tel: and mailto: links are handled by
                the device, so this page never collects a form it cannot send. */}
            <div className="rounded-[14px] border border-line bg-white p-6">
              <h2 className="text-[19px] font-semibold tracking-[-0.025em] text-navy">{dict.legal.contactDirectTitle}</h2>
              <div className="mt-5 grid gap-3">
                <a
                  href={`tel:${SUPPORT_PHONE.replace(/\s/g, "")}`}
                  className="group flex items-center gap-3 rounded-[10px] border border-line p-4 transition-colors duration-200 hover:border-primary/40 hover:bg-blue-50"
                >
                  <span className="grid size-10 shrink-0 place-items-center rounded-[9px] bg-blue-50 text-primary-strong">
                    <PhoneCall className="size-5" aria-hidden="true" />
                  </span>
                  <span className="min-w-0">
                    <span className="block text-xs font-semibold uppercase tracking-[0.12em] text-muted">{dict.legal.contactHours}</span>
                    <span className="mt-0.5 block font-semibold text-navy" dir="ltr">{SUPPORT_PHONE}</span>
                  </span>
                </a>
                <a
                  href={`mailto:${SUPPORT_EMAIL}`}
                  className="group flex items-center gap-3 rounded-[10px] border border-line p-4 transition-colors duration-200 hover:border-primary/40 hover:bg-blue-50"
                >
                  <span className="grid size-10 shrink-0 place-items-center rounded-[9px] bg-blue-50 text-primary-strong">
                    <Mail className="size-5" aria-hidden="true" />
                  </span>
                  <span className="min-w-0">
                    <span className="block text-xs font-semibold uppercase tracking-[0.12em] text-muted">{dict.legal.contactChannels.email.title}</span>
                    <span className="mt-0.5 block truncate font-semibold text-navy" dir="ltr">{SUPPORT_EMAIL}</span>
                  </span>
                </a>
              </div>
            </div>

            <div className="rounded-[14px] border border-line bg-white p-6">
              <h2 className="text-[19px] font-semibold tracking-[-0.025em] text-navy">{dict.footer.support}</h2>
              <dl className="mt-4 grid gap-5 text-sm">
                <div className="flex items-start gap-3">
                  <Clock className="mt-0.5 size-4 shrink-0 text-primary" aria-hidden="true" />
                  <div>
                    <dt className="font-semibold text-navy">{dict.legal.contactHours}</dt>
                    <dd className="mt-0.5 text-secondary">{dict.legal.contactHoursValue}</dd>
                  </div>
                </div>
                <div className="flex items-start gap-3 border-t border-line pt-5">
                  <Ticket className="mt-0.5 size-4 shrink-0 text-primary" aria-hidden="true" />
                  <div>
                    <dt className="font-semibold text-navy">{dict.legal.contactReference}</dt>
                    <dd className="mt-0.5 text-secondary">{dict.legal.contactReferenceHint}</dd>
                  </div>
                </div>
                <div className="flex items-start gap-3 border-t border-line pt-5">
                  <ExternalLink className="mt-0.5 size-4 shrink-0 text-primary" aria-hidden="true" />
                  <div>
                    <dt className="font-semibold text-navy">{dict.nav.howWeVerify}</dt>
                    <dd className="mt-0.5 text-secondary">{dict.verifyPage.callHours}</dd>
                  </div>
                </div>
              </dl>
            </div>
          </div>
        </Container>
      </Section>
    </>
  );
}
