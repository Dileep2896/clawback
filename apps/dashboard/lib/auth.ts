import { createHmac, randomBytes, scrypt, timingSafeEqual } from "node:crypto";
import { promisify } from "node:util";

// No next/* imports: scripts mint sessions with this file too.

const scryptAsync = promisify<string, Buffer, number, Buffer>(scrypt);
const KEY_LENGTH = 64;

export const SESSION_COOKIE = "clawback_session";
export const SESSION_SECONDS = 8 * 60 * 60;

export async function hashPassword(password: string): Promise<string> {
  const salt = randomBytes(16);
  const hash = await scryptAsync(password, salt, KEY_LENGTH);
  return `${salt.toString("base64")}:${hash.toString("base64")}`;
}

export async function verifyPassword(password: string, stored: string): Promise<boolean> {
  const [salt, hash] = stored.split(":");
  if (!salt || !hash) return false;
  const expected = Buffer.from(hash, "base64");
  const actual = await scryptAsync(password, Buffer.from(salt, "base64"), expected.length);
  return actual.length === expected.length && timingSafeEqual(actual, expected);
}

/** uid: users.id; cid: the customer the session sees; exp: ms since epoch. */
export type Session = { uid: string; cid: string; exp: number };

/** Derived from VAULT_KEY, which every set-up worktree already has. Null means nobody can sign in: fail closed. */
export function sessionSecret(env: Record<string, string | undefined> = process.env): Buffer | null {
  const key = env.VAULT_KEY;
  return key ? createHmac("sha256", key).update("clawback-dashboard-session").digest() : null;
}

const signature = (payload: string, secret: Buffer) => createHmac("sha256", secret).update(payload).digest();

export function signSession(session: Session, secret: Buffer): string {
  const payload = Buffer.from(JSON.stringify(session)).toString("base64url");
  return `${payload}.${signature(payload, secret).toString("base64url")}`;
}

/** Null for anything tampered with, malformed or expired. */
export function readSession(token: string | undefined, secret: Buffer | null, now = Date.now()): Session | null {
  if (!token || !secret) return null;
  const [payload, given, extra] = token.split(".");
  if (!payload || !given || extra !== undefined) return null;
  const expected = signature(payload, secret);
  const actual = Buffer.from(given, "base64url");
  if (actual.length !== expected.length || !timingSafeEqual(actual, expected)) return null;
  try {
    const session = JSON.parse(Buffer.from(payload, "base64url").toString()) as Session;
    return typeof session.uid === "string" && typeof session.cid === "string" && typeof session.exp === "number" && session.exp > now ? session : null;
  } catch {
    return null;
  }
}

export const newSession = (uid: string, cid: string, now = Date.now()): Session => ({ uid, cid, exp: now + SESSION_SECONDS * 1000 });

// Pages anyone may open. /api/sms stays open because the simulated phone posts to it.
const PUBLIC = ["/", "/how-it-works", "/pricing", "/compare", "/market", "/naive", "/signup", "/login", "/api/sms"];

export const isPublicPath = (path: string) => PUBLIC.includes(path) || path.startsWith("/_next/") || path === "/favicon.ico";

const SELF = "http://self.invalid";
const APP_ROUTES = new Set(["/overview", "/bills", "/findings", "/money", "/agents", "/onboarding"]);

/**
 * Only one of this site's own pages, so ?next= cannot send a signed-in user somewhere else. Browsers drop tabs and newlines,
 * read "\\" as "/" and resolve dot segments ("/.//evil.example" is "//evil.example"), so the parsed path must be a known route.
 */
export function safeNext(value: unknown): string | null {
  if (typeof value !== "string" || !value.startsWith("/") || /[\u0000- \u007f\\]/.test(value)) return null;
  let url: URL;
  try {
    url = new URL(value, SELF); // "//", "//%" and "//[" parse as a bad host and throw
  } catch {
    return null;
  }
  return url.origin === SELF && APP_ROUTES.has(url.pathname) ? `${url.pathname}${url.search}${url.hash}` : null;
}
