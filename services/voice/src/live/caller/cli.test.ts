import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { CALLER_NUMBER } from "./agent.ts";

const RETELL_START_MS = Date.parse("2026-11-06T12:00:00Z");
const argv = process.argv;

// Runs the real script against stubs: anything but these two read-backs fails the test.
async function readback(retellCall: Record<string, unknown>, vapiCall: Record<string, unknown>) {
  vi.stubGlobal("fetch", async (input: string | URL) => {
    const url = String(input);
    if (url === "https://api.retellai.com/v2/get-call/r1") return Response.json(retellCall);
    if (url === "https://api.vapi.ai/call?limit=1") return Response.json([{ id: "v1", customer: { number: CALLER_NUMBER }, messages: [], ...vapiCall }]);
    throw new Error(`Unexpected request to ${url}`);
  });
  process.argv = ["node", "cli.ts", "readback", "r1"];
  await import("./cli.ts");
}

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
  });
});
