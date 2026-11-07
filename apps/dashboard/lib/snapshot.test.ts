import { decideApproval } from "@bill-fighter/db/approvals";
import { accounts, actions, approvals, auditLog, bills, boardCards, findings, locations, runs, scheduledChecks } from "@bill-fighter/db/schema";
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

  it("names the site of a finding by its account, and leaves out a finding with no account", async () => {
    await withTestDb("dash_sites", async (db) => {
      const { customerId } = await seedRun(db, "r1");
      await db.insert(locations).values({ id: "fremont-1", customerId, name: "Fremont #1", address: "1 Main St", city: "Fremont" });
      await db.insert(accounts).values([
        { id: "fremont-1-electric", locationId: "fremont-1", provider: "baycurrent", accountNumber: "1", serviceType: "electric" },
        { id: "fremont-1-gas", locationId: "fremont-1", provider: "bayhearth", accountNumber: "2", serviceType: "gas" },
      ]);
      const finding = { customerId, type: "meterMultiplierJump", title: "Meter", explanation: "Doubled", evidenceJson: {}, confidence: 0.9 };
      await db.insert(findings).values([
        { ...finding, id: "with-account", accountId: "fremont-1-electric" },
        { ...finding, id: "no-account" },
      ]);
      expect((await liveSnapshot(db)).findingSites).toEqual({ "fremont-1-electric": "Fremont #1" });
    });
  });

  it("shows the customer's scheduled checks in date order, and no other customer's", async () => {
    await withTestDb("dash_checks", async (db) => {
      await seedRun(db, "old");
      await db.update(runs).set({ startedAt: LONG_AGO }).where(eq(runs.id, "old"));
      const { customerId } = await seedRun(db, "new");
      await db.insert(scheduledChecks).values([
        { id: "later", customerId, runAt: new Date("2027-01-01T16:00:00Z"), status: "pending" },
        { id: "sooner", customerId, runAt: new Date("2026-12-01T16:00:00Z"), status: "fired" },
        { id: "not-theirs", customerId: "customer-old", runAt: new Date("2026-12-01T16:00:00Z"), status: "pending" },
      ]);
      expect((await liveSnapshot(db)).scheduledChecks.map((check) => check.id)).toEqual(["sooner", "later"]);
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

  it("lists the customer's bills with their site, and no other customer's", async () => {
    await withTestDb("dash_bills", async (db) => {
      await seedRun(db, "old");
      await db.update(runs).set({ startedAt: LONG_AGO }).where(eq(runs.id, "old"));
      const { customerId } = await seedRun(db, "new");
      await db.insert(locations).values([
        { id: "mine", customerId, name: "Fremont #1", address: "1 Main St", city: "Fremont" },
        { id: "theirs", customerId: "customer-old", name: "Elsewhere", address: "2 Main St", city: "Oakland" },
      ]);
      await db.insert(accounts).values([
        { id: "mine-electric", locationId: "mine", provider: "baycurrent", accountNumber: "1", serviceType: "electric" },
        { id: "theirs-electric", locationId: "theirs", provider: "baycurrent", accountNumber: "2", serviceType: "electric" },
      ]);
      const bill = { periodStart: "2026-01-01", periodEnd: "2026-01-31", totalCents: 12345, parsedJson: { raw: "not-sent-to-browser" } };
      await db.insert(bills).values([
        { ...bill, id: "mine-jan", accountId: "mine-electric" },
        { ...bill, id: "theirs-jan", accountId: "theirs-electric" },
      ]);
      const snapshot = await liveSnapshot(db);
      expect(snapshot.bills.map((b) => [b.id, b.locationId, b.site, b.totalCents])).toEqual([["mine-jan", "mine", "Fremont #1", 12345]]);
      expect(JSON.stringify(snapshot)).not.toContain("not-sent-to-browser");
    });
  });
});
