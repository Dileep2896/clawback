import { executeRun, runPrompt } from "@bill-fighter/agents/run";
import type { AgentTool } from "@bill-fighter/agents/tool-wrapper";
import type { Db } from "@bill-fighter/db/client";
import { accounts, locations, runs } from "@bill-fighter/db/schema";
import { platformName } from "@bill-fighter/platform/factory";
import type { AgentRuntime, Audit, InboundEmail, Mail } from "@bill-fighter/platform/types";
import { eq } from "drizzle-orm";

export type InboundDeps = {
  db: Db;
  mail: Pick<Mail, "parseInbound">;
  runtime: AgentRuntime;
  audit: Audit;
  tools: AgentTool[];
};

export type InboundReply = { status: number; body: Record<string, unknown> };

/** runs.customer_id is required and the row must exist before any tool, so this cannot wait for Intake. */
async function customersNamedIn(db: Db, { subject, text }: InboundEmail) {
  // Whole tokens, so BE-7001 cannot match inside BE-70012. Filtered here, so a long body never becomes a long query.
  const tokens = new Set(`${subject} ${text}`.split(/[^\w-]+/));
  const onFile = await db
    .select({ accountNumber: accounts.accountNumber, customerId: locations.customerId })
    .from(accounts)
    .innerJoin(locations, eq(accounts.locationId, locations.id));
  return [...new Set(onFile.filter(({ accountNumber }) => tokens.has(accountNumber)).map(({ customerId }) => customerId))];
}

export async function handleInbound(payload: unknown, deps: InboundDeps): Promise<InboundReply> {
  const { db, mail, runtime, audit, tools } = deps;
  let email: InboundEmail;
  try {
    email = mail.parseInbound(payload);
  } catch {
    return { status: 400, body: { error: "Invalid inbound email" } };
  }

  const matched = await customersNamedIn(db, email);
  const customerId = matched[0];
  if (customerId === undefined || matched.length > 1) {
    return { status: 422, body: { error: `The email's account numbers match ${matched.length} customers` } };
  }

  // One statement, so two racing deliveries of the same email still start one run.
  const [created] = await db
    .insert(runs)
    .values({ customerId, platform: platformName(), trigger: "email", dedupeKey: email.messageId, status: "running" })
    .onConflictDoNothing({ target: runs.dedupeKey })
    .returning({ id: runs.id });
  if (!created) {
    const [existing] = await db.select({ id: runs.id }).from(runs).where(eq(runs.dedupeKey, email.messageId));
    return { status: 200, body: { runId: existing?.id, duplicate: true } };
  }

  // shortcut: the run lives in this process, so a crash leaves its row "running" and a redelivery reads as a duplicate.
  // Upgrade when a run can be resumed.
  void executeRun({ db, runId: created.id, prompt: runPrompt(email), runtime, audit, tools }).catch((error: unknown) => {
    console.error(`Run ${created.id}: could not record its result:`, error);
  });
  return { status: 202, body: { runId: created.id, duplicate: false } };
}
