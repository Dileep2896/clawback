import { type AddressInfo, createServer } from "node:net";
import { createInterface } from "node:readline";
import { describe, expect, it } from "vitest";
import { createMail } from "./mail.ts";

const env = { ALLOWED_EMAIL_DOMAINS: "billfighter.local" };
const email = { subject: "s", text: "t" };

/** A minimal SMTP server on this machine, recording the connections and envelope recipients nodemailer really sends. */
async function withSmtp(fn: (smtpEnv: typeof env & { SMTP_PORT: string }, seen: { connections: number; rcpt: string[] }) => Promise<void>) {
  const seen = { connections: 0, rcpt: [] as string[] };
  const server = createServer((socket) => {
    seen.connections++;
    socket.on("error", () => {});
    socket.write("220 test\r\n");
    let inData = false;
    createInterface({ input: socket }).on("line", (line) => {
      if (inData) {
        if (line !== ".") return;
        inData = false;
      }
      const rcpt = /^RCPT TO:<(.*)>/i.exec(line)?.[1];
      if (rcpt !== undefined) seen.rcpt.push(rcpt);
      inData = line === "DATA";
      socket.write(inData ? "354 go\r\n" : "250 ok\r\n");
    });
  });
  await new Promise<void>((resolve) => server.listen(0, "127.0.0.1", resolve));
  try {
    await fn({ ...env, SMTP_PORT: String((server.address() as AddressInfo).port) }, seen);
  } finally {
    server.close();
  }
}

describe("mail", () => {
  it.each(["a@example.com", "a@billfighter.local, b@example.com", "A <a@example.com>", "a@billfighter.local\nBcc: b@example.com"])(
    "refuses %j",
    async (to) => {
      await expect(createMail(env).send({ ...email, to })).rejects.toThrow(/ALLOWED_EMAIL_DOMAINS/);
    },
  );

  it.each([
    "unvalidated;owner@billfighter.local",
    "unvalidated,owner@billfighter.local",
    "x<owner@billfighter.local",
    "x>owner@billfighter.local",
    "x y@billfighter.local",
    "x\ty@billfighter.local",
    "x\ny@billfighter.local",
  ])("refuses %j before opening a connection", async (to) => {
    await withSmtp(async (smtpEnv, seen) => {
      await expect(createMail(smtpEnv).send({ ...email, from: "bills@billfighter.local", to })).rejects.toThrow(/Mail refused/);
      expect(seen.connections).toBe(0);
    });
  });

  it("sends a normal address with exactly one envelope recipient", async () => {
    await withSmtp(async (smtpEnv, seen) => {
      await createMail(smtpEnv).send({ ...email, from: "bills@billfighter.local", to: "owner@billfighter.local" });
      expect(seen.rcpt).toEqual(["owner@billfighter.local"]);
    });
  });

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
