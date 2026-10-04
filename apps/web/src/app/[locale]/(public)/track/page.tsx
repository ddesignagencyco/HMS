import { notFound } from "next/navigation";
import { PageBanner, Container, Section } from "@/components/ui";
import { getDictionary } from "@/lib/dictionaries";
import { bookings } from "@/lib/data";
import { isLocale } from "@/lib/utils";
import { TrackBooking } from "@/features/discovery/track-booking";

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
          <TrackBooking locale={locale} dict={dict} bookings={bookings} />
        </Container>
      </Section>
    </>
  );
}
