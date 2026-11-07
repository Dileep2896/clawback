"use client";

import { type ReactNode, useEffect, useRef } from "react";
import { parseEvidence } from "../../lib/evidence.ts";
import { type ReplayInfo, replayLabel } from "../../lib/replay.ts";
import type { Snapshot } from "../../lib/snapshot.ts";
import { BillSnippet } from "./bill-snippet.tsx";
import { KwhChart } from "./kwh-chart.tsx";
import { RateTable } from "./rate-table.tsx";

function Section({ title, children }: { title: string; children: ReactNode }) {
  return (
    <section data-evidence className="mt-5">
      <h4 className="mb-2 font-display text-[1.75rem] leading-tight font-semibold">{title}</h4>
      {children}
    </section>
  );
}

/**
 * A native modal dialog: it traps focus, closes on Esc and hands focus back to the button that opened it.
 * Title and explanation are the finding's claim. Every figure in a Section comes from evidence_json.
 */
export function EvidenceDrawer({
  finding,
  site,
  replay,
  onClose,
}: {
  finding: Snapshot["findings"][number];
  site?: string;
  replay?: ReplayInfo | null;
  onClose: () => void;
}) {
  const dialog = useRef<HTMLDialogElement>(null);
  useEffect(() => {
    dialog.current?.showModal();
  }, []);
  const evidence = parseEvidence(finding.type, finding.evidenceJson);

  return (
    <dialog
      ref={dialog}
      onClose={onClose}
      aria-labelledby="evidence-title"
      data-testid="evidence-drawer"
      className="my-0 mr-0 ml-auto h-dvh max-h-none w-[min(1280px,100vw)] max-w-none overflow-y-auto border-l-4 border-drum bg-sheet p-5 text-ink backdrop:bg-black/60"
    >
      {/* The modal sits above the page banner, so a replay repeats its label here, pinned while the drawer scrolls. */}
      {replay && (
        <p role="status" data-testid="drawer-replay-banner" className="sticky top-0 z-10 mb-3 rounded-[3px] border-4 border-stamp bg-sheet px-4 py-1 text-center font-display text-[2.125rem] leading-tight font-bold text-stamp">
          {replayLabel(replay)}
        </p>
      )}
      <div className="flex items-start gap-4">
        <div className="min-w-0 flex-1">
          {site && <p className="font-semibold text-faded">{site}</p>}
          <h3 id="evidence-title" className="font-display text-[2.125rem] leading-tight font-semibold">
            {finding.title}
          </h3>
        </div>
        <form method="dialog">
          <button data-testid="evidence-close" className="min-h-11 cursor-pointer rounded-[3px] border-2 border-ink px-3 font-semibold">
            Close
          </button>
        </form>
      </div>
      <p className="mt-2">{finding.explanation}</p>

      {!evidence && (
        <p role="alert" data-testid="evidence-unreadable" className="mt-5 font-semibold text-stamp">
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
    </dialog>
  );
}
