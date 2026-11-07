import { mkdtempSync, readFileSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { runEventLog } from "./run-log.ts";

describe("runEventLog", () => {
  let dir: string;
  beforeEach(() => {
    dir = mkdtempSync(join(tmpdir(), "run-events-"));
    vi.spyOn(console, "info").mockImplementation(() => {});
  });
  afterEach(() => {
    vi.restoreAllMocks();
    rmSync(dir, { recursive: true });
  });

  it("keeps what happened, and no tool data", () => {
    const log = runEventLog("run-1", dir);
    log({ type: "text", agent: "ceo", text: "Starting." });
    log({ type: "tool_call", agent: "collector", tool: "download_bills", input: { password: "hunter2" } });
    log({ type: "tool_result", agent: "collector", tool: "download_bills", output: "account BT-1" });
    log({ type: "denied", agent: "negotiator", tool: "call_provider", reason: "not approved" });
    log({ type: "result", status: "error", costUsd: 0.25 });

    const lines = readFileSync(join(dir, "run-1.log"), "utf8").trimEnd().split("\n");
    expect(lines.map((line) => line.replace(/^\S+ /, ""))).toEqual([
      "[ceo] Starting.",
      "[collector] calls download_bills",
      "[negotiator] denied call_provider: not approved",
      "Run ended: error, estimated cost $0.2500",
    ]);
    expect(console.info).toHaveBeenCalledWith("run-1 [ceo] Starting.");
  });

  it("never throws when the file cannot be written, and warns once", () => {
    const warn = vi.spyOn(console, "warn").mockImplementation(() => {});
    const notADir = join(dir, "file");
    writeFileSync(notADir, "");
    const log = runEventLog("run-1", notADir);
    expect(() => log({ type: "text", agent: "ceo", text: "a" })).not.toThrow();
    log({ type: "text", agent: "ceo", text: "b" });
    expect(warn).toHaveBeenCalledOnce();
    expect(console.info).toHaveBeenCalledTimes(2);
  });

  it("keeps a run id inside the log folder", () => {
    runEventLog("../escape", dir)({ type: "text", agent: "ceo", text: "a" });
    expect(readFileSync(join(dir, "..%2Fescape.log"), "utf8")).toContain("[ceo] a");
  });
});
