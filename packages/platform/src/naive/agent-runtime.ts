import { randomBytes } from "node:crypto";
import { setTimeout as sleep } from "node:timers/promises";
import { isGatedTool } from "@bill-fighter/shared/gated-tools";
import { getPlatform } from "../factory.ts";
import type { AgentDef, AgentRuntime, ApprovalGate, Audit, Budget, RunEvent, RunSpec } from "../types.ts";
import { listAll, microUsd, type NaiveApi, naiveApi, usdFromMicro } from "./runtime-http.ts";
import { releasedInRun, startToolServer, toolPath } from "./mcp-server.ts";
import { setBoardOwner } from "./mirror.ts";

/** The human's limit: no naïve run may spend more than this. */
export const MAX_RUN_USD = 2;
// Per agent per day on naïve, so three rehearsal runs and a retry fit; each run is still held to MAX_RUN_USD.
const AGENT_DAY_CAP_USD = 8;
const SERVER = "clawback";
const VAULT_NAME = "clawback-mcp";
const POLL_MS = 1500;
const MODEL_IDLE_MS = 180_000;
const COORDINATOR_TOOLS = ["wait_for_agents", "list_agents"];
// Asks so the loop sees its args: only wait: true (a thread on this run's budget) may run, never an independent handoff.
const DELEGATE = "send_to_agent";
const TERMINAL = new Set(["completed", "failed", "cancelled"]);
// Root stop reasons that end the run; awaiting_approval and awaiting_delegation keep it going.
const FINISHED = new Set(["end_turn", "awaiting_input"]);
const STOPPED = new Set(["max_iterations", "context_exhausted", "error", "interrupted", "awaiting_answer"]);

class OverBudget extends Error {}

export const naiveName = (agent: string) => `clawback-${agent}`;

export type Deps = {
  gate: ApprovalGate;
  budget: Budget;
  audit: Audit;
  api?: NaiveApi;
  publicUrl?: string;
  port?: number;
  pollMs?: number;
  idleMs?: number;
};

type PendingAction = { kind?: string; tool_call_id: string; name: string; args?: Record<string, unknown>; parked_seq?: number };
type Session = {
  id: string;
  status: string;
  stop_reason: string | null;
  pending_actions: PendingAction[];
  consumed_micro_usd: number;
};
type NaiveEvent = { seq: number; type: string; data: Record<string, unknown> };

/** NAIVE_MODEL, else the newest Sonnet naïve serves, else the newest Haiku. Batch-only ids and ~aliases are skipped. */
export async function pickModel(api: NaiveApi): Promise<string> {
  if (process.env.NAIVE_MODEL) return process.env.NAIVE_MODEL;
  const ids = (await listAll<{ id: string }>(api, "/models")).map((m) => m.id);
  const newest = (family: string) =>
    ids
      .map((id) => ({ id, m: new RegExp(`^anthropic/claude-${family}-(\\d+)(?:\\.(\\d+))?$`).exec(id) }))
      .filter((x) => x.m)
      .sort((a, b) => Number(b.m![1]) - Number(a.m![1]) || Number(b.m![2] ?? 0) - Number(a.m![2] ?? 0))[0]?.id;
  const model = newest("sonnet") ?? newest("haiku");
  if (!model) throw new Error("naïve lists no Claude Sonnet or Haiku model; set NAIVE_MODEL");
  return model;
}

/** Gated tools ask, every other tool of the agent is allowed, and everything else (built-ins, ask_operator) is denied. */
export function toolsetFor(def: AgentDef, coordinator: boolean) {
  const configs: Record<string, { enabled: boolean; permission: "allow" | "ask" }> = {};
  for (const tool of def.tools) configs[`${SERVER}.${tool}`] = { enabled: true, permission: isGatedTool(tool) ? "ask" : "allow" };
  if (coordinator) {
    configs[DELEGATE] = { enabled: true, permission: "ask" };
    for (const tool of COORDINATOR_TOOLS) configs[tool] = { enabled: true, permission: "allow" };
  }
  return { default_config: { permission: "deny" }, configs };
}

