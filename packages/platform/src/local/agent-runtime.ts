import {
  type CanUseTool,
  createSdkMcpServer,
  type HookCallback,
  type Options,
  type PreToolUseHookInput,
  query as sdkQuery,
  type SDKMessage,
  tool,
} from "@anthropic-ai/claude-agent-sdk";
import { isGatedTool } from "@bill-fighter/shared/gated-tools";
import { z } from "zod";
import { getPlatform } from "../factory.ts";
import type { AgentDef, AgentRuntime, ApprovalGate, Budget, RunEvent, RunSpec, ToolDef } from "../types.ts";
import { assertInit, checkLogin, errorText, loginOptions, runOutcome } from "./claude-login.ts";

const SERVER = "platform";
const PREFIX = `mcp__${SERVER}__`;
// The model calls "Agent", while the init message lists the same tool as "Task".
const SUBAGENT_TOOLS = ["Agent", "Task"];

// A subagent's messages count, and the SDK only sends whole messages, so this must outlast one long model turn.
const MODEL_IDLE_MS = 180_000;

export type Query = (params: { prompt: string; options: Options }) => AsyncIterable<SDKMessage>;
export type Deps = { gate: ApprovalGate; budget: Budget; query?: Query; login?: () => Promise<void>; idleMs?: number };

/** Fails when the model goes quiet. Waiting on the owner or on a tool is not the model being quiet, so `hold` pauses it. */
function idleWatch(idleMs: number) {
  let holds = 0;
  let timer: NodeJS.Timeout | undefined;
  let expire: (error: Error) => void = () => {};
  const expired = new Promise<never>((_, reject) => (expire = reject));
  expired.catch(() => {});
  const touch = () => {
    clearTimeout(timer);
    if (holds === 0) timer = setTimeout(() => expire(new Error(`The model did not answer for ${idleMs / 1000} s`)), idleMs);
  };
  return {
    expired,
    touch,
    stop: () => clearTimeout(timer),
    async hold<T>(work: () => Promise<T>): Promise<T> {
      holds++;
      clearTimeout(timer);
      try {
        return await work();
      } finally {
        holds--;
        touch();
      }
    },
  };
}

/** canUseTool only runs for calls that fall through allowedTools, so a gated tool here would skip approval. */
export function allowedToolNames(tools: ToolDef[]): string[] {
  return tools.filter((def) => !isGatedTool(def.name)).map((def) => PREFIX + def.name);
}

/** Denies by default. A deny never interrupts, so control returns to the agent. */
export function createCanUseTool(
  tools: ToolDef[],
  gate: Pick<ApprovalGate, "waitForRelease">,
  onDenied: (tool: string, reason: string, toolUseId: string) => void,
): CanUseTool {
  const known = new Set(tools.map((def) => def.name));
  return async (name, input, { signal, mcpServer, toolUseID }) => {
    const deny = (message: string) => {
      onDenied(name, message, toolUseID);
      return { behavior: "deny" as const, message };
    };
    const allow = { behavior: "allow" as const, updatedInput: input };
    const bare = name.startsWith(PREFIX) ? name.slice(PREFIX.length) : "";
    // The SDK says to trust source, not the name, which a configured server could imitate.
    if (mcpServer?.source !== "sdk" || mcpServer.name !== SERVER || !known.has(bare)) {
      return deny(`${name} is not a tool of this run`);
    }
    if (!isGatedTool(bare)) return allow;

    const { actionId } = input;
    if (typeof actionId !== "string" || !actionId) return deny(`${bare} needs an actionId to be approved`);
    try {
      if (await gate.waitForRelease(actionId, signal)) return allow;
      return deny(`Action ${actionId} did not run and nothing was changed: the owner denied its approval request, or it was never in one. It is not pending.`);
    } catch (error) {
      return deny(`Could not check approval for ${actionId}: ${errorText(error)}`);
    }
  };
}

