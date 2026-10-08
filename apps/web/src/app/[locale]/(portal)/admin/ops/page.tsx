import { notFound } from "next/navigation";
import { AdminOps } from "@/features/admin/ops-view";
import { getDictionary } from "@/lib/dictionaries";
import { isLocale } from "@/lib/utils";

export default async function AdminOpsPage({ params }: { params: Promise<{ locale: string }> }) {
  const { locale } = await params;
  if (!isLocale(locale)) notFound();
  return <AdminOps locale={locale} dict={getDictionary(locale)} />;
}