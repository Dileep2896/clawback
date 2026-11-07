import type { HookCallback, McpSdkServerConfigWithInstance, Options, SDKMessage } from "@anthropic-ai/claude-agent-sdk";
import { GATED_TOOLS } from "@bill-fighter/shared/gated-tools";
import { Client } from "@modelcontextprotocol/sdk/client/index.js";
import { InMemoryTransport } from "@modelcontextprotocol/sdk/inMemory.js";
import { afterEach, describe, expect, it, vi } from "vitest";
import { z } from "zod";
import type { ApprovalGate, Budget, RunEvent, RunSpec, ToolDef } from "../types.ts";
import { allowedToolNames, createAgentRuntime, createCanUseTool, type Query } from "./agent-runtime.ts";

const def = (name: string): ToolDef => ({
  name,
  description: name,
  inputSchema: z.object({ actionId: z.string().optional() }) as unknown as ToolDef["inputSchema"],
  handler: async () => "ok",
});

const SPEC: RunSpec = {
  runId: "run-1",
  prompt: "go",
  main: { name: "ceo", description: "", prompt: "", tools: ["call_provider"], maxTurns: 1 },
  members: [],
  tools: [def("call_provider")],
};

const INIT = {
  type: "system",
  subtype: "init",
  apiKeySource: "none",
  tools: ["mcp__platform__call_provider"],
  agents: [],
  mcp_servers: [{ name: "platform", status: "connected" }],
};
const result = (cost: number, extra: object = {}) => ({
  type: "result",
  subtype: "success",
  is_error: false,
  result: "done",
  total_cost_usd: cost,
  ...extra,
});

type SetupOptions = {
  capUsd?: number;
  totalUsd?: number;
  thenThrow?: string;
  gate?: Partial<ApprovalGate>;
  during?: (options: Options) => Promise<void>;
  login?: () => Promise<void>;
};

function setup(messages: unknown[], { capUsd = 5, totalUsd = 0, thenThrow, gate = {}, during, login = async () => {} }: SetupOptions = {}) {
  const added: number[] = [];
  const captured: { options?: Options } = {};
  const budget: Budget = {
    status: async () => ({ totalUsd, capUsd, over: totalUsd >= capUsd }),
    add: async (_runId, costUsd) => {
      added.push(costUsd);
      const total = totalUsd + added.reduce((sum, cost) => sum + cost, 0);
      return { totalUsd: total, capUsd, over: total >= capUsd };
    },
  };
  const query: Query = async function* ({ options }) {
    captured.options = options;
    await during?.(options);
    yield* messages as SDKMessage[];
    if (thenThrow !== undefined) throw new Error(thenThrow);
  };
  const runtime = createAgentRuntime(async () => ({ gate: gate as ApprovalGate, budget, query, login }));
  return { added, captured, runtime };
}

async function collect(events: AsyncIterable<RunEvent>) {
  const all: RunEvent[] = [];
  for await (const event of events) all.push(event);
  return { all, last: all.at(-1) as Extract<RunEvent, { type: "result" }>, text: JSON.stringify(all) };
}

afterEach(() => vi.restoreAllMocks());

describe("allowedToolNames", () => {
  it("never lists a gated tool", () => {
    const names = allowedToolNames([...GATED_TOOLS.map(def), def("send_email")]);
    expect(names).toEqual(["mcp__platform__send_email"]);
  });

  it("is what the run passes to the SDK, along with no bypass mode", async () => {
    const { captured, runtime } = setup([INIT, result(0)]);
    await collect(runtime.run({ ...SPEC, tools: [...GATED_TOOLS.map(def), def("send_email")] }));
    expect(captured.options?.allowedTools).toEqual(["mcp__platform__send_email"]);
    expect(captured.options?.permissionMode).toBeUndefined();
    expect(captured.options?.settingSources).toEqual([]);
    expect(captured.options?.tools).toEqual([]);
  });
});

