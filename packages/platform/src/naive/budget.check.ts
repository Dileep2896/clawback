import assert from "node:assert/strict";
import local from "../local/budget.ts";
import localCheck from "../local/budget.check.ts";
import adapter from "./budget.ts";

/** naïve uses our own adapter for this, so the local check is the check. */
export default async function check() {
  assert.equal(adapter, local);
  await localCheck();
}
