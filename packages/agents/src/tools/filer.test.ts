import { mkdtempSync, readdirSync, readFileSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join, resolve } from "node:path";
import { setTimeout as sleep } from "node:timers/promises";
import { pdfText } from "@bill-fighter/core/parser/pdf";
import { runAudit } from "@bill-fighter/core/rules/index";
import { dollars } from "@bill-fighter/core/rules/input";
import type { Db } from "@bill-fighter/db/client";
import { accounts, actions, approvals, customers, findings } from "@bill-fighter/db/schema";
import { withTestDb } from "@bill-fighter/db/test-db";
import { createApprovalGate } from "@bill-fighter/platform/local/approval-gate";
import { isGatedTool } from "@bill-fighter/shared/gated-tools";
import { eq } from "drizzle-orm";
import { PDFDocument } from "pdf-lib";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { loadAuditInput } from "../audit-input.ts";
import { assertNoOwnNumbers } from "../letters/numbers.ts";
import { renderLetter } from "../letters/render.ts";
import { loadTools } from "../registry.ts";
import { ALARM_NUMBER, amountsOf, FAX_NUMBER, LINE_AMOUNTS, METER_AMOUNTS, RATE_AMOUNTS, run, seedFindings } from "../test-fixtures.ts";
import { filerTools, letterActionId } from "./filer.ts";

const RUN = "run";
const REPO_ROOT = resolve(import.meta.dirname, "../../../..");
const WORDING = "We ask you to act on this request under Rule 17.1 and Rule 12 as the facts below show.";

type Drafted = { actionId: string; kind: string; path: string };

let dir: string;
beforeEach(() => {
  dir = mkdtempSync(join(tmpdir(), "letters-"));
});
afterEach(() => rmSync(dir, { recursive: true }));

async function setup(db: Db) {
  const gate = createApprovalGate(db);
  const tools = filerTools({ db, gate: async () => gate, lettersDir: dir });
  const seeded = await seedFindings(db, RUN, dir);
  const call = (name: string, input: unknown, runId = RUN) => run(tools, name, input, runId);
  const draft = async (name: string, wording = WORDING): Promise<Drafted> => {
    const [letter] = (await call("draft_letter", { letters: [{ findingId: seeded.id(name), wording }] })) as Drafted[];
    return letter!;
  };
  return { ...seeded, gate, tools, call, draft };
}

const test = (name: string, fn: (db: Db) => Promise<void>) => it(name, () => withTestDb("tools_file_approve_filer", fn));

const read = (path: string) => readFileSync(resolve(REPO_ROOT, path));
const textOf = (path: string) => pdfText(read(path));
const pages = async (path: string) => (await PDFDocument.load(read(path))).getPageCount();

