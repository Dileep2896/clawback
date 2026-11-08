"use client";

import { type KeyboardEvent, type ReactNode, useEffect, useRef } from "react";
import type { ActivityEntry } from "../../lib/activity.ts";
import { money, parseEvidence } from "../../lib/evidence.ts";
import { type ReplayInfo, replayLabel } from "../../lib/replay.ts";
import type { Snapshot } from "../../lib/snapshot.ts";
import { BillSnippet } from "./bill-snippet.tsx";
import { KwhChart } from "./kwh-chart.tsx";
import { RateTable } from "./rate-table.tsx";

// Projector headings at 28 px; the app drawer's are 13 px grey labels, Linear-style.
const HEADING = { projector: "mb-2 text-[1.75rem] leading-tight font-semibold", app: "mb-3 text-[13px] font-semibold text-faded" };

function Section({ title, app, evidence = true, children }: { title: string; app: boolean; evidence?: boolean; children: ReactNode }) {
  return (
    <section data-evidence={evidence ? "" : undefined} className={app ? "mt-6 border-t border-line pt-5" : "mt-5"}>
      <h4 className={HEADING[app ? "app" : "projector"]}>{title}</h4>
      {children}
    </section>
  );
}

const time = new Intl.DateTimeFormat("en-US", { hour: "numeric", minute: "2-digit", second: "2-digit" });

function Activity({ entries }: { entries: ActivityEntry[] }) {
  return (
    <ol data-testid="finding-activity" className="relative grid gap-3 border-l border-line pl-5">
      {entries.map((entry, i) => (
        <li key={i} className="relative flex flex-wrap items-baseline justify-between gap-x-4">
          <span aria-hidden="true" className="absolute top-2 -left-[25px] size-2.5 rounded-full border-2 border-sheet bg-faded" />
          <span>{entry.text}</span>
          {entry.at && <time dateTime={entry.at} className="text-[13px] text-faded tabular-nums">{time.format(new Date(entry.at))}</time>}
        </li>
      ))}
    </ol>
  );
}

export type DrawerNav = { index: number; count: number; prev: () => void; next: () => void };

/**
 * A native modal dialog: it traps focus, closes on Esc and hands focus back to the button that opened it.
 * Title and explanation are the finding's claim. Every figure in an evidence Section comes from evidence_json.
 * With nav and activity it is the app's 720 px side sheet (Findings page): a counter, J and K to move, and an Activity timeline.
 * Without, it is the projector drawer on /agents, unchanged.
 */
export function EvidenceDrawer({
  finding,
  site,
  replay,
  onClose,
  nav,
  activity,
}: {
  finding: Snapshot["findings"][number];
  site?: string;
  replay?: ReplayInfo | null;
  onClose: () => void;
  nav?: DrawerNav;
  activity?: ActivityEntry[];
}) {
  const dialog = useRef<HTMLDialogElement>(null);
  useEffect(() => {
    dialog.current?.showModal();
  }, []);
  const evidence = parseEvidence(finding.type, finding.evidenceJson);
  const app = nav !== undefined;
  const amount = finding.refundCents > 0 ? `${money(finding.refundCents)} refund` : finding.annualSavingsCents > 0 ? `${money(finding.annualSavingsCents)} a year` : null;

  function onKeyDown(event: KeyboardEvent) {
    if (!nav || event.metaKey || event.ctrlKey || event.altKey || (event.target as HTMLElement).closest("input, select, textarea")) return;
    if (event.key === "j") nav.next();
    if (event.key === "k") nav.prev();
  }

  return (
    <dialog
      ref={dialog}
      onClose={onClose}
      onKeyDown={onKeyDown}
      aria-labelledby="evidence-title"
      data-testid="evidence-drawer"
      className={
        app
          ? "my-0 mr-0 ml-auto h-dvh max-h-none w-[min(720px,100vw)] max-w-none overflow-y-auto border-l border-line bg-sheet p-0 text-base text-ink backdrop:bg-black/40"
          : "my-0 mr-0 ml-auto h-dvh max-h-none w-[min(1280px,100vw)] max-w-none overflow-y-auto border-l-4 border-action bg-sheet p-5 text-ink backdrop:bg-black/60"
      }
    >
      {/* The modal sits above the page banner, so a replay repeats its label here, pinned while the drawer scrolls. */}
      {replay && (
        <p
          role="status"
          data-testid="drawer-replay-banner"
          className={`sticky top-0 z-10 bg-alert px-4 py-1 text-center leading-tight font-bold text-alert-text ${app ? "text-lg" : "mb-3 rounded-control text-[2.125rem]"}`}
        >
          {replayLabel(replay)}
        </p>
      )}
      <div className={app ? "border-b border-line px-6 py-5" : ""}>
        <div className="flex items-start gap-4">
          <div className="min-w-0 flex-1">
            {site && <p className={`font-semibold text-faded ${app ? "text-[15px]" : ""}`}>{site}</p>}
            <h3 id="evidence-title" className={app ? "mt-1 text-[1.5rem] leading-tight font-semibold" : "text-[2.125rem] leading-tight font-semibold"}>
              {finding.title}
            </h3>
            {app && amount && <p className="mt-2 font-figure text-[1.75rem] leading-none text-money">{amount}</p>}
          </div>
          {nav && (
            <div className="flex items-center gap-1 text-[15px]">
              <span data-testid="drawer-counter" className="mr-2 text-faded tabular-nums">
                {nav.index + 1} / {nav.count}
              </span>
              <button type="button" onClick={nav.prev} disabled={nav.index === 0} aria-label="Previous finding (K)" title="Previous (K)" className="min-h-9 min-w-9 cursor-pointer rounded-control border border-line disabled:cursor-default disabled:opacity-40">
                ↑
              </button>
              <button type="button" onClick={nav.next} disabled={nav.index === nav.count - 1} aria-label="Next finding (J)" title="Next (J)" className="min-h-9 min-w-9 cursor-pointer rounded-control border border-line disabled:cursor-default disabled:opacity-40">
                ↓
              </button>
            </div>
          )}
          <form method="dialog">
            <button data-testid="evidence-close" className={`cursor-pointer rounded-control border font-semibold ${app ? "min-h-9 border-line px-3 text-[15px]" : "min-h-11 border-faded px-3"}`}>
              Close
            </button>
          </form>
        </div>
        {!app && <p className="mt-2">{finding.explanation}</p>}
      </div>

      <div className={app ? "px-6 pb-8 [&>section:first-child]:border-t-0" : ""}>
        {app && (
          <Section title="Why it was flagged" app evidence={false}>
            <p className="rounded-control border-l-2 border-faded/40 bg-paper px-4 py-3 text-faded">{finding.explanation}</p>
          </Section>
        )}
        {!evidence && (
          <p role="alert" data-testid="evidence-unreadable" className="mt-5 font-semibold text-alert">
            Evidence could not be read.
          </p>
        )}
        {evidence?.type === "meterMultiplierJump" && (
          <Section title="Billed versus real kWh" app={app}>
            <KwhChart detail={evidence.detail} />
          </Section>
        )}
        {evidence?.type === "rateOptimization" && (
          <Section title="Rate comparison" app={app}>
            <RateTable detail={evidence.detail} />
          </Section>
        )}
        {evidence && (
          <Section title="From the bills" app={app}>
            <BillSnippet evidence={evidence} />
          </Section>
        )}
        {activity && (
          <Section title="Activity" app evidence={false}>
            <Activity entries={activity} />
          </Section>
        )}
      </div>
    </dialog>
  );
}
