import type { SDKMessage } from "@anthropic-ai/claude-agent-sdk";
import { describe, expect, it, vi } from "vitest";
import { assertIsolated, assertLogin, assertLoginAccount, checkLogin, loginEnv, runOutcome } from "./claude-login.ts";

describe("loginEnv", () => {
  it("removes every variable that can outrank or redirect the login, and keeps the rest", () => {
    vi.spyOn(console, "warn").mockImplementation(() => {});
    const source = {
      ANTHROPIC_API_KEY: "key",
      ANTHROPIC_AUTH_TOKEN: "token",
      ANTHROPIC_BASE_URL: "http://example.test",
      CLAUDE_CODE_USE_BEDROCK: "1",
      CLAUDE_CODE_USE_VERTEX: "1",
      CLAUDE_CODE_USE_FOUNDRY: "1",
      CLAUDE_AUTO_BACKGROUND_TASKS: "1",
      PATH: "/bin",
    };
    const env = loginEnv(source);
    for (const name of Object.keys(source)) {
      if (name !== "PATH") expect(env, name).not.toHaveProperty(name);
    }
    expect(env.PATH).toBe("/bin");
    expect(source.ANTHROPIC_API_KEY).toBe("key");
  });

  it("switches off memory, connectors, built-in agents and background subagents", () => {
    expect(loginEnv({})).toMatchObject({
      CLAUDE_CODE_DISABLE_AUTO_MEMORY: "1",
      ENABLE_CLAUDEAI_MCP_SERVERS: "false",
      CLAUDE_AGENT_SDK_DISABLE_BUILTIN_AGENTS: "1",
      CLAUDE_CODE_DISABLE_BACKGROUND_TASKS: "1",
    });
  });

  it("says when it ignores a key, without printing the key", () => {
    const warn = vi.spyOn(console, "warn").mockImplementation(() => {});
    loginEnv({ ANTHROPIC_CUSTOM_HEADERS: "secret-value" });
    expect(warn.mock.calls.flat().join()).toContain("ANTHROPIC_CUSTOM_HEADERS");
    expect(warn.mock.calls.flat().join()).not.toContain("secret-value");
  });

  it("removes an empty key too, which is what a copied .env.example sets", () => {
    expect(loginEnv({ ANTHROPIC_API_KEY: "" })).not.toHaveProperty("ANTHROPIC_API_KEY");
  });
});

describe("assertLogin", () => {
  it("accepts only the login", () => {
    expect(() => assertLogin({ apiKeySource: "none" })).not.toThrow();
  });

  it.each(["ANTHROPIC_API_KEY", "apiKeyHelper", "/login managed key", "user", "project", "org", "temporary", "oauth"])(
    "refuses %s",
    (apiKeySource) => {
      expect(() => assertLogin({ apiKeySource })).toThrow(/Refusing to run/);
    },
  );
});

describe("assertLoginAccount", () => {
  const LOGIN = { apiProvider: "firstParty", subscriptionType: "Claude Ultra", email: "owner@example.test" } as const;

  it("accepts a subscription login", () => {
    expect(() => assertLoginAccount(LOGIN)).not.toThrow();
  });

  // The values the SDK reported for each of these in a live probe.
  it.each([
    ["Bedrock", { apiProvider: "bedrock" }],
    ["Vertex", { apiProvider: "vertex" }],
    ["a bearer token", { apiProvider: "firstParty", tokenSource: "ANTHROPIC_AUTH_TOKEN" }],
    ["an OAuth token variable", { apiProvider: "firstParty", tokenSource: "CLAUDE_CODE_OAUTH_TOKEN" }],
    ["an API key", { apiProvider: "firstParty", tokenSource: "claude.ai", apiKeySource: "ANTHROPIC_API_KEY" }],
    ["a key helper", { apiProvider: "firstParty", tokenSource: "apiKeyHelper", apiKeySource: "apiKeyHelper" }],
    ["a key alongside a subscription", { ...LOGIN, apiKeySource: "apiKeyHelper" }],
    ["a provider with a subscription", { ...LOGIN, apiProvider: "gateway" }],
    ["nothing reported", {}],
  ] as const)("refuses %s, without printing the account", (_name, account) => {
    expect(() => assertLoginAccount(account)).toThrow(/Refusing to run/);
    expect(() => assertLoginAccount(account)).not.toThrow(/owner@example/);
  });
});

describe("checkLogin", () => {
  const probeWith = (accountInfo: () => Promise<object>) => {
    const close = vi.fn();
    return { close, query: () => ({ accountInfo, close }) };
  };

  it("passes on the login and closes the probe", async () => {
    const { close, query } = probeWith(async () => ({ apiProvider: "firstParty", subscriptionType: "Claude Ultra" }));
    await expect(checkLogin(query)).resolves.toBeUndefined();
    expect(close).toHaveBeenCalledOnce();
  });

  it("refuses another provider and closes the probe", async () => {
    const { close, query } = probeWith(async () => ({ apiProvider: "bedrock" }));
    await expect(checkLogin(query)).rejects.toThrow(/Refusing to run/);
    expect(close).toHaveBeenCalledOnce();
  });

  it("fails closed when the account cannot be read", async () => {
    const { close, query } = probeWith(async () => {
      throw new Error("no answer");
    });
    await expect(checkLogin(query)).rejects.toThrow(/no answer/);
    expect(close).toHaveBeenCalledOnce();
  });
});

