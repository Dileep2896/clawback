import type { Db } from "@bill-fighter/db/client";
import { actions, approvals, auditLog, calls, findings, ledger } from "@bill-fighter/db/schema";
import { withTestDb } from "@bill-fighter/db/test-db";
import { lineKey } from "@bill-fighter/voice/sim/engine";
import { eq, inArray } from "drizzle-orm";
import { describe, expect, it } from "vitest";
import { planGaps } from "./plan-check.ts";
import { FAX_NUMBER, seedFindings } from "./test-fixtures.ts";

const RUN = "run";
const CALL = `call-${RUN}`;
const CANCEL = `cancel-${RUN}`;
const AFTER = ["record_savings", "schedule_check", "send_email"];

const test = (name: string, fn: (db: Db) => Promise<void>) => it(name, () => withTestDb("plan_check", fn));

const toolRan = (db: Db, tool: string, output: unknown = { ok: true }) => db.insert(auditLog).values({ runId: RUN, agent: "test", tool, outputJson: output });

/** A run whose owner approved a call and one cancel, with everything finished except what a test undoes. */
async function approvedRun(db: Db, { confirmed = [FAX_NUMBER] }: { confirmed?: string[] } = {}) {
  const seeded = await seedFindings(db, RUN);
  const { id } = seeded;
  await db.insert(actions).values([
    { id: CALL, kind: "call", status: "done" },
    { id: CANCEL, findingId: id("unused"), kind: "cancel", status: "proposed" },
    { id: "claim", findingId: id("meter"), kind: "claim", status: "done" },
    { id: "invoice", kind: "invoice", status: "done" },
    { id: "letter", findingId: id("unused"), kind: "letter", status: "proposed" },
  ]);
  await db.insert(approvals).values({ runId: RUN, actionIds: [CALL, CANCEL, "claim", "invoice", "letter"], summary: "s", status: "approved" });
  await db.insert(calls).values({ actionId: CALL, mode: "sim", toNumber: "+1", outcomeJson: { cancelled_lines: confirmed.map(lineKey), credits: [], ticket: "T" } });
  for (const tool of AFTER) await toolRan(db, tool);
  return seeded;
}

const finishCancel = (db: Db) => db.update(actions).set({ status: "done" }).where(eq(actions.id, CANCEL));

describe("planGaps", () => {
  test("an unknown run is a gap, not a clean finish", async (db) => {
    expect(await planGaps(db, "missing")).toEqual(["Run missing is not on file."]);
  });

  describe("with no approval", () => {
    test("a run that never finished its audit has a gap", async (db) => {
      await seedFindings(db, RUN);
      expect(await planGaps(db, RUN)).toEqual(["The run ended before its audit finished."]);
    });

    test("a failed audit does not count as finished", async (db) => {
      await seedFindings(db, RUN);
      await toolRan(db, "run_audit", { error: "no parse" });
      expect(await planGaps(db, RUN)).toEqual(["The run ended before its audit finished."]);
    });

    test("savings found and nothing asked is a gap", async (db) => {
      await seedFindings(db, RUN);
      await toolRan(db, "run_audit");
      expect(await planGaps(db, RUN)).toEqual(["The run found savings but ended without asking the owner to approve them."]);
    });

    test("an audit that leaves only findings with no money is a clean finish", async (db) => {
      const { id } = await seedFindings(db, RUN);
      await toolRan(db, "run_audit");
      await db.update(findings).set({ status: "won" }).where(inArray(findings.id, [id("meter"), id("rate"), id("unused"), id("promo")]));
      expect(await planGaps(db, RUN)).toEqual([]);
    });
  });

  test("a denied approval is a clean finish, with no gated work done", async (db) => {
    await seedFindings(db, RUN);
    await db.insert(approvals).values({ runId: RUN, actionIds: [], summary: "s", status: "denied" });
    expect(await planGaps(db, RUN)).toEqual([]);
  });

  test("a run that ends with the approval pending has a gap", async (db) => {
    await seedFindings(db, RUN);
    await db.insert(approvals).values({ runId: RUN, actionIds: [], summary: "s", status: "pending" });
    expect(await planGaps(db, RUN)).toEqual(["The run ended while the owner's approval was still pending."]);
  });

  describe("with an approved bundle", () => {
    test("everything finished is a clean finish, and an open letter is not a gap of its own", async (db) => {
      await approvedRun(db);
      await finishCancel(db);
      expect(await planGaps(db, RUN)).toEqual([]);
    });

    test("names each gated action that did not finish", async (db) => {
      await approvedRun(db);
      await finishCancel(db);
      await db.update(actions).set({ status: "proposed" }).where(eq(actions.id, CALL));
      await db.update(actions).set({ status: "approved" }).where(eq(actions.id, "invoice"));
      expect((await planGaps(db, RUN)).sort()).toEqual(["The approved call action call-run did not finish.", "The approved invoice action invoice did not finish."]);
    });

    test("an invoice left open because the fee recorded is zero is not a gap, and one with a fee is", async (db) => {
      const { customerId } = await approvedRun(db);
      await finishCancel(db);
      await db.update(actions).set({ status: "approved" }).where(eq(actions.id, "invoice"));
      await db.insert(ledger).values({ id: `fee-${customerId}`, customerId, kind: "fee", amountCents: 0, description: "fee" });
      expect(await planGaps(db, RUN)).toEqual([]);
      await db.update(ledger).set({ amountCents: 500 }).where(eq(ledger.kind, "fee"));
      expect(await planGaps(db, RUN)).toEqual(["The approved invoice action invoice did not finish."]);
    });

    test("a line the rep confirmed but nobody recorded is a gap", async (db) => {
      await approvedRun(db);
      expect(await planGaps(db, RUN)).toEqual([`The rep confirmed line ${FAX_NUMBER}, but its action ${CANCEL} was not recorded.`]);
    });

    test("a line the rep refused stays open and is not a gap", async (db) => {
      await approvedRun(db, { confirmed: ["(510) 555-0000"] });
      expect(await planGaps(db, RUN)).toEqual([]);
    });

    for (const tool of AFTER) {
      test(`a run with no ${tool} has a gap`, async (db) => {
        await approvedRun(db);
        await finishCancel(db);
        await db.delete(auditLog).where(eq(auditLog.tool, tool));
        expect(await planGaps(db, RUN)).toEqual([`The run ended without a successful ${tool}.`]);
      });
    }

    for (const output of [{ error: "SMTP down" }, { refused: "not allowed" }, { denied: "no" }]) {
      test(`send_email recorded as ${Object.keys(output)[0]} does not count as sent, and a later success does`, async (db) => {
        await approvedRun(db);
        await finishCancel(db);
        await db.delete(auditLog).where(eq(auditLog.tool, "send_email"));
        await toolRan(db, "send_email", output);
        expect(await planGaps(db, RUN)).toEqual(["The run ended without a successful send_email."]);
        await toolRan(db, "send_email");
        expect(await planGaps(db, RUN)).toEqual([]);
      });
    }
  });
});
