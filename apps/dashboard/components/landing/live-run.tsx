"use client";

import { useEffect, useRef, useState } from "react";

// A shortened playback of the recorded demo run (data/replay/run.jsonl, 4 min 28 s). Every word and number below is
// from that run; the landing-live lane notes list the row each comes from. Times are ms into an 18 s loop, in the run's own order.
const LOOP = 18_000;
const FADE_AT = 17_300;
const FINISHED = 15_000; // the frame shown under prefers-reduced-motion: every step done

type Mark = "idle" | "doing" | "done" | "found" | "call";

type Step = { agent: string; text: string; start: number; end: number; endMark: Mark; doingMark?: Mark };

const STEPS: Step[] = [
  { agent: "Collector", text: "downloading bills and usage", start: 0, end: 2_400, endMark: "done" },
  { agent: "Auditor", text: "Fremont meter billed 2x", start: 2_600, end: 4_400, endMark: "found" },
  { agent: "Approver", text: "Linda Park approved by SMS", start: 5_600, end: 6_800, endMark: "done" },
  { agent: "Negotiator", text: "calling BayTel", start: 7_000, end: 11_600, endMark: "done", doingMark: "call" },
  { agent: "Finance", text: "refund claimed", start: 11_800, end: 14_400, endMark: "done" },
];

// The meter finding's evidence: billed kWh against the meter's own readings.
const EVIDENCE = [
  { month: "Sep 2025", billed: "4,611", meter: "2,305" },
  { month: "Oct 2025", billed: "4,778", meter: "2,389" },
];

// The BayTel call transcript, lines 9 and 10, typed out as they happen.
const CALL = [
  { who: "Clawback", text: "Please cancel phone line (415) 555-0102 on account BT-7001.", start: 7_500, end: 9_700 },
  { who: "BayTel", text: "Yes, that is cancelled.", start: 10_100, end: 10_900 },
];

const REFUND_CENTS = 1_260_606;
const COUNT_START = 12_000;
const COUNT_END = 14_200;
const usd = new Intl.NumberFormat("en-US", { style: "currency", currency: "USD" });

const progress = (t: number, start: number, end: number) => Math.min(1, Math.max(0, (t - start) / (end - start)));

function markAt(step: Step, t: number): Mark {
  if (t < step.start) return "idle";
  if (t < step.end) return step.doingMark ?? "doing";
  return step.endMark;
}

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
  const shown = Math.round(text.length * progress(t, start, end));
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

function Row({ step, t }: { step: Step; t: number }) {
  const mark = markAt(step, t);
  return (
    <div className={`grid grid-cols-[1.5rem_minmax(0,1fr)_auto] items-center gap-x-3 py-2.5 ${mark === "idle" ? "text-band-faded" : ""}`}>
      <Glyph mark={mark} />
      <span className="flex min-w-0 flex-wrap gap-x-4">
        <span className="w-[10ch] shrink-0 font-sans font-semibold">{step.agent}</span>
        <span className="min-w-0">{step.text}</span>
      </span>
      <span className={`font-sans text-base ${MARK_COLOUR[mark]}`}>{MARK_WORD[mark]}</span>
    </div>
  );
}

function useRunClock() {
  const [t, setT] = useState(0);
  const [canPlay, setCanPlay] = useState(false);
  const [paused, setPaused] = useState(false);
  const pausedRef = useRef(false);
  const ref = useRef<HTMLElement>(null);

  useEffect(() => {
    pausedRef.current = paused;
  }, [paused]);

  useEffect(() => {
    if (matchMedia("(prefers-reduced-motion: reduce)").matches) {
      setT(FINISHED);
      return;
    }
    setCanPlay(true);
    let visible = true;
    let elapsed = 0;
    let last = performance.now();
    let frame = 0;
    const observer = new IntersectionObserver(([entry]) => {
      visible = entry?.isIntersecting ?? true;
    });
    if (ref.current) observer.observe(ref.current);
    const tick = (now: number) => {
      // Off-screen the clock stops; the clamp keeps a returning tab from jumping ahead.
      if (visible && !pausedRef.current) elapsed = (elapsed + Math.min(now - last, 100)) % LOOP;
      last = now;
      setT(elapsed);
      frame = requestAnimationFrame(tick);
    };
    frame = requestAnimationFrame(tick);
    return () => {
      cancelAnimationFrame(frame);
      observer.disconnect();
    };
  }, []);

  return { t, ref, canPlay, paused, setPaused };
}

/** The hero: the demo run playing back, agent by agent, ending on the refund. */
export function LiveRun() {
  const { t, ref, canPlay, paused, setPaused } = useRunClock();
  const flagged = markAt(STEPS[1]!, t) === "found";
  const cents = Math.round(REFUND_CENTS * (1 - (1 - progress(t, COUNT_START, COUNT_END)) ** 3));

  return (
    <figure ref={ref} aria-labelledby="live-caption" className="min-w-0 overflow-hidden rounded-card border border-band-line">
      <p className="sr-only">
        A shortened playback of the recorded demo run. The Collector downloaded the bills and usage. The Auditor found the Fremont meter billed
        twice the metered usage. Linda Park approved by SMS. The Negotiator called BayTel: “Please cancel phone line (415) 555-0102 on account
        BT-7001.” “Yes, that is cancelled.” Finance recorded a refund claim of $12,606.06, due only when granted.
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
              className={`mb-1 ml-9 grid grid-cols-[auto_auto] justify-start gap-x-6 text-base whitespace-nowrap sm:grid-cols-[auto_auto_auto] ${flagged ? "" : "invisible"}`}
            >
              {EVIDENCE.map((row) => (
                <div key={row.month} className={`col-span-full grid grid-cols-subgrid ${flagged ? "live-flash" : ""}`}>
                  <dt className="col-span-2 text-band-faded sm:col-span-1">{row.month}</dt>
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
          <div className="ml-9 grid content-end gap-2 lg:ml-0 lg:border-l lg:border-band-line lg:pb-2 lg:pl-10">
            <span className="text-base text-band-faded">Refund across 14 Fremont bills</span>
            <span
              className={`grid font-figure text-[clamp(3rem,4.4vw,5.25rem)] leading-none ${t < COUNT_START ? "text-band-faded" : "text-band-money"}`}
            >
              <span className="invisible col-start-1 row-start-1">{usd.format(REFUND_CENTS / 100)}</span>
              <span className="col-start-1 row-start-1">{usd.format(cents / 100)}</span>
            </span>
            <span className={`text-base text-band-faded ${t < COUNT_END ? "invisible" : ""}`}>Claimed, due only when granted</span>
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
