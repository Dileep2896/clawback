/* Hallmark · genre: modern-minimal (fintech) · macrostructure: intro → architecture (naïve side · tunnel · our side) → measured runs → what stays ours → one switch
 * design-system: docs/plan/design.md · sources: docs/plan/naive-notes.md, naive-endpoints.md, naive-rehearsal-notes.md */
import type { Metadata } from "next";
import type { ReactNode } from "react";
import { LABEL, MoreLink, PageIntro, SiteFrame, Statement, WIDTH } from "../../components/landing/chrome.tsx";
import { Reveal } from "../../components/landing/motion.tsx";

export const metadata: Metadata = { title: "Built on naïve" };

// Every figure is from the lane notes above: the naïve measurement run (run e23702bd, 2026-11-07, Sonnet 5.5, $2 cap),
// the flag probe, and the recorded local run (data/replay/run.jsonl: runs.cost_usd and finished_at).

const NAIVE = "https://usenaive.ai";
const MEMBERS = ["intake", "collector", "auditor", "filer", "approver", "negotiator", "finance", "monitor"];

const RUNS = [
  { label: "Result", local: "Success", naive: "Success: 19 of 19 actions done, summary sent" },
  { label: "Start to finish", local: "4 min 28 s", naive: "13 min 33 s" },
  { label: "Model cost", local: "$0.40", naive: "$1.70, under the $2 cap" },
  { label: "Sessions", local: "One process", naive: "11 (a root and 10 member threads), all cancelled at the end" },
  { label: "Paused tool calls", local: "None", naive: "53: 12 gated, 28 ungated, 13 delegations" },
];

const STAYS = [
  { what: "Phone calls", why: "naïve has no voice. The Negotiator’s calls go through Retell or Vapi, as they do locally." },
  { what: "The virtual card", why: "naïve’s card issuing answered 501, not configured yet. Runs use our mock card, capped at $5." },
  { what: "Sending SMS", why: "naïve’s SMS send answered 501 too. The approval request goes by email, and the owner taps approve." },
  {
    what: "Provider portals",
    why: "naïve’s browser won’t open a private host, and its vault holds only API tokens. The Collector keeps Playwright and our own vault.",
  },
  { what: "The database", why: "Board cards, the audit log and the ledger stay in our Postgres, so the dashboard reads the same rows in both modes." },
];

function Box({ title, children, tone = "line" }: { title: string; children: ReactNode; tone?: "line" | "agent" | "warn" }) {
  const border = tone === "agent" ? "border-agent" : tone === "warn" ? "border-warn" : "border-line";
  return (
    <div className={`reveal-line grid content-start gap-1 rounded-[10px] border ${border} bg-sheet px-4 py-3`}>
      <p className="font-semibold">{title}</p>
      <div className="text-[15px] text-faded">{children}</div>
    </div>
  );
}

/** naïve's side, the tunnel, our side. Three columns at lg; stacked below, with the tunnel as a band between. */
function Architecture() {
  return (
    <Reveal className="grid gap-4 lg:grid-cols-[minmax(0,1fr)_14rem_minmax(0,1fr)] lg:items-stretch">
      <section aria-labelledby="naive-side" className="canvas grid content-start gap-3 rounded-[12px] border border-line bg-paper p-4 sm:p-6">
        <h3 id="naive-side" className={`${LABEL} text-faded`}>
          On naïve
        </h3>
        <Box title="clawback-ceo" tone="agent">
          The coordinator. It hands each step to a member agent and waits for the result.
        </Box>
        <ul aria-label="Member agents" className="flex flex-wrap gap-1.5">
          {MEMBERS.map((member, i) => (
            <li
              key={member}
              className="reveal-line rounded-full border border-line px-2.5 py-0.5 text-[15px] text-faded"
              style={{ animationDelay: `${150 + i * 50}ms` }}
            >
              clawback-{member}
            </li>
          ))}
        </ul>
        <Box title="Tool policy">
          Tools that act for the owner are set to <code className="text-ink">ask</code>; the rest to <code className="text-ink">allow</code>.
        </Box>
        <Box title="Caps">$2 a run, $8 a day per agent. Every session the run started is cancelled when it stops.</Box>
      </section>

      {/* The tunnel: a dashed line between the two sides (across at lg, down when stacked), with what crosses it. */}
      <div className="grid content-center gap-3 px-2 py-2 text-center">
        <div aria-hidden="true" className="reveal-draw hidden w-full border-t-2 border-dashed border-agent lg:block" />
        <div aria-hidden="true" className="mx-auto h-10 w-px border-l-2 border-dashed border-agent lg:hidden" />
        <p className="font-semibold">Tunnel</p>
        <p className="text-[15px] text-faded">
          Our tools, served over MCP at a public HTTPS address. Open only while a run is going, with a bearer token kept in a naïve vault and deleted
          when the run ends.
        </p>
        <div aria-hidden="true" className="mx-auto h-10 w-px border-l-2 border-dashed border-agent lg:hidden" />
      </div>

      <section aria-labelledby="our-side" className="canvas grid content-start gap-3 rounded-[12px] border border-line bg-paper p-4 sm:p-6">
        <h3 id="our-side" className={`${LABEL} text-faded`}>
          On our side
        </h3>
        <Box title="MCP tool server">Every tool the agents call: parse a bill, run the audit, file a claim, cancel a line.</Box>
        <Box title="Approval loop" tone="warn">
          One YES from the owner releases the bundle. A paused call goes through only if its action is in the approved bundle.
        </Box>
        <Box title="Postgres">Board cards, audit log, ledger. The dashboard reads these in both modes.</Box>
        <Box title="Voice, card, portals">Retell or Vapi, the mock card, Playwright.</Box>
      </section>
    </Reveal>
  );
}

