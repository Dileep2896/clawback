import { describe, expect, it } from "vitest";
import { z } from "zod";
import type { Approval, ApprovalGate, Audit, Budget, RunEvent, RunSpec, ToolDef } from "../types.ts";
import { createAgentRuntime, MAX_RUN_USD, pickModel, toolsetFor } from "./agent-runtime.ts";
import type { NaiveApi, NaiveRequest } from "./runtime-http.ts";

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
      return ses;
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
const runtime = (api: NaiveApi, gate: ApprovalGate, budget: Budget, audit: Audit) =>
  createAgentRuntime(async () => ({ api, gate, budget, audit, publicUrl: "https://tunnel.test", port: 0, pollMs: 1, idleMs: 5000 }));

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
    // The run's vault credentials are removed at the end.
    expect(calls.filter((c) => c.method === "DELETE")).toHaveLength(2);
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
