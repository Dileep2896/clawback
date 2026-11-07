"use client";

import { useState } from "react";
import { post } from "../../lib/post.ts";
import { isStopped, STOPPED_TEXT } from "../../lib/run-state.ts";
import { useLive } from "../../lib/use-live.tsx";
import { Panel } from "../panel.tsx";

const CHANNELS: Record<string, string> = { dashboard: "on the dashboard", sms: "by SMS", naive: "on naïve" };

export function Approval() {
  const { snapshot, refresh } = useLive();
  const [busy, setBusy] = useState(false);
  const [failed, setFailed] = useState(false);
  const approval = snapshot?.approval;
  const stopped = isStopped(snapshot?.run?.status);

  async function approve() {
    if (!approval) return;
    setBusy(true);
    setFailed(false);
    const ok = await post("/api/approve", { runId: approval.runId });
    if (ok) await refresh();
    else setFailed(true);
    setBusy(false);
  }

  return (
    <Panel title="Approval">
      {!approval && <p className="text-faded">No approval request yet</p>}
      {approval && (
        <div className="grid gap-2">
          {/* First, so a long summary can never push it out of sight. */}
          {approval.status === "pending" && stopped && (
            <p role="alert" data-testid="approval-stopped" className="font-semibold text-stamp">
              {STOPPED_TEXT}
            </p>
          )}
          {approval.status === "pending" && !stopped && (
            <button
              type="button"
              data-testid="approve"
              disabled={busy}
              onClick={approve}
              className="min-h-16 w-full cursor-pointer rounded-[3px] bg-drum font-display text-[2.125rem] font-semibold text-drum-text disabled:cursor-wait disabled:opacity-70"
            >
              {busy ? "Approving" : "Approve"}
            </button>
          )}
          {failed && (
            <p role="alert" data-testid="approve-error" className="font-semibold text-stamp">
              Approve failed. Try again.
            </p>
          )}
          {approval.status !== "pending" && (
            <p
              data-testid="approval-decision"
              className={`rounded-[3px] px-3 py-1 font-semibold ${approval.status === "approved" ? "bg-drum text-drum-text" : "border-2 border-stamp text-stamp"}`}
            >
              {approval.status === "approved" ? "Approved" : "Denied"} by {approval.approvedBy}
              {approval.channel && `, ${CHANNELS[approval.channel]}`}
            </p>
          )}
          <p className="font-semibold tabular-nums">
            {approval.actionIds.length} {approval.actionIds.length === 1 ? "action" : "actions"}, one approval
          </p>
          <p data-testid="approval-summary" className="leading-tight whitespace-pre-line">
            {approval.summary}
          </p>
        </div>
      )}
    </Panel>
  );
}
