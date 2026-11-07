/**
 * Live probe, spends naïve credit (hard cap $0.25): one coordinator delegates to one member that makes one gated call.
 * Shows where a member's ask parks and that our approval releases it. Needs the tunnel up and NAIVE_MCP_PUBLIC_URL set.
 * Run: pnpm exec tsx --env-file-if-exists=.env packages/platform/src/naive/probe.ts
 */
import { z } from "zod";
import type { Approval, ApprovalGate, Audit, RunSpec, ToolDef } from "../types.ts";
import { createAgentRuntime } from "./agent-runtime.ts";
import { type NaiveApi, naiveApi } from "./runtime-http.ts";

const CAP_USD = 0.25;
const balance = async () => (await naiveApi<{ balance_micro_usd: number }>("/credits/balance")).balance_micro_usd;

let approval: Partial<Approval> = { status: "pending", actionIds: ["probe-1"] };
const gate = {
  get: async () => approval as Approval,
  isReleased: async (id: string) => approval.status === "approved" && !!approval.actionIds?.includes(id),
} as unknown as ApprovalGate;
let total = 0;
const budget = {
  add: async (_: string, usd: number) => ({ totalUsd: (total += usd), capUsd: CAP_USD, over: total >= CAP_USD }),
  status: async () => ({ totalUsd: total, capUsd: CAP_USD, over: total >= CAP_USD }),
};
const audit: Audit = { record: async (row) => console.log("AUDIT", JSON.stringify(row)), list: async () => [] };

// Logs what each owned session reports, and approves the bundle the first time a gated call parks.
const api: NaiveApi = async (path, request) => {
  const result = await naiveApi(path, request);
  const s = result as { id?: string; status?: string; stop_reason?: string; pending_actions?: { name: string }[]; parent_session_id?: string };
  if (/^\/sessions\/ses_[^/]+$/.test(path)) {
    console.log("SESSION", s.id, s.status, s.stop_reason, "parent", s.parent_session_id ?? null, "pending", (s.pending_actions ?? []).map((a) => a.name));
    if (s.stop_reason === "awaiting_approval" && approval.status === "pending") {
      console.log("APPROVE: the owner taps approve once");
      approval = { status: "approved", actionIds: ["probe-1"], approvedBy: "probe-owner", channel: "dashboard" };
    }
  }
  if (path.endsWith("/tool_confirmations")) console.log("CONFIRM", path, JSON.stringify(request?.body));
  return result as never;
};

const callProvider: ToolDef = {
  name: "call_provider",
  description: "Place the probe call. Needs an actionId.",
  inputSchema: z.object({ actionId: z.string() }) as unknown as ToolDef["inputSchema"],
  handler: async (input) => {
    console.log("HANDLER ran call_provider", JSON.stringify(input));
    return { called: true };
  },
};

const spec: RunSpec = {
  runId: "naive-probe",
  prompt: 'Ask probe-caller to call call_provider once with actionId "probe-1", wait for it, then reply with one sentence saying what happened.',
  main: { name: "probe", description: "Probe coordinator", prompt: "You delegate to your one member and report. Be brief.", tools: [], maxTurns: 4 },
  members: [
    { name: "probe-caller", description: "Calls the provider", prompt: "Do exactly what you are told, once, then report in one sentence.", tools: ["call_provider"], maxTurns: 3 },
  ],
  tools: [callProvider],
};

const before = await balance();
const runtime = createAgentRuntime(async () => ({ gate, budget, audit, api, pollMs: 2000 }));
for await (const event of runtime.run(spec)) console.log("EVENT", JSON.stringify(event));
// Ledger debits can settle a moment after the session ends.
await new Promise((resolve) => setTimeout(resolve, 5000));
const after = await balance();
console.log(`REAL COST: $${((before - after) / 1_000_000).toFixed(4)} (balance ${before / 1e6} -> ${after / 1e6})`);
process.exit(0);
