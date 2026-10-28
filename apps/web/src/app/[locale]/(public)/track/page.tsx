import { notFound } from "next/navigation";
import { PageBanner, Container, Section } from "@/components/ui";
import { getDictionary } from "@/lib/dictionaries";
import { isLocale } from "@/lib/utils";
import { TrackBooking } from "@/features/discovery/track-booking";
import type { Metadata } from "next";
import { pageMetadata } from "@/lib/seo";

export async function generateMetadata({ params }: { params: Promise<{ locale: string }> }): Promise<Metadata> {
  const { locale } = await params;
  const dict = getDictionary(isLocale(locale) ? locale : "en");
  /* A utility page reached by typing a booking code: useful, but nothing to rank for. */
  return pageMetadata(locale, "/track", dict.trackPage.titleLead, dict.trackPage.description, { noindex: true });
}

export default async function TrackPage({ params }: { params: Promise<{ locale: string }> }) {
  const { locale } = await params;
  if (!isLocale(locale)) notFound();
  const dict = getDictionary(locale);

  return (
    <>
      <PageBanner
        eyebrow={dict.trackPage.eyebrow}
        title={dict.trackPage.titleLead}
        titleAccent={dict.trackPage.titleAccent}
        description={dict.trackPage.description}
        size="compact"
      />
      <Section tone="surface" size="default">
        <Container>
          {/* Reads the signed-in customer's own bookings from the API. It used to
              be handed a hardcoded array, which answered every code typed into
              it with an invented job. */}
          <TrackBooking locale={locale} dict={dict} />
        </Container>
      </Section>
    </>
  );
}
