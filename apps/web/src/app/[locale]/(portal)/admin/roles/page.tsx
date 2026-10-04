import { notFound } from "next/navigation";
import { AdminRoles } from "@/features/portal/admin-ops-views";
import { getDictionary } from "@/lib/dictionaries";
import { isLocale } from "@/lib/utils";

export default async function AdminRolesPage({ params }: { params: Promise<{ locale: string }> }) {
  const { locale } = await params;
  if (!isLocale(locale)) notFound();
  return <AdminRoles dict={getDictionary(locale)} />;
}