describe("draft_letter", () => {
  test("a Rule 17.1 claim holds exactly the finding's amounts", async (db) => {
    const { draft, id } = await setup(db);
    const letter = await draft("meter");
    expect(letter.kind).toBe("claim");
    expect(letter.actionId).toBe(letterActionId(RUN, id("meter")));
    const text = await textOf(letter.path);
    expect(text).toContain("Rule 17.1");
    expect(text).toContain(`E-${RUN}`);
    expect(new Set(amountsOf(text))).toEqual(new Set(METER_AMOUNTS));
  });

  test("a Rule 12 request holds exactly the finding's amounts", async (db) => {
    const { draft } = await setup(db);
    const letter = await draft("rate");
    expect(letter.kind).toBe("plan_change");
    const text = await textOf(letter.path);
    expect(text).toContain("Rule 12");
    expect(new Set(amountsOf(text))).toEqual(new Set(RATE_AMOUNTS));
  });

  test("a cancellation holds exactly the finding's amounts, and no alarm line", async (db) => {
    const { draft } = await setup(db);
    const letter = await draft("unused");
    expect(letter.kind).toBe("letter");
    const text = await textOf(letter.path);
    expect(text).toContain(FAX_NUMBER);
    expect(text).not.toContain(ALARM_NUMBER);
    expect(new Set(amountsOf(text))).toEqual(new Set(LINE_AMOUNTS));
  });

  test("refuses alarm lines, also when the finding wrongly says cancel, and writes nothing", async (db) => {
    const { draft } = await setup(db);
    await expect(draft("alarm")).rejects.toThrow(/Alarm lines are never cancelled/);
    await expect(draft("alarm-mislabelled")).rejects.toThrow(/Alarm lines are never cancelled/);
    expect(await db.select().from(actions)).toEqual([]);
    expect(readdirSync(dir).filter((file) => file.startsWith("letter-"))).toEqual([]);
  });

  test("refuses types that get no letter", async (db) => {
    const { draft } = await setup(db);
    await expect(draft("promo")).rejects.toThrow(/get no letter/);
    await expect(draft("supplier")).rejects.toThrow(/get no letter/);
  });

  test("refuses wording with its own numbers, and one bad letter stops the whole batch", async (db) => {
    const { call, id } = await setup(db);
    const letters = [
      { findingId: id("rate"), wording: WORDING },
      { findingId: id("meter"), wording: "You owe us $12,600." },
    ];
    await expect(call("draft_letter", { letters })).rejects.toThrow(/\$12,600/);
    expect(await db.select().from(actions)).toEqual([]);
  });

  test("refuses another customer's finding", async (db) => {
    const { call } = await setup(db);
    await seedFindings(db, "other", dir);
    await expect(call("draft_letter", { letters: [{ findingId: "other-meter", wording: WORDING }] })).rejects.toThrow(/not a finding of this run/);
  });

  test("waits for an audit holding the customer lock, so it never drafts on a finding the audit removed", async (db) => {
    const { draft, id } = await setup(db);
    const [finding] = await db.select().from(findings).where(eq(findings.id, id("meter")));
    let drafting!: Promise<void>;
    await db.transaction(async (tx) => {
      await tx.select({ id: customers.id }).from(customers).where(eq(customers.id, finding!.customerId)).for("update");
      drafting = expect(draft("meter")).rejects.toThrow(/not a finding of this run/);
      // Without the lock, this is long enough for the draft to read the finding and create its action.
      await sleep(200);
      await tx.delete(findings).where(eq(findings.id, id("meter")));
    });
    await drafting;
    expect(await db.select().from(actions)).toEqual([]);
  });

  test("a redraft overwrites its one action, and odd characters cannot crash the render", async (db) => {
    const { draft } = await setup(db);
    await draft("meter");
    await draft("meter", "Please act — 請 — on this claim.\n\nThank you.");
    expect(await db.select().from(actions)).toHaveLength(1);
  });

  test("long wording runs onto another page", async (db) => {
    const { draft } = await setup(db);
    const letter = await draft("meter", "Please review this claim carefully. ".repeat(110));
    expect(await pages(letter.path)).toBeGreaterThan(1);
  });

  test("letters cannot change once approval has been asked for", async (db) => {
    const { draft, gate } = await setup(db);
    const { actionId } = await draft("meter");
    await gate.createBundle({ runId: RUN, actionIds: [actionId], summary: "s" });
    await expect(draft("meter", "Different wording.")).rejects.toThrow(/can no longer change/);
  });
});

describe("attach_evidence", () => {
  test("appends each bill, and repeating does not double the pages", async (db) => {
    const { draft, call } = await setup(db);
    const { actionId, path } = await draft("meter");
    await call("attach_evidence", { actionIds: [actionId] });
    const [{ evidencePath }] = (await call("attach_evidence", { actionIds: [actionId] })) as [{ evidencePath: string }];
    expect(await pages(evidencePath)).toBe((await pages(path)) + 2);
    const text = await textOf(evidencePath);
    expect(text).toContain("Bill bill-a");
    expect(text).toContain("Bill bill-b");
    const [action] = await db.select().from(actions).where(eq(actions.id, actionId));
    expect(action!.payloadJson).toMatchObject({ evidencePath, billIds: [`${RUN}-bill-a`, `${RUN}-bill-b`] });
  });

  test("names a bill whose PDF is missing", async (db) => {
    const { draft, call, id } = await setup(db);
    const { actionId } = await draft("meter");
    rmSync(join(dir, `${id("bill-b")}.pdf`));
    await expect(call("attach_evidence", { actionIds: [actionId] })).rejects.toThrow(`Bill ${id("bill-b")}`);
  });

  test("refuses another run's letter, also when this run's id is a prefix of that run's", async (db) => {
    const { draft, call } = await setup(db);
    await seedFindings(db, "other", dir);
    const { actionId } = await draft("meter");
    await expect(call("attach_evidence", { actionIds: [actionId] }, "other")).rejects.toThrow(/not a letter of this run/);

    const prefixed = `${RUN}-2`;
    const { id } = await seedFindings(db, prefixed, dir);
    const longer = letterActionId(prefixed, id("meter"));
    await db.insert(actions).values({ id: longer, findingId: id("meter"), kind: "claim", status: "proposed", payloadJson: { letterPath: "unused.pdf" } });
    await expect(call("attach_evidence", { actionIds: [longer] })).rejects.toThrow(/not a letter of this run/);
  });

  test("the approved PDF cannot change once the action is in a bundle, even when its source evidence does", async (db) => {
    const { draft, call, gate, id } = await setup(db);
    const { actionId } = await draft("meter");
    const [{ evidencePath }] = (await call("attach_evidence", { actionIds: [actionId] })) as [{ evidencePath: string }];
    const [before] = await db.select().from(actions).where(eq(actions.id, actionId));
    const pdfBefore = read(evidencePath);
    await gate.createBundle({ runId: RUN, actionIds: [actionId], summary: "s" });

    const changed = await PDFDocument.create();
    changed.addPage().drawText("A different bill");
    writeFileSync(join(dir, `${id("bill-a")}.pdf`), await changed.save());
    const [finding] = await db.select().from(findings).where(eq(findings.id, id("meter")));
    const evidence = finding!.evidenceJson as { billIds: string[] };
    await db.update(findings).set({ evidenceJson: { ...evidence, billIds: [id("bill-a")] } }).where(eq(findings.id, id("meter")));

    await expect(call("attach_evidence", { actionIds: [actionId] })).rejects.toThrow(/can no longer change/);
    await gate.decide({ runId: RUN, status: "approved", channel: "dashboard", approvedBy: "Linda" });
    await expect(call("attach_evidence", { actionIds: [actionId] })).rejects.toThrow(/can no longer change/);

    expect(read(evidencePath).equals(pdfBefore)).toBe(true);
    expect((await db.select().from(actions).where(eq(actions.id, actionId)))[0]!.payloadJson).toEqual(before!.payloadJson);
    await expect(call("submit_claim", { actionId })).resolves.toMatchObject({ status: "done" });
  });
});

