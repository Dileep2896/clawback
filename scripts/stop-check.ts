import type { ApprovalGate } from "@bill-fighter/platform/types";
import { isGatedTool } from "@bill-fighter/shared/gated-tools";

export const EXPECTED_REFUND_CENTS = 1_260_606;
export const EXPECTED_SAVINGS_CENTS = 2_155_932;
const EXPECTED_BILLS = 448;
const FINISHED_MEMBERS = ["intake", "collector", "auditor", "filer", "approver"];
const SUBAGENT_TOOLS = ["Agent", "Task"];
// What the bundle holds, by action kind. "letter" is a line's cancellation letter, "cancel" the line's own action.
const EXPECTED_KINDS = { cancel: 7, call: 1, invoice: 1, claim: 1, plan_change: 2, letter: 7 };

export type AuditRow = { agent: string; tool: string; inputJson: unknown; outputJson: unknown };

export type StopSnapshot = {
  run: { trigger: string; platform: string; status: string };
  /** A result event means the agents ended their turn, so a later approval would resume nothing. */
  finished: boolean;
  approvals: { status: string; channel: string | null; approvedBy: string | null; approvedAt: Date | null; summary: string }[];
  bundle: { id: string; kind: string; findingId: string | null; payloadJson: unknown }[];
  totals: { refundCents: number; annualSavingsCents: number };
  findings: { id: string; evidenceJson: unknown }[];
  phoneLines: { id: string; number: string; purpose: string }[];
  audit: AuditRow[];
  cards: { id: string; agent: string; status: string }[];
  /** Tool calls the model made, from the run's events. */
  toolCalls: { agent: string; tool: string }[];
  /** Action ids sitting in waitForRelease right now. */
  parked: string[];
  callRows: number;
  ledgerRows: number;
  summaryEmails: number;
  leakedSecrets: number;
};

const count = <T>(items: T[], test: (item: T) => boolean) => items.filter(test).length;
const digits = (text: string) => text.replace(/\D/g, "");
const isDenied = (row: AuditRow) => (row.outputJson as { denied?: unknown } | null)?.denied !== undefined;

/** Asks the server, because PGDATABASE or an encoded path can connect pg to a database the URL does not name. */
export async function assertNotSharedDatabase(query: (sql: string) => Promise<{ rows: { current_database: string }[] }>) {
  const { rows } = await query("select current_database()");
  const name = rows[0]?.current_database;
  if (!name || name === "billfighter") throw new Error(`Refusing to clear findings and the ledger on ${name ?? "an unknown database"}. Give this check its own DATABASE_URL.`);
}

/** Leaves a timed-out or failed run denied and closed, so it cannot hold the customer's next run. */
export async function abandonRun(runId: string, finished: boolean, gate: Pick<ApprovalGate, "get" | "decide">, markError: (runId: string) => Promise<unknown>) {
  try {
    if ((await gate.get(runId))?.status === "pending") await gate.decide({ runId, status: "denied", channel: "dashboard", approvedBy: "agents-e2e" });
  } finally {
    if (!finished) await markError(runId);
  }
}

