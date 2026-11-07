"use client";

import { type FormEvent, useState } from "react";
import { post } from "../../lib/post.ts";
import { useFollow } from "../../lib/use-follow.ts";
import { useLive } from "../../lib/use-live.tsx";
import { Panel } from "../panel.tsx";

export function Phone() {
  const { snapshot, refresh } = useLive();
  const [draft, setDraft] = useState("");
  const [busy, setBusy] = useState(false);
  const [failed, setFailed] = useState(false);
  const sms = snapshot?.sms ?? [];
  const run = snapshot?.run;
  const contact = snapshot?.customer?.contactName ?? "Owner";
  const local = run?.platform === "local";
  const canReply = local && sms.some((message) => message.direction === "outbound");
  const anchor = useFollow(sms.length);

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

  return (
    <Panel title="Phone">
      <div ref={anchor} className="grid gap-2">
        {run && !local && <p data-testid="phone-naive">On naïve the request goes by email</p>}
        {local && <p className="text-faded">Simulated phone: {contact}</p>}
        {sms.length === 0 && (local || !run) && <p className="text-faded">No messages yet</p>}
        <ul className="grid gap-2">
          {sms.map((message) => {
            const inbound = message.direction === "inbound";
            return (
              <li
                key={message.id}
                data-sms={message.direction}
                className={`rounded-[3px] px-3 py-1 leading-tight ${inbound ? "ml-6 bg-drum text-drum-text" : "mr-6 border-2 border-faded"}`}
              >
                <span className="block font-semibold">{inbound ? contact : "Bill Fighter"}</span>
                {message.body}
              </li>
            );
          })}
        </ul>
        {canReply && (
          <form onSubmit={send} className="sticky bottom-0 grid gap-1 bg-sheet pt-1">
            <label htmlFor="sms-reply" className="font-semibold">
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
                className="min-h-11 min-w-0 flex-1 rounded-[3px] border-2 border-ink bg-sheet px-2"
              />
              <button type="submit" data-testid="sms-send" disabled={busy} className="min-h-11 cursor-pointer rounded-[3px] border-2 border-ink px-3 font-semibold disabled:cursor-wait disabled:opacity-70">
                Send
              </button>
            </div>
            {failed && (
              <p role="alert" data-testid="sms-error" className="font-semibold text-stamp">
                Not sent. Try again.
              </p>
            )}
          </form>
        )}
      </div>
    </Panel>
  );
}
