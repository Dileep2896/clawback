import { describe, expect, it } from "vitest";
import { z } from "zod";
// The real audit wrapper, so the test sees how a tool fails when only its audit row cannot be written.
import { defineTool, wrapTool } from "../../../agents/src/tool-wrapper.ts";
import type { Approval, ApprovalGate, Audit, Board, BoardCard, Budget, RunEvent, RunSpec, ToolDef } from "../types.ts";
import { cancelAll, createAgentRuntime, MAX_RUN_USD, pickModel, toolsetFor } from "./agent-runtime.ts";
import { type NaiveApi, NaiveError, type NaiveRequest } from "./runtime-http.ts";

const tool = (name: string): ToolDef => ({
  name,
  description: name,
  inputSchema: z.object({ actionId: z.string().optional() }) as unknown as ToolDef["inputSchema"],
  handler: async () => "ok",
});

const SPEC: RunSpec = {
  runId: "run-1",
  prompt: "go",
  main: { name: "ceo", description: "boss", prompt: "lead", tools: ["board_update"], maxTurns: 1 },
  members: [{ name: "filer", description: "files", prompt: "file", tools: ["submit_claim"], maxTurns: 1 }],
  tools: [tool("board_update"), tool("submit_claim")],
};

type Ev = { seq: number; type: string; data: Record<string, unknown> };
type Ses = { id: string; status: string; stop_reason: string | null; pending_actions: unknown[]; consumed_micro_usd: number; events: Ev[] };

/** A scripted naïve: `step` runs before each read of the root, so a test moves the sessions along over time. */
function fakeNaive(step: (sessions: Map<string, Ses>, tick: number) => void) {
  const sessions = new Map<string, Ses>();
  const calls: { method: string; path: string; body?: unknown }[] = [];
  let tick = 0;
  const api = (async (path: string, { method = "GET", body, query }: NaiveRequest = {}) => {
    calls.push({ method, path, body });
    const page = (data: unknown[]) => ({ data, has_more: false, next_cursor: null });
    if (path === "/models") return page([{ id: "anthropic/claude-haiku-5.5" }, { id: "anthropic/claude-sonnet-5.5" }, { id: "anthropic/claude-sonnet-5" }]);
    if (path === "/vaults" && method === "GET") return page([]);
    if (path === "/vaults") return { id: "vlt_1" };
    if (path.endsWith("/credentials")) return { id: `vcr_${calls.length}` };
    if (path === "/agents" && method === "GET") return page([{ id: "agt_filer", name: "clawback-filer" }]);
    if (path.startsWith("/agents")) return { id: (body as { name: string }).name === "clawback-ceo" ? "agt_ceo" : "agt_filer" };
    if (path === "/sessions" && method === "POST") {
      sessions.set("ses_root", { id: "ses_root", status: "running", stop_reason: null, pending_actions: [], consumed_micro_usd: 0, events: [] });
      return sessions.get("ses_root");
    }
    const m = /^\/sessions\/([^/]+)(\/.*)?$/.exec(path);
    if (m) {
      const ses = sessions.get(m[1]!)!;
      if (m[2] === "/events") return page(ses.events.filter((e) => e.seq > Number(query?.after_seq ?? 0)));
      if (m[2] === "/tool_confirmations") {
        const id = (body as { tool_call_id: string }).tool_call_id;
        ses.pending_actions = ses.pending_actions.filter((a) => (a as { tool_call_id: string }).tool_call_id !== id);
        if (ses.pending_actions.length === 0) ses.stop_reason = null;
        return ses;
      }
      if (m[2] === "/cancel") {
        ses.status = "cancelled";
        return ses;
      }
      if (m[1] === "ses_root") step(sessions, tick++);
      // A snapshot, as over HTTP: the runtime's copy goes stale when the fake moves the session on.
      return structuredClone(ses);
    }
    return {};
  }) as NaiveApi;
  return { api, calls, sessions };
}

function fakeGate(approval: Partial<Approval> | null) {
  const state = { approval };
  const gate: ApprovalGate = {
    get: async () => state.approval as Approval | null,
    isReleased: async (id) => state.approval?.status === "approved" && !!state.approval.actionIds?.includes(id),
    createBundle: async () => {
      throw new Error("unused");
    },
    decide: async () => {
      throw new Error("unused");
    },
    waitForRelease: async () => false,
  };
  return { gate, state };
}

