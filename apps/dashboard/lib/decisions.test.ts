import { approvals, actions, auditLog, boardCards, customers, runs, smsMessages } from "@bill-fighter/db/schema";
import type { Db } from "@bill-fighter/db/client";
import { seedRun, withTestDb } from "@bill-fighter/db/test-db";
import { RUN_CARD_AGENT } from "@bill-fighter/shared/run-card";
import { eq, sql } from "drizzle-orm";
import { describe, expect, it } from "vitest";
import { z } from "zod";
import { approveRun, isYes, receiveSms, respond, sameOrigin } from "./decisions.ts";
import { EMAIL_INSTEAD, isStopped, runProblems, STOPPED_TEXT } from "./run-state.ts";
import { liveSnapshot } from "./snapshot.ts";

const ACTION_IDS = ["a-claim", "a-call", "a-invoice"];
const OWNER = "+15550001111";
const COMPANY = "+15550002222";

async function seedBundle(db: Db, runId = "r1") {
  const seeded = await seedRun(db, runId);
  await db.insert(actions).values(ACTION_IDS.map((id) => ({ id, kind: "claim" as const, status: "proposed" })));
  await db.insert(approvals).values({ runId, actionIds: ACTION_IDS, summary: "Approve the fixes" });
  return seeded;
}

const askOwner = (db: Db) => db.insert(smsMessages).values({ direction: "outbound", to: OWNER, from: COMPANY, body: "Reply YES to approve." });
const bundle = async (db: Db, runId = "r1") => (await db.select().from(approvals).where(eq(approvals.runId, runId)))[0]!;

describe("a replayed run", () => {
  it("refuses the button and the phone, and changes nothing", async () => {
    await withTestDb("replay_decisions", async (db) => {
      await seedBundle(db);
      await askOwner(db);
      await db.update(runs).set({ replay: { recordedAt: "2026-11-06T10:00:00.000Z", speed: 1, startedAt: "2026-11-07T10:00:00.000Z" } }).where(eq(runs.id, "r1"));
      await expect(approveRun(db, "r1")).rejects.toMatchObject({ status: 409 });
      await expect(receiveSms(db, { runId: "r1", body: "YES" })).rejects.toMatchObject({ status: 409 });
      expect((await bundle(db)).status).toBe("pending");
      expect(await db.$count(smsMessages)).toBe(1);
    });
  });
});

describe("approveRun for a signed-in customer", () => {
  it("refuses another customer's run as if it did not exist, and releases their own", async () => {
    await withTestDb("approve_scoped", async (db) => {
      await seedBundle(db);
      await expect(approveRun(db, "r1", "someone-else")).rejects.toMatchObject({ status: 404 });
      expect((await db.select().from(approvals))[0]?.status).toBe("pending");
      await approveRun(db, "r1", "customer-r1");
      expect((await db.select().from(approvals))[0]?.status).toBe("approved");
    });
  });
});

