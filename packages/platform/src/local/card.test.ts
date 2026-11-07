import type { Db } from "@bill-fighter/db/client";
import { ledger } from "@bill-fighter/db/schema";
import { seedRun, withTestDb } from "@bill-fighter/db/test-db";
import { afterEach, describe, expect, it, vi } from "vitest";
import { createCard } from "./card.ts";

const test = (name: string, fn: (db: Db) => Promise<void>) => it(name, () => withTestDb("card", fn));

const setup = async (db: Db) => {
  vi.stubEnv("NAIVE_CARD_CAP_USD", "5");
  const { customerId } = await seedRun(db, "run");
  const charge = (amountCents: number) => createCard(db).charge({ customerId, amountCents, description: "API credit" });
  return { customerId, charge };
};

afterEach(() => vi.unstubAllEnvs());

describe("Card", () => {
  test("writes card_spend to the ledger, with what was bought", async (db) => {
    const { customerId, charge } = await setup(db);
    const { ledgerId } = await charge(300);
    expect(await db.select().from(ledger)).toMatchObject([
      { id: ledgerId, customerId, kind: "card_spend", amountCents: 300, description: "API credit", findingId: null },
    ]);
  });

  test("refuses a charge over the cap and writes nothing", async (db) => {
    const { charge } = await setup(db);
    await expect(charge(501)).rejects.toThrow(/refused/);
    expect(await db.select().from(ledger)).toEqual([]);
  });

  test("the cap is cumulative: spend up to it passes, one cent more does not", async (db) => {
    const { charge } = await setup(db);
    await charge(300);
    await charge(200);
    await expect(charge(1)).rejects.toThrow(/refused/);
    expect(await db.select().from(ledger)).toHaveLength(2);
  });

  test("other ledger kinds do not count against the cap", async (db) => {
    const { customerId, charge } = await setup(db);
    await db.insert(ledger).values({ customerId, kind: "savings", amountCents: 1_000_000 });
    await charge(500);
  });

  test("charges that fit alone but not together: exactly one goes through", async (db) => {
    const { charge } = await setup(db);
    const results = await Promise.allSettled([charge(300), charge(300), charge(300)]);
    expect(results.filter((result) => result.status === "fulfilled")).toHaveLength(1);
    expect(await db.select().from(ledger)).toHaveLength(1);
  });

  test("refuses an amount that is not positive whole cents", async (db) => {
    const { charge } = await setup(db);
    for (const amount of [0, -100, 1.5, Number.NaN]) await expect(charge(amount)).rejects.toThrow(/Invalid/);
    expect(await db.select().from(ledger)).toEqual([]);
  });

  test("defaults the cap to 5 dollars when unset", async (db) => {
    const { charge } = await setup(db);
    vi.stubEnv("NAIVE_CARD_CAP_USD", "");
    await charge(500);
    await expect(charge(1)).rejects.toThrow(/500 cent cap/);
  });

  test("throws on an invalid cap instead of charging", async (db) => {
    const { charge } = await setup(db);
    vi.stubEnv("NAIVE_CARD_CAP_USD", "lots");
    await expect(charge(100)).rejects.toThrow(/NAIVE_CARD_CAP_USD/);
    expect(await db.select().from(ledger)).toEqual([]);
  });
});
