import { decideApproval } from "@bill-fighter/db/approvals";
import { withTestDb } from "@bill-fighter/db/test-db";
import { describe, expect, it } from "vitest";
import { liveSnapshot } from "./snapshot.ts";
import { assertNotSharedDb, insertSampleRun, SAMPLE_RUN_ID } from "./sample-data.ts";

describe("insertSampleRun", () => {
  it("gives every panel something to draw", async () => {
    await withTestDb("sample_full", async (db) => {
      await insertSampleRun(db);
      const snapshot = await liveSnapshot(db);
      expect(snapshot.run?.id).toBe(SAMPLE_RUN_ID);
      expect(snapshot.customer?.name).toBe("Golden Gate Noodle Co.");
      expect(snapshot.approval?.status).toBe("pending");
      for (const list of [snapshot.boardCards, snapshot.findings, snapshot.actions, snapshot.calls, snapshot.ledger, snapshot.sms, snapshot.auditLog]) {
        expect(list.length).toBeGreaterThan(0);
      }
      // The header's run cost and the audit rows agree.
      const auditCost = snapshot.auditLog.reduce((sum, row) => sum + row.costUsd, 0);
      expect(auditCost).toBeCloseTo(snapshot.run!.costUsd, 6);
    });
  });

  it("puts the same run back when run twice, with the approval pending again", async () => {
    await withTestDb("sample_twice", async (db) => {
      await insertSampleRun(db);
      await decideApproval(db, { runId: SAMPLE_RUN_ID, status: "approved", channel: "dashboard", approvedBy: "Owner" });
      expect((await liveSnapshot(db)).humanActions).toBe(1);

      await insertSampleRun(db);
      const snapshot = await liveSnapshot(db);
      expect(snapshot.humanActions).toBe(0);
      expect(snapshot.approval?.status).toBe("pending");
      // Meter, rate, seven unused lines and one alarm line.
      expect(snapshot.findings).toHaveLength(10);
    });
  });
});

describe("assertNotSharedDb", () => {
  it("refuses the shared database and allows any other", () => {
    expect(() => assertNotSharedDb("postgres://bill:bill@localhost:5433/billfighter")).toThrow(/Refusing/);
    expect(() => assertNotSharedDb("postgres://bill:bill@localhost:5433/billfighter_dashboard_shell")).not.toThrow();
  });
});