describe("approveRun", () => {
  it("releases the whole bundle and records the customer's contact", async () => {
    await withTestDb("panels_action_one", async (db) => {
      await seedBundle(db);
      await approveRun(db, "r1");
      const row = await bundle(db);
      expect(row).toMatchObject({ status: "approved", channel: "dashboard", approvedBy: "Test Owner", actionIds: ACTION_IDS });
      expect((await liveSnapshot(db)).humanActions).toBe(1);
    });
  });

  it("records the contact choice on the approval and once in the audit log, call by default", async () => {
    await withTestDb("approve_contact", async (db) => {
      await seedBundle(db);
      await approveRun(db, "r1", undefined, undefined, "email");
      await approveRun(db, "r1", undefined, undefined, "call");
      expect((await bundle(db)).contact).toBe("email");
      const rows = await db.select().from(auditLog).where(eq(auditLog.tool, "approve"));
      expect(rows.map(({ agent, inputJson, outputJson }) => ({ agent, inputJson, outputJson }))).toEqual([
        { agent: "owner", inputJson: { contact: "email" }, outputJson: { approvedBy: "Test Owner", note: EMAIL_INSTEAD } },
      ]);
    });
  });

  it("writes one audit row for racing clicks, and keeps the bundle pending when the audit write fails", async () => {
    await withTestDb("approve_audit_atomic", async (db) => {
      await seedBundle(db);
      await Promise.all([approveRun(db, "r1", undefined, undefined, "email"), approveRun(db, "r1"), approveRun(db, "r1")]);
      expect(await db.$count(auditLog, eq(auditLog.tool, "approve"))).toBe(1);

      await seedRun(db, "r2");
      await db.insert(approvals).values({ runId: "r2", actionIds: [], summary: "Approve the fixes" });
      await db.execute(sql`alter table audit_log add constraint no_approve check (tool <> 'approve' or run_id <> 'r2')`);
      await expect(approveRun(db, "r2")).rejects.toThrow();
      expect((await bundle(db, "r2")).status).toBe("pending");
    });
  });

  it("refuses email on a naive run and leaves the bundle pending", async () => {
    await withTestDb("approve_contact_naive", async (db) => {
      await seedBundle(db);
      await db.update(runs).set({ platform: "naive" }).where(eq(runs.id, "r1"));
      await expect(approveRun(db, "r1", undefined, undefined, "email")).rejects.toMatchObject({ status: 409 });
      expect((await bundle(db)).status).toBe("pending");
      await approveRun(db, "r1");
      expect((await bundle(db)).contact).toBe("call");
    });
  });

  it("records one approval for a double click, and the second changes nothing", async () => {
    await withTestDb("panels_action_double", async (db) => {
      await seedBundle(db);
      const [first, second] = await Promise.all([approveRun(db, "r1"), approveRun(db, "r1")]);
      expect(first.approvedAt).toEqual(second.approvedAt);
      const decidedAt = (await bundle(db)).approvedAt;
      await approveRun(db, "r1");
      expect((await bundle(db)).approvedAt).toEqual(decidedAt);
      expect(await db.$count(approvals)).toBe(1);
      expect((await liveSnapshot(db)).humanActions).toBe(1);
    });
  });

  it("works with SMS unavailable", async () => {
    await withTestDb("panels_action_no_sms", async (db) => {
      await seedBundle(db);
      // Any read or write of SMS on this path now fails the test.
      await db.execute(sql`DROP TABLE sms_messages`);
      await approveRun(db, "r1");
      expect(await bundle(db)).toMatchObject({ status: "approved", channel: "dashboard", actionIds: ACTION_IDS });
    });
  });

  it("works on a naive run, because it is the backup path in both modes", async () => {
    await withTestDb("panels_action_naive", async (db) => {
      await seedBundle(db);
      await db.update(runs).set({ platform: "naive" }).where(eq(runs.id, "r1"));
      await approveRun(db, "r1");
      expect((await bundle(db)).status).toBe("approved");
    });
  });

  it("does not overturn a denied bundle", async () => {
    await withTestDb("panels_action_denied", async (db) => {
      await seedBundle(db);
      await db.update(approvals).set({ status: "denied", channel: "naive", approvedBy: "Owner" }).where(eq(approvals.runId, "r1"));
      await approveRun(db, "r1");
      expect((await bundle(db)).status).toBe("denied");
    });
  });
});

