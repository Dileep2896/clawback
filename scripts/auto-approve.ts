import type { ApprovalGate } from "@bill-fighter/platform/types";

export const AUTO_APPROVER = "run-local auto approval";

/**
 * Approves one run's bundle as soon as it is pending. Only run-local may import this: stage runs wait for the owner.
 * A timer, because a gated call parks in waitForRelease and no run event arrives while it waits. Returns a stop function.
 */
export function autoApprove(gate: Pick<ApprovalGate, "get" | "decide">, runId: string, intervalMs = 1000): () => void {
  const timer = setInterval(() => {
    void (async () => {
      if ((await gate.get(runId))?.status !== "pending") return;
      await gate.decide({ runId, status: "approved", channel: "dashboard", approvedBy: AUTO_APPROVER });
      console.info(`Auto approved run ${runId}`);
    })().catch((error: unknown) => console.error(`Auto approval failed, will retry:`, error));
  }, intervalMs);
  return () => clearInterval(timer);
}
