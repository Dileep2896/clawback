"use client";

import { useState } from "react";
import { agentRows, ceoRow } from "../../lib/agents.ts";
import { isStopped } from "../../lib/run-state.ts";
import { useLive } from "../../lib/use-live.tsx";
import { AuditLog } from "./audit-log.tsx";
import { useCallSpeech } from "./call.tsx";
import { NowPane } from "./now.tsx";
import { RunHeader } from "./run-header.tsx";
import { Timeline } from "./timeline.tsx";

/**
 * The live agents page as one story: the run on one line, the agents down the left in run order, and what the
 * active one is doing at real size on the right. At desktop width it fills one screen and each column scrolls inside itself.
 */
export function AgentsView() {
  const { snapshot } = useLive();
  const [picked, setPicked] = useState<string | null>(null);
  const speech = useCallSpeech();
  const input = {
    boardCards: snapshot?.boardCards ?? [],
    auditLog: snapshot?.auditLog ?? [],
    approvalPending: snapshot?.approval?.status === "pending",
    runActive: !isStopped(snapshot?.run?.status),
  };
  const rows = agentRows(input);

  return (
    <div data-fit-screen className="flex min-h-0 flex-1 flex-col gap-4 p-4 sm:p-6">
      <RunHeader />
      {snapshot?.run && (
        <main className="grid min-h-0 flex-1 gap-4 min-[1100px]:grid-cols-[360px_minmax(0,1fr)]">
          <Timeline ceo={ceoRow(input)} rows={rows} picked={picked} onPick={setPicked} />
          <div className="flex min-h-0 min-w-0 flex-col gap-4">
            <NowPane rows={rows} picked={picked} speech={speech} />
            <AuditLog />
          </div>
        </main>
      )}
    </div>
  );
}
