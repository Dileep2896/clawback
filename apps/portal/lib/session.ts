import { createHmac, randomUUID, timingSafeEqual } from "node:crypto";
import { cookies } from "next/headers";
import type { Provider } from "@bill-fighter/shared/fixtures";
import { brandOf } from "./brands.ts";
import { readCredentials } from "./credentials.ts";

export type Session = { id: string; provider: Provider; expiresAt: number };

const SESSION_COOKIE = "portal_session";
const MODAL_COOKIE = "portal_session_modal_seen";
// Long enough that nothing expires during a demo run: the modal is friction, not a real timeout.
const LIFETIME_SECONDS = 8 * 60 * 60;

const signature = (payload: string, secret: string) => createHmac("sha256", secret).update(payload).digest();

export function signSession(session: Session, secret: string): string {
  const payload = Buffer.from(JSON.stringify(session)).toString("base64url");
  return `${payload}.${signature(payload, secret).toString("base64url")}`;
}

/** Null for anything tampered with, malformed or expired. */
export function readSession(token: string, secret: string, now = Date.now()): Session | null {
  const [payload, given, extra] = token.split(".");
  if (!payload || !given || extra !== undefined) return null;
  const expected = signature(payload, secret);
  const actual = Buffer.from(given, "base64url");
  if (actual.length !== expected.length || !timingSafeEqual(actual, expected)) return null;
  const session = JSON.parse(Buffer.from(payload, "base64url").toString()) as Session;
  return brandOf(session.provider) && session.expiresAt > now ? session : null;
}

const cookieOptions = () => ({
  httpOnly: true,
  sameSite: "lax" as const,
  secure: process.env.NODE_ENV === "production",
  path: "/",
  maxAge: LIFETIME_SECONDS,
});

/** A new id each login, so the modal shows once per session and again after the next login. */
export async function startSession(provider: Provider, secret: string): Promise<void> {
  const session = { id: randomUUID(), provider, expiresAt: Date.now() + LIFETIME_SECONDS * 1000 };
  (await cookies()).set(SESSION_COOKIE, signSession(session, secret), cookieOptions());
}

export async function getSession(): Promise<Session | null> {
  const token = (await cookies()).get(SESSION_COOKIE)?.value;
  const credentials = token ? await readCredentials() : null;
  return token && credentials ? readSession(token, credentials.sessionSecret) : null;
}

export async function modalSeen(session: Session): Promise<boolean> {
  return (await cookies()).get(MODAL_COOKIE)?.value === session.id;
}

export async function markModalSeen(session: Session): Promise<void> {
  (await cookies()).set(MODAL_COOKIE, session.id, cookieOptions());
}
