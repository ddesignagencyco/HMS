import { notFound } from "next/navigation";
import { AgentAttempts } from "@/features/portal/admin-ops-views";
import { getDictionary } from "@/lib/dictionaries";
import { isLocale } from "@/lib/utils";

export default async function AgentAttemptsPage({ params }: { params: Promise<{ locale: string }> }) {
  const { locale } = await params;
  if (!isLocale(locale)) notFound();
  return <AgentAttempts locale={locale} dict={getDictionary(locale)} />;
}
