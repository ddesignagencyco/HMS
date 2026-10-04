import { notFound } from "next/navigation";
import { AdminAppeals } from "@/features/portal/admin-ops-views";
import { getDictionary } from "@/lib/dictionaries";
import { isLocale } from "@/lib/utils";

export default async function AdminAppealsPage({ params }: { params: Promise<{ locale: string }> }) {
  const { locale } = await params;
  if (!isLocale(locale)) notFound();
  return <AdminAppeals locale={locale} dict={getDictionary(locale)} />;
}
