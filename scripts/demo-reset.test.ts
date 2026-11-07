import { existsSync, mkdirSync, mkdtempSync, rmSync } from "node:fs";
import { createServer } from "node:http";
import type { AddressInfo } from "node:net";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { createAuditorTools } from "@bill-fighter/agents/tools/auditor";
import { databaseUrl, type Db } from "@bill-fighter/db/client";
import {
  accounts,
  actions,
  approvals,
  auditLog,
  authorizations,
  billLines,
  bills,
  boardCards,
  calls,
  customers,
  findings,
  ledger,
  locations,
  phoneLines,
  runs,
  scheduledChecks,
  smsMessages,
  usageIntervals,
  users,
} from "@bill-fighter/db/schema";
import { seedRun, withTestDb } from "@bill-fighter/db/test-db";
import { createAudit } from "@bill-fighter/platform/local/audit";
import { createMail } from "@bill-fighter/platform/local/mail";
import { BILL_ACCOUNT_NUMBER, billEmail } from "@bill-fighter/webhooks/bill-email";
import { handleInbound } from "@bill-fighter/webhooks/inbound";
import { afterAll, beforeEach, describe, expect, it, vi } from "vitest";
import { demoReset, type ResetOptions } from "./demo-reset.ts";

// Each test migrates a fresh database on the Postgres every worktree shares, which is slow under load.
vi.setConfig({ testTimeout: 60_000 });

const DB_NAME = "demo_reset";
const RUN = "old-run";
const CUSTOMER = `customer-${RUN}`;
const ACCOUNT = "acct";
const PARSED = { kept: "byte for byte", nested: { amount: 1234 } };
const FROZEN = "the audit is frozen while approved work is in progress";

const root = mkdtempSync(join(tmpdir(), "demo-reset-test-"));
afterAll(() => rmSync(root, { recursive: true, force: true }));

beforeEach(() => {
  vi.spyOn(console, "warn").mockImplementation(() => {});
});

/** A stand-in, because the real Mailpit is one inbox shared with every other lane's tests. */
async function withMailpit<T>(status: number, fn: (api: string, requests: string[]) => Promise<T>) {
  const requests: string[] = [];
  const server = createServer((request, response) => {
    requests.push(`${request.method} ${request.url}`);
    response.statusCode = status;
    response.end();
  });
  await new Promise<void>((resolve) => server.listen(0, "127.0.0.1", resolve));
  try {
    return await fn(`http://127.0.0.1:${(server.address() as AddressInfo).port}`, requests);
  } finally {
    server.close();
  }
}

/** The URL of the database this pool really is on. */
async function ownUrl(db: Db) {
  const { rows } = await db.$client.query<{ name: string }>("select current_database() as name");
  const url = new URL(databaseUrl());
  url.pathname = `/${rows[0]!.name}`;
  return url;
}

async function options(db: Db, mailpitApi: string, runsDir: string, overrides: Partial<ResetOptions> = {}): Promise<ResetOptions> {
  return { pool: db.$client, url: (await ownUrl(db)).toString(), mailpitApi, runsDir, allowNonlocal: false, ...overrides };
}

const runDirs = () => {
  const runsDir = mkdtempSync(join(root, "runs-"));
  mkdirSync(join(runsDir, RUN, "bills"), { recursive: true });
  mkdirSync(join(runsDir, "another-lanes-run"));
  return runsDir;
};

async function seedAccount(db: Db) {
  await seedRun(db, RUN);
  await db.insert(locations).values({ id: "loc", customerId: CUSTOMER, name: "Store", address: "1 Main St", city: "Oakland" });
  await db.insert(accounts).values({ id: ACCOUNT, locationId: "loc", provider: "baytel", accountNumber: BILL_ACCOUNT_NUMBER, serviceType: "telecom" });
}

