/* Hallmark · genre: modern-minimal (fintech) · macrostructure: intro → sticky agent graph beside six figure steps → the agents around them
 * design-system: docs/plan/design.md */
import type { Metadata } from "next";
import type { ReactNode } from "react";
import { AgentGraph, type GraphNode } from "../../components/landing/agent-graph.tsx";
import { LABEL, MoreLink, PageIntro, SiteFrame, Statement, WIDTH } from "../../components/landing/chrome.tsx";
import { KwhLines } from "../../components/landing/kwh-lines.tsx";
import { Reveal, RollUp } from "../../components/landing/motion.tsx";
import { dollars, REFUND_CENTS, YEARLY_CENTS } from "../../components/landing/timeline.ts";

export const metadata: Metadata = { title: "How it works" };

// Every value is from the recorded demo run (data/replay/run.jsonl): its board cards, tool calls and clock (m:ss from the start).

const NODES: GraphNode[] = [
  { name: "Collector", role: "Downloads bills and usage", at: "0:17" },
  { name: "Auditor", role: "Finds what is wrong", at: "0:47" },
  { name: "You approve", role: "One text, one word", at: "1:41", human: true },
  { name: "Negotiator", role: "Calls the provider", at: "1:59" },
  { name: "Filer", role: "Files the claim", at: "1:59", parallel: true },
  { name: "Finance", role: "Records the money", at: "4:03" },
];

const WAVE = [3, 5, 8, 6, 9, 12, 7, 4, 6, 10, 14, 11, 7, 5, 8, 12, 9, 6, 4, 7, 11, 13, 8, 5, 3, 6, 9, 7, 4, 3];

const BILL = [
  { label: "Account", value: "Fremont" },
  { label: "Meter", value: "BEM-2214077" },
  { label: "Meter read", value: "2,305 kWh" },
];

const CALL = [
  { who: "Clawback", text: "Please cancel phone line (415) 555-0102 on account BT-7001." },
  { who: "BayTel", text: "Yes, that is cancelled." },
];

const FILED = [
  { label: "Refund claim under Electric Rule 17.1", detail: "14 Fremont bills, with the meter readings attached", amount: "$12,606.06" },
  { label: "Rate change", detail: "First Oakland account", amount: "Filed" },
  { label: "Rate change", detail: "Second Oakland account", amount: "Filed" },
];

const LEDGER = [
  { label: "Fremont meter fixed", amount: "$10,710.37" },
  { label: "2 rate changes", amount: "$2,568.95" },
  { label: "7 unused lines", amount: "$5,040.00" },
];

const AROUND = [
  { name: "Intake", text: "reads the owner’s email and finds the customer, at 0:02." },
  { name: "CEO", text: "hands each step to the next agent on a shared board, and moves on only when the last one is done." },
  { name: "Monitor", text: "schedules next month’s check at 4:13, so the next bill gets the same audit." },
];

/** One step: a caption, a two-tone title, what happened in the run, and its figure on the app's surface. */
function Step({ index, title, rest, children, figure }: { index: number; title: string; rest: string; children: ReactNode; figure: ReactNode }) {
  const node = NODES[index]!;
  return (
    <section
      id={`step-${index + 1}`}
      data-step={index}
      aria-labelledby={`step-${index + 1}-title`}
      className="scroll-mt-24 border-t border-line py-14 first:border-t-0 first:pt-0 lg:py-20"
    >
      <p className={`${LABEL} text-faded`}>
        Step {index + 1} · {node.name} · {node.at}
      </p>
      <h2 id={`step-${index + 1}-title`} className="mt-3 max-w-[30ch] text-[clamp(1.5rem,2.4vw,2rem)] leading-snug font-semibold tracking-[-0.01em]">
        {title} <span className="text-faded">{rest}</span>
      </h2>
      <div className="mt-4 max-w-[60ch] text-faded">{children}</div>
      <div className="canvas mt-8 rounded-[12px] border border-line bg-paper p-4 text-[15px] sm:p-6">{figure}</div>
    </section>
  );
}

