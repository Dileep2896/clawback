/* Hallmark · genre: modern-minimal (fintech) · macrostructure: intro → to-scale nested squares beside the funnel → spend lines with sources → next
 * design-system: docs/plan/design.md */
import type { Metadata } from "next";
import { LABEL, MoreLink, PageIntro, SiteFrame, Statement, WIDTH } from "../../components/landing/chrome.tsx";
import { FUNNEL, SPEND, SPEND_TOTAL } from "../../components/landing/market.ts";
import { Reveal } from "../../components/landing/motion.tsx";

export const metadata: Metadata = { title: "The market" };

// The nested squares are drawn to scale by area: side = √(share of $500B). 3% of $500B is a square 17% as wide.
const side = (billions: number) => Math.sqrt(billions / 500) * 100;
const SQUARES = [
  { billions: 16, className: "fill-warn/30 stroke-warn", delay: 0 },
  { billions: 5, className: "fill-none stroke-warn [stroke-dasharray:1.5_1.5]", delay: 150 },
  { billions: 4.8, className: "fill-money stroke-money", delay: 350 },
];

function EstimateTag() {
  return <span className="w-fit rounded-full border border-line px-2 py-0.5 text-[13px] text-faded">Estimate</span>;
}

function NestedSquares() {
  return (
    <Reveal className="grid gap-4">
      <div className="relative aspect-square w-full max-w-[560px]">
        <svg viewBox="0 0 100 100" className="absolute inset-0 size-full overflow-visible" aria-hidden="true">
          <rect x="0.5" y="0.5" width="99" height="99" rx="1.5" className="fill-sheet stroke-line" strokeWidth="0.5" />
          {SQUARES.map((square) => {
            const s = side(square.billions);
            return (
              <rect
                key={square.billions}
                x="0.5"
                y={99.5 - s}
                width={s}
                height={s}
                className={`reveal-scale ${square.className}`}
                strokeWidth="0.4"
                style={{ animationDelay: `${square.delay}ms` }}
              />
            );
          })}
        </svg>
        <p className="absolute top-5 left-5 grid gap-1">
          <span className="font-figure text-[clamp(2rem,4vw,3rem)] leading-none">$500B+</span>
          <span className="text-[15px] text-faded">spent a year</span>
        </p>
        {/* Labels for the small squares sit to their right: one level with the top of the big one, one at the bottom. */}
        {/* Under sm the squares are too small to label beside, so the legend below takes over. */}
        <p className="reveal-fade absolute grid gap-0.5 text-[15px] max-sm:hidden" style={{ left: `${side(16) + 3}%`, bottom: `${side(16) - 7}%` }}>
          <span className="font-figure text-[1.375rem] leading-none text-warn">$5 to 16B</span>
          <span className="text-faded">billed wrong</span>
        </p>
        <p className="reveal-fade absolute grid gap-0.5 text-[15px] max-sm:hidden" style={{ left: `${side(16) + 3}%`, bottom: "1%" }}>
          <span className="font-figure text-[1.375rem] leading-none text-money">$1.5 to 4.8B</span>
          <span className="text-faded">our 30%, at most</span>
        </p>
      </div>
      <ul className="grid gap-2 text-[15px] sm:hidden">
        <li className="flex items-center gap-2">
          <span aria-hidden="true" className="size-3 border border-warn bg-warn/30" />
          <span className="font-figure text-warn">$5 to 16B</span> <span className="text-faded">billed wrong</span>
        </li>
        <li className="flex items-center gap-2">
          <span aria-hidden="true" className="size-3 bg-money" />
          <span className="font-figure text-money">$1.5 to 4.8B</span> <span className="text-faded">our 30%, at most</span>
        </li>
      </ul>
      <p className="text-[15px] text-faded">Drawn to scale by area. The dashed square is the low end, 1%.</p>
    </Reveal>
  );
}