async function seedKeepRows(db: Db) {
  await db.insert(authorizations).values({ id: "auth", customerId: CUSTOMER, provider: "baytel", formType: "loa", scope: "all", signedBy: "Owner", signedAt: new Date() });
  await db.insert(bills).values({ id: "bill", accountId: ACCOUNT, periodStart: "2025-08-01", periodEnd: "2025-08-31", totalCents: 100, parsedJson: PARSED });
  await db.insert(billLines).values({ id: "line", billId: "bill", description: "Service", amountCents: 100 });
  await db.insert(usageIntervals).values({ accountId: ACCOUNT, ts: new Date("2025-08-01T00:00:00Z"), kwh: 1.5 });
  await db.insert(phoneLines).values({ id: "phone", accountId: ACCOUNT, number: "(510) 555-0142", monthlyCents: 6000, callsLast12mo: 0 });
}

/** One row in every table a run writes, parked on a pending approval as a killed run leaves it. */
async function seedRunRows(db: Db) {
  await db.insert(findings).values({ id: "finding", customerId: CUSTOMER, accountId: ACCOUNT, type: "unusedLines", title: "t", explanation: "e", evidenceJson: {}, confidence: 0.9 });
  await db.insert(actions).values({ id: "action", findingId: "finding", kind: "call", status: "pending" });
  await db.insert(approvals).values({ id: "approval", runId: RUN, actionIds: ["action"], summary: "Please approve.", status: "pending" });
  await db.insert(calls).values({ id: "call", actionId: "action", mode: "sim", toNumber: "+15550002222" });
  await db.insert(ledger).values({ id: "entry", customerId: CUSTOMER, findingId: "finding", kind: "refund", amountCents: 100 });
  await db.insert(boardCards).values({ id: "card", runId: RUN, agent: "ceo", title: "t" });
  await db.insert(auditLog).values({ id: "audit", runId: RUN, agent: "ceo", tool: "board_update" });
  await db.insert(smsMessages).values({ id: "sms", direction: "outbound", to: "+15550001111", from: "+15550002222", body: "b" });
  await db.insert(scheduledChecks).values({ id: "check", customerId: CUSTOMER, runAt: new Date(), status: "pending" });
}

const runRowCounts = async (db: Db) => ({
  runs: (await db.select().from(runs)).length,
  findings: (await db.select().from(findings)).length,
  actions: (await db.select().from(actions)).length,
  approvals: (await db.select().from(approvals)).length,
  calls: (await db.select().from(calls)).length,
  ledger: (await db.select().from(ledger)).length,
  boardCards: (await db.select().from(boardCards)).length,
  auditLog: (await db.select().from(auditLog)).length,
  smsMessages: (await db.select().from(smsMessages)).length,
  scheduledChecks: (await db.select().from(scheduledChecks)).length,
});
const ONE_OF_EACH = { runs: 1, findings: 1, actions: 1, approvals: 1, calls: 1, ledger: 1, boardCards: 1, auditLog: 1, smsMessages: 1, scheduledChecks: 1 };
const NONE = { runs: 0, findings: 0, actions: 0, approvals: 0, calls: 0, ledger: 0, boardCards: 0, auditLog: 0, smsMessages: 0, scheduledChecks: 0 };

const keptRows = async (db: Db) => ({
  customers: await db.select().from(customers),
  locations: await db.select().from(locations),
  accounts: await db.select().from(accounts),
  authorizations: await db.select().from(authorizations),
  bills: await db.select().from(bills),
  billLines: await db.select().from(billLines),
  usage: await db.select().from(usageIntervals),
  phoneLines: await db.select().from(phoneLines),
});

async function withFullDb(fn: (db: Db, runsDir: string) => Promise<void>) {
  await withTestDb(DB_NAME, async (db) => {
    await seedAccount(db);
    await seedKeepRows(db);
    await seedRunRows(db);
    await fn(db, runDirs());
  });
}

