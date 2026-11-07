import { db as sharedDb, type Db } from "@bill-fighter/db/client";
import { auditLog } from "@bill-fighter/db/schema";
import { asc, eq } from "drizzle-orm";
import type { Audit } from "../types.ts";

export function createAudit(db: Db): Audit {
  return {
    async record({ runId, agent, tool, input, output, costUsd }) {
      await db.insert(auditLog).values({ runId, agent, tool, inputJson: input, outputJson: output, costUsd });
    },

    list: (runId) =>
      db.select().from(auditLog).where(eq(auditLog.runId, runId)).orderBy(asc(auditLog.createdAt), asc(auditLog.id)),
  };
}

export default createAudit(sharedDb);
