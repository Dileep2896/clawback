import { setTimeout as sleep } from "node:timers/promises";
import { decideApproval } from "@bill-fighter/db/approvals";
import { db as sharedDb, type Db } from "@bill-fighter/db/client";
import { actions, approvals } from "@bill-fighter/db/schema";
import { arrayContains, eq, inArray } from "drizzle-orm";
import type { ApprovalGate } from "../types.ts";

const POLL_MS = 500;

export function createApprovalGate(db: Db): ApprovalGate {
  const get = async (runId: string) => {
    const [row] = await db.select().from(approvals).where(eq(approvals.runId, runId));
    return row ?? null;
  };

  const statusesHolding = async (actionId: string) => {
    const rows = await db
      .select({ status: approvals.status })
      .from(approvals)
      .where(arrayContains(approvals.actionIds, [actionId]));
    return rows.map((row) => row.status);
  };

  return {
    get,

    async createBundle({ runId, actionIds, summary }) {
      const unique = [...new Set(actionIds)];
      if (unique.length === 0) throw new Error(`Run ${runId}: an approval bundle needs at least one action`);
      // Postgres cannot enforce foreign keys on array elements.
      const known = await db.select({ id: actions.id }).from(actions).where(inArray(actions.id, unique));
      const knownIds = new Set(known.map((row) => row.id));
      const missing = unique.filter((id) => !knownIds.has(id));
      if (missing.length > 0) throw new Error(`Run ${runId}: unknown actions in bundle: ${missing.join(", ")}`);

      const [created] = await db
        .insert(approvals)
        .values({ runId, actionIds: unique, summary })
        .onConflictDoNothing({ target: approvals.runId })
        .returning();
      return created ?? (await get(runId))!;
    },

    decide: (decision) => decideApproval(db, decision),

    isReleased: async (actionId) => (await statusesHolding(actionId)).includes("approved"),

    async waitForRelease(actionId, signal) {
      for (;;) {
        signal?.throwIfAborted();
        const statuses = await statusesHolding(actionId);
        if (statuses.includes("approved")) return true;
        if (!statuses.includes("pending")) return false;
        await sleep(POLL_MS, undefined, { signal });
      }
    },
  };
}

export default createApprovalGate(sharedDb);
