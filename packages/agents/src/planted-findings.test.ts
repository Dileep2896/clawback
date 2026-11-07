import { mkdtempSync, readFileSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { runAudit, type AuditRun } from "@bill-fighter/core/rules/index";
import type { AuditInput } from "@bill-fighter/core/rules/input";
import { compareRates } from "@bill-fighter/core/rules/rate-optimization";
import { FIRST_MONTH, LAST_MONTH, METER_SWAP } from "@bill-fighter/db/seed/customer";
import { calendarMonth, generateSeed, monthsBetween, type Seed } from "@bill-fighter/db/seed/generate";
import type { FindingType } from "@bill-fighter/shared/finding";
import { beforeAll, describe, expect, it, vi } from "vitest";
import { loadAuditInput, parsedBills, totalsProblems } from "./audit-input.ts";
import { readParsedDir, type CachedParse } from "./parse-cache.ts";

const SLOW = 180_000;
const PARSED_DIR = new URL("../../../data/parsed", import.meta.url).pathname;
const FREMONT = `${METER_SWAP.storeId}-electric`;
const OAKLAND = ["oakland-1-electric", "oakland-2-electric"];

let seed: Seed;
let input: AuditInput;
let run: AuditRun;
let entries: CachedParse[];

const ofType = (type: FindingType) => run.findings.filter((f) => f.type === type);
const within1Percent = (cents: number, target: number) => expect(Math.abs(cents - target)).toBeLessThanOrEqual(target * 0.01);

beforeAll(() => {
  vi.spyOn(console, "info").mockImplementation(() => {});
  vi.spyOn(console, "warn").mockImplementation(() => {});
  seed = generateSeed();
  entries = readParsedDir(PARSED_DIR);
  input = loadAuditInput();
  run = runAudit(input);
}, SLOW);

describe("the audit over the committed parsed bills", () => {
  it("reads Fremont #1 as 16 contiguous calendar months", () => {
    const periods = input.bills
      .filter((b) => b.accountId === FREMONT)
      .map((b) => ({ start: b.periodStart, end: b.periodEnd }))
      .sort((a, b) => a.start.localeCompare(b.start));
    expect(periods).toHaveLength(16);
    expect(periods).toEqual(monthsBetween(METER_SWAP.firstMonth, LAST_MONTH).map(calendarMonth));
  });

  it("finds the Fremont #1 meter error near section 7, from exact bills and lines", () => {
    const findings = ofType("meterMultiplierJump");
    expect(findings.map((f) => f.accountId)).toEqual([FREMONT]);
    const [finding] = findings;
    within1Percent(finding!.refundCents, 1_260_000);
    within1Percent(finding!.annualSavingsCents, 1_080_000);

    const billIds = monthsBetween(METER_SWAP.swapMonth, LAST_MONTH).map((month) => `${FREMONT}-${month}`);
    expect(finding!.evidence.billIds).toEqual(billIds);
    const energyLineIds = seed.bills.filter((b) => billIds.includes(b.id)).flatMap((b) => b.lines.filter((l) => l.lineType === "energy").map((l) => l.id));
    expect([...finding!.evidence.billLineIds].sort()).toEqual(energyLineIds.sort());
  });

  it("proposes a rate change only where the calculator shows over 2%, at the calculator's figure", () => {
    const savings = OAKLAND.map((accountId) => {
      const { current, alternatives } = compareRates(input, accountId)!;
      const cheapest = Math.min(...alternatives.map((a) => a.annualCents));
      return { accountId, annualCents: current.annualCents, saved: current.annualCents - cheapest };
    }).filter(({ annualCents, saved }) => saved * 100 > annualCents * 2);

    const findings = ofType("rateOptimization");
    expect(findings.map((f) => f.accountId)).toEqual(savings.map((s) => s.accountId));
    expect(findings.map((f) => f.annualSavingsCents)).toEqual(savings.map((s) => s.saved));
  });

  it("finds seven unused lines worth $5,040 a year", () => {
    const unused = ofType("unusedLines").filter((f) => f.annualSavingsCents > 0);
    expect(unused).toHaveLength(7);
    expect(unused.reduce((sum, f) => sum + f.annualSavingsCents, 0)).toBe(504_000);
  });

  it("asks to confirm two alarm lines, at $0 with no cancel action", () => {
    const alarms = ofType("unusedLines").filter((f) => f.annualSavingsCents === 0);
    expect(alarms).toHaveLength(2);
    for (const finding of alarms) {
      expect(finding.title).toMatch(/confirm with alarm company/i);
      expect(finding.evidence.detail).toMatchObject({ action: "confirmWithAlarmCompany" });
    }
  });

  it("finds three promos worth $3,240 a year", () => {
    const promos = ofType("promoExpiry");
    expect(promos).toHaveLength(3);
    expect(promos.reduce((sum, f) => sum + f.annualSavingsCents, 0)).toBe(324_000);
  });

  it("flags the Oakland #3 decoy at $0, with no switch advice", () => {
    const decoys = ofType("thirdPartySupplier");
    expect(decoys.map((f) => f.accountId)).toEqual(["oakland-3-gas"]);
    const [decoy] = decoys;
    expect(decoy!.title).toMatch(/review contract, check exit fees/i);
    expect(decoy!.refundCents + decoy!.annualSavingsCents).toBe(0);
    expect(`${decoy!.title} ${decoy!.explanation}`).not.toMatch(/switch|cancel|cheaper|save/i);
  });

  it("finds no bill whose lines miss its total", () => {
    expect(ofType("arithmeticCheck")).toEqual([]);
  });

  it("keeps the totals within 10% of section 7", () => {
    expect(totalsProblems(run)).toEqual([]);
  });

  it("covers the seed's whole year on every other account", () => {
    const year = monthsBetween(FIRST_MONTH, LAST_MONTH);
    const others = seed.accounts.filter((a) => a.id !== FREMONT);
    expect(input.bills.filter((b) => b.accountId !== FREMONT)).toHaveLength(others.length * year.length);
  });
});

describe("totalsProblems", () => {
  const good = { refundCents: 1_260_000, annualSavingsCents: 2_000_000 };

  it.each([
    ["refund", { ...good, refundCents: 1_386_000 }],
    ["refund", { ...good, refundCents: 1_134_000 }],
    ["savings", { ...good, annualSavingsCents: 2_200_000 }],
    ["savings", { ...good, annualSavingsCents: 1_800_000 }],
  ])("passes %s at exactly 10%", (_, totals) => {
    expect(totalsProblems(totals)).toEqual([]);
  });

  it.each([
    ["refund", { ...good, refundCents: 1_386_001 }, /Refund/],
    ["refund", { ...good, refundCents: 1_133_999 }, /Refund/],
    ["savings", { ...good, annualSavingsCents: 2_200_001 }, /savings/],
    ["savings", { ...good, annualSavingsCents: 1_799_999 }, /savings/],
  ])("fails %s just past 10%", (_, totals, message) => {
    const problems = totalsProblems(totals);
    expect(problems).toHaveLength(1);
    expect(problems[0]).toMatch(message);
  });
});

describe("a parse cache miss", () => {
  const FIRST = () => seed.bills[0]!.id;
  const withFirst = (change: (entry: CachedParse) => CachedParse) => entries.map((e) => (e.source === FIRST() ? change(e) : e));

  it("maps a full cache", () => {
    expect(parsedBills(seed, entries).map((b) => b.id)).toEqual(seed.bills.map((b) => b.id));
  });

  it("names a bill with no entry", () => {
    expect(() => parsedBills(seed, entries.filter((e) => e.source !== FIRST()))).toThrow(`${FIRST()}: no cached parse`);
  });

  it("names a bill left for review", () => {
    const review = withFirst((e) => ({ ...e, status: "needs_review", bill: null, problems: ["lines miss the total"] }));
    expect(() => parsedBills(seed, review)).toThrow(/needs_review, lines miss the total/);
  });

  it("names an entry that is not a seed bill", () => {
    expect(() => parsedBills(seed, [...entries, { ...entries[0]!, source: "stranger" }])).toThrow("stranger: not a seed bill");
  });

  it("names a bill on someone else's account", () => {
    const wrong = withFirst((e) => ({ ...e, bill: { ...e.bill!, accountNumber: "OTHER" } }));
    expect(() => parsedBills(seed, wrong)).toThrow(/account number OTHER/);
  });

  it("fails on an empty cache rather than auditing nothing", () => {
    const empty = mkdtempSync(join(tmpdir(), "parsed-"));
    try {
      expect(() => loadAuditInput(empty)).toThrow(/448 problem\(s\)/);
    } finally {
      rmSync(empty, { recursive: true });
    }
  }, SLOW);

  it.each(["packages/agents/src/audit-input.ts", "scripts/audit-local.ts"])("has no way to reach a model from %s", (file) => {
    const code = readFileSync(new URL(`../../../${file}`, import.meta.url), "utf8");
    expect(code).not.toMatch(/@bill-fighter\/platform|createParseCache|getPlatform|parseBill\b/);
  });
});
