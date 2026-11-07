import { readdirSync, readFileSync } from "node:fs";
import type { AddressInfo } from "node:net";
import { join } from "node:path";
import { defineTool } from "@bill-fighter/agents/tool-wrapper";
import type { Db } from "@bill-fighter/db/client";
import { accounts, actions, approvals, auditLog, customers, locations, runs } from "@bill-fighter/db/schema";
import { STORES } from "@bill-fighter/db/seed/customer";
import { generateSeed } from "@bill-fighter/db/seed/generate";
import { withTestDb } from "@bill-fighter/db/test-db";
import { createAudit } from "@bill-fighter/platform/local/audit";
import { createMail } from "@bill-fighter/platform/local/mail";
import type { RunEvent, RunSpec } from "@bill-fighter/platform/types";
import { eq } from "drizzle-orm";
import { beforeEach, describe, expect, it, vi } from "vitest";
import { z } from "zod";
import { BILL_ACCOUNT_NUMBER, billEmail } from "./bill-email.ts";
import { handleInbound, type InboundDeps } from "./inbound.ts";
import { createInboundServer, INBOUND_PATH, MAX_BODY_BYTES } from "./server.ts";

// Each test migrates a fresh database on the Postgres every worktree shares, which is slow under load.
vi.setConfig({ testTimeout: 60_000 });

const DB_NAME = "run_trigger";
const success: RunEvent = { type: "result", status: "success", costUsd: 0 };
const email = (messageId = "msg-1") => ({ messageId, ...billEmail("bills@billfighter.local") });

async function addCustomer(db: Db, id: string, accountNumber: string) {
  await db.insert(customers).values({ id, name: id, contactName: "Owner", contactEmail: "o@billfighter.local", contactPhone: "+15550001111" });
  await db.insert(locations).values({ id: `${id}-loc`, customerId: id, name: "Store", address: "1 Main St", city: "Oakland" });
  await db.insert(accounts).values({ id: `${id}-acct`, locationId: `${id}-loc`, provider: "baycurrent", accountNumber, serviceType: "electric" });
}

type Script = (spec: RunSpec) => AsyncGenerator<RunEvent>;

function depsFor(db: Db, script: Script = async function* () { yield success; }) {
  const run = vi.fn((spec: RunSpec) => script(spec));
  const tool = defineTool({
    name: "get_customer",
    description: "test tool",
    inputSchema: z.object({}),
    targets: () => [],
    handler: async () => ({ ok: true }),
  });
  const deps: InboundDeps = { db, mail: createMail({}), runtime: { run }, audit: createAudit(db), tools: [tool] };
  return { deps, run };
}

const finished = async (db: Db, runId: string) => {
  let row: typeof runs.$inferSelect | undefined;
  await vi.waitFor(async () => {
    [row] = await db.select().from(runs).where(eq(runs.id, runId));
    expect(row?.finishedAt).toBeTruthy();
  }, 30_000);
  return row!;
};

// Starting a run warns about roster tools not built in this test.
beforeEach(() => {
  vi.spyOn(console, "warn").mockImplementation(() => {});
});

