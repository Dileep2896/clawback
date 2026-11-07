import type { Db } from "@bill-fighter/db/client";
import { actions, approvals, boardCards, findings, ledger, runs } from "@bill-fighter/db/schema";
import { seedRun, withTestDb } from "@bill-fighter/db/test-db";
import { createApprovalGate } from "@bill-fighter/platform/local/approval-gate";
import { createCard } from "@bill-fighter/platform/local/card";
import type { Audit } from "@bill-fighter/platform/types";
import { eq } from "drizzle-orm";
import Stripe from "stripe";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { loadTools } from "../registry.ts";
import { executeRun } from "../run.ts";
import { financeInvoiceTools, stripeClient } from "./finance-invoice.ts";
import { financeLedgerTools } from "./finance-ledger.ts";

const RUN = "run-1";
const CUSTOMER_ID = `customer-${RUN}`;
const ACTION = `invoice-${RUN}`;
const CTX = { runId: RUN, agent: "finance" };

type Params = { amount?: number; description?: string; invoice?: string };
type Options = { idempotencyKey: string };

/** Behaves as Stripe's idempotency layer does: a repeated key returns the first response and creates nothing. */
function fakeStripe() {
  const saved = new Map<string, unknown>();
  const items: Params[] = [];
  const invoices: Record<string, unknown>[] = [];
  const keys: string[] = [];
  const failFinalize = { times: 0 };
  const once = <T>(key: string, make: () => T) => {
    keys.push(key);
    if (!saved.has(key)) saved.set(key, make());
    return saved.get(key) as T;
  };
  const api = {
    customers: { create: async (params: object, { idempotencyKey }: Options) => once(idempotencyKey, () => ({ id: "cus_1", ...params })) },
    invoices: {
      create: async (params: object, { idempotencyKey }: Options) =>
        once(idempotencyKey, () => {
          const invoice = { id: `in_${invoices.length + 1}`, ...params };
          invoices.push(invoice);
          return invoice;
        }),
      finalizeInvoice: async (id: string, _params: object, { idempotencyKey }: Options) => {
        if (failFinalize.times-- > 0) throw new Error("Stripe is down");
        return once(idempotencyKey, () => ({ id, total: items.reduce((sum, item) => sum + item.amount!, 0), hosted_invoice_url: "https://invoice.stripe.com/x" }));
      },
    },
    invoiceItems: {
      create: async (params: Params, { idempotencyKey }: Options) =>
        once(idempotencyKey, () => {
          items.push(params);
          return { id: `ii_${items.length}` };
        }),
    },
  };
  return { api: api as never, items, invoices, keys, failFinalize };
}

function setup(db: Db) {
  const fake = fakeStripe();
  const charge = vi.fn(createCard(db).charge);
  const [invoice, pay] = financeInvoiceTools({ db, gate: async () => createApprovalGate(db), stripe: () => fake.api, card: async () => ({ charge }) });
  return {
    ...fake,
    charge,
    create: (actionId = ACTION, ctx = CTX) => invoice!.handler({ actionId }, ctx) as Promise<Record<string, unknown>>,
    pay: (actionId: string) => pay!.handler({ actionId }, CTX) as Promise<Record<string, unknown>>,
  };
}

const seedFinding = (db: Db, id: string, type: string, status: "filed" | "won", refund: number, savings: number, customerId = CUSTOMER_ID) =>
  db.insert(findings).values({ id, customerId, type, status, title: id, explanation: id, evidenceJson: {}, refundCents: refund, annualSavingsCents: savings, confidence: 0.9 });

const recordSavings = (db: Db, ctx = CTX) => financeLedgerTools({ db })[0]!.handler({}, ctx);

/** Won savings of $8,280 and the rest filed, which gives the real fee of $10,249.61. */
async function seedRealFigures(db: Db) {
  await seedRun(db, RUN);
  await seedFinding(db, "line", "unusedLines", "won", 0, 828_000);
  await seedFinding(db, "meter", "meterMultiplierJump", "filed", 1_260_000, 0);
  await seedFinding(db, "rate", "rateOptimization", "filed", 0, 1_328_538);
  await recordSavings(db);
}

const seedAction = (db: Db, id: string, kind: "invoice" | "card_pay" | "call", payloadJson: unknown = { customerId: CUSTOMER_ID }) =>
  db.insert(actions).values({ id, findingId: null, kind, payloadJson, status: "proposed" });

