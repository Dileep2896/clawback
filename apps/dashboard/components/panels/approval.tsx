"use client";

import { useLive } from "../../lib/use-live.tsx";
import { Panel, PanelStub } from "../panel.tsx";

// Stub. panels-action owns this file: read snapshot.approval and snapshot.actions, decide through a route that calls
// decideApproval from @bill-fighter/db/approvals, then call refresh() so the change shows at once.
export function Approval() {
  const { snapshot } = useLive();
  return (
    <Panel title="Approval">
      <PanelStub count={snapshot?.approval?.actionIds.length ?? 0} noun="action" />
    </Panel>
  );
}
