import type { Audit, RunEvent } from "@bill-fighter/platform/types";
import { allowedToolNames, createAgentRuntime, type Query } from "@bill-fighter/platform/local/agent-runtime";
import { GATED_TOOLS, isGatedTool } from "@bill-fighter/shared/gated-tools";
import { afterEach, describe, expect, it, vi } from "vitest";
import { z } from "zod";
import { buildRunSpec, CEO, MEMBERS } from "./roster.ts";
import { type AgentTool, defineTool } from "./tool-wrapper.ts";

// Written out from project.md section 10 plus the phase file, not derived from the roster, so a drift fails here.
const SECTION_10: Record<string, string[]> = {
  ceo: ["board_update", "send_email"],
  intake: ["parse_inbound_email", "get_customer"],
  collector: ["portal_login", "download_bills", "download_usage", "store_bill", "store_usage"],
  auditor: ["parse_bill", "run_audit", "price_usage"],
  filer: ["draft_letter", "attach_evidence", "submit_claim", "change_rate_plan"],
  approver: ["request_approval", "send_sms"],
  negotiator: ["call_provider", "cancel_service"],
  finance: ["record_savings", "create_invoice", "card_pay"],
  monitor: ["schedule_check"],
};
const ROSTER = [CEO, ...MEMBERS];
const ALL_TOOLS = Object.values(SECTION_10).flat();

const tool = (name: string): AgentTool =>
  defineTool({
    name,
    description: name,
    inputSchema: z.object({ actionId: z.string().optional() }),
    targets: () => [],
    handler: async () => "ran",
  });

const audit: Audit = { record: async () => {}, list: async () => [] };
const build = (names: string[]) =>
  buildRunSpec({
    runId: "run-1",
    prompt: "go",
    tools: names.map(tool),
    audit,
    allowlist: { callNumbers: [], emailDomains: [], portalOrigins: [] },
  });

afterEach(() => {
  vi.restoreAllMocks();
  vi.unstubAllEnvs();
});

describe("the roster", () => {
  it("is the nine agents, each with exactly its section 10 tools", () => {
    expect(Object.fromEntries(ROSTER.map((def) => [def.name, def.tools]))).toEqual(SECTION_10);
  });

  it("gives every gated tool to exactly the agent that owns it", () => {
    const owners = ROSTER.flatMap((def) => def.tools.filter(isGatedTool).map((name) => [name, def.name]));
    expect(Object.fromEntries(owners)).toEqual({
      submit_claim: "filer",
      change_rate_plan: "filer",
      call_provider: "negotiator",
      cancel_service: "negotiator",
      create_invoice: "finance",
      card_pay: "finance",
    });
    expect(owners).toHaveLength(GATED_TOOLS.length);
  });

  it("gives no tool to two agents", () => {
    expect(new Set(ALL_TOOLS).size).toBe(ALL_TOOLS.length);
  });

  it.each(ROSTER.map((def) => [def.name, def] as const))("%s has a turn limit, and a prompt with the money rule", (_name, def) => {
    expect(def.maxTurns).toBeGreaterThan(0);
    expect(def.description).not.toBe("");
    expect(def.prompt).toMatch(new RegExp(`^# ${def.name}`, "i"));
    expect(def.prompt).toContain("Never compute money");
    expect(def.prompt).toContain("run_audit");
    expect(def.prompt).toContain("Never invent a number");
  });

  it("tells the prompts of gated agents to wait for an approved action id", () => {
    for (const name of ["filer", "negotiator", "finance"]) {
      expect(ROSTER.find((def) => def.name === name)?.prompt).toMatch(/approved action id/i);
    }
  });
});

