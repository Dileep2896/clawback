import { fileURLToPath } from "node:url";
import { eq } from "drizzle-orm";
import { migrate } from "drizzle-orm/node-postgres/migrator";
import { Client } from "pg";
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { createDb, databaseUrl } from "../client.ts";
import * as schema from "../schema.ts";
import { billPdfPath } from "./bill-pdf.ts";
import { METER_SWAP } from "./customer.ts";
import { generateSeed, type Seed } from "./generate.ts";
import { loadSeed } from "./load.ts";

// Per process, because every worktree shares one Postgres and may run this at the same time.
const TEST_DB = `billfighter_test_seed_loader_${process.pid}`;
const migrationsFolder = fileURLToPath(new URL("../../migrations", import.meta.url));
const SEEDED_TABLES = ["customers", "authorizations", "locations", "accounts", "bills", "bill_lines", "phone_lines", "usage_intervals"];
const LOAD_TIMEOUT = 120_000;

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
let seed: Seed;

const query = async <T>(text: string) => (await db.$client.query(text)).rows as T[];

// Every seeded table's row count and a hash of its full contents.
const snapshot = async () => {
  const result: Record<string, unknown> = {};
  for (const table of SEEDED_TABLES) {
    result[table] = (await query(`SELECT count(*)::int AS n, md5(string_agg(t::text, '|' ORDER BY t::text)) AS hash FROM ${table} t`))[0];
  }
  return result;
};

beforeAll(async () => {
  await withAdmin(async (admin) => {
    await admin.query(`DROP DATABASE IF EXISTS ${TEST_DB} WITH (FORCE)`);
    await admin.query(`CREATE DATABASE ${TEST_DB}`);
  });
  db = createDb(urlFor(TEST_DB));
  await migrate(db, { migrationsFolder });
  seed = generateSeed();
  await loadSeed(db, seed);
}, LOAD_TIMEOUT);

afterAll(async () => {
  await db?.$client.end();
  await withAdmin((admin) => admin.query(`DROP DATABASE IF EXISTS ${TEST_DB} WITH (FORCE)`));
});

