import { type Evidence, type MeterDetail, type RateDetail, monthLabel, money, quantity } from "../../lib/evidence.ts";
import { EvidenceTable, Facts } from "./evidence-table.tsx";

function MeterSnippet({ detail }: { detail: MeterDetail }) {
  return (
    <EvidenceTable
      caption="Each bill's billed and real usage and charges"
      head={["Bill", "Billed kWh", "Real kWh", "Billed", "Correct", "Overbilled"]}
      rows={detail.bills.map((b) => [
        monthLabel(b.periodStart),
        quantity(b.billedKwh),
        quantity(b.intervalKwh),
        money(b.billedCents),
        money(b.correctCents),
        money(b.overbilledCents),
      ])}
    />
  );
}

function RateSnippet({ detail }: { detail: RateDetail }) {
  return (
    <EvidenceTable
      caption="Each month priced on both schedules"
      head={["Bill", detail.currentSchedule, detail.proposedSchedule, "Saved"]}
      rows={detail.months.map((m) => [monthLabel(m.periodStart), money(m.currentCents), money(m.proposedCents), `${m.savingsPct}%`])}
    />
  );
}

/** The bill's own figures as the finding cites them. Everything here comes from evidence_json, with no query of its own. */
export function BillSnippet({ evidence }: { evidence: Evidence }) {
  switch (evidence.type) {
    case "meterMultiplierJump":
      return <MeterSnippet detail={evidence.detail} />;
    case "rateOptimization":
      return <RateSnippet detail={evidence.detail} />;
    case "unusedLines": {
      const { number, label, purpose, callsLast12mo, monthlyCents, action } = evidence.detail;
      return (
        <Facts
          facts={[
            ["Line", number],
            ["Label", label ?? "None"],
            ["Purpose", purpose],
            ["Calls, last year", String(callsLast12mo)],
            ["Monthly cost", money(monthlyCents)],
            ["Next step", action === "cancel" ? "Ask to cancel the line" : "Confirm with the alarm company"],
          ]}
        />
      );
    }
    case "promoExpiry": {
      const { planCode, riseMonth, beforeCents, afterCents, latestCents, monthlyIncreaseCents } = evidence.detail;
      return (
        <Facts
          facts={[
            ["Plan", planCode],
            ["Price rose in", monthLabel(riseMonth)],
            ["Before", money(beforeCents)],
            ["After", money(afterCents)],
            ["Latest bill", money(latestCents)],
            ["Monthly rise", money(monthlyIncreaseCents)],
          ]}
        />
      );
    }
    case "arithmeticCheck": {
      const { linesCents, totalCents, differenceCents } = evidence.detail;
      return (
        <Facts
          facts={[
            ["Lines add up to", money(linesCents)],
            ["Bill total", money(totalCents)],
            ["Difference", money(differenceCents)],
          ]}
        />
      );
    }
    case "thirdPartySupplier": {
      const { supplier, utility, planCode } = evidence.detail;
      return (
        <Facts
          facts={[
            ["Supplier", supplier],
            ["Local utility", utility],
            ["Plan", planCode ?? "None"],
          ]}
        />
      );
    }
  }
}