export default function NaivePage() {
  return (
    <SiteFrame>
      <PageIntro caption="Built on naïve" lead="The same agents, on naïve." rest="Or on one laptop. One switch.">
        <p>
          Clawback’s agents can run as managed agents on{" "}
          <a href={NAIVE} className="text-agent underline underline-offset-2">
            naïve
          </a>
          , or locally through Claude Code. Here is what runs where, what we measured, and what naïve can’t do for us yet.
        </p>
      </PageIntro>

      <section aria-labelledby="arch-title" className={`${WIDTH} grid gap-10 pb-24 lg:pb-36`}>
        <Statement id="arch-title" lead="What runs on naïve.">
          Each agent is a naïve agent. Our tools stay on our side and reach them through one tunnel.
        </Statement>
        <Architecture />
      </section>

      <section aria-labelledby="runs-title" className="border-y border-line bg-sheet">
        <div className={`${WIDTH} grid gap-10 py-24 lg:py-36`}>
          <Statement id="runs-title" lead="What we measured.">
            The full audit, once each way. Same customer, same bills.
          </Statement>
          <div className="overflow-hidden rounded-[12px] border border-line bg-paper">
            <table className="w-full text-left">
              <thead className="text-[15px] text-faded">
                <tr className="border-b border-line">
                  <th className="px-5 py-3 font-normal">
                    <span className="sr-only">Measure</span>
                  </th>
                  <th className="px-5 py-3 font-normal">Local</th>
                  <th className="px-5 py-3 font-normal">naïve</th>
                </tr>
              </thead>
              <tbody>
                {RUNS.map((row) => (
                  <tr key={row.label} className="border-b border-line align-top last:border-b-0">
                    <th scope="row" className="px-5 py-4 font-semibold">
                      {row.label}
                    </th>
                    <td className="px-5 py-4">{row.local}</td>
                    <td className="px-5 py-4">{row.naive}</td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
          <div className="grid gap-4 lg:grid-cols-2 lg:gap-5">
            <div className="grid content-start gap-3 rounded-[12px] border border-line bg-paper p-6 sm:p-8">
              <h3 className="text-[1.375rem] font-semibold">Where the 13 minutes go</h3>
              <p className="text-faded">
                Once a naïve chat has seen a tool result, its next tool call is refused, the model issues it again, and that call waits for us to allow
                it. Each pause costs a model turn and 10 to 15 seconds. In this run, every member agent’s calls paused from the first one.
              </p>
            </div>
            <div className="grid content-start gap-3 rounded-[12px] border border-line bg-paper p-6 sm:p-8">
              <h3 className="text-[1.375rem] font-semibold">What a $0.001 probe showed</h3>
              <p className="text-faded">
                One agent, one allowed tool, two calls. With the bill email in its first message, it made both calls and paused on none. Without it, the
                second call paused after the first result came back. So the email doesn’t cause the pause; a tool result does. Allowing a paused call
                costs no extra model turn.
              </p>
            </div>
          </div>
          <p className="max-w-[72ch] text-faded">
            Local cost is the run’s recorded model cost. The naïve run, on 7 November 2026, was approved by a scripted stand-in for the owner’s tap.
          </p>
        </div>
      </section>

      <section aria-labelledby="stays-title" className={`${WIDTH} grid gap-10 py-24 lg:grid-cols-12 lg:gap-x-10 lg:py-36`}>
        <div className="lg:col-span-5">
          <Statement id="stays-title" lead="What stays on our side.">
            Some of it naïve doesn’t offer, and some of it isn’t switched on yet.
          </Statement>
        </div>
        <ul className="grid content-start border-t border-line lg:col-span-7">
          {STAYS.map((item) => (
            <li key={item.what} className="grid gap-1 border-b border-line py-5 sm:grid-cols-[12rem_minmax(0,1fr)] sm:gap-x-6">
              <span className="font-semibold">{item.what}</span>
              <span className="text-faded">{item.why}</span>
            </li>
          ))}
        </ul>
      </section>

      <section aria-labelledby="switch-title" className={`${WIDTH} grid gap-10 pb-24 lg:grid-cols-12 lg:gap-x-10 lg:pb-36`}>
        <div className="grid content-start gap-6 lg:col-span-5">
          <Statement id="switch-title" lead="One switch.">
            The same agents and tools run either way. The stage demo runs locally, because a naïve run takes about 13 minutes.
          </Statement>
          <MoreLink href="/how-it-works">What the agents do</MoreLink>
        </div>
        <pre className="min-w-0 overflow-x-auto rounded-[12px] border border-line bg-sheet p-5 text-[15px] leading-relaxed lg:col-span-7">
          <code>
            <span className="text-faded"># on one laptop, through Claude Code</span>
            {"\n"}PLATFORM=local pnpm dev:webhooks{"\n\n"}
            <span className="text-faded"># on naïve, with the tool tunnel open</span>
            {"\n"}PLATFORM=naive pnpm naive:tunnel -- pnpm dev:webhooks{"\n\n"}
            <span className="text-faded"># then, either way</span>
            {"\n"}pnpm demo:start
          </code>
        </pre>
      </section>
    </SiteFrame>
  );
}
