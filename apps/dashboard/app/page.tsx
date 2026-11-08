/* Hallmark · genre: modern-minimal (fintech) · macrostructure: Product frame hero → counter strip → bento → statement figures → pricing → CTA band
 * design-system: docs/plan/design.md · reference study: docs/plan/design-study.md · nav: sticky blurred · footer: columns + demo pill */
import { Bento } from "../components/landing/bento.tsx";
import { LABEL, MoreLink, SiteFrame, Statement, WIDTH } from "../components/landing/chrome.tsx";
import { KeepFeeBar, KeepFeeStatement } from "../components/landing/keep-fee.tsx";
import { LiveRun } from "../components/landing/live-run.tsx";
import { MARKET_NOTE, MARKET_TEASER } from "../components/landing/market.ts";
import { ButtonLink } from "../components/ui/kit.tsx";

// The demo audit in five figures (data/replay/run.jsonl).
const COUNTS = [
  { value: "$12,606.06", label: "refund claimed" },
  { value: "14", label: "overcharged bills found" },
  { value: "7", label: "unused lines cancelled" },
  { value: "1", label: "approval, by text" },
  { value: "4 min 28 s", label: "start to finish" },
];

export default function Landing() {
  return (
    <SiteFrame>
      <section aria-labelledby="hero" className={`${WIDTH} grid gap-8 pt-16 pb-12 lg:grid-cols-12 lg:items-end lg:gap-x-10 lg:pt-24 lg:pb-16`}>
        <h1 id="hero" className="text-[clamp(2.75rem,5.4vw,4.5rem)] leading-[1.02] font-semibold tracking-[-0.03em] lg:col-span-7">
          Your bills are wrong. <span className="text-faded">Agents fix them.</span>
        </h1>
        <div className="grid gap-6 lg:col-span-5 lg:pb-2">
          <p className="max-w-[44ch] text-[1.125rem] text-faded">
            Clawback reads every utility and phone bill your business pays, finds the overcharges, calls the provider and files the claims. You approve
            once.
          </p>
          <div className="flex flex-wrap items-center gap-x-6 gap-y-3">
            <ButtonLink href="/signup" className="min-h-12 px-5">
              Start my audit
            </ButtonLink>
            <MoreLink href="/how-it-works">See how it works</MoreLink>
          </div>
        </div>
      </section>

      {/* The product on a dark canvas, running past the fold. */}
      <div className={WIDTH}>
        <div className="canvas rounded-[16px] border border-line bg-paper p-3 sm:p-6 lg:p-10">
          <LiveRun />
        </div>
      </div>

      <section aria-labelledby="counts" className={`${WIDTH} pt-16 lg:pt-20`}>
        <h2 id="counts" className={`${LABEL} flex flex-wrap items-center gap-3 text-faded`}>
          Recovered for the noodle shop in one audit
          <span className="rounded-full border border-line px-2 py-0.5 tracking-[0.08em]">Demo data</span>
        </h2>
        <dl className="mt-5 grid gap-px overflow-hidden rounded-[12px] border border-line bg-line sm:grid-cols-2 lg:grid-cols-5">
          {COUNTS.map((count) => (
            <div key={count.label} className="grid content-start gap-1 bg-sheet px-5 py-4 sm:last:col-span-2 lg:last:col-span-1">
              <dd className={`order-first font-figure text-[1.75rem] leading-tight ${count.value.startsWith("$") ? "text-money" : ""}`}>{count.value}</dd>
              <dt className="text-[15px] text-faded">{count.label}</dt>
            </div>
          ))}
        </dl>
      </section>

      <section aria-labelledby="how-title" id="how" className={`${WIDTH} scroll-mt-20 py-24 lg:py-36`}>
        <Statement id="how-title" lead="One audit, start to finish.">
          The agents sign in to each provider’s portal, check every line against the meter and the published tariff, and only act once you say yes.
        </Statement>
        <div className="mt-12 lg:mt-16">
          <Bento />
        </div>
        <div className="mt-10">
          <MoreLink href="/how-it-works">Follow the six agents step by step</MoreLink>
        </div>
      </section>

      <section aria-labelledby="market-title" id="market" className="scroll-mt-20 border-y border-line bg-sheet">
        <div className={`${WIDTH} py-24 lg:py-36`}>
          <Statement id="market-title" lead="The market.">
            Today only large companies pay auditors to get it back. Clawback’s agents do it for every business.
          </Statement>
          <dl className="mt-14 grid gap-12 md:grid-cols-2">
            {MARKET_TEASER.map((figure) => (
              <div key={figure.value} className="grid min-w-0 content-start gap-4 border-t border-line pt-8">
                <dt className="max-w-[36ch] text-[1.25rem] text-faded">{figure.label}</dt>
                <dd className="order-first font-figure text-[clamp(3.5rem,8vw,7rem)] leading-none text-money">{figure.value}</dd>
              </div>
            ))}
          </dl>
          <p className="mt-14 max-w-[72ch] text-base text-faded">{MARKET_NOTE}</p>
          <div className="mt-8">
            <MoreLink href="/market">How each number is worked out</MoreLink>
          </div>
        </div>
      </section>

      <section aria-labelledby="pricing-title" id="pricing" className={`${WIDTH} grid scroll-mt-20 gap-12 py-24 lg:grid-cols-12 lg:gap-x-10 lg:py-36`}>
        <div className="grid content-start gap-6 lg:col-span-6">
          <Statement id="pricing-title" lead="Paid only from what is recovered.">
            30% of the refund and the first year’s savings, taken from money that actually comes back.
          </Statement>
          <p className="max-w-[48ch] text-faded">The refund is claimed, not yet granted, and the savings are projected for the first year.</p>
          <MoreLink href="/pricing">See the full pricing</MoreLink>
        </div>
        <div className="grid content-start gap-8 lg:col-span-6">
          <KeepFeeBar />
          <KeepFeeStatement />
        </div>
      </section>
    </SiteFrame>
  );
}
