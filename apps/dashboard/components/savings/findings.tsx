"use client";

import { useState } from "react";
import { money } from "../../lib/evidence.ts";
import { replayOf } from "../../lib/replay.ts";
import { findingState } from "../../lib/run-state.ts";
import { useLive } from "../../lib/use-live.tsx";
import { findingActivity } from "../../lib/activity.ts";
import { EvidenceDrawer } from "../evidence/drawer.tsx";
import { ButtonLink, Chip, EmptyState, PageHeader, StatusDot, Table } from "../ui/kit.tsx";
import { NoAudit } from "../no-audit.tsx";
import { Page } from "./common.tsx";

/** The rule that raised a finding, as a short chip label. */
export const RULE_LABEL: Record<string, string> = {
  meterMultiplierJump: "Meter multiplier",
  rateOptimization: "Rate plan",
  unusedLines: "Unused line",
  promoExpiry: "Promo ended",
  arithmeticCheck: "Bill math",
  thirdPartySupplier: "Third-party supplier",
};

// States where money is moving get the green dot; waiting and not acted on stay grey, so the approval card stays the one loud thing.
const MOVING = new Set(["Approved, agents at work", "Filed with the provider", "Won"]);

export function FindingsList() {
  const { snapshot } = useLive();
  // Only the id, so an open drawer follows live data and goes away if its finding does.
  const [openId, setOpenId] = useState<string | null>(null);
  const sites = snapshot?.findingSites ?? {};
  const actions = snapshot?.actions ?? [];
  // Biggest first, as on the Findings panel. A sort is stable, so ties keep their fixed order.
  const findings = [...(snapshot?.findings ?? [])].sort((a, b) => b.refundCents - a.refundCents || b.annualSavingsCents - a.annualSavingsCents);
  const index = findings.findIndex((f) => f.id === openId);
  const open = findings[index];
  const move = (step: number) => {
    const next = findings[index + step];
    if (next) setOpenId(next.id);
  };

  return (
    <Page>
      <PageHeader
        title="Findings"
        crumb={snapshot?.customer?.name}
        description={findings.length > 0 ? `${findings.length} findings, biggest first. Open one to see the evidence.` : "What the agents found on your bills. Open one to see the evidence."}
      />
      {snapshot && !snapshot.run && <NoAudit />}
      {snapshot?.run && findings.length === 0 && (
        <EmptyState title="No findings yet" action={<ButtonLink href="/agents">Watch your agents work</ButtonLink>}>
          The agents check every bill for overcharges, better rates and lines you no longer use. What they find shows up here.
        </EmptyState>
      )}
      {findings.length > 0 && (
        <Table
          head={[{ label: "Finding" }, { label: "Rule" }, { label: "Where it stands" }, { label: "Refund claimed", numeric: true }, { label: "Yearly savings", numeric: true }]}
        >
          {findings.map((finding) => {
            const site = finding.accountId ? sites[finding.accountId] : undefined;
            const state = findingState(finding, actions, snapshot?.approval);
            return (
              <tr key={finding.id} data-finding-row={finding.id} onClick={() => setOpenId(finding.id)} className="cursor-pointer">
                <td className="py-3!">
                  {site && <span className="block text-[13px] text-faded">{site}</span>}
                  <button
                    type="button"
                    data-finding={finding.id}
                    aria-haspopup="dialog"
                    onClick={() => setOpenId(finding.id)}
                    className="cursor-pointer text-left font-semibold hover:underline hover:underline-offset-4"
                  >
                    {finding.title}
                  </button>
                </td>
                <td>
                  <Chip>{RULE_LABEL[finding.type] ?? finding.type}</Chip>
                </td>
                <td>
                  <StatusDot tone={MOVING.has(state) ? "money" : "plain"}>
                    <span data-testid="finding-state">{state}</span>
                  </StatusDot>
                </td>
                <td className={`text-right font-figure tabular-nums ${finding.refundCents > 0 ? "" : "text-faded"}`}>{finding.refundCents > 0 ? money(finding.refundCents) : "None"}</td>
                <td className={`text-right font-figure tabular-nums ${finding.annualSavingsCents > 0 ? "" : "text-faded"}`}>
                  {finding.annualSavingsCents > 0 ? money(finding.annualSavingsCents) : "None"}
                </td>
              </tr>
            );
          })}
        </Table>
      )}
      {findings.length > 0 && <p className="mt-3 text-[13px] text-faded">A finding&apos;s own estimate. Only what the agents act on reaches your statement.</p>}
      {open && (
        <EvidenceDrawer
          finding={open}
          site={open.accountId ? sites[open.accountId] : undefined}
          replay={replayOf(snapshot?.run)}
          onClose={() => setOpenId(null)}
          nav={{ index, count: findings.length, prev: () => move(-1), next: () => move(1) }}
          activity={snapshot ? findingActivity(open, snapshot) : undefined}
        />
      )}
    </Page>
  );
}
