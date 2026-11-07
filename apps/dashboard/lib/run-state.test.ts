import { describe, expect, it } from "vitest";
import { findingState, statusLabel } from "./run-state.ts";

describe("findingState", () => {
  it("says a finding with no action was found and not acted on, whatever its status", () => {
    expect(findingState({ id: "promo", status: "proposed" }, [{ findingId: "other" }, { findingId: null }])).toBe("Found, not acted on");
  });

  it("reads the status of a finding that has an action", () => {
    expect(findingState({ id: "meter", status: "filed" }, [{ findingId: "meter" }])).toBe("Filed with the provider");
    expect(findingState({ id: "lines", status: "won" }, [{ findingId: "lines" }])).toBe("Won");
  });
});

it("labels a run status in plain words", () => {
  expect(statusLabel("over_budget")).toBe("Over budget");
});