const fakeBudget = (capUsd = 5) => {
  const b = {
    totalUsd: 0,
    add: async (_: string, usd: number) => {
      b.totalUsd += usd;
      return { totalUsd: b.totalUsd, capUsd, over: b.totalUsd >= capUsd };
    },
    status: async () => ({ totalUsd: b.totalUsd, capUsd, over: b.totalUsd >= capUsd }),
  };
  return b satisfies Budget;
};

function fakeAudit() {
  const rows: Parameters<Audit["record"]>[0][] = [];
  const audit: Audit = {
    record: async (row) => {
      rows.push(row);
    },
    list: async () => [],
  };
  return { rows, audit };
}

async function collect(events: AsyncIterable<RunEvent>) {
  const out: RunEvent[] = [];
  for await (const event of events) out.push(event);
  return out;
}

const parked = (id: string, actionId?: string) => ({ kind: "tool", tool_call_id: id, name: "clawback.submit_claim", args: actionId ? { actionId } : {} });
const noCards: Board = { create: async () => ({}) as BoardCard, move: async () => ({}) as BoardCard, list: async () => [] };
const runtime = (api: NaiveApi, gate: ApprovalGate, budget: Budget, audit: Audit, board = noCards) =>
  createAgentRuntime(async () => ({ api, gate, budget, audit, board, publicUrl: "https://tunnel.test", port: 0, pollMs: 1, idleMs: 5000 }));

