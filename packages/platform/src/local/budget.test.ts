import type { Db } from "@bill-fighter/db/client";
import { seedRun, withTestDb } from "@bill-fighter/db/test-db";
import { afterEach, describe, expect, it, vi } from "vitest";
import { createBudget } from "./budget.ts";

const test = (name: string, fn: (db: Db) => Promise<void>) => it(name, () => withTestDb("budget", fn));

afterEach(() => vi.unstubAllEnvs());

describe("Budget", () => {
  test("reports the running total and signals at and over RUN_BUDGET_USD", async (db) => {
    vi.stubEnv("RUN_BUDGET_USD", "1");
    await seedRun(db, "run");
    const budget = createBudget(db);
    expect(await budget.status("run")).toEqual({ totalUsd: 0, capUsd: 1, over: false });
    expect(await budget.add("run", 0.25)).toEqual({ totalUsd: 0.25, capUsd: 1, over: false });
    expect(await budget.add("run", 0.75)).toEqual({ totalUsd: 1, capUsd: 1, over: true });
    expect(await budget.add("run", 0.5)).toEqual({ totalUsd: 1.5, capUsd: 1, over: true });
    expect(await budget.status("run")).toEqual({ totalUsd: 1.5, capUsd: 1, over: true });
  });

  test("concurrent adds lose nothing", async (db) => {
    await seedRun(db, "run");
    const budget = createBudget(db);
    await Promise.all(Array.from({ length: 20 }, () => budget.add("run", 0.01)));
    expect((await budget.status("run")).totalUsd).toBe(0.2);
  });

  test("defaults the cap to 5 when unset", async (db) => {
    vi.stubEnv("RUN_BUDGET_USD", "");
    await seedRun(db, "run");
    expect((await createBudget(db).status("run")).capUsd).toBe(5);
  });

  it.each(["abc", "0", "-1", "Infinity"])("throws on RUN_BUDGET_USD=%s", async (value) => {
    vi.stubEnv("RUN_BUDGET_USD", value);
    await withTestDb("budget", async (db) => {
      await seedRun(db, "run");
      await expect(createBudget(db).status("run")).rejects.toThrow(/RUN_BUDGET_USD/);
    });
  });

  test("throws on an unknown run instead of reporting no spend", async (db) => {
    const budget = createBudget(db);
    await expect(budget.status("ghost")).rejects.toThrow(/ghost/);
    await expect(budget.add("ghost", 1)).rejects.toThrow(/ghost/);
  });

  test("refuses a cost that would lower the total", async (db) => {
    await seedRun(db, "run");
    const budget = createBudget(db);
    await expect(budget.add("run", -1)).rejects.toThrow(/Invalid cost/);
    await expect(budget.add("run", Number.NaN)).rejects.toThrow(/Invalid cost/);
  });
});