describe("createCanUseTool", () => {
  const sdk = { name: "platform", source: "sdk" };
  const call = (
    tool: string,
    input: Record<string, unknown>,
    waitForRelease: ApprovalGate["waitForRelease"] = async () => true,
    // null means no provenance: undefined would pick up this default.
    mcpServer: { name: string; source: string } | null = sdk,
  ) => {
    const onDenied = vi.fn();
    const canUseTool = createCanUseTool([def("call_provider"), def("send_email")], { waitForRelease }, onDenied);
    const options = { signal: new AbortController().signal, toolUseID: "t1", requestId: "r1", mcpServer: mcpServer ?? undefined };
    return { decision: canUseTool(tool, input, options as never), onDenied };
  };
  const CALL = "mcp__platform__call_provider";

  it("allows a gated call only after the gate releases it", async () => {
    let release: (released: boolean) => void = () => {};
    const { decision } = call(CALL, { actionId: "a1" }, () => new Promise((resolve) => (release = resolve)));
    const settled = vi.fn();
    void decision.then(settled);
    await new Promise((resolve) => setTimeout(resolve, 10));
    expect(settled).not.toHaveBeenCalled();
    release(true);
    expect(await decision).toMatchObject({ behavior: "allow", updatedInput: { actionId: "a1" } });
  });

  it("denies when the gate does not release, without interrupting", async () => {
    const { decision, onDenied } = call(CALL, { actionId: "a1" }, async () => false);
    const outcome = await decision;
    expect(outcome?.behavior).toBe("deny");
    expect(outcome).not.toHaveProperty("interrupt");
    expect(onDenied).toHaveBeenCalledOnce();
  });

  it("denies a gated call with no actionId and never asks the gate", async () => {
    const wait = vi.fn(async () => true);
    expect((await call(CALL, {}, wait).decision)?.behavior).toBe("deny");
    expect(wait).not.toHaveBeenCalled();
  });

  it("denies when the gate throws, rather than crashing or allowing", async () => {
    const down = async () => {
      throw new Error("database down");
    };
    expect((await call(CALL, { actionId: "a1" }, down).decision)?.behavior).toBe("deny");
  });

  it.each([
    ["an unknown tool of ours", "mcp__platform__other", sdk],
    ["a built-in tool", "Bash", null],
    ["an account connector", "mcp__claude_ai_Gmail__send_message", { name: "claude_ai_Gmail", source: "claudeai" }],
    ["a configured server imitating ours", CALL, { name: "platform", source: "user" }],
    ["a call with no provenance", CALL, null],
  ])("denies %s", async (_name, tool, mcpServer) => {
    expect((await call(tool, { actionId: "a1" }, async () => true, mcpServer).decision)?.behavior).toBe("deny");
  });

  it("allows an ungated tool of this run", async () => {
    expect((await call("mcp__platform__send_email", {}).decision)?.behavior).toBe("allow");
  });
});

describe("the main agent's tool list", () => {
  it("is enforced for MCP tools, which tools: [\"Agent\"] does not limit", async () => {
    const { captured, runtime } = setup([INIT, result(0)]);
    await collect(runtime.run({ ...SPEC, main: { ...SPEC.main, tools: [] } }));
    const hook = captured.options?.hooks?.PreToolUse?.[0]?.hooks[0] as HookCallback;
    const input = { hook_event_name: "PreToolUse", tool_name: "mcp__platform__call_provider", tool_use_id: "t1" };
    const output = await hook(input as never, "t1", { signal: new AbortController().signal });
    expect(output).toMatchObject({ hookSpecificOutput: { permissionDecision: "deny" } });
  });
});

// Calls the real registered MCP server directly, which is what a managed allow rule amounts to: no canUseTool, no hook.
async function clientOf(options: Options) {
  const server = options.mcpServers?.platform as McpSdkServerConfigWithInstance;
  const [serverSide, clientSide] = InMemoryTransport.createLinkedPair();
  await server.instance.connect(serverSide);
  const client = new Client({ name: "test", version: "1.0.0" });
  await client.connect(clientSide);
  return client;
}

