"use client";

import { useEffect, useRef, useState, useSyncExternalStore } from "react";
import { advance, CALL, COUNT_END, COUNT_START, FADE_AT, FINISHED, markAt, REFUND_CENTS, refundCentsAt, startAt, STEPS, typedAt, type Mark } from "./timeline.ts";

// What the playback shows besides the timeline, all from the recorded demo run (data/replay/run.jsonl).

// The meter finding's evidence: billed kWh against the meter's own readings.
const EVIDENCE = [
  { month: "Sep 2025", billed: "4,611", meter: "2,305" },
  { month: "Oct 2025", billed: "4,778", meter: "2,389" },
];

// Yearly savings by finding (annual_savings_cents on the findings rows), shown as the Auditor finds them; they sum to the
// approval's "Yearly savings: $18,319.32". The total lands when Finance records it.
const SAVINGS = [
  { label: "Meter fixed", amount: "$10,710.37" },
  { label: "2 rate changes", amount: "$2,568.95" },
  { label: "7 unused lines", amount: "$5,040.00" },
];
const SAVINGS_TOTAL = "$18,319.32";

const usd = new Intl.NumberFormat("en-US", { style: "currency", currency: "USD" });

const MARK_WORD: Record<Mark, string> = { idle: "", doing: "working", call: "on the call", done: "done", found: "found" };
const MARK_COLOUR: Record<Mark, string> = {
  idle: "text-band-faded",
  doing: "text-band-money",
  call: "text-band-money",
  done: "text-band-faded",
  found: "text-band-alert",
};

function Glyph({ mark }: { mark: Mark }) {
  const pulse = mark === "doing" || mark === "call" ? "live-pulse" : "";
  return (
    <svg width="20" height="20" viewBox="0 0 20 20" className={`${MARK_COLOUR[mark]} ${pulse}`}>
      {mark === "idle" && <circle cx="10" cy="10" r="4.5" fill="none" stroke="currentColor" strokeWidth="1.5" />}
      {mark === "doing" && <circle cx="10" cy="10" r="5" fill="currentColor" />}
      {mark === "done" && (
        <path d="M4.5 10.5l3.5 3.5 7.5-8" fill="none" stroke="currentColor" strokeWidth="2.2" strokeLinecap="round" strokeLinejoin="round" />
      )}
      {mark === "found" && (
        <>
          <circle cx="10" cy="10" r="8" fill="currentColor" />
          <path d="M10 5.5v5.5" stroke="var(--band)" strokeWidth="2.2" strokeLinecap="round" />
          <circle cx="10" cy="14.2" r="1.3" fill="var(--band)" />
        </>
      )}
      {/* A handset, drawn. */}
      {mark === "call" && (
        <path
          d="M6.2 3.2l2.2 3.1-1.5 1.6a9.3 9.3 0 004.9 4.9l1.6-1.5 3.1 2.2-1.2 2.6c-.3.6-1 .9-1.6.8C8.3 16.1 3.9 11.7 3.1 6.3c-.1-.6.2-1.3.8-1.6z"
          fill="currentColor"
        />
      )}
    </svg>
  );
}

/** Text that types out over [start, end] without moving anything: the full line holds the space, invisibly. */
function Typed({ text, t, start, end }: { text: string; t: number; start: number; end: number }) {
  const shown = typedAt(text, t, start, end);
  return (
    <span className="grid">
      <span className="invisible col-start-1 row-start-1">{text}</span>
      <span className="col-start-1 row-start-1">
        {text.slice(0, shown)}
        {shown > 0 && shown < text.length && <span className="live-caret">▍</span>}
      </span>
    </span>
  );
}

