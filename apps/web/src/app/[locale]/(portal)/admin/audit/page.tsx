import { notFound } from "next/navigation";
import { AdminAudit } from "@/features/portal/admin-workspace-views";
import { getDictionary } from "@/lib/dictionaries";
import { isLocale } from "@/lib/utils";

export default async function AdminAuditPage({ params }: { params: Promise<{ locale: string }> }) {
  const { locale } = await params;
  if (!isLocale(locale)) notFound();
  return <AdminAudit dict={getDictionary(locale)} />;
}
