import { execFileSync } from "node:child_process";
import { existsSync, mkdirSync, mkdtempSync, readFileSync, rmSync } from "node:fs";
import { createServer } from "node:http";
import type { AddressInfo } from "node:net";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { setTimeout as sleep } from "node:timers/promises";
import { databaseUrl, type Db } from "@bill-fighter/db/client";
import { actions, approvals, auditLog, calls, customers, findings, ledger, runs, smsMessages } from "@bill-fighter/db/schema";
import { seedRun, withTestDb } from "@bill-fighter/db/test-db";
import { afterAll, beforeEach, describe, expect, it, vi } from "vitest";
import { capture, checkSpeed, diffRows, parseRecording, recordingProblems, replay, secretValues, type Recording, type ReplayEvent } from "./replay.ts";

vi.setConfig({ testTimeout: 60_000 });

const root = mkdtempSync(join(tmpdir(), "replay-test-"));
afterAll(() => rmSync(root, { recursive: true, force: true }));
beforeEach(() => {
  vi.spyOn(console, "warn").mockImplementation(() => {});
  vi.stubEnv("VOICE_MODE", "sim");
});

const RUN = "recorded-run";
const CUSTOMER = `customer-${RUN}`;
const RECORDED_AT = "2026-11-06T10:00:00.000Z";

async function ownUrl(db: Db) {
  const { rows } = await db.$client.query<{ name: string }>("select current_database() as name");
  const url = new URL(databaseUrl());
  url.pathname = `/${rows[0]!.name}`;
  return url.toString();
}

const seedCustomer = (db: Db) =>
  db.insert(customers).values({ id: CUSTOMER, name: "Test Noodle Co", contactName: "Test Owner", contactEmail: "o@billfighter.local", contactPhone: "+15550001111" });

// Raw SQL because scripts/ has no drizzle-orm of its own.
const finishRun = (db: Db, status: string) => db.$client.query("update runs set status = $1, finished_at = now() where id = $2", [status, RUN]);

const up = (t: number, table: string, row: Record<string, unknown>): ReplayEvent => ({ t, table, op: "upsert", id: row.id as string, row });

const runRow = (status: string, costUsd = 0) => ({ id: RUN, customer_id: CUSTOMER, platform: "local", trigger: "email", status, started_at: RECORDED_AT, cost_usd: costUsd, replay: null });
const finding = { id: "f1", customer_id: CUSTOMER, type: "unusedLines", title: "t", explanation: "e", evidence_json: {}, confidence: 0.9, status: "won", refund_cents: 0, annual_savings_cents: 100 };
const callRow = (rows: unknown[], endedAt: string | null) => ({ id: "c1", action_id: "a1", mode: "sim", to_number: "+15550002222", started_at: "2026-11-06T10:00:01.000Z", ended_at: endedAt, transcript_json: rows });

const recordingOf = (events: ReplayEvent[]): Recording => ({ recordedAt: RECORDED_AT, durationMs: events.at(-1)!.t, events });

// Children listed before parents within a tick, to prove the order is fixed on the way in.
const GOOD_EVENTS: ReplayEvent[] = [
  up(0, "actions", { id: "a1", finding_id: "f1", kind: "call", status: "proposed", requires_approval: true }),
  up(0, "findings", finding),
  up(0, "runs", runRow("running")),
  up(0, "audit_log", { id: "au1", run_id: RUN, agent: "ceo", tool: "board_update", cost_usd: 0.01, created_at: "2026-11-06T10:00:00.500Z" }),
  up(100, "approvals", { id: "ap1", run_id: RUN, action_ids: ["a1"], summary: "Approve", status: "approved", channel: "sms", approved_by: "Test Owner", approved_at: "2026-11-06T10:00:02.000Z" }),
  up(100, "sms_messages", { id: "s1", direction: "outbound", to: "+15550001111", from: "+15550002222", body: "Reply YES", created_at: "2026-11-06T10:00:01.500Z" }),
  up(200, "calls", callRow([{ role: "agent", kind: "speech", content: "Hi", at: RECORDED_AT }], null)),
  up(300, "calls", callRow([{ role: "agent", kind: "speech", content: "Hi", at: RECORDED_AT }, { role: "provider", kind: "speech", content: "Hello", at: RECORDED_AT }], "2026-11-06T10:02:44.000Z")),
  up(400, "ledger", { id: "l1", customer_id: CUSTOMER, finding_id: "f1", kind: "savings", amount_cents: 100, created_at: "2026-11-06T10:03:00.000Z" }),
  up(500, "runs", runRow("success", 0.42)),
];