describe("a run that has stopped", () => {
  it.each(["error", "over_budget"])("refuses the button and SMS after %s, with a clear message, and counts no human action", async (status) => {
    await withTestDb("panels_action_stopped", async (db) => {
      await seedBundle(db);
      await askOwner(db);
      await db.update(runs).set({ status }).where(eq(runs.id, "r1"));

      const reply = await respond(new Request("http://localhost:3000/api/approve", { method: "POST", body: "{}", headers: { host: "localhost:3000" } }), z.object({}), () => approveRun(db, "r1"));
      expect(reply.status).toBe(409);
      expect(await reply.json()).toEqual({ error: STOPPED_TEXT });
      await expect(receiveSms(db, { runId: "r1", body: "YES" })).rejects.toThrow(STOPPED_TEXT);

      expect((await bundle(db)).status).toBe("pending");
      expect(await db.$count(smsMessages, eq(smsMessages.direction, "inbound"))).toBe(0);
      expect((await liveSnapshot(db)).humanActions).toBe(0);
    });
  });

  it("still lets a run that is going, or that finished, answer as before", () => {
    expect(isStopped("running")).toBe(false);
    expect(isStopped("success")).toBe(false);
    expect(isStopped(undefined)).toBe(false);
  });

  it("shows only what the run reported in the header, not a card an agent blocked", async () => {
    await withTestDb("panels_action_problems", async (db) => {
      await seedBundle(db);
      await db.insert(boardCards).values([
        { runId: "r1", agent: RUN_CARD_AGENT, title: "Stopped because the model did not answer in time.", status: "blocked" },
        { runId: "r1", agent: "filer", title: "File the claim", status: "blocked" },
      ]);
      expect(runProblems((await liveSnapshot(db)).boardCards)).toEqual(["Stopped because the model did not answer in time."]);
    });
  });
});

describe("receiveSms", () => {
  it("a YES releases the whole bundle and records the approver", async () => {
    await withTestDb("panels_action_yes", async (db) => {
      const { customerId } = await seedBundle(db);
      await db.update(customers).set({ contactName: "Linda Park" }).where(eq(customers.id, customerId));
      await askOwner(db);
      expect(await receiveSms(db, { runId: "r1", body: "YES" })).toEqual({ approved: true });
      expect(await bundle(db)).toMatchObject({ status: "approved", channel: "sms", approvedBy: "Linda Park", actionIds: ACTION_IDS });
    });
  });

  it("stores the reply with the numbers of the text it answers", async () => {
    await withTestDb("panels_action_numbers", async (db) => {
      await seedBundle(db);
      await askOwner(db);
      await receiveSms(db, { runId: "r1", body: "Thanks" });
      const replies = await db.select().from(smsMessages).where(eq(smsMessages.direction, "inbound"));
      expect(replies).toHaveLength(1);
      expect(replies[0]).toMatchObject({ from: OWNER, to: COMPANY, body: "Thanks" });
    });
  });

  it("anything but a plain YES is stored and approves nothing", async () => {
    await withTestDb("panels_action_near", async (db) => {
      await seedBundle(db);
      await askOwner(db);
      const nearMisses = ["no", "YESTERDAY", "yes but not the alarm line", "Yes, thanks", "not yes"];
      for (const body of nearMisses) await receiveSms(db, { runId: "r1", body });
      expect((await bundle(db)).status).toBe("pending");
      expect(await db.$count(smsMessages, eq(smsMessages.direction, "inbound"))).toBe(nearMisses.length);
    });
  });

  it("counts button plus SMS as one human action, whichever came first", async () => {
    await withTestDb("panels_action_both", async (db) => {
      await seedBundle(db);
      await askOwner(db);
      await approveRun(db, "r1");
      await receiveSms(db, { runId: "r1", body: "YES" });
      expect((await bundle(db)).channel).toBe("dashboard");
      expect((await liveSnapshot(db)).humanActions).toBe(1);
    });
    await withTestDb("panels_action_both_sms", async (db) => {
      await seedBundle(db);
      await askOwner(db);
      await receiveSms(db, { runId: "r1", body: "yes" });
      await approveRun(db, "r1");
      expect((await bundle(db)).channel).toBe("sms");
      expect((await liveSnapshot(db)).humanActions).toBe(1);
    });
  });

  it("stores a YES that has no bundle yet and approves nothing", async () => {
    await withTestDb("panels_action_early", async (db) => {
      await seedRun(db, "r1");
      await askOwner(db);
      expect(await receiveSms(db, { runId: "r1", body: "YES" })).toEqual({ approved: false });
      expect(await db.$count(smsMessages, eq(smsMessages.direction, "inbound"))).toBe(1);
    });
  });
});

