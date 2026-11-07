import { describe, expect, it } from "vitest";
import { createNaiveApi } from "./runtime-http.ts";

const never = () => new Promise<never>(() => {});

describe("naïve HTTP client", () => {
  it("gives up on a request that never answers, and aborts it", async () => {
    let signal: AbortSignal | undefined;
    const api = createNaiveApi((async (_: unknown, init?: RequestInit) => ((signal = init?.signal ?? undefined), never())) as typeof fetch, () => "k", 20);
    await expect(api("/sessions/s/cancel", { method: "POST" })).rejects.toMatchObject({ code: "timeout" });
    expect(signal?.aborted).toBe(true);
  });

  it("gives up on a response body that never ends", async () => {
    const api = createNaiveApi((async () => ({ ok: true, status: 200, text: never }) as unknown as Response) as typeof fetch, () => "k", 20);
    await expect(api("/sessions/s")).rejects.toMatchObject({ code: "timeout" });
  });

  it("still returns a prompt answer", async () => {
    const api = createNaiveApi((async () => new Response('{"id":"x"}')) as typeof fetch, () => "k", 20);
    await expect(api("/sessions/s")).resolves.toEqual({ id: "x" });
  });
});
