import { boardCards } from "@bill-fighter/db/schema";
import { seedRun, withTestDb } from "@bill-fighter/db/test-db";
import type { Llm } from "@bill-fighter/platform/types";
import { describe, expect, it, vi } from "vitest";
import { isPortalTimeout, reportProblem, reportStop, retryingCallLlm, stopMessage, withRetry } from "./retry.ts";

const SCHEMA = { type: "object" };
const timeout = () => new DOMException("late", "TimeoutError");

describe("withRetry", () => {
  const retryAll = { retryIf: () => true, delayMs: 0 };

  it("asks again once, and returns the second answer", async () => {
    const work = vi.fn<() => Promise<string>>().mockRejectedValueOnce(new Error("late")).mockResolvedValue("ok");
    await expect(withRetry(work, retryAll)).resolves.toBe("ok");
    expect(work).toHaveBeenCalledTimes(2);
  });

  it("gives up after the second try with the last error", async () => {
    const work = vi.fn<() => Promise<string>>().mockRejectedValue(new Error("late"));
    await expect(withRetry(work, retryAll)).rejects.toThrow("late");
    expect(work).toHaveBeenCalledTimes(2);
  });

  it("does not repeat a failure it was not told to retry", async () => {
    const work = vi.fn<() => Promise<string>>().mockRejectedValue(new Error("refused"));
    await expect(withRetry(work, { retryIf: () => false })).rejects.toThrow("refused");
    expect(work).toHaveBeenCalledOnce();
  });
});

describe("isPortalTimeout", () => {
  it.each(["locator.click: Timeout 30000ms exceeded.", "Timed out waiting for the portal to answer the login", "page.goto: net::ERR_CONNECTION_REFUSED at http://localhost:3001"])("retries %s", (text) => {
    expect(isPortalTimeout(new Error(text))).toBe(true);
  });

  it.each(["The portal refused the login: wrong password", "Browser refused http://x: outside ALLOWED_PORTAL_ORIGINS", "Not logged in to baytel in this run. Call portal_login first.", 'fillSecret failed for #username using vault entry "portal/baytel/username"'])("does not retry %s", (text) => {
    expect(isPortalTimeout(new Error(text))).toBe(false);
  });
});

describe("retryingCallLlm", () => {
  const llmOf = (structured: ReturnType<typeof vi.fn>) => retryingCallLlm({ structured } as unknown as Llm);

  it("sets a time limit and asks again after a model timeout", async () => {
    const structured = vi.fn().mockRejectedValueOnce(timeout()).mockResolvedValue({ move: "goodbye" });
    await expect(llmOf(structured).structured({ prompt: "x" }, SCHEMA)).resolves.toEqual({ move: "goodbye" });
    expect(structured).toHaveBeenCalledTimes(2);
    expect(structured.mock.calls[0]![0]).toMatchObject({ prompt: "x", timeoutMs: expect.any(Number) });
  });

  it("does not retry any other model failure", async () => {
    const structured = vi.fn().mockRejectedValue(new Error("Claude plan rate limit reached"));
    await expect(llmOf(structured).structured({ prompt: "x" }, SCHEMA)).rejects.toThrow("rate limit");
    expect(structured).toHaveBeenCalledOnce();
  });
});

describe("stopMessage", () => {
  it("says the budget figure is an estimate", () => {
    expect(stopMessage("over_budget")).toMatch(/estimated cost reached the run budget/);
    expect(stopMessage("over_budget")).toMatch(/is an estimate/);
  });

  it.each([
    ["The model did not answer for 180 s", /model did not answer in time/],
    ["Claude plan rate limit reached, resets soon", /rate limit/],
    ["Refusing to run: not the Claude Code login", /login check failed/],
  ])("explains %s", (reason, expected) => {
    expect(stopMessage("error", reason)).toMatch(expected);
  });

  it("never puts raw error text on the screen", () => {
    const text = stopMessage("error", "Retell call call_abc123 failed for sk_test_secret");
    expect(text).not.toMatch(/call_abc123|sk_test_secret/);
    expect(text).toMatch(/server log/);
  });
});

describe("reporting on the board", () => {
  it("adds one card for a message however many times it is reported", () =>
    withTestDb("retry_report", async (db) => {
      await seedRun(db, "r1");
      await reportProblem(db, "r1", "The baytel portal did not answer");
      await reportProblem(db, "r1", "The baytel portal did not answer");
      expect(await db.select().from(boardCards)).toMatchObject([{ agent: "run", status: "blocked", title: "The baytel portal did not answer" }]);
    }));

  it("blocks work in progress and leaves finished cards alone", () =>
    withTestDb("retry_stop", async (db) => {
      await seedRun(db, "r1");
      await db.insert(boardCards).values([
        { runId: "r1", agent: "auditor", title: "Audit", status: "done" },
        { runId: "r1", agent: "negotiator", title: "Call", status: "doing" },
      ]);
      await reportStop(db, "r1", "Stopped");
      const cards = await db.select().from(boardCards);
      expect(Object.fromEntries(cards.map((card) => [card.title, card.status]))).toEqual({ Audit: "done", Call: "blocked", Stopped: "blocked" });
    }));

  it("logs a failed report rather than hiding the failure it was reporting", () =>
    withTestDb("retry_report_fails", async (db) => {
      const logged = vi.spyOn(console, "error").mockImplementation(() => {});
      await expect(reportProblem(db, "no-such-run", "x")).resolves.toBeUndefined();
      expect(logged).toHaveBeenCalledOnce();
      logged.mockRestore();
    }));
});
