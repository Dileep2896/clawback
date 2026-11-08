import { and, eq } from "drizzle-orm";
import type { Db } from "./client.ts";
import { approvals } from "./schema.ts";

export type ApprovalDecision = {
  runId: string;
  status: "approved" | "denied";
  channel: "dashboard" | "sms" | "naive";
  approvedBy: string;
  // How the provider step reaches BayTel. Only the dashboard button offers email.
  contact?: "call" | "email";
};

/**
 * The first decision wins: later calls return the row as already decided. The only place a bundle gets decided, used
 * by the local ApprovalGate and by the dashboard routes, which go straight to Postgres.
 */
export async function decideApproval(db: Pick<Db, "select" | "update">, { runId, status, channel, approvedBy, contact = "call" }: ApprovalDecision) {
  // Routes pass user input here, and "pending" would satisfy the enum and stamp an approver on an undecided row.
  if (status !== "approved" && status !== "denied") throw new Error(`Invalid approval decision "${String(status)}"`);
  if (!approvedBy) throw new Error("An approval decision must record who made it");
  if (contact !== "call" && contact !== "email") throw new Error(`Invalid contact choice "${String(contact)}"`);

  // One statement: a racing update waits on the row lock, then no longer matches status = 'pending'.
  const [decided] = await db
    .update(approvals)
    .set({ status, channel, approvedBy, approvedAt: new Date(), contact })
    .where(and(eq(approvals.runId, runId), eq(approvals.status, "pending")))
    .returning();
  if (decided) return decided;

  const [existing] = await db.select().from(approvals).where(eq(approvals.runId, runId));
  if (!existing) throw new Error(`Run ${runId} has no approval bundle`);
  return existing;
}
