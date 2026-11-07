"use client";

import { useEffect, useRef, useState } from "react";
import { currentCalls, duration, isDisclosure, nextToSpeak, type Row, viewOf } from "../../lib/calls.ts";
import type { Snapshot } from "../../lib/snapshot.ts";
import { useFollow } from "../../lib/use-follow.ts";
import { useLive } from "../../lib/use-live.tsx";
import { Panel } from "../panel.tsx";

// Two sides of a call in one voice are hard to follow in a room.
const PITCH: Record<string, number> = { agent: 1, provider: 0.7 };

/** Browsers can lack speech, refuse it or fail mid-line. Each of those only costs the sound, never the transcript. */
function speak(row: Row, onFail: () => void) {
  try {
    const utterance = new SpeechSynthesisUtterance(row.content);
    utterance.pitch = PITCH[row.role] ?? 1;
    utterance.onerror = (event) => {
      if (event.error !== "canceled" && event.error !== "interrupted") onFail();
    };
    window.speechSynthesis.speak(utterance);
  } catch {
    onFail();
  }
}

function stopSpeaking() {
  try {
    window.speechSynthesis?.cancel();
  } catch {
    // Nothing was being spoken, then.
  }
}

function Timer({ startedAt, endedAt }: { startedAt: string; endedAt: string | null }) {
  const [now, setNow] = useState(() => Date.now());
  useEffect(() => {
    if (endedAt) return;
    const timer = setInterval(() => setNow(Date.now()), 1000);
    return () => clearInterval(timer);
  }, [endedAt]);
  return (
    <span data-testid="call-timer" className="font-display text-[2.125rem] leading-none font-semibold tabular-nums">
      {duration(startedAt, endedAt ?? now)}
    </span>
  );
}

function TranscriptRow({ row }: { row: Row }) {
  if (isDisclosure(row)) {
    return (
      <li data-call-row="disclosure" className="rounded-[3px] bg-drum px-3 py-1 leading-tight text-drum-text">
        <span className="block font-display text-[1.625rem] font-semibold">Disclosure</span>
        {row.content}
      </li>
    );
  }
  if (row.kind === "refused") {
    return (
      <li data-call-row="refused" className="rounded-[3px] border-2 border-stamp px-3 py-1 leading-tight font-semibold text-stamp">
        System: {row.content}
      </li>
    );
  }
  if (row.kind === "keypress") {
    return (
      <li data-call-row="keypress" className="px-3 leading-tight text-faded">
        Pressed {row.content}
      </li>
    );
  }
  return (
    <li data-call-row="speech" className="px-3 leading-tight">
      <span className="font-semibold">{row.role === "agent" ? "AI" : "Rep"}:</span> {row.content}
    </li>
  );
}

function CallView({ call }: { call: Snapshot["calls"][number] }) {
  const view = viewOf(call);
  return (
    <article data-call={call.id} className="grid gap-2">
      <div className="flex items-center justify-between gap-3">
        <span data-testid="call-mode" className="rounded-[3px] border-2 border-ink px-3 font-display text-[1.75rem] font-semibold">
          {call.mode}
        </span>
        <Timer startedAt={call.startedAt} endedAt={call.endedAt} />
      </div>
      {view.fallback && (
        <p data-testid="call-fallback" className="rounded-[3px] border-2 border-stamp px-3 py-1 leading-tight font-semibold text-stamp">
          {view.fallback}
        </p>
      )}
      {view.state === "in-progress" && <p data-testid="call-in-progress">Call in progress. The transcript appears when the call ends.</p>}
      {view.state === "failed" && (
        <p data-testid="call-failed" className="rounded-[3px] border-2 border-stamp px-3 py-1 leading-tight font-semibold text-stamp">
          {view.failure}
        </p>
      )}
      <ol data-testid="call-transcript" className="grid gap-2">
        {view.rows.map((row, i) => (
          <TranscriptRow key={i} row={row} />
        ))}
      </ol>
    </article>
  );
}

export function Call() {
  const { snapshot } = useLive();
  const calls = currentCalls(snapshot?.calls ?? []);
  const [speechFailed, setSpeechFailed] = useState(false);
  const said = useRef(new Map<string, number>());
  const firstLook = useRef(true);
  const anchor = useFollow(calls.reduce((rows, call) => rows + viewOf(call).rows.length, 0));

  useEffect(() => {
    if (!snapshot) return;
    const lines = nextToSpeak(currentCalls(snapshot.calls), said.current, firstLook.current);
    firstLook.current = false;
    for (const line of lines) speak(line, () => setSpeechFailed(true));
  }, [snapshot]);

  useEffect(() => stopSpeaking, []);

  return (
    <Panel title="Call">
      <div ref={anchor} className="grid gap-4">
        {calls.length === 0 && <p className="text-faded">No calls yet</p>}
        {speechFailed && (
          <p data-testid="speech-unavailable" className="text-faded">
            Browser speech unavailable. Transcript only.
          </p>
        )}
        {calls.map((call) => (
          <CallView key={call.id} call={call} />
        ))}
      </div>
    </Panel>
  );
}
