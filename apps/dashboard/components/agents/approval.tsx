"use client";

import { type FormEvent, useState } from "react";
import { post } from "../../lib/post.ts";
import { replayOf } from "../../lib/replay.ts";
import { isStopped, STOPPED_TEXT } from "../../lib/run-state.ts";
import { APPROVAL_CHANNELS, useApprove } from "../../lib/use-approve.ts";
import { useLive } from "../../lib/use-live.tsx";

/** The text thread with the owner, and on a local live run a box to reply as them (YES approves). On naïve the request goes by email. */
function Phone() {
  const { snapshot, refresh } = useLive();
  const [draft, setDraft] = useState("");
  const [busy, setBusy] = useState(false);
  const [failed, setFailed] = useState(false);
  const sms = snapshot?.sms ?? [];
  const run = snapshot?.run;
  // During render, not in an effect, so a YES typed for one run can never be sent for the next.
  const [draftRun, setDraftRun] = useState(run?.id);
  if (draftRun !== run?.id) {
    setDraftRun(run?.id);
    setDraft("");
  }
  const contact = snapshot?.customer?.contactName ?? "Owner";
  const local = run?.platform === "local";
  const asked = local && !replayOf(run) && sms.some((message) => message.direction === "outbound");
  const stopped = isStopped(run?.status);
  const canReply = asked && !stopped;

  async function send(event: FormEvent) {
    event.preventDefault();
    const body = draft.trim();
    if (!run || !body || busy) return;
    setBusy(true);
    setFailed(false);
    const ok = await post("/api/sms", { runId: run.id, body });
    if (ok) {
      setDraft("");
      await refresh();
    } else setFailed(true);
    setBusy(false);
  }

  if (run && !local) {
    return (
      <p data-testid="phone-naive" className="text-faded">
        The request went by email.
      </p>
    );
  }
  if (sms.length === 0) return null;
  return (
    <section aria-label={`Text messages with ${contact}`} className="grid gap-2 border-t border-line pt-4">
      <h4 className="text-label text-faded">Texts with {contact}</h4>
      <ul className="grid gap-2">
        {sms.map((message) => {
          const inbound = message.direction === "inbound";
          return (
            <li key={message.id} data-sms={message.direction} className={`max-w-[85%] rounded-control px-3 py-2 ${inbound ? "ml-auto bg-ink text-paper" : "border border-line"}`}>
              <span className={`block text-caption ${inbound ? "" : "text-faded"}`}>{inbound ? contact : "Clawback"}</span>
              {message.body}
            </li>
          );
        })}
      </ul>
      {asked && stopped && snapshot?.approval?.status === "pending" && (
        <p data-testid="sms-stopped" className="text-alert">
          {STOPPED_TEXT}
        </p>
      )}
      {canReply && (
        <form onSubmit={send} className="grid gap-1.5">
          <label htmlFor="sms-reply" className="text-label text-faded">
            Reply as {contact}
          </label>
          <div className="flex gap-2">
            <input
              id="sms-reply"
              data-testid="sms-reply"
              autoComplete="off"
              maxLength={1000}
              value={draft}
              disabled={busy}
              onChange={(event) => setDraft(event.target.value)}
              className="min-h-9 min-w-0 flex-1 rounded-control border border-line bg-paper px-3"
            />
            <button type="submit" data-testid="sms-send" disabled={busy} className="min-h-9 cursor-pointer rounded-control border border-line px-3 disabled:cursor-wait disabled:opacity-70">
              Send
            </button>
          </div>
          {failed && (
            <p role="alert" data-testid="sms-error" className="text-alert">
              Not sent. Try again.
            </p>
          )}
        </form>
      )}
    </section>
  );
}

/** The one amber element on the page while it waits: what the agents want to do, and the Approve button. */
export function Approval() {
  const { approval, replay, stopped, busy, failed, approve, canApprove } = useApprove();
  if (!approval) return null;
  const pending = approval.status === "pending";
  const count = approval.actionIds.length;

  return (
    <section aria-labelledby="approval-title" className={`grid gap-4 rounded-card border p-6 ${pending ? "border-warn" : "border-line"}`}>
      <div className="flex flex-wrap items-center justify-between gap-3">
        <h3 id="approval-title" className="flex items-center gap-2 text-title font-semibold">
          {pending && <span aria-hidden="true" className="size-2 rounded-full bg-warn" />}
          {pending ? "Needs your approval" : "Approval"}
        </h3>
        <span className="text-faded tabular-nums">
          {count} {count === 1 ? "action" : "actions"}, one approval
        </span>
      </div>
      {pending && replay && (
        <p data-testid="approval-replay" className="text-warn">
          Waiting for the recorded reply
        </p>
      )}
      {pending && stopped && (
        <p role="alert" data-testid="approval-stopped" className="text-alert">
          {STOPPED_TEXT}
        </p>
      )}
      {canApprove && (
        <button
          type="button"
          data-testid="approve"
          disabled={busy}
          onClick={approve}
          className="min-h-11 w-full cursor-pointer rounded-control bg-action font-semibold text-action-text hover:brightness-110 disabled:cursor-wait disabled:opacity-70 sm:w-auto sm:justify-self-start sm:px-8"
        >
          {busy ? "Approving" : "Approve"}
        </button>
      )}
      {failed && (
        <p role="alert" data-testid="approve-error" className="text-alert">
          Approve failed. Try again.
        </p>
      )}
      {!pending && (
        <p data-testid="approval-decision" className={approval.status === "approved" ? "" : "text-alert"}>
          {approval.status === "approved" ? "Approved" : "Denied"} by {approval.approvedBy}
          {approval.channel && `, ${APPROVAL_CHANNELS[approval.channel]}`}
        </p>
      )}
      <p data-testid="approval-summary" className="max-w-[72ch] whitespace-pre-line text-faded">
        {approval.summary}
      </p>
      <Phone />
    </section>
  );
}