const approve = (db: Db, actionIds: string[], status: "approved" | "pending" | "denied" = "approved", runId = RUN) => db.insert(approvals).values({ runId, actionIds, summary: "s", status });

async function seedApprovedInvoice(db: Db) {
  await seedRealFigures(db);
  await seedAction(db, ACTION, "invoice");
  await approve(db, [ACTION]);
}

const test = (name: string, fn: (db: Db) => Promise<void>) => it(name, () => withTestDb("finance_invoice", fn));

beforeEach(() => vi.stubEnv("STRIPE_SECRET_KEY", "sk_test_fake"));
afterEach(() => vi.unstubAllEnvs());

describe("create_invoice", () => {
  test("bills the ledger fee row to the cent, in two lines that split by finding status", async (db) => {
    await seedApprovedInvoice(db);
    const { create, items, invoices } = setup(db);

    expect(await create()).toMatchObject({ invoiceId: "in_1", amountCents: 1_024_961, dueNowCents: 248_400, dueWhenGrantedCents: 776_561 });
    expect(items.map(({ amount }) => amount)).toEqual([248_400, 776_561]);
    expect(items[1]!.description).toContain("due only when the refund is granted");
    expect(invoices[0]).toMatchObject({ collection_method: "send_invoice", auto_advance: false, metadata: { action_id: ACTION } });
    expect(invoices[0]!.description).toBe("Due today: $2,484.00. The other $7,765.61 is due only when the refund is granted, so please do not pay it yet.");
  });

  test("records the invoice in the ledger and finishes the action, leaving the fee as it was", async (db) => {
    await seedApprovedInvoice(db);
    await setup(db).create();

    const [row] = await db.select().from(ledger).where(eq(ledger.kind, "invoice"));
    expect(row).toMatchObject({ id: ACTION, customerId: CUSTOMER_ID, findingId: null, amountCents: 1_024_961, externalId: "in_1" });
    expect((await db.select().from(actions).where(eq(actions.id, ACTION)))[0]!.status).toBe("done");
    expect((await db.select().from(ledger).where(eq(ledger.kind, "fee")))[0]!.amountCents).toBe(1_024_961);
  });

  test("uses the fee row rather than working it out again", async (db) => {
    await seedApprovedInvoice(db);
    await db.update(ledger).set({ amountCents: 300_000 }).where(eq(ledger.kind, "fee"));
    const { create, items } = setup(db);

    expect(await create()).toMatchObject({ amountCents: 300_000, dueNowCents: 248_400, dueWhenGrantedCents: 51_600 });
    expect(items.map(({ amount }) => amount)).toEqual([248_400, 51_600]);
  });

  test("the fee on a won finding is due now, refund included", async (db) => {
    await seedRun(db, RUN);
    await seedFinding(db, "meter", "meterMultiplierJump", "won", 1_000, 0);
    await seedFinding(db, "rate", "rateOptimization", "filed", 0, 1_000);
    await recordSavings(db);
    await seedAction(db, ACTION, "invoice");
    await approve(db, [ACTION]);

    expect(await setup(db).create()).toMatchObject({ dueNowCents: 300, dueWhenGrantedCents: 300 });
  });

  test("leaves out an empty line and the note about a later payment", async (db) => {
    await seedRun(db, RUN);
    await seedFinding(db, "line", "unusedLines", "won", 0, 1_000);
    await recordSavings(db);
    await seedAction(db, ACTION, "invoice");
    await approve(db, [ACTION]);
    const { create, items, invoices } = setup(db);
    await create();

    expect(items.map(({ amount }) => amount)).toEqual([300]);
    expect(invoices[0]!.description).toBe("Due today: $3.00.");
  });

  test("a second use makes no Stripe call and returns the same invoice", async (db) => {
    await seedApprovedInvoice(db);
    const { create, invoices, keys } = setup(db);
    await create();
    const called = keys.length;

    expect(await create()).toMatchObject({ invoiceId: "in_1", amountCents: 1_024_961, repeated: true });
    expect(keys).toHaveLength(called);
    expect(invoices).toHaveLength(1);
    expect(await db.select().from(ledger).where(eq(ledger.kind, "invoice"))).toHaveLength(1);
  });

  test("overlapping uses make one invoice", async (db) => {
    await seedApprovedInvoice(db);
    const { create, invoices, items } = setup(db);
    await Promise.all([create(), create(), create()]);

    expect(invoices).toHaveLength(1);
    expect(items).toHaveLength(2);
  });

  test("a retry after a failure part way reuses every key from the action id, so nothing is made twice", async (db) => {
    await seedApprovedInvoice(db);
    const { create, invoices, items, keys, failFinalize } = setup(db);
    failFinalize.times = 1;
    await expect(create()).rejects.toThrow("Stripe is down");
    expect(await db.select().from(ledger).where(eq(ledger.kind, "invoice"))).toEqual([]);

    expect(await create()).toMatchObject({ invoiceId: "in_1" });
    expect(invoices).toHaveLength(1);
    expect(items).toHaveLength(2);
    expect(new Set(keys)).toEqual(new Set([`${ACTION}-customer`, ACTION, `${ACTION}-due-now`, `${ACTION}-when-granted`, `${ACTION}-finalize`]));
  });

  test("does not record an invoice whose total is not the fee", async (db) => {
    await seedApprovedInvoice(db);
    const fake = fakeStripe();
    (fake.api as { invoices: { finalizeInvoice: unknown } }).invoices.finalizeInvoice = async (id: string) => ({ id, total: 1 });
    const [invoice] = financeInvoiceTools({ db, gate: async () => createApprovalGate(db), stripe: () => fake.api });

    await expect(invoice!.handler({ actionId: ACTION }, CTX)).rejects.toThrow("not the 1024961 cent fee");
    expect(await db.select().from(ledger).where(eq(ledger.kind, "invoice"))).toEqual([]);
  });

  test("refuses a later run for a customer already invoiced, and bills nothing", async (db) => {
    await seedApprovedInvoice(db);
    await setup(db).create();
    const later = "run-2";
    await db.insert(runs).values({ id: later, customerId: CUSTOMER_ID, platform: "local", trigger: "schedule", status: "running" });
    await seedAction(db, `invoice-${later}`, "invoice");
    await approve(db, [`invoice-${later}`], "approved", later);
    const { create, invoices } = setup(db);

    await expect(create(`invoice-${later}`, { runId: later, agent: "finance" })).rejects.toThrow(`already invoiced by ${ACTION}`);
    expect(invoices).toEqual([]);
  });

  test("refuses when record_savings has not written a fee, or wrote a zero one", async (db) => {
    await seedRun(db, RUN);
    await seedAction(db, ACTION, "invoice");
    await approve(db, [ACTION]);
    const { create, invoices } = setup(db);

    await expect(create()).rejects.toThrow("Call record_savings first");
    await recordSavings(db);
    await expect(create()).rejects.toThrow("Call record_savings first");
    expect(invoices).toEqual([]);
  });

  test("another customer's ledger stays out of it", async (db) => {
    await seedApprovedInvoice(db);
    await seedRun(db, "run-2");
    await seedFinding(db, "theirs", "unusedLines", "won", 0, 5_000, "customer-run-2");
    await recordSavings(db, { runId: "run-2", agent: "finance" });

    expect(await setup(db).create()).toMatchObject({ amountCents: 1_024_961, dueNowCents: 248_400 });
  });

  describe("is blocked without its approved bundle", () => {
    const blocked = async (db: Db, actionId = ACTION) => {
      const { create, invoices, keys } = setup(db);
      await expect(create(actionId)).rejects.toThrow();
      expect(invoices).toEqual([]);
      expect(keys).toEqual([]);
    };

    test("with no approval", async (db) => {
      await seedRealFigures(db);
      await seedAction(db, ACTION, "invoice");
      await blocked(db);
    });

    test("with a pending approval", async (db) => {
      await seedRealFigures(db);
      await seedAction(db, ACTION, "invoice");
      await approve(db, [ACTION], "pending");
      await blocked(db);
    });

    test("with a denied approval", async (db) => {
      await seedRealFigures(db);
      await seedAction(db, ACTION, "invoice");
      await approve(db, [ACTION], "denied");
      await blocked(db);
    });

    test("with the action outside the bundle", async (db) => {
      await seedRealFigures(db);
      await seedAction(db, ACTION, "invoice");
      await seedAction(db, "call-1", "call");
      await approve(db, ["call-1"]);
      await blocked(db);
    });

    test("with another run's approval", async (db) => {
      await seedRealFigures(db);
      await seedAction(db, ACTION, "invoice");
      await seedRun(db, "run-2");
      await approve(db, [ACTION], "approved", "run-2");
      await blocked(db);
    });

    test("with an approved action of another kind", async (db) => {
      await seedRealFigures(db);
      await seedAction(db, "call-1", "call");
      await approve(db, ["call-1"]);
      await blocked(db, "call-1");
    });

    test("with an approved invoice action that is not this run's", async (db) => {
      await seedRealFigures(db);
      await seedAction(db, "invoice-other", "invoice");
      await approve(db, ["invoice-other"]);
      await blocked(db, "invoice-other");
    });
  });

  describe("refuses any key that is not a test key", () => {
    it.each(["sk_live_abc", "rk_test_abc", "pk_test_abc", " sk_test_abc", "", undefined])("%j, before anything else and without showing it", async (key) => {
      vi.stubEnv("STRIPE_SECRET_KEY", key as string);
      const stripe = vi.fn();
      const gate = vi.fn();
      const [invoice] = financeInvoiceTools({ db: {} as Db, gate, stripe });

      const message = await (invoice!.handler({ actionId: ACTION }, CTX) as Promise<unknown>).catch((error: Error) => error.message);
      expect(message).toContain("Stripe runs in test mode only");
      if (key) expect(message).not.toContain(key);
      expect(stripe).not.toHaveBeenCalled();
      expect(gate).not.toHaveBeenCalled();
    });

    test("at run start, so no agent works and the run ends in error", async (db) => {
      await seedRun(db, RUN);
      vi.stubEnv("STRIPE_SECRET_KEY", "sk_live_abc");
      const logged = vi.spyOn(console, "error").mockImplementation(() => {});
      const run = vi.fn();
      const audit: Audit = { record: async () => {}, list: async () => [] };

      expect(await executeRun({ db, runId: RUN, prompt: "p", runtime: { run } as never, audit, tools: [] })).toBe("error");
      expect(run).not.toHaveBeenCalled();
      expect((await db.select().from(runs).where(eq(runs.id, RUN)))[0]!.status).toBe("error");
      expect(logged.mock.calls.map(([, error]) => String(error)).join()).toContain("test mode only");
      expect(logged.mock.calls.map(([, error]) => String(error)).join()).not.toContain("sk_live_abc");
      logged.mockRestore();
    });

    it("but a live key never breaks the tool scan at import", async () => {
      vi.stubEnv("STRIPE_SECRET_KEY", "sk_live_abc");
      vi.stubEnv("PLATFORM", "not-a-platform");
      const names = (await loadTools()).map((tool) => tool.name);
      expect(names).toEqual(expect.arrayContaining(["create_invoice", "card_pay"]));
    });
  });

  it("its schema refuses an amount from the model", () => {
    const { inputSchema } = financeInvoiceTools()[0]!;
    expect(inputSchema.safeParse({ actionId: ACTION }).success).toBe(true);
    expect(inputSchema.safeParse({ actionId: ACTION, amountCents: 100 }).success).toBe(false);
    expect(inputSchema.safeParse({}).success).toBe(false);
  });
});

