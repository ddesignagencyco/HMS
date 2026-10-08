"use server";

import { redirect } from "next/navigation";
import { checkCredentials, createAccount, updatePassword } from "@/lib/accounts";
import { clearSession, createSession, type AccountRole } from "@/lib/session";
import { localizedPath, type Locale } from "@/lib/utils";

/* Every auth screen ends in one of these. They are server actions rather than
   client-side state changes so the session cookie is written by the server,
   the password is checked against a stored hash, and the redirect is a real
   navigation. */

const localeOf = (formData: FormData): Locale => (formData.get("locale") === "ur" ? "ur" : "en");

export type AuthState = { error?: string };

export async function signInAction(_state: AuthState, formData: FormData): Promise<AuthState> {
  const locale = localeOf(formData);
  const phone = String(formData.get("phone") ?? "");
  const password = String(formData.get("password") ?? "");

  const account = checkCredentials(phone, password);
  if (!account) return { error: "invalidCredentials" };

  await createSession({ name: account.name, phone: account.phone, role: account.role });
  redirect(localizedPath(locale, account.role === "provider" ? "/provider" : "/account"));
}

export async function registerAction(_state: AuthState, formData: FormData): Promise<AuthState> {
  const locale = localeOf(formData);
  const name = String(formData.get("name") ?? "").trim();
  const phone = String(formData.get("phone") ?? "");
  const password = String(formData.get("password") ?? "");
  const role: AccountRole = formData.get("role") === "provider" ? "provider" : "customer";

  const result = createAccount({ name, phone, password, role });
  if (!result.ok) return { error: "accountExists" };

  await createSession({ name: result.account.name, phone: result.account.phone, role: result.account.role });
  redirect(localizedPath(locale, role === "provider" ? "/provider" : "/account"));
}

export async function resetPasswordAction(_state: AuthState, formData: FormData): Promise<AuthState> {
  const locale = localeOf(formData);
  const phone = String(formData.get("phone") ?? "");
  const password = String(formData.get("password") ?? "");

  /* Resetting a password does not sign anyone in — they go back to sign-in
     with the password they just chose. */
  if (!updatePassword(phone, password)) return { error: "invalidPhone" };
  redirect(localizedPath(locale, "/auth/sign-in"));
}

export async function signOutAction(formData: FormData) {
  const locale = localeOf(formData);
  await clearSession();
  redirect(localizedPath(locale, "/auth/sign-in"));
}
