import { Finding } from "@bill-fighter/shared/finding";
import { billsOf, dollars, latestPeriodEnd, type AuditInput } from "./input.ts";

const MONTHS_PER_YEAR = 12;

// One finding per line: each is approved and acted on alone, and an alarm line must never share a finding with savings.
export function unusedLines(input: AuditInput): Finding[] {
  return input.phoneLines.flatMap((line) => {
    const alarm = line.purpose === "alarm";
    if (!alarm && line.callsLast12mo > 0) return [];

    const latest = billsOf(input, line.accountId).at(-1);
    // A line missing from the current bill may already be gone, so it is left out rather than claimed.
    if (latest?.periodEnd !== latestPeriodEnd(input, line.accountId)) return [];
    const billLine = latest.lines.find((l) => l.description.includes(line.number));
    if (!billLine) return [];

    const annualSavingsCents = alarm ? 0 : line.monthlyCents * MONTHS_PER_YEAR;
    return [
      Finding.parse({
        customerId: input.customerId,
        accountId: line.accountId,
        type: "unusedLines",
        title: alarm ? `Confirm with alarm company: ${line.number}` : `Unused line ${line.number} costs ${dollars(annualSavingsCents)} a year`,
        explanation: alarm
          ? `${line.label} ${line.number} is an alarm line with ${line.callsLast12mo} calls in 12 months. Confirm with the alarm company what depends on it.`
          : `${line.label} ${line.number} had no calls in 12 months and costs ${dollars(line.monthlyCents)} a month. Cancelling it saves ${dollars(annualSavingsCents)} a year.`,
        evidence: {
          billIds: [latest.id],
          billLineIds: [billLine.id],
          phoneLineIds: [line.id],
          detail: {
            number: line.number,
            label: line.label,
            purpose: line.purpose,
            callsLast12mo: line.callsLast12mo,
            monthlyCents: line.monthlyCents,
            action: alarm ? "confirmWithAlarmCompany" : "cancel",
          },
        },
        refundCents: 0,
        annualSavingsCents,
        confidence: alarm ? 0.5 : 0.9,
      }),
    ];
  });
}
