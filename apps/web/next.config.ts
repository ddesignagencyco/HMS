import type { NextConfig } from 'next';

/* Where the API process lives. Only the Next server reads this: the browser talks
   to this origin and the rewrite below forwards the call, which is what keeps the
   httpOnly refresh cookie same-origin.

   Declared in `apps/web/.env` as `API_ORIGIN`, alongside this app's own `PORT`.
   The two must stay apart — the API is on 3000 and this server is on 3001 — or the
   rewrite proxies every /api/v1 request into itself and the recursion ends in
   ECONNRESET on every /auth/me and /catalogue/* call. See BACKEND_REQUIREMENTS
   §0.1. `npm run dev:web` refuses to start if they ever match. */
const API_ORIGIN = process.env.API_ORIGIN ?? 'http://localhost:3000';

const nextConfig: NextConfig = {
  images: {
    remotePatterns: [
      {
        protocol: 'https',
        hostname: 'images.pexels.com',
        pathname: '/photos/**'
      }
    ]
  },
  /* The API sets its refresh cookie with Path=/api/v1/auth, SameSite=Lax and no
     Domain, so it is only replayed to requests under /api/v1/auth on the origin
     that received it. Proxying keeps the browser on one origin: a cross-origin
     API on another port would need this exact origin in CORS_ORIGINS, and that
     allow-list lives in the API's own environment, outside this app. */
  async rewrites() {
    return [{ source: '/api/v1/:path*', destination: `${API_ORIGIN}/api/v1/:path*` }];
  }
};

export default nextConfig;