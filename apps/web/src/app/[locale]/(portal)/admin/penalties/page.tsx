import { notFound } from "next/navigation";
import { AdminPenalties } from "@/features/admin/conduct-view";
import { getDictionary } from "@/lib/dictionaries";
import { isLocale } from "@/lib/utils";

export default async function AdminPenaltiesPage({ params }: { params: Promise<{ locale: string }> }) {
  const { locale } = await params;
  if (!isLocale(locale)) notFound();
  return <AdminPenalties locale={locale} dict={getDictionary(locale)} />;
}