import type { ReactNode } from "react";
import { KwhLines } from "./kwh-lines.tsx";
import { Reveal, RollUp } from "./motion.tsx";
import { REFUND_CENTS } from "./timeline.ts";

// "How it works": five cards, each a two-tone title and a crop of the app's real screen from the recorded demo run
// (data/replay/run.jsonl), bleeding off the card's edge. The graphics play once, when they scroll into view.

function Card({ fig, lead, rest, className = "", children }: { fig: string; lead: string; rest: string; className?: string; children: ReactNode }) {
  return (
    <li className={`flex min-w-0 flex-col overflow-hidden rounded-[12px] border border-line bg-sheet ${className}`}>
      <div className="px-6 pt-6 sm:px-8 sm:pt-8">
        <p className="font-mono text-[12px] tracking-[0.12em] text-faded uppercase">{fig}</p>
        <h3 className="mt-3 max-w-[30ch] text-[1.375rem] leading-snug font-semibold tracking-[-0.01em]">
          {lead} <span className="text-faded">{rest}</span>
        </h3>
      </div>
      {/* The crop: the app's surface, cut off by the card's right and bottom edges. */}
      <div className="mt-8 ml-6 flex-1 rounded-tl-[10px] border-t border-l border-line bg-paper p-5 text-[15px] sm:ml-8 sm:p-6">{children}</div>
    </li>
  );
}

const ROWS = [
  { month: "Aug 2025", billed: "2,424", meter: "2,424", wrong: false },
  { month: "Sep 2025", billed: "4,611", meter: "2,305", wrong: true },
  { month: "Oct 2025", billed: "4,778", meter: "2,389", wrong: true },
];

// Heights for the call's waveform, a fixed pattern so the server and the browser draw the same bars. Decorative.
const WAVE = [3, 5, 8, 6, 9, 12, 7, 4, 6, 10, 14, 11, 7, 5, 8, 12, 9, 6, 4, 7, 11, 13, 8, 5, 3, 6, 9, 7, 4, 3];

const CALL = [
  { who: "Clawback", text: "Please cancel phone line (415) 555-0102 on account BT-7001." },
  { who: "BayTel", text: "Yes, that is cancelled." },
  { who: "Clawback", text: "Please cancel phone line (415) 555-0106 on account BT-7003." },
  { who: "BayTel", text: "Yes, that is cancelled." },
];

const ACTIVITY = [
  { at: "1:03", text: "Auditor found it on 14 Fremont bills" },
  { at: "1:57", text: "Linda Park approved by SMS" },
  { at: "4:01", text: "Filer filed the refund claim with BayCurrent" },
];

const LEDGER = [
  { label: "Fremont meter fixed", amount: "$10,710.37", note: "Filed" },
  { label: "2 rate changes", amount: "$2,568.95", note: "Filed" },
  { label: "7 unused lines", amount: "$5,040.00", note: "Cancelled" },
];

