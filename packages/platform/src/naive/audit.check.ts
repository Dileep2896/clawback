import assert from "node:assert/strict";
import local from "../local/audit.ts";
import localCheck from "../local/audit.check.ts";
import adapter from "./audit.ts";

/** naïve uses our own adapter for this, so the local check is the check. */
export default async function check() {
  assert.equal(adapter, local);
  await localCheck();
}
