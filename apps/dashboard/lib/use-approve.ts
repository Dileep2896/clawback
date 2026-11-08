"use client";

import { useState } from "react";
import { post } from "./post.ts";
import { isSandboxReplay, replayOf } from "./replay.ts";
import { isStopped } from "./run-state.ts";
import { useLive } from "./use-live.tsx";

export const APPROVAL_CHANNELS: Record<string, string> = { dashboard: "on the dashboard", sms: "by SMS", naive: "on naïve" };

/** The one approve path for the Approval panel and the Overview card. The server lets one decision win, so a double click is one approval. */
export function useApprove() {
  const { snapshot, refresh } = useLive();
  const [busy, setBusy] = useState(false);
  const [failed, setFailed] = useState(false);
  const approval = snapshot?.approval ?? null;
  const info = replayOf(snapshot?.run);
  // A recording plays back its own decision, so its status never offers the stopped notice. A judge's sandbox replay waits for their tap.
  const replay = isSandboxReplay(info) ? null : info;
  const stopped = !info && isStopped(snapshot?.run?.status);
  const pending = approval?.status === "pending";

  async function approve() {
    if (!approval) return;
    setBusy(true);
    setFailed(false);
    const ok = await post("/api/approve", { runId: approval.runId });
    if (ok) await refresh();
    else setFailed(true);
    setBusy(false);
  }

  return { approval, replay, stopped, busy, failed, approve, canApprove: pending && !replay && !stopped };
}
