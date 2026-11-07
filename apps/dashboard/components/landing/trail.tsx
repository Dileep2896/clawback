import type { ReactNode } from "react";

// Every value below is from the recorded demo run (data/replay/run.jsonl), shown the way the app's own screens show it.

const METER_ROWS = [
  { month: "Aug 2025", billed: "2,424", meter: "2,424", wrong: false },
  { month: "Sep 2025", billed: "4,611", meter: "2,305", wrong: true },
  { month: "Oct 2025", billed: "4,778", meter: "2,389", wrong: true },
];

function BillCapture() {
  return (
    <table className="w-full border-collapse text-left text-base tabular-nums">
      <caption className="pb-2 text-left font-semibold">Fremont store, kWh per bill</caption>
      <thead>
        <tr className="text-faded">
          <th scope="col" className="py-1 font-normal">
            Bill
          </th>
          <th scope="col" className="py-1 text-right font-normal">
            Billed
          </th>
          <th scope="col" className="py-1 text-right font-normal">
            Meter
          </th>
        </tr>
      </thead>
      <tbody>
        {METER_ROWS.map((row) => (
          <tr key={row.month} className="border-t border-line">
            <th scope="row" className="py-2 font-normal">
              {row.month}
            </th>
            <td className={`py-2 text-right ${row.wrong ? "font-semibold text-alert" : ""}`}>{row.billed}</td>
            <td className="py-2 text-right">{row.meter}</td>
          </tr>
        ))}
      </tbody>
    </table>
  );
}

function FindingCapture() {
  return (
    <div className="grid gap-2">
      <p className="font-semibold">Billed 2x metered usage since the 2025-09 meter change</p>
      <p className="text-base text-faded">Meter BEM-1009011 was replaced in September 2025. Every bill since charges for twice what the meter recorded.</p>
      <p className="mt-1 font-figure text-[2rem] leading-none text-money">$12,606.06</p>
      <p className="text-base text-faded">to claim across 14 bills, under Electric Rule 17.1</p>
    </div>
  );
}

const CALL = [
  { who: "Clawback", text: "Hi, this is an AI assistant calling on behalf of Golden Gate Noodle Company. This call is being recorded." },
  { who: "BayTel", text: "BayTel billing. Can I have the account number, please?" },
  { who: "Clawback", text: "Please cancel phone line (415) 555-0102 on account BT-7001." },
  { who: "BayTel", text: "Yes, that is cancelled." },
];

function CallCapture() {
  return (
    <dl className="grid gap-2 text-base">
      {CALL.map((line) => (
        <div key={line.text} className={line.who === "BayTel" ? "pl-4" : ""}>
          <dt className={`font-semibold ${line.who === "Clawback" ? "text-money" : "text-faded"}`}>{line.who}</dt>
          <dd>{line.text}</dd>
        </div>
      ))}
    </dl>
  );
}

function MoneyCapture() {
  return (
    <div className="grid gap-3">
      <p className="flex flex-wrap items-center justify-between gap-2">
        <span className="font-semibold">Approval</span>
        <span className="rounded-full bg-money-soft px-3 text-base font-semibold text-money">Approved by Linda Park</span>
      </p>
      <dl className="grid gap-1 border-t border-line pt-3">
        <dt className="text-base text-faded">Ledger, refund claimed</dt>
        <dd className="font-figure text-[2rem] leading-none text-money">$12,606.06</dd>
      </dl>
    </div>
  );
}

const STAGES: { title: string; body: string; capture: ReactNode }[] = [
  {
    title: "It reads every bill",
    body: "Agents sign in to each provider’s portal, pull the bills, and set each one next to the meter’s own readings.",
    capture: <BillCapture />,
  },
  {
    title: "It finds what is wrong",
    body: "Every line is checked against real usage and the published tariff. Each finding carries its evidence and the rule it breaks.",
    capture: <FindingCapture />,
  },
  {
    title: "It files and calls",
    body: "After your one approval, the refund goes to BayCurrent as a written claim, and the unused lines are cancelled on a recorded call.",
    capture: <CallCapture />,
  },
  {
    title: "The money lands",
    body: "Every refund and saving is written to your ledger as it is won. You see what came back and what Clawback charged for it.",
    capture: <MoneyCapture />,
  },
];

/** One run of the demo customer, start to finish: four stages, each with the screen it produces. */
export function Trail() {
  return (
    <ol className="mt-12 grid gap-x-6 gap-y-12 md:grid-cols-2 xl:grid-cols-4">
      {STAGES.map((stage, index) => (
        <li key={stage.title} className="grid min-w-0 content-start gap-4 border-t-4 border-ink pt-5">
          <h3 className="flex items-baseline gap-3 text-[1.375rem] leading-snug font-semibold">
            <span aria-hidden="true" className="font-figure text-money">
              {index + 1}
            </span>
            {stage.title}
          </h3>
          <p className="text-faded">{stage.body}</p>
          <div className="rounded-card border border-line bg-sheet p-5">{stage.capture}</div>
        </li>
      ))}
    </ol>
  );
}
