"use client";

import { useLive } from "../../lib/use-live.tsx";
import { Panel, PanelStub } from "../panel.tsx";

// Stub. panels-work owns this file: read snapshot.boardCards.
export function Board() {
  const { snapshot } = useLive();
  return (
    <Panel title="Board">
      <PanelStub count={snapshot?.boardCards.length ?? 0} noun="card" />
    </Panel>
  );
}