describe("isYes", () => {
  it.each(["YES", "yes", " Yes ", "YES.", "yes!"])("accepts %j", (body) => expect(isYes(body)).toBe(true));
  it.each(["", "y", "yes please", "no, yes", "yes?"])("refuses %j", (body) => expect(isYes(body)).toBe(false));
});

describe("sameOrigin", () => {
  const request = (headers: Record<string, string>) => new Request("http://localhost:3000/api/approve", { method: "POST", headers });

  it("allows the dashboard's own page and a request from no page", () => {
    expect(sameOrigin(request({ origin: "http://localhost:3000", host: "localhost:3000" }))).toBe(true);
    expect(sameOrigin(request({ host: "localhost:3000" }))).toBe(true);
  });

  it("refuses another site, another port and a sandboxed page", () => {
    expect(sameOrigin(request({ origin: "https://evil.example", host: "localhost:3000" }))).toBe(false);
    expect(sameOrigin(request({ origin: "http://localhost:4000", host: "localhost:3000" }))).toBe(false);
    expect(sameOrigin(request({ origin: "null", host: "localhost:3000" }))).toBe(false);
  });

  it("allows 127.0.0.1, where the dev server listens", () => {
    expect(sameOrigin(request({ origin: "http://127.0.0.1:3000", host: "127.0.0.1:3000" }))).toBe(true);
  });

  it("refuses a rebinding host even though its Origin matches, and any Host that is not local", () => {
    expect(sameOrigin(request({ origin: "http://evil.example:3000", host: "evil.example:3000" }))).toBe(false);
    expect(sameOrigin(request({ host: "evil.example:3000" }))).toBe(false);
    expect(sameOrigin(request({ origin: "http://localhost.evil.example:3000", host: "localhost.evil.example:3000" }))).toBe(false);
    expect(sameOrigin(request({ host: "localhost@evil.example" }))).toBe(false);
    expect(sameOrigin(request({}))).toBe(false);
  });

  it("allows the one PUBLIC_HOST a hosted deployment answers on, from its own page only", () => {
    process.env.PUBLIC_HOST = "clawback.example";
    try {
      expect(sameOrigin(request({ origin: "https://clawback.example", host: "clawback.example" }))).toBe(true);
      expect(sameOrigin(request({ origin: "https://evil.example", host: "clawback.example" }))).toBe(false);
      expect(sameOrigin(request({ origin: "https://evil.example", host: "evil.example" }))).toBe(false);
    } finally {
      delete process.env.PUBLIC_HOST;
    }
  });
});

