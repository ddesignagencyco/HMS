import type { NextConfig } from 'next';

/* Where the API process lives. Only the Next server reads this: the browser talks
   to this origin and the rewrite below forwards the call, which is what keeps the
   httpOnly refresh cookie same-origin.

   Declared in `apps/web/.env` as `API_ORIGIN`, alongside this app's own `PORT`.
   The two must stay apart — the API is on 3000 and this server is on 3001 — or the
   rewrite proxies every /api/v1 request into itself and the recursion ends in
   ECONNRESET on every /auth/me and /catalogue/* call. See backend_requirement.md
   §0.1. `npm run dev:web` refuses to start if they ever match. */
const API_ORIGIN = process.env.API_ORIGIN ?? 'http://localhost:3000';

const nextConfig: NextConfig = {
  images: {
    remotePatterns: [
      {
        protocol: 'https',
        hostname: 'images.pexels.com',
        pathname: '/photos/**'
      },
      {
        protocol: 'https',
        hostname: 'res.cloudinary.com',
        pathname: '/**'
      }
    ]
  },
  /* The API sets its refresh cookie with Path=/api/v1/auth, SameSite=Lax and no
     Domain, so it is only replayed to requests under /api/v1/auth on the origin
     that received it. Proxying keeps the browser on one origin: a cross-origin
     API on another port would need this exact origin in CORS_ORIGINS, and that
     allow-list lives in the API's own environment, outside this app. */
  /* The API texts short links that do not match this app's page paths:
     `${PUBLIC_BASE_URL}/v/<token>` (verification-link.service.ts) and
     `${PUBLIC_BASE_URL}/problem/<token>` (notification.service.ts, the cash-receipt
     "report a problem" link). Config redirects run before `proxy.ts`, and each
     destination already carries a locale, so the proxy's locale prefixing never
     sees the short form and cannot loop. They also catch the receipt token, whose
     dot makes the proxy matcher skip it. Temporary (307): the short paths are the
     API's to change, not a permanent address. */
  async redirects() {
    return [
      { source: '/v/:token', destination: '/en/verification/:token', permanent: false },
      { source: '/:locale(en|ur)/v/:token', destination: '/:locale/verification/:token', permanent: false },
      { source: '/problem/:token', destination: '/en/receipt/:token', permanent: false },
      { source: '/:locale(en|ur)/problem/:token', destination: '/:locale/receipt/:token', permanent: false },
      /* Development payment simulator. The API's mock gateway sends the browser to
         `/api/v1/dev/payments/:id`, whose own HTML renders unstyled under the API's
         CSP. A *browser navigation* there (Accept includes text/html) is sent to the
         web's page instead; the page's own JSON fetch of the same URL is not matched,
         and neither is `/:id/complete`. The query (`returnUrl`) is passed through. */
      {
        source: '/api/v1/dev/payments/:paymentId',
        has: [{ type: 'header', key: 'accept', value: '(.*)text/html(.*)' }],
        destination: '/en/dev/pay/:paymentId',
        permanent: false
      }
    ];
  },
  async rewrites() {
    return [{ source: '/api/v1/:path*', destination: `${API_ORIGIN}/api/v1/:path*` }];
  }
};

export default nextConfig;