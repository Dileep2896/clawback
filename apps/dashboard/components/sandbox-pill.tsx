"use client";

import { useId } from "react";
import { type ReplayInfo, replayLabel, replayPill } from "../lib/replay.ts";

/** The replay notice: a small pill, not a banner (human, 2026-11-07). The full sentence opens in a native popover. */
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
      <span id={id} popover="auto" className="m-auto w-72 max-w-[calc(100vw-2rem)] rounded-control border border-line bg-paper p-3 text-label text-ink backdrop:bg-transparent">
        {replayLabel(replay)}
      </span>
    </span>
  );
}
