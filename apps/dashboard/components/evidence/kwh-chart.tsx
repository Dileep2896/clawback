import { type MeterDetail, monthLabel, monthName, quantity } from "../../lib/evidence.ts";

// Leaves headroom over the tallest bar for the swap label.
const TALLEST_BAR_PCT = 85;
const MAX_MONTH_LABELS = 18;
// The stripes tell the series apart without colour.
const BILLED_FILL = "bg-alert bg-[repeating-linear-gradient(45deg,transparent_0_3px,rgb(255_255_255/0.5)_3px_6px)]";

function Swatch({ className, label }: { className: string; label: string }) {
  return (
    <span className="flex items-center gap-2">
      <span aria-hidden="true" className={`inline-block size-5 rounded-control ${className}`} />
      {label}
    </span>
  );
}

/** Paired bars in HTML rather than SVG, so every label is real text at its real size. The table below it is the text view. */
export function KwhChart({ detail }: { detail: MeterDetail }) {
  const { bills, swapMonth, oldMeter, newMeter } = detail;
  const tallest = Math.max(...bills.flatMap((b) => [b.billedKwh, b.intervalKwh]));
  const height = (kwh: number) => `${(kwh / tallest) * TALLEST_BAR_PCT}%`;
  const swapIndex = bills.findIndex((b) => b.periodStart.startsWith(swapMonth));
  const swap = bills[swapIndex];
  const before = bills[swapIndex - 1];
  const labelEvery = Math.ceil(bills.length / MAX_MONTH_LABELS);

  const summary = [before, swap]
    .filter((b) => b !== undefined)
    .map((b) => `${monthLabel(b.periodStart)}: billed ${quantity(b.billedKwh)} kWh, real ${quantity(b.intervalKwh)} kWh.`)
    .join(" ");

  return (
    <figure>
      <div className="mb-2 flex flex-wrap gap-x-6">
        <Swatch className={BILLED_FILL} label="Billed kWh" />
        <Swatch className="bg-agent" label="Real kWh" />
      </div>
      <figcaption className="mb-2">{summary}</figcaption>
      <div role="img" aria-label={`Billed and real kWh by month. ${summary} The table below has every month.`}>
        <div data-testid="kwh-plot" className="flex h-64 border-b-2 border-faded">
          {bills.map((bill, i) => (
            <div key={bill.billId} data-chart-month={bill.periodStart.slice(0, 7)} className="relative flex min-w-0 flex-1 items-end justify-center gap-0.5 px-0.5">
              {i === swapIndex && (
                <div data-testid="swap-marker" className="absolute inset-y-0 left-0 border-l-4 border-dashed border-ink">
                  <span className="absolute top-0 left-2 font-semibold whitespace-nowrap">
                    Meter swap: {oldMeter} to {newMeter}
                  </span>
                </div>
              )}
              <div data-series="billed" className={`min-w-0 flex-1 rounded-t ${BILLED_FILL}`} style={{ height: height(bill.billedKwh) }} />
              <div data-series="real" className="min-w-0 flex-1 rounded-t bg-agent" style={{ height: height(bill.intervalKwh) }} />
            </div>
          ))}
        </div>
        <div aria-hidden="true" className="mt-1 flex text-center leading-tight">
          {bills.map((bill, i) => (
            <div key={bill.billId} className="min-w-0 flex-1">
              {i % labelEvery === 0 && (
                <>
                  <div>{monthName(bill.periodStart)}</div>
                  {(i === 0 || bill.periodStart.slice(5, 7) === "01") && <div>{bill.periodStart.slice(0, 4)}</div>}
                </>
              )}
            </div>
          ))}
        </div>
      </div>
    </figure>
  );
}