function Row({ step, t }: { step: (typeof STEPS)[number]; t: number }) {
  const mark = markAt(step, t);
  return (
    // The status column has a fixed width, so a row never re-wraps when its word changes ("" → "on the call" → "done").
    <div className={`grid grid-cols-[1.5rem_minmax(0,1fr)_5.5rem] items-center gap-x-2 sm:grid-cols-[1.5rem_minmax(0,1fr)_6.5rem] sm:gap-x-3 py-2.5 ${mark === "idle" ? "text-band-faded" : ""}`}>
      <Glyph mark={mark} />
      <span className="flex min-w-0 flex-wrap gap-x-4">
        <span className="w-[10ch] shrink-0 font-sans font-semibold">{step.agent}</span>
        <span className="min-w-0">{step.text}</span>
      </span>
      <span className={`text-right font-sans text-base ${MARK_COLOUR[mark]}`}>{MARK_WORD[mark]}</span>
    </div>
  );
}

const REDUCED_MOTION = "(prefers-reduced-motion: reduce)";
const onReducedMotionChange = (notify: () => void) => {
  const query = matchMedia(REDUCED_MOTION);
  query.addEventListener("change", notify);
  return () => query.removeEventListener("change", notify);
};

function useRunClock() {
  // Live, so turning reduced motion on mid-loop stops the clock and shows the finished run.
  const reduced = useSyncExternalStore(onReducedMotionChange, () => matchMedia(REDUCED_MOTION).matches, () => false);
  const [t, setT] = useState(0);
  const [canPlay, setCanPlay] = useState(false);
  const [paused, setPaused] = useState(false);
  const pausedRef = useRef(false);
  const ref = useRef<HTMLElement>(null);

  useEffect(() => {
    pausedRef.current = paused;
  }, [paused]);

  useEffect(() => {
    setT(startAt(reduced));
    setCanPlay(!reduced);
    if (reduced) return;
    let visible = true;
    let elapsed = 0;
    let last = performance.now();
    let frame = 0;
    const observer = new IntersectionObserver(([entry]) => {
      visible = entry?.isIntersecting ?? true;
    });
    if (ref.current) observer.observe(ref.current);
    const tick = (now: number) => {
      elapsed = advance(elapsed, now - last, visible && !pausedRef.current);
      last = now;
      setT(elapsed);
      frame = requestAnimationFrame(tick);
    };
    frame = requestAnimationFrame(tick);
    return () => {
      cancelAnimationFrame(frame);
      observer.disconnect();
    };
  }, [reduced]);

  return { t, ref, canPlay, paused, setPaused };
}

