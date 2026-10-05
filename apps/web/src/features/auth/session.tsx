"use client";

import { useQuery, useQueryClient } from "@tanstack/react-query";
import { createContext, useCallback, useContext, useEffect, useMemo, useState } from "react";
import { writeAccessToken } from "@/lib/api/access-token";
import { onSessionLost, refreshSession, type SessionResult } from "@/lib/api/client";
import { ApiError } from "@/lib/api/problem";
import type { Locale } from "@/lib/utils";
import { authApi, type ActorRole, type AuthUser, type LoginInput, type OtpPurpose, type TotpSetupResult } from "./api";
import { actorRoles } from "./routing";

/* Three kinds of state, kept apart on purpose:
     · the current user        — one server-backed query (["auth","me"])
     · authentication readiness— the status below, plus the staff TOTP flag
     · the access token        — a module variable, never in React state
   There is no second copy of the user anywhere: every consumer reads the query
   cache through this context. */

export const sessionKeys = {
  me: ["auth", "me"] as const,
};

export type SessionStatus = "loading" | "authenticated" | "anonymous";

export type PasswordResetInput = { identifier: string; code: string; newPassword: string };

type SessionContextValue = {
  status: SessionStatus;
  user: AuthUser | null;
  roles: ActorRole[];
  /** A staff session that exists but has not cleared two-factor verification.
      The API refuses staff routes for it, so the app must not treat it as a
      finished sign-in. */
  totpPending: boolean;
  signIn: (input: LoginInput) => Promise<SessionResult>;
  verifyOtpSession: (input: { target: string; purpose: OtpPurpose; code: string }) => Promise<SessionResult>;
  resetPasswordSession: (input: PasswordResetInput) => Promise<SessionResult>;
  adoptSession: (result: SessionResult) => void;
  beginTotpSetup: () => Promise<TotpSetupResult>;
  confirmTotp: (code: string) => Promise<{ verified: boolean }>;
  disableTotp: () => Promise<void>;
  signOut: () => Promise<void>;
  /** Drops every cached query and the in-memory token. Used on sign-out, on
      session expiry, and whenever the account behind the session changes. */
  endSession: () => void;
  /** Re-reads /auth/me without a full reload. */
  reload: () => Promise<void>;
};

const SessionContext = createContext<SessionContextValue | null>(null);

