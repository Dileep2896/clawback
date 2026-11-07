import { type AccountInfo, type Options, type Query, query as sdkQuery, type SDKMessage, type SDKUserMessage } from "@anthropic-ai/claude-agent-sdk";

// Local mode is for the owner's own Claude Code login only: Anthropic does not allow offering claude.ai login in a product.

// Each of these outranks the login or redirects its traffic, so one stray variable would silently change who is billed.
const OVERRIDES = /^(ANTHROPIC_|CLAUDE_CODE_USE_)/;

// Without these a login run sees the owner's real Gmail and Drive connectors, the built-in agents, async subagents, and
// the owner's own Claude Code memory, which a CEO agent once obeyed by stopping to ask before a simulated call.
const ISOLATION = {
  CLAUDE_CODE_DISABLE_AUTO_MEMORY: "1",
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
 * apiKeySource is also "none" for a third-party provider or a bearer token, so init alone does not prove the login.
 * Only a subscription login reports a subscriptionType. Probed: Bedrock, Vertex, tokens, keys and helpers all lack it.
 * shortcut: ANTHROPIC_BASE_URL from managed settings still reads as the login, the SDK does not expose it. See plan.md.
 */
export function assertLoginAccount({ apiProvider, subscriptionType, tokenSource, apiKeySource }: AccountInfo): void {
  if (apiProvider !== "firstParty" || !subscriptionType || apiKeySource) {
    throw new Error(
      `Refusing to run: not the Claude Code login (provider ${apiProvider}, token ${tokenSource}, key ${apiKeySource})`,
    );
  }
}

type AccountQuery = (params: { prompt: AsyncIterable<SDKUserMessage>; options: Options }) => Pick<Query, "accountInfo" | "close">;

/** Runs before the real query, because a string prompt starts the model at once. The prompt never yields, so nothing is spent. */
export async function checkLogin(query: AccountQuery = sdkQuery): Promise<void> {
  const noPrompt = (async function* (): AsyncGenerator<SDKUserMessage> {
    await new Promise(() => {});
  })();
  const probe = query({ prompt: noPrompt, options: { ...loginOptions(), tools: [] } });
  try {
    assertLoginAccount(await probe.accountInfo());
  } finally {
    probe.close();
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

export type AllowedInit = { tools: string[]; agents: string[] };

/** Callers run this as each init arrives, to stop a refused run at once. runOutcome applies the same check to decide the result. */
export function assertInit(init: Init, allowed: AllowedInit): void {
  assertLogin(init);
  assertIsolated(init, allowed);
}

export const errorText = (error: unknown) => (error instanceof Error ? error.message : String(error));

/**
 * The one answer to "did this run truly finish?", from everything the SDK sent plus anything thrown while reading it.
 * It needs a validated init, no failure of any kind, and a clean result for the last turn started.
 * Failure is a flag because an error can arrive with an empty message. A failure is never cleared by a later success.
 */
export function runOutcome(messages: SDKMessage[], allowed: AllowedInit, thrown: unknown[] = []): { finished: boolean; reason: string } {
  let failed = false;
  let reason = "";
  let sawValidInit = false;
  // Cleared when another turn starts, so a turn that never finishes cannot borrow an earlier result.
  let lastTurnSucceeded = false;
  const fail = (text: string) => {
    failed = true;
    reason ||= text;
  };

  for (const message of messages) {
    if (message.type === "system" && message.subtype === "init") {
      lastTurnSucceeded = false;
      try {
        // Checked on every init: the connectors first appeared in a later one.
        assertInit(message, allowed);
        sawValidInit = true;
      } catch (error) {
        fail(errorText(error));
      }
      if (message.mcp_servers.some((server) => server.status === "failed")) fail("A tool server failed to connect");
    } else if (message.type === "rate_limit_event") {
      if (message.rate_limit_info.status === "rejected") {
        const { resetsAt } = message.rate_limit_info;
        fail(`Claude plan rate limit reached${resetsAt ? `, resets ${new Date(resetsAt * 1000).toISOString()}` : ""}`);
      }
    } else if (message.type === "auth_status") {
      if (message.error !== undefined) fail(message.error);
    } else if (message.type === "system" && message.subtype === "task_notification") {
      // The main agent can still end cleanly after its subagent died.
      if (message.status !== "completed") fail(`A subagent task ${message.status}: ${message.summary}`);
    } else if (message.type === "system" && message.subtype === "model_refusal_no_fallback") {
      fail("The model refused the request");
    } else if (message.type === "assistant") {
      lastTurnSucceeded = false;
      if (message.error !== undefined) fail(message.error === "rate_limit" ? "Claude plan rate limit reached" : message.error);
    } else if (message.type === "result") {
      // A failed auth arrives as subtype "success" with is_error set, so subtype alone would read as success.
      if (message.subtype !== "success") fail(message.errors.join("; ") || message.subtype);
      else if (message.is_error) fail(message.result);
      else if (message.terminal_reason && message.terminal_reason !== "completed") fail(`The run stopped early: ${message.terminal_reason}`);
      else lastTurnSucceeded = true;
    }
  }

  for (const error of thrown) fail(errorText(error));
  if (!sawValidInit) fail("Refusing to run: the run reported no init, so the login was not checked");
  if (!lastTurnSucceeded) fail("The run ended with no result");
  return { finished: !failed, reason: failed ? reason || "the run reported an error with no message" : "" };
}
