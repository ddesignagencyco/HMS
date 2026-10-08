import { notFound } from "next/navigation";
import { WorkspaceShell } from "@/components/workspace-shell";
import { RequireSession } from "@/components/require-session";
import { getDictionary } from "@/lib/dictionaries";
import { isLocale } from "@/lib/utils";

/* Everything behind the sign-in wall: a customer's bookings and addresses, a
   professional's jobs and earnings, the finance ledger, the admin console. None of
   it belongs in a search index, and a deep link shared into one — a booking
   confirmation, a job for a professional — should not invite a crawler in. Set
   once here rather than on fifty pages. */
export const metadata = {
  robots: { index: false, follow: false, nocache: true }
};

export default async function PortalLayout({ children, params }: { children: React.ReactNode; params: Promise<{ locale: string }> }) {
  const { locale } = await params;
  if (!isLocale(locale)) notFound();
  return (
    <RequireSession locale={locale}>
      <WorkspaceShell locale={locale} dict={getDictionary(locale)}>{children}</WorkspaceShell>
    </RequireSession>
  );
}