export function SessionProvider({ locale, children }: { locale: Locale; children: React.ReactNode }) {
  const queryClient = useQueryClient();
  const [totpPending, setTotpPending] = useState(false);

  const meQuery = useQuery({
    queryKey: sessionKeys.me,
    queryFn: async (): Promise<{ user: AuthUser } | null> => {
      try {
        return await authApi.me({ locale });
      } catch (error) {
        /* An unauthenticated session is a normal answer, not a failure to show
           anyone: the gate sends the visitor to sign-in and nothing else. */
        if (error instanceof ApiError && (error.status === 401 || error.status === 403)) return null;
        if (error instanceof TypeError || (error instanceof Error && error.message.toLowerCase().includes("fetch"))) return null;
        throw error;
      }
    },
    retry: false,
    /* The one query that is allowed to re-check itself when the tab comes back.
       A session can be signed in or out in another tab, and this is what the
       header renders its sign-in/sign-out controls from — a cached answer that
       is never revisited leaves the header wrong until the next full load. The
       staleTime still bounds it to one cheap request per minute per tab. */
    refetchOnWindowFocus: true,
    staleTime: 60_000,
  });

  const endSession = useCallback(() => {
    writeAccessToken(null);
    /* The current user is settled to "nobody" first. Removing it instead would
       leave the query pending, the gate would re-run it, it would fail the same
       way and re-enter here — the refresh loop this is meant to end. */
    queryClient.setQueryData(sessionKeys.me, null);
    /* Everything else belongs to the account that is being signed out, and a
       partial purge would show the next person somebody else's bookings. */
    queryClient.removeQueries({ predicate: (query) => query.queryKey[0] !== "auth" });
    setTotpPending(false);
  }, [queryClient]);

  const adoptSession = useCallback(
    (result: SessionResult) => {
      writeAccessToken(result.accessToken, result.expiresInSeconds);
      queryClient.setQueryData(sessionKeys.me, { user: result.user });
      setTotpPending(result.totpRequired);
    },
    [queryClient],
  );

  /* The client reports a session that cannot be recovered — the refresh token
     was replayed, expired or revoked. Nothing private may survive that. */
  useEffect(() => onSessionLost(endSession), [endSession]);

  const signIn = useCallback(
    async (input: LoginInput) => {
      const result = await authApi.login(input, { locale });
      adoptSession(result);
      return result;
    },
    [adoptSession, locale],
  );

  const verifyOtpSession = useCallback(
    async (input: { target: string; purpose: OtpPurpose; code: string }) => {
      const result = await authApi.verifyOtp(input.target, input.purpose, input.code, { locale });
      adoptSession(result);
      return result;
    },
    [adoptSession, locale],
  );

  const resetPasswordSession = useCallback(
    async (input: PasswordResetInput) => {
      const result = await authApi.resetPassword(input, { locale });
      adoptSession(result);
      return result;
    },
    [adoptSession, locale],
  );

  const signOut = useCallback(async () => {
    try {
      await authApi.logout({ locale });
    } catch {
      /* The API answers 204 whether or not a cookie arrived, so the only way
         this fails is transport. Either way this browser is done with the
         session, and leaving the caches in place would be worse than the
         server not knowing we left. */
    } finally {
      endSession();
    }
  }, [endSession, locale]);

  const beginTotpSetup = useCallback(() => authApi.totpSetup({ locale }), [locale]);

  const confirmTotp = useCallback(
    async (code: string) => {
      await authApi.totpVerify(code, { locale });
      /* The access token minted at sign-in still carries totp=false, and the
         API's policy guard reads that claim rather than the database. A refresh
         is the only way to obtain a token with the flag set, so it happens here
         rather than on the next request. */
      const recovered = await refreshSession(locale);
      if (recovered) await queryClient.invalidateQueries({ queryKey: sessionKeys.me });
      setTotpPending(!recovered);
      return { verified: recovered };
    },
    [locale, queryClient],
  );

  const disableTotp = useCallback(async () => {
    await authApi.totpDisable({ locale });
    setTotpPending(false);
    await queryClient.invalidateQueries({ queryKey: sessionKeys.me });
  }, [locale, queryClient]);

  const reload = useCallback(async () => {
    await queryClient.invalidateQueries({ queryKey: sessionKeys.me });
  }, [queryClient]);

  const user = meQuery.data?.user ?? null;
  const status: SessionStatus = meQuery.isPending ? "loading" : user === null ? "anonymous" : "authenticated";

  const value = useMemo<SessionContextValue>(
    () => ({
      status,
      user,
      roles: actorRoles(user),
      totpPending,
      signIn,
      verifyOtpSession,
      resetPasswordSession,
      adoptSession,
      beginTotpSetup,
      confirmTotp,
      disableTotp,
      signOut,
      endSession,
      reload,
    }),
    [
      status,
      user,
      totpPending,
      signIn,
      verifyOtpSession,
      resetPasswordSession,
      adoptSession,
      beginTotpSetup,
      confirmTotp,
      disableTotp,
      signOut,
      endSession,
      reload,
    ],
  );

  return <SessionContext.Provider value={value}>{children}</SessionContext.Provider>;
}

export function useSession(): SessionContextValue {
  const value = useContext(SessionContext);
  if (value === null) throw new Error("useSession must be used inside <SessionProvider>");
  return value;
}

/** True once the visitor is known to be signed in, without the loading state. */
export const useIsAuthenticated = (): boolean => useSession().status === "authenticated";