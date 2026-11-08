"use client";

import { useEffect, useRef, useState } from "react";
import { currentCalls, duration, emailViewOf, isDisclosure, nextToSpeak, type Row, viewOf } from "../../lib/calls.ts";
import { isSandboxReplay, recordedNow, replayOf, type ReplayInfo, speechRate } from "../../lib/replay.ts";
import type { Snapshot } from "../../lib/snapshot.ts";
import { useFollow } from "../../lib/use-follow.ts";
import { useLive } from "../../lib/use-live.tsx";

// Two sides of a call in one voice are hard to follow in a room.
const PITCH: Record<string, number> = { agent: 1, provider: 0.7 };
// A fixed pattern, so the server and the browser draw the same bars. Decorative.
const BARS = [3, 6, 9, 5, 8, 4, 7, 10, 6, 3, 8, 5, 9, 4, 7, 6, 3, 8, 5, 9, 6, 4];

/** Browsers can lack speech, refuse it or fail mid-line. Each of those only costs the sound, never the transcript. */
function speak(row: Row, rate: number, onFail: () => void) {
  try {
    const utterance = new SpeechSynthesisUtterance(row.content);
    utterance.pitch = PITCH[row.role] ?? 1;
    utterance.rate = rate;
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

function Timer({ startedAt, endedAt, replay }: { startedAt: string; endedAt: string | null; replay: ReplayInfo | null }) {
  const [now, setNow] = useState(() => Date.now());
  useEffect(() => {
    if (endedAt) return;
    const timer = setInterval(() => setNow(Date.now()), 1000);
    return () => clearInterval(timer);
  }, [endedAt]);
  const sandbox = isSandboxReplay(replay);
  const end = endedAt ? Date.parse(endedAt) : replay && !sandbox ? recordedNow(replay, now) : now;
  // A sandbox's times are on the judge's clock, which runs at the replay's speed: scaled back, the call shows its true length.
  const shown = sandbox ? Date.parse(startedAt) + (end - Date.parse(startedAt)) * replay.speed : end;
  return (
    <span data-testid="call-timer" className="text-faded tabular-nums">
      {duration(startedAt, shown)}
    </span>
  );
}

/** Moves while the call is open; still once it ends, and always under reduced motion. */
function Waveform({ live }: { live: boolean }) {
  return (
    <span aria-hidden="true" data-live={live || undefined} className="flex h-8 items-center gap-[3px]">
      {BARS.map((height, i) => (
        <span key={i} className={`call-bar w-[3px] rounded-full ${live ? "bg-agent" : "bg-faded/40"}`} style={{ height: `${height * 3}px`, animationDelay: `${(i % 7) * 70}ms` }} />
      ))}
    </span>
  );
}

function TranscriptRow({ row }: { row: Row }) {
  if (isDisclosure(row)) {
    return (
      <li data-call-row="disclosure" className="rounded-control border border-agent/40 px-3 py-2">
        <span className="block text-label text-agent">Disclosure</span>
        {row.content}
      </li>
    );
  }
  if (row.kind === "refused") {
    return (
      <li data-call-row="refused" className="rounded-control border border-alert/50 px-3 py-2 text-alert">
        System: {row.content}
      </li>
    );
  }
  if (row.kind === "keypress") {
    return (
      <li data-call-row="keypress" className="text-label text-faded">
        Pressed {row.content}
      </li>
    );
  }
  const agent = row.role === "agent";
  return (
    <li data-call-row="speech" className="call-line grid grid-cols-[4.5rem_minmax(0,1fr)] gap-3">
      <span className={`text-label ${agent ? "text-agent" : "text-faded"}`}>{agent ? "Clawback" : "Rep"}</span>
      <span>{row.content}</span>
    </li>
  );
}

function Envelope() {
  return (
    <svg aria-hidden="true" viewBox="0 0 20 20" className="size-5 shrink-0 text-agent" fill="none" stroke="currentColor" strokeWidth="1.5">
      <rect x="2.5" y="4.5" width="15" height="11" rx="1.5" />
      <path d="m3 5.5 7 5.5 7-5.5" />
    </svg>
  );
}

function EmailMessage({ row, label }: { row: Row; label: string }) {
  const agent = row.role === "agent";
  return (
    <li data-email-row={agent ? "sent" : "reply"} className={`grid gap-1.5 rounded-control border px-4 py-3 ${agent ? "border-agent/40" : "border-line"}`}>
      <span className={`text-label ${agent ? "text-agent" : "text-faded"}`}>{label}</span>
      <span className="whitespace-pre-line break-words">{row.content}</span>
    </li>
  );
}

/** The provider step by email: what was sent and BayTel's reply. Nothing here says a line was cancelled; the reply does. */
function EmailThread({ call }: { call: Snapshot["calls"][number] }) {
  const view = emailViewOf(call);
  return (
    <article data-call={call.id} data-testid="email-thread" className="grid gap-4">
      <div className="flex flex-wrap items-center gap-x-3 gap-y-2">
        <Envelope />
        <span className="text-faded">{view.reply ? "BayTel replied" : view.waiting ? "Waiting for BayTel's reply" : "Email thread"}</span>
        <span data-testid="call-mode" className="ml-auto rounded-full border border-line px-2.5 text-caption text-faded">
          Email
        </span>
      </div>
      {view.notice && (
        <p data-testid="email-notice" className="rounded-control border border-alert/50 px-3 py-2 text-alert">
          {view.notice}
        </p>
      )}
      <ol data-testid="email-messages" className="grid max-w-[72ch] gap-3">
        {view.sent && <EmailMessage row={view.sent} label={`Sent to ${view.to}`} />}
        {view.reply && <EmailMessage row={view.reply} label="Reply from BayTel" />}
      </ol>
    </article>
  );
}

function CallView({ call, replay }: { call: Snapshot["calls"][number]; replay: ReplayInfo | null }) {
  const view = viewOf(call);
  return (
    <article data-call={call.id} className="grid gap-4">
      <div className="flex flex-wrap items-center gap-x-4 gap-y-2">
        <Waveform live={!call.endedAt && view.state !== "failed"} />
        <span className="text-faded">{call.endedAt ? "Call ended" : "On the call"}</span>
        <Timer startedAt={call.startedAt} endedAt={call.endedAt} replay={replay} />
        <span data-testid="call-mode" className="ml-auto rounded-full border border-line px-2.5 text-caption text-faded">
          {call.mode === "sim" ? "Simulated call" : "Live call"}
        </span>
      </div>
      {view.fallback && (
        <p data-testid="call-fallback" className="rounded-control border border-alert/50 px-3 py-2 text-alert">
          {view.fallback}
        </p>
      )}
      {view.state === "in-progress" && (
        <p data-testid="call-in-progress" className="text-faded">
          The transcript appears when the call ends.
        </p>
      )}
      {view.state === "failed" && (
        <p data-testid="call-failed" className="rounded-control border border-alert/50 px-3 py-2 text-alert">
          {view.failure}
        </p>
      )}
      <ol data-testid="call-transcript" className="grid max-w-[72ch] gap-3">
        {view.rows.map((row, i) => (
          <TranscriptRow key={i} row={row} />
        ))}
      </ol>
    </article>
  );
}

/**
 * Speaks each new call line aloud, at up to 2× replay speed. Lives in the page, not the call view: the Now pane mounts
 * the call only when its moment comes, and a line already on screen at the first look counts as said.
 */
export function useCallSpeech() {
  const { snapshot } = useLive();
  const [speechFailed, setSpeechFailed] = useState(false);
  const said = useRef(new Map<string, number>());
  const firstLook = useRef(true);
  const rate = speechRate(replayOf(snapshot?.run));

  useEffect(() => {
    if (!snapshot) return;
    // Anything still queued belongs to a run that has gone.
    if (snapshot.calls.length === 0) stopSpeaking();
    const lines = nextToSpeak(currentCalls(snapshot.calls), said.current, firstLook.current);
    firstLook.current = false;
    // Still called when silent, so the lines count as said.
    if (rate !== null) for (const line of lines) speak(line, rate, () => setSpeechFailed(true));
  }, [snapshot, rate]);

  useEffect(() => stopSpeaking, []);
  return { speechFailed, silent: rate === null };
}

/** The negotiator's call, transcript streaming in and following its newest line. */
export function Call({ speechFailed, silent }: { speechFailed: boolean; silent: boolean }) {
  const { snapshot } = useLive();
  const calls = currentCalls(snapshot?.calls ?? []);
  const anchor = useFollow(calls.reduce((rows, call) => rows + viewOf(call).rows.length, 0));
  const replay = replayOf(snapshot?.run);

  return (
    <div ref={anchor} className="grid gap-6">
      {speechFailed && (
        <p data-testid="speech-unavailable" className="text-label text-faded">
          Browser speech unavailable. Transcript only.
        </p>
      )}
      {silent && (
        <p data-testid="sound-off" className="text-label text-faded">
          Sound off above 2× speed. Transcript only.
        </p>
      )}
      {calls.map((call) => (call.mode === "email" ? <EmailThread key={call.id} call={call} /> : <CallView key={call.id} call={call} replay={replay} />))}
    </div>
  );
}
