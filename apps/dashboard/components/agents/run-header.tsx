"use client";

import { findingTotals } from "@bill-fighter/core/rules/totals";
import { useEffect, useState } from "react";
import { elapsed } from "../../lib/agents.ts";
import { replayOf, runSeconds } from "../../lib/replay.ts";
import { runProblems, statusLabel } from "../../lib/run-state.ts";
import { useLive } from "../../lib/use-live.tsx";
import { SandboxPill } from "../sandbox-pill.tsx";
import { CountUp } from "./count-up.tsx";

const usd = new Intl.NumberFormat("en-US", { style: "currency", currency: "USD" });

/** Ticks once a second while on, so a running clock moves between polls. */
function useNow(on: boolean) {
  const [now, setNow] = useState(() => Date.now());
  useEffect(() => {
    if (!on) return;
    const timer = setInterval(() => setNow(Date.now()), 1000);
    return () => clearInterval(timer);
  }, [on]);
  return now;
}

/** One line: the run's status and clock, the money found so far (the page's one large figure), human actions and run cost. */
export function RunHeader() {
  const { snapshot, connected } = useLive();
  const run = snapshot?.run;
  const replay = replayOf(run);
  const running = run?.status === "running";
  const now = useNow(running);
  // The approval's own sum (approver.ts): expired promos are flagged, not claimed, so they are not counted.
  const found = findingTotals((snapshot?.findings ?? []).filter((f) => f.type !== "promoExpiry"));
  const foundCents = found.refundCents + found.annualSavingsCents;
  const seconds = run ? runSeconds(run, now) : 0;
  const humanActions = snapshot?.humanActions ?? 0;
  const problems = runProblems(snapshot?.boardCards ?? []);

  return (
    <header className="grid gap-2">
      <div className="flex flex-wrap items-center gap-x-6 gap-y-2">
        <div className="mr-auto flex min-w-0 items-center gap-3">
          <div className="min-w-0">
            {snapshot?.customer && (
              <p data-testid="customer" className="truncate text-label text-faded">
                {snapshot.customer.name}
              </p>
            )}
            <h1 className="text-page font-semibold">Agents</h1>
          </div>
          {replay && <SandboxPill replay={replay} />}
        </div>

        {run && (
          <dl className="flex flex-wrap items-center gap-x-6 gap-y-2 tabular-nums">
            <div className="flex items-center gap-2">
              <dt className="sr-only">Run status</dt>
              <span aria-hidden="true" className={`size-2 rounded-full ${running ? "animate-pulse bg-agent motion-reduce:animate-none" : run.status === "success" ? "bg-money" : "bg-alert"}`} />
              <dd data-testid="run-status">{running ? "Running" : run.status === "success" ? "Finished" : statusLabel(run.status)}</dd>
              <dd data-testid="run-elapsed" className="text-faded">
                {elapsed(seconds)}
              </dd>
            </div>
            <div className="flex items-baseline gap-2">
              <dt className="order-last text-label text-faded">found</dt>
              <dd data-hero-figure>
                <CountUp cents={foundCents} testId="money-found" className="font-figure text-hero text-money" />
              </dd>
            </div>
            <div>
              <dt className="sr-only">Human actions</dt>
              <dd data-testid="human-actions">
                {humanActions} human {humanActions === 1 ? "action" : "actions"}
              </dd>
            </div>
            <div className="flex items-baseline gap-1.5">
              <dt className="order-last text-label text-faded">
                run cost{running && <span data-testid="run-cost-note">, model cost added at the end</span>}
              </dt>
              <dd data-testid="run-cost">{usd.format(run.costUsd)}</dd>
            </div>
          </dl>
        )}
      </div>

      {problems.map((problem) => (
        <p key={problem} role="alert" data-testid="run-problem" className="text-alert">
          {problem}
        </p>
      ))}
      {snapshot && !run && (
        <p data-testid="no-run" className="text-faded">
          Waiting for a run. Start one with <code>pnpm demo:start</code>.
        </p>
      )}
      {!connected && (
        <p role="alert" data-testid="live-error" className="text-alert">
          {snapshot ? "Connection lost. Showing the last values." : "Cannot load run data. Check Postgres with docker compose up -d --wait."}
        </p>
      )}
    </header>
  );
}
