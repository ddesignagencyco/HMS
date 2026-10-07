import { notFound } from "next/navigation";
import { AdminDisputes } from "@/features/admin/disputes-view";
import { getDictionary } from "@/lib/dictionaries";
import { isLocale } from "@/lib/utils";

export default async function AdminDisputesPage({ params }: { params: Promise<{ locale: string }> }) {
  const { locale } = await params;
  if (!isLocale(locale)) notFound();
  return <AdminDisputes locale={locale} dict={getDictionary(locale)} />;
}