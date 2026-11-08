/* Hallmark · genre: modern-minimal (fintech) · macrostructure: intro → diagram of the agents and tools on naïve → how a run works → the measured run
 * design-system: docs/plan/design.md · sources: docs/plan/naive-notes.md, naive-endpoints.md, naive-rehearsal-notes.md
 * Human, 2026-11-07: "Don't mention about what's on our side, just add how we use naive". */
import type { Metadata } from "next";
import type { ReactNode } from "react";
import { LABEL, MoreLink, PageIntro, SiteFrame, Statement, WIDTH } from "../../components/landing/chrome.tsx";
import { Reveal } from "../../components/landing/motion.tsx";

export const metadata: Metadata = { title: "Built on naïve" };

// Every figure is from the naïve measurement run (run e23702bd, 2026-11-07, Sonnet 5.5) in naive-rehearsal-notes.md.

const NAIVE = "https://usenaive.ai";
const MEMBERS = ["intake", "collector", "auditor", "filer", "approver", "negotiator", "finance", "monitor"];

// A few of the run's tools, as the agents see them over MCP. Gated ones (packages/shared/src/gated-tools.ts) wait for the approval.
const TOOLS: { name: string; gated: boolean }[] = [
  { name: "download_bills", gated: false },
  { name: "run_audit", gated: false },
  { name: "draft_letter", gated: false },
  { name: "call_provider", gated: true },
  { name: "submit_claim", gated: true },
  { name: "change_rate_plan", gated: true },
  { name: "cancel_service", gated: true },
  { name: "record_savings", gated: false },
];

const HOW = [
  { title: "One coordinator, eight members.", text: "clawback-ceo gets the job and hands each step to a member agent, one at a time, waiting for its result." },
  { title: "Our tools, over MCP.", text: "Every tool the agents call is served to naïve over MCP at a public HTTPS address, with a bearer token kept in a naïve vault for the run." },
  {
    title: "One approval releases the bundle.",
    text: "Tools that act for the owner are set to ask. Each one pauses until the owner’s single YES, and then every call in the approved bundle goes through.",
  },
  { title: "Audited and capped.", text: "Every tool call and decision lands in the audit log. Each run has a $2 cap, and each agent $8 a day." },
  { title: "Nothing left running.", text: "When a run stops, every naïve session it started is cancelled: the root and each member thread." },
];

const RESULT = [
  { value: "19 of 19", label: "actions done, summary sent" },
  { value: "13 min 33 s", label: "start to finish" },
  { value: "$1.70", label: "naïve cost, against a $2 cap" },
  { value: "11", label: "sessions, all cancelled at the end" },
];

function Node({ title, children, tone = "line" }: { title: string; children?: ReactNode; tone?: "line" | "agent" | "warn" }) {
  const border = tone === "agent" ? "border-agent" : tone === "warn" ? "border-warn" : "border-line";
  return (
    <div className={`reveal-line grid content-start gap-1 rounded-[10px] border ${border} bg-sheet px-4 py-3`}>
      <p className="font-semibold">{title}</p>
      {children && <div className="text-[15px] text-faded">{children}</div>}
    </div>
  );
}

/** A short connector between two rows of the diagram. */
const Down = ({ label }: { label: string }) => (
  <div className="flex items-center gap-3 pl-6 text-[15px] text-faded">
    <span aria-hidden="true" className="h-8 w-px border-l-2 border-dashed border-agent" />
    {label}
  </div>
);

