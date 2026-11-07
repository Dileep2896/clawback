import { db } from "@bill-fighter/db/client";
import { cookies } from "next/headers";
import { redirect } from "next/navigation";
import { findUser, type User } from "./accounts.ts";
import { newSession, readSession, type Session, SESSION_COOKIE, SESSION_SECONDS, sessionSecret, signSession } from "./auth.ts";

export async function startSession(user: Pick<User, "id" | "customerId">) {
  const secret = sessionSecret();
  if (!secret) throw new Error("VAULT_KEY is not set, so the dashboard cannot sign sessions");
  (await cookies()).set(SESSION_COOKIE, signSession(newSession(user.id, user.customerId), secret), {
    httpOnly: true,
    sameSite: "lax",
    secure: process.env.NODE_ENV === "production",
    path: "/",
    maxAge: SESSION_SECONDS,
  });
}

export async function endSession() {
  (await cookies()).delete(SESSION_COOKIE);
}

export async function currentSession(): Promise<Session | null> {
  return readSession((await cookies()).get(SESSION_COOKIE)?.value, sessionSecret());
}

/** The signed-in user, or a redirect to log in. A script's minted session has no user row, so it redirects too. */
export async function requireUser(): Promise<User> {
  const session = await currentSession();
  const user = session && (await findUser(db, session.uid));
  if (!user) redirect("/login");
  return user;
}