describe("naïve runtime", () => {
  it("releases every gated call of the run from one approval, on member sessions, and logs the approver", async () => {
    const { gate, state } = fakeGate({ status: "pending", actionIds: ["a1", "a2"] });
    const { rows, audit } = fakeAudit();
    const { api, calls } = fakeNaive((sessions, tick) => {
      const root = sessions.get("ses_root")!;
      if (tick === 0) {
        root.events.push({ seq: 1, type: "thread.created", data: { thread_id: "ses_m", member: "clawback-filer" } });
        root.status = "idle";
        root.stop_reason = "awaiting_delegation";
        sessions.set("ses_m", {
          id: "ses_m",
          status: "idle",
          stop_reason: "awaiting_approval",
          pending_actions: [parked("c1", "a1")],
          consumed_micro_usd: 300_000,
          events: [{ seq: 1, type: "tool.confirm", data: { tool_call_id: "c1" } }],
        });
      }
      // The owner taps approve once.
      if (tick === 3) state.approval = { status: "approved", actionIds: ["a1", "a2"], approvedBy: "Linda", channel: "dashboard" };
      const member = sessions.get("ses_m")!;
      if (tick === 6) {
        member.events.push({ seq: 2, type: "tool.confirm.resolved", data: { tool_call_id: "c1", decision: "allow", actor: "key_x" } });
        // A second gated call later in the run parks again and needs no new decision.
        member.pending_actions = [parked("c2", "a2")];
        member.stop_reason = "awaiting_approval";
      }
      if (tick === 9) {
        member.status = "completed";
        root.status = "idle";
        root.stop_reason = "end_turn";
        root.consumed_micro_usd = 200_000;
        root.events.push({ seq: 2, type: "message.completed", data: { content: "All done" } });
      }
    });
    const budget = fakeBudget();
    const events = await collect(runtime(api, gate, budget, audit).run(SPEC));

    const confirms = calls.filter((c) => c.path.endsWith("/tool_confirmations"));
    expect(confirms).toEqual([
      { method: "POST", path: "/sessions/ses_m/tool_confirmations", body: { tool_call_id: "c1", decision: "allow" } },
      { method: "POST", path: "/sessions/ses_m/tool_confirmations", body: { tool_call_id: "c2", decision: "allow" } },
    ]);
    expect(rows).toContainEqual(
      expect.objectContaining({ tool: "naive_tool_confirm", agent: "filer", output: expect.objectContaining({ approvedBy: "Linda", naiveActor: "key_x" }) }),
    );
    expect(events).toContainEqual({ type: "text", agent: "ceo", text: "All done" });
    expect(events.at(-1)).toEqual({ type: "result", status: "success", costUsd: 0.5 });
    expect(budget.totalUsd).toBeCloseTo(0.5);
    // Gated tools ask, the rest allow, built-ins are denied; the coordinator's board stays off.
    const ceo = calls.find((c) => c.method === "POST" && c.path === "/agents")!.body as Record<string, unknown>;
    expect(ceo).toMatchObject({ model: "anthropic/claude-sonnet-5.5", multiagent: { board: false, agents: [{ type: "agent", id: "agt_filer" }] } });
    const filer = calls.find((c) => c.method === "PATCH")!.body as { tools: unknown; budget: { max_task_micro_usd: number } };
    expect(filer.tools).toEqual({ default_config: { permission: "deny" }, configs: { "clawback.submit_claim": { enabled: true, permission: "ask" } } });
    expect(filer.budget.max_task_micro_usd).toBe(MAX_RUN_USD * 1_000_000);
    // The run's vault credential is removed at the end; the CEO, whose only tool here is the board, has none.
    expect(calls.filter((c) => c.method === "DELETE")).toHaveLength(1);
  });

  it("denies a gated call with no actionId or outside the bundle and any foreign tool, allows an ungated one, and never touches a session it does not own", async () => {
    const { gate } = fakeGate({ status: "pending", actionIds: ["a1"] });
    const { api, calls } = fakeNaive((sessions, tick) => {
      const root = sessions.get("ses_root")!;
      if (tick === 0) {
        root.status = "idle";
        root.stop_reason = "awaiting_approval";
        root.pending_actions = [
          parked("c1"),
          parked("c2", "zzz"),
          { kind: "question", tool_call_id: "q1", name: "ask_operator" },
          // naïve parks an allowed tool once the chat has read mail: ours and ungated, so it is allowed.
          { kind: "tool", tool_call_id: "c3", name: "clawback.board_update", args: {} },
          { kind: "tool", tool_call_id: "c4", name: "bash", args: {} },
        ];
        sessions.set("ses_other", {
          id: "ses_other",
          status: "idle",
          stop_reason: "awaiting_approval",
          pending_actions: [parked("x", "a1")],
          consumed_micro_usd: 0,
          events: [],
        });
      }
      if (tick === 2) root.stop_reason = "end_turn";
    });
    const events = await collect(runtime(api, gate, fakeBudget(), fakeAudit().audit).run(SPEC));
    const confirms = calls.filter((c) => c.path.endsWith("/tool_confirmations"));
    expect(confirms.map((c) => [(c.body as { tool_call_id: string }).tool_call_id, (c.body as { decision: string }).decision])).toEqual([
      ["c1", "deny"],
      ["c2", "deny"],
      ["c3", "allow"],
      ["c4", "deny"],
    ]);
    expect(confirms.every((c) => c.path === "/sessions/ses_root/tool_confirmations")).toBe(true);
    expect(events.filter((e) => e.type === "denied")).toHaveLength(3);
    expect(calls.some((c) => c.path.includes("ses_other"))).toBe(false);
  });

  it("stops over budget, cancels the root session, and books what the cancelled call still cost", async () => {
    const { api, calls, sessions } = fakeNaive((all) => {
      const root = all.get("ses_root")!;
      root.consumed_micro_usd = Math.max(root.consumed_micro_usd, 6_000_000);
    });
    const budget = fakeBudget(5);
    const cancelling = api;
    const billed = (async (path: string, init?: NaiveRequest) => {
      const out = await cancelling(path, init);
      // The in-flight model call is billed as it is cancelled.
      if (path === "/sessions/ses_root/cancel") sessions.get("ses_root")!.consumed_micro_usd = 6_250_000;
      return out;
    }) as NaiveApi;
    const events = await collect(runtime(billed, fakeGate(null).gate, budget, fakeAudit().audit).run(SPEC));
    expect(events.at(-1)).toMatchObject({ type: "result", status: "over_budget", costUsd: 6.25 });
    expect(budget.totalUsd).toBeCloseTo(6.25);
    expect(calls).toContainEqual({ method: "POST", path: "/sessions/ses_root/cancel", body: undefined });
  });

  it("confirms nothing once the spend crosses the cap, even a call approved in this run", async () => {
    const { gate } = fakeGate({ status: "approved", actionIds: ["a1"] });
    const { api, calls } = fakeNaive((sessions) => {
      Object.assign(sessions.get("ses_root")!, { status: "idle", stop_reason: "awaiting_approval", pending_actions: [parked("c1", "a1")], consumed_micro_usd: 6_000_000 });
    });
    const events = await collect(runtime(api, gate, fakeBudget(5), fakeAudit().audit).run(SPEC));
    expect(events.at(-1)).toMatchObject({ type: "result", status: "over_budget" });
    expect(calls.some((c) => c.path.endsWith("/tool_confirmations"))).toBe(false);
  });

  it("records usage whose Budget write failed when the run reconciles", async () => {
    const { api } = fakeNaive((sessions, tick) => {
      const root = sessions.get("ses_root")!;
      root.consumed_micro_usd = 100_000;
      if (tick === 2) Object.assign(root, { status: "idle", stop_reason: "end_turn" });
    });
    const budget = fakeBudget();
    const add = budget.add;
    let failed = false;
    budget.add = async (runId, usd) => {
      if (!failed) {
        failed = true;
        throw new Error("db blip");
      }
      return add(runId, usd);
    };
    const events = await collect(runtime(api, fakeGate(null).gate, budget, fakeAudit().audit).run(SPEC));
    expect(events.at(-1)).toMatchObject({ type: "result", costUsd: 0.1 });
    expect(budget.totalUsd).toBeCloseTo(0.1);
  });

  it("answers a call again when naïve parks it in a later turn, and a coordinator copy of a member call only once", async () => {
    const { gate } = fakeGate({ status: "approved", actionIds: ["a1"] });
    const { api, calls } = fakeNaive((sessions, tick) => {
      const root = sessions.get("ses_root")!;
      const again = (seq: number) => ({ ...parked("c1", "a1"), parked_seq: seq });
      if (tick === 0) {
        root.events.push({ seq: 1, type: "thread.created", data: { thread_id: "ses_m", member: "clawback-filer" } });
        root.status = "idle";
        root.stop_reason = "awaiting_approval";
        root.pending_actions = [again(1)];
        sessions.set("ses_m", { id: "ses_m", status: "idle", stop_reason: "awaiting_approval", pending_actions: [again(4)], consumed_micro_usd: 0, events: [] });
      }
      // The same call, same id, proposed again in a later turn.
      if (tick === 3) Object.assign(sessions.get("ses_m")!, { stop_reason: "awaiting_approval", pending_actions: [again(9)] });
      if (tick === 6) {
        sessions.get("ses_m")!.status = "completed";
        Object.assign(root, { stop_reason: "end_turn", pending_actions: [] });
      }
    });
    await collect(runtime(api, gate, fakeBudget(), fakeAudit().audit).run(SPEC));
    expect(calls.filter((c) => c.path.endsWith("/tool_confirmations")).map((c) => c.path)).toEqual([
      "/sessions/ses_m/tool_confirmations",
      "/sessions/ses_m/tool_confirmations",
    ]);
  });

  it("answers each member that holds the same call id, and the coordinator copy not at all", async () => {
    const { gate } = fakeGate({ status: "approved", actionIds: ["a1"] });
    const { api, calls } = fakeNaive((sessions, tick) => {
      const root = sessions.get("ses_root")!;
      const member = (id: string) => ({ id, status: "idle", stop_reason: "awaiting_approval", pending_actions: [parked("c1", "a1")], consumed_micro_usd: 0, events: [] });
      if (tick === 0) {
        root.events.push({ seq: 1, type: "thread.created", data: { thread_id: "ses_m", member: "clawback-filer" } });
        root.events.push({ seq: 2, type: "thread.created", data: { thread_id: "ses_m2", member: "clawback-filer" } });
        Object.assign(root, { status: "idle", stop_reason: "awaiting_approval", pending_actions: [parked("c1", "a1")] });
        sessions.set("ses_m", member("ses_m"));
        sessions.set("ses_m2", member("ses_m2"));
      }
      if (tick === 3) {
        for (const id of ["ses_m", "ses_m2"]) sessions.get(id)!.status = "completed";
        Object.assign(root, { stop_reason: "end_turn", pending_actions: [] });
      }
    });
    await collect(runtime(api, gate, fakeBudget(), fakeAudit().audit).run(SPEC));
    expect(calls.filter((c) => c.path.endsWith("/tool_confirmations")).map((c) => c.path)).toEqual([
      "/sessions/ses_m/tool_confirmations",
      "/sessions/ses_m2/tool_confirmations",
    ]);
  });

  it("denies an independent handoff and a call approved only in another run", async () => {
    const { gate } = fakeGate({ status: "pending", actionIds: [] });
    gate.isReleased = async () => true; // approved in some other run's bundle
    const { api, calls } = fakeNaive((sessions, tick) => {
      const root = sessions.get("ses_root")!;
      if (tick === 0) {
        root.status = "idle";
        root.stop_reason = "awaiting_approval";
        root.pending_actions = [
          { kind: "tool", tool_call_id: "h1", name: "send_to_agent", args: { agent: "clawback-filer", message: "go", wait: false } },
          { kind: "tool", tool_call_id: "h2", name: "send_to_agent", args: { agent: "clawback-filer", message: "go", wait: true } },
          { kind: "tool", tool_call_id: "h3", name: "send_to_agent", args: { agent: "ceo", message: "go", wait: true } },
          parked("c1", "a-elsewhere"),
        ];
      }
      if (tick === 2) root.stop_reason = "end_turn";
    });
    await collect(runtime(api, gate, fakeBudget(), fakeAudit().audit).run(SPEC));
    const confirms = calls.filter((c) => c.path.endsWith("/tool_confirmations")).map((c) => c.body as { tool_call_id: string; decision: string });
    expect(confirms.map((c) => [c.tool_call_id, c.decision])).toEqual([
      ["h1", "deny"],
      ["h2", "allow"],
      ["h3", "deny"],
      ["c1", "deny"],
    ]);
  });

  it("starts a run without members with handoffs and delegation off", async () => {
    const { api, calls } = fakeNaive((sessions) => {
      const root = sessions.get("ses_root")!;
      root.status = "idle";
      root.stop_reason = "end_turn";
    });
    await collect(runtime(api, fakeGate(null).gate, fakeBudget(), fakeAudit().audit).run({ ...SPEC, members: [] }));
    const main = calls.find((c) => c.path.startsWith("/agents") && c.method !== "GET" && (c.body as { name: string }).name === "clawback-ceo")!.body as {
      handoffs: unknown;
      multiagent: unknown;
      tools: { configs: Record<string, unknown> };
    };
    expect(main.handoffs).toBe(false);
    expect(main.multiagent).toBeNull();
    expect(Object.keys(main.tools.configs)).toEqual(["clawback.board_update"]);
  });

  it("refuses to start without a public https tool URL", async () => {
    const { api } = fakeNaive(() => {});
    const run = createAgentRuntime(async () => ({
      api,
      gate: fakeGate(null).gate,
      budget: fakeBudget(),
      audit: fakeAudit().audit,
      publicUrl: "http://localhost:8790",
      port: 0,
    }));
    expect((await collect(run.run(SPEC))).at(-1)).toMatchObject({ status: "error", reason: expect.stringContaining("NAIVE_MCP_PUBLIC_URL") });
  });
});

