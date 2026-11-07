import { randomBytes, scrypt, timingSafeEqual } from "node:crypto";
import { readFile } from "node:fs/promises";
import { resolve } from "node:path";
import { promisify } from "node:util";
import type { Provider } from "@bill-fighter/shared/fixtures";

const scryptAsync = promisify<string, Buffer, number, Buffer>(scrypt);

export type StoredLogin = { username: string; salt: string; hash: string };
export type PortalCredentials = { sessionSecret: string; logins: Record<Provider, StoredLogin> };

// next dev and next start both run from apps/portal. The file holds hashes only: plaintext lives in the vault.
const DEFAULT_PATH = resolve(process.cwd(), "../../data/seed/portal-credentials.json");

export async function hashLogin(username: string, password: string): Promise<StoredLogin> {
  const salt = randomBytes(16);
  const hash = await scryptAsync(password, salt, 64);
  return { username, salt: salt.toString("base64"), hash: hash.toString("base64") };
}

/** Null when the seed script has not run, so every login is refused rather than let through. */
export async function readCredentials(path: string = DEFAULT_PATH): Promise<PortalCredentials | null> {
  let file: string;
  try {
    file = await readFile(/*turbopackIgnore: true*/ path, "utf8");
  } catch (error) {
    if ((error as NodeJS.ErrnoException).code === "ENOENT") return null;
    throw error;
  }
  return JSON.parse(file) as PortalCredentials;
}

/** Looks up by the brand being signed in to, so one brand's login never opens another. */
export async function verifyLogin(
  credentials: PortalCredentials,
  provider: Provider,
  username: string,
  password: string,
): Promise<boolean> {
  const login = credentials.logins[provider];
  const expected = Buffer.from(login.hash, "base64");
  // Hash even for a wrong username, so the response time does not reveal which part was wrong.
  const actual = await scryptAsync(password, Buffer.from(login.salt, "base64"), expected.length);
  return timingSafeEqual(actual, expected) && username === login.username;
}