describe("the tool execution boundary", () => {
  function gated(isReleased: ApprovalGate["isReleased"]) {
    const handler = vi.fn(async () => "ran");
    const tool: ToolDef = { ...def("call_provider"), handler };
    const calls: Awaited<ReturnType<Client["callTool"]>>[] = [];
    const run = (args: Record<string, unknown>) =>
      collect(
        setup([INIT, result(0)], {
          gate: { isReleased },
          during: async (options) => {
            calls.push(await (await clientOf(options)).callTool({ name: "call_provider", arguments: args }));
          },
        }).runtime.run({ ...SPEC, tools: [tool] }),
      );
    return { handler, calls, run };
  }

  it("runs a gated handler once its action is released, and checks the id it receives", async () => {
    const isReleased = vi.fn(async () => true);
    const { handler, calls, run } = gated(isReleased);
    await run({ actionId: "a1" });
    expect(isReleased).toHaveBeenCalledWith("a1");
    expect(handler).toHaveBeenCalledOnce();
    expect(calls[0]?.isError).toBeFalsy();
  });

  it("refuses a gated call that skipped canUseTool, and reports the denial", async () => {
    const { handler, calls, run } = gated(async () => false);
    const { all } = await run({ actionId: "a1" });
    expect(handler).not.toHaveBeenCalled();
    expect(calls[0]?.isError).toBe(true);
    expect(all).toContainEqual(expect.objectContaining({ type: "denied", agent: "ceo", tool: "call_provider" }));
  });

  it("refuses a gated call with no actionId and never asks the gate", async () => {
    const isReleased = vi.fn(async () => true);
    const { handler, calls, run } = gated(isReleased);
    await run({});
    expect(isReleased).not.toHaveBeenCalled();
    expect(handler).not.toHaveBeenCalled();
    expect(calls[0]?.isError).toBe(true);
  });

  it("does not run the handler when the gate throws", async () => {
    const { handler, calls, run } = gated(async () => {
      throw new Error("database down");
    });
    await run({ actionId: "a1" });
    expect(handler).not.toHaveBeenCalled();
    expect(calls[0]?.isError).toBe(true);
  });

  it("does not ask the gate for an ungated tool", async () => {
    const isReleased = vi.fn(async () => false);
    const handler = vi.fn(async () => "ran");
    const run = setup([INIT, result(0)], {
      gate: { isReleased },
      during: async (options) => {
        await (await clientOf(options)).callTool({ name: "send_email", arguments: {} });
      },
    });
    await collect(run.runtime.run({ ...SPEC, tools: [{ ...def("send_email"), handler }] }));
    expect(handler).toHaveBeenCalledOnce();
    expect(isReleased).not.toHaveBeenCalled();
  });
});

describe("tool input validation", () => {
  async function callWith(inputSchema: z.ZodType, args: Record<string, unknown>) {
    const handler = vi.fn(async (input: unknown) => input);
    const tool = { ...def("lookup"), inputSchema, handler } as ToolDef;
    let outcome: Awaited<ReturnType<Client["callTool"]>> | undefined;
    let listed: unknown;
    const { runtime } = setup([INIT, result(0)], {
      during: async (options) => {
        const client = await clientOf(options);
        listed = (await client.listTools()).tools[0]?.inputSchema;
        outcome = await client.callTool({ name: "lookup", arguments: args });
      },
    });
    await collect(runtime.run({ ...SPEC, tools: [tool] }));
    return { handler, outcome, listed };
  }
  const positive = z.object({ value: z.number() }).refine((input) => input.value >= 0, "must not be negative");

  it("applies an object-level refinement before the handler", async () => {
    const { handler, outcome } = await callWith(positive, { value: -1 });
    expect(handler).not.toHaveBeenCalled();
    expect(outcome?.isError).toBe(true);
  });

  it("applies a strict object before the handler", async () => {
    const { handler, outcome } = await callWith(z.strictObject({ value: z.number() }), { value: 1, extra: true });
    expect(handler).not.toHaveBeenCalled();
    expect(outcome?.isError).toBe(true);
  });

  it("rejects a wrong field type before the handler", async () => {
    const { handler, outcome } = await callWith(positive, { value: "one" });
    expect(handler).not.toHaveBeenCalled();
    expect(outcome?.isError).toBe(true);
  });

  it("gives the handler the parsed input, parsed once, and still advertises the fields to the model", async () => {
    const schema = z.object({ value: z.string().transform(Number), unit: z.string().default("kWh") });
    const { handler, outcome, listed } = await callWith(schema, { value: "7" });
    expect(outcome?.isError).toBeFalsy();
    expect(handler.mock.calls[0]?.[0]).toEqual({ value: 7, unit: "kWh" });
    expect(listed).toMatchObject({ type: "object", properties: { value: { type: "string" } } });
  });
});

