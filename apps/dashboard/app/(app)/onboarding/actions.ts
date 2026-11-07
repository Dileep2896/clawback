"use server";

import { db } from "@bill-fighter/db/client";
import { runs, users } from "@bill-fighter/db/schema";
import { Provider } from "@bill-fighter/shared/fixtures";
import { desc, eq } from "drizzle-orm";
import { redirect } from "next/navigation";
import { isDemoCustomer } from "../../../lib/accounts.ts";
import { requireUser } from "../../../lib/session.ts";
import { callWebhook } from "../../../lib/webhook.ts";

export type ConnectState = { connected?: Provider; error?: string };
export type StartState = { queued?: boolean; error?: string };

/** The vault write happens in the webhook service, after it checks the login opens the portal. Nothing here logs the password. */
export async function connectPortalAction(_state: ConnectState, form: FormData): Promise<ConnectState> {
  const user = await requireUser();
  const provider = Provider.safeParse(form.get("provider"));
  if (!provider.success) return { error: "Choose your provider" };

  const demo = form.get("demo") === "1";
  if (demo && !isDemoCustomer(user.customerId)) return { error: "The demo login is only for the demo customer" };
  const username = String(form.get("username") ?? "");
  const password = String(form.get("password") ?? "");
  if (!demo && (!username || !password)) return { error: "Enter the username and password you use on the provider's site" };

  const reply = await callWebhook("/connect-portal", demo ? { provider: provider.data, demo: true } : { provider: provider.data, username, password });
  if (reply.ok) return { connected: provider.data };
  return { error: reply.status === 422 ? "That username and password did not open the portal. Check them and try again." : String(reply.body.error ?? "Could not connect") };
}

/**
 * The demo customer gets the same run as pnpm demo:start. A second click, or a click after a finished run, goes to the Overview
 * rather than starting another: a second run would double the ledger until demo:reset.
 * Any other customer has no portal the agents can read yet, so the audit is queued, honestly, and nothing runs.
 */
export async function startAuditAction(_state: StartState): Promise<StartState> {
  const user = await requireUser();
  if (!isDemoCustomer(user.customerId)) {
    await db.update(users).set({ auditRequestedAt: new Date() }).where(eq(users.id, user.id));
    return { queued: true };
  }
  const [existing] = await db.select({ id: runs.id }).from(runs).where(eq(runs.customerId, user.customerId)).orderBy(desc(runs.startedAt)).limit(1);
  if (!existing) {
    const reply = await callWebhook("/start-audit", {});
    if (!reply.ok) return { error: reply.status === 503 ? String(reply.body.error) : `The agents could not start: ${String(reply.body.error ?? reply.status)}` };
  }
  redirect("/overview");
}
