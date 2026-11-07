/* Hallmark · genre: modern-minimal · macrostructure: Narrative Workflow · design-system: docs/plan/design.md · nav: N1a · footer: Ft5 Statement
 * pre-emit critique: P4 H5 E4 S5 R4 V4 */
import { Statement } from "../components/landing/statement.tsx";
import { Trail } from "../components/landing/trail.tsx";
import { ButtonLink, Wordmark } from "../components/ui/kit.tsx";

// The demo run's recorded figures (docs/plan/rehearsal-notes.md). Marketing copy, not live data: the app pages read the ledger.
const REFUND = "$12,606.06";
const YEARLY = "$18,319.32";
const FEE = "$9,277.61";
const KEEP = "$21,647.77";

// Market size estimates, wording fixed by the human (docs/plan/phases/13-product-ui.md, landing-tam).
const MARKET = [
  { value: "$500B+", label: "US businesses pay every year in electricity, gas, water and phone bills" },
  { value: "$5 to 16B", label: "a year left on the table: 1 to 3% of it is billed wrong or on the wrong plan" },
];

// Buttons on the dark band take the band's colours; `!` beats the kit's own colour classes.
const BAND_PRIMARY = "bg-band-money! text-band! hover:brightness-110";
const BAND_SECONDARY = "border-band-faded! bg-transparent! text-band-text! hover:bg-band-line!";

