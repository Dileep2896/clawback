import { ButtonLink, StatTile, Wordmark } from "../components/ui/kit.tsx";

// The demo run's recorded figures (docs/plan/rehearsal-notes.md). Marketing copy, not live data: the app pages read the ledger.
const REFUND = "$12,606.06";
const YEARLY = "$18,319.32";
const FEE = "$9,277.61";

// Kinds of mistake the demo audit really finds, shown as they would sit on a statement.
const STATEMENT = [
  { line: "Electricity, Fremont", problem: "Billed for twice the meter's real usage" },
  { line: "Phone lines", problem: "Lines nobody has used in a year" },
  { line: "Electricity rate, Oakland", problem: "A cheaper rate applies to these sites" },
];

const STEPS = [
  { title: "Connect your bills", body: "Upload your bill PDFs, or sign in to your provider's portal and we fetch them. It takes about 30 seconds." },
  { title: "Agents audit and fix", body: "They check every line against your real usage and the published tariffs, then call the provider and file the claims." },
  { title: "Approve once, keep the money", body: "One approval covers every fix. You watch each refund and saving land in your account." },
];

export default function Landing() {
  return (
    <div className="min-h-dvh">
      <header className="mx-auto flex max-w-[1200px] items-center gap-3 px-4 py-4 sm:px-6">
        <span className="text-[1.5rem]">
          <Wordmark />
        </span>
        <nav aria-label="Account" className="ml-auto flex items-center gap-2">
          <ButtonLink href="/login" variant="ghost" data-testid="log-in">
            Log in
          </ButtonLink>
          <ButtonLink href="/signup" data-testid="get-started">
            Get started
          </ButtonLink>
        </nav>
      </header>

      <main>
        <section className="mx-auto grid max-w-[1200px] items-center gap-12 px-4 pt-10 pb-20 sm:px-6 lg:grid-cols-[1fr_minmax(0,34rem)] lg:pt-16">
          <div>
            <h1 className="max-w-[16ch] text-[clamp(2.5rem,6vw,4rem)] leading-[1.05] font-bold tracking-tight">Your bills are wrong. We get the money back.</h1>
            <p className="mt-6 max-w-[52ch] text-[1.25rem] text-faded">
              Clawback reads every utility and phone bill your business pays, finds the overcharges, calls the provider and files the claims. You approve once.
            </p>
            <div className="mt-8 flex flex-wrap gap-3">
              <ButtonLink href="/signup" className="min-h-13 px-6 text-[1.125rem]">
                Get started
              </ButtonLink>
              <ButtonLink href="/login" variant="secondary" className="min-h-13 px-6 text-[1.125rem]">
                Log in
              </ButtonLink>
            </div>
          </div>

          {/* The hero is a statement with the mistakes marked: the thing Clawback actually looks at. */}
          <figure className="rounded-card border border-line bg-sheet">
            <figcaption className="flex flex-wrap items-baseline justify-between gap-x-4 border-b border-line px-6 py-4">
              <span className="font-semibold">Golden Gate Noodle Co.</span>
              <span className="text-base text-faded">12 months audited</span>
            </figcaption>
            <ul>
              {STATEMENT.map((row) => (
                <li key={row.line} className="flex gap-3 border-b border-line px-6 py-4">
                  <span aria-hidden="true" className="mt-2 size-2.5 shrink-0 rounded-full bg-alert" />
                  <span>
                    <span className="block">{row.line}</span>
                    <span className="block text-base font-semibold text-alert">{row.problem}</span>
                  </span>
                </li>
              ))}
            </ul>
            <div className="grid gap-1 rounded-b-card bg-money-soft px-6 py-6">
              <span className="font-semibold">Refund claimed</span>
              <span className="font-figure text-[clamp(3rem,9vw,4.5rem)] leading-none text-money">{REFUND}</span>
              <span className="text-base text-faded">plus {YEARLY} saved every year from now on</span>
            </div>
          </figure>
        </section>

        <section aria-labelledby="how" className="border-y border-line bg-sheet">
          <div className="mx-auto max-w-[1200px] px-4 py-16 sm:px-6">
            <h2 id="how" className="text-[1.75rem] leading-tight font-semibold">
              How it works
            </h2>
            <ol className="mt-8 grid gap-8 md:grid-cols-3">
              {STEPS.map((step, index) => (
                <li key={step.title} className="grid content-start gap-2">
                  <span aria-hidden="true" className="font-figure text-[2.5rem] leading-none text-money">
                    {index + 1}
                  </span>
                  <h3 className="text-[1.25rem] font-semibold">{step.title}</h3>
                  <p className="max-w-[40ch] text-faded">{step.body}</p>
                </li>
              ))}
            </ol>
          </div>
        </section>

        <section aria-labelledby="proof" className="mx-auto max-w-[1200px] px-4 py-16 sm:px-6">
          <h2 id="proof" className="text-[1.75rem] leading-tight font-semibold">
            One noodle shop, one audit
          </h2>
          <p className="mt-2 max-w-[60ch] text-faded">A year of electricity and phone bills across their restaurants, and one approval from the owner.</p>
          <div className="mt-8 grid gap-4 md:grid-cols-3">
            <StatTile label="Refund claimed" value={REFUND} tone="money" />
            <StatTile label="Saved every year" value={YEARLY} tone="money" />
            <StatTile label="Clawback's fee" value={FEE} note="30% of the refund and the first year's savings. The owner keeps the rest." />
          </div>
        </section>
      </main>

      <footer className="mx-auto max-w-[1200px] px-4 pb-10 text-base text-faded sm:px-6">
        Golden Gate Noodle Co. is a fictional demo customer. Every bill, provider and figure here is demo data.
      </footer>
    </div>
  );
}
