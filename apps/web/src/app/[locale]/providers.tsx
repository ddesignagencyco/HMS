"use client";

import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import { useEffect, useState } from "react";
import { Toaster, toast } from "react-hot-toast";
import { onSessionLost } from "@/lib/api/client";
import { getDictionary, type Dictionary } from "@/lib/dictionaries";
import type { Locale } from "@/lib/utils";
import { SessionProvider } from "@/features/auth/session";

/* The one place a QueryClient, a session and a Toaster exist. Mounted by the
   locale layout so every route — public, portal and authentication — shares one
   cache and one set of toasts instead of each page owning its own. */

export function Providers({ locale, children }: { locale: Locale; children: React.ReactNode }) {
  const [queryClient] = useState(
    () =>
      new QueryClient({
        defaultOptions: {
          queries: {
            /* Retrying an authentication request can only repeat a rejection the
               user already caused, and a retry storm around an expired session
               turns into a refresh loop. */
            retry: false,
            refetchOnWindowFocus: false,
            staleTime: 30_000,
          },
          mutations: { retry: false },
        },
      }),
  );

  return (
    <QueryClientProvider client={queryClient}>
      <SessionProvider locale={locale}>{children}</SessionProvider>
      <SessionExpiredNotice dict={getDictionary(locale)} />
      <Toaster
        position="top-center"
        gutter={12}
        toastOptions={{
          duration: 4000,
          className: "!rounded-[10px] !border !border-line !bg-white !text-navy !shadow-lifted",
          success: { className: "!border-emerald-300 !bg-white" },
          error: { className: "!border-rose-300 !bg-white" },
        }}
      />
    </QueryClientProvider>
  );
}

/**
 * The one failure that has no form to appear in: the session ended on its own —
 * the access token expired and the refresh token was expired, revoked or replayed.
 * A deliberate sign-out does not come through here, so this never fires on a
 * path the person took themselves.
 */
function SessionExpiredNotice({ dict }: { dict: Dictionary }) {
  useEffect(() => onSessionLost(() => toast.error(dict.auth.sessionExpired, { id: "auth:session-expired" })), [dict]);
  return null;
}