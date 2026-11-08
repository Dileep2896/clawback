import { Reveal } from "./motion.tsx";
import { dollars, FEE_CENTS, KEEP_CENTS, REFUND_CENTS, YEARLY_CENTS } from "./timeline.ts";

// The recorded run's money as the bottom of a statement, and the keep/fee bar that fills when it scrolls into view.
// Shared by the landing's pricing teaser and /pricing.

export function KeepFeeBar() {
  const keepShare = (KEEP_CENTS / (KEEP_CENTS + FEE_CENTS)) * 100;
  return (
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
  );
}

/** Lines, then the total under a heavy rule. */
export function KeepFeeStatement() {
  return (
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
        <dt>Clawback’s fee, 30%</dt>
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
  );
}
