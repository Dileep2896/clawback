import { allowlistFromEnv, isAllowedEmail } from "@bill-fighter/shared/allowlist";
import nodemailer from "nodemailer";
import { z } from "zod";
import type { Mail } from "../types.ts";
import { createIdentity } from "./identity.ts";

// Mailpit only: a mistyped SMTP_HOST must not turn the local adapter into a real sender.
const LOCAL_HOSTS = ["localhost", "127.0.0.1"];

const inboundEmail = z.strictObject({
  messageId: z.string().min(1),
  from: z.string().min(1),
  to: z.string().min(1),
  subject: z.string(),
  text: z.string(),
});

export function createMail(env: Record<string, string | undefined> = process.env): Mail {
  return {
    async send({ to, from, subject, text, html, attachments, inReplyTo }) {
      // Nodemailer splits an address on these, so the part the allowlist checked may not be the only recipient.
      if (/[,;<>\s]/.test(to) || !isAllowedEmail(allowlistFromEnv(env), to)) {
        throw new Error(`Mail refused: ${to} is outside ALLOWED_EMAIL_DOMAINS`);
      }
      const host = env.SMTP_HOST || "localhost";
      if (!LOCAL_HOSTS.includes(host)) {
        throw new Error(`Mail refused: SMTP_HOST "${host}" is not local Mailpit`);
      }
      const sender = from ?? (await createIdentity(env).get()).email;
      const transport = nodemailer.createTransport({
        host,
        port: Number(env.SMTP_PORT || 1025),
        secure: false,
        ignoreTLS: true,
        // An attachment path may be a URL in nodemailer, and this adapter must not fetch from the internet.
        disableUrlAccess: true,
      });
      const info = await transport.sendMail({
        from: sender,
        to,
        // Explicit, so the validated address is the only one ever handed to SMTP.
        envelope: { from: sender, to },
        subject,
        text,
        html,
        attachments,
        ...(inReplyTo ? { inReplyTo: `<${inReplyTo}>`, references: `<${inReplyTo}>` } : {}),
      });
      return { id: info.messageId.replace(/^<|>$/g, "") };
    },
    parseInbound: (payload) => inboundEmail.parse(payload),
  };
}

export default createMail();
