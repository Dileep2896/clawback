import { expect, it } from "vitest";
import { agentRows, ceoRow, elapsed, ROSTER } from "./agents.ts";

type Input = Parameters<typeof agentRows>[0];

const card = (id: string, agent: string, status: string, title: string, updatedAt: string) => ({ id, agent, status, title, updatedAt, runId: "r" });
const call = (id: string, agent: string, tool: string, createdAt: string) => ({ id, agent, tool, createdAt, costUsd: 0 });

const input = {
  boardCards: [
    card("c1", "collector", "done", "Download and store all bills and usage", "2026-11-08T01:25:53Z"),
    card("c2", "auditor", "doing", "Parse bills and run audit", "2026-11-08T01:26:05Z"),
    card("c3", "finance", "todo", "Record savings and create invoice", "2026-11-08T01:26:00Z"),
    card("c4", "run", "blocked", "Stopped", "2026-11-08T01:26:06Z"),
  ],
  // Newest first, as the snapshot sends them.
  auditLog: [
    call("a4", "auditor", "run_audit", "2026-11-08T01:26:27Z"),
    call("a3", "ceo", "board_update", "2026-11-08T01:26:01Z"),
    call("a2", "collector", "download_bills", "2026-11-08T01:25:30Z"),
    call("a1", "collector", "portal_login", "2026-11-08T01:25:15Z"),
  ],
} as unknown as Input;

const view = (rows: ReturnType<typeof agentRows>) => rows.map((r) => [r.agent, r.state, r.action, r.elapsedSeconds]);

it("lists every agent in run order, those still to come as next, with no row for the CEO or the run card", () => {
  const rows = agentRows(input);
  expect(rows.map((r) => r.agent)).toEqual(ROSTER);
  expect(view(rows).slice(0, 3)).toEqual([
    ["intake", "next", "", 0],
    ["collector", "done", "Download and store all bills and usage", 38],
    ["auditor", "working", "Parse bills and run audit", 22],
  ]);
  // A card still to do is not a start.
  expect(rows.find((r) => r.agent === "finance")).toMatchObject({ state: "next", action: "" });
  expect(rows[1]!.calls.map((c) => c.tool)).toEqual(["download_bills", "portal_login"]);
});

it("puts an agent outside the roster after it, and says what its newest tool did when it has no card", () => {
  const rows = agentRows({ boardCards: [], auditLog: [call("x", "scout", "portal_login", "2026-11-08T01:29:11Z")] } as unknown as Input);
  expect(rows.at(-1)).toMatchObject({ agent: "scout", state: "done", action: "Log in to the provider's portal", elapsedSeconds: 0 });
});

it("shows the approver waiting on the owner while the approval is pending", () => {
  const approving = { boardCards: [card("p", "approver", "doing", "Request owner approval", "2026-11-08T01:27:00Z")], auditLog: [] } as unknown as Input;
  expect(agentRows({ ...approving, approvalPending: true }).find((r) => r.agent === "approver")!.state).toBe("waiting");
  expect(agentRows(approving).find((r) => r.agent === "approver")!.state).toBe("working");
});

it("marks blocked agents, and agents left working by a stopped run, as failed", () => {
  const blocked = { boardCards: [card("b", "negotiator", "blocked", "Call provider", "2026-11-08T01:27:00Z")], auditLog: [] } as unknown as Input;
  expect(agentRows(blocked).find((r) => r.agent === "negotiator")!.state).toBe("failed");
  expect(agentRows({ ...input, runActive: false }).find((r) => r.agent === "auditor")!.state).toBe("failed");
});

it("gives the CEO its own row from its own calls", () => {
  expect(ceoRow(input)).toMatchObject({ agent: "ceo", state: "done", action: "Update the plan" });
});

it("formats elapsed seconds as m:ss", () => {
  expect(elapsed(75)).toBe("1:15");
  expect(elapsed(5)).toBe("0:05");
});
