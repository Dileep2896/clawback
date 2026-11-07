import type { Db } from "@bill-fighter/db/client";
import type { approvals, auditLog, boardCards, scheduledChecks, smsMessages } from "@bill-fighter/db/schema";
import type { z } from "zod";

export type Approval = typeof approvals.$inferSelect;
export type AuditEntry = typeof auditLog.$inferSelect;
export type BoardCard = typeof boardCards.$inferSelect;
export type ScheduledCheck = typeof scheduledChecks.$inferSelect;
export type SmsMessage = typeof smsMessages.$inferSelect;

export type ToolContext = { runId: string; agent: string };

// No "gated" flag: adapters call isGatedTool, so a tool cannot be declared ungated by mistake.
// A gated tool's input must carry actionId, which is what the gate checks.
export type ToolDef<I = unknown> = {
  name: string;
  description: string;
  inputSchema: z.ZodType<I>;
  handler(input: I, ctx: ToolContext): Promise<unknown>;
};

export type AgentDef = {
  name: string;
  description: string;
  prompt: string;
  tools: string[];
  maxTurns: number;
};

export type RunSpec = {
  runId: string;
  prompt: string;
  main: AgentDef;
  members: AgentDef[];
  tools: ToolDef[];
};

export type RunEvent =
  | { type: "text"; agent: string; text: string }
  | { type: "tool_call"; agent: string; tool: string; input: unknown }
  | { type: "tool_result"; agent: string; tool: string; output: unknown }
  | { type: "denied"; agent: string; tool: string; reason: string }
  | { type: "result"; status: "success" | "error" | "over_budget" | "incomplete"; costUsd: number; reason?: string };

export interface AgentRuntime {
  run(spec: RunSpec): AsyncIterable<RunEvent>;
}

export type JsonSchema = Record<string, unknown>;

export type LlmInput = {
  prompt: string;
  system?: string;
  // The parser retries with page images.
  images?: { mediaType: string; base64: string }[];
  // Told what the call cost, as an SDK estimate and not a bill, even if the call then fails.
  onCost?: (usd: number) => void;
  // Rejects with an error named TimeoutError after this long. No limit by default, because a parse can take minutes.
  timeoutMs?: number;
};

export interface Llm {
  /** Resolves with JSON that is valid against jsonSchema, or rejects: with LlmOutputError if the output was the problem. */
  structured<T = unknown>(input: LlmInput, jsonSchema: JsonSchema): Promise<T>;
}

export interface ApprovalGate {
  /** One bundle per run: a second call for the run returns the existing row. Give tx to write inside the caller's transaction. */
  createBundle(bundle: { runId: string; actionIds: string[]; summary: string }, tx?: Pick<Db, "select" | "insert">): Promise<Approval>;
  get(runId: string): Promise<Approval | null>;
  /** The first decision wins: later calls return the row as already decided. */
  decide(decision: {
    runId: string;
    status: "approved" | "denied";
    channel: "dashboard" | "sms" | "naive";
    approvedBy: string;
  }): Promise<Approval>;
  isReleased(actionId: string): Promise<boolean>;
  /** Waits while pending. True once approved; false if denied or if no bundle holds the action. */
  waitForRelease(actionId: string, signal?: AbortSignal): Promise<boolean>;
}

export type OutboundEmail = {
  to: string;
  // Defaults to the company identity. demo-start sets it for the provider's sender.
  from?: string;
  subject: string;
  text: string;
  html?: string;
  attachments?: { filename: string; path: string }[];
};

export type InboundEmail = {
  messageId: string;
  from: string;
  to: string;
  subject: string;
  text: string;
};

export interface Mail {
  /** Rejects a recipient outside ALLOWED_EMAIL_DOMAINS. */
  send(email: OutboundEmail): Promise<{ id: string }>;
  /** Turns a webhook body into one shape, and throws if it is invalid. */
  parseInbound(payload: unknown): InboundEmail;
}

export interface Sms {
  send(message: { to: string; body: string }): Promise<{ id: string }>;
  /** Records a reply from the simulated phone or a platform webhook. */
  receive(message: { from: string; body: string }): Promise<SmsMessage>;
  list(): Promise<SmsMessage[]>;
}

export interface BrowserSession {
  /** Rejects an origin outside ALLOWED_PORTAL_ORIGINS. */
  goto(url: string): Promise<void>;
  fill(selector: string, value: string): Promise<void>;
  /** Fills from the vault by name, so the value never reaches agent context or audit_log. */
  fillSecret(selector: string, vaultName: string): Promise<void>;
  click(selector: string): Promise<void>;
  isVisible(selector: string): Promise<boolean>;
  texts(selector: string): Promise<string[]>;
  /** One value per matching element, "" where the element lacks the attribute. */
  attributes(selector: string, name: string): Promise<string[]>;
  /** Clicks selector and saves the resulting download to destPath. */
  download(selector: string, destPath: string): Promise<void>;
  close(): Promise<void>;
}

export interface Browser {
  open(): Promise<BrowserSession>;
}

export interface Vault {
  put(name: string, value: string): Promise<void>;
  /** For adapters behind fillSecret. Agent tools use fillSecret, never this. Rejects on a wrong key. */
  get(name: string): Promise<string>;
}

export interface Card {
  /** Rejects over the cap. Writes card_spend to the ledger. */
  charge(charge: { customerId: string; amountCents: number; description: string }): Promise<{ ledgerId: string }>;
}

export interface Board {
  create(card: { runId: string; agent: string; title: string; status?: BoardCard["status"] }): Promise<BoardCard>;
  move(cardId: string, status: BoardCard["status"]): Promise<BoardCard>;
  list(runId: string): Promise<BoardCard[]>;
}

export interface Audit {
  record(entry: {
    runId: string | null;
    agent: string;
    tool: string;
    input?: unknown;
    output?: unknown;
    costUsd?: number;
  }): Promise<void>;
  list(runId: string): Promise<AuditEntry[]>;
}

export type BudgetStatus = { totalUsd: number; capUsd: number; over: boolean };

export interface Budget {
  add(runId: string, costUsd: number): Promise<BudgetStatus>;
  status(runId: string): Promise<BudgetStatus>;
}

export interface Scheduler {
  /** One check per customer and time: a repeat returns the existing one. */
  schedule(check: { customerId: string; runAt: Date }): Promise<ScheduledCheck>;
  onFire(handler: (check: ScheduledCheck) => Promise<void>): void;
  /** Fires a check now, without waiting for its time. */
  fire(checkId: string): Promise<void>;
}

export interface Identity {
  get(): Promise<{ companyName: string; email: string; phone: string }>;
}

export type Interfaces = {
  agentRuntime: AgentRuntime;
  approvalGate: ApprovalGate;
  audit: Audit;
  board: Board;
  browser: Browser;
  budget: Budget;
  card: Card;
  identity: Identity;
  llm: Llm;
  mail: Mail;
  scheduler: Scheduler;
  sms: Sms;
  vault: Vault;
};

// Each interface loads on first use, so asking for Board never pulls in Playwright.
export type Platform = { [K in keyof Interfaces]: () => Promise<Interfaces[K]> };