function mcpTool(
  def: ToolDef,
  runId: string,
  gate: Pick<ApprovalGate, "isReleased">,
  callerOf: (toolUseId: unknown) => string,
  onDenied: (agent: string, name: string, reason: string, toolUseId: string) => void,
  running: <T>(work: () => Promise<T>) => Promise<T>,
) {
  if (!(def.inputSchema instanceof z.ZodObject)) throw new Error(`Tool ${def.name}: inputSchema must be a z.object`);
  // shortcut: the SDK types ask for a raw shape, which would drop refinements and strictness, but it hands a whole
  // z.object to MCP, which validates with it before the handler. The tests fail if an SDK upgrade changes that.
  const schema = def.inputSchema as unknown as z.ZodRawShape;
  return tool(def.name, def.description, schema, async (input, extra) => {
    const toolUseId = (extra as { _meta?: Record<string, unknown> })._meta?.["claudecode/toolUseId"];
    const agent = callerOf(toolUseId);
    try {
      // Managed allow rules skip canUseTool even with settingSources: [], so approval is also enforced here,
      // on the validated input, where nothing can route around it.
      if (isGatedTool(def.name)) {
        const { actionId } = input;
        if (typeof actionId !== "string" || !actionId || !(await gate.isReleased(actionId))) {
          const reason = `${def.name} ran without an approved actionId`;
          onDenied(agent, def.name, reason, toolUseId as string);
          return { content: [{ type: "text" as const, text: reason }], isError: true };
        }
      }
      const output = await running(() => def.handler(input, { runId, agent }));
      return { content: [{ type: "text" as const, text: JSON.stringify(output) ?? "null" }] };
    } catch (error) {
      return { content: [{ type: "text" as const, text: errorText(error) }], isError: true };
    }
  });
}

export function createAgentRuntime(deps: () => Promise<Deps>): AgentRuntime {
  return { run: (spec) => run(spec, deps) };
}

