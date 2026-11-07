import { readFileSync } from "node:fs";
import type { AgentDef, Audit, RunSpec } from "@bill-fighter/platform/types";
import { type Allowlist, allowlistFromEnv } from "@bill-fighter/shared/allowlist";
import { type AgentTool, wrapTool } from "./tool-wrapper.ts";

const promptFile = (name: string) => readFileSync(new URL(`../prompts/${name}.md`, import.meta.url), "utf8");
const RULES = promptFile("_rules");

const agent = (name: string, description: string, tools: string[], maxTurns: number): AgentDef => ({
  name,
  description,
  prompt: `${promptFile(name)}\n${RULES}`,
  tools,
  maxTurns,
});

export const CEO = agent("ceo", "Runs the savings plan, keeps the board and emails the owner.", ["board_update", "send_email"], 40);

export const MEMBERS: AgentDef[] = [
  agent("intake", "Reads the inbound bill email and identifies the customer.", ["parse_inbound_email", "get_customer"], 5),
  agent(
    "collector",
    "Logs into provider portals and downloads and stores all bills and usage.",
    ["portal_login", "download_bills", "download_usage", "store_bill", "store_usage"],
    10,
  ),
  agent("auditor", "Parses bills and runs every audit rule to produce findings.", ["parse_bill", "run_audit", "price_usage"], 10),
  agent(
    "filer",
    "Drafts claim, rate change and cancellation letters, and files them once approved.",
    ["draft_letter", "attach_evidence", "submit_claim", "change_rate_plan"],
    15,
  ),
  agent("approver", "Sends the owner one approval request covering every proposed action.", ["request_approval", "send_sms"], 5),
  agent(
    "negotiator",
    "Calls the provider line about approved items and records confirmed cancellations.",
    ["call_provider", "cancel_service"],
    8,
  ),
  agent("finance", "Records savings in the ledger, and invoices our share once approved.", ["record_savings", "create_invoice", "card_pay"], 8),
  agent("monitor", "Schedules next month's bill check.", ["schedule_check"], 3),
];

const ROSTER = [CEO, ...MEMBERS];

/** Wraps every tool it hands to a run, so build specs here rather than by hand. */
export function buildRunSpec({
  runId,
  prompt,
  tools,
  audit,
  allowlist = allowlistFromEnv(),
}: {
  runId: string;
  prompt: string;
  tools: AgentTool[];
  audit: Audit;
  allowlist?: Allowlist;
}): RunSpec {
  const registered = new Set(tools.map((tool) => tool.name));
  const listed = new Set(ROSTER.flatMap((def) => def.tools));

  const unowned = [...registered].filter((name) => !listed.has(name));
  if (unowned.length > 0) throw new Error(`No agent lists these tools, add them to the roster: ${unowned.join(", ")}`);

  const missing = [...listed].filter((name) => !registered.has(name));
  if (missing.length > 0) console.warn(`Tools not built yet, so not offered: ${missing.join(", ")}`);

  const available = (def: AgentDef) => ({ ...def, tools: def.tools.filter((name) => registered.has(name)) });
  return {
    runId,
    prompt,
    main: available(CEO),
    // A member with nothing to call is dropped, so the CEO cannot delegate to it and sees it as unavailable.
    members: MEMBERS.map(available).filter((def) => def.tools.length > 0),
    tools: tools.map((tool) => wrapTool(tool, { audit, allowlist })),
  };
}
