import { notFound } from "next/navigation";
import { VerificationConsole } from "@/features/portal/verification-console";
import { getDictionary } from "@/lib/dictionaries";
import { isLocale } from "@/lib/utils";

export default async function AgentVerificationPage({ params }: { params: Promise<{ locale: string; id: string }> }) {
  const { locale, id } = await params;
  if (!isLocale(locale)) notFound();
  return <VerificationConsole locale={locale} dict={getDictionary(locale)} verificationId={id} />;
}
