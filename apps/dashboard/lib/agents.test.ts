import { expect, it } from "vitest";
import { agentRows, elapsed } from "./agents.ts";

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

it("gives each agent a row in the order it first acted, with no row for the CEO or the run card", () => {
  const rows = agentRows(input);
  expect(rows.map((r) => [r.agent, r.state, r.action, r.elapsedSeconds])).toEqual([
    ["collector", "done", "Download and store all bills and usage", 38],
    ["finance", "queued", "Record savings and create invoice", 0],
    ["auditor", "working", "Parse bills and run audit", 22],
  ]);
  expect(rows[0]!.calls.map((c) => c.tool)).toEqual(["download_bills", "portal_login"]);
});

it("falls back to the newest tool when an agent has no card", () => {
  const rows = agentRows({ boardCards: [], auditLog: [call("x", "negotiator", "place_call", "2026-11-08T01:29:11Z")] } as unknown as Input);
  expect(rows[0]).toMatchObject({ agent: "negotiator", state: "done", action: "place_call", elapsedSeconds: 0 });
});

it("formats elapsed seconds as m:ss", () => {
  expect(elapsed(75)).toBe("1:15");
  expect(elapsed(5)).toBe("0:05");
});
