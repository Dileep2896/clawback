import { randomBytes } from "node:crypto";
import { setTimeout as sleep } from "node:timers/promises";
import { isGatedTool } from "@bill-fighter/shared/gated-tools";
import { getPlatform } from "../factory.ts";
import type { AgentDef, AgentRuntime, ApprovalGate, Audit, Budget, RunEvent, RunSpec } from "../types.ts";
import { listAll, microUsd, type NaiveApi, naiveApi, NaiveError, usdFromMicro } from "./runtime-http.ts";
import { releasedInRun, startToolServer, toolPath } from "./mcp-server.ts";

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
// The runtime keeps the coordinator's board itself: an MCP result flags a naïve chat, after which each MCP call is
// refused once and re-issued by the model (seen live, flag-probe.ts), and board_update was most of the CEO's calls.
// Members still park on every call, their first included (Sonnet measurement run, naive-rehearsal-notes.md).
const BOARD_TOOL = "board_update";
const CANCEL_RETRY_MS = 5000;
const CANCEL_GIVE_UP_MS = 5 * 60_000;
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
  /** Waits between cleanup cancel retries; tests shorten them. */
  cancelRetryMs?: number;
  cancelGiveUpMs?: number;
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

const BOARD_NOTE =
  "\n\n## The board on this platform\nThe board is kept for you: a card is made for each member task you delegate and moved when the member reports. Do not call board_update; it is not available here.";

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
  // consumed: naïve's cumulative spend seen so far; persisted: how much of it Budget has recorded.
  type Owned = { agent: string; afterSeq: number; consumed: number; persisted: number; session?: Session };
  // shortcut: the sessions this run owns live in memory for the life of run(), so the loop below only ever answers
  // calls on them. That holds one run at a time (the demo rule); upgrade to a table if runs ever overlap.
  const owned = new Map<string, Owned>();
  const startedAt = Date.now();
  const stats = { parks: 0, ungatedParks: 0 };
  // Board cards the runtime keeps: tasks queued per member at delegation, bound to a thread when naïve starts it.
  const queuedTasks = new Map<string, string[]>();
  const cardOfThread = new Map<string, string>();
  let boardTool: RunSpec["tools"][number] | undefined;
  const boardWrite = async (input: Record<string, unknown>) => {
    try {
      return (await boardTool!.handler(input, { runId: spec.runId, agent: main })) as { cardId?: string } | undefined;
    } catch (error) {
      console.warn(`naïve board card: ${error instanceof Error ? error.message : String(error)}`);
    }
  };
  // A card's move is kept until it is written: a failed write is retried each round, and the run fails if it never lands.
  // The first outcome wins (thread.idle then thread.terminated stays done).
  const closing = new Map<string, "done" | "blocked">();
  const flushCards = async () => {
    for (const [threadId, status] of closing) {
      try {
        await boardTool!.handler({ cardId: cardOfThread.get(threadId), status }, { runId: spec.runId, agent: main });
        closing.delete(threadId);
        cardOfThread.delete(threadId);
      } catch (error) {
        console.warn(`naïve board card ${cardOfThread.get(threadId)}: ${error instanceof Error ? error.message : String(error)}`);
      }
    }
  };
  const closeCard = async (threadId: string, status: "done" | "blocked") => {
    if (!cardOfThread.has(threadId) || closing.has(threadId)) return;
    closing.set(threadId, status);
    await flushCards();
  };
  /** Reports a session's new cumulative spend, and adds whatever Budget has not recorded yet; a failed write is retried next time. */
  const account = async (entry: Owned, consumed: number) => {
    if (consumed > entry.consumed) {
      costUsd += usdFromMicro(consumed - entry.consumed);
      entry.consumed = consumed;
    }
    if (entry.consumed <= entry.persisted || !deps) return;
    const target = entry.consumed;
    const { over: hit } = await deps.budget.add(spec.runId, usdFromMicro(target - entry.persisted));
    entry.persisted = target;
    if (hit) over = true;
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
    // No members, nobody to make cards for: the coordinator then keeps its own board as before.
    boardTool = spec.members.length > 0 && spec.main.tools.includes(BOARD_TOOL) ? spec.tools.find((t) => t.name === BOARD_TOOL) : undefined;
    const mainDef: AgentDef = boardTool
      ? { ...spec.main, tools: spec.main.tools.filter((t) => t !== BOARD_TOOL), prompt: spec.main.prompt + BOARD_NOTE }
      : spec.main;
    const defs = [mainDef, ...spec.members];
    const server = await startToolServer(
      {
        runId: spec.runId,
        agents: defs,
        tools: spec.tools,
        token,
        gate,
        onDenied: (agent, tool, reason) => pending.push({ type: "denied", agent, tool, reason }),
        // Over budget, no new tool call starts, even before the loop notices.
        ended: () => ended || over,
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
    // No members, no roster: naïve rejects handoffs "team" without one, so the main agent gets no delegation at all.
    const delegates = spec.members.length > 0;
    const agentBody = (def: AgentDef, coordinator: boolean) => ({
      name: naiveName(def.name),
      model,
      description: def.description,
      system: def.prompt + (coordinator && delegates ? delegationNote(spec.members) : ""),
      tools: toolsetFor(def, coordinator && delegates),
      mcp_servers: def.tools.length > 0 ? [{ type: "url", name: SERVER, url: publicUrl + toolPath(def.name) }] : [],
      handoffs: coordinator && delegates ? "team" : false,
      budget: budgetBody,
      metadata: { app: "clawback" },
    });
    // Members first: the coordinator's roster pins each member's current version when it is saved.
    const memberIds = new Map<string, string>();
    for (const def of spec.members) memberIds.set(def.name, await upsertAgent(api, existing, agentBody(def, false)));
    const mainId = await upsertAgent(api, existing, {
      ...agentBody(mainDef, true),
      // board stays off and nothing is written to naïve's board, so no digest sessions start: our board_cards are the record.
      multiagent: delegates ? { type: "coordinator", agents: [...memberIds.values()].map((id) => ({ type: "agent", id })), board: false } : null,
    });

    const root = await api<Session>("/sessions", {
      method: "POST",
      body: { agent_id: mainId, message: spec.prompt, budget_micro_usd: microUsd(capUsd), metadata: { run_id: spec.runId } },
    });
    rootId = root.id;
    owned.set(root.id, { agent: main, afterSeq: 0, consumed: 0, persisted: 0 });
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
            const member = memberOf(data.member ?? data.agent_name);
            owned.set(data.thread_id, { agent: member, afterSeq: 0, consumed: 0, persisted: 0 });
            if (boardTool) {
              const title = queuedTasks.get(member)?.shift() ?? `Work for ${member}`;
              const card = await boardWrite({ agent: member, title, status: "doing" });
              if (card?.cardId) cardOfThread.set(data.thread_id, card.cardId);
            }
          } else if (event.type === "thread.idle" && typeof data.thread_id === "string") {
            // The member's result folded back; one that stopped on an error did not finish its step.
            // Read the thread now: the loop may not have polled it since it ended, or ever.
            const entry = owned.get(data.thread_id);
            const thread = entry ? (entry.session = await api<Session>(`/sessions/${data.thread_id}`)) : undefined;
            await closeCard(data.thread_id, thread && (thread.status === "failed" || STOPPED.has(thread.stop_reason ?? "")) ? "blocked" : "done");
          } else if (event.type === "thread.terminated" && typeof data.thread_id === "string") {
            await closeCard(data.thread_id, "blocked");
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
        // "team" also reaches the company CEO, whose tools this run does not configure: only our roster is allowed.
        const target = String(action.args?.agent ?? "");
        if (action.args?.wait !== true) {
          decision = "deny";
          reason = "Delegate with wait: true; independent handoffs are not allowed in this run.";
        } else if (!spec.members.some((m) => naiveName(m.name) === target || memberIds.get(m.name) === target)) {
          decision = "deny";
          reason = `${target || "That agent"} is not a member of this run; delegate only to its members.`;
        } else {
          decision = "allow";
          const member = spec.members.find((m) => naiveName(m.name) === target || memberIds.get(m.name) === target)!.name;
          const task = String(action.args?.message ?? "").split("\n").find((line) => line.trim())?.trim().slice(0, 120);
          if (task) queuedTasks.set(member, [...(queuedTasks.get(member) ?? []), task]);
        }
      } else if (!ours.has(bare)) {
        decision = "deny";
        reason = `${action.name} is not a tool of this run`;
      } else if (!isGatedTool(bare)) {
        // naïve asks even on an allowed MCP tool once the chat has read mail text (seen live on parse_inbound_email).
        // An ungated tool needs no approval, as in local mode; our tool server still enforces the gate on gated ones.
        // The allow runs the call with no model turn (seen live); the turn naïve's refusal cost is already spent.
        decision = "allow";
        stats.ungatedParks++;
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
      stats.parks++;
      if (decision === "deny") pending.push({ type: "denied", agent: owned.get(sessionId)!.agent, tool: action.name.replace(`${SERVER}.`, ""), reason: reason! });
      return true;
    };

    for (;;) {
      let waitingOnOwner = false;
      const parkedRows: { sessionId: string; action: PendingAction }[] = [];
      await flushCards();
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
      // naïve also lists a member's parked call on the coordinator (seen in the probe): answer every member's
      // occurrence on its own session, and only count the coordinator copy as handled with it.
      const byCall = new Map<string, typeof parkedRows>();
      for (const row of parkedRows) byCall.set(row.action.tool_call_id, [...(byCall.get(row.action.tool_call_id) ?? []), row]);
      for (const rows of byCall.values()) {
        const fresh = rows.filter((row) => !handled.has(occurrence(row.sessionId, row.action)));
        const copies = fresh.filter((row) => row.sessionId === root.id);
        // A coordinator copy is never answered while a member holds the call.
        const picks = rows.some((row) => row.sessionId !== root.id) ? fresh.filter((row) => row.sessionId !== root.id) : copies.slice(0, 1);
        for (const pick of picks) {
          // Over budget, nothing more is confirmed: the run stops and cancels below.
          if (over) break;
          if (await decide(pick.sessionId, pick.action)) for (const row of [pick, ...copies]) handled.add(occurrence(row.sessionId, row.action));
          else waitingOnOwner = true;
        }
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
    // A run that stops early must not leave naïve working or parked: cancel every session it owns, not only the root.
    const left = await cancelAll(
      api,
      [...owned].filter(([id, entry]) => !(id === rootId && rootDone) && !TERMINAL.has(entry.session?.status ?? "")).map(([id]) => id),
      deps?.cancelRetryMs ?? CANCEL_RETRY_MS,
      deps?.cancelGiveUpMs ?? CANCEL_GIVE_UP_MS,
    );
    if (left.length > 0) console.warn(`naïve sessions still open, cancel them by hand (POST /v1/sessions/{id}/cancel): ${left.join(", ")}`);
    await Promise.all(inFlight);
    // A step that never reported did not finish.
    for (const threadId of cardOfThread.keys()) if (!closing.has(threadId)) closing.set(threadId, "blocked");
    await flushCards();
    if (closing.size > 0 && outcome.status === "success")
      outcome = { status: "error", reason: `board cards not updated: ${[...closing.keys()].map((id) => cardOfThread.get(id)).join(", ")}` };
    // Reconcile: a cancelled in-flight call is still billed, so read every owned session's final cumulative spend.
    for (const [sessionId, entry] of owned) {
      const warn = (error: unknown) => console.warn(`naïve final usage for ${sessionId}: ${error instanceof Error ? error.message : String(error)}`);
      // A failed read still retries recording the usage already seen.
      const consumed = await api<Session>(`/sessions/${sessionId}`).then((session) => session.consumed_micro_usd ?? 0, (error) => (warn(error), 0));
      await account(entry, consumed).catch(warn);
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
  const seconds = Math.round((Date.now() - startedAt) / 1000);
  yield {
    type: "text",
    agent: main,
    text: `naïve cost: $${costUsd.toFixed(4)} (consumed_micro_usd, billed to naïve credit), ${seconds} s, ${stats.parks} parks (${stats.ungatedParks} ungated), ${owned.size} sessions.`,
  };
  if (deps)
    await deps.audit
      .record({ runId: spec.runId, agent: main, tool: "naive_run_stats", input: {}, output: { ...stats, sessions: owned.size, seconds, costUsd } })
      .catch((error: unknown) => console.warn(`naïve run stats: ${error instanceof Error ? error.message : String(error)}`));
  yield { type: "result", status: over ? "over_budget" : outcome.status, costUsd, ...(outcome.status === "error" && !over ? { reason: outcome.reason } : {}) };
}

const isTerminalRefusal = (error: unknown) => error instanceof NaiveError && error.status === 409 && error.code === "session_terminal";

/**
 * Cancels each session, retrying while naïve cannot be reached (a sleep or network loss mid-run). An ended session's
 * 409 counts as done. Returns the ids still open when it gives up.
 */
export async function cancelAll(api: NaiveApi, ids: string[], retryMs: number, giveUpMs: number): Promise<string[]> {
  let open = ids;
  const until = Date.now() + giveUpMs;
  for (;;) {
    const results = await Promise.all(
      open.map((id) =>
        api(`/sessions/${id}/cancel`, { method: "POST" }).then(
          () => true,
          (error: unknown) => isTerminalRefusal(error),
        ),
      ),
    );
    open = open.filter((_, i) => !results[i]);
    if (open.length === 0 || Date.now() + retryMs > until) return open;
    await sleep(retryMs);
  }
}

export default createAgentRuntime(async () => {
  const platform = getPlatform();
  return { gate: await platform.approvalGate(), budget: await platform.budget(), audit: await platform.audit() };
});
