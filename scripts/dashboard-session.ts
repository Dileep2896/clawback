// The dashboard needs a login (apps/dashboard/proxy.ts). Check scripts get a signed session for the demo customer instead of signing up.
import { existsSync } from "node:fs";
import { fileURLToPath } from "node:url";
import { CUSTOMER } from "@bill-fighter/db/seed/customer";
import type { Browser, BrowserContextOptions } from "playwright";
import { newSession, SESSION_COOKIE, sessionSecret, signSession } from "../apps/dashboard/lib/auth.ts";

const ENV = fileURLToPath(new URL("../.env", import.meta.url));

/** A session cookie with no user row behind it: the guard checks only the signature, and pages that need the user send it to log in. */
export function scriptSessionCookie(baseUrl: string) {
  if (!process.env.VAULT_KEY && existsSync(ENV)) process.loadEnvFile(ENV);
  const secret = sessionSecret();
  if (!secret) throw new Error("VAULT_KEY is not set, so this script cannot sign a dashboard session. Copy .env from the main checkout.");
  return { name: SESSION_COOKIE, value: signSession(newSession("check-script", CUSTOMER.id), secret), url: baseUrl, httpOnly: true, sameSite: "Lax" as const };
}

/** A browser context already signed in to the dashboard at baseUrl. */
export async function signedInContext(browser: Browser, baseUrl: string, options: BrowserContextOptions = {}) {
  const context = await browser.newContext(options);
  await context.addCookies([scriptSessionCookie(baseUrl)]);
  return context;
}