/** Stripe's REST API on a stubbed fetch, so the real SDK's retries run and nothing leaves this machine. */
function stripeRest(fail: (attempt: number, path: string) => number | null) {
  const saved = new Map<string, { object: string }>();
  const requests: { path: string; key: string | null }[] = [];
  let totalCents = 0;
  const make = (path: string, body: URLSearchParams) => {
    if (path === "/v1/customers") return { id: "cus_1", object: "customer" };
    if (path === "/v1/invoices") return { id: "in_1", object: "invoice" };
    if (path === "/v1/invoiceitems") {
      totalCents += Number(body.get("amount"));
      return { id: `ii_${totalCents}`, object: "invoiceitem" };
    }
    return { id: "in_1", object: "finalized", total: totalCents, hosted_invoice_url: "https://invoice.stripe.com/x" };
  };
  const stub = (async (url: string | URL, init?: RequestInit) => {
    const { pathname } = new URL(String(url));
    const key = new Headers(init?.headers).get("idempotency-key");
    requests.push({ path: pathname, key });
    const status = fail(requests.length, pathname);
    if (status !== null) return new Response(JSON.stringify({ error: { type: "api_error", message: "Stripe is down for key sk_test_fake" } }), { status });
    if (key && !saved.has(key)) saved.set(key, make(pathname, new URLSearchParams(String(init?.body ?? ""))));
    return new Response(JSON.stringify(saved.get(key!)), { status: 200, headers: { "content-type": "application/json" } });
  }) as typeof fetch;
  return { client: (key: string) => stripeClient(key, Stripe.createFetchHttpClient(stub)), requests, created: (object: string) => [...saved.values()].filter((made) => made.object === object) };
}

