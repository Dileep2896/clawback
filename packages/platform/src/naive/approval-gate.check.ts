import assert from "node:assert/strict";
import local from "../local/approval-gate.ts";
import localCheck from "../local/approval-gate.check.ts";
import adapter from "./approval-gate.ts";

/** naïve uses our own adapter for this, so the local check is the check. */
export default async function check() {
  assert.equal(adapter, local);
  await localCheck();
}
