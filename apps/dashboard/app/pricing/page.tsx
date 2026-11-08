/* Hallmark · genre: modern-minimal (fintech) · macrostructure: intro → worked example (bar + statement) → when each part is due → counts / doesn't → FAQ
 * design-system: docs/plan/design.md */
import { feeCents } from "@bill-fighter/core/money/fee";
import type { Metadata } from "next";
import { LABEL, MoreLink, PageIntro, SiteFrame, Statement, WIDTH } from "../../components/landing/chrome.tsx";
import { KeepFeeBar, KeepFeeStatement } from "../../components/landing/keep-fee.tsx";
import { dollars, FEE_CENTS, REFUND_CENTS, YEARLY_CENTS } from "../../components/landing/timeline.ts";

export const metadata: Metadata = { title: "Pricing" };

const SHARE = 30;
// The fee splits into its refund part and its savings part; the savings part is the remainder, so the two add up to the recorded fee to the cent.
const REFUND_FEE = feeCents({ refundCents: REFUND_CENTS, annualSavingsCents: 0, sharePct: SHARE });
const SAVINGS_FEE = FEE_CENTS - REFUND_FEE;

// The fee by finding, from the recorded run's ledger (the landing's Fig 5): each line is 30% of its own money, and the last
// line takes the rounding cent, so the lines add up to the recorded fee and their savings to the first year's total.
const FINDINGS = [
  { label: "Fremont meter refund", part: "Refund", cents: REFUND_CENTS },
  { label: "Fremont meter fixed, first year", part: "Savings", cents: 1_071_037 },
  { label: "7 unused lines cancelled, first year", part: "Savings", cents: 504_000 },
  { label: "2 rate changes, first year", part: "Savings", cents: 256_895 },
].map((row, i, rows) => ({
  ...row,
  fee:
    i < rows.length - 1
      ? feeCents({ refundCents: row.cents, annualSavingsCents: 0, sharePct: SHARE })
      : FEE_CENTS - rows.slice(0, -1).reduce((sum, r) => sum + feeCents({ refundCents: r.cents, annualSavingsCents: 0, sharePct: SHARE }), 0),
}));
if (FINDINGS.filter((row) => row.part === "Savings").reduce((sum, row) => sum + row.cents, 0) !== YEARLY_CENTS)
  throw new Error("Pricing: the savings by finding no longer add up to the first year's savings");

const DUE = [
  {
    what: "The refund",
    amount: REFUND_CENTS,
    fee: REFUND_FEE,
    when: "Once BayCurrent grants the Rule 17.1 claim. Until then it is claimed, and nothing is due on it.",
    status: "Claimed, not yet granted",
  },
  {
    what: "The first year’s savings",
    amount: YEARLY_CENTS,
    fee: SAVINGS_FEE,
    when: "Month by month, as each lower bill shows up. Never on the projection. After the first year, the savings are all yours.",
    status: "Projected",
  },
];

const COUNTS = [
  "A refund the provider has granted, as a credit or a payment.",
  "Savings that show up as a lower charge on your bills in the first year.",
  "A cancelled phone line, once the provider confirms it is cancelled.",
];

const DOESNT = [
  "A claim that is filed but not granted. Claimed is not granted.",
  "Projected savings that never show up on a bill.",
  "Anything you say no to when the agents ask for your approval.",
  "Savings after the first year.",
];

const FAQ = [
  { q: "What do I pay up front?", a: "Nothing. There is no sign-up fee, no subscription and no plan to pick." },
  { q: "What if the agents find nothing?", a: "Then you pay nothing. The fee only exists as a share of money that came back." },
  { q: "What if the provider turns the claim down?", a: "There is no fee on it. The ledger keeps it as claimed, and it never becomes due." },
  {
    q: "When is the fee charged?",
    a: `The refund’s ${SHARE}% once the provider grants it. The savings’ ${SHARE}% as each month’s lower bill arrives, for the first year only.`,
  },
  {
    q: "Do the agents call or file anything without me?",
    a: "No. They read your bills and find the overcharges, then ask you once, by text. Nothing is filed and no call is made until you reply yes.",
  },
  { q: "Are there tiers or a bigger plan?", a: `No. Every business pays the same ${SHARE}% of what comes back.` },
];

function Dot({ tone }: { tone: "money" | "warn" }) {
  return <span aria-hidden="true" className={`inline-block size-2.5 shrink-0 rounded-full ${tone === "money" ? "bg-money" : "bg-warn"}`} />;
}

