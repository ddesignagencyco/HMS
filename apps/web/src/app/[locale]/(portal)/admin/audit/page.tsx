import { notFound } from "next/navigation";
import { AdminAuditLog } from "@/features/admin/audit-view";
import { getDictionary } from "@/lib/dictionaries";
import { isLocale } from "@/lib/utils";

export default async function AdminAuditPage({ params }: { params: Promise<{ locale: string }> }) {
  const { locale } = await params;
  if (!isLocale(locale)) notFound();
  return <AdminAuditLog locale={locale} dict={getDictionary(locale)} />;
}