describe("respond: what the routes answer", () => {
  const Body = z.object({ runId: z.string().min(1) });
  const post = (body: string, headers: Record<string, string> = { host: "localhost:3000" }) => new Request("http://localhost:3000/api/approve", { method: "POST", body, headers });
  const valid = JSON.stringify({ runId: "r1" });

  it("gives 400 for malformed JSON and a bad body, without acting", async () => {
    let acted = false;
    const act = async () => (acted = true);
    expect((await respond(post("{not json"), Body, act)).status).toBe(400);
    expect((await respond(post(JSON.stringify({ runId: 7 })), Body, act)).status).toBe(400);
    expect(acted).toBe(false);
  });

  it("gives 403 across origins, without acting", async () => {
    let acted = false;
    const crossSite = post(valid, { origin: "https://evil.example", host: "localhost:3000" });
    expect((await respond(crossSite, Body, async () => (acted = true))).status).toBe(403);
    const rebound = post(valid, { origin: "http://evil.example:3000", host: "evil.example:3000" });
    expect((await respond(rebound, Body, async () => (acted = true))).status).toBe(403);
    expect(acted).toBe(false);
  });

  it("gives 404 for an unknown run and for a run with no bundle", async () => {
    await withTestDb("panels_action_404", async (db) => {
      await seedRun(db, "r1");
      const approve = ({ runId }: { runId: string }) => approveRun(db, runId);
      expect((await respond(post(JSON.stringify({ runId: "nope" })), Body, approve)).status).toBe(404);
      expect((await respond(post(valid), Body, approve)).status).toBe(404);
    });
  });

  it("gives 409 for the simulated phone on a naive run, and stores nothing", async () => {
    await withTestDb("panels_action_409", async (db) => {
      await seedBundle(db);
      await db.update(runs).set({ platform: "naive" }).where(eq(runs.id, "r1"));
      await askOwner(db);
      const response = await respond(post(valid), Body, ({ runId }) => receiveSms(db, { runId, body: "YES" }));
      expect(response.status).toBe(409);
      expect((await bundle(db)).status).toBe("pending");
      expect(await db.$count(smsMessages, eq(smsMessages.direction, "inbound"))).toBe(0);
    });
  });

  it("gives 409 when there is no text to reply to", async () => {
    await withTestDb("panels_action_no_text", async (db) => {
      await seedBundle(db);
      const response = await respond(post(valid), Body, ({ runId }) => receiveSms(db, { runId, body: "YES" }));
      expect(response.status).toBe(409);
      expect((await bundle(db)).status).toBe("pending");
    });
  });

  it("gives 409 for a reply to a customer's older run, stores nothing, and the newest run still works", async () => {
    await withTestDb("panels_action_two_runs", async (db) => {
      const { customerId } = await seedBundle(db, "older");
      await db.update(runs).set({ startedAt: new Date(Date.now() - 60_000) }).where(eq(runs.id, "older"));
      await db.insert(runs).values({ id: "newer", customerId, platform: "local", trigger: "manual", status: "running" });
      await db.insert(approvals).values({ runId: "newer", actionIds: ACTION_IDS, summary: "Approve the fixes" });
      // The only text belongs to the newer run, and it was sent after the older run started.
      await askOwner(db);

      const late = await respond(post(JSON.stringify({ runId: "older" })), Body, ({ runId }) => receiveSms(db, { runId, body: "YES" }));
      expect(late.status).toBe(409);
      expect((await bundle(db, "older")).status).toBe("pending");
      expect(await db.$count(smsMessages, eq(smsMessages.direction, "inbound"))).toBe(0);

      expect(await receiveSms(db, { runId: "newer", body: "YES" })).toEqual({ approved: true });
      expect((await bundle(db, "newer")).status).toBe("approved");
      expect((await bundle(db, "older")).status).toBe("pending");
    });
  });

  it("gives 409 for a run that another customer's newer run has replaced, stores nothing, and the newest run still works", async () => {
    await withTestDb("panels_action_two_customers", async (db) => {
      await seedBundle(db, "older");
      await db.update(runs).set({ startedAt: new Date(Date.now() - 60_000) }).where(eq(runs.id, "older"));
      await seedRun(db, "other");
      await db.insert(approvals).values({ runId: "other", actionIds: ACTION_IDS, summary: "Approve the fixes" });
      // The only text is the other customer's, and it was sent after the older run started.
      await askOwner(db);

      const late = await respond(post(JSON.stringify({ runId: "older" })), Body, ({ runId }) => receiveSms(db, { runId, body: "YES" }));
      expect(late.status).toBe(409);
      expect((await bundle(db, "older")).status).toBe("pending");
      expect(await db.$count(smsMessages, eq(smsMessages.direction, "inbound"))).toBe(0);

      expect(await receiveSms(db, { runId: "other", body: "YES" })).toEqual({ approved: true });
      expect((await bundle(db, "other")).status).toBe("approved");
      expect((await bundle(db, "older")).status).toBe("pending");
    });
  });

  it("lets a real failure surface instead of calling it a refusal", async () => {
    const failing = async () => {
      throw new Error("Postgres is down");
    };
    await expect(respond(post(valid), Body, failing)).rejects.toThrow("Postgres is down");
  });
});
