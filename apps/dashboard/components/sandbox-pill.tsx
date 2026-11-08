"use client";

import { useId, useState } from "react";
import { post } from "../lib/post.ts";
import { isSandboxReplay, type ReplayInfo, replayLabel, replayPill } from "../lib/replay.ts";
import { useLive } from "../lib/use-live.tsx";

/** A judge's finished sandbox replay can start over; it touches only their own rows. */
function WatchAgain() {
  const { snapshot, refresh } = useLive();
  const [busy, setBusy] = useState(false);
  if (!snapshot?.run || snapshot.run.status === "running") return null;
  async function restart() {
    setBusy(true);
    if (await post("/api/sandbox", { action: "restart" })) await refresh();
    setBusy(false);
  }
  return (
    <button type="button" data-testid="watch-again" disabled={busy} onClick={restart} className="mt-3 min-h-8 cursor-pointer rounded-control border border-line px-3 text-ink hover:bg-sheet disabled:cursor-wait disabled:opacity-70">
      {busy ? "Starting again…" : "Watch it again"}
    </button>
  );
}

/** The replay notice: a small pill, not a banner (human, 2026-11-07). The full sentence opens in a native popover, with "Watch it again" for a judge's finished sandbox. */
export function SandboxPill({ replay, testId = "replay-banner" }: { replay: ReplayInfo; testId?: string }) {
  const id = useId();
  return (
    <span className="inline-flex">
      <button
        type="button"
        popoverTarget={id}
        data-testid={testId}
        aria-label={`${replayPill(replay)}. ${replayLabel(replay)}`}
        className="inline-flex min-h-6 cursor-pointer items-center gap-1.5 rounded-full border border-line px-2.5 text-caption whitespace-nowrap text-faded hover:text-ink"
      >
        <span aria-hidden="true" className="size-1.5 rounded-full bg-warn" />
        {replayPill(replay)}
      </button>
      <span id={id} popover="auto" className="m-auto w-72 max-w-[calc(100vw-2rem)] flex-col items-start rounded-control border border-line bg-paper p-3 text-label text-ink backdrop:bg-transparent open:flex">
        {replayLabel(replay)}
        {isSandboxReplay(replay) && <WatchAgain />}
      </span>
    </span>
  );
}
