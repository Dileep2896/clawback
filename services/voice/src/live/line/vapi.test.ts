import { describe, expect, it, vi } from "vitest";
import { vapiClient } from "./vapi.ts";

describe("vapiClient", () => {
  it("refuses to place a call, before any request goes out", async () => {
    const fetchStub = vi.fn<typeof fetch>();
    const vapi = vapiClient("key", fetchStub);
    await expect(vapi("POST", "/call", { phoneNumberId: "x" })).rejects.toThrow("never place a call");
    await expect(vapi("POST", "/call/phone", {})).rejects.toThrow("never place a call");
    expect(fetchStub).not.toHaveBeenCalled();
  });

  it("still reads a past call", async () => {
    const fetchStub = vi.fn<typeof fetch>().mockResolvedValue(new Response("{}"));
    await vapiClient("key", fetchStub)("GET", "/call/abc");
    expect(fetchStub.mock.calls[0]?.[0]).toBe("https://api.vapi.ai/call/abc");
  });

  it("keeps a 402 outside chat as a plain HTTP error", async () => {
    const fetchStub = vi.fn<typeof fetch>().mockResolvedValue(new Response("nope", { status: 402 }));
    const error = await vapiClient("key", fetchStub)("GET", "/assistant").catch((e: Error) => e.message);
    expect(error).toBe("Vapi GET /assistant: HTTP 402: nope");
  });

  it("keeps the key out of error messages", async () => {
    const fetchStub = vi.fn<typeof fetch>().mockResolvedValue(new Response("nope", { status: 400 }));
    const error = await vapiClient("secret-key", fetchStub)("GET", "/assistant").catch((e: Error) => e.message);
    expect(error).toContain("HTTP 400");
    expect(error).not.toContain("secret-key");
  });
});