describe("loadSeed", () => {
  it("loads exactly the planned counts", async () => {
    const counts = await snapshot();
    expect(counts).toMatchObject({
      customers: { n: 1 },
      authorizations: { n: 4 },
      locations: { n: 12 },
      accounts: { n: 37 },
      bills: { n: 448 },
      bill_lines: { n: 940 },
      phone_lines: { n: 21 },
      usage_intervals: { n: 432_288 },
    });
  });

  it("gives identical rows when run twice", async () => {
    const before = await snapshot();
    await loadSeed(db, seed);
    expect(await snapshot()).toEqual(before);
  }, LOAD_TIMEOUT);

  it("points every bill at its PDF", async () => {
    const rows = await db.select({ id: schema.bills.id, pdfPath: schema.bills.pdfPath }).from(schema.bills);
    expect(rows).toHaveLength(448);
    for (const row of rows) expect(row.pdfPath).toBe(billPdfPath({ id: row.id }));
  });

  it("has one signed authorization per provider, with the agreed scopes", async () => {
    const rows = await db.select().from(schema.authorizations);
    expect(rows.map((row) => row.provider).sort()).toEqual(["baycurrent", "bayconnect", "bayhearth", "baytel"].sort());
    for (const row of rows) {
      expect(row).toMatchObject({
        customerId: seed.customer.id,
        formType: "79-1095",
        signedBy: "Linda Park",
        signedAt: new Date("2026-11-02T17:00:00.000Z"),
        expiresAt: new Date("2029-11-02T17:00:00.000Z"),
        pdfPath: null,
      });
      expect(row.scope).toContain("Bill Fighter");
      expect(row.scope.includes("cancel unused lines")).toBe(row.provider === "baytel");
      expect(row.scope.includes("rate changes")).toBe(row.provider !== "bayhearth");
    }
  });

  it("keeps Fremont #1's billed kWh at exactly twice the metered kWh after the swap", async () => {
    const rows = await query<{ billed: string; metered: string }>(`
      SELECT
        (SELECT sum(quantity) FROM bill_lines l WHERE l.bill_id = b.id AND l.line_type = 'energy') AS billed,
        (SELECT sum(kwh) FROM usage_intervals u
          WHERE u.account_id = b.account_id
          AND (u.ts AT TIME ZONE 'America/Los_Angeles')::date BETWEEN b.period_start AND b.period_end) AS metered
      FROM bills b
      WHERE b.account_id = '${METER_SWAP.storeId}-electric' AND b.period_start >= '${METER_SWAP.swapMonth}-01'`);
    expect(rows).toHaveLength(14);
    for (const row of rows) expect(Number(row.billed)).toBeCloseTo(2 * Number(row.metered), 2);
  });

  it("keeps parsed bills and run activity across a re-seed", async () => {
    const billId = seed.bills[0]!.id;
    await db.update(schema.bills).set({ parsedJson: { total: 1 }, parseConfidence: 0.9 }).where(eq(schema.bills.id, billId));
    await db.insert(schema.findings).values({
      id: "kept-finding",
      customerId: seed.customer.id,
      accountId: seed.accounts[0]!.id,
      type: "test",
      title: "Kept",
      explanation: "Kept",
      evidenceJson: {},
      confidence: 0.5,
    });
    await db.insert(schema.runs).values({ id: "kept-run", customerId: seed.customer.id, platform: "local", trigger: "manual", status: "done" });

    await loadSeed(db, seed);

    const [bill] = await db.select().from(schema.bills).where(eq(schema.bills.id, billId));
    expect(bill).toMatchObject({ parsedJson: { total: 1 }, parseConfidence: 0.9 });
    expect(await db.select().from(schema.findings).where(eq(schema.findings.id, "kept-finding"))).toHaveLength(1);
    expect(await db.select().from(schema.runs).where(eq(schema.runs.id, "kept-run"))).toHaveLength(1);

    await db.delete(schema.findings).where(eq(schema.findings.id, "kept-finding"));
    await db.delete(schema.runs).where(eq(schema.runs.id, "kept-run"));
    await db.update(schema.bills).set({ parsedJson: null, parseConfidence: null }).where(eq(schema.bills.id, billId));
  }, LOAD_TIMEOUT);

  const plantStaleRows = async () => {
    await db.insert(schema.locations).values({ id: "stale-loc", customerId: seed.customer.id, name: "Old", address: "1 Old St", city: "Oakland" });
    await db.insert(schema.accounts).values({ id: "stale-acct", locationId: "stale-loc", provider: "baytel", accountNumber: "OLD", serviceType: "telecom" });
    await db.insert(schema.bills).values({ id: "stale-bill", accountId: "stale-acct", periodStart: "2026-01-01", periodEnd: "2026-01-31", totalCents: 1 });
    await db.insert(schema.billLines).values({ billId: "stale-bill", description: "Old", amountCents: 1 });
    await db.insert(schema.phoneLines).values({ accountId: "stale-acct", number: "+15550009999", monthlyCents: 1, callsLast12mo: 0 });
    await db.insert(schema.usageIntervals).values({ accountId: "stale-acct", ts: new Date("2026-01-01T00:00:00Z"), kwh: 1 });
  };

  it("removes rows the fixtures no longer have, and leaves another customer alone", async () => {
    const before = await snapshot();
    await db.insert(schema.customers).values({ id: "other", name: "Other", contactName: "O", contactEmail: "o@example.test", contactPhone: "1" });
    await db.insert(schema.locations).values({ id: "other-loc", customerId: "other", name: "Other", address: "2 St", city: "Oakland" });
    await plantStaleRows();

    await loadSeed(db, seed);

    expect(await db.select().from(schema.locations).where(eq(schema.locations.id, "stale-loc"))).toEqual([]);
    expect(await db.select().from(schema.locations).where(eq(schema.locations.id, "other-loc"))).toHaveLength(1);

    await db.delete(schema.locations).where(eq(schema.locations.id, "other-loc"));
    await db.delete(schema.customers).where(eq(schema.customers.id, "other"));
    expect(await snapshot()).toEqual(before);
  }, LOAD_TIMEOUT);

  it("fails and changes nothing when a finding still references a stale account", async () => {
    const before = await snapshot();
    await plantStaleRows();
    await db.insert(schema.findings).values({
      id: "blocking-finding",
      customerId: seed.customer.id,
      accountId: "stale-acct",
      type: "test",
      title: "Blocks",
      explanation: "Blocks",
      evidenceJson: {},
      confidence: 0.5,
    });
    await db.update(schema.customers).set({ name: "Changed" }).where(eq(schema.customers.id, seed.customer.id));

    await expect(loadSeed(db, seed)).rejects.toThrow();

    const [customer] = await db.select().from(schema.customers).where(eq(schema.customers.id, seed.customer.id));
    expect(customer?.name).toBe("Changed");
    expect(await db.select().from(schema.usageIntervals).where(eq(schema.usageIntervals.accountId, "stale-acct"))).toHaveLength(1);

    await db.delete(schema.findings).where(eq(schema.findings.id, "blocking-finding"));
    await loadSeed(db, seed);
    expect(await snapshot()).toEqual(before);
  }, LOAD_TIMEOUT);
});
