"use client";

import { useEffect, useState } from "react";
import { replayLabel, replayOf } from "../lib/replay.ts";
import { runProblems } from "../lib/run-state.ts";
import { useLive } from "../lib/use-live.tsx";
import { MeterRegister } from "./meter-register.tsx";

const usd = new Intl.NumberFormat("en-US", { style: "currency", currency: "USD" });
const platformLabel = (platform: string) => (platform === "naive" ? "naïve" : platform);
// runs.status is free text such as running, success or over_budget.
const statusLabel = (status: string) => {
  const words = status.replaceAll("_", " ");
  return words.charAt(0).toUpperCase() + words.slice(1);
};

function Fact({ label, testId, children }: { label: string; testId: string; children: string }) {
  return (
    <div>
      <div className="text-faded">{label}</div>
      <div data-testid={testId} className="font-display text-[2.125rem] leading-tight font-semibold tabular-nums">
        {children}
      </div>
    </div>
  );
}

function ThemeToggle() {
  const [dark, setDark] = useState(false);
  useEffect(() => setDark(document.documentElement.dataset.theme === "dark"), []);

  function toggle() {
    const next = !dark;
    setDark(next);
    if (next) document.documentElement.dataset.theme = "dark";
    else delete document.documentElement.dataset.theme;
    try {
      localStorage.setItem("theme", next ? "dark" : "light");
    } catch {
      // Storage can be blocked. The theme still changes for this visit.
    }
  }

  return (
    <button
      type="button"
      data-testid="theme-toggle"
      onClick={toggle}
      className="min-h-11 cursor-pointer rounded-[3px] border-2 border-ink px-3 font-semibold"
    >
      {dark ? "Light theme" : "Dark theme"}
    </button>
  );
}

/** Above everything and outside any panel, so nothing on the page can scroll it away. */
export function ReplayBanner() {
  const { snapshot } = useLive();
  const replay = replayOf(snapshot?.run);
  if (!replay) return null;
  return (
    <p role="status" data-testid="replay-banner" className="m-3 mb-0 rounded-[3px] border-4 border-stamp bg-sheet px-4 py-1 text-center font-display text-[2.125rem] leading-tight font-bold text-stamp">
      {replayLabel(replay)}
    </p>
  );
}

export function Header() {
  const { snapshot, connected } = useLive();
  const run = snapshot?.run;
  const humanActions = snapshot?.humanActions ?? 0;
  const problems = runProblems(snapshot?.boardCards ?? []);

  return (
    <header className="flex flex-wrap items-center gap-x-10 gap-y-2 px-4 py-3">
      <div>
        <h1 className="font-display text-[3.25rem] leading-none font-bold">Bill Fighter</h1>
        {snapshot?.customer && (
          <p data-testid="customer" className="mt-1 text-[1.625rem] leading-tight font-semibold">
            {snapshot.customer.name}
          </p>
        )}
      </div>

      {run && (
        <>
          <Fact label="Platform" testId="platform">
            {platformLabel(run.platform)}
          </Fact>
          <Fact label="Run status" testId="run-status">
            {statusLabel(run.status)}
          </Fact>
          <div>
            <Fact label="Run cost" testId="run-cost">
              {usd.format(run.costUsd)}
            </Fact>
            {run.status === "running" && (
              <p data-testid="run-cost-note" className="leading-tight text-faded">
                Model cost is added when the run ends
              </p>
            )}
          </div>
        </>
      )}

      {problems.map((problem) => (
        <p key={problem} role="alert" data-testid="run-problem" className="order-last w-full text-[1.625rem] leading-tight font-semibold text-stamp">
          {problem}
        </p>
      ))}

      {snapshot && !run && (
        <p data-testid="no-run" className="text-[1.75rem] font-semibold">
          No run yet. Start one with <code className="font-display font-bold">pnpm demo:start</code>
        </p>
      )}

      {!connected && (
        <p role="alert" data-testid="live-error" className="text-[1.625rem] font-semibold text-stamp">
          {snapshot
            ? "Connection lost. Showing the last values."
            : "Cannot load run data. Check Postgres with docker compose up -d --wait."}
        </p>
      )}

      <div className="ml-auto flex flex-wrap items-center gap-x-6 gap-y-2">
        <span data-testid="demo-data" className="rounded-[3px] border-2 border-faded px-3 py-1 font-semibold text-faded">
          Demo data
        </span>
        <ThemeToggle />
        <div className="flex items-center gap-3">
          <span aria-hidden="true" className="w-min text-right font-display text-[1.75rem] leading-none font-semibold">
            Human actions
          </span>
          <span data-testid="human-actions" className="sr-only">
            Human actions: {humanActions}
          </span>
          <MeterRegister value={humanActions} />
        </div>
      </div>
    </header>
  );
}
