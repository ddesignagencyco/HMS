import type { MetadataRoute } from "next";
import { SITE_URL } from "@/lib/seo";

/**
 * Crawl rules.
 *
 * The portal and the auth screens are private, so they are disallowed rather
 * than merely left out of the sitemap — a link from a public page (a booking deep
 * link, a shared tracking link) would otherwise invite a crawler into them. The
 * API is a different origin entirely and is not described here.
 *
 * `/receipt` is here for a stronger reason than the rest. **The token in a
 * receipt link is the credential** - `POST /complaints/from-receipt` is
 * `@Public()` so the link works with no account, and a crawler that fetched one
 * would get a working "raise a complaint against this booking" link indexed and
 * cached where anybody could find it. The page publishes `noindex` in its own
 * metadata too; this is the belt to that braces.
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
          "/receipt",
          "/api"
        ]
      }
    ],
    sitemap: `${SITE_URL}/sitemap.xml`,
    host: SITE_URL
  };
}
