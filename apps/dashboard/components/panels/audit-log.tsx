"use client";

import { useLive } from "../../lib/use-live.tsx";
import { Panel, PanelStub } from "../panel.tsx";

// Stub. panels-money owns this file: read snapshot.auditLog, the newest rows without their input or output, and auditTotal.
export function AuditLog() {
  const { snapshot } = useLive();
  return (
    <Panel title="Audit log">
      <PanelStub count={snapshot?.auditTotal ?? 0} noun="tool call" />
    </Panel>
  );
}
