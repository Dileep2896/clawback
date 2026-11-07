import assert from "node:assert/strict";
import { randomUUID } from "node:crypto";
import { setTimeout as sleep } from "node:timers/promises";
import { naiveClient, need, seg } from "./client.ts";
import { inboxAddress } from "./identity.ts";
import { createMail, type InboundMessage } from "./mail.ts";

const env = process.env;

/**
 * Live: one real send ($0.0008) from bills@ to the Linda stand-in inbox on our own system domain, read back through the
 * naïve message feed. Fails, never skips, while the domain cannot send yet.
 */
export default async function check() {
  const mail = createMail(env);
  const call = naiveClient(env);
  const linda = await inboxAddress(env, "NAIVE_LINDA_INBOX_ID");

  // Refusals first: none of these may reach naïve.
  await assert.rejects(mail.send({ to: "someone@example.com", subject: "x", text: "x" }), /outside ALLOWED_EMAIL_DOMAINS/);
  await assert.rejects(mail.send({ to: `${linda}, someone@example.com`, subject: "x", text: "x" }), /outside ALLOWED_EMAIL_DOMAINS/);
  await assert.rejects(mail.send({ to: linda, from: "BayCurrent Electric <billing@baycurrent.example>", subject: "x", text: "x" }), /sends only from/);
  await assert.rejects(mail.send({ to: linda, subject: "x", text: "x", attachments: [{ filename: "a", path: "/a" }] }), /plain text only/);

  const domain = await call<{ name: string; dns_status: string }>("GET", `/domains/${seg(need(env, "NAIVE_DOMAIN_ID"))}`);
  // naïve refuses sends with job_not_ready until dns_status is provisioned (api/domains).
  assert.equal(domain.dns_status, "provisioned", `${domain.name} cannot send yet: dns_status is ${domain.dns_status}`);

  const subject = `Clawback approval check ${randomUUID()}`;
  await mail.send({ to: linda, subject, text: "Approve the bundle in the dashboard." });

  const lindaInbox = need(env, "NAIVE_LINDA_INBOX_ID");
  const feed = `/identities/${seg(need(env, "NAIVE_IDENTITY_ID"))}/messages?channel=email&limit=20`;
  for (let attempt = 0; attempt < 30; attempt++) {
    const { data } = await call<{ data: InboundMessage[] }>("GET", feed);
    const arrived = data.find((message) => message.endpoint_id === lindaInbox && message.subject === subject);
    if (arrived) {
      assert.match(arrived.from, /bills@/);
      assert.equal(arrived.text.trim(), "Approve the bundle in the dashboard.");
      return;
    }
    await sleep(3000);
  }
  assert.fail(`the mail to ${linda} did not arrive in the naïve message feed within 90 s`);
}
