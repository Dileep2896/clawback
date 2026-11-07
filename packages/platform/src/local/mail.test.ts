import { describe, expect, it } from "vitest";
import { createMail } from "./mail.ts";

const env = { ALLOWED_EMAIL_DOMAINS: "billfighter.local" };
const email = { subject: "s", text: "t" };

describe("mail", () => {
  it.each(["a@example.com", "a@billfighter.local, b@example.com", "A <a@example.com>", "a@billfighter.local\nBcc: b@example.com"])(
    "refuses %j",
    async (to) => {
      await expect(createMail(env).send({ ...email, to })).rejects.toThrow(/ALLOWED_EMAIL_DOMAINS/);
    },
  );

  it("refuses everyone when the allowlist is empty", async () => {
    await expect(createMail({}).send({ ...email, to: "a@billfighter.local" })).rejects.toThrow(/ALLOWED_EMAIL_DOMAINS/);
  });

  it("refuses an SMTP host that is not local", async () => {
    await expect(
      createMail({ ...env, SMTP_HOST: "smtp.example.com" }).send({ ...email, to: "a@billfighter.local" }),
    ).rejects.toThrow(/not local Mailpit/);
  });

  it("parses exactly the InboundEmail shape", () => {
    const inbound = { messageId: "m", from: "a@b.c", to: "d@e.f", subject: "", text: "" };
    expect(createMail(env).parseInbound(inbound)).toEqual(inbound);
    for (const bad of [null, "x", {}, { ...inbound, messageId: "" }, { ...inbound, text: 1 }, { ...inbound, extra: 1 }]) {
      expect(() => createMail(env).parseInbound(bad)).toThrow();
    }
  });
});
