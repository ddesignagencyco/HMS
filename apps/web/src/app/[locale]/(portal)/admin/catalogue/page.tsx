import { notFound } from "next/navigation";
import { AdminCatalogue } from "@/features/portal/admin-workspace-views";
import { getDictionary } from "@/lib/dictionaries";
import { isLocale } from "@/lib/utils";

export default async function AdminCataloguePage({ params }: { params: Promise<{ locale: string }> }) {
  const { locale } = await params;
  if (!isLocale(locale)) notFound();
  return <AdminCatalogue locale={locale} dict={getDictionary(locale)} />;
}
