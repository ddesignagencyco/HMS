import { notFound } from "next/navigation";
import { AdminApprovals } from "@/features/admin/approvals-view";
import { getDictionary } from "@/lib/dictionaries";
import { isLocale } from "@/lib/utils";

/* One professional, for review.
 *
 * The previous version of this page called `generateStaticParams()` over the mock
 * array in `src/lib/data.ts`, which meant it pre-rendered a page per *invented*
 * professional at build time. There is no admin provider-detail endpoint to read
 * per id, so this page scopes the same register down to the one id and states that
 * limitation rather than shipping a per-id route backed by made-up records.
 *
 * `force-dynamic` for the same reason the public provider profile has it: the list
 * is behind an admin bearer token, so it cannot be baked into a build. */

export const dynamic = "force-dynamic";

export default async function AdminProviderDetailPage({ params }: { params: Promise<{ locale: string; id: string }> }) {
  const { locale, id } = await params;
  if (!isLocale(locale)) notFound();
  return <AdminApprovals locale={locale} dict={getDictionary(locale)} providerId={id} />;
}