import { decideApproval } from "@bill-fighter/db/approvals";
import { actions, approvals, auditLog, boardCards, findings, runs } from "@bill-fighter/db/schema";
import { seedRun, withTestDb } from "@bill-fighter/db/test-db";
import { eq } from "drizzle-orm";
import { describe, expect, it } from "vitest";
import { AUDIT_ROW_LIMIT, liveSnapshot } from "./snapshot.ts";

const bundle = (runId: string) => ({ runId, actionIds: [], summary: "Approve the fixes" });
const LONG_AGO = new Date("2026-01-01T00:00:00Z");

describe("liveSnapshot", () => {
  it("is empty, not an error, before any run", async () => {
    await withTestDb("dash_empty", async (db) => {
      const snapshot = await liveSnapshot(db);
      expect(snapshot.run).toBeNull();
      expect(snapshot.customer).toBeNull();
      expect(snapshot.humanActions).toBe(0);
      expect(snapshot.boardCards).toEqual([]);
    });
  });

  it("shows the latest run and keeps an older run's rows out", async () => {
    await withTestDb("dash_latest", async (db) => {
      await seedRun(db, "old");
      await db.update(runs).set({ startedAt: LONG_AGO }).where(eq(runs.id, "old"));
      await seedRun(db, "new");
      await db.insert(boardCards).values({ id: "old-card", runId: "old", agent: "Intake", title: "Old card" });
      await db.insert(auditLog).values({ runId: "old", agent: "Intake", tool: "old_tool" });
      const snapshot = await liveSnapshot(db);
      expect(snapshot.run?.id).toBe("new");
      expect(snapshot.customer?.id).toBe("customer-new");
      expect(snapshot.boardCards).toEqual([]);
      expect(snapshot.auditTotal).toBe(0);
    });
  });

  it("counts one human action however many channels approve", async () => {
    await withTestDb("dash_human", async (db) => {
      await seedRun(db, "r1");
      await db.insert(approvals).values(bundle("r1"));
      expect((await liveSnapshot(db)).humanActions).toBe(0);

      await decideApproval(db, { runId: "r1", status: "approved", channel: "dashboard", approvedBy: "Owner" });
      await decideApproval(db, { runId: "r1", status: "approved", channel: "sms", approvedBy: "Owner" });
      const snapshot = await liveSnapshot(db);
      expect(snapshot.humanActions).toBe(1);
      expect(snapshot.approval?.channel).toBe("dashboard");
    });
  });

  it("does not count a denied bundle", async () => {
    await withTestDb("dash_denied", async (db) => {
      await seedRun(db, "r1");
      await db.insert(approvals).values(bundle("r1"));
      await decideApproval(db, { runId: "r1", status: "denied", channel: "dashboard", approvedBy: "Owner" });
      expect((await liveSnapshot(db)).humanActions).toBe(0);
    });
  });

  it("counts the current run only, not an approval on an earlier run", async () => {
    await withTestDb("dash_scope", async (db) => {
      await seedRun(db, "old");
      await db.update(runs).set({ startedAt: LONG_AGO }).where(eq(runs.id, "old"));
      await db.insert(approvals).values(bundle("old"));
      await decideApproval(db, { runId: "old", status: "approved", channel: "dashboard", approvedBy: "Owner" });
      await seedRun(db, "new");
      expect((await liveSnapshot(db)).humanActions).toBe(0);
    });
  });

  it("never sends audit input or output, and caps the rows while counting them all", async () => {
    await withTestDb("dash_audit", async (db) => {
      await seedRun(db, "r1");
      const total = AUDIT_ROW_LIMIT + 50;
      await db.insert(auditLog).values(
        Array.from({ length: total }, (_, i) => ({
          runId: "r1",
          agent: "Collector",
          tool: `tool_${i}`,
          inputJson: { password: "from-the-vault" },
          outputJson: { password: "from-the-vault" },
        })),
      );
      const snapshot = await liveSnapshot(db);
      expect(snapshot.auditLog).toHaveLength(AUDIT_ROW_LIMIT);
      expect(snapshot.auditTotal).toBe(total);
      expect(JSON.stringify(snapshot)).not.toContain("from-the-vault");
    });
  });

  it("reaches a bundled action that belongs to no finding", async () => {
    await withTestDb("dash_actions", async (db) => {
      const { customerId } = await seedRun(db, "r1");
      await db.insert(findings).values({
        id: "f1",
        customerId,
        type: "unusedLines",
        title: "Unused lines",
        explanation: "No calls in 12 months",
        evidenceJson: {},
        confidence: 0.9,
      });
      await db.insert(actions).values([
        { id: "on-finding", findingId: "f1", kind: "cancel", status: "proposed" },
        { id: "invoice", kind: "invoice", status: "proposed" },
        { id: "unrelated", kind: "card_pay", status: "proposed" },
      ]);
      await db.insert(approvals).values({ ...bundle("r1"), actionIds: ["invoice"] });
      expect((await liveSnapshot(db)).actions.map((a) => a.id)).toEqual(["invoice", "on-finding"]);
    });
  });
});
