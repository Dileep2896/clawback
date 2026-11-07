import { customerKeepsCents } from "@bill-fighter/core/money/fee";
import { totalsByKind } from "@bill-fighter/core/rules/totals";
import type { Snapshot } from "./snapshot.ts";

const NO_FINDING_LABEL = { refund: "Refund", savings: "Yearly savings", fee: "Our fee", invoice: "Invoiced", card_spend: "Card spend" } as const;
const KIND_ORDER = Object.keys(NO_FINDING_LABEL);

/** Every figure is a sum of ledger rows. The fee is the row finance-ledger wrote, so it is read and never worked out here. */
export function ledgerView({ ledger, findings, findingSites }: Pick<Snapshot, "ledger" | "findings" | "findingSites">) {
  const findingById = new Map(findings.map((finding) => [finding.id, finding]));

  // Rows from one record_savings share a timestamp, so without this the room sees them in id order. A sort is stable, so ties keep their fixed order.
  const ordered = [...ledger].sort((a, b) => KIND_ORDER.indexOf(a.kind) - KIND_ORDER.indexOf(b.kind) || b.amountCents - a.amountCents);
  const rows = ordered.map((row) => {
    const finding = row.findingId ? findingById.get(row.findingId) : undefined;
    // Fails closed: only a finding that is won counts as confirmed, and a refund is claimed whatever its finding says.
    const confirmed = row.kind === "savings" && finding?.status === "won";
    const status =
      row.kind === "refund" ? "Refund, claimed" : row.kind === "savings" ? `Yearly savings, ${confirmed ? "confirmed" : "due when granted"}` : row.description;
    return {
      id: row.id,
      kind: row.kind,
      amountCents: row.amountCents,
      confirmed,
      site: finding?.accountId ? findingSites[finding.accountId] : undefined,
      label: finding?.title ?? NO_FINDING_LABEL[row.kind],
      status,
    };
  });

  const totals = totalsByKind(ledger);
  const refundCents = totals.get("refund") ?? 0;
  const annualSavingsCents = totals.get("savings") ?? 0;
  const feeCents = totals.get("fee") ?? null;
  const savings = totalsByKind(rows.filter((row) => row.kind === "savings").map((row) => ({ kind: row.confirmed ? "confirmed" : "due", amountCents: row.amountCents })));

  return {
    rows,
    refundCents,
    annualSavingsCents,
    confirmedSavingsCents: savings.get("confirmed") ?? 0,
    dueSavingsCents: savings.get("due") ?? 0,
    // Null until the fee row exists: no fee yet must not read as a $0 fee and a bigger customer share.
    feeCents,
    customerKeepsCents: feeCents === null ? null : customerKeepsCents({ refundCents, annualSavingsCents, feeCents }),
  };
}

const fineUsd = new Intl.NumberFormat("en-US", { style: "currency", currency: "USD", maximumFractionDigits: 6 });

/** Tool calls mostly carry no cost of their own, because the SDK reports cost per run and the header shows that. Null means nothing to show. */
export const auditCost = (costUsd: number) => (costUsd === 0 ? null : fineUsd.format(costUsd));
