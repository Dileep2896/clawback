"use client";

import { useEffect, useRef, useState } from "react";
import { KwhLines } from "./kwh-lines.tsx";
import { useReducedMotion } from "./motion.tsx";
import { activeAt, advance, dollars, FEE_CENTS, FEED, KEEP_CENTS, REFUND_CENTS, typedAt, YEARLY_CENTS } from "./timeline.ts";

// The hero: the app's Overview after the recorded demo run, framed like a window, with the agents' feed streaming in a
// panel on the right. It is complete on load; the replay only moves a cursor through the feed and streams that entry's line.

const SIDEBAR = ["Overview", "Bills", "Findings", "Money", "Agents"];

/** The replay clock: -1 (finished feed, no cursor) until it starts, then ms into the loop. Pauses off-screen and on request. */
function useReplay() {
  const reduced = useReducedMotion();
  const [t, setT] = useState(-1);
  const [paused, setPaused] = useState(false);
  const pausedRef = useRef(false);
  const ref = useRef<HTMLElement>(null);

  useEffect(() => {
    pausedRef.current = paused;
  }, [paused]);

  useEffect(() => {
    setT(-1);
    if (reduced) return;
    let visible = true;
    let elapsed = 0;
    let last = performance.now();
    let frame = 0;
    const observer = new IntersectionObserver(([entry]) => {
      visible = entry?.isIntersecting ?? true;
    });
    if (ref.current) observer.observe(ref.current);
    // A beat on the finished screen before the cursor starts.
    const start = setTimeout(() => {
      last = performance.now();
      frame = requestAnimationFrame(function tick(now) {
        elapsed = advance(elapsed, now - last, visible && !pausedRef.current);
        last = now;
        setT(elapsed);
        frame = requestAnimationFrame(tick);
      });
    }, 1200);
    return () => {
      clearTimeout(start);
      cancelAnimationFrame(frame);
      observer.disconnect();
    };
  }, [reduced]);

  return { t, ref, canPlay: !reduced, paused, setPaused };
}

function Tile({ label, cents, tone }: { label: string; cents: number; tone?: "money" }) {
  return (
    <div className="flex items-baseline justify-between gap-4 border-t border-line py-2.5 first:border-0">
      <dt className="text-faded">{label}</dt>
      <dd className={`font-figure text-[1.375rem] leading-none ${tone === "money" ? "text-money" : ""}`}>{dollars(cents)}</dd>
    </div>
  );
}

function Feed({ t }: { t: number }) {
  const active = activeAt(t);
  return (
    <ol className="grid">
      {FEED.map((entry, i) => {
        const on = i === active;
        const shown = typedAt(i, t);
        return (
          <li
            key={`${entry.at}-${entry.agent}`}
            className={`relative grid grid-cols-[2.5rem_minmax(0,1fr)] gap-x-3 rounded-control px-3 py-2.5 transition-colors duration-300 ${on ? "bg-paper" : ""}`}
          >
            <span className="pt-px text-[13px] text-faded tabular-nums">{entry.at}</span>
            <span className="min-w-0">
              <span className="flex items-center gap-2">
                <span
                  aria-hidden="true"
                  className={`size-2 shrink-0 rounded-full ${on ? "live-pulse bg-agent" : entry.found ? "bg-alert" : "bg-line"}`}
                />
                <span className="font-semibold">{entry.agent}</span>
              </span>
              <span className="block text-faded">{entry.text}</span>
              {entry.detail && (
                // The full line holds its space invisibly, so streaming it never moves the rows below.
                <span className="mt-1 grid text-[14px]">
                  <span className="invisible col-start-1 row-start-1">{entry.detail}</span>
                  <span className={`col-start-1 row-start-1 ${entry.found ? "text-alert" : ""}`}>
                    {entry.detail.slice(0, shown)}
                    {on && shown < entry.detail.length && <span className="live-caret">▍</span>}
                  </span>
                </span>
              )}
            </span>
          </li>
        );
      })}
    </ol>
  );
}

