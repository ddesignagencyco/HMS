import { notFound } from "next/navigation";
import { SignOutScreen } from "@/features/auth/sign-out-screen";
import { getDictionary } from "@/lib/dictionaries";
import { isLocale } from "@/lib/utils";

/* Sign-out is a route so it works from a plain link or a redirect. The work
   happens in the client screen, which calls `POST /auth/logout` through the
   session — the refresh cookie is httpOnly and only the API can revoke it. */
export default async function SignOutPage({ params }: { params: Promise<{ locale: string }> }) {
  const { locale } = await params;
  if (!isLocale(locale)) notFound();
  return <SignOutScreen locale={locale} dict={getDictionary(locale)} />;
}
