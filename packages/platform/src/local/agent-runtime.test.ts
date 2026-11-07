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
    status: async () => {
      const total = totalUsd + added.reduce((sum, cost) => sum + cost, 0);
      return { totalUsd: total, capUsd, over: total >= capUsd };
    },
    add: async (runId, costUsd) => {
      added.push(costUsd);
      return budget.status(runId);
    },
  };
  const query: Query = async function* ({ options }) {
    captured.options = options;
    await during?.(options);
    yield* messages as SDKMessage[];
    if (thenThrow !== undefined) throw new Error(thenThrow);
  };
  const runtime = createAgentRuntime(async () => ({ gate: gate as ApprovalGate, budget, query, login }));
  return { added, budget, captured, runtime };
}

async function collect(events: AsyncIterable<RunEvent>) {
  const all: RunEvent[] = [];
  for await (const event of events) all.push(event);
  return { all, last: all.at(-1) as Extract<RunEvent, { type: "result" }>, text: JSON.stringify(all) };
}

afterEach(() => vi.restoreAllMocks());

// Calls the run's real handler, the way the CLI does once canUseTool has allowed it.
const callHandler = async (options: Options, name: string, args: Record<string, unknown> = {}) => {
  const { instance } = options.mcpServers!.platform as McpSdkServerConfigWithInstance;
  const [clientSide, serverSide] = InMemoryTransport.createLinkedPair();
  await instance.connect(serverSide);
  const client = new Client({ name: "t", version: "1" });
  await client.connect(clientSide);
  return client.callTool({ name, arguments: args });
};
const EMAIL_INIT = { ...INIT, tools: ["mcp__platform__send_email"] };
const specWith = (tool: ToolDef): RunSpec => ({ ...SPEC, main: { ...SPEC.main, tools: [tool.name] }, tools: [tool] });

describe("a model that goes quiet", () => {
  const IDLE_MS = 30;
  const budget: Budget = { status: async () => ({ totalUsd: 0, capUsd: 5, over: false }), add: async () => ({ totalUsd: 0, capUsd: 5, over: false }) };
  const runtimeWith = (query: Query, gate: Partial<ApprovalGate> = {}, login = async () => {}) => createAgentRuntime(async () => ({ gate: gate as ApprovalGate, budget, query, login, idleMs: IDLE_MS }));
  const sleep = (ms: number) => new Promise((resolve) => setTimeout(resolve, ms));
  const TIMED_OUT = { status: "error", reason: expect.stringContaining("did not answer") };

  it("ends the run as an error with a timeout reason, even if the stream ignores the abort", async () => {
    const hung: Query = async function* () {
      yield INIT as unknown as SDKMessage;
      await new Promise(() => {});
    };
    expect((await collect(runtimeWith(hung).run(SPEC))).last).toMatchObject(TIMED_OUT);
  });

  it("also covers a login check that hangs", async () => {
    const query: Query = async function* () {
      yield INIT as unknown as SDKMessage;
    };
    expect((await collect(runtimeWith(query, {}, () => new Promise(() => {})).run(SPEC))).last).toMatchObject(TIMED_OUT);
  });

  it("does not count the approval wait, however long it takes", async () => {
    const waitForRelease = vi.fn(async () => {
      await sleep(IDLE_MS * 4);
      return true;
    });
    const parked: Query = async function* ({ options }) {
      yield INIT as unknown as SDKMessage;
      const context = { signal: new AbortController().signal, toolUseID: "t1", mcpServer: { name: "platform", source: "sdk" } };
      await options.canUseTool!("mcp__platform__call_provider", { actionId: "a1" }, context as never);
      yield result(0) as unknown as SDKMessage;
    };
    expect((await collect(runtimeWith(parked, { waitForRelease }).run(SPEC))).last.status).toBe("success");
    expect(waitForRelease).toHaveBeenCalledOnce();
  });

  it("does not count a slow tool, such as a live call", async () => {
    const query: Query = async function* ({ options }) {
      yield EMAIL_INIT as unknown as SDKMessage;
      await callHandler(options, "send_email");
      yield result(0) as unknown as SDKMessage;
    };
    expect((await collect(runtimeWith(query).run(specWith({ ...def("send_email"), handler: () => sleep(IDLE_MS * 4) })))).last.status).toBe("success");
  });

  it("starts counting again once the slow tool has finished", async () => {
    const query: Query = async function* ({ options }) {
      yield EMAIL_INIT as unknown as SDKMessage;
      await callHandler(options, "send_email");
      await new Promise(() => {});
    };
    expect((await collect(runtimeWith(query).run(specWith(def("send_email"))))).last).toMatchObject(TIMED_OUT);
  });
});

