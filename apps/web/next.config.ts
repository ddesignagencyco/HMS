import type { NextConfig } from 'next';

/* Where the API process lives. Only the Next server ever reads this: the browser
   talks to this origin and the rewrite below forwards the call, which is what
   keeps the httpOnly refresh cookie same-origin.

   The API listens on 3000 (`.env` PORT). That is also Next's *default* port, so
   the two must be kept apart explicitly: `package.json` pins `next dev` to 3001
   and `start` to 3001 for exactly this reason. If this rewrite ever points back
   at this server's own port, Next proxies every /api/v1 request into itself and
   the recursion ends in `socket hang up` / ECONNRESET on every /auth/me and
   /catalogue/* call — see BACKEND_REQUIREMENTS.md §0.1. */
const API_ORIGIN = process.env.API_PROXY_ORIGIN ?? 'http://localhost:3000';

/* Refuse a self-proxy at startup rather than as a wall of socket resets at
   runtime. This is always a configuration mistake, never a deployment choice.
   `PORT` is what `next dev`/`next start` bind; `-p`/`--port` is not visible here,
   so the pinned scripts are the contract and this is the safety net. */
const apiOrigin = new URL(API_ORIGIN);
const webPort = process.env.PORT ?? '3000';
if (apiOrigin.port === webPort) {
  throw new Error(
    `API_PROXY_ORIGIN (${API_ORIGIN}) resolves to this Next server's own port (${webPort}). ` +
      `The /api/v1 rewrite would proxy to itself and every API call would fail with ECONNRESET. ` +
      `Keep the API on one port and the browser on another — see next.config.ts.`
  );
}

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