describe("run", () => {
  it("does not stop at the first result, and gives Budget the change in the running total", async () => {
    const { added, runtime } = setup([INIT, result(0.25), INIT, result(0.75)]);
    const { last } = await collect(runtime.run(SPEC));
    expect(added).toEqual([0.25, 0.5]);
    expect(last).toEqual({ type: "result", status: "success", costUsd: 0.75 });
  });

  it("labels the cost as an estimate", async () => {
    const { runtime } = setup([INIT, result(0.25)]);
    expect((await collect(runtime.run(SPEC))).text).toContain("an SDK estimate, not a bill");
  });

  it("treats is_error on a success subtype as a failure, which is how a bad key arrives", async () => {
    const { runtime } = setup([INIT, result(0, { is_error: true, result: "Invalid API key" })], {
      thenThrow: "Claude Code process exited with code 1",
    });
    const { last, text } = await collect(runtime.run(SPEC));
    expect(last.status).toBe("error");
    expect(text).toContain("Invalid API key");
  });

  it("refuses a run that reports a key instead of the login", async () => {
    const { runtime } = setup([{ ...INIT, apiKeySource: "ANTHROPIC_API_KEY" }, result(0)]);
    const { last, text } = await collect(runtime.run(SPEC));
    expect(last.status).toBe("error");
    expect(text).toContain("Refusing to run");
  });

  it("refuses before calling the model when the login check fails", async () => {
    const { captured, runtime } = setup([INIT, result(0)], {
      login: async () => {
        throw new Error("Refusing to run: not the login");
      },
    });
    const { last, text } = await collect(runtime.run(SPEC));
    expect(last.status).toBe("error");
    expect(text).toContain("Refusing to run");
    expect(captured.options).toBeUndefined();
  });

  it("refuses when a connector shows up in a later init", async () => {
    const leak = { ...INIT, tools: ["mcp__claude_ai_Gmail__send_message"] };
    const { runtime } = setup([INIT, result(0.1), leak, result(0.2)]);
    const { last, text } = await collect(runtime.run(SPEC));
    expect(last.status).toBe("error");
    expect(text).toContain("mcp__claude_ai_Gmail__send_message");
  });

  it("surfaces a plan rate limit as status error", async () => {
    const limit = { type: "rate_limit_event", rate_limit_info: { status: "rejected", resetsAt: 1_800_000_000 } };
    const { runtime } = setup([INIT, limit, result(0.1)]);
    const { last, text } = await collect(runtime.run(SPEC));
    expect(last.status).toBe("error");
    expect(text).toContain("rate limit");
  });

  it("ignores a rate limit warning that still allows the run", async () => {
    const warning = { type: "rate_limit_event", rate_limit_info: { status: "allowed_warning" } };
    const { runtime } = setup([INIT, warning, result(0.1)]);
    expect((await collect(runtime.run(SPEC))).last.status).toBe("success");
  });

  it("reports over_budget when the SDK stops at the cap", async () => {
    const stopped = result(5, { subtype: "error_max_budget_usd", is_error: true, errors: [] });
    const { runtime } = setup([INIT, stopped]);
    const { last, text } = await collect(runtime.run(SPEC));
    expect(last.status).toBe("over_budget");
    expect(text).toMatch(/estimated cost/i);
  });

  it("reports over_budget when Budget says the estimate passed the cap", async () => {
    const { runtime } = setup([INIT, result(6)]);
    expect((await collect(runtime.run(SPEC))).last.status).toBe("over_budget");
  });

  it("does not start when the budget is already spent, and passes on what remains", async () => {
    const spent = setup([INIT, result(1)], { totalUsd: 5 });
    const { last } = await collect(spent.runtime.run(SPEC));
    expect(last.status).toBe("over_budget");
    expect(spent.captured.options).toBeUndefined();

    const partial = setup([INIT, result(1)], { totalUsd: 2 });
    await collect(partial.runtime.run(SPEC));
    expect(partial.captured.options?.maxBudgetUsd).toBe(3);
  });

  it("ends in status error, not a crash, when the SDK throws or there is no result", async () => {
    const thrown = setup([INIT], { thenThrow: "boom" });
    expect((await collect(thrown.runtime.run(SPEC))).last.status).toBe("error");
    expect((await collect(setup([INIT]).runtime.run(SPEC))).last.status).toBe("error");
  });
});