describe("a tool still running when the run ends", () => {
  it("finishes before the result, so a caller that exits on the result cannot lose its rows", async () => {
    const order: string[] = [];
    let started: () => void = () => {};
    const inTool = new Promise<void>((resolve) => (started = resolve));
    const tool: ToolDef = {
      ...def("send_email"),
      handler: async () => {
        started();
        await new Promise((resolve) => setTimeout(resolve, 30));
        order.push("row written");
        return "ok";
      },
    };
    const { runtime } = setup([EMAIL_INIT, result(5.5, { subtype: "error_max_budget_usd", errors: [] })], {
      during: async (options) => {
        void callHandler(options, "send_email");
        await inTool;
      },
    });
    for await (const event of runtime.run(specWith(tool))) {
      if (event.type === "result") order.push(`result ${event.status}`);
    }
    expect(order).toEqual(["row written", "result over_budget"]);
  });

  it("still finishes when the caller fails on an event, so the caller cannot exit ahead of its rows", async () => {
    const order: string[] = [];
    let started: () => void = () => {};
    const inTool = new Promise<void>((resolve) => (started = resolve));
    const tool: ToolDef = {
      ...def("send_email"),
      handler: async () => {
        started();
        await new Promise((resolve) => setTimeout(resolve, 30));
        order.push("row written");
        return "ok";
      },
    };
    const said = { type: "assistant", parent_tool_use_id: null, message: { content: [{ type: "text", text: "hi" }] } };
    const { runtime } = setup([EMAIL_INIT, said, result(0)], {
      during: async (options) => {
        void callHandler(options, "send_email");
        await inTool;
      },
    });
    await expect(
      (async () => {
        for await (const event of runtime.run(specWith(tool))) {
          if (event.type === "text") throw new Error("the audit write failed");
        }
      })(),
    ).rejects.toThrow("the audit write failed");
    order.push("caller failed");
    expect(order).toEqual(["row written", "caller failed"]);
  });

  it("counts a cost the tool adds after the last result, and reports over_budget", async () => {
    let started: () => void = () => {};
    const inTool = new Promise<void>((resolve) => (started = resolve));
    const tool: ToolDef = {
      ...def("send_email"),
      handler: async () => {
        started();
        await new Promise((resolve) => setTimeout(resolve, 30));
        await budget.add(SPEC.runId, 5.6);
        return "ok";
      },
    };
    const { budget, runtime } = setup([EMAIL_INIT, result(0)], {
      during: async (options) => {
        void callHandler(options, "send_email");
        await inTool;
      },
    });
    expect((await collect(runtime.run(specWith(tool)))).last.status).toBe("over_budget");
  });

  it("is an error, not a success, when the final budget check fails", async () => {
    const { budget, runtime } = setup([EMAIL_INIT, result(0)]);
    vi.spyOn(budget, "status").mockResolvedValueOnce({ totalUsd: 0, capUsd: 5, over: false }).mockRejectedValueOnce(new Error("the database is gone"));
    expect((await collect(runtime.run(specWith(def("send_email"))))).last).toMatchObject({ status: "error", reason: "the database is gone" });
  });

  it("never starts a gated tool whose approval check was still going when the run ended", async () => {
    const order: string[] = [];
    let asked: () => void = () => {};
    const asking = new Promise<void>((resolve) => (asked = resolve));
    let call: ReturnType<typeof callHandler> | undefined;
    const isReleased = async () => {
      asked();
      await new Promise((resolve) => setTimeout(resolve, 30));
      order.push("released");
      return true;
    };
    const gated: ToolDef = {
      ...def("call_provider"),
      handler: async () => {
        order.push("side effect");
        return "ok";
      },
    };
    const { runtime } = setup([{ ...INIT, tools: ["mcp__platform__call_provider"] }, result(5.5, { subtype: "error_max_budget_usd", errors: [] })], {
      gate: { isReleased },
      during: async (options) => {
        call = callHandler(options, "call_provider", { actionId: "a1" });
        await asking;
      },
    });
    for await (const event of runtime.run(specWith(gated))) {
      if (event.type === "result") order.push(`result ${event.status}`);
    }
    expect(order).toEqual(["released", "result over_budget"]);
    expect(await call).toMatchObject({ isError: true, content: [{ text: expect.stringContaining("this run has ended") }] });
  });

  it("refuses a tool call that arrives after the result", async () => {
    const handler = vi.fn(async () => "ok");
    const { runtime, captured } = setup([EMAIL_INIT, result(1)]);
    await collect(runtime.run(specWith({ ...def("send_email"), handler })));
    expect(await callHandler(captured.options!, "send_email")).toMatchObject({ isError: true });
    expect(handler).not.toHaveBeenCalled();
  });
});

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
  const auth = (error?: string) => ({ type: "auth_status", isAuthenticating: false, output: [], error });

  // Which streams count as finished is tested once, on runOutcome. These only prove the run asks it.
  it("is success when runOutcome says the run finished", async () => {
    expect(await status([INIT, auth(), result(0)])).toBe("success");
  });

  it("is error when runOutcome says the run did not finish, and says why", async () => {
    const { last, text } = await collect(setup([INIT, result(0), auth("")]).runtime.run(SPEC));
    expect(last.status).toBe("error");
    expect(text).toContain("Run failed: the run reported an error with no message");
  });

  it("stops reading the stream at a refused init", async () => {
    const { added, runtime } = setup([{ ...INIT, apiKeySource: "ANTHROPIC_API_KEY" }, result(1)]);
    expect((await collect(runtime.run(SPEC))).last.status).toBe("error");
    expect(added).toEqual([]);
  });

  it("is error when an exception with an empty message follows a success, and still says so", async () => {
    const { last, text } = await collect(setup([INIT, result(0)], { thenThrow: "" }).runtime.run(SPEC));
    expect(last.status).toBe("error");
    expect(text).toContain("Run failed: the run reported an error with no message");
  });

  it("stays over_budget when a failure also happened", async () => {
    expect(await status([INIT, auth("token expired"), result(6)])).toBe("over_budget");
  });
});