describe("submit_claim and change_rate_plan", () => {
  it("are gated tools that need an actionId and contact nobody", async () => {
    for (const name of ["submit_claim", "change_rate_plan"]) {
      const tool = filerTools().find((candidate) => candidate.name === name)!;
      expect(isGatedTool(name)).toBe(true);
      expect(() => tool.inputSchema.parse({})).toThrow();
      expect(tool.targets({ actionId: "a" })).toEqual([]);
    }
  });

  const ready = async (db: Db, finding: "meter" | "rate") => {
    const ctx = await setup(db);
    const { actionId } = await ctx.draft(finding);
    await ctx.call("attach_evidence", { actionIds: [actionId] });
    return { ...ctx, actionId, findingId: ctx.id(finding) };
  };
  const statuses = async (db: Db, actionId: string, findingId: string) => ({
    action: (await db.select().from(actions).where(eq(actions.id, actionId)))[0]!.status,
    finding: (await db.select().from(findings).where(eq(findings.id, findingId)))[0]!.status,
  });

  test("refuse with no bundle, while pending and when denied", async (db) => {
    const { call, gate, actionId, findingId } = await ready(db, "meter");
    await expect(call("submit_claim", { actionId })).rejects.toThrow(/not in an approved bundle/);
    await gate.createBundle({ runId: RUN, actionIds: [actionId], summary: "s" });
    await expect(call("submit_claim", { actionId })).rejects.toThrow(/not in an approved bundle/);
    await gate.decide({ runId: RUN, status: "denied", channel: "dashboard", approvedBy: "Linda" });
    await expect(call("submit_claim", { actionId })).rejects.toThrow(/not in an approved bundle/);
    expect(await statuses(db, actionId, findingId)).toEqual({ action: "proposed", finding: "proposed" });
  });

  test("refuse an action approved only for another run, from a run with no bundle or a denied one", async (db) => {
    const { call, gate, actionId, findingId } = await ready(db, "meter");
    await seedFindings(db, "other", dir);
    await gate.createBundle({ runId: RUN, actionIds: [actionId], summary: "s" });
    await gate.decide({ runId: RUN, status: "approved", channel: "dashboard", approvedBy: "Linda" });

    await expect(call("submit_claim", { actionId }, "other")).rejects.toThrow(/not in an approved bundle/);
    await gate.createBundle({ runId: "other", actionIds: [actionId], summary: "s" });
    await gate.decide({ runId: "other", status: "denied", channel: "dashboard", approvedBy: "Linda" });
    await expect(call("submit_claim", { actionId }, "other")).rejects.toThrow(/not in an approved bundle/);
    expect(await statuses(db, actionId, findingId)).toEqual({ action: "proposed", finding: "proposed" });
  });

  test("refuse an action the run's own approved bundle does not hold", async (db) => {
    const { draft, call, gate, actionId } = await ready(db, "meter");
    const { actionId: planId } = await draft("rate");
    await call("attach_evidence", { actionIds: [planId] });
    await gate.createBundle({ runId: RUN, actionIds: [actionId], summary: "s" });
    await gate.decide({ runId: RUN, status: "approved", channel: "dashboard", approvedBy: "Linda" });
    await expect(call("change_rate_plan", { actionId: planId })).rejects.toThrow(/not in an approved bundle/);
  });

  test("one approval releases both, changing only status columns, and a repeat changes nothing", async (db) => {
    const { draft, call, gate, actionId, findingId, id } = await ready(db, "meter");
    const { actionId: planId } = await draft("rate");
    await call("attach_evidence", { actionIds: [planId] });
    await gate.createBundle({ runId: RUN, actionIds: [actionId, planId], summary: "s" });
    await gate.decide({ runId: RUN, status: "approved", channel: "dashboard", approvedBy: "Linda" });

    const before = await db.select().from(accounts).where(eq(accounts.id, id("electric")));
    await call("submit_claim", { actionId });
    await call("submit_claim", { actionId });
    await call("change_rate_plan", { actionId: planId });
    expect(await statuses(db, actionId, findingId)).toEqual({ action: "done", finding: "filed" });
    expect(await statuses(db, planId, id("rate"))).toEqual({ action: "done", finding: "filed" });
    expect(await db.select().from(accounts).where(eq(accounts.id, id("electric")))).toEqual(before);
    expect((await db.select().from(approvals))[0]!.status).toBe("approved");
  });

  test("refuse the wrong kind of action, and a claim with no evidence", async (db) => {
    const { draft, call, gate, actionId } = await ready(db, "meter");
    const { actionId: bare } = await draft("rate");
    await gate.createBundle({ runId: RUN, actionIds: [actionId, bare], summary: "s" });
    await gate.decide({ runId: RUN, status: "approved", channel: "dashboard", approvedBy: "Linda" });
    await expect(call("change_rate_plan", { actionId })).rejects.toThrow(/not a plan_change action/);
    await expect(call("change_rate_plan", { actionId: bare })).rejects.toThrow(/no evidence attached/);
  });

  test("leave a finding already won as won", async (db) => {
    const { call, gate, actionId, findingId } = await ready(db, "meter");
    await gate.createBundle({ runId: RUN, actionIds: [actionId], summary: "s" });
    await gate.decide({ runId: RUN, status: "approved", channel: "dashboard", approvedBy: "Linda" });
    await db.update(findings).set({ status: "won" }).where(eq(findings.id, findingId));
    await call("submit_claim", { actionId });
    expect((await statuses(db, actionId, findingId)).finding).toBe("won");
  });
});