export function Bento() {
  return (
    <ul className="grid gap-4 lg:grid-cols-12 lg:gap-5">
      <Card fig="Fig 1 · Bills" lead="It reads every bill." rest="And sets it next to the meter’s own readings." className="lg:col-span-7">
        <Reveal className="grid gap-14">
          <KwhLines />
          <table className="w-full text-left tabular-nums">
            <thead className="text-[13px] text-faded">
              <tr>
                <th className="pb-2 font-normal">Fremont bill</th>
                <th className="pb-2 text-right font-normal">Billed kWh</th>
                <th className="pb-2 text-right font-normal">Meter kWh</th>
              </tr>
            </thead>
            <tbody>
              {ROWS.map((row) => (
                <tr key={row.month} className="border-t border-line">
                  <td className="py-2">{row.month}</td>
                  <td className={`py-2 text-right ${row.wrong ? "font-semibold text-alert" : ""}`}>{row.billed}</td>
                  <td className="py-2 text-right">{row.meter}</td>
                </tr>
              ))}
            </tbody>
          </table>
        </Reveal>
      </Card>

      <Card fig="Fig 2 · Findings" lead="It finds what is wrong." rest="With the evidence and the rule it breaks." className="lg:col-span-5">
        <div className="grid gap-4 rounded-[10px] border border-line bg-sheet p-5">
          <p className="w-fit rounded-full border border-line px-2.5 text-[13px] text-faded">Fremont electric · BayCurrent</p>
          <p className="text-[1.125rem] leading-snug font-semibold">Billed 2x metered usage since the 2025-09 meter change</p>
          <p className="text-faded">
            Meter BEM-1009011 was replaced by BEM-2214077 in September 2025. Every bill since charges for twice what the meter recorded.
          </p>
          <div className="flex flex-wrap items-baseline justify-between gap-x-4 border-t border-line pt-4">
            <span className="text-faded">To claim across 14 bills</span>
            <span className="font-figure text-[2rem] leading-none text-money">$12,606.06</span>
          </div>
          <p className="border-l-2 border-line pl-3 text-[14px] text-faded">Refund to claim under the 3 year window of Electric Rule 17.1.</p>
        </div>
        {/* What happened to this finding in the run, by the run's clock. */}
        <ol className="mt-5 grid gap-2 text-[14px]">
          {ACTIVITY.map((step) => (
            <li key={step.at} className="grid grid-cols-[2.5rem_minmax(0,1fr)] gap-x-3">
              <span className="text-faded tabular-nums">{step.at}</span>
              <span>{step.text}</span>
            </li>
          ))}
        </ol>
      </Card>

      <Card fig="Fig 3 · Calls" lead="It makes the call." rest="And cancels the lines you don’t use." className="lg:col-span-4">
        <Reveal className="grid gap-4">
          <div aria-hidden="true" className="flex h-12 items-center gap-[3px]">
            {WAVE.map((height, i) => (
              <span key={i} className="wave-bar w-1 rounded-full bg-ink/70" style={{ height: `${height * 3}px`, animationDelay: `${(i % 7) * 70}ms` }} />
            ))}
            <span className="ml-3 text-[13px] text-faded">BayTel Business · recorded</span>
          </div>
          <dl className="grid gap-3">
            {CALL.map((line, i) => (
              <div key={i} className="reveal-line" style={{ animationDelay: `${300 + i * 700}ms` }}>
                <dt className={`text-[13px] font-semibold ${line.who === "BayTel" ? "text-faded" : ""}`}>{line.who}</dt>
                <dd>{line.text}</dd>
              </div>
            ))}
          </dl>
        </Reveal>
      </Card>

      <Card fig="Fig 4 · Approval" lead="You approve once." rest="By text, in one word." className="lg:col-span-4">
        <div className="grid gap-3">
          <p className="max-w-[92%] rounded-[14px] rounded-bl-[4px] border border-line bg-sheet p-4">
            Your approval request is waiting. It covers a refund claim of $12,606.06 and yearly savings of $18,319.32, with rate changes for two Oakland
            accounts and cancellation of unused phone lines.
          </p>
          <p className="ml-auto rounded-[14px] rounded-br-[4px] bg-ink px-4 py-2 font-semibold text-sheet">YES</p>
          <p className="text-right text-[13px] text-faded">Linda Park, 12:03</p>
        </div>
      </Card>

      <Card fig="Fig 5 · Ledger" lead="It tracks the money." rest="Claimed until the provider grants it." className="lg:col-span-4">
        <div className="grid gap-4">
          <div>
            <p className="text-faded">Refund claimed</p>
            <RollUp cents={REFUND_CENTS} className="mt-1 font-figure text-[2.5rem] leading-none text-money" />
            <p className="mt-1 text-[14px] text-faded">Due only when granted</p>
          </div>
          <dl className="grid border-t border-line">
            {LEDGER.map((row) => (
              <div key={row.label} className="flex items-baseline justify-between gap-4 border-b border-line py-2">
                <dt>
                  {row.label} <span className="text-[13px] text-faded">· {row.note}</span>
                </dt>
                <dd className="font-figure tabular-nums">{row.amount}</dd>
              </div>
            ))}
          </dl>
        </div>
      </Card>
    </ul>
  );
}
