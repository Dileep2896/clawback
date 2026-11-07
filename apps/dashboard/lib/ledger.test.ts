import { describe, expect, it } from "vitest";
import { auditCost, ledgerView } from "./ledger.ts";
import type { Snapshot } from "./snapshot.ts";

type LedgerRow = Snapshot["ledger"][number];
type FindingRow = Snapshot["findings"][number];

const row = (id: string, kind: LedgerRow["kind"], amountCents: number, findingId: string | null = null, description: string | null = null) =>
  ({ id, kind, amountCents, findingId, description }) as LedgerRow;
const finding = (id: string, status: FindingRow["status"], accountId: string | null = null) => ({ id, status, accountId, title: `Title of ${id}` }) as FindingRow;
const view = (ledger: LedgerRow[], findings: FindingRow[] = [], findingSites: Record<string, string> = {}) => ledgerView({ ledger, findings, findingSites });

describe("ledgerView", () => {
  it("adds the real seed's totals up to the real figures, to the cent", () => {
    const totals = view([
      row("refund", "refund", 1_260_606, "meter"),
      row("meter", "savings", 1_000_000, "meter"),
      row("rate", "savings", 655_932, "rate"),
      row("lines", "savings", 500_000, "lines"),
      row("fee", "fee", 1_024_961),
    ]);
    expect(totals).toMatchObject({ refundCents: 1_260_606, annualSavingsCents: 2_155_932, feeCents: 1_024_961, customerKeepsCents: 2_391_577 });
  });

  it("reads the fee from its row and never works it out", () => {
    const totals = view([row("refund", "refund", 1000, "f"), row("fee", "fee", 123)], [finding("f", "filed")]);
    expect(totals.feeCents).toBe(123);
    expect(totals.customerKeepsCents).toBe(877);
  });

  it("shows no fee and no customer share until the fee row exists", () => {
    const totals = view([row("refund", "refund", 1000, "f")], [finding("f", "filed")]);
    expect(totals.feeCents).toBeNull();
    expect(totals.customerKeepsCents).toBeNull();
  });

  it("calls a refund claimed, even when its finding is won", () => {
    const { rows } = view([row("r", "refund", 1000, "f")], [finding("f", "won")]);
    expect(rows[0]!.status).toBe("Refund, claimed");
  });

  it("confirms savings only on a won finding", () => {
    const statuses = ["proposed", "approved", "filed", "rejected"] as const;
    const findings = [...statuses.map((status) => finding(status, status)), finding("won", "won")];
    const ledger = [...statuses, "won", "missing"].map((id) => row(`s-${id}`, "savings", 100, id));
    const totals = view(ledger, findings);
    expect(totals.rows.filter((r) => r.status === "Yearly savings, confirmed").map((r) => r.id)).toEqual(["s-won"]);
    expect(totals.rows.filter((r) => r.status === "Yearly savings, due when granted")).toHaveLength(5);
    expect(totals).toMatchObject({ annualSavingsCents: 600, confirmedSavingsCents: 100, dueSavingsCents: 500 });
  });

  it("lists invoice and card rows but keeps them out of the totals", () => {
    const totals = view([row("fee", "fee", 300), row("inv", "invoice", 300, null, "Stripe invoice"), row("card", "card_spend", 500, null, "API credit")]);
    expect(totals.rows.map((r) => [r.label, r.status])).toEqual([
      ["Our fee", null],
      ["Invoiced", "Stripe invoice"],
      ["Card spend", "API credit"],
    ]);
    expect(totals).toMatchObject({ refundCents: 0, annualSavingsCents: 0, feeCents: 300, customerKeepsCents: -300 });
  });

  it("lists the refund first, then savings biggest first, then the fee", () => {
    const { rows } = view([row("fee", "fee", 300), row("small", "savings", 100), row("big", "savings", 900), row("refund", "refund", 50)]);
    expect(rows.map((r) => r.id)).toEqual(["refund", "big", "small", "fee"]);
  });

  it("names a row by its finding and site", () => {
    const { rows } = view([row("s", "savings", 100, "f")], [finding("f", "filed", "acct")], { acct: "Fremont #1" });
    expect(rows[0]).toMatchObject({ label: "Title of f", site: "Fremont #1" });
  });
});

describe("auditCost", () => {
  it("has nothing to show for 0, and keeps small amounts readable", () => {
    expect(auditCost(0)).toBeNull();
    expect(auditCost(0.04)).toBe("$0.04");
    expect(auditCost(0.000123)).toBe("$0.000123");
    expect(auditCost(1.5)).toBe("$1.50");
  });
});
