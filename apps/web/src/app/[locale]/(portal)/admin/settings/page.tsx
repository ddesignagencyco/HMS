import { notFound } from "next/navigation";
import { AdminSettings } from "@/features/admin/settings-view";
import { getDictionary } from "@/lib/dictionaries";
import { isLocale } from "@/lib/utils";

export default async function AdminSettingsPage({ params }: { params: Promise<{ locale: string }> }) {
  const { locale } = await params;
  if (!isLocale(locale)) notFound();
  return <AdminSettings locale={locale} dict={getDictionary(locale)} />;
}