"use client";

import { useLive } from "../../lib/use-live.tsx";
import { Panel, PanelStub } from "../panel.tsx";

// Stub. panels-money owns this file: read snapshot.ledger.
export function Ledger() {
  const { snapshot } = useLive();
  return (
    <Panel title="Ledger">
      <PanelStub count={snapshot?.ledger.length ?? 0} noun="row" />
    </Panel>
  );
}
