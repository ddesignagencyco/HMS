import type { MetadataRoute } from "next";
import { SITE_URL } from "@/lib/seo";

/**
 * Crawl rules.
 *
 * The portal and the auth screens are private, so they are disallowed rather
 * than merely left out of the sitemap — a link from a public page (a booking deep
 * link, a shared tracking link) would otherwise invite a crawler into them. The
 * API is a different origin entirely and is not described here.
 */
export default function robots(): MetadataRoute.Robots {
  return {
    rules: [
      {
        userAgent: "*",
        allow: "/",
        disallow: [
          "/admin",
          "/account",
          "/provider",
          "/finance",
          "/agent",
          "/auth",
          "/checkout",
          "/verification",
          "/api"
        ]
      }
    ],
    sitemap: `${SITE_URL}/sitemap.xml`,
    host: SITE_URL
  };
}
