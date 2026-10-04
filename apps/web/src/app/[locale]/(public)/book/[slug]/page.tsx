import { notFound } from "next/navigation";
import { BookingFlow } from "@/features/booking/booking-flow";
import { RequireSession } from "@/components/require-session";
import { getDictionary } from "@/lib/dictionaries";
import { areas, getProvidersForService, getService, services } from "@/lib/data";
import { isLocale } from "@/lib/utils";

export function generateStaticParams() {
  return services.map((service) => ({ slug: service.slug }));
}

export default async function BookingPage({ params }: { params: Promise<{ locale: string; slug: string }> }) {
  const { locale, slug } = await params;
  if (!isLocale(locale)) notFound();
  const service = getService(slug);
  if (!service) notFound();
  return (
    <RequireSession locale={locale}>
      <BookingFlow locale={locale} dict={getDictionary(locale)} service={service} providers={getProvidersForService(service.slug)} areas={areas} />
    </RequireSession>
  );
}