const options = async (db: Db, recording: Recording, overrides = {}) => ({
  pool: db.$client,
  url: await ownUrl(db),
  runsDir: mkdtempSync(join(root, "runs-")),
  allowNonlocal: false,
  recording,
  speed: 1,
  force: false,
  ...overrides,
});

describe("diffRows", () => {
  const row = (id: string, status: string) => ({ tbl: "actions", id, row: { id, status } });

  it("finds inserts, updates and deletes, and nothing when nothing changed", () => {
    const first = diffRows(new Map(), [row("a", "proposed"), row("b", "proposed")], 0);
    expect(first.events.map(({ op, id }) => [op, id])).toEqual([["upsert", "a"], ["upsert", "b"]]);

    const same = diffRows(first.seen, [row("a", "proposed"), row("b", "proposed")], 1);
    expect(same.events).toEqual([]);

    const later = diffRows(same.seen, [row("a", "done")], 2);
    expect(later.events).toEqual([
      { t: 2, table: "actions", op: "upsert", id: "a", row: { id: "a", status: "done" } },
      { t: 2, table: "actions", op: "delete", id: "b" },
    ]);
  });

  it("keeps an id that holds a slash whole", () => {
    const first = diffRows(new Map(), [row("x/y", "proposed")], 0);
    expect(diffRows(first.seen, [], 1).events).toEqual([{ t: 1, table: "actions", op: "delete", id: "x/y" }]);
  });
});

