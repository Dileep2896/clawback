/* Hallmark · genre: modern-minimal (fintech) · macrostructure: Product frame hero → counter strip → bento → statement figures → pricing → CTA band
 * design-system: docs/plan/design.md · reference study: docs/plan/design-study.md · nav: sticky blurred · footer: columns + demo pill */
import Link from "next/link";
import type { ReactNode } from "react";
import { Bento } from "../components/landing/bento.tsx";
import { LiveRun } from "../components/landing/live-run.tsx";
import { Reveal } from "../components/landing/motion.tsx";
import { dollars, FEE_CENTS, KEEP_CENTS, REFUND_CENTS, YEARLY_CENTS } from "../components/landing/timeline.ts";
import { ButtonLink, Wordmark } from "../components/ui/kit.tsx";

// Market size estimates, wording fixed by the human (docs/plan/phases/13-product-ui.md, landing-tam).
const MARKET = [
  { value: "$500B+", label: "US businesses pay every year in electricity, gas, water and phone bills" },
  { value: "$5 to 16B", label: "a year left on the table: 1 to 3% of it is billed wrong or on the wrong plan" },
];

// The demo audit in five figures (data/replay/run.jsonl).
const COUNTS = [
  { value: "$12,606.06", label: "refund claimed" },
  { value: "14", label: "overcharged bills found" },
  { value: "7", label: "unused lines cancelled" },
  { value: "1", label: "approval, by text" },
  { value: "4 min 28 s", label: "start to finish" },
];

const SECTIONS = [
  { href: "#how", label: "How it works" },
  { href: "#pricing", label: "Pricing" },
  { href: "#market", label: "The market" },
];

const WIDTH = "mx-auto w-full max-w-[1320px] px-4 sm:px-6";
const LABEL = "font-mono text-[12px] tracking-[0.12em] uppercase";

/** A section intro as one large two-tone sentence: the claim in ink, the rest in grey. */
function Statement({ id, lead, children }: { id: string; lead: string; children: ReactNode }) {
  return (
    <h2 id={id} className="max-w-[30ch] text-[clamp(1.75rem,3.2vw,2.75rem)] leading-[1.15] font-semibold tracking-[-0.02em]">
      {lead} <span className="text-faded">{children}</span>
    </h2>
  );
}