/** The hero: the demo run playing back, agent by agent, ending on the refund. */
export function LiveRun() {
  const { t, ref, canPlay, paused, setPaused } = useRunClock();
  const flagged = markAt(STEPS[1]!, t) === "found";
  const cents = refundCentsAt(t);

  return (
    // data-paused also freezes the CSS loops (dot pulse, caret, flash): globals.css.
    <figure
      ref={ref}
      aria-labelledby="live-caption"
      data-paused={paused || undefined}
      className="min-w-0 overflow-hidden rounded-card border border-band-line"
    >
      <p className="sr-only">
        A shortened playback of the recorded demo run. The Collector downloaded the bills and usage. The Auditor found the Fremont meter billed
        twice the metered usage. Linda Park approved by SMS. The Negotiator called BayTel: “Please cancel phone line (415) 555-0102 on account
        BT-7001.” “Yes, that is cancelled.” Finance recorded a refund claim of $12,606.06, due only when granted, and $18,319.32 a year in savings:
        $10,710.37 from the fixed meter, $2,568.95 from 2 rate changes and $5,040.00 from 7 unused lines.
      </p>
      <div aria-hidden="true">
        <div className="h-0.5 bg-band-line">
          <div className="h-full origin-left bg-band-money" style={{ transform: `scaleX(${Math.min(1, t / FINISHED)})` }} />
        </div>
        <div
          className="live-fade grid gap-x-12 gap-y-4 px-4 pt-3 pb-5 sm:px-6 lg:grid-cols-[minmax(0,1fr)_minmax(0,30rem)]"
          style={{ opacity: t > FADE_AT ? 0 : 1 }}
        >
          <div className="min-w-0 font-mono text-[1rem] sm:text-[1.125rem] lg:text-[1.25rem]">
            <Row step={STEPS[0]!} t={t} />
            <Row step={STEPS[1]!} t={t} />
            <dl
              className={`mb-1 ml-9 grid grid-cols-1 justify-start gap-x-6 text-base sm:grid-cols-[auto_auto_auto] sm:whitespace-nowrap ${flagged ? "" : "invisible"}`}
            >
              {EVIDENCE.map((row) => (
                <div key={row.month} className={`col-span-full grid grid-cols-subgrid ${flagged ? "live-flash" : ""}`}>
                  <dt className="text-band-faded">{row.month}</dt>
                  <dd className="text-band-alert tabular-nums">billed {row.billed} kWh</dd>
                  <dd className="text-band-faded tabular-nums">meter {row.meter}</dd>
                </div>
              ))}
            </dl>
            <Row step={STEPS[2]!} t={t} />
            <Row step={STEPS[3]!} t={t} />
            <div className="mb-1 ml-9 grid gap-1 border-l-2 border-band-line pl-4">
              {CALL.map((line) => (
                <p key={line.who} className={line.who === "BayTel" ? "text-band-faded" : ""}>
                  <Typed text={`“${line.text}”`} t={t} start={line.start} end={line.end} />
                </p>
              ))}
            </div>
            <Row step={STEPS[4]!} t={t} />
          </div>
          {/* The register: where the run's money lands. */}
          <div className="ml-9 grid content-between gap-8 lg:ml-0 lg:border-l lg:border-band-line lg:py-2 lg:pl-10">
            {/* The savings ledger fills as the Auditor finds each line; nothing shows before it is found. */}
            <div className="grid gap-1 text-base">
              <p className="mb-1 text-band-faded">Yearly savings found</p>
              <dl className="contents">
                {SAVINGS.map((line, i) => (
                  <div
                    key={line.label}
                    className={`flex justify-between gap-4 tabular-nums transition-opacity duration-300 motion-reduce:transition-none ${flagged ? "" : "opacity-0"}`}
                    style={{ transitionDelay: flagged ? `${i * 150}ms` : "0ms" }}
                  >
                    <dt>{line.label}</dt>
                    <dd>{line.amount}</dd>
                  </div>
                ))}
                <div
                  className={`mt-1 flex justify-between gap-4 border-t border-band-line pt-2 font-semibold tabular-nums ${t < STEPS[4]!.end ? "invisible" : ""}`}
                >
                  <dt>Recorded by Finance</dt>
                  <dd className="text-band-money">{SAVINGS_TOTAL}</dd>
                </div>
              </dl>
            </div>
            {/* The refund appears only once Finance starts counting it: no $0.00 while other agents work. */}
            <div className={`grid gap-2 ${t < COUNT_START ? "invisible" : ""}`}>
              <span className="text-base text-band-faded">Refund across 14 Fremont bills</span>
              <span className="grid font-figure text-[clamp(2.25rem,11vw,3rem)] sm:text-[clamp(3rem,4.4vw,5.25rem)] leading-none text-band-money">
                <span className="invisible col-start-1 row-start-1">{usd.format(REFUND_CENTS / 100)}</span>
                <span className="col-start-1 row-start-1">{usd.format(cents / 100)}</span>
              </span>
              <span className="text-base text-band-faded">{t < COUNT_END ? "Counting…" : "Claimed, due only when granted"}</span>
            </div>
          </div>
        </div>
      </div>
      <figcaption className="flex flex-wrap items-center gap-x-4 gap-y-1 border-t border-band-line px-4 py-2 text-base text-band-faded sm:px-6">
        <span id="live-caption" className="mr-auto flex flex-wrap gap-x-4">
          <span>Golden Gate Noodle Co., one audit.</span>
          <span>Recorded demo run, 4 min 28 s, shortened.</span>
        </span>
        {/* WCAG 2.2.2: anything that moves on its own for more than 5 s can be stopped. Holds its space before hydration. */}
        <button
          type="button"
          onClick={() => setPaused(!paused)}
          className={`min-h-10 rounded-control px-3 font-semibold text-band-text hover:bg-band-line ${canPlay ? "" : "invisible"}`}
        >
          {paused ? "Play" : "Pause"}
        </button>
      </figcaption>
    </figure>
  );
}
