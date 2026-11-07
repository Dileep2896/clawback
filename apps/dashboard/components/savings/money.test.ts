import { createElement } from "react";
import { renderToStaticMarkup } from "react-dom/server";
import { expect, it } from "vitest";
import type { Snapshot } from "../../lib/snapshot.ts";
import { MoneyView } from "./money.tsx";

it("shows the invoice and card payment states while the ledger is still empty", () => {
  const action = (id: string, kind: string, payloadJson: unknown = null) => ({ id, kind, status: "proposed", findingId: null, payloadJson });
  const snapshot = {
    ledger: [],
    findings: [],
    findingSites: {},
    approval: { status: "approved", actionIds: ["inv", "pay"] },
    actions: [action("inv", "invoice"), action("pay", "card_pay", { amountCents: 4200, description: "Pay the gas bill" })],
  } as unknown as Snapshot;
  const html = renderToStaticMarkup(createElement(MoneyView, { snapshot }));
  expect(html).toContain("Nothing in your ledger yet");
  expect(html).toContain("Not created yet: approved, agents at work.");
  expect(html).toContain('data-card-payment="pay"');
  expect(html).toContain("Pay the gas bill");
});