describe("demoReset", () => {
  it("clears every run table, the inbox and the run's folder, and keeps every seed row exactly", () =>
    withFullDb(async (db, runsDir) => {
      const before = await keptRows(db);
      expect(await runRowCounts(db)).toEqual(ONE_OF_EACH);

      await withMailpit(200, async (api, requests) => {
        const result = await demoReset(await options(db, api, runsDir));
        expect(result).toMatchObject({ runs: 1, running: [RUN], seed: { customers: 1, bills: 1, parsed_bills: 1, usage_intervals: 1 } });
        expect(requests).toEqual(["DELETE /api/v1/messages"]);
      });

      expect(await runRowCounts(db)).toEqual(NONE);
      expect(await keptRows(db)).toEqual(before);
      expect(before.bills[0]!.parsedJson).toEqual(PARSED);
      expect(existsSync(join(runsDir, RUN))).toBe(false);
      expect(existsSync(join(runsDir, "another-lanes-run"))).toBe(true);
    }));

  it("clears the database with no Mailpit at all when told to leave mail alone", () =>
    withFullDb(async (db, runsDir) => {
      await demoReset({ ...(await options(db, "http://unused", runsDir)), mailpitApi: null });
      expect(await runRowCounts(db)).toEqual(NONE);
    }));

  it("warns about a run still marked running", () =>
    withFullDb(async (db, runsDir) => {
      await withMailpit(200, async (api) => demoReset(await options(db, api, runsDir)));
      expect(console.warn).toHaveBeenCalledWith(expect.stringContaining(RUN));
      expect(console.warn).toHaveBeenCalledWith(expect.stringContaining("pnpm dev:webhooks"));
    }));

  it("runs cleanly on a database that is already clear", () =>
    withFullDb(async (db, runsDir) => {
      await withMailpit(200, async (api) => {
        await demoReset(await options(db, api, runsDir));
        expect(await demoReset(await options(db, api, runsDir))).toMatchObject({ runs: 0, running: [] });
      });
      expect(console.warn).toHaveBeenCalledOnce();
    }));

  it("unfreezes run_audit after a killed run left a pending approval", () =>
    withTestDb(DB_NAME, async (db) => {
      await seedAccount(db);
      await db.insert(approvals).values({ id: "approval", runId: RUN, actionIds: [], summary: "Please approve.", status: "pending" });
      const audit = createAuditorTools({ db, root }).find((tool) => tool.name === "run_audit")!;
      const input = { customerId: CUSTOMER };
      await expect(audit.handler(input, { runId: RUN, agent: "test" })).rejects.toThrow(FROZEN);

      await withMailpit(200, async (api) => demoReset(await options(db, api, runDirs())));

      await db.insert(runs).values({ id: "new-run", customerId: CUSTOMER, platform: "local", trigger: "manual", status: "running" });
      await expect(audit.handler(input, { runId: "new-run", agent: "test" })).resolves.toMatchObject({ findings: [] });
    }));

  it("starts a run from an email the killed run had already claimed", () =>
    withTestDb(DB_NAME, async (db) => {
      await seedAccount(db);
      const deps = {
        db,
        mail: createMail({}),
        runtime: { run: async function* () { yield { type: "result", status: "success", costUsd: 0 } as const; } },
        audit: createAudit(db),
        tools: [],
      };
      const email = { messageId: "msg-1", ...billEmail("bills@billfighter.local") };
      await db.$client.query("update runs set dedupe_key = 'msg-1' where id = $1", [RUN]);
      expect(await handleInbound(email, deps)).toMatchObject({ status: 200, body: { duplicate: true } });

      await withMailpit(200, async (api) => demoReset(await options(db, api, runDirs())));

      const reply = await handleInbound(email, deps);
      expect(reply).toMatchObject({ status: 202, body: { duplicate: false } });
      await vi.waitFor(async () => expect((await db.select().from(runs))[0]?.finishedAt).toBeTruthy(), 30_000);
    }));

  describe("refuses, and clears nothing", () => {
    const refuses = (db: Db, runsDir: string, overrides: (url: URL) => Partial<ResetOptions>, message: RegExp) =>
      withMailpit(200, async (api, requests) => {
        const url = await ownUrl(db);
        await expect(demoReset(await options(db, api, runsDir, overrides(url)))).rejects.toThrow(message);
        expect(requests).toEqual([]);
        expect(await runRowCounts(db)).toEqual(ONE_OF_EACH);
        expect(existsSync(join(runsDir, RUN))).toBe(true);
      });
    const withHost = (url: URL, host: string) => {
      url.hostname = host;
      return url.toString();
    };

    it("a host that is not local", () =>
      withFullDb((db, runsDir) => refuses(db, runsDir, (url) => ({ url: withHost(url, "db.example.com") }), /not local/)));

    it("a local-looking URL whose ?host= points elsewhere", () =>
      withFullDb((db, runsDir) =>
        refuses(
          db,
          runsDir,
          (url) => {
            url.searchParams.set("host", "db.example.com");
            return { url: url.toString() };
          },
          /not local/,
        ),
      ));

    it.each([
      ["a remote last ?host=", "postgres://bill:bill@localhost:5433/billfighter?host=localhost&host=db.example.com"],
      ["an empty last ?host= over a remote URL", "postgres://bill:bill@db.example.com:5433/billfighter?host=localhost&host="],
      ["an encoded ?host= that a space makes pg ignore", "postgres://bill:bill@db.example.com:5433/billfighter?%68%6fst=localhost&application_name=demo reset"],
    ])("before connecting, the host pg would really use: %s", (_name, url) =>
      withFullDb(async (db, runsDir) => {
        const pool = { query: vi.fn(), connect: vi.fn() };
        await refuses(db, runsDir, () => ({ url, pool: pool as never }), /"db\.example\.com", which is not local/);
        expect(pool.query).not.toHaveBeenCalled();
        expect(pool.connect).not.toHaveBeenCalled();
      }),
    );

    it("a Mailpit that is not local, even with the database override", () =>
      withFullDb((db, runsDir) => refuses(db, runsDir, () => ({ mailpitApi: "http://mail.example.com:8025", allowNonlocal: true }), /not local Mailpit/)));

    it("a URL that names no database", () =>
      withFullDb((db, runsDir) =>
        refuses(
          db,
          runsDir,
          (url) => {
            url.pathname = "/";
            return { url: url.toString() };
          },
          /names no database/,
        ),
      ));

    it("a server on a different database from the URL, even with the override", () =>
      withFullDb((db, runsDir) =>
        refuses(
          db,
          runsDir,
          (url) => {
            url.pathname = "/billfighter";
            return { url: url.toString(), allowNonlocal: true };
          },
          /names "billfighter" but the server connected to/,
        ),
      ));

    it("a run id that could leave the runs folder", () =>
      withFullDb(async (db, runsDir) => {
        await db.insert(runs).values({ id: "../..", customerId: CUSTOMER, platform: "local", trigger: "manual", status: "error" });
        await withMailpit(200, async (api, requests) => {
          await expect(demoReset(await options(db, api, runsDir))).rejects.toThrow(/cannot name a folder/);
          expect(requests).toEqual([]);
        });
        expect((await db.select().from(runs)).length).toBe(2);
        expect(existsSync(join(runsDir, RUN))).toBe(true);
      }));
  });

  it("lets a non-local host through with the override", () =>
    withFullDb(async (db, runsDir) => {
      const url = await ownUrl(db);
      url.hostname = "db.example.com";
      await withMailpit(200, async (api) => demoReset(await options(db, api, runsDir, { url: url.toString(), allowNonlocal: true })));
      expect(await runRowCounts(db)).toEqual(NONE);
    }));

  it("leaves the database alone when Mailpit fails, and a second try finishes the job", () =>
    withFullDb(async (db, runsDir) => {
      await expect(demoReset(await options(db, "http://127.0.0.1:1", runsDir))).rejects.toThrow(/Cannot reach Mailpit/);
      await withMailpit(500, async (api) => {
        await expect(demoReset(await options(db, api, runsDir))).rejects.toThrow(/refused to clear its messages: 500/);
      });
      expect(await runRowCounts(db)).toEqual(ONE_OF_EACH);
      expect(existsSync(join(runsDir, RUN))).toBe(true);

      await withMailpit(200, async (api) => demoReset(await options(db, api, runsDir)));
      expect(await runRowCounts(db)).toEqual(NONE);
      expect(existsSync(join(runsDir, RUN))).toBe(false);
    }));

  it("rolls the tables back if another table comes to reference them, and leaves it unemptied", () =>
    withFullDb(async (db, runsDir) => {
      await db.$client.query("create table later_table (run_id text references runs(id))");
      await db.$client.query(`insert into later_table values ('${RUN}')`);
      await withMailpit(200, async (api) => {
        await expect(demoReset(await options(db, api, runsDir))).rejects.toThrow(/referenced in a foreign key constraint/);
      });
      expect(await runRowCounts(db)).toEqual(ONE_OF_EACH);
      expect((await db.$client.query("select * from later_table")).rows).toHaveLength(1);
    }));

  it("keeps every sign-up and its uploads when the reset fails, at any step", () =>
    withFullDb(async (db, runsDir) => {
      const signup = "signup-customer";
      await db.insert(customers).values({ id: signup, name: "Mission Dumplings", contactName: "Sam", contactEmail: "sam@example.com", contactPhone: "" });
      await db.insert(users).values({ name: "Sam", company: "Mission Dumplings", email: "sam@example.com", passwordHash: "x:y", customerId: signup, createdCustomer: true });
      await db.insert(locations).values({ id: "signup-loc", customerId: signup, name: "10 Valencia St", address: "10 Valencia St", city: "San Francisco" });
      await db.insert(accounts).values({ id: "signup-acct", locationId: "signup-loc", provider: "baycurrent", accountNumber: "BE-9001", serviceType: "electric" });
      await db.insert(bills).values({ id: "signup-bill", accountId: "signup-acct", periodStart: "2026-09-01", periodEnd: "2026-09-30", totalCents: 2000 });
      const uploadsDir = mkdtempSync(join(root, "uploads-"));
      mkdirSync(join(uploadsDir, signup));
      const signupRows = async () => [(await db.select().from(users)).length, (await db.select().from(customers)).length, (await db.select().from(bills)).length];
      const kept = await signupRows();

      // Mailpit down, the seed changing mid-reset, and a run id that cannot name a folder all fail after the sign-ups were found.
      await expect(demoReset({ ...(await options(db, "http://127.0.0.1:1", runsDir)), uploadsDir })).rejects.toThrow(/Cannot reach Mailpit/);
      await db.$client.query("create function lose_a_phone_line() returns trigger language plpgsql as $$ begin delete from phone_lines; return null; end $$");
      await db.$client.query("create trigger lose_a_phone_line before truncate on sms_messages execute function lose_a_phone_line()");
      await withMailpit(200, async (api) => {
        await expect(demoReset({ ...(await options(db, api, runsDir)), uploadsDir })).rejects.toThrow(/The seed changed during the reset/);
      });
      await db.$client.query("drop trigger lose_a_phone_line on sms_messages");
      await db.insert(runs).values({ id: "../escape", customerId: CUSTOMER, platform: "local", trigger: "email", status: "done" });
      await withMailpit(200, async (api) => {
        await expect(demoReset({ ...(await options(db, api, runsDir)), uploadsDir })).rejects.toThrow(/cannot name a folder/);
      });
      expect(await signupRows()).toEqual(kept);
      expect(existsSync(join(uploadsDir, signup))).toBe(true);

      await db.$client.query("delete from runs where id = '../escape'");
      await withMailpit(200, async (api) => expect(await demoReset({ ...(await options(db, api, runsDir)), uploadsDir })).toMatchObject({ signups: 1 }));
      expect(await signupRows()).toEqual([0, kept[1]! - 1, kept[2]! - 1]);
      expect(existsSync(join(uploadsDir, signup))).toBe(false);
    }));

  it("rolls the tables back if the seed changes during the reset", () =>
    withFullDb(async (db, runsDir) => {
      await db.$client.query("create function lose_a_phone_line() returns trigger language plpgsql as $$ begin delete from phone_lines; return null; end $$");
      await db.$client.query("create trigger lose_a_phone_line before truncate on sms_messages execute function lose_a_phone_line()");
      const before = await keptRows(db);
      await withMailpit(200, async (api) => {
        await expect(demoReset(await options(db, api, runsDir))).rejects.toThrow(/The seed changed during the reset/);
      });
      expect(await runRowCounts(db)).toEqual(ONE_OF_EACH);
      expect(await keptRows(db)).toEqual(before);
    }));
});