describe("buildRunSpec", () => {
  it("hands every agent its full list once all tools exist, and warns about nothing", () => {
    const warn = vi.spyOn(console, "warn");
    const spec = build(ALL_TOOLS);
    expect(warn).not.toHaveBeenCalled();
    expect(spec.main.tools).toEqual(SECTION_10.ceo);
    expect(Object.fromEntries(spec.members.map((def) => [def.name, def.tools]))).toEqual(
      Object.fromEntries(MEMBERS.map((def) => [def.name, SECTION_10[def.name]])),
    );
    expect(spec.tools.map((def) => def.name)).toEqual(ALL_TOOLS);
  });

  it("offers only what exists, drops a member with nothing to call, and names what is missing", () => {
    const warn = vi.spyOn(console, "warn").mockImplementation(() => {});
    const spec = build(["board_update", "draft_letter"]);
    expect(spec.main.tools).toEqual(["board_update"]);
    expect(spec.members.map((def) => [def.name, def.tools])).toEqual([["filer", ["draft_letter"]]]);
    expect(warn.mock.calls[0]?.[0]).toContain("call_provider");
  });

  it("lets a provider tool plug in with no roster edit", () => {
    vi.spyOn(console, "warn").mockImplementation(() => {});
    expect(build(["draft_letter"]).members.find((def) => def.name === "negotiator")).toBeUndefined();
    const spec = build(["draft_letter", "call_provider"]);
    expect(spec.members.find((def) => def.name === "negotiator")?.tools).toEqual(["call_provider"]);
  });

  it("keeps the CEO when no tool exists at all", () => {
    vi.spyOn(console, "warn").mockImplementation(() => {});
    const spec = build([]);
    expect(spec.main.name).toBe("ceo");
    expect(spec.members).toEqual([]);
  });

  it("refuses a tool no agent lists, rather than let it into the run", () => {
    expect(() => build([...ALL_TOOLS, "wire_money"])).toThrow("No agent lists these tools, add them to the roster: wire_money");
  });

  it("runs every tool through the wrapper", async () => {
    const record = vi.fn<Audit["record"]>(async () => {});
    const spec = buildRunSpec({
      runId: "run-1",
      prompt: "go",
      tools: ALL_TOOLS.map(tool),
      audit: { record, list: async () => [] },
      allowlist: { callNumbers: [], emailDomains: [], portalOrigins: [] },
    });
    for (const def of spec.tools) await def.handler({}, { runId: "run-1", agent: "ceo" });
    expect(record.mock.calls.map(([entry]) => entry.tool)).toEqual(ALL_TOOLS);
  });

  it("refuses an off-allowlist target from the run's tools, using the env allowlist by default", async () => {
    vi.stubEnv("ALLOWED_EMAIL_DOMAINS", "billfighter.local");
    const handler = vi.fn(async () => "sent");
    const sendEmail = defineTool({
      ...tool("send_email"),
      inputSchema: z.object({ to: z.string() }),
      targets: ({ to }) => [{ kind: "email", value: to }],
      handler,
    });
    vi.spyOn(console, "warn").mockImplementation(() => {});
    const spec = buildRunSpec({ runId: "run-1", prompt: "go", tools: [sendEmail], audit });
    const send = spec.tools[0]?.handler;
    await expect(send?.({ to: "billing@pge.com" }, { runId: "run-1", agent: "ceo" })).rejects.toThrow("not on the allowlist");
    expect(handler).not.toHaveBeenCalled();
  });
});

describe("the spec on the platform runtime", () => {
  const INIT = {
    type: "system",
    subtype: "init",
    apiKeySource: "none",
    tools: [],
    agents: [],
    mcp_servers: [{ name: "platform", status: "connected" }],
  };
  const RESULT = { type: "result", subtype: "success", is_error: false, result: "done", total_cost_usd: 0 };

  it("keeps gated tools out of allowedTools, so the platform gate still decides them", () => {
    const allowed = allowedToolNames(build(ALL_TOOLS).tools);
    expect(allowed).toHaveLength(ALL_TOOLS.length - GATED_TOOLS.length);
    for (const name of GATED_TOOLS) expect(allowed).not.toContain(`mcp__platform__${name}`);
  });

  it("gives each subagent only its own tools and no built-ins", async () => {
    let options: Parameters<Query>[0]["options"] | undefined;
    const query: Query = async function* (params) {
      options = params.options;
      yield* [INIT, RESULT] as never[];
    };
    const runtime = createAgentRuntime(async () => ({
      gate: {} as never,
      budget: { status: async () => ({ totalUsd: 0, capUsd: 5, over: false }), add: async () => ({ totalUsd: 0, capUsd: 5, over: false }) },
      query,
      login: async () => {},
    }));
    const events: RunEvent[] = [];
    for await (const event of runtime.run(build(ALL_TOOLS))) events.push(event);

    expect(events.at(-1)).toMatchObject({ type: "result", status: "success" });
    expect(options?.tools).toEqual(["Agent"]);
    expect(options?.systemPrompt).toBe(CEO.prompt);
    for (const def of MEMBERS) {
      expect(options?.agents?.[def.name]?.tools).toEqual(SECTION_10[def.name]?.map((name) => `mcp__platform__${name}`));
      expect(options?.agents?.[def.name]?.maxTurns).toBe(def.maxTurns);
    }
  });
});