describe("handleInbound", () => {
  it("starts a run with trigger=email and platform set, with the customer from the account number", async () => {
    await withTestDb(DB_NAME, async (db) => {
      await addCustomer(db, "noodle", BILL_ACCOUNT_NUMBER);
      const { deps, run } = depsFor(db);
      const reply = await handleInbound(email(), deps);
      expect(reply.status).toBe(202);
      expect(reply.body.duplicate).toBe(false);

      const row = await finished(db, reply.body.runId as string);
      // The stub model does none of the plan, so planGaps marks the run incomplete. Its row is what this test is about.
      expect(row).toMatchObject({ customerId: "noodle", trigger: "email", platform: "local", dedupeKey: "msg-1", status: "incomplete" });
      expect(run).toHaveBeenCalledOnce();
      // parse_inbound_email takes the whole email, so the model must be given every field.
      const prompt = run.mock.calls[0]![0].prompt;
      for (const value of Object.values(email())) expect(prompt).toContain(JSON.stringify(value));
    });
  });

  it("keeps the run's events in its log file, and no tool input", async () => {
    await withTestDb(DB_NAME, async (db) => {
      await addCustomer(db, "noodle", BILL_ACCOUNT_NUMBER);
      vi.spyOn(console, "info").mockImplementation(() => {});
      const { deps } = depsFor(db, async function* () {
        yield { type: "tool_call", agent: "intake", tool: "get_customer", input: { secret: "tool-input" } };
        yield success;
      });
      const reply = await handleInbound(email(), deps);
      const runId = reply.body.runId as string;
      await finished(db, runId);

      const log = readFileSync(join(process.env.RUN_EVENT_LOG_DIR!, `${runId}.log`), "utf8");
      expect(log).toContain("[intake] calls get_customer");
      // The stub model does none of the plan, so the logged result is the checked one, not the SDK's success.
      expect(log).toContain("Run ended: incomplete");
      expect(log).not.toContain("Run ended: success");
      expect(log).not.toContain("tool-input");
    });
  });

  it("starts one run for the same email delivered twice, one after the other or racing", async () => {
    await withTestDb(DB_NAME, async (db) => {
      await addCustomer(db, "noodle", BILL_ACCOUNT_NUMBER);
      const { deps, run } = depsFor(db);

      const first = await handleInbound(email(), deps);
      const second = await handleInbound(email(), deps);
      expect(second).toEqual({ status: 200, body: { runId: first.body.runId, duplicate: true } });

      const raced = await Promise.all(Array.from({ length: 5 }, () => handleInbound(email("msg-2"), deps)));
      expect(raced.map((reply) => reply.status).sort()).toEqual([200, 200, 200, 200, 202]);
      expect(new Set(raced.map((reply) => reply.body.runId)).size).toBe(1);

      await finished(db, first.body.runId as string);
      await finished(db, raced[0]!.body.runId as string);
      expect(await db.select().from(runs)).toHaveLength(2);
      expect(run).toHaveBeenCalledTimes(2);
    });
  });

  it("rejects a payload that fails validation, and starts nothing", async () => {
    await withTestDb(DB_NAME, async (db) => {
      await addCustomer(db, "noodle", BILL_ACCOUNT_NUMBER);
      const { deps, run } = depsFor(db);
      for (const bad of [null, "x", {}, { ...email(), from: undefined }, { ...email(), messageId: "" }, { ...email(), extra: 1 }]) {
        expect((await handleInbound(bad, deps)).status).toBe(400);
      }
      expect(await db.select().from(runs)).toEqual([]);
      expect(run).not.toHaveBeenCalled();
    });
  });

  it("answers 422 and starts nothing when the email names no account on file, or accounts of two customers", async () => {
    await withTestDb(DB_NAME, async (db) => {
      await addCustomer(db, "noodle", "BE-7011");
      await addCustomer(db, "other", "BE-7012");
      const { deps, run } = depsFor(db);
      for (const text of ["no account here", "only inside a longer token BE-70112", "BE-7011 and BE-7012"]) {
        expect((await handleInbound({ ...email(), subject: "", text }, deps)).status).toBe(422);
      }
      expect(await db.select().from(runs)).toEqual([]);
      expect(run).not.toHaveBeenCalled();
    });
  });

  it("has the run row in place before a tool writes audit_log", async () => {
    await withTestDb(DB_NAME, async (db) => {
      await addCustomer(db, "noodle", BILL_ACCOUNT_NUMBER);
      const { deps } = depsFor(db, async function* (spec) {
        await spec.tools[0]!.handler({}, { runId: spec.runId, agent: "intake" });
        yield success;
      });
      const reply = await handleInbound(email(), deps);
      const row = await finished(db, reply.body.runId as string);
      // Finished, not failed: incomplete only because the stub does none of the plan.
      expect(row.status).toBe("incomplete");
      const audited = await db.select().from(auditLog).where(eq(auditLog.runId, row.id));
      expect(audited.map(({ agent, tool }) => ({ agent, tool }))).toEqual([{ agent: "intake", tool: "get_customer" }]);
    });
  });

  it("writes audit_log for a call the runtime denied", async () => {
    await withTestDb(DB_NAME, async (db) => {
      await addCustomer(db, "noodle", BILL_ACCOUNT_NUMBER);
      const { deps } = depsFor(db, async function* () {
        yield { type: "denied", agent: "filer", tool: "submit_claim", reason: "not approved" };
        yield success;
      });
      const reply = await handleInbound(email(), deps);
      const row = await finished(db, reply.body.runId as string);
      const [audited] = await db.select().from(auditLog).where(eq(auditLog.runId, row.id));
      expect(audited).toMatchObject({ agent: "filer", tool: "submit_claim", outputJson: { denied: "not approved" } });
    });
  });

  it("records the runtime's result, a thrown runtime, and a stream with no result", async () => {
    const scripts: [Script, string][] = [
      [async function* () { yield { type: "result", status: "over_budget", costUsd: 5 }; }, "over_budget"],
      [async function* () { yield { type: "text", agent: "ceo", text: "hi" }; throw new Error("boom"); }, "error"],
      [async function* () { yield { type: "text", agent: "ceo", text: "hi" }; }, "error"],
    ];
    const logged = vi.spyOn(console, "error").mockImplementation(() => {});
    await withTestDb(DB_NAME, async (db) => {
      await addCustomer(db, "noodle", BILL_ACCOUNT_NUMBER);
      for (const [index, [script, status]] of scripts.entries()) {
        const reply = await handleInbound(email(`msg-${index}`), depsFor(db, script).deps);
        expect((await finished(db, reply.body.runId as string)).status).toBe(status);
      }
    });
    expect(logged).toHaveBeenCalledOnce();
    logged.mockRestore();
  });
});