describe("recordingProblems", () => {
  const good = recordingOf(GOOD_EVENTS);

  it("accepts a good recording", () => {
    expect(recordingProblems(good, [])).toEqual([]);
  });

  it.each([
    ["a run that did not succeed", up(600, "runs", runRow("error")), /not success/],
    ["a live call", up(600, "calls", { ...callRow([], null), mode: "live" }), /not sim/],
    ["a sim call that fell back from live", up(600, "calls", callRow([{ role: "system", kind: "fallback", content: "Live call failed" }], null)), /fell back/],
    ["a second run", up(600, "runs", { ...runRow("success"), id: "other" }), /one run/],
    ["a blocked board card", up(600, "board_cards", { id: "b1", run_id: RUN, agent: "monitor", title: "Schedule next month's check", status: "blocked" }), /ended blocked: Schedule next month's check/],
  ])("refuses %s", (_name, event, problem) => {
    expect(recordingProblems(recordingOf([...GOOD_EVENTS, event]), []).join()).toMatch(problem);
  });

  it("refuses a run with no approval", () => {
    expect(recordingProblems(recordingOf(GOOD_EVENTS.filter(({ table }) => table !== "approvals")), []).join()).toMatch(/one human action/);
  });

  it("refuses a recording holding a secret, without printing it", () => {
    const problems = recordingProblems(good, ["Reply YES"]).join();
    expect(problems).toMatch(/1 secrets/);
    expect(problems).not.toContain("Reply YES");
  });

  it.each([
    ["quotes", 'pa"ss'],
    ["backslashes", "pa\\ss"],
    ["newlines", "pa\nss"],
    ["all three", 'a"b\\c\nd'],
  ])("finds a secret holding %s, which JSON escapes", (_name, secret) => {
    const leaked = recordingOf([...GOOD_EVENTS, up(500, "sms_messages", { id: "s2", direction: "inbound", to: "x", from: "y", body: `code ${secret} end`, created_at: RECORDED_AT })]);
    expect(recordingProblems(leaked, [secret]).join()).toMatch(/1 secrets/);
  });

  it.each(["username", "password"])("refuses a capture holding a vault %s", async (field) => {
    const vault = { put: async () => {}, get: async (name: string) => `${name}-value` };
    const leaked = recordingOf([...GOOD_EVENTS, up(500, "sms_messages", { id: "s2", direction: "inbound", to: "x", from: "y", body: `it is portal/baycurrent/${field}-value`, created_at: RECORDED_AT })]);
    expect(recordingProblems(leaked, await secretValues(vault)).join()).toMatch(/1 secrets/);
  });

  it("refuses a recording that could not be played", () => {
    expect(recordingProblems({ ...good, durationMs: 1 }, []).join()).toMatch(/header says/);
  });
});

describe("parseRecording", () => {
  const header = { recordedAt: RECORDED_AT, durationMs: 0 };
  const lines = (...rows: unknown[]) => rows.map((row) => JSON.stringify(row)).join("\n");
  const text = (event: unknown) => lines(header, event);

  it("reads a good file", () => {
    expect(parseRecording(text(up(0, "runs", runRow("running")))).events).toHaveLength(1);
  });

  it.each([
    ["a table outside the list", up(0, "customers", { id: "x" })],
    ["a column that is not a plain name", up(0, "runs", { id: "x", 'status" = 1; drop table runs; --': "x" })],
    ["a row whose id differs", { t: 0, table: "runs", op: "upsert", id: "x", row: { id: "y" } }],
    ["an unknown op", { t: 0, table: "runs", op: "truncate", id: "x" }],
  ])("refuses %s", (_name, event) => {
    expect(() => parseRecording(text(event))).toThrow(/bad/);
  });

  it("refuses a file with no header", () => {
    expect(() => parseRecording("{}\n")).toThrow(/header/);
  });

  const run = up(0, "runs", runRow("running"));
  it.each([
    ["a header with no events", lines(header), /no events/],
    ["a date that is not a date", lines({ ...header, recordedAt: "yesterday" }, run), /header/],
    ["a date that does not exist", lines({ ...header, recordedAt: "2026-02-30T10:00:00.000Z" }, run), /header/],
    ["a negative duration", lines({ ...header, durationMs: -1 }, run), /header/],
    ["a negative time", lines(header, { ...run, t: -1 }, run), /bad event/],
    ["events out of order", lines({ ...header, durationMs: 5 }, { ...run, t: 10 }, { ...run, t: 5 }), /bad event/],
    ["a file cut short", lines({ ...header, durationMs: 9000 }, run), /header says/],
    ["a child before its run", lines({ ...header, durationMs: 5 }, up(0, "findings", finding), { ...run, t: 5 }), /start with its run/],
    ["no run", lines(header, up(0, "findings", finding)), /start with its run/],
    ["a run deleted at the end", lines({ ...header, durationMs: 5 }, run, { t: 5, table: "runs", op: "delete", id: RUN }), /exactly one run/],
  ])("refuses %s", (_name, file, problem) => {
    expect(() => parseRecording(file)).toThrow(problem);
  });

  it("reads the committed recording", () => {
    const recording = parseRecording(readFileSync(new URL("../data/replay/run.jsonl", import.meta.url), "utf8"));
    expect(recordingProblems(recording, [])).toEqual([]);
  });
});

describe("checkSpeed", () => {
  it.each([1, 1.8, 8])("allows %s", (speed) => expect(() => checkSpeed(speed)).not.toThrow());
  it.each([0, 0.5, 8.5, Number.NaN, Number.POSITIVE_INFINITY])("refuses %s", (speed) => expect(() => checkSpeed(speed)).toThrow(/--speed/));
});

describe("replay", () => {
  it("puts back the recorded rows, with their recorded times, using only Postgres", () =>
    withTestDb("replay_rows", async (db) => {
      await seedCustomer(db);
      await replay(await options(db, recordingOf(GOOD_EVENTS)));

      const [run] = await db.select().from(runs);
      expect(run).toMatchObject({ id: RUN, status: "success", costUsd: 0.42, startedAt: new Date(RECORDED_AT) });
      expect((await db.select().from(approvals))[0]).toMatchObject({ actionIds: ["a1"], status: "approved", approvedAt: new Date("2026-11-06T10:00:02.000Z") });
      const [call] = await db.select().from(calls);
      expect(call!.transcriptJson).toHaveLength(2);
      expect(call!.endedAt).toEqual(new Date("2026-11-06T10:02:44.000Z"));
      expect(await db.$count(ledger)).toBe(1);
      expect((await db.select().from(smsMessages))[0]!.to).toBe("+15550001111");
      expect((await db.select().from(auditLog))[0]!.inputJson).toBeNull();
    }));

  it("labels the run in every state any poll could read", () =>
    withTestDb("replay_label", async (db) => {
      await seedCustomer(db);
      const states: unknown[] = [];
      let done = false;
      const watcher = (async () => {
        while (!done) {
          states.push(...(await db.select({ replay: runs.replay }).from(runs)).map(({ replay }) => replay));
          await sleep(5);
        }
      })();
      await replay(await options(db, recordingOf(GOOD_EVENTS), { speed: 2 }));
      done = true;
      await watcher;

      expect(states.length).toBeGreaterThan(5);
      for (const state of states) expect(state).toMatchObject({ recordedAt: RECORDED_AT, speed: 2 });
      // Stays after playback, so a finished replay is never mistaken for a run.
      expect((await db.select().from(runs))[0]!.replay).toMatchObject({ speed: 2 });
    }));

  it("keeps the recorded timing at real speed and divides it at a higher speed", () =>
    withTestDb("replay_timing", async (db) => {
      await seedCustomer(db);
      const spaced = [up(0, "runs", runRow("running")), up(1000, "runs", runRow("success"))];
      expect((await replay(await options(db, recordingOf(spaced)))).playedMs).toBeGreaterThanOrEqual(1000);
      const real = (await replay(await options(db, recordingOf(spaced)))).playedMs;
      expect(real).toBeLessThan(1500);
      const fast = (await replay(await options(db, recordingOf(spaced), { speed: 4 }))).playedMs;
      expect(fast).toBeGreaterThanOrEqual(250);
      expect(fast).toBeLessThan(750);
    }));

  it("applies a delete, children before parents", () =>
    withTestDb("replay_delete", async (db) => {
      await seedCustomer(db);
      const events: ReplayEvent[] = [
        ...GOOD_EVENTS.slice(0, 3),
        { t: 50, table: "findings", op: "delete", id: "f1" },
        { t: 50, table: "actions", op: "delete", id: "a1" },
      ];
      await replay(await options(db, recordingOf(events)));
      expect(await db.$count(findings)).toBe(0);
      expect(await db.$count(actions)).toBe(0);
    }));

  it("plays twice with the same result", () =>
    withTestDb("replay_twice", async (db) => {
      await seedCustomer(db);
      const rows = async () => ({ findings: await db.select().from(findings), calls: await db.select().from(calls), ledger: await db.select().from(ledger) });
      const without = <T extends { id: string }>(list: T[]) => list.map(({ id }) => id);
      await replay(await options(db, recordingOf(GOOD_EVENTS)));
      const first = await rows();
      await replay(await options(db, recordingOf(GOOD_EVENTS)));
      expect(await rows()).toEqual(first);
      expect(without(first.ledger)).toEqual(["l1"]);
    }));

  it("leaves the captured run's folder alone when replaying over a replay", () =>
    withTestDb("replay_keeps_folder", async (db) => {
      await seedCustomer(db);
      const runsDir = mkdtempSync(join(root, "runs-"));
      mkdirSync(join(runsDir, RUN));
      await replay(await options(db, recordingOf(GOOD_EVENTS), { runsDir }));
      await replay(await options(db, recordingOf(GOOD_EVENTS), { runsDir }));
      expect(existsSync(join(runsDir, RUN))).toBe(true);
    }));

  it("refuses a database that is not local, before touching anything", () =>
    withTestDb("replay_nonlocal", async (db) => {
      await seedRun(db, "kept");
      const url = "postgres://bill:bill@db.example.com:5432/billfighter";
      await expect(replay(await options(db, recordingOf(GOOD_EVENTS), { url }))).rejects.toThrow(/not local/);
      expect(await db.$count(runs)).toBe(1);
    }));

  it("refuses a speed out of range, before touching anything", () =>
    withTestDb("replay_speed", async (db) => {
      await seedRun(db, "kept");
      await expect(replay(await options(db, recordingOf(GOOD_EVENTS), { speed: 100 }))).rejects.toThrow(/--speed/);
      expect(await db.$count(runs)).toBe(1);
    }));

  it("refuses to overwrite a run that may be alive, unless forced", () =>
    withTestDb("replay_running", async (db) => {
      await seedRun(db, "alive");
      await seedCustomer(db);
      await expect(replay(await options(db, recordingOf(GOOD_EVENTS)))).rejects.toThrow(/alive.*dev:webhooks.*--force/s);
      expect((await db.select().from(runs)).map(({ id }) => id)).toEqual(["alive"]);

      await replay(await options(db, recordingOf(GOOD_EVENTS), { force: true }));
      expect((await db.select().from(runs)).map(({ id }) => id)).toEqual([RUN]);
    }));

  it("does not treat a stopped replay as a live run", () =>
    withTestDb("replay_stopped", async (db) => {
      await seedCustomer(db);
      await replay(await options(db, recordingOf(GOOD_EVENTS.slice(0, 4))));
      expect((await db.select().from(runs))[0]!.status).toBe("running");
      await expect(replay(await options(db, recordingOf(GOOD_EVENTS)))).resolves.toBeDefined();
    }));

  it("refuses a second replay while one is playing, and lets go when it ends", () =>
    withTestDb("replay_lock", async (db) => {
      await seedCustomer(db);
      const slow = [up(0, "runs", runRow("success")), up(800, "runs", runRow("success", 1))];
      const playing = replay(await options(db, recordingOf(slow)));
      await sleep(300);
      await expect(replay(await options(db, recordingOf(slow)))).rejects.toThrow(/already playing/);
      await playing;
      await expect(replay(await options(db, recordingOf(slow), { speed: 8 }))).resolves.toBeDefined();
    }));

  it("reports a missing seed row as a foreign key error, and rolls that tick back", () =>
    withTestDb("replay_no_seed", async (db) => {
      await expect(replay(await options(db, recordingOf(GOOD_EVENTS)))).rejects.toMatchObject({ code: "23503" });
      expect(await db.$count(runs)).toBe(0);
    }));

  const noStatus: Record<string, unknown> = runRow("success");
  delete noStatus.status;
  it.each([
    ["no events", { recordedAt: RECORDED_AT, durationMs: 0, events: [] }, /no events/],
    ["an invalid date", { ...recordingOf(GOOD_EVENTS), recordedAt: "not a date" }, /header/],
    ["a negative duration", { ...recordingOf(GOOD_EVENTS.slice(0, 4)), durationMs: -5 }, /header/],
    ["a run row missing a required field", recordingOf([...GOOD_EVENTS, up(600, "runs", noStatus)]), /null value in column "status"/],
    ["a late row with a bad time", recordingOf([...GOOD_EVENTS, up(600, "ledger", { id: "l2", customer_id: CUSTOMER, finding_id: "f1", kind: "savings", amount_cents: 1, created_at: "soon" })]), /timestamp/],
    ["a late row naming a missing seed row", recordingOf([...GOOD_EVENTS, up(600, "findings", { ...finding, id: "f2", customer_id: "nobody" })]), /foreign key/],
  ])("refuses %s before clearing anything", (_name, recording, problem) =>
    withTestDb("replay_invalid", async (db) => {
      await seedRun(db, "kept");
      await seedCustomer(db);
      await db.$client.query("update runs set status = 'success' where id = 'kept'");
      await expect(replay(await options(db, recording as Recording))).rejects.toThrow(problem);
      expect((await db.select().from(runs)).map(({ id, status }) => [id, status])).toEqual([["kept", "success"]]);
    }));
});

describe("capture", () => {
  const file = () => join(mkdtempSync(join(root, "capture-")), "nested", "run.jsonl");
  const captureOptions = (db: Db, target: string, overrides = {}) => ({
    pool: db.$client,
    file: target,
    secrets: [],
    approveAfterMs: null,
    dashboardUrl: "http://127.0.0.1:1",
    pollMs: 10,
    tailMs: 50,
    timeoutMs: 20_000,
    ...overrides,
  });

  /** The writes of a small run, each visibly later than the last. Approval waits for the given step. */
  async function playRun(db: Db, waitForApproval: () => Promise<void> = async () => {}) {
    const { customerId } = await seedRun(db, RUN);
    await db.insert(findings).values({ id: "f1", customerId, type: "unusedLines", title: "t", explanation: "e", evidenceJson: {}, confidence: 0.9 });
    await db.insert(actions).values({ id: "a1", findingId: "f1", kind: "call", status: "proposed" });
    await db.insert(auditLog).values({ id: "au1", runId: RUN, agent: "approver", tool: "vault_read", inputJson: { password: "from-the-vault" }, outputJson: { password: "from-the-vault" } });
    await db.insert(approvals).values({ id: "ap1", runId: RUN, actionIds: ["a1"], summary: "Approve" });
    await db.insert(smsMessages).values({ id: "s1", direction: "outbound", to: "+15550001111", from: "+15550002222", body: "Reply YES" });
    await sleep(50);
    await waitForApproval();
    await db.$client.query("update approvals set status = 'approved', channel = 'sms' where id = 'ap1'");
    await db.insert(calls).values({ id: "c1", actionId: "a1", mode: "sim", toNumber: "+15550002222", transcriptJson: [{ role: "agent", kind: "speech", content: "Hi", at: RECORDED_AT }] });
    await sleep(50);
    const grown = [{ role: "agent", kind: "speech", content: "Hi", at: RECORDED_AT }, { role: "provider", kind: "speech", content: "Hello", at: RECORDED_AT }];
    await db.$client.query("update calls set transcript_json = $1, ended_at = now() where id = 'c1'", [JSON.stringify(grown)]);
    await db.insert(ledger).values({ id: "l1", customerId, findingId: "f1", kind: "savings", amountCents: 100 });
    await sleep(50);
    await finishRun(db, "success");
  }

  it("records a run event by event, with each transcript row seen as it grew and no tool data", () =>
    withTestDb("replay_capture", async (db) => {
      const target = file();
      const capturing = capture(captureOptions(db, target));
      await sleep(50);
      await playRun(db);
      const { problems, file: saved, recording } = await capturing;

      expect(problems).toEqual([]);
      expect(saved).toBe(target);
      const text = readFileSync(target, "utf8");
      expect(text).not.toContain("from-the-vault");
      const callSizes = recording.events.filter(({ table }) => table === "calls").map(({ row }) => (row!.transcript_json as unknown[]).length);
      expect(callSizes).toEqual([1, 2]);
      const times = recording.events.map(({ t }) => t);
      expect(times).toEqual([...times].sort((a, b) => a - b));
      expect(times[0]).toBe(0);
      expect(recording.durationMs).toBe(times.at(-1));
      expect(parseRecording(text).events).toEqual(JSON.parse(JSON.stringify(recording.events)));
    }));

  it("plays back what it recorded", () =>
    withTestDb("replay_round_trip", async (db) => {
      const target = file();
      const capturing = capture(captureOptions(db, target));
      await sleep(50);
      await playRun(db);
      const { recording } = await capturing;
      const before = { call: await db.select().from(calls), approval: await db.select().from(approvals), ledger: await db.select().from(ledger) };

      await replay(await options(db, parseRecording(readFileSync(target, "utf8"))));

      expect({ call: await db.select().from(calls), approval: await db.select().from(approvals), ledger: await db.select().from(ledger) }).toEqual(before);
      expect((await db.select().from(runs))[0]!.replay).toMatchObject({ recordedAt: recording.recordedAt, speed: 1 });
    }));

  it("posts YES to the real route after the text arrives, and only once", () =>
    withTestDb("replay_approve", async (db) => {
      const posts: string[] = [];
      let answered: () => void;
      const answer = new Promise<void>((resolve) => (answered = resolve));
      const server = createServer((request, response) => {
        let body = "";
        request.on("data", (chunk) => (body += String(chunk)));
        request.on("end", () => {
          posts.push(`${request.method} ${request.url} ${body}`);
          response.end("{}");
          answered();
        });
      });
      await new Promise<void>((resolve) => server.listen(0, "127.0.0.1", resolve));
      try {
        const capturing = capture(captureOptions(db, file(), { approveAfterMs: 100, dashboardUrl: `http://127.0.0.1:${(server.address() as AddressInfo).port}` }));
        await sleep(50);
        await playRun(db, () => answer);
        const { problems } = await capturing;
        expect(problems).toEqual([]);
        expect(posts).toEqual([`POST /api/sms ${JSON.stringify({ runId: RUN, body: "YES" })}`]);
      } finally {
        server.close();
      }
    }));

  it("saves a failed run beside the good file, never over it", () =>
    withTestDb("replay_failed", async (db) => {
      const target = file();
      const capturing = capture(captureOptions(db, target));
      await sleep(50);
      await seedRun(db, RUN);
      await finishRun(db, "error");
      const { problems, file: saved } = await capturing;

      expect(problems.join()).toMatch(/not success/);
      expect(saved).toBe(`${target}.failed`);
      expect(existsSync(target)).toBe(false);
    }));

  it("keeps failed and half-written captures out of git", () => {
    const paths = ["data/replay/run.jsonl.failed", "data/replay/run.jsonl.failed.tmp", "data/replay/run.jsonl.tmp"];
    // check-ignore prints only the ignored paths, and exits non-zero if any path is not ignored.
    const ignored = execFileSync("git", ["check-ignore", ...paths], { cwd: new URL("..", import.meta.url), encoding: "utf8" });
    expect(ignored.trim().split("\n")).toEqual(paths);
  });

  it("saves what it has when no run finishes in time", () =>
    withTestDb("replay_timeout", async (db) => {
      const target = file();
      const { problems, file: saved } = await capture(captureOptions(db, target, { timeoutMs: 50 }));
      expect(problems[0]).toMatch(/no finished run/);
      expect(saved).toBe(`${target}.failed`);
    }));

  it("refuses to start on leftover rows, or on anything but sim", () =>
    withTestDb("replay_refuse", async (db) => {
      await seedRun(db, "old");
      await expect(capture(captureOptions(db, file()))).rejects.toThrow(/demo:reset/);
      vi.stubEnv("VOICE_MODE", "live");
      await expect(capture(captureOptions(db, file()))).rejects.toThrow(/VOICE_MODE=sim/);
    }));
});
