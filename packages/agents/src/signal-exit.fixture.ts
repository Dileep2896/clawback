// For run.test.ts: a process parked in a run, with a server keeping Node up, as the allowlist proxy and port 3002 do.
import { createServer } from "node:http";
import type { AddressInfo } from "node:net";
import { db } from "@bill-fighter/db/client";
import { createBrowser } from "@bill-fighter/platform/local/browser";
import type { Vault } from "@bill-fighter/platform/types";
import { executeRun, stopRunsOnSignal } from "./run.ts";

const runId = process.argv[2]!;
stopRunsOnSignal(db);
// A real Chromium, opened as a run opens it: after the handler is installed.
if (process.argv[3] === "browser") await createBrowser({} as Vault, () => ({ callNumbers: [], emailDomains: [], portalOrigins: [] })).open();
// The parked run has nothing to answer the signal itself, and the audit is never reached.
void executeRun({
  db,
  runId,
  prompt: "p",
  runtime: { run: async function* () { await new Promise(() => {}); } },
  audit: { record: async () => {}, list: async () => [] },
  tools: [],
});
const server = createServer();
server.listen(0, "127.0.0.1", () => {
  console.info((server.address() as AddressInfo).port);
});
