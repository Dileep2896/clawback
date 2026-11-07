import { describe, expect, it, vi } from "vitest";
import { ASSISTANT_NAME, lineAssistant } from "./assistant.ts";
import { provision } from "./provision.ts";
import { LINE_NUMBER } from "./script.ts";
import type { Vapi } from "./vapi.ts";

const NUMBER = { id: "p1", number: LINE_NUMBER };
const ATTACH = ["PATCH", "/phone-number/p1", { assistantId: "a1" }];
const DETACH = ["PATCH", "/phone-number/p1", { assistantId: null }];
const UNSAFE = { forwardingPhoneNumber: "+15550100" };
const phoneWrites = (vapi: ReturnType<typeof account>) =>
  vapi.mock.calls.filter(([method, path]) => method === "PATCH" && path.startsWith("/phone-number"));

// A stub account. Any request it does not expect throws, so a stray request fails the test.
function account(options: { existing?: boolean; assistant?: object; number?: object; phone?: object } = {}) {
  const listed = { ...NUMBER, ...options.number };
  let current: object = listed;
  const saved = { id: "a1", ...lineAssistant(), ...options.assistant };
  const others = [{ id: "riley", name: "Riley" }];
  return vi.fn<Vapi>(async (method, path, body) => {
    const route = `${method} ${path}`;
    if (route === "GET /phone-number") return [listed];
    if (route === "GET /assistant") return options.existing ? [...others, { id: "a1", name: ASSISTANT_NAME }] : others;
    if (route === "POST /assistant" || route === "PATCH /assistant/a1" || route === "GET /assistant/a1") return saved;
    if (route === "PATCH /phone-number/p1") {
      current = { ...current, ...(body as object) };
      return current;
    }
    if (route === "GET /phone-number/p1") return { ...current, ...options.phone };
    throw new Error(`unexpected request ${route}`);
  });
}

describe("provision", () => {
  it("creates the assistant and attaches it to the number", async () => {
    const vapi = account();
    await expect(provision(vapi)).resolves.toEqual({ assistantId: "a1", phoneId: "p1" });
    expect(vapi).toHaveBeenCalledWith("POST", "/assistant", lineAssistant());
    expect(vapi).toHaveBeenCalledWith("PATCH", "/phone-number/p1", { assistantId: "a1" });
  });

  it("updates in place on a re-run and leaves other assistants alone", async () => {
    const vapi = account({ existing: true });
    await provision(vapi);
    expect(vapi).toHaveBeenCalledWith("PATCH", "/assistant/a1", lineAssistant());
    expect(vapi.mock.calls.some(([method, path]) => method !== "GET" && path.includes("riley"))).toBe(false);
  });

  it("only ever touches assistants and numbers", async () => {
    const vapi = account();
    await provision(vapi);
    for (const [, path] of vapi.mock.calls) expect(path).toMatch(/^\/(assistant|phone-number)/);
  });

  it("fails if Vapi changed a setting", async () => {
    await expect(provision(account({ assistant: { firstMessageMode: "assistant-speaks-first" } }))).rejects.toThrow(
      "read-back differs at .firstMessageMode",
    );
  });

  it("fails if the number has a forwarding route", async () => {
    await expect(provision(account({ phone: { fallbackDestination: { type: "number" } } }))).rejects.toThrow(
      "number has a fallback destination",
    );
  });

  it("fails if the attach did not stick", async () => {
    await expect(provision(account({ phone: { assistantId: "other" } }))).rejects.toThrow("not attached");
  });

  it("never attaches an assistant that fails its read-back", async () => {
    const vapi = account({ assistant: UNSAFE });
    await expect(provision(vapi)).rejects.toThrow("assistant has a forwarding number");
    expect(phoneWrites(vapi)).toEqual([]);
  });

  it("leaves a number on someone else's assistant alone when the read-back fails", async () => {
    const vapi = account({ assistant: UNSAFE, number: { assistantId: "other" } });
    await expect(provision(vapi)).rejects.toThrow("assistant has a forwarding number");
    expect(phoneWrites(vapi)).toEqual([]);
  });

  it("detaches an assistant that was already on the number when an update makes it unsafe", async () => {
    const vapi = account({ existing: true, assistant: UNSAFE, number: { assistantId: "a1" } });
    await expect(provision(vapi)).rejects.toThrow(/forwarding number[\s\S]*was detached/);
    expect(phoneWrites(vapi)).toEqual([DETACH]);
  });

  it("detaches when the check after attaching fails", async () => {
    const vapi = account({ phone: { squadId: "s1" } });
    await expect(provision(vapi)).rejects.toThrow(/routes to a squad[\s\S]*was detached/);
    expect(phoneWrites(vapi)).toEqual([ATTACH, DETACH]);
  });

  it("says so loudly if the detach does not stick", async () => {
    const vapi = account({ phone: { assistantId: "a1", squadId: "s1" } });
    await expect(provision(vapi)).rejects.toThrow("STILL ATTACHED");
  });

  it("says so loudly if the detach request fails", async () => {
    const stub = account({ phone: { squadId: "s1" } });
    const vapi = vi.fn<Vapi>(async (method, path, body) => {
      if ((body as { assistantId?: unknown } | undefined)?.assistantId === null) throw new Error("HTTP 400");
      return stub(method, path, body);
    });
    await expect(provision(vapi)).rejects.toThrow(/STILL ATTACHED.*HTTP 400/);
  });

  it("fails if the number is not on the account", async () => {
    const vapi = vi.fn<Vapi>(async () => []);
    await expect(provision(vapi)).rejects.toThrow("not on this Vapi account");
    expect(vapi).toHaveBeenCalledTimes(1);
  });
});