export default function HowItWorksPage() {
  return (
    <SiteFrame current="/how-it-works">
      <PageIntro caption="How it works" lead="Six agents, one approval." rest="One audit, step by step, as it ran.">
        <p>
          This is the recorded demo run for Golden Gate Noodle Co.: 4 minutes 28 seconds from the owner’s email to filed claims. Every figure below is
          from that run, and all of it is demo data.
        </p>
      </PageIntro>

      <div className={`${WIDTH} grid gap-12 pb-24 lg:grid-cols-12 lg:gap-x-10 lg:pb-36`}>
        <aside aria-label="Agent graph" className="lg:col-span-4">
          <div className="grid gap-4 lg:sticky lg:top-24">
            <AgentGraph nodes={NODES} />
            <p className="text-[15px] text-faded">Negotiator and Filer work at the same time, once you say yes.</p>
          </div>
        </aside>

        <div className="min-w-0 lg:col-span-8">
          <Step
            index={0}
            title="It signs in and downloads every bill."
            rest="And the meter’s own usage, from the provider’s portal."
            figure={
              <Reveal className="grid gap-6 sm:grid-cols-[minmax(0,1fr)_auto] sm:items-start">
                {/* A bill, drawn: header, lines, and the one number that is wrong, in coral. */}
                <div className="max-w-[420px] rounded-[10px] border border-line bg-sheet p-5">
                  <div className="flex items-baseline justify-between gap-4 border-b border-line pb-3">
                    <span className="font-semibold">BayCurrent</span>
                    <span className="text-faded">Sep 2025</span>
                  </div>
                  <dl className="grid gap-2 pt-3">
                    {BILL.map((row, i) => (
                      <div key={row.label} className="reveal-line flex justify-between gap-4" style={{ animationDelay: `${i * 120}ms` }}>
                        <dt className="text-faded">{row.label}</dt>
                        <dd className="tabular-nums">{row.value}</dd>
                      </div>
                    ))}
                    <div className="reveal-line flex justify-between gap-4 border-t border-line pt-2" style={{ animationDelay: "360ms" }}>
                      <dt className="text-faded">Billed</dt>
                      <dd className="font-semibold text-alert tabular-nums">4,611 kWh</dd>
                    </div>
                  </dl>
                </div>
                <ul className="grid gap-2 text-faded">
                  {["Signed in to the portal", "Downloaded bills", "Downloaded usage", "Stored both"].map((done, i) => (
                    <li key={done} className="reveal-line flex items-center gap-2" style={{ animationDelay: `${200 + i * 120}ms` }}>
                      <span aria-hidden="true" className="size-2 rounded-full bg-agent" />
                      {done}
                    </li>
                  ))}
                </ul>
              </Reveal>
            }
          >
            <p>The Collector signs in to each provider’s portal, downloads the bills and the meter’s usage, and stores them. Done at 0:46.</p>
          </Step>

          <Step
            index={1}
            title="It finds what is wrong."
            rest="By setting every bill next to the meter and the published tariff."
            figure={
              <Reveal className="grid gap-6">
                <KwhLines />
                <div className="flex flex-wrap items-baseline justify-between gap-x-6 gap-y-2 border-t border-line pt-4">
                  <span>Fremont meter billed 2x since September 2025, on 14 bills</span>
                  <RollUp cents={REFUND_CENTS} className="font-figure text-[2rem] leading-none text-money" />
                </div>
              </Reveal>
            }
          >
            <p>
              The Auditor parses each bill and runs the rules. At 1:03 it found that the Fremont meter, replaced in September 2025, has been billed at twice
              what it records ever since. It also found two Oakland accounts on the wrong rate and seven phone lines nobody uses.
            </p>
          </Step>

          <Step
            index={2}
            title="You approve once."
            rest="Tap or text. Nothing is filed and nobody is called until you do."
            figure={
              <Reveal className="grid max-w-[480px] gap-3">
                <p className="reveal-line max-w-[92%] rounded-[14px] rounded-bl-[4px] border border-line bg-sheet p-4">
                  Your approval request is waiting. It covers a refund claim of {dollars(REFUND_CENTS)} and yearly savings of {dollars(YEARLY_CENTS)}, with
                  rate changes for two Oakland accounts and cancellation of unused phone lines.
                </p>
                <p className="flex items-center gap-2 text-[15px] text-faded">
                  <span aria-hidden="true" className="size-2.5 rounded-full bg-warn" />
                  Approval needed · answered in 16 s
                </p>
                <p className="reveal-line ml-auto rounded-[14px] rounded-br-[4px] bg-ink px-4 py-2 font-semibold text-sheet" style={{ animationDelay: "500ms" }}>
                  YES
                </p>
                <p className="text-right text-[15px] text-faded">Linda Park, 12:03</p>
              </Reveal>
            }
          >
            <p>
              The Approver texts the owner one summary at 1:41. Linda Park replied YES at 1:57. The Filer had already drafted the letters and attached the
              evidence, so nothing waits once you answer.
            </p>
          </Step>

          <Step
            index={3}
            title="It makes the call."
            rest="And cancels the lines you don’t use, one by one."
            figure={
              <Reveal className="grid gap-4">
                <div aria-hidden="true" className="flex h-12 items-center gap-[3px]">
                  {WAVE.map((height, i) => (
                    <span key={i} className="wave-bar w-1 rounded-full bg-agent" style={{ height: `${height * 3}px`, animationDelay: `${(i % 7) * 70}ms` }} />
                  ))}
                  <span className="ml-3 truncate text-faded">BayTel Business</span>
                </div>
                <dl className="grid gap-3">
                  {CALL.map((line, i) => (
                    <div key={i} className="reveal-line" style={{ animationDelay: `${300 + i * 700}ms` }}>
                      <dt className={`font-semibold ${line.who === "BayTel" ? "text-faded" : ""}`}>{line.who}</dt>
                      <dd>{line.text}</dd>
                    </div>
                  ))}
                </dl>
                <p className="border-t border-line pt-3 text-faded">7 lines cancelled, $5,040.00 a year</p>
              </Reveal>
            }
          >
            <p>The Negotiator called BayTel at 1:59 and had the seven unused lines cancelled, one at a time. The call ended at 4:00.</p>
          </Step>

          <Step
            index={4}
            title="It files the claim."
            rest="With the evidence and the rule it rests on."
            figure={
              <Reveal>
                <ol className="grid gap-px overflow-hidden rounded-[10px] border border-line bg-line">
                  {FILED.map((row, i) => (
                    <li
                      key={i}
                      className="reveal-line flex flex-wrap items-baseline justify-between gap-x-6 gap-y-1 bg-sheet px-5 py-4"
                      style={{ animationDelay: `${i * 150}ms` }}
                    >
                      <span>
                        <span className="block font-semibold">{row.label}</span>
                        <span className="block text-faded">{row.detail}</span>
                      </span>
                      <span className={`font-figure text-[1.375rem] ${row.amount.startsWith("$") ? "text-money" : "text-faded"}`}>{row.amount}</span>
                    </li>
                  ))}
                </ol>
              </Reveal>
            }
          >
            <p>
              While the call ran, the Filer submitted the refund claim to BayCurrent under the three-year window of Electric Rule 17.1, and changed the
              rate plan on the two Oakland accounts. Done at 4:01.
            </p>
          </Step>

          <Step
            index={5}
            title="It tracks the money."
            rest="Claimed until the provider grants it."
            figure={
              <Reveal className="grid gap-5">
                <div>
                  <p className="text-faded">Refund claimed</p>
                  <RollUp cents={REFUND_CENTS} className="mt-1 font-figure text-[2.5rem] leading-none text-money" />
                  <p className="mt-1 flex items-center gap-2 text-faded">
                    <span aria-hidden="true" className="size-2.5 rounded-full bg-warn" />
                    Due only when granted
                  </p>
                </div>
                <dl className="grid max-w-[480px] border-t border-line">
                  <dt className="pt-3 text-faded">Yearly savings</dt>
                  {LEDGER.map((row) => (
                    <dd key={row.label} className="flex items-baseline justify-between gap-4 border-b border-line py-2">
                      <span>{row.label}</span>
                      <span className="font-figure tabular-nums">{row.amount}</span>
                    </dd>
                  ))}
                </dl>
              </Reveal>
            }
          >
            <p>Finance records the refund and the savings at 4:03 and drafts the invoice. Clawback’s fee is only due on money the provider actually grants.</p>
          </Step>
        </div>
      </div>

      <section aria-labelledby="around-title" className="border-y border-line bg-sheet">
        <div className={`${WIDTH} grid gap-10 py-24 lg:grid-cols-12 lg:gap-x-10 lg:py-36`}>
          <div className="grid content-start gap-6 lg:col-span-5">
            <Statement id="around-title" lead="Around them.">
              Three more agents start the run, keep it moving, and come back next month.
            </Statement>
            <div className="flex flex-wrap gap-x-8 gap-y-3">
              <MoreLink href="/pricing">What it costs</MoreLink>
              <MoreLink href="/naive">How the agents run on naïve</MoreLink>
            </div>
          </div>
          <ul className="grid content-start border-t border-line lg:col-span-7">
            {AROUND.map((agent) => (
              <li key={agent.name} className="border-b border-line py-5">
                <span className="font-semibold">{agent.name}</span> <span className="text-faded">{agent.text}</span>
              </li>
            ))}
          </ul>
        </div>
      </section>
    </SiteFrame>
  );
}