describe("a Stripe failure", () => {
  const setupRest = (db: Db, rest: ReturnType<typeof stripeRest>) => {
    const decide = vi.fn();
    const gate = { ...createApprovalGate(db), decide };
    const [invoice] = financeInvoiceTools({ db, gate: async () => gate, stripe: rest.client, card: async () => ({ charge: vi.fn() }) });
    return { decide, create: () => invoice!.handler({ actionId: ACTION }, CTX) as Promise<Record<string, unknown>> };
  };
  const runCards = (db: Db) => db.select().from(boardCards).where(eq(boardCards.agent, "run"));

  test("is retried by the real SDK with the same key, and makes one invoice", async (db) => {
    await seedApprovedInvoice(db);
    const rest = stripeRest((attempt) => (attempt === 1 ? 500 : null));
    expect(await setupRest(db, rest).create()).toMatchObject({ invoiceId: "in_1", amountCents: 1_024_961 });
    expect(rest.requests[0]).toEqual(rest.requests[1]);
    expect(rest.requests[0]!.key).toBeTruthy();
    expect(await runCards(db)).toEqual([]);
    expect(await db.$count(ledger, eq(ledger.kind, "invoice"))).toBe(1);
  });

  test("that lasts shows a plain card with no Stripe text, and a later repeat bills once and asks nobody again", async (db) => {
    await seedApprovedInvoice(db);
    let down = true;
    const rest = stripeRest(() => (down ? 500 : null));
    const { create, decide } = setupRest(db, rest);

    await expect(create()).rejects.toThrow();
    const [card] = await runCards(db);
    expect(card).toMatchObject({ status: "blocked", title: expect.stringContaining("Stripe did not confirm the invoice") });
    expect(card!.title).not.toContain("sk_test");
    expect(await db.$count(ledger, eq(ledger.kind, "invoice"))).toBe(0);
    expect((await db.select().from(actions).where(eq(actions.id, ACTION)))[0]!.status).toBe("proposed");

    down = false;
    expect(await create()).toMatchObject({ invoiceId: "in_1" });
    expect(await create()).toMatchObject({ invoiceId: "in_1", repeated: true });
    expect(await db.$count(ledger, eq(ledger.kind, "invoice"))).toBe(1);
    expect(rest.created("invoice")).toHaveLength(1);
    expect(await db.$count(approvals)).toBe(1);
    expect(decide).not.toHaveBeenCalled();
  });

  for (const failing of ["/v1/invoiceitems", "/v1/invoices/in_1/finalize"]) {
    test(`at ${failing}, after the draft exists, does not claim Stripe has no invoice, and a repeat finishes that same draft`, async (db) => {
      await seedApprovedInvoice(db);
      let down = true;
      const rest = stripeRest((_attempt, path) => (down && path === failing ? 500 : null));
      const { create } = setupRest(db, rest);

      await expect(create()).rejects.toThrow();
      expect(rest.created("invoice")).toHaveLength(1);
      const [card] = await runCards(db);
      expect(card!.title).toContain("may be unfinished in Stripe");
      expect(card!.title).not.toContain("did not create");
      expect(await db.$count(ledger, eq(ledger.kind, "invoice"))).toBe(0);

      down = false;
      expect(await create()).toMatchObject({ invoiceId: "in_1" });
      expect(rest.created("invoice")).toHaveLength(1);
    });
  }

  test("a refusal of ours is not reported as Stripe's", async (db) => {
    await seedRun(db, RUN);
    await expect(setupRest(db, stripeRest(() => null)).create()).rejects.toThrow("not in an approved bundle");
    expect(await runCards(db)).toEqual([]);
  });
});

