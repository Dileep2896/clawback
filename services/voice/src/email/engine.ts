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
    const { id: sentId } = await mail.send({ to, subject, text, ...(attachments?.length ? { attachments } : {}) });
    await appendRow(db, callId, transcriptRow("agent", "email", message(subject, text)));

    const deadline = Date.now() + timeoutMs;
    let ours: string | undefined;
    while (Date.now() < deadline) {
      // Our own address, from the sent message, so only a reply to us counts.
      ours ??= (await mailpit.search(`message-id:"${sentId}"`))[0]?.From.Address;
      // Only a reply to our request: from BayTel, to us, In-Reply-To our Message-ID. The subject search just narrows it.
      for (const candidate of ours ? await mailpit.search(`from:"${to}" subject:"${subject}"`) : []) {
        const reply = await mailpit.read(candidate.ID);
        if (reply.InReplyTo !== sentId || !reply.To?.some(({ Address }) => Address === ours)) continue;
        await appendRow(db, callId, transcriptRow("provider", "email", message(reply.Subject, reply.Text)));
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
