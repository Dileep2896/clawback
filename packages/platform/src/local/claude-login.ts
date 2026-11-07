import type { Options } from "@anthropic-ai/claude-agent-sdk";

// Local mode is for the owner's own Claude Code login only: Anthropic does not allow offering claude.ai login in a product.

// Each of these outranks the login or redirects its traffic, so one stray variable would silently change who is billed.
const OVERRIDES = /^(ANTHROPIC_|CLAUDE_CODE_USE_)/;

// Without these a login run sees the owner's real Gmail and Drive connectors, the built-in agents, and async subagents.
const ISOLATION = {
  ENABLE_CLAUDEAI_MCP_SERVERS: "false",
  CLAUDE_CODE_DISABLE_BACKGROUND_TASKS: "1",
  CLAUDE_AGENT_SDK_DISABLE_BUILTIN_AGENTS: "1",
};

const warned = new Set<string>();

/** The SDK replaces the subprocess environment with this, so a removed variable cannot reach Claude. */
export function loginEnv(source: NodeJS.ProcessEnv = process.env): Record<string, string | undefined> {
  const env: Record<string, string | undefined> = { ...source, ...ISOLATION };
  delete env.CLAUDE_AUTO_BACKGROUND_TASKS;
  for (const name of Object.keys(env)) {
    if (!OVERRIDES.test(name)) continue;
    if (env[name] && !warned.has(name)) {
      warned.add(name);
      console.warn(`Ignoring ${name}: local mode runs on the Claude Code login.`);
    }
    delete env[name];
  }
  return env;
}

export function loginOptions(): Options {
  return {
    env: loginEnv(),
    // No settings file may add allow rules, which skip canUseTool, or a key helper, which outranks the login.
    settingSources: [],
    persistSession: false,
    ...(process.env.CLAUDE_MODEL ? { model: process.env.CLAUDE_MODEL } : {}),
  };
}

type Init = { apiKeySource: string; tools: string[]; agents?: string[] };

/** Fails closed on what scrubbing cannot see, such as an apiKeyHelper in managed settings. */
export function assertLogin(init: Pick<Init, "apiKeySource">): void {
  if (init.apiKeySource !== "none") {
    throw new Error(`Refusing to run: Claude is using "${init.apiKeySource}" instead of the Claude Code login`);
  }
}

/**
 * Fails closed if init lists anything this run did not declare. A backstop only: connectors connect after init, so
 * ENABLE_CLAUDEAI_MCP_SERVERS and deny-by-default canUseTool are what keep them out, and the check proves it live.
 */
export function assertIsolated(init: Init, allowed: { tools: string[]; agents: string[] }): void {
  const extra = [
    ...init.tools.filter((tool) => !allowed.tools.includes(tool)),
    ...(init.agents ?? []).filter((agent) => !allowed.agents.includes(agent)),
  ];
  if (extra.length) throw new Error(`Refusing to run: not declared by this run: ${extra.join(", ")}`);
}
