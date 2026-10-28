import { notFound } from "next/navigation";
import { AccountSecurityView } from "@/features/auth/account-security";
import { getDictionary } from "@/lib/dictionaries";
import { isLocale } from "@/lib/utils";

export default async function SecurityPage({ params }: { params: Promise<{ locale: string }> }) {
  const { locale } = await params;
  if (!isLocale(locale)) notFound();
  return <AccountSecurityView locale={locale} dict={getDictionary(locale)} />;
}
