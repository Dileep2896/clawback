import assert from "node:assert/strict";
import { randomUUID } from "node:crypto";
import { createServer } from "node:http";
import type { AddressInfo } from "node:net";
import { createMail } from "./mail.ts";

type Summary = { ID: string; MessageID: string; Subject: string };

type Message = Summary & { Text: string; From: { Address: string }; To: { Address: string }[] };

const env: Record<string, string | undefined> = { ...process.env, ALLOWED_EMAIL_DOMAINS: "billfighter.local" };
const api = env.MAILPIT_API || "http://localhost:8025";

async function recent(): Promise<Summary[]> {
  const response = await fetch(`${api}/api/v1/messages?limit=200`);
  assert.ok(response.ok, `Mailpit API returned ${response.status}. Run \`docker compose up -d --wait\`.`);
  return ((await response.json()) as { messages: Summary[] }).messages;
}

const remove = (id: string) =>
  fetch(`${api}/api/v1/messages`, {
    method: "DELETE",
    headers: { "content-type": "application/json" },
    body: JSON.stringify({ IDs: [id] }),
  });

/** Sends through real Mailpit and reads the message back. Mailpit never relays, so nothing leaves this machine. */
export default async function check() {
  const mail = createMail(env);
  const subject = `mail check ${randomUUID()}`;

  const { id } = await mail.send({ to: "owner@billfighter.local", subject, text: "check body" });
  const summary = (await recent()).find((message) => message.MessageID === id);
  assert.ok(summary, `message ${id} is not in Mailpit`);
  try {
    const message = (await (await fetch(`${api}/api/v1/message/${summary.ID}`)).json()) as Message;
    assert.equal(message.Subject, subject);
    assert.equal(message.Text.trim(), "check body");
    assert.equal(message.From.Address, env.COMPANY_EMAIL || "bills@billfighter.local");
    assert.deepEqual(message.To.map((to) => to.Address), ["owner@billfighter.local"]);
  } finally {
    await remove(summary.ID);
  }

  const refused = `refused ${randomUUID()}`;
  for (const to of ["someone@example.com", "owner@billfighter.local, someone@example.com"]) {
    await assert.rejects(mail.send({ to, subject: refused, text: "x" }), /outside ALLOWED_EMAIL_DOMAINS/);
  }
  assert.ok(!(await recent()).some((message) => message.Subject === refused), "a refused message reached Mailpit");

  await assert.rejects(
    createMail({ ...env, SMTP_HOST: "smtp.example.com" }).send({ to: "owner@billfighter.local", subject: "x", text: "x" }),
    /not local Mailpit/,
  );

  let hits = 0;
  const server = createServer((_request, response) => {
    hits++;
    response.end("x");
  });
  await new Promise<void>((resolve) => server.listen(0, "127.0.0.1", resolve));
  try {
    const { port } = server.address() as AddressInfo;
    const attachments = [{ filename: "x.txt", path: `http://127.0.0.1:${port}/x.txt` }];
    await assert.rejects(mail.send({ to: "owner@billfighter.local", subject: refused, text: "x", attachments }));
    assert.equal(hits, 0, "an attachment URL was fetched");
  } finally {
    server.close();
  }

  const inbound = { messageId: "m1", from: "a@b.local", to: "c@d.local", subject: "s", text: "t" };
  assert.deepEqual(mail.parseInbound(inbound), inbound);
  assert.throws(() => mail.parseInbound({ ...inbound, messageId: undefined }));
  assert.throws(() => mail.parseInbound({ ...inbound, extra: 1 }));
}
