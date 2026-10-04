import { notFound } from "next/navigation";
import { AdminProviderDetail } from "@/features/portal/staff-views";
import { getDictionary } from "@/lib/dictionaries";
import { providers } from "@/lib/data";
import { isLocale } from "@/lib/utils";

export function generateStaticParams() {
  return providers.map((provider) => ({ id: provider.id }));
}

export default async function AdminProviderDetailPage({ params }: { params: Promise<{ locale: string; id: string }> }) {
  const { locale, id } = await params;
  if (!isLocale(locale)) notFound();
  return <AdminProviderDetail locale={locale} dict={getDictionary(locale)} id={id} />;
}
