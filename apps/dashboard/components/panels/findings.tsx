"use client";

import { useState } from "react";
import { money } from "../../lib/evidence.ts";
import { replayOf } from "../../lib/replay.ts";
import { useLive } from "../../lib/use-live.tsx";
import { EvidenceDrawer } from "../evidence/drawer.tsx";
import { Panel } from "../panel.tsx";

export function Findings() {
  const { snapshot } = useLive();
  // Only the id, so an open drawer follows live data and goes away if its finding does.
  const [openId, setOpenId] = useState<string | null>(null);
  const sites = snapshot?.findingSites ?? {};
  // Biggest first, so the room sees what matters without scrolling. A sort is stable, so ties keep their fixed order.
  const findings = [...(snapshot?.findings ?? [])].sort((a, b) => b.refundCents - a.refundCents || b.annualSavingsCents - a.annualSavingsCents);
  const open = findings.find((f) => f.id === openId);

  return (
    <Panel title="Findings">
      {findings.length === 0 && <p className="text-faded">No findings yet</p>}
      <ul className="grid gap-2">
        {findings.map((finding) => {
          const site = finding.accountId ? sites[finding.accountId] : undefined;
          return (
            <li key={finding.id}>
              <button
                type="button"
                data-finding={finding.id}
                aria-haspopup="dialog"
                onClick={() => setOpenId(finding.id)}
                className="block min-h-11 w-full cursor-pointer rounded-control border border-line px-3 py-1 text-left"
              >
                {site && <span className="block font-semibold text-faded">{site}</span>}
                <span className="block font-semibold">{finding.title}</span>
                {finding.refundCents > 0 && <span className="block tabular-nums">Refund {money(finding.refundCents)}, claimed</span>}
                {finding.annualSavingsCents > 0 && <span className="block tabular-nums">Saves {money(finding.annualSavingsCents)} a year</span>}
              </button>
            </li>
          );
        })}
      </ul>
      {open && (
        <EvidenceDrawer finding={open} site={open.accountId ? sites[open.accountId] : undefined} replay={replayOf(snapshot?.run)} onClose={() => setOpenId(null)} />
      )}
    </Panel>
  );
}
