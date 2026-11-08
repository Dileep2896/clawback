import { afterEach, describe, expect, it, vi } from "vitest";
import { createMailpit } from "./mailpit.ts";

const env = { MAILPIT_API: "http://mailpit.test:8025" };
const message = { ID: "m1", MessageID: "abc@mailpit.test", From: { Address: "support@baytel.example" }, To: [{ Address: "bills@billfighter.local" }], Subject: "Re: x", Text: "ok" };

/** Stubs fetch with one response per path (JSON body, or a bare status), recording each request. */
function stubFetch(routes: Record<string, unknown>) {
  const seen: { url: string; init?: RequestInit }[] = [];
  vi.stubGlobal("fetch", async (url: URL, init?: RequestInit) => {
    seen.push({ url: String(url), init });
    const route = routes[url.pathname];
    if (route === undefined) return new Response("not found", { status: 404 });
    return typeof route === "number" ? new Response(null, { status: route }) : Response.json(route);
  });
  return seen;
}

afterEach(() => vi.unstubAllGlobals());

describe("mailpit", () => {
  it("searches with the encoded query and passes the signal through", async () => {
    const seen = stubFetch({ "/api/v1/search": { messages: [{ ID: "m1", From: { Address: "a@b.example" }, Subject: "s", Read: false }] } });
    const signal = new AbortController().signal;
    expect(await createMailpit(env).search(`to:"a@b.example" is:unread`, signal)).toEqual([{ ID: "m1", From: { Address: "a@b.example" }, Subject: "s", Read: false }]);
    expect(seen[0]!.url).toBe("http://mailpit.test:8025/api/v1/search?limit=50&query=to%3A%22a%40b.example%22%20is%3Aunread");
    expect(seen[0]!.init?.signal).toBe(signal);
  });

  it("treats a null message list as no results", async () => {
    stubFetch({ "/api/v1/search": { messages: null } });
    expect(await createMailpit(env).search("x")).toEqual([]);
  });

  it("reads a message and takes In-Reply-To from its headers, without angle brackets", async () => {
    const seen = stubFetch({ "/api/v1/message/m1": message, "/api/v1/message/m1/headers": { "In-Reply-To": [" <req@mailpit.test> "] } });
    const signal = new AbortController().signal;
    expect(await createMailpit(env).read("m1", signal)).toEqual({ ...message, InReplyTo: "req@mailpit.test" });
    expect(seen.map(({ init }) => init?.signal)).toEqual([signal, signal]);
  });

  it("gives a null In-Reply-To when the header is missing", async () => {
    stubFetch({ "/api/v1/message/m1": message, "/api/v1/message/m1/headers": { Subject: ["Re: x"] } });
    expect((await createMailpit(env).read("m1")).InReplyTo).toBeNull();
  });

  it("rejects a response that does not match the expected shape", async () => {
    stubFetch({ "/api/v1/search": { messages: [{ ID: 1 }] }, "/api/v1/message/m1": { ID: "m1" }, "/api/v1/message/m1/headers": {} });
    await expect(createMailpit(env).search("x")).rejects.toThrow();
    await expect(createMailpit(env).read("m1")).rejects.toThrow();
  });

  it("throws on an HTTP error, naming the method and path", async () => {
    stubFetch({ "/api/v1/search": 500, "/api/v1/messages": 503 });
    await expect(createMailpit(env).search("x")).rejects.toThrow(/Mailpit GET \/api\/v1\/search.*: 500/);
    await expect(createMailpit(env).markRead(["m1"])).rejects.toThrow(/Mailpit PUT \/api\/v1\/messages: 503/);
  });

  it("marks messages read with one PUT, and sends nothing for an empty list", async () => {
    const seen = stubFetch({ "/api/v1/messages": 200 });
    await createMailpit(env).markRead([]);
    expect(seen).toEqual([]);
    await createMailpit(env).markRead(["m1", "m2"]);
    expect(seen[0]!.init).toMatchObject({ method: "PUT", body: JSON.stringify({ IDs: ["m1", "m2"], Read: true }) });
  });

  it("rejects with the abort reason when the signal fires", async () => {
    vi.stubGlobal("fetch", (_url: URL, init?: RequestInit) => new Promise((_resolve, reject) => init?.signal?.addEventListener("abort", () => reject(init.signal!.reason))));
    await expect(createMailpit(env).search("x", AbortSignal.timeout(5))).rejects.toMatchObject({ name: "TimeoutError" });
  });
});
