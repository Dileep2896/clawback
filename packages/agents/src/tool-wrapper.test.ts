import type { Audit, RunEvent } from "@bill-fighter/platform/types";
import type { Allowlist } from "@bill-fighter/shared/allowlist";
import { describe, expect, it, vi } from "vitest";
import { z } from "zod";
import { auditDenied, defineTool, type Target, wrapTool } from "./tool-wrapper.ts";

const allowlist: Allowlist = {
  callNumbers: ["+15550003333"],
  emailDomains: ["billfighter.local"],
  portalOrigins: ["http://localhost:3001"],
};
const CTX = { runId: "run-1", agent: "collector" };
const INPUT = { value: "x" };

function setup(targets: () => Target[] | Promise<Target[]>, handler: () => Promise<unknown> = async () => ({ ok: 1 })) {
  const record = vi.fn<Audit["record"]>(async () => {});
  const run = vi.fn(handler);
  const tool = defineTool({
    name: "demo",
    description: "demo",
    inputSchema: z.object({ value: z.string() }),
    targets,
    handler: run,
  });
  const wrapped = wrapTool(tool, { audit: { record, list: async () => [] }, allowlist });
  return { record, run, call: () => wrapped.handler(INPUT, CTX) };
}

describe("wrapTool targets", () => {
  it.each<Target>([
    { kind: "email", value: "billing@pge.com" },
    { kind: "phone", value: "+18007435000" },
    { kind: "portal", value: "https://www.pge.com/login" },
  ])("rejects $kind target $value before the tool runs, and audits it", async (target) => {
    const { call, run, record } = setup(() => [target]);
    await expect(call()).rejects.toThrow("not on the allowlist");
    expect(run).not.toHaveBeenCalled();
    expect(record).toHaveBeenCalledOnce();
    expect(record.mock.calls[0]?.[0]).toMatchObject({ ...CTX, tool: "demo", output: { refused: expect.any(String) } });
  });

  it("rejects the whole call when only one of several targets is off the list", async () => {
    const { call, run } = setup(() => [
      { kind: "email", value: "owner@billfighter.local" },
      { kind: "email", value: "billing@pge.com" },
    ]);
    await expect(call()).rejects.toThrow("billing@pge.com");
    expect(run).not.toHaveBeenCalled();
  });

  it.each([
    ["throw", () => { throw new Error("no such customer"); }],
    ["reject", async () => { throw new Error("database down"); }],
    ["return something that is not a list", () => "billing@pge.com" as unknown as Target[]],
    ["return an unknown kind", () => [{ kind: "fax", value: "1" }] as unknown as Target[]],
  ])("fails closed when targets does %s", async (_name, targets) => {
    const { call, run, record } = setup(targets);
    await expect(call()).rejects.toThrow("could not read its targets");
    expect(run).not.toHaveBeenCalled();
    expect(record).toHaveBeenCalledOnce();
  });

  it.each<[string, Target[]]>([
    ["no targets", []],
    [
      "allowlisted targets",
      [
        { kind: "email", value: "owner@billfighter.local" },
        { kind: "phone", value: "+15550003333" },
        { kind: "portal", value: "http://localhost:3001/login" },
      ],
    ],
  ])("runs a tool with %s", async (_name, targets) => {
    const { call, run } = setup(async () => targets);
    await expect(call()).resolves.toEqual({ ok: 1 });
    expect(run).toHaveBeenCalledOnce();
  });

  it("still refuses when the audit write fails too, and says so", async () => {
    const { call, run, record } = setup(() => [{ kind: "email", value: "billing@pge.com" }]);
    record.mockRejectedValueOnce(new Error("database down"));
    await expect(call()).rejects.toThrow(/not on the allowlist.*database down/);
    expect(run).not.toHaveBeenCalled();
  });
});

describe("wrapTool audit", () => {
  it("writes one row after the handler, holding exactly the input and output", async () => {
    const { call, record, run } = setup(() => []);
    await call();
    expect(record.mock.calls).toEqual([[{ ...CTX, tool: "demo", input: INPUT, output: { ok: 1 } }]]);
    expect(run.mock.invocationCallOrder[0]).toBeLessThan(record.mock.invocationCallOrder[0] as number);
  });

  it("writes one row for a failed handler, and passes on the error", async () => {
    const { call, record } = setup(
      () => [],
      async () => {
        throw new Error("portal is down");
      },
    );
    await expect(call()).rejects.toThrow("portal is down");
    expect(record.mock.calls).toEqual([[{ ...CTX, tool: "demo", input: INPUT, output: { error: "portal is down" } }]]);
  });

  it("keeps the handler's error when the audit write also fails", async () => {
    const { call, record } = setup(
      () => [],
      async () => {
        throw new Error("portal is down");
      },
    );
    record.mockRejectedValueOnce(new Error("database down"));
    await expect(call()).rejects.toThrow(/portal is down.*database down/);
  });

  it("says the action ran and must not be retried when the audit write fails afterwards", async () => {
    const { call, record, run } = setup(() => []);
    record.mockRejectedValueOnce(new Error("database down"));
    await expect(call()).rejects.toThrow(/demo ran, so do not retry it.*database down/);
    expect(run).toHaveBeenCalledOnce();
  });
});

describe("auditDenied", () => {
  async function* stream(): AsyncGenerator<RunEvent> {
    yield { type: "text", agent: "ceo", text: "hi" };
    yield { type: "denied", agent: "filer", tool: "submit_claim", reason: "not approved" };
    yield { type: "result", status: "success", costUsd: 0 };
  }

  it("records each denied event, and passes every event on in order", async () => {
    const record = vi.fn<Audit["record"]>(async () => {});
    const seen: RunEvent[] = [];
    for await (const event of auditDenied(stream(), "run-1", { record, list: async () => [] })) seen.push(event);
    expect(seen.map((event) => event.type)).toEqual(["text", "denied", "result"]);
    expect(record.mock.calls).toEqual([
      [{ runId: "run-1", agent: "filer", tool: "submit_claim", output: { denied: "not approved" } }],
    ]);
  });
});