describe("card_pay", () => {
  const PAY = "pay-1";
  const PAYLOAD = { amountCents: 200, description: "API credit" };
  const seedPay = async (db: Db, status: "approved" | "pending" | "denied" = "approved", payload: unknown = PAYLOAD) => {
    await seedRun(db, RUN);
    await seedAction(db, PAY, "card_pay", payload);
    await approve(db, [PAY], status);
  };

  test("charges the amount in the approved action through Card, and writes card_spend", async (db) => {
    await seedPay(db);
    const { pay, charge } = setup(db);

    expect(await pay(PAY)).toMatchObject({ actionId: PAY, ledgerId: expect.any(String) });
    expect(charge).toHaveBeenCalledWith({ customerId: CUSTOMER_ID, ...PAYLOAD });
    expect(await db.select().from(ledger).where(eq(ledger.kind, "card_spend"))).toMatchObject([{ amountCents: 200, customerId: CUSTOMER_ID }]);
    expect((await db.select().from(actions).where(eq(actions.id, PAY)))[0]!.status).toBe("done");
  });

  test("a retry does not charge again", async (db) => {
    await seedPay(db);
    const { pay, charge } = setup(db);
    await Promise.all([pay(PAY), pay(PAY)]);

    expect(await pay(PAY)).toMatchObject({ repeated: true });
    expect(charge).toHaveBeenCalledTimes(1);
    expect(await db.select().from(ledger).where(eq(ledger.kind, "card_spend"))).toHaveLength(1);
  });

  test("a failed update after the charge stays claimed, and a retry refuses without charging again", async (db) => {
    await seedPay(db);
    const { pay, charge } = setup(db);
    const realUpdate = db.update.bind(db);
    vi.spyOn(db, "update")
      .mockImplementationOnce(realUpdate)
      .mockImplementationOnce(() => ({ set: () => ({ where: () => Promise.reject(new Error("db down")) }) }) as never);

    await expect(pay(PAY)).rejects.toThrow("db down");
    await expect(pay(PAY)).rejects.toThrow("A human must check");
    expect(charge).toHaveBeenCalledTimes(1);
    expect(await db.select().from(ledger).where(eq(ledger.kind, "card_spend"))).toHaveLength(1);
    expect((await db.select().from(actions).where(eq(actions.id, PAY)))[0]!.status).toBe("running");
  });

  test("a charge over the cap is refused and stays claimed for a human to check", async (db) => {
    await seedPay(db, "approved", { amountCents: 100_000, description: "Too much" });
    await expect(setup(db).pay(PAY)).rejects.toThrow("cap");
    expect((await db.select().from(actions).where(eq(actions.id, PAY)))[0]!.status).toBe("running");
  });

  test("is blocked with no approval", async (db) => {
    await seedRun(db, RUN);
    await seedAction(db, PAY, "card_pay", PAYLOAD);
    const { pay, charge } = setup(db);
    await expect(pay(PAY)).rejects.toThrow("not in an approved bundle");
    expect(charge).not.toHaveBeenCalled();
  });

  test("is blocked with a pending approval", async (db) => {
    await seedPay(db, "pending");
    const { pay, charge } = setup(db);
    await expect(pay(PAY)).rejects.toThrow("not in an approved bundle");
    expect(charge).not.toHaveBeenCalled();
  });

  test("is blocked with a denied approval", async (db) => {
    await seedPay(db, "denied");
    const { pay, charge } = setup(db);
    await expect(pay(PAY)).rejects.toThrow("not in an approved bundle");
    expect(charge).not.toHaveBeenCalled();
  });

  test("is refused for an approved action of another kind, or a bad payload", async (db) => {
    await seedRun(db, RUN);
    await seedAction(db, ACTION, "invoice");
    await seedAction(db, PAY, "card_pay", { amountCents: -5, description: "x" });
    await approve(db, [ACTION, PAY]);
    const { pay, charge } = setup(db);

    await expect(pay(ACTION)).rejects.toThrow("not one");
    await expect(pay(PAY)).rejects.toThrow();
    expect(charge).not.toHaveBeenCalled();
  });

  it("its schema refuses an amount from the model", () => {
    const { inputSchema } = financeInvoiceTools()[1]!;
    expect(inputSchema.safeParse({ actionId: PAY, amountCents: 100 }).success).toBe(false);
  });
});
