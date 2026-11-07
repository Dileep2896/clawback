import type { Db } from "@bill-fighter/db/client";
import { actions, approvals, auditLog, calls, findings, phoneLines, runs } from "@bill-fighter/db/schema";
import { lineKey } from "@bill-fighter/voice/sim/engine";
import { and, eq, inArray, isNotNull } from "drizzle-orm";

const AFTER_APPROVAL = ["record_savings", "schedule_check", "send_email"];

/** wrapTool and auditDenied write these keys when a tool did not do its work, so such a row must not count. */
const didWork = (output: unknown) => !(output && typeof output === "object" && ("error" in output || "refused" in output || "denied" in output));

async function toolsThatWorked(db: Db, runId: string, tools: string[]) {
  const rows = await db.select({ tool: auditLog.tool, output: auditLog.outputJson }).from(auditLog).where(and(eq(auditLog.runId, runId), inArray(auditLog.tool, tools)));
  return new Set(rows.filter((row) => didWork(row.output)).map((row) => row.tool));
}

/**
 * What a run left undone, read from the database, because the SDK's "success" only means the model stopped talking.
 * Empty means the run did what it should. That includes a denied approval, and a line or promo the rep refused, since those are real outcomes.
 */
export async function planGaps(db: Db, runId: string): Promise<string[]> {
  const [run] = await db.select({ customerId: runs.customerId }).from(runs).where(eq(runs.id, runId));
  if (!run) return [`Run ${runId} is not on file.`];
  const [approval] = await db.select().from(approvals).where(eq(approvals.runId, runId));

  if (!approval) {
    if (!(await toolsThatWorked(db, runId, ["run_audit"])).has("run_audit")) return ["The run ended before its audit finished."];
    // Findings with no money, such as an alarm line to check, stay proposed for good and ask for nothing.
    const open = await db.select({ refund: findings.refundCents, savings: findings.annualSavingsCents }).from(findings).where(and(eq(findings.customerId, run.customerId), eq(findings.status, "proposed")));
    return open.some(({ refund, savings }) => refund + savings > 0) ? ["The run found savings but ended without asking the owner to approve them."] : [];
  }
  if (approval.status === "denied") return [];
  if (approval.status === "pending") return ["The run ended while the owner's approval was still pending."];

  const bundled = await db.select().from(actions).where(inArray(actions.id, approval.actionIds));
  const gaps = bundled.filter(({ kind, status }) => kind !== "cancel" && kind !== "letter" && status !== "done").map(({ id, kind }) => `The approved ${kind} action ${id} did not finish.`);

  // A line the rep refused stays open on purpose, so only a line the call confirmed has to be recorded. A letter closes with its cancel action.
  const finishedCalls = await db.select({ outcome: calls.outcomeJson }).from(calls).where(and(inArray(calls.actionId, approval.actionIds), isNotNull(calls.outcomeJson)));
  const confirmed = new Set(finishedCalls.flatMap(({ outcome }) => (outcome as { cancelled_lines: string[] }).cancelled_lines.map(lineKey)));
  const openCancels = bundled.filter(({ kind, status }) => kind === "cancel" && status !== "done");
  if (openCancels.length > 0 && confirmed.size > 0) {
    const rows = await db.select({ actionId: actions.id, evidence: findings.evidenceJson }).from(actions).innerJoin(findings, eq(actions.findingId, findings.id)).where(inArray(actions.id, openCancels.map(({ id }) => id)));
    const lines = await db.select({ id: phoneLines.id, number: phoneLines.number }).from(phoneLines).where(inArray(phoneLines.id, rows.flatMap(({ evidence }) => (evidence as { phoneLineIds: string[] }).phoneLineIds)));
    for (const { actionId, evidence } of rows) {
      const line = lines.find(({ id }) => (evidence as { phoneLineIds: string[] }).phoneLineIds.includes(id));
      if (line && confirmed.has(lineKey(line.number))) gaps.push(`The rep confirmed line ${line.number}, but its action ${actionId} was not recorded.`);
    }
  }

  const worked = await toolsThatWorked(db, runId, AFTER_APPROVAL);
  gaps.push(...AFTER_APPROVAL.filter((tool) => !worked.has(tool)).map((tool) => `The run ended without a successful ${tool}.`));
  return gaps;
}
