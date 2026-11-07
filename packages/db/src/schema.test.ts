import { fileURLToPath } from "node:url";
import { getTableName, is } from "drizzle-orm";
import { migrate } from "drizzle-orm/node-postgres/migrator";
import { PgTable } from "drizzle-orm/pg-core";
import { Client } from "pg";
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { createDb, databaseUrl } from "./client.ts";
import * as schema from "./schema.ts";

// Per process, because every worktree shares one Postgres and may run this at the same time.
const TEST_DB = `billfighter_test_db_schema_${process.pid}`;
const migrationsFolder = fileURLToPath(new URL("../migrations", import.meta.url));

const urlFor = (database: string) => {
  const url = new URL(databaseUrl());
  url.pathname = `/${database}`;
  return url.toString();
};

const withAdmin = async (fn: (admin: Client) => Promise<unknown>) => {
  const admin = new Client({ connectionString: urlFor("postgres") });
  try {
    await admin.connect();
  } catch (cause) {
    throw new Error("Cannot reach Postgres. Run `docker compose up -d --wait` first.", { cause });
  }
  try {
    await fn(admin);
  } finally {
    await admin.end();
  }
};

let db: ReturnType<typeof createDb>;

const rows = (result: { rows: unknown[] }) => result.rows as Record<string, string>[];
const uniqueViolation = { cause: { code: "23505" } };

beforeAll(async () => {
  await withAdmin(async (admin) => {
    await admin.query(`DROP DATABASE IF EXISTS ${TEST_DB} WITH (FORCE)`);
    await admin.query(`CREATE DATABASE ${TEST_DB}`);
  });
  db = createDb(urlFor(TEST_DB));
  await migrate(db, { migrationsFolder });
});

afterAll(async () => {
  await db?.$client.end();
  await withAdmin((admin) => admin.query(`DROP DATABASE IF EXISTS ${TEST_DB} WITH (FORCE)`));
});

const at = new Date("2026-01-15T12:00:00.000Z");
const seedRows: [PgTable, Record<string, unknown>][] = [
  [schema.customers, { id: "cust", name: "Test Noodle Co", contactName: "Test Owner", contactEmail: "o@billfighter.local", contactPhone: "+15550001111" }],
  [schema.locations, { id: "loc", customerId: "cust", name: "Store 1", address: "1 Test St", city: "Oakland" }],
  [schema.accounts, { id: "acct", locationId: "loc", provider: "bayhearth", accountNumber: "A-1", serviceType: "gas", rateSchedule: "G-1", meterNumber: "M-1" }],
  [schema.authorizations, { id: "auth", customerId: "cust", provider: "bayhearth", formType: "79-1095", scope: "billing", signedBy: "Test Owner", signedAt: at, expiresAt: at, pdfPath: "a.pdf" }],
  [schema.bills, { id: "bill", accountId: "acct", periodStart: "2026-01-01", periodEnd: "2026-01-31", totalCents: 180_000, pdfPath: "b.pdf", parsedJson: { total: 180_000 }, parseConfidence: 0.975 }],
  [schema.billLines, { id: "line", billId: "bill", description: "Energy", quantity: 1234.5, unit: "kWh", rate: 0.38212, amountCents: 47_173, lineType: "energy" }],
  [schema.usageIntervals, { accountId: "acct", ts: at, kwh: 1.234567 }],
  [schema.phoneLines, { id: "phone", accountId: "acct", number: "+15550002222", label: "Fax", monthlyCents: 6000, callsLast12mo: 0, purpose: "fax" }],
  [schema.findings, { id: "find", customerId: "cust", accountId: "acct", type: "meterMultiplierJump", title: "Meter", explanation: "Doubled", evidenceJson: { billIds: ["bill"] }, refundCents: 1_260_000, annualSavingsCents: 1_080_000, confidence: 0.95, status: "filed" }],
  [schema.actions, { id: "act", findingId: "find", kind: "card_pay", payloadJson: { a: 1 }, status: "queued", requiresApproval: true }],
  [schema.runs, { id: "run", customerId: "cust", platform: "local", trigger: "email", dedupeKey: "msg-1", startedAt: at, finishedAt: at, status: "running", costUsd: 1.234567 }],
  [schema.approvals, { id: "appr", runId: "run", actionIds: ["act"], summary: "One bundle", status: "approved", channel: "dashboard", approvedBy: "Test Owner", approvedAt: at }],
  [schema.calls, { id: "call", actionId: "act", mode: "sim", toNumber: "+15550003333", startedAt: at, endedAt: at, recordingUrl: "r.mp3", transcriptJson: [{ line: "hi" }], outcomeJson: { ticket: "T1" } }],
  [schema.ledger, { id: "ledg", customerId: "cust", findingId: "find", kind: "refund", amountCents: 1_260_000, externalId: "x", createdAt: at }],
  [schema.boardCards, { id: "card", runId: "run", agent: "ceo", title: "Start", status: "doing", updatedAt: at }],
  [schema.auditLog, { id: "audit", runId: "run", agent: "ceo", tool: "get_customer", inputJson: { a: 1 }, outputJson: { b: 2 }, costUsd: 0.000123, createdAt: at }],
  [schema.smsMessages, { id: "sms", direction: "outbound", to: "+15550001111", from: "+15550004444", body: "YES?", createdAt: at }],
  [schema.scheduledChecks, { id: "check", customerId: "cust", runAt: at, status: "scheduled", createdAt: at }],
];