function Diagram() {
  return (
    <Reveal className="canvas grid gap-1 rounded-[12px] border border-line bg-paper p-4 sm:p-8">
      <p className={`${LABEL} mb-3 text-faded`}>On naïve</p>
      <Node title="clawback-ceo" tone="agent">
        The coordinator
      </Node>
      <Down label="delegates each step" />
      <ul aria-label="Member agents" className="grid gap-2 sm:grid-cols-2">
        {MEMBERS.map((member, i) => (
          <li key={member} className="reveal-line rounded-[10px] border border-line bg-sheet px-4 py-2.5" style={{ animationDelay: `${120 + i * 50}ms` }}>
            clawback-{member}
          </li>
        ))}
      </ul>
      <Down label="call tools over MCP" />
      <div className="grid gap-3 rounded-[10px] border border-line bg-sheet p-4">
        <p className="font-semibold">Clawback’s tools</p>
        <ul aria-label="Some of the tools" className="flex flex-wrap gap-1.5">
          {TOOLS.map((tool, i) => (
            <li
              key={tool.name}
              className={`reveal-line flex items-center gap-2 rounded-full border px-2.5 py-0.5 text-[15px] ${tool.gated ? "border-warn" : "border-line text-faded"}`}
              style={{ animationDelay: `${500 + i * 50}ms` }}
            >
              <code>{tool.name}</code>
              <span className={tool.gated ? "text-warn" : ""}>{tool.gated ? "ask" : "allow"}</span>
            </li>
          ))}
        </ul>
      </div>
      <Down label="ask waits for" />
      <Node title="The owner’s one YES" tone="warn">
        Releases every gated call in the approved bundle
      </Node>
      <div className="mt-4 grid gap-2 sm:grid-cols-2">
        <Node title="Audit log">Every call and every decision</Node>
        <Node title="Caps">$2 a run, $8 a day per agent</Node>
      </div>
    </Reveal>
  );
}

export default function NaivePage() {
  return (
    <SiteFrame>
      <PageIntro caption="Built on naïve" lead="Clawback’s agents run on naïve." rest="A team of nine, one approval, capped and audited.">
        <p>
          Each Clawback agent is a managed agent on{" "}
          <a href={NAIVE} className="text-agent underline underline-offset-2">
            naïve
          </a>
          , named <code className="text-ink">clawback-&lt;agent&gt;</code>. Here is how they work together there, and what one full audit cost.
        </p>
      </PageIntro>

      <section aria-labelledby="how-title" className={`${WIDTH} grid gap-12 pb-24 lg:grid-cols-12 lg:gap-x-10 lg:pb-36`}>
        <div className="grid content-start gap-8 lg:col-span-5">
          <Statement id="how-title" lead="How we use naïve.">
            A coordinator, its members, our tools, and one human decision.
          </Statement>
          <ol className="grid border-t border-line">
            {HOW.map((step) => (
              <li key={step.title} className="border-b border-line py-5">
                <span className="font-semibold">{step.title}</span> <span className="text-faded">{step.text}</span>
              </li>
            ))}
          </ol>
        </div>
        <div className="min-w-0 lg:col-span-7">
          <Diagram />
        </div>
      </section>

      <section aria-labelledby="run-title" className="border-y border-line bg-sheet">
        <div className={`${WIDTH} grid gap-10 py-24 lg:py-36`}>
          <Statement id="run-title" lead="One full audit on naïve.">
            The noodle shop’s bills, on 7 November 2026, with Sonnet 5.5 and a $2 cap.
          </Statement>
          <dl className="grid gap-px overflow-hidden rounded-[12px] border border-line bg-line sm:grid-cols-2 lg:grid-cols-4">
            {RESULT.map((item) => (
              <div key={item.label} className="grid content-start gap-1 bg-paper px-5 py-5">
                <dd className={`order-first font-figure text-[2rem] leading-tight ${item.value.startsWith("$") ? "text-money" : ""}`}>{item.value}</dd>
                <dt className="text-[15px] text-faded">{item.label}</dt>
              </div>
            ))}
          </dl>
          <p className="max-w-[72ch] text-faded">
            The run ended in success: every action done and the owner’s summary sent. It was approved by a scripted stand-in for the owner’s tap.
          </p>
          <MoreLink href="/how-it-works">What each agent does</MoreLink>
        </div>
      </section>
    </SiteFrame>
  );
}
