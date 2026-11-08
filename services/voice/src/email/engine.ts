import type { Db } from "@bill-fighter/db/client";
import { calls } from "@bill-fighter/db/schema";
import type { Mailpit } from "@bill-fighter/platform/local/mailpit";
import type { Mail, OutboundEmail } from "@bill-fighter/platform/types";
import { setTimeout as sleep } from "node:timers/promises";
import { callFacts } from "../facts.ts";
import { type CallPlan, checkPlan } from "../sim/engine.ts";
import { appendRow, closeCall, transcriptRow } from "../transcript.ts";
import { assertReplicaAddress, BAYTEL_SUPPORT, REPLY_TIMEOUT_MS, requestEmail } from "./letter.ts";

const message = (subject: string, text: string) => `Subject: ${subject}\n\n${text}`;

/**
 * Sends one cancellation request to BayTel and waits for its reply, stored as a `calls` row with mode "email": the sent
 * mail, then the reply. Throws on no reply within `timeoutMs`, so the step is never done without one.
 */
export async function runEmail(input: {
  db: Db;
  mail: Mail;
  mailpit: Mailpit;
  actionId: string;
  plan: CallPlan;
  attachments?: OutboundEmail["attachments"];
  to?: string;
  timeoutMs?: number;
  pollMs?: number;
}): Promise<{ callId: string }> {
  const { db, mail, mailpit, actionId, plan, attachments, to = BAYTEL_SUPPORT, timeoutMs = REPLY_TIMEOUT_MS, pollMs = 1000 } = input;
  assertReplicaAddress(to);
  if (plan.promoAccounts.length > 0) throw new Error("The email to the provider covers line cancellations only");

  const { planned } = await checkPlan(db, plan);
  const facts = await callFacts(db, actionId, plan, planned);
  const lines = planned.map((line) => line.number);

  const [row] = await db.insert(calls).values({ actionId, mode: "email", toNumber: to, transcriptJson: [] }).returning({ id: calls.id });
  const callId = row!.id;
  try {
    const { subject, text } = requestEmail(facts, plan.accountNumber, lines, callId.slice(0, 8));
    await mail.send({ to, subject, text, ...(attachments?.length ? { attachments } : {}) });
    await appendRow(db, callId, transcriptRow("agent", "email", message(subject, text)));

    const deadline = Date.now() + timeoutMs;
    while (Date.now() < deadline) {
      const [reply] = await mailpit.search(`from:"${to}" subject:"${subject}"`);
      if (reply) {
        const { Subject, Text } = await mailpit.read(reply.ID);
        await appendRow(db, callId, transcriptRow("provider", "email", message(Subject, Text)));
        return { callId };
      }
      await sleep(pollMs);
    }
    const notice = `No reply from BayTel within ${Math.round(timeoutMs / 1000)} seconds, so nothing was cancelled.`;
    await appendRow(db, callId, transcriptRow("system", "status", notice));
    throw new Error(notice);
  } finally {
    await closeCall(db, callId);
  }
}
