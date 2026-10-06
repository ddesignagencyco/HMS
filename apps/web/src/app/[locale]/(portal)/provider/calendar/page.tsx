import { notFound } from "next/navigation";
import { ProviderCalendarScreen } from "@/features/provider/calendar-view";
import { getDictionary } from "@/lib/dictionaries";
import { isLocale } from "@/lib/utils";

export default async function ProviderCalendarPage({ params }: { params: Promise<{ locale: string }> }) {
  const { locale } = await params;
  if (!isLocale(locale)) notFound();
  return <ProviderCalendarScreen locale={locale} dict={getDictionary(locale)} />;
}
