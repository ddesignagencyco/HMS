import { notFound } from "next/navigation";
import { AdminCustomers } from "@/features/portal/admin-customers";
import { getDictionary } from "@/lib/dictionaries";
import { isLocale } from "@/lib/utils";

export default async function AdminCustomersPage({ params }: { params: Promise<{ locale: string }> }) {
  const { locale } = await params;
  if (!isLocale(locale)) notFound();
  return <AdminCustomers locale={locale} dict={getDictionary(locale)} />;
}
