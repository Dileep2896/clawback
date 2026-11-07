import { describe, expect, it } from "vitest";
import { actionState, findingState, statusLabel } from "./run-state.ts";

const bundle = (status: string) => ({ status, actionIds: ["act-meter", "act-invoice"] });
const meterActions = [{ id: "act-meter", findingId: "meter" }];

describe("findingState", () => {
  it("says a finding with no action was found and not acted on, whatever its status", () => {
    expect(findingState({ id: "promo", status: "proposed" }, [{ id: "a", findingId: "other" }, { id: "b", findingId: null }], bundle("approved"))).toBe(
      "Found, not acted on",
    );
  });

  it("reads the status of a finding that has moved past proposed", () => {
    expect(findingState({ id: "meter", status: "filed" }, meterActions, bundle("approved"))).toBe("Filed with the provider");
    expect(findingState({ id: "lines", status: "won" }, [{ id: "x", findingId: "lines" }], null)).toBe("Won");
  });

  it("reads a proposed finding from the bundle decision: pending, approved, denied", () => {
    const meter = { id: "meter", status: "proposed" };
    expect(findingState(meter, meterActions, null)).toBe("Waiting for your approval");
    expect(findingState(meter, meterActions, bundle("pending"))).toBe("Waiting for your approval");
    expect(findingState(meter, meterActions, bundle("approved"))).toBe("Approved, agents at work");
    expect(findingState(meter, meterActions, bundle("denied"))).toBe("Denied by you");
    expect(findingState(meter, meterActions, { status: "approved", actionIds: ["someone-else"] })).toBe("Waiting for your approval");
  });
});

describe("actionState", () => {
  it("reads a proposed action from the bundle decision: pending, approved, denied", () => {
    const invoice = { id: "act-invoice", status: "proposed" };
    expect(actionState(invoice, bundle("pending"))).toBe("Waiting for your approval");
    expect(actionState(invoice, bundle("approved"))).toBe("Approved, agents at work");
    expect(actionState(invoice, bundle("denied"))).toBe("Denied by you");
  });

  it("keeps the action's own status once it has moved on", () => {
    expect(actionState({ id: "act-invoice", status: "done" }, bundle("approved"))).toBe("Done");
  });
});

it("labels a run status in plain words", () => {
  expect(statusLabel("over_budget")).toBe("Over budget");
});
