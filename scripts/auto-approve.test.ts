import { setTimeout as sleep } from "node:timers/promises";
import type { Approval, ApprovalGate } from "@bill-fighter/platform/types";
import { afterEach, describe, expect, it, vi } from "vitest";
import { AUTO_APPROVER, autoApprove } from "./auto-approve.ts";

const fakeGate = (first: Approval["status"] | null) => {
  let status = first;
  const decide = vi.fn<ApprovalGate["decide"]>(async () => {
    status = "approved";
    return {} as Approval;
  });
  const get = vi.fn<ApprovalGate["get"]>(async () => (status ? ({ status } as Approval) : null));
  return { get, decide, set: (next: Approval["status"]) => (status = next) };
};

describe("autoApprove", () => {
  let stop = () => {};
  afterEach(() => stop());

  it("waits for the bundle, approves it once for its own run, and names itself", async () => {
    const gate = fakeGate(null);
    stop = autoApprove(gate, "run-1", 1);
    await vi.waitFor(() => expect(gate.get).toHaveBeenCalled());
    expect(gate.decide).not.toHaveBeenCalled();

    gate.set("pending");
    await vi.waitFor(() => expect(gate.decide).toHaveBeenCalled());
    await sleep(20);
    expect(gate.decide).toHaveBeenCalledOnce();
    expect(gate.decide).toHaveBeenCalledWith({ runId: "run-1", status: "approved", channel: "dashboard", approvedBy: AUTO_APPROVER });
    expect(new Set(gate.get.mock.calls.map(([runId]) => runId))).toEqual(new Set(["run-1"]));
  });

  it("never overrides a denial", async () => {
    const gate = fakeGate("denied");
    stop = autoApprove(gate, "run-1", 1);
    await sleep(20);
    expect(gate.decide).not.toHaveBeenCalled();
  });

  it("stops when told", async () => {
    const gate = fakeGate(null);
    autoApprove(gate, "run-1", 1)();
    await sleep(20);
    expect(gate.get).not.toHaveBeenCalled();
  });
});
