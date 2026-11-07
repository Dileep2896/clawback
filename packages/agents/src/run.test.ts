import { spawn } from "node:child_process";
import { connect } from "node:net";
import { fileURLToPath } from "node:url";
import { auditLog, boardCards, ledger, runs } from "@bill-fighter/db/schema";
import type { Db } from "@bill-fighter/db/client";
import { seedRun, withTestDb } from "@bill-fighter/db/test-db";
import type { AgentRuntime, Audit, RunEvent } from "@bill-fighter/platform/types";
import { eq } from "drizzle-orm";
import { describe, expect, it, vi } from "vitest";
import { executeRun, stopActiveRuns } from "./run.ts";

const RUN = "r1";
const FIXTURE = fileURLToPath(new URL("./signal-exit.fixture.ts", import.meta.url));

const noAudit: Audit = { record: async () => {}, list: async () => [] };
const runtimeOf = (...events: RunEvent[]): AgentRuntime => ({
  run: async function* () {
    yield* events;
  },
});
const execute = (db: Db, runtime: AgentRuntime) => executeRun({ db, runId: RUN, prompt: "p", runtime, audit: noAudit, tools: [] });
const row = async (db: Db) => (await db.select().from(runs).where(eq(runs.id, RUN)))[0]!;
const titles = async (db: Db) => (await db.select().from(boardCards).where(eq(boardCards.agent, "run"))).map((card) => card.title);

const test = (name: string, fn: (db: Db) => Promise<void>) =>
  it(name, () =>
    withTestDb("run_stop", async (db) => {
      await seedRun(db, RUN);
      const logged = vi.spyOn(console, "error").mockImplementation(() => {});
      await fn(db);
      logged.mockRestore();
    }),
  );

describe("a run that stops", () => {
  test("over budget: says so as an estimate, blocks open work and keeps every row", async (db) => {
    const customerId = `customer-${RUN}`;
    await db.insert(boardCards).values([
      { runId: RUN, agent: "finance", title: "Record savings", status: "doing" },
      { runId: RUN, agent: "auditor", title: "Audit", status: "done" },
    ]);
    await db.insert(auditLog).values({ runId: RUN, agent: "auditor", tool: "run_audit" });
    await db.insert(ledger).values({ id: "l1", customerId, kind: "fee", amountCents: 100 });

    expect(await execute(db, runtimeOf({ type: "result", status: "over_budget", costUsd: 5.5 }))).toBe("over_budget");

    expect(await row(db)).toMatchObject({ status: "over_budget", finishedAt: expect.any(Date) });
    expect((await titles(db))[0]).toMatch(/estimated cost reached the run budget.*is an estimate/);
    const cards = await db.select().from(boardCards);
    expect(cards.find((card) => card.title === "Record savings")!.status).toBe("blocked");
    expect(cards.find((card) => card.title === "Audit")!.status).toBe("done");
    expect(await db.$count(auditLog)).toBe(1);
    expect(await db.$count(ledger)).toBe(1);
  });

  test("on a model timeout: gives a clear message and not the raw reason", async (db) => {
    expect(await execute(db, runtimeOf({ type: "result", status: "error", costUsd: 0, reason: "The model did not answer for 180 s" }))).toBe("error");
    expect(await titles(db)).toEqual([expect.stringContaining("model did not answer in time")]);
  });

  test("when the runtime throws: still records a message and the status", async (db) => {
    const broken: AgentRuntime = {
      run: async function* () {
        throw new Error("sk_test_secret leaked in a message");
      },
    };
    expect(await execute(db, broken)).toBe("error");
    expect(await row(db)).toMatchObject({ status: "error" });
    expect(await titles(db)).toEqual([expect.stringContaining("server log")]);
    expect((await titles(db))[0]).not.toContain("sk_test");
  });

  test("a clean finish adds no card", async (db) => {
    expect(await execute(db, runtimeOf({ type: "result", status: "success", costUsd: 1 }))).toBe("success");
    expect(await titles(db)).toEqual([]);
  });

  test("stopActiveRuns marks only a run still going", async (db) => {
    let release: () => void = () => {};
    let started: () => void = () => {};
    const inRun = new Promise<void>((resolve) => (started = resolve));
    const parked: AgentRuntime = {
      run: async function* () {
        await new Promise<void>((resolve) => {
          release = resolve;
          started();
        });
        yield { type: "result", status: "success", costUsd: 0 };
      },
    };
    const going = execute(db, parked);
    await inRun;
    await stopActiveRuns(db);
    expect(await row(db)).toMatchObject({ status: "error", finishedAt: expect.any(Date) });
    expect(await titles(db)).toEqual([expect.stringContaining("server was shut down")]);
    release();
    await going;
  });
});

const portOpen = (port: number) =>
  new Promise<boolean>((resolve) => {
    const socket = connect(port, "127.0.0.1");
    socket.once("connect", () => {
      socket.destroy();
      resolve(true);
    });
    socket.once("error", () => resolve(false));
  });

describe("SIGTERM", () => {
  it(
    "ends a process held up by a listening server, frees its port and marks its run",
    () =>
      withTestDb("run_signal", async (db) => {
        await seedRun(db, RUN);
        const url = (db.$client.options as { connectionString: string }).connectionString;
        const child = spawn(process.execPath, ["--import", "tsx", FIXTURE, RUN], { env: { ...process.env, DATABASE_URL: url }, stdio: ["ignore", "pipe", "inherit"] });
        const port = await new Promise<number>((resolve, reject) => {
          child.stdout.once("data", (data: Buffer) => resolve(Number(String(data).trim())));
          child.once("exit", (code) => reject(new Error(`The fixture exited early with ${code}`)));
        });
        expect(await portOpen(port)).toBe(true);

        const exited = new Promise<number | null>((resolve) => child.once("exit", resolve));
        child.kill("SIGTERM");
        expect(await exited).toBe(143);
        expect(await portOpen(port)).toBe(false);
        expect(await row(db)).toMatchObject({ status: "error" });
        expect(await titles(db)).toEqual([expect.stringContaining("server was shut down")]);
      }),
    30_000,
  );
});
