import { describe, expect, it, vi } from "vitest";
import { ASSISTANT_NAME, lineAssistant } from "./assistant.ts";
import { provision } from "./provision.ts";
import { LINE_NUMBER } from "./script.ts";
import type { Vapi } from "./vapi.ts";

const NUMBER = { id: "p1", number: LINE_NUMBER };

// A stub account. Any request it does not expect throws, so a stray request fails the test.
function account(options: { existing?: boolean; assistant?: object; phone?: object } = {}) {
  const saved = { id: "a1", ...lineAssistant(), ...options.assistant };
  const others = [{ id: "riley", name: "Riley" }];
  return vi.fn<Vapi>(async (method, path) => {
    const route = `${method} ${path}`;
    if (route === "GET /phone-number") return [NUMBER];
    if (route === "GET /assistant") return options.existing ? [...others, { id: "a1", name: ASSISTANT_NAME }] : others;
    if (route === "POST /assistant" || route === "PATCH /assistant/a1" || route === "GET /assistant/a1") return saved;
    if (route === "PATCH /phone-number/p1") return {};
    if (route === "GET /phone-number/p1") return { ...NUMBER, assistantId: "a1", ...options.phone };
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

  it("fails if the number is not on the account", async () => {
    const vapi = vi.fn<Vapi>(async () => []);
    await expect(provision(vapi)).rejects.toThrow("not on this Vapi account");
    expect(vapi).toHaveBeenCalledTimes(1);
  });
});