export default function PricingPage() {
  return (
    <SiteFrame current="/pricing">
      <PageIntro caption="Pricing" lead={`${SHARE}% of what comes back.`} rest="Nothing up front. Nothing if nothing comes back.">
        <p>
          Clawback’s fee is {SHARE}% of the refund and of the first year’s savings, and it is only charged on money that actually reaches you: a
          refund once the provider grants it, savings once they show up on your bills.
        </p>
      </PageIntro>

      <section aria-labelledby="example-title" className={`${WIDTH} grid gap-12 pb-24 lg:grid-cols-12 lg:gap-x-10 lg:pb-36`}>
        <div className="grid content-start gap-6 lg:col-span-5">
          <p className={`${LABEL} flex flex-wrap items-center gap-3 text-faded`}>
            Worked example
            <span className="rounded-full border border-line px-2 py-0.5 tracking-[0.08em]">Demo data</span>
          </p>
          <Statement id="example-title" lead="One noodle shop’s audit.">
            Golden Gate Noodle Co., three sites, 4 minutes 28 seconds of agent work.
          </Statement>
          <p className="max-w-[48ch] text-faded">
            The agents found a meter billed at twice its reading, two accounts on the wrong rate, and seven phone lines nobody uses. If the provider
            grants the refund and the lower bills arrive, this is how the money splits.
          </p>
        </div>
        <div className="grid content-start gap-8 lg:col-span-7">
          <KeepFeeBar />
          <KeepFeeStatement />
        </div>
      </section>

      <section aria-labelledby="due-title" className="border-y border-line bg-sheet">
        <div className={`${WIDTH} py-24 lg:py-36`}>
          <Statement id="due-title" lead="When each part is due.">
            The fee has two parts, and each one waits for its own money.
          </Statement>
          <ol className="mt-12 grid gap-4 lg:grid-cols-2 lg:gap-5">
            {DUE.map((part) => (
              <li key={part.what} className="grid content-start gap-5 rounded-[12px] border border-line bg-paper p-6 sm:p-8">
                <p className="flex items-center gap-2 text-[15px] text-faded">
                  <Dot tone="warn" />
                  {part.status}
                </p>
                <div className="flex flex-wrap items-baseline justify-between gap-x-6 gap-y-1">
                  <h3 className="text-[1.375rem] font-semibold">{part.what}</h3>
                  <span className="font-figure text-[2rem] leading-none text-money">{dollars(part.amount)}</span>
                </div>
                <div className="flex flex-wrap items-baseline justify-between gap-x-6 gap-y-1 border-t border-line pt-4">
                  <span className="text-faded">Fee, {SHARE}%</span>
                  <span className="font-figure text-[1.5rem] leading-none">{dollars(part.fee)}</span>
                </div>
                <p className="text-faded">
                  <span className="font-semibold text-ink">Due: </span>
                  {part.when}
                </p>
              </li>
            ))}
          </ol>
          <table className="mt-8 w-full max-w-[760px] text-[15px]">
            <caption className="pb-2 text-left text-faded">The fee, by finding</caption>
            <thead className="text-faded">
              <tr className="border-b border-line">
                <th scope="col" className="py-2 pr-4 text-left font-normal">
                  Finding
                </th>
                <th scope="col" className="py-2 pr-4 text-right font-normal">
                  Money back
                </th>
                <th scope="col" className="py-2 text-right font-normal">
                  Fee, {SHARE}%
                </th>
              </tr>
            </thead>
            <tbody>
              {FINDINGS.map((row) => (
                <tr key={row.label} className="border-b border-line">
                  <th scope="row" className="py-2 pr-4 text-left font-normal">
                    {row.label}
                  </th>
                  <td className="py-2 pr-4 text-right font-figure tabular-nums">{dollars(row.cents)}</td>
                  <td className="py-2 text-right font-figure tabular-nums">{dollars(row.fee)}</td>
                </tr>
              ))}
            </tbody>
            <tfoot>
              <tr className="border-t-2 border-ink">
                <th scope="row" className="py-3 pr-4 text-left font-semibold">
                  Total
                </th>
                <td className="py-3 pr-4 text-right font-figure tabular-nums">{dollars(REFUND_CENTS + YEARLY_CENTS)}</td>
                <td className="py-3 text-right font-figure tabular-nums">{dollars(FEE_CENTS)}</td>
              </tr>
            </tfoot>
          </table>
        </div>
      </section>

      <section aria-labelledby="counts-title" className={`${WIDTH} py-24 lg:py-36`}>
        <Statement id="counts-title" lead="What counts, and what doesn’t.">
          The fee is charged on granted money only.
        </Statement>
        <div className="mt-12 grid gap-4 md:grid-cols-2 lg:gap-5">
          <div className="rounded-[12px] border border-line bg-sheet p-6 sm:p-8">
            <h3 className="flex items-center gap-2 text-[1.375rem] font-semibold">
              <Dot tone="money" />
              Counts toward the fee
            </h3>
            <ul className="mt-5 grid gap-3">
              {COUNTS.map((item) => (
                <li key={item} className="border-t border-line pt-3">
                  {item}
                </li>
              ))}
            </ul>
          </div>
          <div className="rounded-[12px] border border-line bg-sheet p-6 sm:p-8">
            <h3 className="flex items-center gap-2 text-[1.375rem] font-semibold">
              <span aria-hidden="true" className="inline-block size-2.5 shrink-0 rounded-full border border-faded" />
              Never counts
            </h3>
            <ul className="mt-5 grid gap-3 text-faded">
              {DOESNT.map((item) => (
                <li key={item} className="border-t border-line pt-3">
                  {item}
                </li>
              ))}
            </ul>
          </div>
        </div>
      </section>

      <section aria-labelledby="faq-title" className={`${WIDTH} grid gap-12 pb-24 lg:grid-cols-12 lg:gap-x-10 lg:pb-36`}>
        <div className="grid content-start gap-6 lg:col-span-5">
          <Statement id="faq-title" lead="Questions.">
            What to know before your first audit.
          </Statement>
          <MoreLink href="/how-it-works">See what the agents do</MoreLink>
        </div>
        <div className="border-t border-line lg:col-span-7">
          {FAQ.map((item) => (
            <details key={item.q} className="group border-b border-line">
              <summary className="flex cursor-pointer list-none items-center justify-between gap-6 py-5 text-[1.125rem] font-semibold [&::-webkit-details-marker]:hidden">
                {item.q}
                <span aria-hidden="true" className="text-[1.5rem] leading-none text-faded group-open:rotate-45 motion-safe:transition-transform">
                  +
                </span>
              </summary>
              <p className="max-w-[60ch] pb-6 text-faded">{item.a}</p>
            </details>
          ))}
        </div>
      </section>
    </SiteFrame>
  );
}
