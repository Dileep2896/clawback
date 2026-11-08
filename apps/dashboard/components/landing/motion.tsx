"use client";

import { useEffect, useRef, useState, useSyncExternalStore, type ReactNode } from "react";
import { dollars, rollAt } from "./timeline.ts";

const REDUCED_MOTION = "(prefers-reduced-motion: reduce)";
const onReducedMotionChange = (notify: () => void) => {
  const query = matchMedia(REDUCED_MOTION);
  query.addEventListener("change", notify);
  return () => query.removeEventListener("change", notify);
};

/** Live, so turning reduced motion on while the page is open stops what moves. False on the server. */
export const useReducedMotion = () => useSyncExternalStore(onReducedMotionChange, () => matchMedia(REDUCED_MOTION).matches, () => false);

/**
 * Plays a one-off reveal (a chart drawing, a counter rolling) the first time its element scrolls into view.
 * "done" is the finished state, which the server renders, so the page reads complete before any script runs and under
 * reduced motion. Only an element that starts below the fold is reset to "ready" (unseen) and then plays: nothing on
 * screen ever jumps back to empty.
 */
export function useReveal<T extends Element>() {
  const ref = useRef<T>(null);
  const [state, setState] = useState<"done" | "ready" | "play">("done");
  const reduced = useReducedMotion();

  useEffect(() => {
    const element = ref.current;
    if (reduced) {
      setState("done");
      return;
    }
    if (!element || element.getBoundingClientRect().top < innerHeight) return;
    setState("ready");
    const observer = new IntersectionObserver(
      ([entry]) => {
        if (!entry?.isIntersecting) return;
        setState("play");
        observer.disconnect();
      },
      { threshold: 0.4 },
    );
    observer.observe(element);
    return () => observer.disconnect();
  }, [reduced]);

  return [ref, reduced ? "done" : state] as const;
}

/** A money figure that rolls up from $0.00 once it scrolls into view. Its full width is held, so nothing moves around it. */
export function RollUp({ cents, ms = 600, className = "" }: { cents: number; ms?: number; className?: string }) {
  const [ref, state] = useReveal<HTMLSpanElement>();
  const [shown, setShown] = useState(cents);

  useEffect(() => {
    if (state === "done") return setShown(cents);
    if (state === "ready") return setShown(0);
    const start = performance.now();
    let frame = requestAnimationFrame(function tick(now) {
      setShown(rollAt(cents, now - start, ms));
      if (now - start < ms) frame = requestAnimationFrame(tick);
    });
    return () => cancelAnimationFrame(frame);
  }, [state, cents, ms]);

  return (
    <span ref={ref} className={`inline-grid ${className}`}>
      <span aria-hidden="true" className="invisible col-start-1 row-start-1">
        {dollars(cents)}
      </span>
      <span aria-hidden="true" className="col-start-1 row-start-1">
        {dollars(shown)}
      </span>
      <span className="sr-only">{dollars(cents)}</span>
    </span>
  );
}

/** Wraps content whose CSS reveal (`[data-reveal]` rules in globals.css) runs when it scrolls into view. */
export function Reveal({ className = "", children }: { className?: string; children: ReactNode }) {
  const [ref, state] = useReveal<HTMLDivElement>();
  return (
    <div ref={ref} data-reveal={state} className={className}>
      {children}
    </div>
  );
}
