import type { Db } from "@bill-fighter/db/client";
import { customers, phoneLines, runs } from "@bill-fighter/db/schema";
import { FindingEvidence } from "@bill-fighter/shared/finding";
import { eq, inArray } from "drizzle-orm";

export async function customerOfRun(db: Db, runId: string) {
  const [row] = await db
    .select({ customer: customers })
    .from(runs)
    .innerJoin(customers, eq(runs.customerId, customers.id))
    .where(eq(runs.id, runId));
  if (!row) throw new Error(`Run ${runId} does not exist`);
  return row.customer;
}

/** The lines a finding may cancel, or [] if it may cancel none. phone_lines decides what is an alarm line, not the finding's own text. */
export async function cancellableLines(db: Db, finding: { type: string; evidenceJson: unknown }) {
  if (finding.type !== "unusedLines") return [];
  const { phoneLineIds, detail } = FindingEvidence.parse(finding.evidenceJson);
  if (detail.action !== "cancel" || phoneLineIds.length === 0) return [];
  const lines = await db.select().from(phoneLines).where(inArray(phoneLines.id, phoneLineIds));
  return lines.length === new Set(phoneLineIds).size && lines.every((line) => line.purpose !== "alarm") ? lines : [];
}
