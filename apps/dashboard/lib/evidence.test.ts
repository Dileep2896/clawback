import { RULES } from "@bill-fighter/core/rules/index";
import { loadTariff } from "@bill-fighter/core/tariff/load";
import { generateSeed } from "@bill-fighter/db/seed/generate";
import type { RateSchedule, Tariff } from "@bill-fighter/shared/tariff";
import { describe, expect, it, vi } from "vitest";
import { monthLabel, money, parseEvidence, quantity } from "./evidence.ts";

const SLOW = 180_000;

describe("parseEvidence", () => {
  it(
    "reads what every rule really writes over the seed, after the trip through JSON",
    () => {
      vi.spyOn(console, "info").mockImplementation(() => {});
      vi.spyOn(console, "warn").mockImplementation(() => {});
      const seed = generateSeed();
      const tariffs = new Map<RateSchedule, Tariff>();
      const input = {
        customerId: seed.customer.id,
        accounts: seed.accounts,
        bills: seed.bills,
        phoneLines: seed.phoneLines,
        intervals: seed.intervals,
        tariffFor(schedule: RateSchedule) {
          const tariff = tariffs.get(schedule) ?? loadTariff(schedule);
          tariffs.set(schedule, tariff);
          return tariff;
        },
      };

      const findings = RULES.flatMap((rule) => rule(input));
      for (const finding of findings) {
        const parsed = parseEvidence(finding.type, JSON.parse(JSON.stringify(finding.evidence)));
        expect(parsed, `${finding.type}: ${finding.title}`).not.toBeNull();
      }
      expect(new Set(findings.map((f) => f.type))).toEqual(
        new Set(["meterMultiplierJump", "rateOptimization", "unusedLines", "promoExpiry", "thirdPartySupplier"]),
      );
    },
    SLOW,
  );

  const ids = { billIds: ["bill"], billLineIds: [], phoneLineIds: [] };

  it("reads an arithmetic flag, which the clean seed never produces", () => {
    const detail = { linesCents: 11_000, totalCents: 11_001, differenceCents: 1 };
    expect(parseEvidence("arithmeticCheck", { ...ids, detail })).toEqual({ type: "arithmeticCheck", detail });
  });

  it("returns null rather than guessing when the evidence is not what a rule writes", () => {
    expect(parseEvidence("meterMultiplierJump", { ...ids, detail: {} })).toBeNull();
    expect(parseEvidence("meterMultiplierJump", {})).toBeNull();
    expect(parseEvidence("unusedLines", { billIds: [], billLineIds: [], phoneLineIds: [], detail: {} })).toBeNull();
    expect(parseEvidence("notARule", { ...ids, detail: {} })).toBeNull();
  });
});

describe("formatting", () => {
  it("shows cents as dollars and keeps a measured kWh exact", () => {
    expect(money(1_260_000)).toBe("$12,600.00");
    expect(money(0)).toBe("$0.00");
    expect(quantity(11_760.125)).toBe("11,760.125");
  });

  it("names the month as written, in any timezone", () => {
    expect(monthLabel("2025-09")).toBe("Sep 2025");
    expect(monthLabel("2026-01-01")).toBe("Jan 2026");
  });
});