describe("auto approval", () => {
  it("leaves a webhook run's bundle pending, even when asked to approve", async () => {
    vi.stubEnv("AUTO_APPROVE", "1");
    try {
      await withTestDb(DB_NAME, async (db) => {
        await addCustomer(db, "noodle", BILL_ACCOUNT_NUMBER);
        const { deps } = depsFor(db, async function* (spec) {
          await db.insert(actions).values({ id: "a1", kind: "cancel", status: "proposed" });
          await db.insert(approvals).values({ runId: spec.runId, actionIds: ["a1"], summary: "s" });
          yield success;
        });
        expect((await handleInbound({ ...email(), autoApprove: true }, deps)).status).toBe(400);

        const reply = await handleInbound(email(), deps);
        await finished(db, reply.body.runId as string);
        const [approval] = await db.select().from(approvals);
        expect(approval).toMatchObject({ status: "pending", approvedBy: null });
      });
    } finally {
      vi.unstubAllEnvs();
    }
  });

  it("cannot be reached from the webhook or the demo path", () => {
    const sources = [
      ...readdirSync(new URL(".", import.meta.url))
        .filter((file) => !file.endsWith(".test.ts"))
        .map((file) => new URL(file, import.meta.url)),
      new URL("../../../packages/agents/src/run.ts", import.meta.url),
      new URL("../../../scripts/demo-start.ts", import.meta.url),
    ];
    expect(sources.length).toBeGreaterThan(5);
    for (const source of sources) {
      expect(readFileSync(source, "utf8"), source.pathname).not.toMatch(/\.decide\(|decideApproval|run-local|auto-approve|approvalGate/);
    }
  });
});

describe("billEmail", () => {
  it("prints an account number on file for the seed customer, as a whole token", () => {
    const fremont = generateSeed().accounts.find((account) => account.accountNumber === BILL_ACCOUNT_NUMBER);
    expect(fremont?.locationId).toBe(STORES.find((store) => store.id === "fremont-1")?.id);
    expect(fremont?.provider).toBe("baycurrent");
    expect(billEmail("x@y.z").text.split(/[^\w-]+/)).toContain(BILL_ACCOUNT_NUMBER);
  });
});

describe("createInboundServer", () => {
  it("serves POST /inbound, and refuses other routes, bad JSON and oversized bodies", async () => {
    await withTestDb(DB_NAME, async (db) => {
      await addCustomer(db, "noodle", BILL_ACCOUNT_NUMBER);
      const server = createInboundServer({ ...depsFor(db).deps, scheduler: { fire: async () => {} } });
      await new Promise<void>((resolve) => server.listen(0, "127.0.0.1", resolve));
      const base = `http://127.0.0.1:${(server.address() as AddressInfo).port}`;
      const post = (path: string, body: string) => fetch(base + path, { method: "POST", body });
      try {
        const ok = await post(INBOUND_PATH, JSON.stringify(email()));
        expect(ok.status).toBe(202);
        await finished(db, ((await ok.json()) as { runId: string }).runId);

        expect((await fetch(base + INBOUND_PATH)).status).toBe(404);
        expect((await post("/other", "{}")).status).toBe(404);
        expect((await post(INBOUND_PATH, "{not json")).status).toBe(400);
        expect((await post(INBOUND_PATH, "x".repeat(MAX_BODY_BYTES + 1))).status).toBe(413);
      } finally {
        await new Promise((resolve) => server.close(resolve));
      }
    });
  });
});