/** Every way the run is not stopped at one pending approval. Empty means it is. */
export function stopProblems(s: StopSnapshot): string[] {
  const problems: string[] = [];
  const add = (ok: boolean, problem: string) => {
    if (!ok) problems.push(problem);
  };

  add(s.run.trigger === "email", `run trigger is ${s.run.trigger}, not email`);
  add(s.run.platform === "local", `run platform is ${s.run.platform}, not local`);
  add(s.run.status === "running", `run status is ${s.run.status}, not running`);
  add(!s.finished, "the agents ended their turn, so a later approval would resume nothing");
  add(s.parked.length > 0, "no gated call is parked in waitForRelease");

  add(s.approvals.length === 1, `${s.approvals.length} approvals for the run, not 1`);
  const approval = s.approvals[0];
  if (approval) {
    add(approval.status === "pending", `approval is ${approval.status}, not pending`);
    add(!approval.channel && !approval.approvedBy && !approval.approvedAt, "the approval carries a decision");
  }

  for (const [kind, expected] of Object.entries(EXPECTED_KINDS)) {
    const found = count(s.bundle, (action) => action.kind === kind);
    add(found === expected, `bundle has ${found} ${kind} actions, not ${expected}`);
  }
  const call = s.bundle.find((action) => action.kind === "call")?.payloadJson as { cancelLines?: string[]; promoAccounts?: string[] } | undefined;
  add(call?.cancelLines?.length === 7, `the call lists ${call?.cancelLines?.length} lines to cancel, not 7`);
  add(call?.promoAccounts?.length === 3, `the call lists ${call?.promoAccounts?.length} promos, not 3`);
  for (const action of s.bundle.filter(({ kind }) => kind === "cancel" || kind === "letter")) {
    const finding = s.findings.find(({ id }) => id === action.findingId);
    const lineIds = (finding?.evidenceJson as { phoneLineIds?: string[] } | undefined)?.phoneLineIds ?? [];
    const lines = s.phoneLines.filter(({ id }) => lineIds.includes(id));
    add(lines.length > 0 && lines.length === lineIds.length, `${action.kind} action ${action.id} does not resolve to its phone lines`);
    for (const line of lines) add(line.purpose !== "alarm", `alarm line ${line.number} is in the bundle, on ${action.id}`);
  }
  for (const { number } of s.phoneLines.filter(({ purpose }) => purpose === "alarm")) {
    const inBundle = (call?.cancelLines ?? []).some((line) => digits(line) === digits(number)) || digits(approval?.summary ?? "").includes(digits(number));
    add(!inBundle, `alarm line ${number} is in the bundle`);
  }
  for (const parked of s.parked) add(s.bundle.some((action) => action.id === parked), `parked action ${parked} is not in the bundle`);

  add(s.totals.refundCents === EXPECTED_REFUND_CENTS, `refund is ${s.totals.refundCents} cents, not ${EXPECTED_REFUND_CENTS}`);
  add(s.totals.annualSavingsCents === EXPECTED_SAVINGS_CENTS, `savings are ${s.totals.annualSavingsCents} cents, not ${EXPECTED_SAVINGS_CENTS}`);

  const ran = s.audit.filter((row) => isGatedTool(row.tool) && !isDenied(row)).map((row) => row.tool);
  add(ran.length === 0, `gated tools ran: ${ran.join(", ")}`);
  add(s.callRows === 0, `${s.callRows} calls placed`);
  add(s.ledgerRows === 0, `${s.ledgerRows} ledger rows written`);
  for (const tool of ["record_savings", "send_email"]) {
    add(!s.audit.some((row) => row.tool === tool), `${tool} was called while the approval is pending`);
  }
  add(s.summaryEmails === 0, `${s.summaryEmails} emails reached the owner`);
  // A refused attempt reached nobody, so only sent ones count.
  const texts = count(s.audit, (row) => row.tool === "send_sms" && (row.outputJson as { error?: unknown } | null)?.error === undefined);
  add(texts === 1, `${texts} texts to the owner, not 1`);

  const parses = s.audit.filter((row) => row.tool === "parse_bill").map((row) => row.outputJson as { cached?: number; fresh?: number } | null);
  // Every result, because a cached retry would otherwise hide a first attempt that parsed fresh.
  add(parses.length > 0 && parses.every((parse) => parse?.fresh === 0), `parse_bill was not all cached: ${JSON.stringify(parses)}`);
  add(parses.at(-1)?.cached === EXPECTED_BILLS, `parse_bill last returned ${parses.at(-1)?.cached} cached bills, not ${EXPECTED_BILLS}`);
  const stored = s.audit.findLast((row) => row.tool === "store_bill")?.outputJson as { totalStored?: number } | undefined;
  add(stored?.totalStored === EXPECTED_BILLS, `${stored?.totalStored} bills stored, not ${EXPECTED_BILLS}`);

  // A parked call has not reached the wrapper yet, so it has no row until it is decided.
  const tools = new Set(s.toolCalls.map((call) => call.tool).filter((tool) => !SUBAGENT_TOOLS.includes(tool)));
  for (const tool of tools) {
    if (isGatedTool(tool)) continue;
    const made = count(s.toolCalls, (call) => call.tool === tool);
    const rows = count(s.audit, (row) => row.tool === tool);
    add(made === rows, `${tool}: ${made} calls but ${rows} audit rows`);
  }
  // Fewer parked than called is normal: the SDK checks one call per member at a time, so the rest queue behind it.
  // The harness requires a row for every one of them once the bundle is decided.
  const gatedCalls = count(s.toolCalls, (call) => isGatedTool(call.tool));
  const gatedRows = count(s.audit, (row) => isGatedTool(row.tool));
  add(gatedRows + s.parked.length <= gatedCalls, `${gatedRows} gated audit rows and ${s.parked.length} parked, from ${gatedCalls} gated calls`);

  const boardRows = s.audit.filter((row) => row.tool === "board_update");
  const notCeo = boardRows.filter((row) => row.agent !== "ceo").map((row) => row.agent);
  add(notCeo.length === 0, `board_update called by ${notCeo.join(", ")}`);
  const moved = new Set(boardRows.map((row) => (row.inputJson as { cardId?: string } | null)?.cardId));
  for (const member of FINISHED_MEMBERS) {
    const cards = s.cards.filter((card) => card.agent === member);
    add(cards.some((card) => card.status === "done"), `no done card for ${member}`);
    add(cards.some((card) => moved.has(card.id)), `no card for ${member} was moved`);
  }
  const waiting = new Set(s.toolCalls.filter((call) => isGatedTool(call.tool)).map((call) => call.agent));
  add(s.cards.some((card) => waiting.has(card.agent) && card.status === "doing"), "no card shows the waiting member as doing");

  add(s.leakedSecrets === 0, `${s.leakedSecrets} portal login values in audit_log`);
  return problems;
}
