import { notFound } from "next/navigation";
import { AdminTemplates } from "@/features/admin/templates-view";
import { getDictionary } from "@/lib/dictionaries";
import { isLocale } from "@/lib/utils";

export default async function AdminTemplatesPage({ params }: { params: Promise<{ locale: string }> }) {
  const { locale } = await params;
  if (!isLocale(locale)) notFound();
  return <AdminTemplates locale={locale} dict={getDictionary(locale)} />;
}