describe("the final status", () => {
  const status = async (messages: unknown[], options?: SetupOptions) =>
    (await collect(setup(messages, options).runtime.run(SPEC))).last.status;
  const assistant = (error?: string) => ({ type: "assistant", parent_tool_use_id: null, error, message: { content: [] } });
  const auth = (error?: string) => ({ type: "auth_status", isAuthenticating: false, output: [], error });
  const task = (taskStatus: string) => ({ type: "system", subtype: "task_notification", status: taskStatus, summary: "" });

  it("is success for a validated init followed by a clean result", async () => {
    expect(await status([INIT, assistant(), auth(), task("completed"), result(0)])).toBe("success");
  });

  it("is error when an exception with an empty message follows a success, and still says so", async () => {
    const { last, text } = await collect(setup([INIT, result(0)], { thenThrow: "" }).runtime.run(SPEC));
    expect(last.status).toBe("error");
    expect(text).toContain("Run failed: the run reported an error with no message");
  });

  it("is error when no init was seen, so the login and isolation checks never ran", async () => {
    const { last, text } = await collect(setup([result(0)]).runtime.run(SPEC));
    expect(last.status).toBe("error");
    expect(text).toContain("no init");
  });

  it("does not count an init that failed its checks, whatever follows", async () => {
    expect(await status([{ ...INIT, apiKeySource: "apiKeyHelper" }, INIT, result(0)])).toBe("error");
  });

  it.each(["authentication_failed", "billing_error", "account_on_hold", "server_error", "unknown", ""])(
    "is error for an assistant error %j, before or after the result",
    async (error) => {
      expect(await status([INIT, assistant(error), result(0)])).toBe("error");
      expect(await status([INIT, result(0), assistant(error), result(0)])).toBe("error");
    },
  );

  it.each(["token expired", ""])("is error for an auth_status error %j, before or after the result", async (error) => {
    expect(await status([INIT, auth(error), result(0)])).toBe("error");
    expect(await status([INIT, result(0), auth(error)])).toBe("error");
  });

  it("keeps an earlier failure when a later result succeeds", async () => {
    expect(await status([INIT, result(0, { is_error: true, result: "" }), result(0)])).toBe("error");
    expect(await status([INIT, result(0, { subtype: "error_during_execution", errors: [] }), result(0)])).toBe("error");
  });

  it("is error when a turn starts after a success and never finishes", async () => {
    expect(await status([INIT, result(0), INIT])).toBe("error");
    expect(await status([INIT, result(0), assistant()])).toBe("error");
  });

  it.each(["failed", "stopped"])("is error when a subagent task ends %s and the main agent still succeeds", async (taskStatus) => {
    expect(await status([INIT, task(taskStatus), result(0)])).toBe("error");
  });

  it("is error when the model refuses with no fallback, and not when it retries on one", async () => {
    const refusal = { type: "system", subtype: "model_refusal_no_fallback", content: "" };
    expect(await status([INIT, refusal, result(0)])).toBe("error");
    expect(await status([INIT, { type: "system", subtype: "model_refusal_fallback" }, result(0)])).toBe("success");
  });

  it("is error when a success result says the turn stopped early", async () => {
    expect(await status([INIT, result(0, { terminal_reason: "aborted_tools" })])).toBe("error");
    expect(await status([INIT, result(0, { terminal_reason: "completed" })])).toBe("success");
  });

  it("is error when the run's own tool server failed to connect", async () => {
    expect(await status([{ ...INIT, mcp_servers: [{ name: "platform", status: "failed" }] }, result(0)])).toBe("error");
  });

  it("stays over_budget when a failure also happened", async () => {
    expect(await status([INIT, auth("token expired"), result(6)])).toBe("over_budget");
  });
});
