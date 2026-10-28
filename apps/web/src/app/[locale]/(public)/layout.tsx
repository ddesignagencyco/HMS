import { notFound } from "next/navigation";
import { getDictionary } from "@/lib/dictionaries";
import { isLocale } from "@/lib/utils";
import { SiteFooter } from "@/components/site-footer";
import { SiteHeader } from "@/components/site-header";

export default async function PublicLayout({ children, params }: { children: React.ReactNode; params: Promise<{ locale: string }> }) {
  const { locale } = await params;
  if (!isLocale(locale)) notFound();
  const dict = getDictionary(locale);

  /* The session is client state: the access token lives in memory and the
     refresh cookie is httpOnly, so only the browser can say who this is. Pages
     stay reachable without one, so a signed-out visitor is never walled out of
     the marketing site. */
  return (
    <div className="flex min-h-screen flex-col">
      <SiteHeader locale={locale} dict={dict} />
      <main className="flex-1">{children}</main>
      <SiteFooter locale={locale} dict={dict} />
    </div>
  );
}