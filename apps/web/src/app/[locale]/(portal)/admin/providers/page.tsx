import { notFound } from "next/navigation";
import { AdminApprovals } from "@/features/admin/approvals-view";
import { getDictionary } from "@/lib/dictionaries";
import { isLocale } from "@/lib/utils";

/* The professional register.
 *
 * This route and `/admin/approvals` render the same screen, and that is the honest
 * arrangement rather than a shortcut: the only route that enumerates professionals
 * is `GET /admin/users?role=PROVIDER`, and it publishes `user_status` but not
 * `provider_status`. So an approvals queue that could be filtered to "awaiting
 * decision" cannot be built, and a register that could not be filtered to the same
 * set would be the same list with a different title. */

export default async function AdminProvidersPage({ params }: { params: Promise<{ locale: string }> }) {
  const { locale } = await params;
  if (!isLocale(locale)) notFound();
  return <AdminApprovals locale={locale} dict={getDictionary(locale)} />;
}