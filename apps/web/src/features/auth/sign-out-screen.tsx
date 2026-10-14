"use client";

import { useEffect, useRef } from "react";
import { useRouter } from "next/navigation";
import { Loader2 } from "lucide-react";
import { useSession } from "@/features/auth/session";
import type { Dictionary } from "@/lib/dictionaries";
import { localizedPath, type Locale } from "@/lib/utils";

/* `/auth/sign-out` ends the session the same way the header's button does:
   `useSession().signOut` calls `POST /auth/logout`, which revokes the refresh
   cookie server-side, and then clears this browser's caches. It used to be a
   server action that only deleted a legacy cookie — the refresh token stayed
   valid and the next page load signed the person straight back in. */
export function SignOutScreen({ locale, dict }: { locale: Locale; dict: Dictionary }) {
  const { signOut } = useSession();
  const router = useRouter();
  /* Strict mode runs effects twice in development; one logout is enough. */
  const started = useRef(false);

  useEffect(() => {
    if (started.current) return;
    started.current = true;
    void signOut().finally(() => router.replace(localizedPath(locale, "/auth/sign-in")));
  }, [locale, router, signOut]);

  return (
    <p role="status" className="mx-auto flex items-center gap-2 text-sm font-medium text-secondary">
      <Loader2 className="size-4 animate-spin" aria-hidden="true" />
      {dict.nav.signingOut}
    </p>
  );
}