async function* run(spec: RunSpec, deps: () => Promise<Deps>): AsyncGenerator<RunEvent> {
  const main = spec.main.name;
  const abortController = new AbortController();
  const pending: RunEvent[] = [];
  const denied = new Set<string>();
  const onDenied = (agent: string, name: string, reason: string, toolUseId: string) => {
    denied.add(toolUseId);
    pending.push({ type: "denied", agent, tool: name.replace(PREFIX, ""), reason });
  };

  // shortcut: the SDK does not tell a handler its caller, so this reads an undocumented _meta key set by the CLI.
  // A missing key labels the call as the main agent. Upgrade if the SDK adds a documented field.
  const callers = new Map<unknown, string>();
  const defs = new Map<string, AgentDef>([spec.main, ...spec.members].map((def) => [def.name, def]));

  // tools: ["Agent"] limits built-ins only, so this is what holds the main agent to its own AgentDef.tools.
  const preToolUse: HookCallback = async (input) => {
    const { tool_use_id, tool_name, agent_type } = input as PreToolUseHookInput & { agent_type?: string };
    const agent = agent_type ?? main;
    callers.set(tool_use_id, agent);
    if (!tool_name.startsWith(PREFIX) || defs.get(agent)?.tools.includes(tool_name.slice(PREFIX.length))) return {};
    const reason = `${agent} may not use ${tool_name.slice(PREFIX.length)}`;
    onDenied(agent, tool_name, reason, tool_use_id);
    return {
      hookSpecificOutput: { hookEventName: "PreToolUse", permissionDecision: "deny", permissionDecisionReason: reason },
    };
  };

  const subagentOf = new Map<string, string>();
  const toolOf = new Map<string, string>();
  const agentOf = (message: { parent_tool_use_id: string | null }) =>
    (message.parent_tool_use_id && subagentOf.get(message.parent_tool_use_id)) || main;

  let costUsd = 0;
  let over = false;
  const messages: SDKMessage[] = [];
  const thrown: unknown[] = [];
  const hasMembers = spec.members.length > 0;
  const allowedInit = {
    tools: [...spec.tools.map((def) => PREFIX + def.name), ...(hasMembers ? SUBAGENT_TOOLS : [])],
    agents: spec.members.map((def) => def.name),
  };

  let watch: ReturnType<typeof idleWatch> | undefined;
  const inFlight = new Set<Promise<unknown>>();

  try {
    const { gate, budget, query = sdkQuery as Query, login = checkLogin, idleMs = Number(process.env.MODEL_IDLE_MS) || MODEL_IDLE_MS } = await deps();
    const start = await budget.status(spec.runId);
    const remainingUsd = start.capUsd - start.totalUsd;
    if (remainingUsd <= 0) {
      over = true;
    } else {
      const watched = (watch = idleWatch(idleMs));
      watched.touch();
      await Promise.race([login(), watched.expired]);
      const running = <T>(work: () => Promise<T>) => {
        const handler = watched.hold(work);
        const settled = handler.then(
          () => {},
          () => {},
        );
        inFlight.add(settled);
        void settled.then(() => inFlight.delete(settled));
        return handler;
      };
      const canUseTool = createCanUseTool(
        spec.tools,
        { waitForRelease: (actionId, signal) => watched.hold(() => gate.waitForRelease(actionId, signal)) },
        (name, reason, toolUseId) => onDenied(callers.get(toolUseId) ?? main, name, reason, toolUseId),
      );
      const options: Options = {
        ...loginOptions(),
        abortController,
        systemPrompt: spec.main.prompt,
        maxTurns: spec.main.maxTurns,
        // An estimate: the SDK computes it locally, and on the login it is not what the owner is charged.
        maxBudgetUsd: remainingUsd,
        tools: hasMembers ? ["Agent"] : [],
        allowedTools: allowedToolNames(spec.tools),
        canUseTool,
        hooks: { PreToolUse: [{ hooks: [preToolUse] }] },
        agents: Object.fromEntries(
          spec.members.map((def) => [
            def.name,
            {
              description: def.description,
              prompt: def.prompt,
              tools: def.tools.map((name) => PREFIX + name),
              maxTurns: def.maxTurns,
            },
          ]),
        ),
        mcpServers: {
          [SERVER]: createSdkMcpServer({
            name: SERVER,
            version: "1.0.0",
            tools: spec.tools.map((def) => mcpTool(def, spec.runId, gate, (id) => callers.get(id) ?? main, onDenied, running)),
          }),
        },
      };

      const stream = query({ prompt: spec.prompt, options })[Symbol.asyncIterator]();
      // A race, not only the abort: a hung stream may never react to the abort.
      for (;;) {
        watched.touch();
        const next = await Promise.race([stream.next(), watched.expired]);
        if (next.done) break;
        const message = next.value;
        yield* pending.splice(0);
        messages.push(message);
        if (message.type === "system" && message.subtype === "init") {
          assertInit(message, allowedInit);
        } else if (message.type === "assistant") {
          const agent = agentOf(message);
          for (const block of message.message.content) {
            if (block.type === "text") {
              yield { type: "text", agent, text: block.text };
            } else if (block.type === "tool_use") {
              const name = block.name.replace(PREFIX, "");
              toolOf.set(block.id, name);
              if (SUBAGENT_TOOLS.includes(name)) {
                const type = (block.input as { subagent_type?: string }).subagent_type;
                if (type) subagentOf.set(block.id, type);
              }
              yield { type: "tool_call", agent, tool: name, input: block.input };
            }
          }
        } else if (message.type === "user" && Array.isArray(message.message.content)) {
          for (const block of message.message.content) {
            if (block.type !== "tool_result" || denied.has(block.tool_use_id)) continue;
            yield {
              type: "tool_result",
              agent: agentOf(message),
              tool: toolOf.get(block.tool_use_id) ?? "unknown",
              output: block.content,
            };
          }
        } else if (message.type === "result") {
          // total_cost_usd is a running total, so only the change goes to Budget.
          const delta = message.total_cost_usd - costUsd;
          costUsd = message.total_cost_usd;
          if (delta > 0 && (await budget.add(spec.runId, delta)).over) over = true;
          if (message.subtype === "error_max_budget_usd") over = true;
          if (over) break;
        }
      }
    }
  } catch (error) {
    thrown.push(error);
  } finally {
    watch?.stop();
    abortController.abort();
  }

  // The abort does not reach a handler in this process, so its rows are still coming. The caller may exit once it sees the result.
  // No limit of its own: portal steps, Stripe, model turns and live calls each have one.
  await Promise.all(inFlight);
  yield* pending.splice(0);
  const { finished, reason } = runOutcome(messages, allowedInit, thrown);
  if (over) yield { type: "text", agent: main, text: "Stopped: estimated cost reached RUN_BUDGET_USD." };
  else if (!finished) yield { type: "text", agent: main, text: `Run failed: ${reason}` };
  yield { type: "text", agent: main, text: `Estimated cost: $${costUsd.toFixed(4)} (an SDK estimate, not a bill).` };
  yield { type: "result", status: over ? "over_budget" : finished ? "success" : "error", costUsd, ...(finished ? {} : { reason }) };
}

export default createAgentRuntime(async () => {
  const platform = getPlatform();
  return { gate: await platform.approvalGate(), budget: await platform.budget() };
});
