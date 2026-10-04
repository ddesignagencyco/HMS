import { notFound } from "next/navigation";
import { ProfileView } from "@/features/portal/customer-views";
import { getDictionary } from "@/lib/dictionaries";
import { isLocale } from "@/lib/utils";

export default async function ProfilePage({ params }: { params: Promise<{ locale: string }> }) {
  const { locale } = await params;
  if (!isLocale(locale)) notFound();
  return <ProfileView dict={getDictionary(locale)} />;
}