const delegationNote = (members: AgentDef[]) =>
  `\n\n## On this platform\nDelegate to a member with send_to_agent (wait: true), then wait_for_agents for the answer. Members by name: ${members
    .map((m) => `${m.name} is "${naiveName(m.name)}"`)
    .join(", ")}.`;

async function upsertAgent(api: NaiveApi, existing: Map<string, string>, body: Record<string, unknown>): Promise<string> {
  const id = existing.get(body.name as string);
  // No expected_version: this reconciles the agent to our roster, last write wins.
  if (id) return (await api<{ id: string }>(`/agents/${id}`, { method: "PATCH", body })).id;
  return (await api<{ id: string }>("/agents", { method: "POST", body })).id;
}

export function createAgentRuntime(deps: () => Promise<Deps>): AgentRuntime {
  return { run: (spec) => run(spec, deps) };
}

async function* run(spec: RunSpec, getDeps: () => Promise<Deps>): AsyncGenerator<RunEvent> {
  const main = spec.main.name;
  const pending: RunEvent[] = [];
  const inFlight = new Set<Promise<unknown>>();
  let ended = false;
  let over = false;
  let costUsd = 0;
  let outcome: { status: "success" | "error"; reason?: string } = { status: "error", reason: "the run did not start" };
  const cleanup: (() => Promise<unknown>)[] = [];
  let deps: Deps | undefined;
  let api: NaiveApi = naiveApi;
  let rootId: string | undefined;
  let rootDone = false;
  type Owned = { agent: string; afterSeq: number; consumed: number; session?: Session };
  // shortcut: the sessions this run owns live in memory for the life of run(), so the loop below only ever answers
  // calls on them. That holds one run at a time (the demo rule); upgrade to a table if runs ever overlap.
  const owned = new Map<string, Owned>();
  /** Adds the unrecorded part of a session's cumulative spend to Budget. */
  const account = async (entry: Owned, consumed: number) => {
    if (consumed <= entry.consumed || !deps) return;
    const delta = usdFromMicro(consumed - entry.consumed);
    entry.consumed = consumed;
    costUsd += delta;
    if ((await deps.budget.add(spec.runId, delta)).over) over = true;
  };

  try {
    deps = await getDeps();
    api = deps.api ?? naiveApi;
    const { gate, budget, audit } = deps;
    const publicUrl = (deps.publicUrl ?? process.env.NAIVE_MCP_PUBLIC_URL ?? "").replace(/\/$/, "");
    if (!publicUrl.startsWith("https://")) throw new Error("NAIVE_MCP_PUBLIC_URL must be the public https tunnel to the tool server");
    const pollMs = deps.pollMs ?? POLL_MS;
    const idleMs = deps.idleMs ?? (Number(process.env.MODEL_IDLE_MS) || MODEL_IDLE_MS);

    const start = await budget.status(spec.runId);
    const capUsd = Math.min(MAX_RUN_USD, start.capUsd - start.totalUsd);
    if (capUsd <= 0) {
      over = true;
      throw new OverBudget();
    }

    // Our tools, served for naïve behind a per-run bearer that only naïve's vault holds.
    const token = randomBytes(32).toString("base64url");
    const defs = [spec.main, ...spec.members];
    const server = await startToolServer(
      {
        runId: spec.runId,
        agents: defs,
        tools: spec.tools,
        token,
        gate,
        onDenied: (agent, tool, reason) => pending.push({ type: "denied", agent, tool, reason }),
        ended: () => ended,
        running: (work) => {
          const handler = work();
          const settled = handler.then(
            () => {},
            () => {},
          );
          inFlight.add(settled);
          void settled.then(() => inFlight.delete(settled));
          return handler;
        },
      },
      deps.port ?? (Number(process.env.NAIVE_MCP_PORT) || 8790),
    );
    cleanup.push(server.close);

    const vaults = await listAll<{ id: string; display_name: string }>(api, "/vaults");
    const vaultId =
      vaults.find((v) => v.display_name === VAULT_NAME)?.id ??
      (await api<{ id: string }>("/vaults", { method: "POST", body: { display_name: VAULT_NAME } })).id;
    for (const def of defs.filter((d) => d.tools.length > 0)) {
      const credential = await api<{ id: string }>(`/vaults/${vaultId}/credentials`, {
        method: "POST",
        body: { kind: "static_bearer", key: `${naiveName(def.name)} ${spec.runId}`, mcp_server_url: publicUrl + toolPath(def.name), value: token },
      });
      cleanup.push(() => api(`/vaults/${vaultId}/credentials/${credential.id}`, { method: "DELETE" }));
    }

    const model = await pickModel(api);
    const existing = new Map((await listAll<{ id: string; name: string }>(api, "/agents")).map((a) => [a.name, a.id]));
    const budgetBody = { cap_micro_usd: microUsd(AGENT_DAY_CAP_USD), max_task_micro_usd: microUsd(MAX_RUN_USD), period: "day" };
    const agentBody = (def: AgentDef, coordinator: boolean) => ({
      name: naiveName(def.name),
      model,
      description: def.description,
      system: def.prompt + (coordinator ? delegationNote(spec.members) : ""),
      tools: toolsetFor(def, coordinator),
      mcp_servers: def.tools.length > 0 ? [{ type: "url", name: SERVER, url: publicUrl + toolPath(def.name) }] : [],
      handoffs: coordinator ? "team" : false,
      budget: budgetBody,
      metadata: { app: "clawback" },
    });
    // Members first: the coordinator's roster pins each member's current version when it is saved.
    const memberIds = new Map<string, string>();
    for (const def of spec.members) memberIds.set(def.name, await upsertAgent(api, existing, agentBody(def, false)));
    const mainId = await upsertAgent(api, existing, {
      ...agentBody(spec.main, true),
      // board stays off: our board_cards are the record, mirrored by naive/board.ts, and no digest sessions start.
      multiagent: spec.members.length > 0 ? { type: "coordinator", agents: [...memberIds.values()].map((id) => ({ type: "agent", id })), board: false } : null,
    });
    setBoardOwner(mainId);
    cleanup.push(async () => setBoardOwner(null));

    const root = await api<Session>("/sessions", {
      method: "POST",
      body: { agent_id: mainId, message: spec.prompt, budget_micro_usd: microUsd(capUsd), metadata: { run_id: spec.runId } },
    });
    rootId = root.id;
    owned.set(root.id, { agent: main, afterSeq: 0, consumed: 0 });
    // One key per parked occurrence: naïve reuses a call's id when the same call is proposed in a later turn, and
    // parked_seq tells the two apart.
    const handled = new Set<string>();
    const occurrence = (sessionId: string, action: PendingAction) => `${sessionId}:${action.tool_call_id}:${action.parked_seq ?? ""}`;
    const ours = new Set(spec.tools.map((def) => def.name));
    const memberOf = (naive: unknown) => {
      const name = String(naive ?? "");
      return name.startsWith("clawback-") ? name.slice("clawback-".length) : name;
    };
    let lastProgress = Date.now();

    const readEvents = async (sessionId: string) => {
      const entry = owned.get(sessionId)!;
      for (;;) {
        const page = await api<{ data: NaiveEvent[]; has_more: boolean }>(`/sessions/${sessionId}/events`, {
          query: { after_seq: entry.afterSeq, include_accepted: true, limit: 100 },
        });
        for (const event of page.data) {
          entry.afterSeq = Math.max(entry.afterSeq, event.seq);
          lastProgress = Date.now();
          const { data } = event;
          const tool = String(data.name ?? "").replace(`${SERVER}.`, "");
          if (event.type === "message.completed" && data.role !== "user" && data.from !== "platform" && typeof data.content === "string") {
            pending.push({ type: "text", agent: entry.agent, text: data.content });
          } else if (event.type === "tool.started") {
            pending.push({ type: "tool_call", agent: entry.agent, tool, input: data.args });
          } else if (event.type === "tool.completed") {
            pending.push({ type: "tool_result", agent: entry.agent, tool, output: data.output });
          } else if (event.type === "thread.created" && typeof data.thread_id === "string" && !owned.has(data.thread_id)) {
            owned.set(data.thread_id, { agent: memberOf(data.member ?? data.agent_name), afterSeq: 0, consumed: 0 });
          } else if (event.type === "tool.confirm.resolved") {
            const approval = await gate.get(spec.runId);
            await audit.record({
              runId: spec.runId,
              agent: entry.agent,
              tool: "naive_tool_confirm",
              input: { session: sessionId, tool_call_id: data.tool_call_id, args: data.proposed_args },
              output: { decision: data.decision, reason: data.reason, naiveActor: data.actor, approvedBy: approval?.approvedBy ?? null, channel: approval?.channel ?? null },
            });
          }
        }
        if (!page.has_more || page.data.length === 0) return;
      }
    };

    /** The single approval rule: approved bundle → allow; pending bundle holding the action → wait; anything else → deny. */
    const decide = async (sessionId: string, action: PendingAction): Promise<boolean> => {
      const actionId = action.args?.actionId;
      const bare = action.name.startsWith(`${SERVER}.`) ? action.name.slice(SERVER.length + 1) : "";
      let decision: "allow" | "deny";
      let reason: string | undefined;
      if (action.name === DELEGATE && sessionId === root.id) {
        // wait: false would start a top-level session on its own budget, outside this run's tracking and cap.
        decision = action.args?.wait === true ? "allow" : "deny";
        if (decision === "deny") reason = "Delegate with wait: true; independent handoffs are not allowed in this run.";
      } else if (!ours.has(bare)) {
        decision = "deny";
        reason = `${action.name} is not a tool of this run`;
      } else if (!isGatedTool(bare)) {
        // naïve asks even on an allowed MCP tool once the chat has read mail text (seen live on parse_inbound_email).
        // An ungated tool needs no approval, as in local mode; our tool server still enforces the gate on gated ones.
        decision = "allow";
      } else if (typeof actionId !== "string" || !actionId) {
        decision = "deny";
        reason = `${action.name} needs an actionId to be approved`;
      } else if (await releasedInRun(gate, spec.runId, actionId)) {
        decision = "allow";
      } else {
        const approval = await gate.get(spec.runId);
        if (approval?.status === "pending" && approval.actionIds.includes(actionId)) return false; // Linda has not answered yet.
        decision = "deny";
        reason = `Action ${actionId} did not run and nothing was changed: the owner denied its approval request, or it was never in one. It is not pending.`;
      }
      await api(`/sessions/${sessionId}/tool_confirmations`, { method: "POST", body: { tool_call_id: action.tool_call_id, decision, ...(reason ? { reason } : {}) } });
      if (decision === "deny") pending.push({ type: "denied", agent: owned.get(sessionId)!.agent, tool: action.name.replace(`${SERVER}.`, ""), reason: reason! });
      return true;
    };

    for (;;) {
      let waitingOnOwner = false;
      const parkedRows: { sessionId: string; action: PendingAction }[] = [];
      // Live iteration: a thread found in this round's events is polled in the same round.
      for (const [sessionId, entry] of owned) {
        if (entry.session && TERMINAL.has(entry.session.status)) continue;
        // State first, then events: every event up to that state is read before the loop acts on it.
        const session = (entry.session = await api<Session>(`/sessions/${sessionId}`));
        await readEvents(sessionId);
        await account(entry, session.consumed_micro_usd ?? 0);
        // Branch on kind, never on name: a question row is never a tool call.
        if (session.stop_reason === "awaiting_approval")
          for (const action of session.pending_actions.filter((a) => (a.kind ?? "tool") === "tool")) parkedRows.push({ sessionId, action });
      }
      // naïve also lists a member's parked call on the coordinator (seen in the probe): answer each call once, on the
      // member, and count every listing of it seen with it as handled.
      const byCall = new Map<string, typeof parkedRows>();
      for (const row of parkedRows) byCall.set(row.action.tool_call_id, [...(byCall.get(row.action.tool_call_id) ?? []), row]);
      for (const rows of byCall.values()) {
        const fresh = rows.filter((row) => !handled.has(occurrence(row.sessionId, row.action)));
        const onMember = rows.some((row) => row.sessionId !== root.id);
        // A coordinator copy is never answered while the member holds the call.
        const pick = fresh.find((row) => row.sessionId !== root.id) ?? (onMember ? undefined : fresh[0]);
        if (!pick) continue;
        if (await decide(pick.sessionId, pick.action)) for (const row of fresh) handled.add(occurrence(row.sessionId, row.action));
        else waitingOnOwner = true;
      }
      yield* pending.splice(0);
      const rootSession = owned.get(root.id)!.session!;
      if (over || rootSession.stop_reason === "budget_paused") {
        over = true;
        break;
      }
      if (TERMINAL.has(rootSession.status)) {
        rootDone = true;
        outcome = rootSession.status === "completed" ? { status: "success" } : { status: "error", reason: `naïve session ${rootSession.status}` };
        break;
      }
      if (rootSession.status === "idle" && FINISHED.has(rootSession.stop_reason ?? "")) {
        outcome = { status: "success" };
        break;
      }
      if (rootSession.status === "idle" && STOPPED.has(rootSession.stop_reason ?? "")) {
        outcome = { status: "error", reason: `naïve session stopped: ${rootSession.stop_reason}` };
        break;
      }
      // Waiting on the owner or on a running tool is not the model being quiet.
      if (waitingOnOwner || inFlight.size > 0) lastProgress = Date.now();
      if (Date.now() - lastProgress > idleMs) {
        outcome = { status: "error", reason: `The model did not answer for ${idleMs / 1000} s` };
        break;
      }
      await sleep(pollMs);
    }
  } catch (error) {
    if (!(error instanceof OverBudget)) outcome = { status: "error", reason: error instanceof Error ? error.message : String(error) };
  } finally {
    ended = true;
    // A run that stops early must not leave naïve working or parked: cancel the root, which stops its threads.
    if (rootId && !rootDone) await api(`/sessions/${rootId}/cancel`, { method: "POST" }).catch(() => {});
    await Promise.all(inFlight);
    // Reconcile: a cancelled in-flight call is still billed, so read every owned session's final cumulative spend.
    for (const [sessionId, entry] of owned) {
      await api<Session>(`/sessions/${sessionId}`)
        .then((session) => account(entry, session.consumed_micro_usd ?? 0))
        .catch((error) => console.warn(`naïve final usage for ${sessionId}: ${error instanceof Error ? error.message : String(error)}`));
    }
    for (const step of cleanup.reverse()) await step().catch((error) => console.warn(`naïve cleanup: ${error instanceof Error ? error.message : String(error)}`));
  }

  try {
    if (!over && deps) over = (await deps.budget.status(spec.runId)).over;
  } catch (error) {
    outcome = { status: "error", reason: error instanceof Error ? error.message : String(error) };
  }
  yield* pending.splice(0);
  if (over) yield { type: "text", agent: main, text: `Stopped: cost reached the run cap (at most $${MAX_RUN_USD} on naïve).` };
  else if (outcome.status === "error") yield { type: "text", agent: main, text: `Run failed: ${outcome.reason}` };
  yield { type: "text", agent: main, text: `naïve cost: $${costUsd.toFixed(4)} (consumed_micro_usd, billed to naïve credit).` };
  yield { type: "result", status: over ? "over_budget" : outcome.status, costUsd, ...(outcome.status === "error" && !over ? { reason: outcome.reason } : {}) };
}

export default createAgentRuntime(async () => {
  const platform = getPlatform();
  return { gate: await platform.approvalGate(), budget: await platform.budget(), audit: await platform.audit() };
});
