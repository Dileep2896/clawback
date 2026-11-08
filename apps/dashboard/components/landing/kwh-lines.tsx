import { FREMONT, SWAP_INDEX } from "./timeline.ts";

// Fremont electric, billed against metered kWh, as two lines that split at the meter change. The lines are SVG stretched to
// the box; every label is HTML at its real size. Inside a <Reveal>, the lines draw left to right and the gap label fades in.

const TOP = 5600;
const x = (i: number) => (i / (FREMONT.length - 1)) * 100;
const y = (kwh: number) => 100 - (kwh / TOP) * 100;
const line = (key: "billed" | "meter") => FREMONT.map((point, i) => `${i ? "L" : "M"}${x(i)},${y(point[key])}`).join("");
// The overcharge: the band between the two lines from the last right bill to the end.
const GAP =
  FREMONT.slice(SWAP_INDEX - 1).map((point, i) => `${i ? "L" : "M"}${x(SWAP_INDEX - 1 + i)},${y(point.billed)}`).join("") +
  FREMONT.slice(SWAP_INDEX - 1)
    .map((point, i) => `L${x(SWAP_INDEX - 1 + i)},${y(point.meter)}`)
    .reverse()
    .join("") +
  "Z";

const MONTH = new Intl.DateTimeFormat("en-US", { month: "short", year: "numeric", timeZone: "UTC" });
const label = (month: string) => MONTH.format(new Date(`${month}-01T00:00:00Z`));
const TICKS = [0, FREMONT.length - 1];

export function KwhLines({ compact = false }: { compact?: boolean }) {
  const chart = (
    <div className={`relative ${compact ? "h-24" : "h-56 border-b border-faded/40 sm:h-64"}`}>
      {!compact && (
        <>
          <div className="absolute inset-y-0 border-l border-dashed border-faded" style={{ left: `${x(SWAP_INDEX)}%` }} />
          <p className="absolute top-0 pl-2 text-[13px] text-faded" style={{ left: `${x(SWAP_INDEX)}%` }}>
            New meter, Sep 2025
          </p>
        </>
      )}
      <svg viewBox="0 0 100 100" preserveAspectRatio="none" className="reveal-draw absolute inset-0 size-full overflow-visible" aria-hidden="true">
        <path d={GAP} className="fill-warn/25" />
        <path d={line("meter")} fill="none" className="stroke-agent" strokeWidth="2" vectorEffect="non-scaling-stroke" strokeLinejoin="round" />
        <path d={line("billed")} fill="none" className="stroke-alert" strokeWidth={compact ? 2 : 2.5} vectorEffect="non-scaling-stroke" strokeLinejoin="round" />
      </svg>
      {!compact && (
        <>
          {/* Inside the shaded gap: the overcharge, named where it is. */}
          <p className="reveal-fade absolute right-3 text-right text-[13px] leading-tight font-semibold text-alert" style={{ top: `${(y(4742) + y(2371)) / 2 - 4}%` }}>
            Billed: twice the meter
          </p>
          <p className="reveal-fade absolute right-0 text-right text-[13px] leading-tight text-faded" style={{ top: `${y(2371) + 6}%` }}>
            What the meter read
          </p>
        </>
      )}
    </div>
  );

  if (compact) return chart;
  // The x axis gets its own row under the chart, so nothing below can run into it.
  return (
    <div>
      {chart}
      <div aria-hidden="true" className="relative mt-2 h-5 text-[13px] text-faded">
        {TICKS.map((i) => (
          <span key={i} className={`absolute whitespace-nowrap ${i === 0 ? "" : i === FREMONT.length - 1 ? "-translate-x-full" : "-translate-x-1/2"}`} style={{ left: `${x(i)}%` }}>
            {label(FREMONT[i]!.month)}
          </span>
        ))}
      </div>
    </div>
  );
}