describe("assertIsolated", () => {
  const allowed = { tools: ["Task", "mcp__platform__a"], agents: ["caller"] };

  it("accepts what the run declared", () => {
    expect(() => assertIsolated({ apiKeySource: "none", tools: ["Task"], agents: ["caller"] }, allowed)).not.toThrow();
  });

  it.each([
    ["an account connector", { tools: ["mcp__claude_ai_Gmail__send_message"], agents: [] }],
    ["a built-in tool", { tools: ["Bash"], agents: [] }],
    ["a built-in agent", { tools: [], agents: ["general-purpose"] }],
  ])("refuses %s", (_name, init) => {
    expect(() => assertIsolated({ apiKeySource: "none", ...init }, allowed)).toThrow(/Refusing to run/);
  });
});

describe("runOutcome", () => {
  const ALLOWED = { tools: ["mcp__platform__a"], agents: [] };
  const INIT = { type: "system", subtype: "init", apiKeySource: "none", tools: ["mcp__platform__a"], agents: [], mcp_servers: [] };
  const OK = { type: "result", subtype: "success", is_error: false, result: "done" };
  const result = (extra: object) => ({ ...OK, ...extra });
  const assistant = (error?: string) => ({ type: "assistant", error });
  const auth = (error?: string) => ({ type: "auth_status", error });
  const task = (status: string) => ({ type: "system", subtype: "task_notification", status, summary: "" });
  const outcome = (messages: unknown[], thrown?: unknown[]) => runOutcome(messages as SDKMessage[], ALLOWED, thrown);

  it.each<[string, unknown[]]>([
    ["a validated init and a clean result", [INIT, OK]],
    ["a result that says it completed", [INIT, result({ terminal_reason: "completed" })]],
    ["a second turn that also finished", [INIT, OK, INIT, OK]],
    ["messages that carry no error", [INIT, assistant(), auth(), task("completed"), OK]],
    ["a rate limit warning that still allows the run", [INIT, { type: "rate_limit_event", rate_limit_info: { status: "allowed_warning" } }, OK]],
    ["a refusal the SDK retries on a fallback", [INIT, { type: "system", subtype: "model_refusal_fallback" }, OK]],
  ])("finished: %s", (_name, messages) => {
    expect(outcome(messages)).toEqual({ finished: true, reason: "" });
  });

  it.each<[string, unknown[], RegExp]>([
    ["an empty auth error after a valid result", [INIT, OK, auth("")], /no message/],
    ["an empty auth error before a valid result", [INIT, auth(""), OK], /no message/],
    ["an auth error", [INIT, auth("token expired"), OK], /token expired/],
    ["an empty assistant error", [INIT, assistant(""), OK], /no message/],
    ["a billing error", [INIT, assistant("billing_error"), OK], /billing_error/],
    ["an authentication error after a result", [INIT, OK, assistant("authentication_failed"), OK], /authentication_failed/],
    ["terminal_reason aborted_tools", [INIT, result({ terminal_reason: "aborted_tools" })], /aborted_tools/],
    ["terminal_reason max_turns", [INIT, result({ terminal_reason: "max_turns" })], /max_turns/],
    ["a terminal model refusal", [INIT, { type: "system", subtype: "model_refusal_no_fallback" }, OK], /refused/],
    ["a later init without a result", [INIT, OK, INIT], /no result/],
    ["a later assistant turn without a result", [INIT, OK, assistant()], /no result/],
    ["no result", [INIT], /no result/],
    ["no init", [OK], /no init/],
    ["nothing at all", [], /no init/],
    ["a key instead of the login", [{ ...INIT, apiKeySource: "ANTHROPIC_API_KEY" }, OK], /Refusing to run/],
    ["a refused init followed by a valid one", [{ ...INIT, apiKeySource: "apiKeyHelper" }, INIT, OK], /Refusing to run/],
    ["a connector in a later init", [INIT, OK, { ...INIT, tools: ["mcp__claude_ai_Gmail__send_message"] }, OK], /Gmail/],
    ["a tool server that failed to connect", [{ ...INIT, mcp_servers: [{ name: "platform", status: "failed" }] }, OK], /tool server/],
    ["a plan rate limit", [INIT, { type: "rate_limit_event", rate_limit_info: { status: "rejected", resetsAt: 1_800_000_000 } }, OK], /rate limit.*resets/],
    ["a failed subagent task", [INIT, task("failed"), OK], /subagent task failed/],
    ["a stopped subagent task", [INIT, task("stopped"), OK], /subagent task stopped/],
    ["is_error on a success subtype", [INIT, result({ is_error: true, result: "Invalid API key" })], /Invalid API key/],
    ["is_error with an empty message, then a success", [INIT, result({ is_error: true, result: "" }), OK], /no message/],
    ["is_error with no message at all", [INIT, OK, result({ is_error: true, result: undefined })], /no message/],
    ["an error subtype with is_error false", [INIT, OK, { type: "result", subtype: "error_during_execution", is_error: false, errors: [] }], /error_during_execution/],
  ])("not finished: %s", (_name, messages, reason) => {
    const { finished, reason: text } = outcome(messages);
    expect(finished).toBe(false);
    expect(text).toMatch(reason);
  });

  it.each<[string, unknown, RegExp]>([
    ["an error", new Error("boom"), /boom/],
    ["an error with an empty message", new Error(""), /no message/],
    ["undefined", undefined, /undefined/],
  ])("is not finished when %s was thrown after a clean run", (_name, error, reason) => {
    const { finished, reason: text } = outcome([INIT, OK], [error]);
    expect(finished).toBe(false);
    expect(text).toMatch(reason);
  });
});
