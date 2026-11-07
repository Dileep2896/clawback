import type { CSSProperties } from "react";

// Lines from the recorded demo run (data/replay/run.jsonl): the Fremont meter swap, one unused BayTel line, one Oakland rate change.
const LINES = [
  {
    account: "Electricity, Fremont store",
    provider: "BayCurrent, September 2025",
    wrong: "$2,083.54",
    right: "$1,054.09",
    note: "Billed 4,611 kWh. The meter read 2,305. Twice the real usage since the meter change.",
  },
  {
    account: "Phone line (415) 555-0102",
    provider: "BayTel, every month",
    wrong: "$720.00 a year",
    right: "Cancelled",
    note: "Nobody has called from this line in a year.",
  },
  {
    account: "Electricity rate, Oakland",
    provider: "BayCurrent, schedule B-10",
    wrong: "B-10",
    right: "B-6",
    note: "B-6 prices the same usage for $1,294.39 less a year.",
  },
];

/** The hero picture: a page of the demo customer's bills with the mistakes struck and annotated, ending on the refund. */
export function Statement({ refund, yearly }: { refund: string; yearly: string }) {
  return (
    <figure aria-labelledby="statement-caption" className="min-w-0 rounded-card bg-sheet text-ink">
      <figcaption id="statement-caption" className="flex flex-wrap items-baseline justify-between gap-x-4 border-b border-line px-6 py-4">
        <span className="font-semibold">Golden Gate Noodle Co.</span>
        <span className="text-base text-faded">Audited by Clawback</span>
      </figcaption>
      <ol>
        {LINES.map((line, index) => (
          <li key={line.account} className="grid gap-x-6 gap-y-1 border-b border-line px-6 py-4 sm:grid-cols-[minmax(0,1fr)_auto]">
            <div className="min-w-0">
              <p className="font-semibold">{line.account}</p>
              <p className="text-base text-faded">{line.provider}</p>
            </div>
            <p className="flex items-baseline gap-3 font-figure text-[1.375rem] sm:justify-end">
              <span className="strike text-faded" style={{ "--strike-order": index } as CSSProperties}>
                <span className="sr-only">was </span>
                {line.wrong}
              </span>
              <span className="text-money">
                <span className="sr-only">now </span>
                {line.right}
              </span>
            </p>
            {/* The auditor's margin note, in the alert colour that means "this was wrong". */}
            <p className="text-base font-semibold text-alert sm:col-span-2">{line.note}</p>
          </li>
        ))}
      </ol>
      <div className="grid gap-1 rounded-b-card bg-money-soft px-6 py-5">
        <span className="font-semibold">Refund claimed for the Fremont meter</span>
        <span className="font-figure text-[clamp(3rem,7vw,4.75rem)] leading-none text-money">{refund}</span>
        <span className="text-base text-faded">and {yearly} saved every year across all the fixes</span>
      </div>
    </figure>
  );
}
