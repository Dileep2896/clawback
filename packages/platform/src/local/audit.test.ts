import type { Db } from "@bill-fighter/db/client";
import { auditLog } from "@bill-fighter/db/schema";
import { seedRun, withTestDb } from "@bill-fighter/db/test-db";
import { describe, expect, it } from "vitest";
import { createAudit } from "./audit.ts";

const test = (name: string, fn: (db: Db) => Promise<void>) => it(name, () => withTestDb("audit", fn));

describe("Audit", () => {
  test("records a tool call with its cost and lists it", async (db) => {
    await seedRun(db, "run");
    const audit = createAudit(db);
    await audit.record({ runId: "run", agent: "ceo", tool: "board_update", input: { a: 1 }, output: [2], costUsd: 0.000123 });
    expect(await audit.list("run")).toMatchObject([
      { runId: "run", agent: "ceo", tool: "board_update", inputJson: { a: 1 }, outputJson: [2], costUsd: 0.000123 },
    ]);
  });

  test("input, output and cost are optional", async (db) => {
    await seedRun(db, "run");
    const audit = createAudit(db);
    await audit.record({ runId: "run", agent: "ceo", tool: "ping" });
    expect(await audit.list("run")).toMatchObject([{ inputJson: null, outputJson: null, costUsd: 0 }]);
  });

  test("lists one run's entries in order", async (db) => {
    await seedRun(db, "run");
    await seedRun(db, "other");
    const audit = createAudit(db);
    await audit.record({ runId: "run", agent: "ceo", tool: "first" });
    await audit.record({ runId: "other", agent: "ceo", tool: "elsewhere" });
    await audit.record({ runId: "run", agent: "ceo", tool: "second" });
    expect((await audit.list("run")).map((entry) => entry.tool)).toEqual(["first", "second"]);
  });

  test("keeps an entry with no run", async (db) => {
    await createAudit(db).record({ runId: null, agent: "webhook", tool: "inbound" });
    expect(await db.select().from(auditLog)).toMatchObject([{ runId: null, tool: "inbound" }]);
  });

  test("an unknown run id throws rather than storing the entry detached", async (db) => {
    await expect(createAudit(db).record({ runId: "ghost", agent: "ceo", tool: "x" })).rejects.toThrow();
  });
});
