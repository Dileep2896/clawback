"use client";

import { type KeyboardEvent, type ReactNode, useEffect, useRef } from "react";
import type { ActivityEntry } from "../../lib/activity.ts";
import { money, parseEvidence } from "../../lib/evidence.ts";
import type { ReplayInfo } from "../../lib/replay.ts";
import type { Snapshot } from "../../lib/snapshot.ts";
import { BillSnippet } from "./bill-snippet.tsx";
import { KwhChart } from "./kwh-chart.tsx";
import { RateTable } from "./rate-table.tsx";
import { SandboxPill } from "../sandbox-pill.tsx";

function Section({ title, evidence = true, children }: { title: string; evidence?: boolean; children: ReactNode }) {
  return (
    <section data-evidence={evidence ? "" : undefined} className="mt-6 border-t border-line pt-5">
      <h4 className="mb-3 text-label text-faded">{title}</h4>
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
          {entry.at && <time dateTime={entry.at} className="text-caption text-faded tabular-nums">{time.format(new Date(entry.at))}</time>}
        </li>
      ))}
    </ol>
  );
}

export type DrawerNav = { index: number; count: number; prev: () => void; next: () => void };

/** J moves on, K moves back; nothing while a modifier is held or the user is typing in a field. */
export function navKey(event: Pick<KeyboardEvent, "key" | "metaKey" | "ctrlKey" | "altKey" | "target">, nav: DrawerNav) {
  if (event.metaKey || event.ctrlKey || event.altKey || (event.target as HTMLElement | null)?.closest?.("input, select, textarea")) return;
  if (event.key === "j") nav.next();
  if (event.key === "k") nav.prev();
}

/**
 * A native modal dialog: it traps focus, closes on Esc and hands focus back to the button that opened it.
 * Title and explanation are the finding's claim. Every figure in an evidence Section comes from evidence_json.
 * A 720 px side sheet. With nav (Findings page) it has a counter and J and K to move; with activity, an Activity timeline.
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
  const amount = finding.refundCents > 0 ? `${money(finding.refundCents)} refund` : finding.annualSavingsCents > 0 ? `${money(finding.annualSavingsCents)} a year` : null;

  const onKeyDown = (event: KeyboardEvent) => nav && navKey(event, nav);

  return (
    <dialog
      ref={dialog}
      onClose={onClose}
      onKeyDown={onKeyDown}
      aria-labelledby="evidence-title"
      data-testid="evidence-drawer"
      className="my-0 mr-0 ml-auto h-dvh max-h-none w-[min(720px,100vw)] max-w-none overflow-y-auto border-l border-line bg-sheet p-0 text-body text-ink backdrop:bg-paper/80"
    >
      <div className="border-b border-line px-6 py-5">
        <div className="flex items-start gap-4">
          <div className="min-w-0 flex-1">
            <div className="flex flex-wrap items-center gap-x-3 gap-y-1">
              {site && <p className="text-label text-faded">{site}</p>}
              {/* The modal sits above the page header, so a replay shows its pill here too. */}
              {replay && <SandboxPill replay={replay} testId="drawer-replay-banner" />}
            </div>
            <h3 id="evidence-title" className="mt-1 text-page font-semibold">
              {finding.title}
            </h3>
            {amount && <p className="mt-1 font-figure text-page text-money">{amount}</p>}
          </div>
          {nav && (
            <div className="flex items-center gap-1">
              <span data-testid="drawer-counter" className="mr-2 text-faded tabular-nums">
                {nav.index + 1} / {nav.count}
              </span>
              <button type="button" onClick={nav.prev} disabled={nav.index === 0} aria-label="Previous finding (K)" title="Previous (K)" className="min-h-9 min-w-9 cursor-pointer rounded-control border border-line disabled:cursor-not-allowed disabled:opacity-40">
                <svg aria-hidden="true" viewBox="0 0 24 24" className="mx-auto size-4" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
                  <path d="m6 15 6-6 6 6" />
                </svg>
              </button>
              <button type="button" onClick={nav.next} disabled={nav.index === nav.count - 1} aria-label="Next finding (J)" title="Next (J)" className="min-h-9 min-w-9 cursor-pointer rounded-control border border-line disabled:cursor-not-allowed disabled:opacity-40">
                <svg aria-hidden="true" viewBox="0 0 24 24" className="mx-auto size-4" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
                  <path d="m6 9 6 6 6-6" />
                </svg>
              </button>
            </div>
          )}
          <form method="dialog">
            <button data-testid="evidence-close" className="min-h-9 cursor-pointer rounded-control border border-line px-3">
              Close
            </button>
          </form>
        </div>
      </div>

      <div className="px-6 pb-8 [&>section:first-child]:border-t-0">
        <Section title="Why it was flagged" evidence={false}>
          <p className="rounded-control bg-paper px-4 py-3 text-faded">{finding.explanation}</p>
        </Section>
        {!evidence && (
          <p role="alert" data-testid="evidence-unreadable" className="mt-5 text-alert">
            Evidence could not be read.
          </p>
        )}
        {evidence?.type === "meterMultiplierJump" && (
          <Section title="Billed versus real kWh">
            <KwhChart detail={evidence.detail} />
          </Section>
        )}
        {evidence?.type === "rateOptimization" && (
          <Section title="Rate comparison">
            <RateTable detail={evidence.detail} />
          </Section>
        )}
        {evidence && (
          <Section title="From the bills">
            <BillSnippet evidence={evidence} />
          </Section>
        )}
        {activity && (
          <Section title="Activity" evidence={false}>
            <Activity entries={activity} />
          </Section>
        )}
      </div>
    </dialog>
  );
}
