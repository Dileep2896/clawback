import { type RateDetail, money, quantity } from "../../lib/evidence.ts";
import { EvidenceTable, Facts } from "./evidence-table.tsx";

export function RateTable({ detail }: { detail: RateDetail }) {
  const mark = (schedule: string) => (schedule === detail.currentSchedule ? " (current)" : schedule === detail.proposedSchedule ? " (proposed)" : "");
  return (
    <div className="grid gap-3">
      <Facts
        facts={[
          ["Usage priced from", `${detail.windowStart} to ${detail.windowEnd}`],
          ["Peak", `${quantity(detail.peakKw)} kW`],
          ["Held", `${quantity(detail.heldKw)} kW`],
        ]}
      />
      <EvidenceTable
        caption="Yearly cost on each eligible schedule"
        head={["Schedule", "Cost a year", "Saved"]}
        rows={detail.schedules.map((s) => [
          <span key={s.schedule} className={mark(s.schedule) ? "font-semibold" : undefined}>
            {s.schedule}
            {mark(s.schedule)}
          </span>,
          money(s.annualCents),
          `${s.savingsPct}%`,
        ])}
      />
    </div>
  );
}
