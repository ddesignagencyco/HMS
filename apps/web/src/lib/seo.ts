import type { Metadata } from "next";
import type { MetadataRoute } from "next";
import { locales } from "@/lib/utils";

/* The canonical origin, in one place.
   `sitemap.ts` and `robots.ts` both need it and neither can read `NEXT_PUBLIC_*`
   reliably at the moment they run, so it is derived once here. Override with
   `SITE_URL` in the environment; the fallback is the production host. */
export const SITE_URL = (process.env.SITE_URL ?? "https://smart-home.local").replace(/\/+$/, "");

/** Every public path this app can be indexed at, in both locales. */
const PUBLIC_PATHS = [
  "/",
  "/services",
  "/plans",
  "/providers",
  "/how-verification-works",
  "/track",
  "/contact",
  "/terms",
  "/privacy"
] as const;

/**
 * Dynamic public routes that exist but are not listed.
 *
 * `/services/[slug]`, `/providers/[providerId]`, `/book/[slug]` and
 * `/verification/[token]` are all real pages. The catalogue and provider lists
 * live in the API rather than in the bundle, so their URLs are not known when
 * this file runs. They are reachable and crawlable — every one links from a page
 * that is in this sitemap — and they carry their own `generateMetadata`. A
 * verification token is per-booking and must not be listed at all.
 */
export const sitemap = (): MetadataRoute.Sitemap => {
  const now = new Date();
  return locales.flatMap((locale) =>
    PUBLIC_PATHS.map((path) => ({
      url: `${SITE_URL}/${locale}${path === "/" ? "" : path}`,
      lastModified: now,
      /* English is the reference; Urdu is the same page in another language, so
         each entry points at the other rather than competing with it. */
      alternates: {
        languages: Object.fromEntries(locales.map((other) => [other, `${SITE_URL}/${other}${path === "/" ? "" : path}`]))
      },
      changeFrequency: (path === "/" ? "weekly" : "monthly") as "weekly" | "monthly",
      priority: path === "/" ? 1 : path === "/services" || path === "/providers" ? 0.8 : 0.5
    }))
  );
};

/**
 * Per-page title and description, with the canonical URL and both language
 * alternates filled in.
 *
 * Every public page needs its own title: the layout's title is the brand
 * tagline, so a page that publishes nothing of its own is indexed under the same
 * name as the home page and every other page sharing it. The alternates are here
 * rather than per page because forgetting them on one page is how a bilingual
 * site ends up competing with itself.
 */
export const pageMetadata = (
  locale: string,
  path: string,
  title: string,
  description: string,
  options: { noindex?: boolean } = {}
): Metadata => {
  const suffix = path === "/" ? "" : path;
  const canonical = `/${locale}${suffix}`;
  return {
    title,
    description,
    alternates: {
      canonical,
      languages: Object.fromEntries(locales.map((other) => [other, `/${other}${suffix}`]))
    },
    openGraph: { title, description, url: canonical, type: "website" },
    twitter: { card: "summary", title, description },
    robots: options.noindex === true ? { index: false, follow: false } : { index: true, follow: true }
  };
};
