"use client";

import { useState } from "react";
import { money } from "../../lib/evidence.ts";
import { replayOf } from "../../lib/replay.ts";
import { findingState } from "../../lib/run-state.ts";
import { useLive } from "../../lib/use-live.tsx";
import { EvidenceDrawer } from "../evidence/drawer.tsx";
import { ButtonLink, EmptyState, PageHeader, Table } from "../ui/kit.tsx";
import { NoAudit } from "../no-audit.tsx";
import { Page } from "./common.tsx";

export function FindingsList() {
  const { snapshot } = useLive();
  // Only the id, so an open drawer follows live data and goes away if its finding does.
  const [openId, setOpenId] = useState<string | null>(null);
  const sites = snapshot?.findingSites ?? {};
  const actions = snapshot?.actions ?? [];
  // Biggest first, as on the Findings panel. A sort is stable, so ties keep their fixed order.
  const findings = [...(snapshot?.findings ?? [])].sort((a, b) => b.refundCents - a.refundCents || b.annualSavingsCents - a.annualSavingsCents);
  const open = findings.find((f) => f.id === openId);

  return (
    <Page>
      <PageHeader title="Findings" description="What the agents found on your bills. Open one to see the evidence." />
      {snapshot && !snapshot.run && <NoAudit />}
      {snapshot?.run && findings.length === 0 && (
        <EmptyState title="No findings yet" action={<ButtonLink href="/agents">Watch your agents work</ButtonLink>}>
          The agents check every bill for overcharges, better rates and lines you no longer use. What they find shows up here.
        </EmptyState>
      )}
      {findings.length > 0 && (
        <Table
          head={[{ label: "Finding" }, { label: "Where it stands" }, { label: "Refund claimed", numeric: true }, { label: "Yearly savings", numeric: true }]}
        >
          {findings.map((finding) => {
            const site = finding.accountId ? sites[finding.accountId] : undefined;
            const state = findingState(finding, actions, snapshot?.approval);
            return (
              <tr key={finding.id} data-finding-row={finding.id}>
                <td>
                  {site && <span className="block text-base text-faded">{site}</span>}
                  <button
                    type="button"
                    data-finding={finding.id}
                    aria-haspopup="dialog"
                    onClick={() => setOpenId(finding.id)}
                    className="cursor-pointer text-left font-semibold underline decoration-line decoration-2 underline-offset-4 hover:decoration-action"
                  >
                    {finding.title}
                  </button>
                </td>
                <td data-testid="finding-state" className={state === "Found, not acted on" ? "text-faded" : ""}>
                  {state}
                </td>
                <td className="text-right font-figure tabular-nums">{finding.refundCents > 0 ? money(finding.refundCents) : "None"}</td>
                <td className="text-right font-figure tabular-nums">{finding.annualSavingsCents > 0 ? money(finding.annualSavingsCents) : "None"}</td>
              </tr>
            );
          })}
        </Table>
      )}
      {findings.length > 0 && <p className="mt-3 text-base text-faded">A finding&apos;s own estimate. Only what the agents act on reaches your statement.</p>}
      {open && (
        <EvidenceDrawer finding={open} site={open.accountId ? sites[open.accountId] : undefined} replay={replayOf(snapshot?.run)} onClose={() => setOpenId(null)} />
      )}
    </Page>
  );
}
