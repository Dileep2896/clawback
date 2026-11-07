"use client";

import { useLive } from "../../lib/use-live.tsx";
import { Panel, PanelStub } from "../panel.tsx";

// Stub. panels-action owns this file: read snapshot.calls, whose transcriptJson rows are TranscriptRow from the voice service.
export function Call() {
  const { snapshot } = useLive();
  return (
    <Panel title="Call">
      <PanelStub count={snapshot?.calls.length ?? 0} noun="call" />
    </Panel>
  );
}
