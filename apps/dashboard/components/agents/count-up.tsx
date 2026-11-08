"use client";

import { useEffect, useRef, useState } from "react";
import { money } from "../../lib/evidence.ts";
import { useReducedMotion } from "../landing/motion.tsx";

const MS = 600;
const easeOut = (t: number) => 1 - (1 - t) ** 3;

/** A money figure that counts from its last value to its new one in 600 ms. Under reduced motion it just shows the new value. */
export function CountUp({ cents, className = "", testId }: { cents: number; className?: string; testId?: string }) {
  const reduced = useReducedMotion();
  const [shown, setShown] = useState(cents);
  const from = useRef(cents);

  useEffect(() => {
    const start = from.current;
    from.current = cents;
    if (reduced || start === cents) return setShown(cents);
    const t0 = performance.now();
    let frame = requestAnimationFrame(function tick(now) {
      const t = Math.min(1, (now - t0) / MS);
      setShown(Math.round(start + (cents - start) * easeOut(t)));
      if (t < 1) frame = requestAnimationFrame(tick);
    });
    return () => cancelAnimationFrame(frame);
  }, [cents, reduced]);

  return (
    <span className={`tabular-nums ${className}`}>
      <span aria-hidden="true">{money(shown)}</span>
      {/* The test id is on the final value, so a check never reads a figure mid-count. */}
      <span data-testid={testId} className="sr-only">
        {money(cents)}
      </span>
    </span>
  );
}