describe("naïve runtime cost", () => {
  it("keeps the board itself, one card per delegated task, and never offers board_update to the coordinator", async () => {
    const cards: { input: Record<string, unknown>; agent: string }[] = [];
    let next = 0;
    const board: ToolDef = {
      ...tool("board_update"),
      handler: async (input, ctx) => {
        cards.push({ input: input as Record<string, unknown>, agent: ctx.agent });
        return (input as { cardId?: string }).cardId ? input : { cardId: `card${++next}` };
      },
    };
    const { gate } = fakeGate({ status: "pending", actionIds: [] });
    const { api, calls } = fakeNaive((sessions, tick) => {
      const root = sessions.get("ses_root")!;
      const member = (id: string) => ({ id, status: "running", stop_reason: null, pending_actions: [], consumed_micro_usd: 0, events: [] });
      if (tick === 0)
        Object.assign(root, {
          status: "idle",
          stop_reason: "awaiting_approval",
          pending_actions: [
            { kind: "tool", tool_call_id: "d1", name: "send_to_agent", args: { agent: "clawback-filer", message: "\nDraft the letters for F-1.\nIds: F-1", wait: true } },
            { kind: "tool", tool_call_id: "d2", name: "send_to_agent", args: { agent: "agt_filer", message: "File them", wait: true } },
          ],
        });
      if (tick === 1) {
        root.events.push({ seq: 1, type: "thread.created", data: { thread_id: "ses_a", member: "clawback-filer" } });
        root.events.push({ seq: 2, type: "thread.created", data: { thread_id: "ses_b", member: "clawback-filer" } });
        Object.assign(root, { stop_reason: "awaiting_delegation", pending_actions: [] });
        sessions.set("ses_a", member("ses_a"));
        sessions.set("ses_b", member("ses_b"));
      }
      if (tick === 3) {
        Object.assign(sessions.get("ses_a")!, { status: "idle", stop_reason: "end_turn" });
        root.events.push({ seq: 3, type: "thread.idle", data: { thread_id: "ses_a" } });
        root.events.push({ seq: 4, type: "thread.terminated", data: { thread_id: "ses_b" } });
      }
      if (tick === 5) root.stop_reason = "end_turn";
    });
    await collect(runtime(api, gate, fakeBudget(), fakeAudit().audit).run({ ...SPEC, tools: [board, tool("submit_claim")] }));
    expect(cards).toEqual([
      { input: { agent: "filer", title: "Draft the letters for F-1.", status: "doing" }, agent: "ceo" },
      { input: { agent: "filer", title: "File them", status: "doing" }, agent: "ceo" },
      { input: { cardId: "card1", status: "done" }, agent: "ceo" },
      { input: { cardId: "card2", status: "blocked" }, agent: "ceo" },
    ]);
    const ceo = calls.find((c) => c.method === "POST" && c.path === "/agents")!.body as { tools: { configs: Record<string, unknown> }; system: string; mcp_servers: unknown[] };
    expect(Object.keys(ceo.tools.configs)).not.toContain("clawback.board_update");
    expect(ceo.system).toContain("Do not call board_update");
    expect(ceo.mcp_servers).toEqual([]);
    // Nothing is written to naïve's board, so no digest session can start.
    expect(calls.some((c) => c.path.startsWith("/boards"))).toBe(false);
  });

  /** One delegated task; at tick 3 the member ends as `memberEnd` and the root reports thread.idle in the same round. */
  const oneCard = async (memberEnd: Partial<Ses>, move: (attempt: number) => void, create: (attempt: number) => void = () => {}) => {
    const moves: unknown[] = [];
    let attempt = 0;
    let creates = 0;
    const board: ToolDef = {
      ...tool("board_update"),
      handler: async (input) => {
        const { cardId } = input as { cardId?: string };
        if (!cardId) {
          create(++creates);
          return { cardId: "card1" };
        }
        move(++attempt);
        moves.push(input);
        return input;
      },
    };
    const { api } = fakeNaive((sessions, tick) => {
      const root = sessions.get("ses_root")!;
      if (tick === 0)
        Object.assign(root, {
          status: "idle",
          stop_reason: "awaiting_approval",
          pending_actions: [{ kind: "tool", tool_call_id: "d1", name: "send_to_agent", args: { agent: "clawback-filer", message: "File F-1", wait: true } }],
        });
      if (tick === 1) {
        root.events.push({ seq: 1, type: "thread.created", data: { thread_id: "ses_a", member: "clawback-filer" } });
        Object.assign(root, { stop_reason: "awaiting_delegation", pending_actions: [] });
        sessions.set("ses_a", { id: "ses_a", status: "running", stop_reason: null, pending_actions: [], consumed_micro_usd: 0, events: [] });
      }
      // The root is read before the member in a round, so the loop's copy of ses_a is still "running" here.
      if (tick === 3) {
        Object.assign(sessions.get("ses_a")!, memberEnd);
        root.events.push({ seq: 2, type: "thread.idle", data: { thread_id: "ses_a" } });
      }
      if (tick === 5) root.stop_reason = "end_turn";
    });
    const events = await collect(runtime(api, fakeGate({ status: "pending", actionIds: [] }).gate, fakeBudget(), fakeAudit().audit).run({ ...SPEC, tools: [board, tool("submit_claim")] }));
    return { moves, events, result: events.find((e) => e.type === "result") };
  };

  it("retries a card creation that failed to write, and fails the run if the card is never created", async () => {
    const done = { status: "idle", stop_reason: "end_turn" };
    const retried = await oneCard(done, () => {}, (attempt) => {
      if (attempt === 1) throw new Error("db down");
    });
    expect(retried.moves).toEqual([{ cardId: "card1", status: "done" }]);
    expect(retried.result).toMatchObject({ status: "success" });
    const never = await oneCard(done, () => {}, () => {
      throw new Error("db down");
    });
    expect(never.moves).toEqual([]);
    expect(never.result).toMatchObject({ status: "error", reason: expect.stringContaining('"File F-1" (not created)') });
  });

  it("takes the card a failed creation already wrote instead of making a second one", async () => {
    // A board_update whose card is inserted but whose audit row fails once, through the real wrapper.
    const cards: BoardCard[] = [];
    const store: Board = {
      create: async (card) => (cards.push({ ...card, id: `card${cards.length + 1}`, status: card.status ?? "todo" } as BoardCard), cards.at(-1)!),
      move: async (id, status) => Object.assign(cards.find((c) => c.id === id)!, { status }),
      list: async (runId) => cards.filter((c) => c.runId === runId),
    };
    let audits = 0;
    const audit: Audit = {
      record: async () => {
        if (++audits === 1) throw new Error("audit down");
      },
      list: async () => [],
    };
    const board = wrapTool(
      defineTool({
        ...tool("board_update"),
        targets: () => [],
        handler: async (input: unknown) => {
          const { cardId, agent, title, status } = input as { cardId?: string; agent: string; title: string; status: BoardCard["status"] };
          if (!cardId) return { cardId: (await store.create({ runId: "run-1", agent, title, status })).id };
          return store.move(cardId, status);
        },
      }),
      { audit, allowlist: { callNumbers: [], emailDomains: [], portalOrigins: [] } },
    );
    const { api } = fakeNaive((sessions, tick) => {
      const root = sessions.get("ses_root")!;
      if (tick === 0)
        Object.assign(root, {
          status: "idle",
          stop_reason: "awaiting_approval",
          pending_actions: [{ kind: "tool", tool_call_id: "d1", name: "send_to_agent", args: { agent: "clawback-filer", message: "File F-1", wait: true } }],
        });
      if (tick === 1) {
        root.events.push({ seq: 1, type: "thread.created", data: { thread_id: "ses_a", member: "clawback-filer" } });
        Object.assign(root, { stop_reason: "awaiting_delegation", pending_actions: [] });
        sessions.set("ses_a", { id: "ses_a", status: "running", stop_reason: null, pending_actions: [], consumed_micro_usd: 0, events: [] });
      }
      if (tick === 3) {
        Object.assign(sessions.get("ses_a")!, { status: "idle", stop_reason: "end_turn" });
        root.events.push({ seq: 2, type: "thread.idle", data: { thread_id: "ses_a" } });
      }
      if (tick === 5) root.stop_reason = "end_turn";
    });
    const events = await collect(
      runtime(api, fakeGate({ status: "pending", actionIds: [] }).gate, fakeBudget(), fakeAudit().audit, store).run({ ...SPEC, tools: [board, tool("submit_claim")] }),
    );
    expect(audits).toBeGreaterThan(1);
    expect(cards).toMatchObject([{ id: "card1", agent: "filer", title: "File F-1", status: "done" }]);
    expect(events.find((e) => e.type === "result")).toMatchObject({ status: "success" });
  });

  it("still reads a member's last events and spend when its result folds back as it ends", async () => {
    const { moves, events } = await oneCard(
      { status: "completed", stop_reason: "end_turn", consumed_micro_usd: 250_000, events: [{ seq: 1, type: "message.completed", data: { role: "assistant", content: "Filed F-1" } }] },
      () => {},
    );
    expect(moves).toEqual([{ cardId: "card1", status: "done" }]);
    expect(events).toContainEqual({ type: "text", agent: "filer", text: "Filed F-1" });
    expect(events.find((e) => e.type === "result")).toMatchObject({ costUsd: 0.25 });
  });

  it("reads a member's own state when its result folds back, so a failed member's card is blocked", async () => {
    const { moves, result } = await oneCard({ status: "failed", stop_reason: null }, () => {});
    expect(moves).toEqual([{ cardId: "card1", status: "blocked" }]);
    expect(result).toMatchObject({ status: "success" });
  });

  it("retries a card move that failed to write, and fails the run if it never lands", async () => {
    const done = { status: "idle", stop_reason: "end_turn" };
    const retried = await oneCard(done, (attempt) => {
      if (attempt === 1) throw new Error("db down");
    });
    expect(retried.moves).toEqual([{ cardId: "card1", status: "done" }]);
    expect(retried.result).toMatchObject({ status: "success" });
    const never = await oneCard(done, () => {
      throw new Error("db down");
    });
    expect(never.moves).toEqual([]);
    expect(never.result).toMatchObject({ status: "error", reason: expect.stringContaining("board cards not updated: card1") });
  });

  it("confirms a parked ungated call itself, counts parks, and cancels every session of the run on stop", async () => {
    const { rows, audit } = fakeAudit();
    const { gate } = fakeGate({ status: "pending", actionIds: [] });
    const { api, calls } = fakeNaive((sessions, tick) => {
      const root = sessions.get("ses_root")!;
      if (tick === 0) {
        root.events.push({ seq: 1, type: "thread.created", data: { thread_id: "ses_m", member: "clawback-filer" } });
        Object.assign(root, { status: "idle", stop_reason: "awaiting_delegation" });
        sessions.set("ses_m", {
          id: "ses_m",
          status: "idle",
          stop_reason: "awaiting_approval",
          pending_actions: [{ kind: "tool", tool_call_id: "u1", name: "clawback.draft_letter", args: {} }],
          consumed_micro_usd: 0,
          events: [],
        });
      }
      // The root stops on an error while its member is still open.
      if (tick === 2) root.stop_reason = "error";
    });
    const spec: RunSpec = { ...SPEC, members: [{ ...SPEC.members[0]!, tools: ["draft_letter"] }], tools: [...SPEC.tools, tool("draft_letter")] };
    const events = await collect(runtime(api, gate, fakeBudget(), audit).run(spec));
    // The allow is ours alone: no owner decision and no model turn stand between the park and the call.
    expect(calls.filter((c) => c.path.endsWith("/tool_confirmations")).map((c) => c.body)).toEqual([{ tool_call_id: "u1", decision: "allow" }]);
    expect(calls.filter((c) => c.path.endsWith("/cancel")).map((c) => c.path)).toEqual(["/sessions/ses_root/cancel", "/sessions/ses_m/cancel"]);
    expect(events).toContainEqual(expect.objectContaining({ type: "text", text: expect.stringContaining("1 parks (1 ungated), 2 sessions") }));
    expect(rows).toContainEqual(expect.objectContaining({ tool: "naive_run_stats", output: expect.objectContaining({ parks: 1, ungatedParks: 1, sessions: 2 }) }));
  });

  it("retries a cancel while naïve is unreachable, counts an ended session as cancelled, and reports what is left", async () => {
    const tries = new Map<string, number>();
    const api = (async (path: string) => {
      const id = path.split("/")[2]!;
      const n = (tries.get(id) ?? 0) + 1;
      tries.set(id, n);
      if (id === "ses_net" && n < 3) throw new Error("getaddrinfo ENOTFOUND api.vetta.sh");
      if (id === "ses_done") throw new NaiveError(409, "session_terminal", "ended");
      if (id === "ses_down") throw new Error("still offline");
      return {};
    }) as NaiveApi;
    expect(await cancelAll(api, ["ses_ok", "ses_net", "ses_done"], 1, 1000)).toEqual([]);
    expect(Object.fromEntries(tries)).toEqual({ ses_ok: 1, ses_net: 3, ses_done: 1 });
    expect(await cancelAll(api, ["ses_down"], 1, 20)).toEqual(["ses_down"]);
  });
});

describe("pickModel and toolsetFor", () => {
  it("picks the newest non-batch Sonnet, else Haiku", async () => {
    const list = (ids: string[]) => (async () => ({ data: ids.map((id) => ({ id })), has_more: false })) as unknown as NaiveApi;
    const sonnets = ["anthropic/claude-sonnet-5.5:batch", "anthropic/claude-sonnet-4.6", "anthropic/claude-sonnet-5", "~anthropic/claude-sonnet-latest"];
    expect(await pickModel(list(sonnets))).toBe("anthropic/claude-sonnet-5");
    expect(await pickModel(list(["anthropic/claude-haiku-5.5", "openai/gpt-6-luna"]))).toBe("anthropic/claude-haiku-5.5");
  });

  it("gives the coordinator its delegation tools", () => {
    expect(Object.keys(toolsetFor(SPEC.main, true).configs)).toEqual(["clawback.board_update", "send_to_agent", "wait_for_agents", "list_agents"]);
  });
});
