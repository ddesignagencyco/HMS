import { notFound } from "next/navigation";
import { ProviderProfileScreen } from "@/features/provider/profile-view";
import { getDictionary } from "@/lib/dictionaries";
import { isLocale } from "@/lib/utils";

export default async function ProviderProfilePage({ params }: { params: Promise<{ locale: string }> }) {
  const { locale } = await params;
  if (!isLocale(locale)) notFound();
  /* A client component: it reads `GET /provider/profile`, which the API resolves
     from the access token — there is no provider id in the route. */
  return <ProviderProfileScreen locale={locale} dict={getDictionary(locale)} />;
}