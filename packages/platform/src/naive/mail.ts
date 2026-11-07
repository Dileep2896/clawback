import { randomUUID } from "node:crypto";
import { allowlistFromEnv, isAllowedEmail } from "@bill-fighter/shared/allowlist";
import { createMail as createLocalMail } from "../local/mail.ts";
import type { InboundEmail, Mail } from "../types.ts";
import { naiveClient, need, seg } from "./client.ts";
import { createIdentity } from "./identity.ts";

type Env = Record<string, string | undefined>;

export type InboundMessage = {
  id: string;
  channel: "email" | "sms";
  endpoint_id: string;
  from: string;
  to: string;
  subject: string | null;
  text: string;
  read_at: string | null;
};

export type NaiveMail = Mail & {
  /** Hands each unread email to bills@ to onEmail, oldest first, then marks it read. A throw leaves it unread for the next poll. */
  pollInbound(onEmail: (email: InboundEmail) => Promise<void>): Promise<number>;
};

/**
 * Sends from our bills@ inbox (NAIVE_INBOX_ID). naïve has no inbound-mail webhook, and the inbox is made with wake: false
 * so no naïve session starts on mail; pollInbound reads the stored feed instead.
 */
export function createMail(env: Env = process.env): NaiveMail {
  const call = naiveClient(env);
  const identity = createIdentity(env);
  const identityPath = () => `/identities/${seg(need(env, "NAIVE_IDENTITY_ID"))}`;
  // The webhook body shape does not change between platforms, so the local schema is the one schema.
  const { parseInbound } = createLocalMail(env);

  return {
    async send({ to, from, subject, text, html, attachments }) {
      if (/[,;<>\s]/.test(to) || !isAllowedEmail(allowlistFromEnv(env), to)) {
        throw new Error(`Mail refused: ${to} is outside ALLOWED_EMAIL_DOMAINS`);
      }
      // Refused, never dropped: naïve sends plain text only.
      if (html !== undefined || (attachments?.length ?? 0) > 0) {
        throw new Error("Mail refused: naïve sends plain text only, so html and attachments cannot be sent");
      }
      const { email } = await identity.get();
      // naïve sends only from our own inboxes; demo-start's provider sender keeps local delivery (orchestrator's ruling).
      if (from !== undefined && from.trim().toLowerCase() !== email.toLowerCase()) {
        throw new Error(`Mail refused: naïve sends only from ${email}, not "${from}"`);
      }
      const receipt = await call<{ accepted: boolean }>("POST", `${identityPath()}/emails/${seg(need(env, "NAIVE_INBOX_ID"))}/send`, {
        to: [to],
        subject,
        text,
      });
      if (!receipt.accepted) throw new Error(`naïve did not accept the mail to ${to}`);
      // naïve deliberately returns no message id, and inbound dedupe needs one unique per send.
      return { id: `naive-${randomUUID()}` };
    },

    parseInbound,

    // shortcut: reads one page of 100 messages; page through with next_cursor if a poll ever falls that far behind.
    async pollInbound(onEmail) {
      const inbox = need(env, "NAIVE_INBOX_ID");
      const page = await call<{ data: InboundMessage[] }>("GET", `${identityPath()}/messages?channel=email&limit=100`);
      // The feed is newest first; other inboxes of the persona (the Linda stand-in) are not ours to consume.
      const unread = page.data.filter((m) => m.channel === "email" && m.endpoint_id === inbox && !m.read_at).reverse();
      for (const message of unread) {
        await onEmail(parseInbound({ messageId: message.id, from: message.from, to: message.to, subject: message.subject ?? "", text: message.text }));
        await call("POST", `${identityPath()}/messages/${seg(message.id)}/read`, { read: true });
      }
      return unread.length;
    },
  };
}

export default createMail();