export default function Landing() {
  const keepShare = (KEEP_CENTS / (KEEP_CENTS + FEE_CENTS)) * 100;

  return (
    <div className="min-h-dvh overflow-x-clip">
      <header className="sticky top-0 z-10 bg-paper/80 backdrop-blur-md">
        <div className={`${WIDTH} flex h-16 items-center gap-x-2 min-[360px]:gap-x-4 sm:gap-x-8`}>
          <a href="#top" className="shrink-0 rounded-control text-[1.125rem] min-[360px]:text-[1.25rem] sm:text-[1.375rem]">
            <Wordmark />
          </a>
          <nav aria-label="Sections" className="hidden md:block">
            <ul className="flex gap-6 text-[15px] text-faded">
              {SECTIONS.map((link) => (
                <li key={link.href}>
                  <a href={link.href} className="hover:text-ink">
                    {link.label}
                  </a>
                </li>
              ))}
            </ul>
          </nav>
          <nav aria-label="Account" className="ml-auto flex items-center gap-1">
            <ButtonLink href="/login" variant="ghost" className="text-[15px] font-normal text-faded hover:text-ink max-[360px]:px-1.5 min-[360px]:px-2 sm:px-4" data-testid="log-in">
              Log in
            </ButtonLink>
            <ButtonLink href="/signup" className="text-[15px] max-[360px]:px-2.5" data-testid="get-started">
              {/* Under 360px the header keeps one row: a shorter CTA, a smaller wordmark, tighter gaps. One span, so the
                  button's flex gap doesn't split the words. */}
              <span>
                Start <span className="max-[360px]:hidden">my </span>audit
              </span>
            </ButtonLink>
          </nav>
        </div>
      </header>

      <main id="top">
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
              <a href="#how" className="font-semibold text-ink underline decoration-line decoration-2 underline-offset-4 hover:decoration-ink">
                See how it works
              </a>
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
        </section>

        <section aria-labelledby="market-title" id="market" className="scroll-mt-20 border-y border-line bg-sheet">
          <div className={`${WIDTH} py-24 lg:py-36`}>
            <Statement id="market-title" lead="The market.">
              Today only large companies pay auditors to get it back. Clawback’s agents do it for every business.
            </Statement>
            <dl className="mt-14 grid gap-12 md:grid-cols-2">
              {MARKET.map((figure) => (
                <div key={figure.value} className="grid min-w-0 content-start gap-4 border-t border-line pt-8">
                  <dt className="max-w-[36ch] text-[1.25rem] text-faded">{figure.label}</dt>
                  <dd className="order-first font-figure text-[clamp(3.5rem,8vw,7rem)] leading-none text-money">{figure.value}</dd>
                </div>
              ))}
            </dl>
            <p className="mt-14 max-w-[72ch] text-base text-faded">
              Estimates. Electricity: US EIA, 2025 retail sales ($290B commercial and industrial). Telecom: Grand View Research, 2022 ($187B). Error rates:
              bill-audit industry reports (3 to 5% recovered); we assume 1 to 3%.
            </p>
          </div>
        </section>

        <section aria-labelledby="pricing-title" id="pricing" className={`${WIDTH} grid scroll-mt-20 gap-12 py-24 lg:grid-cols-12 lg:gap-x-10 lg:py-36`}>
          <div className="lg:col-span-6">
            <Statement id="pricing-title" lead="Paid only from what is recovered.">
              30% of the refund and the first year’s savings, taken from money that actually comes back.
            </Statement>
            <p className="mt-6 max-w-[48ch] text-faded">The refund is claimed, not yet granted, and the savings are projected for the first year.</p>
          </div>
          <div className="grid content-start gap-8 lg:col-span-6">
            <Reveal className="grid gap-3">
              <div aria-hidden="true" className="flex h-14 gap-1 overflow-hidden rounded-[10px]">
                <div className="reveal-grow bg-money" style={{ width: `${keepShare}%` }} />
                <div className="reveal-grow flex-1 bg-ink/15" style={{ animationDelay: "250ms" }} />
              </div>
              <p className="flex flex-wrap justify-between gap-x-6 text-[15px]">
                <span>
                  <span aria-hidden="true" className="mr-2 inline-block size-2.5 rounded-full bg-money" />
                  You keep <span className="font-figure text-money">{dollars(KEEP_CENTS)}</span>
                </span>
                <span>
                  <span aria-hidden="true" className="mr-2 inline-block size-2.5 rounded-full bg-ink/15" />
                  Clawback’s fee <span className="font-figure">{dollars(FEE_CENTS)}</span>
                </span>
              </p>
            </Reveal>
            {/* Set as the bottom of a statement: lines, then the total under a heavy rule. */}
            <dl className="rounded-[12px] border border-line bg-sheet px-6 py-2">
              <div className="flex flex-wrap items-baseline justify-between gap-x-6 border-b border-line py-4">
                <dt>Refund claimed</dt>
                <dd className="font-figure text-[1.75rem] text-money">{dollars(REFUND_CENTS)}</dd>
              </div>
              <div className="flex flex-wrap items-baseline justify-between gap-x-6 border-b border-line py-4">
                <dt>Projected savings, first year</dt>
                <dd className="font-figure text-[1.75rem] text-money">{dollars(YEARLY_CENTS)}</dd>
              </div>
              <div className="flex flex-wrap items-baseline justify-between gap-x-6 py-4">
                <dt>Clawback’s fee</dt>
                <dd className="font-figure text-[1.75rem]">
                  <span className="sr-only">minus </span>
                  {dollars(FEE_CENTS)}
                </dd>
              </div>
              <div className="flex flex-wrap items-baseline justify-between gap-x-6 border-t-2 border-ink py-5">
                <dt className="text-[1.25rem] font-semibold">You keep, once granted</dt>
                <dd className="font-figure text-[clamp(2.25rem,4vw,3rem)] leading-none text-money">{dollars(KEEP_CENTS)}</dd>
              </div>
            </dl>
          </div>
        </section>

        <section aria-labelledby="cta" className="canvas border-y border-line bg-sheet">
          <div className={`${WIDTH} flex flex-wrap items-center justify-between gap-8 py-20 lg:py-28`}>
            <h2 id="cta" className="max-w-[22ch] text-[clamp(2rem,3.4vw,3rem)] leading-[1.1] font-semibold tracking-[-0.02em]">
              You only pay from what comes back.
            </h2>
            <ButtonLink href="/signup" className="min-h-12 px-5">
              Start my audit
            </ButtonLink>
          </div>
        </section>
      </main>

      <footer className={`${WIDTH} grid gap-10 py-14 text-[15px] sm:grid-cols-2 lg:grid-cols-12`}>
        <div className="grid content-start gap-4 lg:col-span-6">
          <Wordmark className="text-[1.25rem]" />
          <p className="flex max-w-[60ch] items-start gap-3 rounded-[12px] border border-line px-4 py-3 text-faded">
            <span className="shrink-0 rounded-full bg-paper px-2 font-semibold text-ink">Demo data</span>
            Golden Gate Noodle Co. is a fictional demo customer. Every bill, provider and figure here is demo data.
          </p>
        </div>
        <nav aria-label="Product" className="lg:col-span-3">
          <p className="text-[15px] font-semibold">Product</p>
          <ul className="mt-4 grid gap-2">
            {SECTIONS.map((link) => (
              <li key={link.href}>
                <a href={link.href} className="hover:underline">
                  {link.label}
                </a>
              </li>
            ))}
          </ul>
        </nav>
        <nav aria-label="Your account" className="lg:col-span-3">
          <p className="text-[15px] font-semibold">Account</p>
          <ul className="mt-4 grid gap-2">
            <li>
              <Link href="/signup" className="hover:underline">
                Start my audit
              </Link>
            </li>
            <li>
              <Link href="/login" className="hover:underline">
                Log in
              </Link>
            </li>
          </ul>
        </nav>
      </footer>
    </div>
  );
}