describe("letters from the real audit", () => {
  // The fixtures above are hand-written, so this catches them drifting from what the rules actually write.
  it(
    "renders every lettered finding with its own amounts, seven cancellations and no alarm line",
    async () => {
      vi.spyOn(console, "info").mockImplementation(() => {});
      vi.spyOn(console, "warn").mockImplementation(() => {});
      const { findings: real } = runAudit(loadAuditInput());
      const render = (finding: (typeof real)[number]) =>
        renderLetter({ finding, accountNumber: "A-1", customerName: "Golden Gate Noodle Co.", contactName: "Linda Park", wording: WORDING });

      const lines = real.filter((f) => f.type === "unusedLines");
      const cancels = lines.filter((f) => f.evidence.detail.action === "cancel");
      const alarms = lines.filter((f) => f.evidence.detail.purpose === "alarm");
      expect(cancels).toHaveLength(7);
      expect(alarms).toHaveLength(2);
      for (const alarm of alarms) await expect(render(alarm)).rejects.toThrow();

      const lettered = [...real.filter((f) => f.type === "meterMultiplierJump" || f.type === "rateOptimization"), ...cancels];
      expect(lettered.length).toBeGreaterThanOrEqual(9);
      for (const finding of lettered) {
        const text = await pdfText(await render(finding));
        expect(amountsOf(text)).toContain(dollars(finding.annualSavingsCents));
        if (finding.refundCents > 0) expect(amountsOf(text)).toContain(dollars(finding.refundCents));
        for (const alarm of alarms) expect(text).not.toContain(String(alarm.evidence.detail.number));
      }
    },
    180_000,
  );
});

describe("assertNoOwnNumbers", () => {
  it("allows the rule names and quoted amounts only", () => {
    expect(() => assertNoOwnNumbers("Under Rule 17.1 and Rule 12, please act.")).not.toThrow();
    expect(() => assertNoOwnNumbers("Please approve $5.00.", ["$5.00"])).not.toThrow();
    for (const text of ["Rule 120 applies", "About 40 kW", "$5", "Costs $5.00 or $6.00"]) {
      expect(() => assertNoOwnNumbers(text, ["$5.00"])).toThrow(/may not hold numbers/);
    }
  });
});

describe("loading", () => {
  it("finds all eight tools with no platform available, so no import can throw", async () => {
    vi.stubEnv("PLATFORM", "not-a-platform");
    try {
      const names = (await loadTools()).map((tool) => tool.name);
      expect(names).toEqual(
        expect.arrayContaining(["draft_letter", "attach_evidence", "submit_claim", "change_rate_plan", "request_approval", "send_sms", "board_update", "send_email"]),
      );
    } finally {
      vi.unstubAllEnvs();
    }
  });
});
