import { describe, expect, it, vi } from "vitest";
import { LINE_NUMBER } from "../line/script.ts";
import { retellClient } from "./retell.ts";

const ALLOWED = { callNumbers: [LINE_NUMBER], emailDomains: [], portalOrigins: [] };

describe("retellClient", () => {
  it.each(["+15550003333", "16502522121", "", undefined, 16502522121])("never dials %s", async (to_number) => {
    const fetchStub = vi.fn<typeof fetch>();
    await expect(retellClient("key", ALLOWED, fetchStub)("POST", "/v2/create-phone-call", { to_number })).rejects.toThrow("not on the allowlist");
    expect(fetchStub).not.toHaveBeenCalled();
  });

  it("never dials with an empty allowlist", async () => {
    const fetchStub = vi.fn<typeof fetch>();
    const client = retellClient("key", { ...ALLOWED, callNumbers: [] }, fetchStub);
    await expect(client("POST", "/v2/create-phone-call", { to_number: LINE_NUMBER })).rejects.toThrow("not on the allowlist");
    expect(fetchStub).not.toHaveBeenCalled();
  });

  it.each(["/create-phone-call", "/v2/create-batch-call", "/v2/CREATE-PHONE-CALL", "/v2/create-web-call"])("refuses the other way to place a call, %s", async (path) => {
    const fetchStub = vi.fn<typeof fetch>();
    await expect(retellClient("key", ALLOWED, fetchStub)("POST", path, { to_number: "+15550003333" })).rejects.toThrow("Refused");
    expect(fetchStub).not.toHaveBeenCalled();
  });

  it("dials the allowed number", async () => {
    const fetchStub = vi.fn<typeof fetch>().mockResolvedValue(Response.json({ call_id: "c" }));
    await expect(retellClient("key", ALLOWED, fetchStub)("POST", "/v2/create-phone-call", { to_number: LINE_NUMBER })).resolves.toEqual({ call_id: "c" });
    expect(fetchStub.mock.calls[0]?.[0]).toBe("https://api.retellai.com/v2/create-phone-call");
  });

  it("can stop a call, which answers with no body", async () => {
    const fetchStub = vi.fn<typeof fetch>().mockResolvedValue(new Response(null, { status: 204 }));
    await expect(retellClient("key", ALLOWED, fetchStub)("POST", "/v2/stop-call/c")).resolves.toBeNull();
  });

  it("gives every request a timeout signal", async () => {
    const fetchStub = vi.fn<typeof fetch>().mockImplementation(async () => Response.json({}));
    const client = retellClient("key", ALLOWED, fetchStub);
    await client("POST", "/v2/create-phone-call", { to_number: LINE_NUMBER });
    await client("GET", "/v2/get-call/c");
    await client("PATCH", "/update-agent/a", {});
    for (const [, init] of fetchStub.mock.calls) expect(init?.signal).toBeInstanceOf(AbortSignal);
  });

  it("gives up on a request that never answers, and aborts it", async () => {
    const fetchStub = vi.fn<typeof fetch>(() => new Promise(() => {}));
    await expect(retellClient("key", ALLOWED, fetchStub)("GET", "/v2/get-call/c", undefined, 10)).rejects.toThrow("no answer in 10 ms");
    expect(fetchStub.mock.calls[0]?.[1]?.signal?.aborted).toBe(true);
  });

  it("gives up on a response whose body never finishes", async () => {
    const fetchStub = vi.fn<typeof fetch>().mockResolvedValue(new Response(new ReadableStream()));
    await expect(retellClient("key", ALLOWED, fetchStub)("GET", "/v2/get-call/c", undefined, 10)).rejects.toThrow("no answer in 10 ms");
  });

  it("keeps the key out of error messages", async () => {
    const fetchStub = vi.fn<typeof fetch>().mockResolvedValue(new Response("nope", { status: 401 }));
    const error = await retellClient("secret-key", ALLOWED, fetchStub)("GET", "/v2/get-call/c").catch((e: Error) => e.message);
    expect(error).toBe("Retell GET /v2/get-call/c: HTTP 401: nope");
  });
});