export default function Landing() {
  return (
    <div className="min-h-dvh overflow-x-clip">
      <div className="band bg-band text-band-text">
        <header className="mx-auto flex max-w-[1320px] items-center gap-3 px-4 py-4 sm:px-6">
          <span className="text-[1.5rem] [&_svg]:text-band-money">
            <Wordmark />
          </span>
          <nav aria-label="Account" className="ml-auto flex items-center gap-2">
            <ButtonLink href="/login" variant="ghost" className="text-band-text! hover:bg-band-line!" data-testid="log-in">
              Log in
            </ButtonLink>
            <ButtonLink href="/signup" className={BAND_PRIMARY} data-testid="get-started">
              Get started
            </ButtonLink>
          </nav>
        </header>

        <section className="mx-auto grid max-w-[1320px] items-center gap-12 px-4 pt-8 pb-16 sm:px-6 lg:grid-cols-[minmax(0,1fr)_minmax(0,36rem)] lg:gap-16 lg:pt-12 lg:pb-24">
          <div className="min-w-0">
            <h1 className="max-w-[13ch] text-[clamp(2.75rem,5.6vw,5.75rem)] leading-[1.02] font-bold tracking-[-0.025em] [overflow-wrap:anywhere]">
              Your bills are wrong. We get the money back.
            </h1>
            <p className="mt-6 max-w-[48ch] text-[1.25rem] text-band-faded">
              Clawback reads every utility and phone bill your business pays, finds the overcharges, calls the provider and files the claims. You approve once.
            </p>
            <div className="mt-8 flex flex-wrap gap-3">
              <ButtonLink href="/signup" className={`min-h-13 px-6 text-[1.125rem] ${BAND_PRIMARY}`}>
                Get started
              </ButtonLink>
              <ButtonLink href="/login" variant="secondary" className={`min-h-13 px-6 text-[1.125rem] ${BAND_SECONDARY}`}>
                Log in
              </ButtonLink>
            </div>
          </div>
          <Statement refund={REFUND} yearly={YEARLY} />
        </section>
      </div>

      <main>
        <section aria-labelledby="run" className="mx-auto max-w-[1320px] px-4 py-20 sm:px-6 lg:py-28">
          <h2 id="run" className="max-w-[22ch] text-[clamp(2rem,3.2vw,2.75rem)] leading-[1.1] font-bold tracking-[-0.015em]">
            One audit of one noodle shop, start to finish
          </h2>
          <p className="mt-4 max-w-[60ch] text-[1.25rem] text-faded">
            You connect your bills in about 30 seconds: upload the PDFs, or sign in to your provider’s portal and the agents fetch them. Here is what one run
            found in a year of a noodle shop’s electricity and phone bills, shown on the screens it produced.
          </p>
          <Trail />
        </section>

        <section aria-labelledby="market" className="band bg-band text-band-text">
          <div className="mx-auto max-w-[1320px] px-4 py-20 sm:px-6 lg:py-24">
            <h2 id="market" className="text-[clamp(2rem,3.2vw,2.75rem)] leading-[1.1] font-bold tracking-[-0.015em]">
              The market
            </h2>
            <dl className="mt-10 grid gap-10 md:grid-cols-2">
              {MARKET.map((figure) => (
                <div key={figure.value} className="grid min-w-0 content-start gap-3 border-t border-band-line pt-6">
                  <dt className="max-w-[36ch] text-[1.25rem] text-band-faded">{figure.label}</dt>
                  <dd className="order-first font-figure text-[clamp(3.5rem,8vw,7rem)] leading-none text-band-money">{figure.value}</dd>
                </div>
              ))}
            </dl>
            <p className="mt-12 max-w-[34ch] text-[clamp(1.5rem,2.4vw,2rem)] leading-snug font-semibold">
              Today only large companies pay auditors to get it back. Clawback’s agents do it for every business.
            </p>
            <p className="mt-6 max-w-[72ch] text-base text-band-faded">
              Estimates. Electricity: US EIA, 2025 retail sales ($290B commercial and industrial). Telecom: Grand View Research, 2022 ($187B). Error rates:
              bill-audit industry reports (3 to 5% recovered); we assume 1 to 3%.
            </p>
          </div>
        </section>

        <section aria-labelledby="result" className="mx-auto grid max-w-[1320px] gap-12 px-4 py-20 sm:px-6 lg:grid-cols-[minmax(0,1fr)_minmax(0,36rem)] lg:gap-16 lg:py-28">
          <div className="min-w-0">
            <h2 id="result" className="max-w-[16ch] text-[clamp(2rem,3.2vw,2.75rem)] leading-[1.1] font-bold tracking-[-0.015em]">
              What the owner stands to keep
            </h2>
            <p className="mt-4 max-w-[44ch] text-[1.25rem] text-faded">
              The refund is claimed, not yet granted, and the savings are projected for the first year. Clawback is paid only from what is actually recovered: 30% of the refund and the first year’s savings.
            </p>
            <ButtonLink href="/signup" className="mt-8 min-h-13 px-6 text-[1.125rem]">
              Start with your bills
            </ButtonLink>
          </div>
          {/* Set as the bottom of a statement: lines, then the total under a heavy rule. */}
          <dl className="min-w-0 rounded-card border border-line bg-sheet px-6 py-2">
            <div className="flex flex-wrap items-baseline justify-between gap-x-6 border-b border-line py-4">
              <dt>Refund claimed</dt>
              <dd className="font-figure text-[2rem] text-money">{REFUND}</dd>
            </div>
            <div className="flex flex-wrap items-baseline justify-between gap-x-6 border-b border-line py-4">
              <dt>Projected savings, first year</dt>
              <dd className="font-figure text-[2rem] text-money">{YEARLY}</dd>
            </div>
            <div className="flex flex-wrap items-baseline justify-between gap-x-6 py-4">
              <dt>Clawback’s fee</dt>
              <dd className="font-figure text-[2rem]">
                <span className="sr-only">minus </span>
                {FEE}
              </dd>
            </div>
            <div className="flex flex-wrap items-baseline justify-between gap-x-6 border-t-4 border-ink py-5">
              <dt className="text-[1.375rem] font-semibold">You keep, once granted</dt>
              <dd className="font-figure text-[clamp(2.75rem,5vw,3.75rem)] leading-none text-money">{KEEP}</dd>
            </div>
          </dl>
        </section>
      </main>

      <footer className="border-t border-line">
        <div className="mx-auto flex max-w-[1320px] flex-wrap items-baseline justify-between gap-x-8 gap-y-3 px-4 py-8 text-base text-faded sm:px-6">
          <Wordmark className="text-[1.25rem] text-ink" />
          <p className="max-w-[70ch]">Golden Gate Noodle Co. is a fictional demo customer. Every bill, provider and figure here is demo data.</p>
        </div>
      </footer>
    </div>
  );
}
