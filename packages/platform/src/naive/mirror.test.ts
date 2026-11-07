import { afterEach, describe, expect, it } from "vitest";
import type { NaiveApi, NaiveRequest } from "./runtime-http.ts";
import { mirrorCard, setBoardOwner } from "./mirror.ts";

afterEach(() => setBoardOwner(null));

function recorder(fail = false) {
  const calls: { path: string; method?: string; body?: unknown }[] = [];
  const api = (async (path: string, request: NaiveRequest = {}) => {
    calls.push({ path, method: request.method, body: request.body });
    if (fail) throw new Error("boom");
    return { id: "crd_1" };
  }) as NaiveApi;
  return { api, calls };
}

describe("naïve board mirror", () => {
  it("copies a card unassigned, keyed by our id, and adds the note naïve needs for done", async () => {
    setBoardOwner("agt_ceo");
    const { api, calls } = recorder();
    await mirrorCard({ id: "card-1", title: "File the claim", status: "done", agent: "filer" }, api);
    expect(calls).toEqual([
      { path: "/boards/agt_ceo/cards", method: "POST", body: { key: "card-1", title: "File the claim", body: "Member: filer" } },
      { path: "/boards/agt_ceo/cards/crd_1", method: "PATCH", body: { status: "done", note: expect.any(String) } },
    ]);
  });

  it("does nothing without a run, and never throws", async () => {
    const idle = recorder();
    await mirrorCard({ id: "c", title: "t", status: "todo", agent: "a" }, idle.api);
    expect(idle.calls).toEqual([]);
    setBoardOwner("agt_ceo");
    await expect(mirrorCard({ id: "c", title: "t", status: "todo", agent: "a" }, recorder(true).api)).resolves.toBeUndefined();
  });
});
