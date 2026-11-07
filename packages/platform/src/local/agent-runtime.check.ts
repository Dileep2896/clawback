import assert from "node:assert/strict";
import { setTimeout as sleep } from "node:timers/promises";
import type { SDKUserMessage } from "@anthropic-ai/claude-agent-sdk";
import type { Db } from "@bill-fighter/db/client";
import { actions } from "@bill-fighter/db/schema";
import { seedRun, withTestDb } from "@bill-fighter/db/test-db";
import { z } from "zod";
import type { ApprovalGate, Budget, RunEvent, RunSpec, ToolDef } from "../types.ts";
import adapter, { createAgentRuntime, type Query } from "./agent-runtime.ts";
import { createApprovalGate } from "./approval-gate.ts";
import { createBudget } from "./budget.ts";
import { loginOptions } from "./claude-login.ts";
import { withFakeCredentials } from "./fake-credentials.ts";

const FAKE_KEY = "sk-ant-api03-not-a-real-key";

/** Real runs on the Claude Code login, with the real gate and budget on a test database of their own. */
export default async function check() {
  assert.equal(typeof adapter.run, "function");
  await withFakeCredentials(async () => {
    await withTestDb("check_agent_runtime", gatedSubagentRun);
    await failsClosedWhenAKeyGetsThrough();
    await noAccountConnectorConnects();
  });
}

// The init message cannot prove this: with connectors on it lists 0 tools, then Gmail and Drive connect a few seconds later.
async function noAccountConnectorConnects() {
  const { query: realQuery } = await import("@anthropic-ai/claude-agent-sdk");
  let finish = () => {};
  const open = new Promise<void>((resolve) => (finish = resolve));
  async function* input(): AsyncGenerator<SDKUserMessage> {
    yield { type: "user", session_id: "", parent_tool_use_id: null, message: { role: "user", content: "Reply ok." } };
    await open;
  }
  const session = realQuery({ prompt: input(), options: { ...loginOptions(), tools: [], maxTurns: 1 } });
  try {
    for await (const message of session) {
      if (message.type !== "result") continue;
      await sleep(10_000);
      assert.deepEqual((await session.mcpServerStatus()).map((server) => server.name), []);
      return;
    }
    assert.fail("no result message");
  } finally {
    finish();
    session.close();
  }
}

function spec(tools: ToolDef[]): RunSpec {
  return {
    runId: "check-agent-runtime",
    prompt:
      "Use the Agent tool to launch the caller subagent. Tell it to call call_provider with actionId a1, then with actionId a2. Then report what happened in one sentence.",
    main: {
      name: "ceo",
      description: "Runs the job",
      prompt: "You delegate work to subagents with the Agent tool and do nothing else.",
      tools: [],
      maxTurns: 6,
    },
    members: [
      {
        name: "caller",
        description: "Calls the provider",
        prompt: "Do exactly what you are told, one call at a time. If a call is denied, say so and carry on.",
        tools: ["call_provider"],
        maxTurns: 5,
      },
    ],
    tools,
  };
}