export default function MarketPage() {
  return (
    <SiteFrame current="/market">
      <PageIntro caption="The market" lead="Half a trillion dollars of bills." rest="Small businesses check almost none of them.">
        <p>
          Large companies can hire auditors to comb their utility and phone bills. A noodle shop with three sites has nobody to do it, so its
          overcharges stay put. Below are our estimates of how much money that is, and how each one is worked out.
        </p>
      </PageIntro>

      <section aria-labelledby="funnel-title" className={`${WIDTH} grid gap-12 pb-24 lg:grid-cols-12 lg:gap-x-10 lg:pb-36`}>
        <h2 id="funnel-title" className="sr-only">
          From spend to revenue
        </h2>
        <div className="lg:col-span-6">
          <NestedSquares />
        </div>
        <ol className="grid content-start lg:col-span-6">
          {FUNNEL.map((step, i) => (
            <li key={step.value} className="grid gap-3 border-t border-line py-8 first:border-t-0 first:pt-0 lg:first:pt-2">
              <p className={`${LABEL} text-faded`}>Step {i + 1}</p>
              <p className={`font-figure text-[clamp(2.5rem,5vw,3.5rem)] leading-none ${i === 2 ? "text-money" : i === 1 ? "text-warn" : ""}`}>{step.value}</p>
              <p className="text-[1.25rem] font-semibold">{step.label}</p>
              <p className="max-w-[56ch] text-faded">{step.how}</p>
              {step.sources.length > 0 && (
                <p className="flex flex-wrap gap-x-4 gap-y-1 text-[15px]">
                  {step.sources.map((source) => (
                    <a key={source.href} href={source.href} className="text-agent underline underline-offset-2">
                      {source.label}
                    </a>
                  ))}
                </p>
              )}
              <EstimateTag />
            </li>
          ))}
        </ol>
      </section>

      <section aria-labelledby="spend-title" className="border-y border-line bg-sheet">
        <div className={`${WIDTH} py-24 lg:py-36`}>
          <Statement id="spend-title" lead="Where $500B+ comes from.">
            Three lines of business spend we could source. Water is left out, so the total errs low.
          </Statement>
          <div className="mt-12 overflow-hidden rounded-[12px] border border-line">
            <table className="w-full text-left">
              <thead className="text-[15px] text-faded">
                <tr className="border-b border-line">
                  <th className="px-5 py-3 font-normal">Bill</th>
                  <th className="px-5 py-3 text-right font-normal">A year</th>
                  <th className="hidden px-5 py-3 font-normal md:table-cell">How it is worked out</th>
                </tr>
              </thead>
              <tbody>
                {SPEND.map((line) => (
                  <tr key={line.label} className="border-b border-line align-top">
                    <td className="px-5 py-4">
                      <p className="font-semibold">{line.label}</p>
                      {/* Under md the method moves under the label, so the table never scrolls sideways. */}
                      <div className="mt-2 grid gap-1 text-[15px] text-faded md:hidden">
                        <p>{line.how}</p>
                        {line.sources.map((source) => (
                          <a key={source.href} href={source.href} className="text-agent underline underline-offset-2">
                            {source.label}
                          </a>
                        ))}
                      </div>
                    </td>
                    <td className="px-5 py-4 text-right font-figure text-[1.5rem] whitespace-nowrap tabular-nums">${line.billions}B</td>
                    <td className="hidden px-5 py-4 md:table-cell">
                      <p className="max-w-[60ch] text-faded">{line.how}</p>
                      <p className="mt-2 flex flex-wrap gap-x-4 text-[15px]">
                        {line.sources.map((source) => (
                          <a key={source.href} href={source.href} className="text-agent underline underline-offset-2">
                            {source.label}
                          </a>
                        ))}
                      </p>
                    </td>
                  </tr>
                ))}
                <tr className="border-t-2 border-ink">
                  <td className="px-5 py-4 font-semibold">Counted</td>
                  <td className="px-5 py-4 text-right font-figure text-[1.5rem] tabular-nums">${SPEND_TOTAL}B</td>
                  <td className="hidden px-5 py-4 text-faded md:table-cell">We round down to $500B+.</td>
                </tr>
              </tbody>
            </table>
          </div>
          <p className="mt-8 max-w-[72ch] text-faded">
            Every figure on this page is an estimate. The sources cover different years, and how much is billed wrong varies by industry and by how long
            nobody has checked.
          </p>
        </div>
      </section>

      <section aria-labelledby="next-title" className={`${WIDTH} grid gap-6 py-24 lg:py-36`}>
        <Statement id="next-title" lead="Who checks these bills today.">
          Auditors, expense software and consumer bill negotiators each cover part of it. Here is what each one does.
        </Statement>
        <MoreLink href="/compare">How Clawback compares</MoreLink>
      </section>
    </SiteFrame>
  );
}
