import { describe, expect, it } from "vitest";
import { GATED_TOOLS, isGatedTool } from "./gated-tools.ts";

describe("GATED_TOOLS", () => {
  it("is exactly the six gated tools", () => {
    expect([...GATED_TOOLS].sort()).toEqual([
      "call_provider",
      "cancel_service",
      "card_pay",
      "change_rate_plan",
      "create_invoice",
      "submit_claim",
    ]);
  });

  it("recognises gated tools and nothing else", () => {
    expect(isGatedTool("card_pay")).toBe(true);
    expect(isGatedTool("send_email")).toBe(false);
    expect(isGatedTool("CARD_PAY")).toBe(false);
  });
});
