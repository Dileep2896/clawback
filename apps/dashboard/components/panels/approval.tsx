"use client";

import { APPROVAL_CHANNELS, useApprove } from "../../lib/use-approve.ts";
import { STOPPED_TEXT } from "../../lib/run-state.ts";
import { Panel } from "../panel.tsx";

export function Approval() {
  const { approval, replay, stopped, busy, failed, approve, canApprove } = useApprove();

  return (
    <Panel title="Approval">
      {!approval && <p className="text-faded">No approval request yet</p>}
      {approval && (
        <div className="grid gap-2">
          {/* First, so a long summary can never push it out of sight. */}
          {approval.status === "pending" && replay && <p data-testid="approval-replay" className="font-semibold">Waiting for the recorded reply</p>}
          {approval.status === "pending" && stopped && (
            <p role="alert" data-testid="approval-stopped" className="font-semibold text-alert">
              {STOPPED_TEXT}
            </p>
          )}
          {canApprove && (
            <button
              type="button"
              data-testid="approve"
              disabled={busy}
              onClick={approve}
              className="min-h-16 w-full cursor-pointer rounded-control bg-action text-[2.125rem] font-semibold text-action-text disabled:cursor-wait disabled:opacity-70"
            >
              {busy ? "Approving" : "Approve"}
            </button>
          )}
          {failed && (
            <p role="alert" data-testid="approve-error" className="font-semibold text-alert">
              Approve failed. Try again.
            </p>
          )}
          {approval.status !== "pending" && (
            <p
              data-testid="approval-decision"
              className={`rounded-control px-3 py-1 font-semibold ${approval.status === "approved" ? "border border-line bg-paper" : "border border-alert text-alert"}`}
            >
              {approval.status === "approved" ? "Approved" : "Denied"} by {approval.approvedBy}
              {approval.channel && `, ${APPROVAL_CHANNELS[approval.channel]}`}
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
