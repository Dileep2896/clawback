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
import { assertIsolated, assertLogin, checkLogin, loginOptions } from "./claude-login.ts";

const SERVER = "platform";
const PREFIX = `mcp__${SERVER}__`;
// The model calls "Agent", while the init message lists the same tool as "Task".
const SUBAGENT_TOOLS = ["Agent", "Task"];

export type Query = (params: { prompt: string; options: Options }) => AsyncIterable<SDKMessage>;
export type Deps = { gate: ApprovalGate; budget: Budget; query?: Query; login?: () => Promise<void> };

const errorText = (error: unknown) => (error instanceof Error ? error.message : String(error));

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
      return deny(`Action ${actionId} is not in an approved bundle`);
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
      const output = await def.handler(input, { runId, agent });
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
  let sawSuccess = false;
  let failure: string | undefined;

  try {
    const { gate, budget, query = sdkQuery as Query, login = checkLogin } = await deps();
    const start = await budget.status(spec.runId);
    const remainingUsd = start.capUsd - start.totalUsd;
    if (remainingUsd <= 0) {
      over = true;
    } else {
      await login();
      const ownTools = spec.tools.map((def) => PREFIX + def.name);
      const hasMembers = spec.members.length > 0;
      const allowedInit = {
        tools: [...ownTools, ...(hasMembers ? SUBAGENT_TOOLS : [])],
        agents: spec.members.map((def) => def.name),
      };
      const canUseTool = createCanUseTool(spec.tools, gate, (name, reason, toolUseId) =>
        onDenied(callers.get(toolUseId) ?? main, name, reason, toolUseId),
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
            tools: spec.tools.map((def) => mcpTool(def, spec.runId, gate, (id) => callers.get(id) ?? main, onDenied)),
          }),
        },
      };

      for await (const message of query({ prompt: spec.prompt, options })) {
        yield* pending.splice(0);
        if (message.type === "system" && message.subtype === "init") {
          // Checked on every init: the connectors first appeared in a later one.
          assertLogin(message);
          assertIsolated(message, allowedInit);
        } else if (message.type === "rate_limit_event" && message.rate_limit_info.status === "rejected") {
          const { resetsAt } = message.rate_limit_info;
          failure = `Claude plan rate limit reached${resetsAt ? `, resets ${new Date(resetsAt * 1000).toISOString()}` : ""}`;
        } else if (message.type === "assistant") {
          if (message.error === "rate_limit") failure ??= "Claude plan rate limit reached";
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
          // total_cost_usd is a running total, so only the change goes to Budget. A failed auth arrives as
          // subtype "success" with is_error set, so subtype alone would read as success.
          const delta = message.total_cost_usd - costUsd;
          costUsd = message.total_cost_usd;
          if (delta > 0 && (await budget.add(spec.runId, delta)).over) over = true;
          if (message.subtype === "error_max_budget_usd") over = true;
          else if (message.is_error || message.subtype !== "success") {
            const detail = message.subtype === "success" ? message.result : message.errors.join("; ");
            failure ??= detail || message.subtype;
          } else sawSuccess = true;
          if (over) break;
        }
      }
    }
  } catch (error) {
    failure ??= errorText(error);
  } finally {
    abortController.abort();
  }

  yield* pending.splice(0);
  if (!over && !failure && !sawSuccess) failure = "The run ended with no result";
  if (over) yield { type: "text", agent: main, text: "Stopped: estimated cost reached RUN_BUDGET_USD." };
  else if (failure) yield { type: "text", agent: main, text: `Run failed: ${failure}` };
  yield { type: "text", agent: main, text: `Estimated cost: $${costUsd.toFixed(4)} (an SDK estimate, not a bill).` };
  yield { type: "result", status: over ? "over_budget" : failure ? "error" : "success", costUsd };
}

export default createAgentRuntime(async () => {
  const platform = getPlatform();
  return { gate: await platform.approvalGate(), budget: await platform.budget() };
});
