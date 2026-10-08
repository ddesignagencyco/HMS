import { randomBytes, scryptSync, timingSafeEqual } from "node:crypto";
import { mkdirSync, readFileSync, writeFileSync } from "node:fs";
import { dirname, join } from "node:path";
import type { AccountRole } from "@/lib/session";
import { normalisePhone } from "@/lib/validation";

/* Accounts live in a JSON file next to the app. It is small, it is
   append-safe enough for a single-node deployment, and it lets sign-in
   actually check a password instead of accepting anything. Swap the two
   functions at the bottom for a database when there is one. */

export type StoredAccount = {
  id: string;
  name: string;
  phone: string;
  role: AccountRole;
  passwordHash: string;
  createdAt: string;
};

type Store = { accounts: StoredAccount[] };

const STORE_PATH = join(process.cwd(), ".data", "accounts.json");

function hashPassword(password: string, salt = randomBytes(16).toString("hex")) {
  return `${salt}:${scryptSync(password, salt, 64).toString("hex")}`;
}

function verifyPassword(password: string, stored: string) {
  const [salt, digest] = stored.split(":");
  if (!salt || !digest) return false;
  const expected = Buffer.from(digest, "hex");
  const actual = scryptSync(password, salt, 64);
  return expected.length === actual.length && timingSafeEqual(expected, actual);
}

function readStore(): Store {
  try {
    return JSON.parse(readFileSync(STORE_PATH, "utf8")) as Store;
  } catch {
    return { accounts: [] };
  }
}

function writeStore(store: Store) {
  mkdirSync(dirname(STORE_PATH), { recursive: true });
  writeFileSync(STORE_PATH, `${JSON.stringify(store, null, 2)}\n`, "utf8");
}

export function findAccountByPhone(phone: string) {
  const target = normalisePhone(phone);
  return readStore().accounts.find((account) => account.phone === target) ?? null;
}

export function checkCredentials(phone: string, password: string) {
  const account = findAccountByPhone(phone);
  if (!account) return null;
  return verifyPassword(password, account.passwordHash) ? account : null;
}

export function createAccount(input: { name: string; phone: string; password: string; role: AccountRole }) {
  const store = readStore();
  const phone = normalisePhone(input.phone);
  if (store.accounts.some((account) => account.phone === phone)) return { ok: false as const, reason: "exists" as const };

  const account: StoredAccount = {
    id: `acc-${randomBytes(4).toString("hex")}`,
    name: input.name.trim(),
    phone,
    role: input.role,
    passwordHash: hashPassword(input.password),
    createdAt: new Date().toISOString(),
  };
  store.accounts.push(account);
  writeStore(store);
  return { ok: true as const, account };
}

export function updatePassword(phone: string, password: string) {
  const store = readStore();
  const target = normalisePhone(phone);
  const account = store.accounts.find((item) => item.phone === target);
  if (!account) return false;
  account.passwordHash = hashPassword(password);
  writeStore(store);
  return true;
}
