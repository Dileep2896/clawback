import { describe, expect, it, vi } from "vitest";
import { rehearse, TURNS } from "./rehearse.ts";
import type { Vapi } from "./vapi.ts";

const reply = (content: string | null, cost?: number) => ({
  id: "chat",
  output: [{ role: "assistant", content }],
  ...(cost === undefined ? {} : { cost }),
});

describe("rehearse", () => {
  it("runs every turn in one chat and passes exact replies", async () => {
    const replies = TURNS.map((t) => reply(t.expected, 0.0001));
    const vapi = vi.fn<Vapi>(async () => replies.shift());
    const { results, costUsd, stoppedBecause } = await rehearse(vapi, "a1");
    expect(results.every((r) => r.ok)).toBe(true);
    expect(results).toHaveLength(TURNS.length);
    expect(costUsd).toBeCloseTo(0.0001 * TURNS.length);
    expect(stoppedBecause).toBeUndefined();
    expect(vapi.mock.calls[1]?.[2]).toMatchObject({ previousChatId: "chat" });
  });

  it("marks a reworded reply as failed", async () => {
    const vapi = vi.fn<Vapi>(async () => reply("Sure thing!", 0.0001));
    const { results } = await rehearse(vapi, "a1", [{ caller: "Hi", expected: "Exact words." }]);
    expect(results[0]?.ok).toBe(false);
  });

  it("stops above one cent", async () => {
    const vapi = vi.fn<Vapi>(async () => reply("x", 0.006));
    const { stoppedBecause, results } = await rehearse(vapi, "a1");
    expect(stoppedBecause).toBe("over the one cent limit");
    expect(results).toHaveLength(2);
  });

  it("stops when the cost is not reported", async () => {
    const vapi = vi.fn<Vapi>(async () => reply("x"));
    const { stoppedBecause, results } = await rehearse(vapi, "a1");
    expect(stoppedBecause).toBe("Vapi did not report a cost");
    expect(results).toHaveLength(1);
  });
});
