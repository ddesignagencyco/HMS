import { notFound } from "next/navigation";
import { AdminComplaints } from "@/features/admin/complaints-view";
import { getDictionary } from "@/lib/dictionaries";
import { isLocale } from "@/lib/utils";

export default async function AdminComplaintsPage({ params }: { params: Promise<{ locale: string }> }) {
  const { locale } = await params;
  if (!isLocale(locale)) notFound();
  return <AdminComplaints locale={locale} dict={getDictionary(locale)} />;
}