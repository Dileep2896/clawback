// Runs every audit rule from the committed data/parsed/, with no services, no keys and no model calls.
// pnpm audit:local
import { EXPECTED_TOTALS, loadAuditInput, totalsProblems } from "@bill-fighter/agents/audit-input";
import { runAudit } from "@bill-fighter/core/rules/index";
import { dollars } from "@bill-fighter/core/rules/input";
import type { Finding } from "@bill-fighter/shared/finding";

const input = loadAuditInput();
const run = runAudit(input);

const hasMoney = (f: Finding) => f.refundCents + f.annualSavingsCents > 0;
const SECTIONS: [string, Finding[]][] = [
  ["Meter multiplier error", run.findings.filter((f) => hasMoney(f) && f.type === "meterMultiplierJump")],
  ["Wrong rate schedule", run.findings.filter((f) => hasMoney(f) && f.type === "rateOptimization")],
  ["Unused phone lines", run.findings.filter((f) => hasMoney(f) && f.type === "unusedLines")],
  ["Expired promos", run.findings.filter((f) => hasMoney(f) && f.type === "promoExpiry")],
  ["For review, no money claimed", run.findings.filter((f) => !hasMoney(f))],
];

console.info(`\n${input.bills.length} bills from the committed parse cache, 0 model calls`);
for (const [name, findings] of SECTIONS) {
  console.info(`\n${name} (${findings.length})`);
  for (const f of findings) {
    const refund = f.refundCents > 0 ? `  refund ${dollars(f.refundCents)}` : "";
    const savings = f.annualSavingsCents > 0 ? `  saves ${dollars(f.annualSavingsCents)} a year` : "";
    console.info(`  ${f.accountId}: ${f.title}${refund}${savings}`);
  }
}
console.info(`\nRefund to claim: ${dollars(run.refundCents)} (section 7: about ${dollars(EXPECTED_TOTALS.refundCents)})`);
console.info(`Yearly savings: ${dollars(run.annualSavingsCents)} (section 7: about ${dollars(EXPECTED_TOTALS.annualSavingsCents)})`);

const problems = totalsProblems(run);
if (problems.length > 0) {
  console.error(`Totals drifted from section 7:\n  ${problems.join("\n  ")}`);
  process.exit(1);
}
