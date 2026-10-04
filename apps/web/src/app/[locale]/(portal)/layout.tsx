import { notFound } from "next/navigation";
import { WorkspaceShell } from "@/components/workspace-shell";
import { RequireSession } from "@/components/require-session";
import { getDictionary } from "@/lib/dictionaries";
import { isLocale } from "@/lib/utils";

export default async function PortalLayout({ children, params }: { children: React.ReactNode; params: Promise<{ locale: string }> }) {
  const { locale } = await params;
  if (!isLocale(locale)) notFound();
  return (
    <RequireSession locale={locale}>
      <WorkspaceShell locale={locale} dict={getDictionary(locale)}>{children}</WorkspaceShell>
    </RequireSession>
  );
}