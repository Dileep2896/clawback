"use server";

import { redirect } from "next/navigation";
import { brandOf } from "../../lib/brands.ts";
import { readCredentials, verifyLogin } from "../../lib/credentials.ts";
import { startSession } from "../../lib/session.ts";

export async function login(form: FormData) {
  const provider = brandOf(form.get("brand"));
  if (!provider) redirect("/");

  const credentials = await readCredentials();
  if (!credentials) redirect(`/login?brand=${provider}&error=setup`);

  const username = String(form.get("username") ?? "");
  const password = String(form.get("password") ?? "");
  if (!(await verifyLogin(credentials, provider, username, password))) {
    redirect(`/login?brand=${provider}&error=wrong`);
  }

  await startSession(provider, credentials.sessionSecret);
  redirect("/accounts");
}
