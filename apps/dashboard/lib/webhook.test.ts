import { createServer } from "node:http";
import type { AddressInfo } from "node:net";
import { afterAll, describe, expect, it } from "vitest";

// Never replies, so a call to it can only end by timing out.
const server = createServer(() => {});
await new Promise<void>((resolve) => server.listen(0, "127.0.0.1", resolve));
afterAll(() => {
  server.closeAllConnections();
  server.close();
});

describe("callWebhook", () => {
  it("turns a service that never answers into a 504, and one that is not running into a 503", async () => {
    process.env.WEBHOOK_URL = `http://127.0.0.1:${(server.address() as AddressInfo).port}`;
    const { callWebhook, WEBHOOK_DOWN } = await import("./webhook.ts");
    expect(await callWebhook("/parse-upload", {}, 100)).toEqual({ ok: false, status: 504, body: { error: "timeout" } });

    server.close();
    server.closeAllConnections();
    expect(await callWebhook("/parse-upload", {}, 1000)).toEqual({ ok: false, status: 503, body: { error: WEBHOOK_DOWN } });
  });
});
