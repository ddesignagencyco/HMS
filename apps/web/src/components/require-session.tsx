"use client";

import { usePathname, useRouter } from "next/navigation";
import { useEffect } from "react";
import type { Locale } from "@/lib/utils";
import { useSession } from "@/features/auth/session";
import { homePathForRoles, isPermittedForPath, signInPath, totpPath } from "@/features/auth/routing";

/* Front-end gating for the portal. It keeps a signed-out visitor out of the
   workspace shells and sends them to sign-in with a safe destination to come
   back to. It also verifies that authenticated users have the required role
   to view the specific portal area.

   A staff session that has not finished its two-factor check is authenticated but
   not yet usable, and it is held on the one route that can finish it. The API
   already refuses every staff action for such a session — `policy.ts` throws
   TOTP_REQUIRED before a staff route runs — so this gate is not the thing standing
   between the session and the data. Without it the shell rendered anyway, on top
   of a screenful of 401s, which reads as a broken dashboard rather than as "finish
   signing in". Reloading part-way through enrolment used to land here for exactly
   that reason. */

export function RequireSession({ locale, children }: { locale: Locale; children: React.ReactNode }) {
  const router = useRouter();
  const pathname = usePathname();
  const { status, roles, totpPending } = useSession();

  const onTotpRoute = pathname === `/${locale}/auth/totp`;
  /* A session that still owes a two-factor check is permitted on exactly one path:
     the one that settles it. Anywhere else it needs the usual role permission. */
  const permitted =
    status === "authenticated" &&
    (totpPending ? onTotpRoute : isPermittedForPath(pathname, roles));

  useEffect(() => {
    if (status === "anonymous") {
      const destination = typeof window !== "undefined" ? window.location.pathname + window.location.search : pathname;
      router.replace(signInPath(locale, destination));
      return;
    }
    if (status === "authenticated" && totpPending && !onTotpRoute) {
      router.replace(totpPath(locale));
      return;
    }
    if (status === "authenticated" && !permitted) {
      router.replace(homePathForRoles(roles, locale));
    }
  }, [locale, onTotpRoute, pathname, permitted, roles, router, status, totpPending]);

  /* While /auth/me is in flight or if the user is unauthenticated or not permitted,
     the shell is withheld rather than flashed. A session that still owes a two-factor
     check is withheld for the same reason: the shell would be a portal with nothing
     in it. */
  if (status !== "authenticated" || !permitted) {
    return (
      <div className="min-h-dvh bg-page" aria-busy="true" aria-live="polite">
        <div className="mx-auto max-w-5xl px-4 py-10 sm:px-6 lg:px-8">
          <div className="grid gap-4">
            <span className="skeleton h-9 w-64 rounded-[9px]" />
            <span className="skeleton h-4 w-full max-w-md rounded-[9px]" />
            <div className="mt-6 grid gap-4 sm:grid-cols-3">
              <span className="skeleton h-32 rounded-[14px]" />
              <span className="skeleton h-32 rounded-[14px]" />
              <span className="skeleton h-32 rounded-[14px]" />
            </div>
          </div>
        </div>
      </div>
    );
  }

  return <>{children}</>;
}