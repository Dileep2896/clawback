import assert from "node:assert/strict";
import localCheck from "../local/card.check.ts";
import localCard from "../local/card.ts";
import adapter from "./card.ts";

/** The mock card must still hold its cap and write card_spend, but a naïve card does not exist, so this is N/A, not PASS. */
export default async function check() {
  assert.equal(adapter, localCard, "naive/card.ts is no longer the local mock: replace this check");
  await localCheck();
  return { notAvailable: "card issuing answers 501 feature_not_configured; the local mock card held its cap and wrote card_spend" };
}
