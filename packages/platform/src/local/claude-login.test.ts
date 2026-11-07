import { describe, expect, it, vi } from "vitest";
import { assertIsolated, assertLogin, assertLoginAccount, checkLogin, loginEnv } from "./claude-login.ts";

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

  it("switches off connectors, built-in agents and background subagents", () => {
    expect(loginEnv({})).toMatchObject({
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