async function gatedSubagentRun(db: Db) {
  const handled: { actionId: string; agent: string; at: number }[] = [];
  const gateEntered: Record<string, number> = {};
  const released: Record<string, number> = {};
  const inits: { apiKeySource: string; tools: string[]; agents?: string[] }[] = [];

  const runId = spec([]).runId;
  await seedRun(db, runId);
  await db.insert(actions).values(["a1", "a2"].map((id) => ({ id, kind: "call" as const, status: "queued" })));
  const realGate = createApprovalGate(db);
  await realGate.createBundle({ runId, actionIds: ["a1"], summary: "check" });
  let decided: Promise<unknown> = Promise.resolve();
  // The real gate, timed. The owner approves a second after the first call starts waiting, so a1 really has to wait.
  const gate: ApprovalGate = {
    ...realGate,
    async waitForRelease(actionId, signal) {
      gateEntered[actionId] = Date.now();
      if (actionId === "a1") {
        decided = sleep(1000).then(() =>
          realGate.decide({ runId, status: "approved", channel: "dashboard", approvedBy: "check" }),
        );
      }
      const release = await realGate.waitForRelease(actionId, signal);
      released[actionId] = Date.now();
      return release;
    },
  };
  const budget = createBudget(db);
  const { query: realQuery } = await import("@anthropic-ai/claude-agent-sdk");
  const tap: Query = async function* (params) {
    for await (const message of realQuery(params)) {
      if (message.type === "system" && message.subtype === "init") inits.push(message);
      yield message;
    }
  };

  const callProvider: ToolDef = {
    name: "call_provider",
    description: "Place a call to the provider. Needs an actionId.",
    inputSchema: z.object({ actionId: z.string() }) as unknown as ToolDef["inputSchema"],
    async handler(input, ctx) {
      handled.push({ actionId: (input as { actionId: string }).actionId, agent: ctx.agent, at: Date.now() });
      return "called";
    },
  };

  const events: RunEvent[] = [];
  for await (const event of createAgentRuntime(async () => ({ gate, budget, query: tap })).run(spec([callProvider]))) {
    events.push(event);
  }
  const result = events.at(-1);
  const trace = JSON.stringify(events);

  // A fake key and a dead base URL are set, so this can only have succeeded on the login.
  assert.ok(result?.type === "result" && result.status === "success", `run did not succeed: ${trace}`);
  assert.ok(inits.length > 0, "no init message");
  for (const init of inits) {
    assert.equal(init.apiKeySource, "none");
    // Nothing from the owner's accounts and no built-in tool or agent, only what this run declared.
    assert.deepEqual(init.tools.filter((tool) => !["Task", "Agent", "mcp__platform__call_provider"].includes(tool)), []);
    assert.deepEqual(init.agents, ["caller"]);
  }

  assert.deepEqual(handled.map((call) => call.actionId), ["a1"], "only the released action may run");
  assert.equal(handled[0]!.agent, "caller", "the handler must know the subagent called it");
  assert.ok(gateEntered.a1! < released.a1! && released.a1! <= handled[0]!.at, "the handler must wait for the gate");

  assert.ok(gateEntered.a2, "the subagent must have tried the second call");
  const denied = events.find((event) => event.type === "denied");
  assert.ok(denied?.type === "denied" && denied.tool === "call_provider" && denied.agent === "caller", trace);

  assert.ok(result.costUsd > 0, "an estimated cost must be read from the result");
  // runs.cost_usd keeps 6 decimals, and the SDK's estimate has more.
  const { totalUsd } = await budget.status(runId);
  assert.ok(Math.abs(totalUsd - result.costUsd) < 1e-5, `Budget must get the estimate once: ${totalUsd} vs ${result.costUsd}`);
  assert.ok(trace.includes("an SDK estimate, not a bill"), "the cost must be labelled an estimate");

  await decided;
  assert.equal((await realGate.get(runId))?.status, "approved");
}

async function failsClosedWhenAKeyGetsThrough() {
  const { query: realQuery } = await import("@anthropic-ai/claude-agent-sdk");
  const leaky: Query = ({ prompt, options }) =>
    realQuery({ prompt, options: { ...options, env: { ...options.env, ANTHROPIC_API_KEY: FAKE_KEY } } });
  const gate = {} as ApprovalGate;
  const budget: Budget = {
    status: async () => ({ totalUsd: 0, capUsd: 5, over: false }),
    add: async () => ({ totalUsd: 0, capUsd: 5, over: false }),
  };
  const events: RunEvent[] = [];
  const runtime = createAgentRuntime(async () => ({ gate, budget, query: leaky }));
  for await (const event of runtime.run({ ...spec([]), prompt: "Reply ok." })) events.push(event);
  const result = events.at(-1);
  assert.ok(result?.type === "result" && result.status === "error", JSON.stringify(events));
  assert.ok(JSON.stringify(events).includes("Refusing to run"), JSON.stringify(events));
}
