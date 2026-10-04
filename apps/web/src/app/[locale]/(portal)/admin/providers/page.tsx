import { notFound } from "next/navigation";
import { AdminProviders } from "@/features/portal/staff-views";
import { getDictionary } from "@/lib/dictionaries";
import { isLocale } from "@/lib/utils";

export default async function AdminProvidersPage({ params }: { params: Promise<{ locale: string }> }) {
  const { locale } = await params;
  if (!isLocale(locale)) notFound();
  return <AdminProviders locale={locale} dict={getDictionary(locale)} />;
}
