import { notFound } from "next/navigation";
import { PageBanner, Section } from "@/components/ui";
import { Container } from "@/components/ui/primitives";
import { getDictionary } from "@/lib/dictionaries";
import { isLocale } from "@/lib/utils";
import type { Metadata } from "next";
import { pageMetadata } from "@/lib/seo";

export async function generateMetadata({ params }: { params: Promise<{ locale: string }> }): Promise<Metadata> {
  const { locale } = await params;
  const dict = getDictionary(isLocale(locale) ? locale : "en");
  return pageMetadata(locale, "/privacy", dict.legal.privacyTitle, dict.legal.privacyIntro);
}

export default async function PrivacyPage({ params }: { params: Promise<{ locale: string }> }) {
  const { locale } = await params;
  if (!isLocale(locale)) notFound();
  const dict = getDictionary(locale);

  return (
    <>
      <PageBanner
        eyebrow={dict.legal.privacyEyebrow}
        title={dict.legal.privacyTitle}
        description={dict.legal.privacyIntro}
      />
      <Section size="default" tone="light">
        <Container>
          <div className="grid gap-x-12 gap-y-9 lg:grid-cols-2">
            {Object.values(dict.legal.privacySections).map((section) => (
              <article key={section.title} className="border-t border-line pt-5">
                <h2 className="text-[19px] font-semibold tracking-[-0.025em] text-navy">{section.title}</h2>
                <p className="mt-2.5 text-pretty text-sm leading-7 text-secondary">{section.body}</p>
              </article>
            ))}
          </div>
        </Container>
      </Section>
    </>
  );
}
