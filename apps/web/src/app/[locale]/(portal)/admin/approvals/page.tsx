import { notFound } from "next/navigation";
import { AdminApprovals } from "@/features/portal/admin-workspace-views";
import { getDictionary } from "@/lib/dictionaries";
import { isLocale } from "@/lib/utils";

export default async function AdminApprovalsPage({ params }: { params: Promise<{ locale: string }> }) {
  const { locale } = await params;
  if (!isLocale(locale)) notFound();
  return <AdminApprovals locale={locale} dict={getDictionary(locale)} />;
}
