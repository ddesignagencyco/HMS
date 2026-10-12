import type { Metadata } from "next";
import { Geist, Noto_Nastaliq_Urdu } from "next/font/google";
import { notFound } from "next/navigation";
import "../globals.css";
import { getDictionary } from "@/lib/dictionaries";
import { SITE_URL } from "@/lib/seo";
import { isLocale, locales } from "@/lib/utils";
import { Providers } from "./providers";

const geist = Geist({ variable: "--font-geist-sans", subsets: ["latin"] });
const urdu = Noto_Nastaliq_Urdu({ variable: "--font-urdu", subsets: ["arabic"], display: "swap" });

export const generateStaticParams = () => locales.map((locale) => ({ locale }));

export async function generateMetadata({ params }: { params: Promise<{ locale: string }> }): Promise<Metadata> {
  const { locale } = await params;
  const dict = isLocale(locale) ? getDictionary(locale) : getDictionary("en");
  const path = `/${locale}`;

  return {
    /* Without this every relative OG and canonical URL is dropped when the app is
       served from anything other than localhost. */
    metadataBase: new URL(SITE_URL),
    title: { default: dict.brand.tagline, template: `%s | ${dict.brand.name}` },
    description: dict.home.description,
    applicationName: dict.brand.name,
    /* English and Urdu are the same page in two languages, not two pages. This is
       what tells a search engine to keep one result and offer the other, instead of
       of indexing both and splitting the ranking between them. */
    alternates: {
      canonical: path,
      languages: Object.fromEntries(locales.map((other) => [other, `/${other}`]))
    },
    openGraph: {
      type: "website",
      siteName: dict.brand.name,
      locale: locale === "ur" ? "ur_PK" : "en_PK",
      alternateLocale: locale === "ur" ? "en_PK" : "ur_PK",
      title: dict.brand.tagline,
      description: dict.home.description,
      url: path,
      images: [{ url: "/brand/logo_tp.png", width: 1200, height: 630, alt: dict.brand.name }]
    },
    twitter: {
      card: "summary_large_image",
      title: dict.brand.tagline,
      description: dict.home.description,
      images: ["/brand/logo_tp.png"]
    },
    icons: {
      icon: [{ url: "/favicon.png", type: "image/png" }],
      apple: [{ url: "/brand/logo.png" }]
    },
    manifest: "/manifest.webmanifest",
    /* This is the fallback for pages that publish no metadata of their own; the
       private areas override it to noindex in their own layout. */
    robots: { index: true, follow: true }
  };
}

export default async function LocaleLayout({
  children,
  params,
}: {
  children: React.ReactNode;
  params: Promise<{ locale: string }>;
}) {
  const { locale } = await params;
  if (!isLocale(locale)) notFound();

  return (
    <html lang={locale} dir={locale === "ur" ? "rtl" : "ltr"} className={`${geist.variable} ${urdu.variable}`}>
      <body className="min-h-screen antialiased">
        <Providers locale={locale}>
          {children}
        </Providers>
      </body>
    </html>
  );
}
