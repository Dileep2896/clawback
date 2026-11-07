import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { CALLER_NUMBER } from "./agent.ts";

const RETELL_START_MS = Date.parse("2026-11-06T12:00:00Z");
const argv = process.argv;

const requests: string[] = [];

// Runs the real script against stubs: anything but these read-backs fails the test. The list's `messages` is a string, as on the first real call.
async function run(args: string[], retellCall: Record<string, unknown>, vapiCall: Record<string, unknown>, details: Record<string, unknown> = {}) {
  requests.length = 0;
  vi.stubGlobal("fetch", async (input: string | URL) => {
    const url = String(input);
    requests.push(url);
    if (url === "https://api.retellai.com/v2/get-call/r1") return Response.json(retellCall);
    if (url === "https://api.vapi.ai/call?limit=1") return Response.json([{ id: "v1", customer: { number: CALLER_NUMBER }, messages: "not an array", ...vapiCall }]);
    if (url === "https://api.vapi.ai/call/v1") return Response.json({ id: "v1", status: "ended", cost: 0.19, messages: [], ...details });
    throw new Error(`Unexpected request to ${url}`);
  });
  process.argv = ["node", "cli.ts", ...args];
  await import("./cli.ts");
}
const readback = (retellCall: Record<string, unknown>, vapiCall: Record<string, unknown>) => run(["readback", "r1"], retellCall, vapiCall);

const startedAfter = (ms: number) => ({ startedAt: new Date(RETELL_START_MS + ms).toISOString() });
const retellCall = { call_status: "ended", start_timestamp: RETELL_START_MS };

beforeEach(() => {
  vi.resetModules();
  vi.stubEnv("RETELL_API_KEY", "stub-key");
  vi.stubEnv("VAPI_API_KEY", "stub-key");
  vi.stubEnv("ALLOWED_CALL_NUMBERS", "");
  vi.spyOn(console, "log").mockImplementation(() => {});
});
afterEach(() => {
  process.argv = argv;
  process.exitCode = undefined;
  vi.unstubAllEnvs();
  vi.unstubAllGlobals();
  vi.restoreAllMocks();
});

describe("readback", () => {
  it.each([
    ["at the same moment", 0],
    ["60 seconds after", 60_000],
    ["60 seconds before", -60_000],
  ])("goes on to check a Vapi call starting %s the Retell call", async (_, ms) => {
    await readback(retellCall, startedAfter(ms));
    expect(console.log).toHaveBeenCalledWith(expect.stringContaining("Vapi call v1"));
  });

  it.each([
    ["more than 60 seconds after", retellCall, startedAfter(60_001)],
    ["more than 60 seconds before", retellCall, startedAfter(-60_001)],
    ["with no start time", retellCall, {}],
    ["with a start time that is not a date", retellCall, { startedAt: "soon" }],
    ["against a Retell call with no start time", { call_status: "not_connected" }, startedAfter(0)],
  ])("fails on a Vapi call %s", async (_, retell, vapi) => {
    await expect(readback(retell, vapi)).rejects.toThrow("not within 60 seconds");
    expect(console.log).not.toHaveBeenCalledWith(expect.stringContaining("Vapi call v1"));
    expect(requests).not.toContain("https://api.vapi.ai/call/v1");
  });
});

describe("readback-line", () => {
  const args = ["readback-line", String(RETELL_START_MS)];

  it("reads Vapi's list and that one call once each, and never Retell", async () => {
    await run(args, retellCall, startedAfter(0));
    expect(requests).toEqual(["https://api.vapi.ai/call?limit=1", "https://api.vapi.ai/call/v1"]);
  });

  it("checks the messages from the call itself, not the list", async () => {
    const messages = [{ role: "bot", message: "Off the script.", time: 1, endTime: 2 }];
    await run(args, retellCall, startedAfter(0), { messages });
    expect(console.log).toHaveBeenCalledWith(expect.stringContaining('off script before the key press: "off the script"'));
    expect(process.exitCode).toBe(1);
  });

  it("still reports the cost when the call's messages are unusable", async () => {
    await expect(run(args, retellCall, startedAfter(0), { messages: "not an array" })).rejects.toThrow();
    expect(console.log).toHaveBeenCalledWith(expect.stringContaining("cost: $0.19"));
  });
});
