import assert from "node:assert/strict";
import local from "../local/llm.ts";
import localCheck from "../local/llm.check.ts";
import adapter from "./llm.ts";

/** naïve uses our own adapter for this, so the local check is the check. */
export default async function check() {
  assert.equal(adapter, local);
  await localCheck();
}
