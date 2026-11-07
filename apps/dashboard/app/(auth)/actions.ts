"use server";

import { db } from "@bill-fighter/db/client";
import { redirect } from "next/navigation";
import { createUser, logIn, SignUp } from "../../lib/accounts.ts";
import { endSession, startSession } from "../../lib/session.ts";

export type FormState = { error?: string; fields?: Record<string, string> };

// Only a path on this site, so ?next= cannot send a signed-in user somewhere else.
const safeNext = (value: FormDataEntryValue | null) => (typeof value === "string" && /^\/(?![/\\])/.test(value) ? value : null);

export async function signUpAction(_state: FormState, form: FormData): Promise<FormState> {
  // Never echo the password back into the form.
  const fields = { name: String(form.get("name") ?? ""), company: String(form.get("company") ?? ""), email: String(form.get("email") ?? "") };
  const input = SignUp.safeParse({ ...fields, password: form.get("password") });
  if (!input.success) return { error: input.error.issues[0]?.message ?? "Check the form", fields };
  const user = await createUser(db, input.data);
  if (user === "taken") return { error: "That email already has an account. Log in instead.", fields };
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
