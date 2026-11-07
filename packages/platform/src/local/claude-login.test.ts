import { describe, expect, it, vi } from "vitest";
import { assertIsolated, assertLogin, loginEnv } from "./claude-login.ts";

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
