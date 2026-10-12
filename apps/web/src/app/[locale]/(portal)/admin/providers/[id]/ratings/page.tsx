import { notFound } from "next/navigation";
import { AdminProviderRatings } from "@/features/admin/provider-ratings";
import { getDictionary } from "@/lib/dictionaries";
import { isLocale } from "@/lib/utils";

/* One professional's ratings, for moderation.
 *
 * This route exists because the *public* remarks list filters
 * `is_published = true`, so an unpublished remark cannot be seen there and
 * therefore cannot be un-unpublished from there either. This is the only screen
 * that has both `remarkId` and `unpublishedReason`, and so the only one that can
 * call `POST /admin/remarks/:id/unpublish`.
 *
 * `force-dynamic` for the same reason as `/admin/providers/[id]`: the read is
 * behind an admin bearer token and cannot be baked into a build. */
export const dynamic = "force-dynamic";

export default async function AdminProviderRatingsPage({
  params
}: {
  params: Promise<{ locale: string; id: string }>;
}) {
  const { locale, id } = await params;
  if (!isLocale(locale)) notFound();
  return <AdminProviderRatings providerId={id} locale={locale} dict={getDictionary(locale)} />;
}