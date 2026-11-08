"use client";

import { replayLabel, replayOf } from "../lib/replay.ts";
import { runProblems, statusLabel } from "../lib/run-state.ts";
import { useLive } from "../lib/use-live.tsx";
import { MeterRegister } from "./meter-register.tsx";

const usd = new Intl.NumberFormat("en-US", { style: "currency", currency: "USD" });
const platformLabel = (platform: string) => (platform === "naive" ? "naïve" : platform);

function Fact({ label, testId, figure, children }: { label: string; testId: string; figure?: boolean; children: string }) {
  return (
    <div>
      <div className="leading-tight text-faded">{label}</div>
      <div data-testid={testId} className={`text-[2rem] leading-tight font-semibold tabular-nums ${figure ? "font-figure" : ""}`}>
        {children}
      </div>
    </div>
  );
}

/** Above everything and pinned (sticky) so the stacked narrow layout cannot scroll it away. */
export function ReplayBanner() {
  const { snapshot } = useLive();
  const replay = replayOf(snapshot?.run);
  if (!replay) return null;
  return (
    <p role="status" data-testid="replay-banner" className="sticky top-0 z-10 m-3 mb-0 rounded-control bg-warn px-4 py-1 text-center text-[2.125rem] leading-tight font-bold text-warn-text">
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
    <header className="flex flex-wrap items-center gap-x-8 gap-y-2 px-4 py-2">
      <div>
        <h1 className="text-[2.25rem] leading-tight font-bold">Watch your agents work</h1>
        {snapshot?.customer && (
          <p data-testid="customer" className="leading-tight font-semibold text-faded">
            {snapshot.customer.name}
          </p>
        )}
      </div>

      {run && snapshot && (
        <>
          <Fact label="Platform" testId="platform">
            {platformLabel(run.platform)}
          </Fact>
          <Fact label="Run status" testId="run-status">
            {statusLabel(run.status)}
          </Fact>
          {/* Run-stat chips: counts the snapshot already has, no spinners. The dot pulses only while the run is working. */}
          <p data-testid="run-stats" className="flex flex-wrap items-center gap-2 leading-tight">
            <span className="inline-flex items-center gap-2 rounded-full border border-line bg-sheet px-3 py-0.5 tabular-nums">
              <span aria-hidden="true" className={`size-2.5 rounded-full ${run.status === "running" ? "animate-pulse bg-agent motion-reduce:animate-none" : "bg-faded/50"}`} />
              {snapshot.auditTotal} steps
            </span>
            <span className="rounded-full border border-line bg-sheet px-3 py-0.5 tabular-nums">
              {snapshot.findings.length} {snapshot.findings.length === 1 ? "finding" : "findings"}
            </span>
          </p>
          <div>
            <Fact label="Run cost" testId="run-cost" figure>
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
        <p key={problem} role="alert" data-testid="run-problem" className="order-last w-full text-[1.625rem] leading-tight font-semibold text-alert">
          {problem}
        </p>
      ))}

      {snapshot && !run && (
        <p data-testid="no-run" className="text-[1.75rem] font-semibold">
          No run yet. Start one with <code className="font-bold">pnpm demo:start</code>
        </p>
      )}

      {!connected && (
        <p role="alert" data-testid="live-error" className="text-[1.625rem] font-semibold text-alert">
          {snapshot
            ? "Connection lost. Showing the last values."
            : "Cannot load run data. Check Postgres with docker compose up -d --wait."}
        </p>
      )}

      <div className="ml-auto flex items-center gap-3">
        {/* The sidebar is an icon rail here, so this page's Demo data label lives in its header at projector size. */}
        <span data-testid="demo-data" className="rounded-full border border-line bg-sheet px-3 py-0.5 font-semibold whitespace-nowrap text-faded">
          Demo data
        </span>
        <span aria-hidden="true" className="w-min text-right text-[1.625rem] leading-none font-semibold">
          Human actions
        </span>
        <span data-testid="human-actions" className="sr-only">
          Human actions: {humanActions}
        </span>
        <MeterRegister value={humanActions} />
      </div>
    </header>
  );
}
