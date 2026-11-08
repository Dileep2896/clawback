// With SANDBOX=1 no run, call, SMS, email, invoice or parser request can start: every door refuses before it reaches out.
import { afterAll, beforeAll, describe, expect, it, vi } from "vitest";

const noFetch = vi.fn<typeof fetch>(() => Promise.reject(new Error("fetch must not be called")));

beforeAll(() => {
  process.env.SANDBOX = "1";
  vi.stubGlobal("fetch", noFetch);
});
afterAll(() => {
  delete process.env.SANDBOX;
  vi.unstubAllGlobals();
});

// Throws on any use, so a door that touched the database before refusing would fail differently.
const untouchable = new Proxy({}, { get: () => { throw new Error("the database must not be touched"); } });

describe("SANDBOX=1", () => {
  it("refuses every dashboard request to the agents service: start-audit, parse-upload, connect-portal", async () => {
    const { callWebhook, SANDBOX_TEXT } = await import("../apps/dashboard/lib/webhook.ts");
    for (const path of ["/start-audit", "/parse-upload", "/connect-portal"]) {
      expect(await callWebhook(path, {})).toEqual({ ok: false, status: 403, body: { error: SANDBOX_TEXT } });
    }
    expect(noFetch).not.toHaveBeenCalled();
  });

  it("will not load the adapters that run agents, mail, text, pay, browse, parse or schedule", async () => {
    const { createPlatform, SANDBOX_REFUSED } = await import("@bill-fighter/platform/factory");
    const platform = createPlatform("local");
    for (const key of SANDBOX_REFUSED) await expect(platform[key](), key).rejects.toThrow(/sandbox/);
    expect(SANDBOX_REFUSED).toEqual(expect.arrayContaining(["agentRuntime", "mail", "sms", "card", "llm", "scheduler", "browser"]));
  });

  it("will not start a run", async () => {
    const { executeRun } = await import("@bill-fighter/agents/run");
    await expect(
      executeRun({ db: untouchable as never, runId: "r", prompt: "p", runtime: untouchable as never, audit: untouchable as never, tools: [] }),
    ).rejects.toThrow(/sandbox/);
  });

  it("will not make a Stripe client, so no invoice", async () => {
    const { stripeClient } = await import("@bill-fighter/agents/tools/finance-invoice");
    expect(() => stripeClient("sk_test_x")).toThrow(/sandbox/);
  });

  it("will not dial or run the voice line", async () => {
    const { retellClient } = await import("@bill-fighter/voice/live/caller/retell");
    const { vapiClient } = await import("@bill-fighter/voice/live/line/vapi");
    await expect(retellClient("k", { callNumbers: ["+15550001111"] } as never, noFetch)("POST", "/v2/create-phone-call", { to_number: "+15550001111" })).rejects.toThrow(/sandbox/);
    await expect(vapiClient("k", noFetch)("GET", "/assistant")).rejects.toThrow(/sandbox/);
    expect(noFetch).not.toHaveBeenCalled();
  });

  it("will not start the webhook service", async () => {
    await expect(import("../services/webhooks/src/main.ts")).rejects.toThrow(/sandbox/);
  });
});
