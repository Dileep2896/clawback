import type { Db } from "@bill-fighter/db/client";
import { auditLog, runs, scheduledChecks } from "@bill-fighter/db/schema";
import { seedRun, withTestDb } from "@bill-fighter/db/test-db";
import { createAudit } from "@bill-fighter/platform/local/audit";
import { createScheduler } from "@bill-fighter/platform/local/scheduler";
import { eq } from "drizzle-orm";
import { describe, expect, it } from "vitest";
import { loadTools } from "../registry.ts";
import { run } from "../test-fixtures.ts";
import { wrapTool } from "../tool-wrapper.ts";
import { monitorTools, nextCheckAt } from "./monitor.ts";

const test = (name: string, fn: (db: Db) => Promise<void>) => it(name, () => withTestDb("monitor_check", fn));

const tools = (db: Db) => monitorTools({ db, scheduler: async () => createScheduler(db) });
const schedule = (db: Db, runId: string) => run(tools(db), "schedule_check", {}, runId) as Promise<{ checkId: string; runAt: string; status: string }>;

describe("nextCheckAt", () => {
  it.each([
    ["2026-11-06T12:00:00Z", "2026-12-01T16:00:00.000Z"],
    ["2027-01-31T23:59:00Z", "2027-02-01T16:00:00.000Z"],
    ["2026-12-15T00:00:00Z", "2027-01-01T16:00:00.000Z"],
    // A real firing on the 1st moves on a month, which is what keeps the monthly chain going.
    ["2026-12-01T16:00:00Z", "2027-01-01T16:00:00.000Z"],
  ])("from %s is %s", (from, expected) => {
    expect(nextCheckAt(new Date(from)).toISOString()).toBe(expected);
  });
});

describe("schedule_check", () => {
  test("schedules the run's customer for the 1st of next month, as a pending check", async (db) => {
    const { customerId } = await seedRun(db, "r1");
    await db.update(runs).set({ startedAt: new Date("2026-11-06T12:00:00Z") }).where(eq(runs.id, "r1"));

    expect(await schedule(db, "r1")).toMatchObject({ runAt: "2026-12-01T16:00:00.000Z", status: "pending" });
    expect(await db.select().from(scheduledChecks)).toMatchObject([{ customerId, status: "pending" }]);
  });

  test("finishing a run twice, or a second run in the month, leaves one check", async (db) => {
    const { customerId } = await seedRun(db, "r1");
    const startedAt = new Date("2026-11-06T12:00:00Z");
    await db.update(runs).set({ startedAt }).where(eq(runs.id, "r1"));
    await db.insert(runs).values({ id: "r2", customerId, platform: "local", trigger: "manual", status: "running", startedAt: new Date("2026-11-20T12:00:00Z") });

    const first = await schedule(db, "r1");
    expect(await schedule(db, "r1")).toEqual(first);
    expect(await schedule(db, "r2")).toEqual(first);
    expect(await db.select().from(scheduledChecks)).toHaveLength(1);
  });

  test("a repeat reports the real status of a check that has fired", async (db) => {
    await seedRun(db, "r1");
    const { checkId } = await schedule(db, "r1");
    await db.update(scheduledChecks).set({ status: "fired" }).where(eq(scheduledChecks.id, checkId));
    expect(await schedule(db, "r1")).toMatchObject({ checkId, status: "fired" });
  });

  test("gives each customer their own check", async (db) => {
    await seedRun(db, "r1");
    await seedRun(db, "r2");
    await schedule(db, "r1");
    await schedule(db, "r2");
    expect(new Set((await db.select().from(scheduledChecks)).map((check) => check.customerId))).toEqual(new Set(["customer-r1", "customer-r2"]));
  });

  test("refuses a customer picked by the model, and an unknown run", async (db) => {
    await seedRun(db, "r1");
    expect(() => run(tools(db), "schedule_check", { customerId: "someone-else" }, "r1")).toThrow(/customerId/);
    await expect(schedule(db, "nope")).rejects.toThrow(/does not exist/);
    expect(await db.select().from(scheduledChecks)).toEqual([]);
  });

  test("writes audit_log when run the way a run does", async (db) => {
    await seedRun(db, "r1");
    const wrapped = wrapTool(tools(db)[0]!, { audit: createAudit(db), allowlist: { callNumbers: [], emailDomains: [], portalOrigins: [] } });
    const output = await wrapped.handler({}, { runId: "r1", agent: "monitor" });

    expect(await db.select().from(auditLog)).toMatchObject([{ runId: "r1", agent: "monitor", tool: "schedule_check", outputJson: output }]);
  });
});

it("is found by the tool scan, so the Monitor is offered it", async () => {
  expect((await loadTools()).map((tool) => tool.name)).toContain("schedule_check");
});
