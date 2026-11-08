"use server";

import { db } from "@bill-fighter/db/client";
import { headers } from "next/headers";
import { redirect } from "next/navigation";
import { randomBytes } from "node:crypto";
import { isSandbox } from "@bill-fighter/shared/sandbox";
import { createUser, logIn, SignUp } from "../../lib/accounts.ts";
import { hashPassword, safeNext } from "../../lib/auth.ts";
import { BUSY_TEXT, createSandboxUser, ipHash } from "../../lib/sandbox.ts";
import { endSession, startSession } from "../../lib/session.ts";

export type FormState = { error?: string; fields?: Record<string, string> };

// The host (Vercel) sets x-forwarded-for's first entry to the client's address; with none, every caller shares one bucket.
const clientIpHash = async () => ipHash((await headers()).get("x-forwarded-for")?.split(",")[0]?.trim() || "unknown");

export async function signUpAction(_state: FormState, form: FormData): Promise<FormState> {
  // Never echo the password back into the form.
  const fields = { name: String(form.get("name") ?? ""), company: String(form.get("company") ?? ""), email: String(form.get("email") ?? "") };
  const input = SignUp.safeParse({ ...fields, password: form.get("password") });
  if (!input.success) return { error: input.error.issues[0]?.message ?? "Check the form", fields };
  const user = isSandbox()
    ? await createSandboxUser(db, { ...input.data, passwordHash: await hashPassword(input.data.password), ipHash: await clientIpHash() })
    : await createUser(db, input.data);
  if (user === "taken") return { error: "That email already has an account. Log in instead.", fields };
  if (user === "busy") return { error: BUSY_TEXT, fields };
  await startSession(user);
  redirect("/onboarding");
}

export async function logInAction(_state: FormState, form: FormData): Promise<FormState> {
  const email = String(form.get("email") ?? "");
  const user = await logIn(db, email, String(form.get("password") ?? ""));
  if (!user) return { error: "Email or password is wrong", fields: { email } };
  await startSession(user);
  redirect(safeNext(form.get("next")) ?? "/overview");
}

export async function logOutAction() {
  await endSession();
  redirect("/");
}

/** The sandbox's "Try it now": a fresh throwaway account in one tap. Its password is random and never shown, so nobody shares it. */
export async function tryItNowAction(): Promise<FormState> {
  if (!isSandbox()) return { error: "Try it now is only in the sandbox" };
  const tag = randomBytes(6).toString("hex");
  const user = await createSandboxUser(db, {
    name: "Judge",
    company: "Golden Gate Noodle Co. (sandbox)",
    email: `judge-${tag}@sandbox.clawback.example`,
    passwordHash: await hashPassword(randomBytes(24).toString("base64url")),
    ipHash: await clientIpHash(),
  });
  if (user === "busy" || user === "taken") return { error: BUSY_TEXT };
  await startSession(user);
  redirect("/onboarding");
}