/** The framed app screen at the top of the landing. */
export function LiveRun() {
  const { t, ref, canPlay, paused, setPaused } = useReplay();

  return (
    <figure ref={ref} data-paused={paused || undefined} className="overflow-hidden rounded-[12px] border border-line bg-sheet text-[15px] text-ink">
      <figcaption className="sr-only">
        The Clawback Overview for the demo customer after one audit: a refund of {dollars(REFUND_CENTS)} claimed, {dollars(YEARLY_CENTS)} a year in
        savings, a fee of {dollars(FEE_CENTS)} and {dollars(KEEP_CENTS)} for the owner to keep. Beside it, the agents’ log from the recorded run:
        {FEED.map((entry) => ` ${entry.at}, ${entry.agent}: ${entry.text}.${entry.detail ? ` ${entry.detail}` : ""}`).join("")}
      </figcaption>

      {/* The app's top bar: a breadcrumb, and Pause for the replay (WCAG 2.2.2). */}
      <div className="flex min-h-11 items-center gap-3 border-b border-line px-4">
        <span aria-hidden="true" className="truncate text-[13px] text-faded">
          Golden Gate Noodle Co. <span className="px-1">/</span> <span className="text-ink">Overview</span>
        </span>
        <span aria-hidden="true" className="ml-auto hidden rounded-full border border-line px-2.5 text-[13px] text-faded sm:inline">
          Demo data
        </span>
        <button
          type="button"
          onClick={() => setPaused(!paused)}
          aria-label={paused ? "Play the agents’ replay" : "Pause the agents’ replay"}
          className={`min-h-9 rounded-control px-2.5 text-[13px] font-semibold text-faded hover:bg-paper hover:text-ink ${canPlay ? "" : "invisible"}`}
        >
          {paused ? "Play" : "Pause"}
        </button>
      </div>

      <div aria-hidden="true" className="grid lg:grid-cols-[11rem_minmax(0,1fr)_23rem] xl:grid-cols-[12.5rem_minmax(0,1fr)_25rem]">
        <nav className="hidden border-r border-line bg-paper/60 p-3 lg:block">
          <ul className="grid gap-0.5">
            {SIDEBAR.map((item) => (
              <li key={item} className={`rounded-[6px] px-3 py-1.5 ${item === "Overview" ? "bg-sheet font-semibold shadow-[0_0_0_1px_var(--line)]" : "text-faded"}`}>
                {item}
              </li>
            ))}
          </ul>
        </nav>

        <div className="grid min-w-0 content-start gap-4 p-4 sm:p-6">
          {/* auto-fit: the tiles stack whenever two 17.5rem columns do not fit (e.g. 1024px, beside the sidebar and agents). */}
          <div className="grid grid-cols-[repeat(auto-fit,minmax(min(100%,17.5rem),1fr))] gap-4">
            <div className="rounded-[10px] border border-line p-4">
              <p className="text-faded">Refund claimed</p>
              <p className="mt-2 font-figure text-[2.5rem] leading-none text-money">{dollars(REFUND_CENTS)}</p>
              <p className="mt-2 text-[14px] text-faded">Across 14 Fremont bills, due only when granted</p>
            </div>
            <dl className="rounded-[10px] border border-line px-4 py-1.5">
              <Tile label="Yearly savings" cents={YEARLY_CENTS} tone="money" />
              <Tile label="Clawback’s fee" cents={FEE_CENTS} />
              <Tile label="You keep" cents={KEEP_CENTS} tone="money" />
            </dl>
          </div>

          <div className="rounded-[10px] border border-line p-4">
            <div className="flex flex-wrap items-baseline justify-between gap-x-4">
              <p className="font-semibold">Billed 2x metered usage since the 2025-09 meter change</p>
              <p className="font-figure text-[1.25rem] text-money">{dollars(REFUND_CENTS)}</p>
            </div>
            <p className="text-[14px] text-faded">Fremont electric · BayCurrent · Electric Rule 17.1</p>
            <div className="mt-3">
              <KwhLines compact />
            </div>
          </div>

          {/* The one loud card: the approval, with the approval colour's rule. */}
          <div className="rounded-[10px] border border-line border-l-4 border-l-warn p-4">
            <div className="flex flex-wrap items-center justify-between gap-2">
              <p className="font-semibold">Approval</p>
              <p className="rounded-full border border-line px-2.5 text-[13px] font-semibold">Approved by Linda Park, by SMS</p>
            </div>
            <ul className="mt-2 grid gap-0.5 text-[14px] text-faded">
              <li>We will file 1 Rule 17.1 refund claim.</li>
              <li>We will file 2 Rule 12 rate change requests.</li>
              <li>On the BayTel call we will cancel 7 unused lines.</li>
            </ul>
          </div>
        </div>

        <div className="min-w-0 border-t border-line p-3 lg:border-t-0 lg:border-l">
          <p className="flex items-center justify-between px-3 pt-1 pb-2">
            <span className="font-semibold">Agents</span>
            <span className="text-[13px] text-faded">Recorded run, 4 min 28 s</span>
          </p>
          <Feed t={t} />
        </div>
      </div>
    </figure>
  );
}
