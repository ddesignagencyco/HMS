import { cookies } from "next/headers";
import { cache } from "react";

/* The session is a signed cookie, not a database row. It carries just enough
   to render a correct header and to send each person to the right workspace
   after they sign in. It is read by the locale layout, so it is cached per
   request to avoid re-verifying the signature for every component. */

export type AccountRole = "customer" | "provider";

export type Session = {
  name: string;
  phone: string;
  role: AccountRole;
};

export const SESSION_COOKIE = "hunar_session";

/* A per-deploy secret keeps the cookie from being forged by hand. Override it
   with HUNAR_SESSION_SECRET in any real deployment. */
const SECRET = process.env.HUNAR_SESSION_SECRET ?? "hunar-session-secret";

const encoder = new TextEncoder();

function toBase64(bytes: Uint8Array) {
  let binary = "";
  for (const byte of bytes) binary += String.fromCharCode(byte);
  return btoa(binary);
}

function fromBase64(value: string) {
  const binary = atob(value);
  return Uint8Array.from(binary, (char) => char.charCodeAt(0));
}

function toBase64Utf8(value: string) {
  return toBase64(encoder.encode(value));
}

function fromBase64Utf8(value: string) {
  return new TextDecoder().decode(fromBase64(value));
}

async function hmacKey() {
  return crypto.subtle.importKey("raw", encoder.encode(SECRET), { name: "HMAC", hash: "SHA-256" }, false, ["sign", "verify"]);
}

export async function createSession(session: Session) {
  const payload = toBase64Utf8(JSON.stringify(session));
  const signature = toBase64(new Uint8Array(await crypto.subtle.sign("HMAC", await hmacKey(), encoder.encode(payload))));
  const store = await cookies();
  store.set(SESSION_COOKIE, `${payload}.${signature}`, {
    httpOnly: true,
    sameSite: "lax",
    secure: process.env.NODE_ENV === "production",
    path: "/",
    maxAge: 60 * 60 * 24 * 30,
  });
}

export async function clearSession() {
  const store = await cookies();
  store.delete(SESSION_COOKIE);
}

export const readSession = cache(async (): Promise<Session | null> => {
  const store = await cookies();
  const raw = store.get(SESSION_COOKIE)?.value;
  if (!raw) return null;
  const separator = raw.lastIndexOf(".");
  if (separator < 1) return null;
  const payload = raw.slice(0, separator);
  const signature = raw.slice(separator + 1);
  const valid = await crypto.subtle.verify("HMAC", await hmacKey(), fromBase64(signature), encoder.encode(payload));
  if (!valid) return null;
  try {
    const parsed = JSON.parse(fromBase64Utf8(payload)) as Session;
    if (typeof parsed?.name !== "string" || typeof parsed?.phone !== "string") return null;
    if (parsed.role !== "customer" && parsed.role !== "provider") return null;
    return { name: parsed.name, phone: parsed.phone, role: parsed.role };
  } catch {
    return null;
  }
});

export const workspacePath = (role: AccountRole) => (role === "provider" ? "/provider" : "/account");
