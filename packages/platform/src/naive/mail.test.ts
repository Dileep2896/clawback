import { createServer, type IncomingMessage } from "node:http";
import type { AddressInfo } from "node:net";
import { afterAll, beforeAll, beforeEach, describe, expect, it } from "vitest";
import { createIdentity } from "./identity.ts";
import { createMail, type InboundMessage } from "./mail.ts";

type Seen = { method: string; url: string; auth: string; idempotency: string; body: unknown };

const seen: Seen[] = [];
let feed: InboundMessage[] = [];
let failSend = false;

const server = createServer(async (request: IncomingMessage, response) => {
  let raw = "";
  for await (const chunk of request) raw += chunk;
  const { method = "", url = "" } = request;
  seen.push({ method, url, auth: request.headers.authorization ?? "", idempotency: String(request.headers["idempotency-key"] ?? ""), body: raw ? JSON.parse(raw) : undefined });
  const json = (status: number, body: unknown) => response.writeHead(status, { "content-type": "application/json" }).end(JSON.stringify(body));
  if (url === "/v1/identities/idn_1") return json(200, { id: "idn_1", name: "Clawback" });
  if (url.startsWith("/v1/identities/idn_1/emails?")) {
    return json(200, { data: [{ id: "eml_bills", address: "bills@sys.test" }, { id: "eml_linda", address: "linda@sys.test" }] });
  }
  if (url === "/v1/identities/idn_1/emails/eml_bills/send") {
    if (failSend) return json(409, { error: { code: "job_not_ready", message: "domain not verified" } });
    return json(202, { accepted: true });
  }
  if (url.startsWith("/v1/identities/idn_1/messages?")) return json(200, { data: feed });
  if (/^\/v1\/identities\/idn_1\/messages\/[^/]+\/read$/.test(url)) return json(200, {});
  json(404, { error: { code: "not_found", message: "no route" } });
});

let env: Record<string, string>;

beforeAll(async () => {
  await new Promise<void>((resolve) => server.listen(0, "127.0.0.1", resolve));
  env = {
    NAIVE_API_URL: `http://127.0.0.1:${(server.address() as AddressInfo).port}`,
    NAIVE_API_KEY: "sk_test_key",
    NAIVE_IDENTITY_ID: "idn_1",
    NAIVE_INBOX_ID: "eml_bills",
    ALLOWED_EMAIL_DOMAINS: "sys.test",
  };
});
afterAll(() => void server.close());
beforeEach(() => {
  seen.length = 0;
  feed = [];
  failSend = false;
});

const sends = () => seen.filter((request) => request.url.endsWith("/send"));

describe("naive identity", () => {
  it("reads the persona name and the bills@ address", async () => {
    expect(await createIdentity(env).get()).toEqual({ companyName: "Clawback", email: "bills@sys.test", phone: "+15550002222" });
    expect(seen.every((request) => request.auth === "Bearer sk_test_key")).toBe(true);
  });

  it("names a missing variable, not a value", async () => {
    await expect(createIdentity({ ...env, NAIVE_INBOX_ID: "" }).get()).rejects.toThrow("NAIVE_INBOX_ID is not set");
  });

  it("refuses to send the key to a non-https remote URL", async () => {
    await expect(createIdentity({ ...env, NAIVE_API_URL: "http://example.com" }).get()).rejects.toThrow(/must be https/);
  });
});

describe("naive mail", () => {
  it("sends plain text from bills@ with an idempotency key and a unique id", async () => {
    const mail = createMail(env);
    const first = await mail.send({ to: "linda@sys.test", subject: "s", text: "t" });
    const second = await mail.send({ to: "linda@sys.test", from: "bills@sys.test", subject: "s", text: "t" });
    expect(first.id).toMatch(/^naive-/);
    expect(second.id).not.toBe(first.id);
    expect(sends().map((request) => request.body)).toEqual([
      { to: ["linda@sys.test"], subject: "s", text: "t" },
      { to: ["linda@sys.test"], subject: "s", text: "t" },
    ]);
    expect(sends().every((request) => request.method === "POST" && request.idempotency.length > 0)).toBe(true);
  });

  it.each([
    [{ to: "a@example.com" }, /ALLOWED_EMAIL_DOMAINS/],
    [{ to: "a@sys.test, b@example.com" }, /ALLOWED_EMAIL_DOMAINS/],
    [{ to: "a@sys.test\nBcc: b@example.com" }, /ALLOWED_EMAIL_DOMAINS/],
    [{ to: "a@sys.test", from: "BayCurrent Electric <billing@baycurrent.example>" }, /sends only from bills@sys.test/],
    [{ to: "a@sys.test", html: "<p>t</p>" }, /plain text only/],
    [{ to: "a@sys.test", attachments: [{ filename: "a", path: "/a" }] }, /plain text only/],
  ])("refuses %j without sending", async (fields, error) => {
    await expect(createMail(env).send({ subject: "s", text: "t", ...fields })).rejects.toThrow(error);
    expect(sends()).toEqual([]);
  });

  it("surfaces naïve's error code without the key", async () => {
    failSend = true;
    const failure = createMail(env).send({ to: "linda@sys.test", subject: "s", text: "t" });
    await expect(failure).rejects.toThrow(/409 job_not_ready/);
    await expect(failure).rejects.not.toThrow(/sk_test_key/);
  });

  it("polls unread bills@ mail oldest first, marks it read, and leaves other inboxes alone", async () => {
    const message = (id: string, extra: Partial<InboundMessage> = {}): InboundMessage => ({
      id, channel: "email", endpoint_id: "eml_bills", from: "a@sys.test", to: "bills@sys.test", subject: `s-${id}`, text: "t", read_at: null, ...extra,
    });
    feed = [message("inb_new"), message("inb_old"), message("inb_read", { read_at: "2026-11-07T00:00:00Z" }), message("inb_linda", { endpoint_id: "eml_linda" })];
    const got: string[] = [];
    const count = await createMail(env).pollInbound(async (email) => void got.push(email.messageId));
    expect(count).toBe(2);
    expect(got).toEqual(["inb_old", "inb_new"]);
    expect(seen.filter((request) => request.url.endsWith("/read")).map((request) => [request.url, request.body])).toEqual([
      ["/v1/identities/idn_1/messages/inb_old/read", { read: true }],
      ["/v1/identities/idn_1/messages/inb_new/read", { read: true }],
    ]);
  });

  it("leaves a message unread when the handler throws", async () => {
    feed = [{ id: "inb_1", channel: "email", endpoint_id: "eml_bills", from: "a@sys.test", to: "bills@sys.test", subject: null, text: "t", read_at: null }];
    await expect(createMail(env).pollInbound(async () => { throw new Error("handler down"); })).rejects.toThrow("handler down");
    expect(seen.some((request) => request.url.endsWith("/read"))).toBe(false);
  });
});