describe("db schema", () => {
  it("re-applies migrations with no change", async () => {
    const count = async () => rows(await db.$client.query("SELECT count(*) FROM drizzle.__drizzle_migrations"))[0]?.count;
    const before = await count();
    expect(Number(before)).toBeGreaterThan(0);
    await migrate(db, { migrationsFolder });
    expect(await count()).toBe(before);
  });

  it("inserts and reads one row per table, covering every table", async () => {
    const allTables = Object.values(schema).filter((v) => is(v, PgTable)).map((t) => getTableName(t));
    expect(seedRows.map(([t]) => getTableName(t)).sort()).toEqual(allTables.sort());
    expect(allTables).toHaveLength(18);

    for (const [table, row] of seedRows) {
      await db.insert(table).values(row);
      expect(await db.select().from(table)).toEqual([expect.objectContaining(row)]);
    }
  });

  it("keeps money in integer cents with only the agreed exceptions", async () => {
    const columns = rows(
      await db.$client.query(
        "SELECT table_name, column_name, data_type FROM information_schema.columns WHERE table_schema = 'public'",
      ),
    );
    const cents = columns.filter((c) => c.column_name?.endsWith("_cents"));
    expect(cents.length).toBe(6);
    expect(cents.filter((c) => c.data_type !== "integer")).toEqual([]);

    const numeric = columns.filter((c) => c.data_type === "numeric").map((c) => `${c.table_name}.${c.column_name}`);
    expect(numeric.sort()).toEqual(
      [
        "audit_log.cost_usd",
        "bill_lines.quantity",
        "bill_lines.rate",
        "bills.parse_confidence",
        "findings.confidence",
        "runs.cost_usd",
        "usage_intervals.kwh",
      ].sort(),
    );
    expect(columns.filter((c) => c.data_type?.includes("double") || c.data_type === "real")).toEqual([]);

    const ids = columns.filter((c) => c.column_name === "id" || c.column_name?.endsWith("_id"));
    expect(ids.filter((c) => c.data_type !== "text")).toEqual([]);
  });

  it("generates an id and fails closed on approval when none are passed", async () => {
    const [action] = await db.insert(schema.actions).values({ kind: "call", status: "queued" }).returning();
    expect(action?.id).toEqual(expect.any(String));
    expect(action?.requiresApproval).toBe(true);
    expect(action?.findingId).toBeNull();
  });

  it("has the exact provider values", async () => {
    const labels = rows(
      await db.$client.query(
        "SELECT enumlabel FROM pg_enum e JOIN pg_type t ON e.enumtypid = t.oid WHERE t.typname = 'provider' ORDER BY e.enumsortorder",
      ),
    ).map((r) => r.enumlabel);
    expect(labels).toEqual(["baycurrent", "baytel", "bayconnect", "bayhearth"]);
  });

  it("rejects duplicates the later lanes rely on", async () => {
    await expect(
      db.insert(schema.runs).values({ customerId: "cust", platform: "local", trigger: "email", dedupeKey: "msg-1", status: "running" }),
    ).rejects.toMatchObject(uniqueViolation);
    await expect(
      db.insert(schema.approvals).values({ runId: "run", actionIds: [], summary: "second" }),
    ).rejects.toMatchObject(uniqueViolation);
    await expect(
      db.insert(schema.ledger).values({ customerId: "cust", findingId: "find", kind: "refund", amountCents: 1 }),
    ).rejects.toMatchObject(uniqueViolation);
    await expect(
      db.insert(schema.scheduledChecks).values({ customerId: "cust", runAt: at, status: "scheduled" }),
    ).rejects.toMatchObject(uniqueViolation);
  });

  it("allows many ledger rows with no finding and many runs with no dedupe key", async () => {
    const spend = { customerId: "cust", kind: "card_spend", amountCents: 500 } as const;
    await db.insert(schema.ledger).values([spend, spend]);
    const run = { customerId: "cust", platform: "local", trigger: "manual", status: "running" } as const;
    await db.insert(schema.runs).values([run, run]);
  });
});
