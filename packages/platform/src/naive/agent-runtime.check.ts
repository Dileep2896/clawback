import assert from "node:assert/strict";
import { listAll, naiveApi } from "./runtime-http.ts";
import adapter, { pickModel } from "./agent-runtime.ts";

/**
 * Free, read-only: the key works and a Claude model is served. A live run spends naïve credit, so it is not part of
 * check-platform; the approval loop is covered by agent-runtime.test.ts and the live probe in probe.ts.
 */
export default async function check() {
  assert.equal(typeof adapter.run, "function");
  assert.match(await pickModel(naiveApi), /^anthropic\/claude-/);
  await listAll(naiveApi, "/agents");
  await naiveApi("/sessions", { query: { stop_reason: "awaiting_approval", limit: 1 } });
}
