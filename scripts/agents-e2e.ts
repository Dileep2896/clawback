// Runs the whole chain for real on the Claude Code login: one email, through demo-start and the webhook, to one pending approval.
// Spends model usage, so it is not a test file. Its own database only, because it clears findings and the ledger.
// Needs a seeded database and vault, and a running portal. Port 3002 must be free.
// Run: pnpm exec tsx --env-file-if-exists=.env scripts/agents-e2e.ts. E2E_HOLD_SECONDS sets how long a parked run must stay quiet.
import assert from "node:assert/strict";
import { execFile } from "node:child_process";
import { rm } from "node:fs/promises";
import { join } from "node:path";
import { setTimeout as sleep } from "node:timers/promises";
import { promisify } from "node:util";
import { loadTools } from "@bill-fighter/agents/registry";
import { RUNS_DIR } from "@bill-fighter/agents/customer-data";
import { findingTotals } from "@bill-fighter/core/rules/totals";
import { db } from "@bill-fighter/db/client";
import { actions, approvals, boardCards, calls, customers, findings, ledger, phoneLines, runs } from "@bill-fighter/db/schema";
import { CUSTOMER } from "@bill-fighter/db/seed/customer";
import { getPlatform, platformName } from "@bill-fighter/platform/factory";
import { createAgentRuntime } from "@bill-fighter/platform/local/agent-runtime";
import type { AgentRuntime, ApprovalGate, RunEvent } from "@bill-fighter/platform/types";
import { Provider } from "@bill-fighter/shared/fixtures";
import { isGatedTool } from "@bill-fighter/shared/gated-tools";
import { portalVaultName } from "@bill-fighter/shared/portal";
import { createInboundServer, WEBHOOK_PORT } from "@bill-fighter/webhooks/server";
import { abandonRun, acceptedCost, assertNotSharedDatabase, firstApprovalRequest, stopProblems } from "./stop-check.ts";

const HOLD_MS = Number(process.env.E2E_HOLD_SECONDS || 60) * 1000;
const PARK_TIMEOUT_MS = 15 * 60_000;
const WRAP_UP_TIMEOUT_MS = 5 * 60_000;
const DEMO_MARK_SECONDS = 120;

await assertNotSharedDatabase((sql) => db.$client.query(sql));
assert.equal(platformName(), "local");
assert.equal(process.env.VOICE_MODE, "sim", "VOICE_MODE must be sim");

const platform = getPlatform();
const [realGate, budget, audit, vault, mail] = await Promise.all([platform.approvalGate(), platform.budget(), platform.audit(), platform.vault(), platform.mail()]);

// demo-reset is not built yet. Earlier runs leave these, and the audit keeps a finding's status over a rerun.
await db.delete(ledger);
await db.delete(calls);
await db.delete(actions);
await db.delete(findings);

const startedAt = Date.now();
const elapsed = (at: number = Date.now()) => ((at - startedAt) / 1000).toFixed(1);
let lastActivity = startedAt;

const parked = new Set<string>();
let firstParkAt: number | null = null;
const gate: ApprovalGate = {
  ...realGate,
  async waitForRelease(actionId, signal) {
    firstParkAt ??= Date.now();
    parked.add(actionId);
    console.info(`+${elapsed()}s gate: ${actionId} parked in waitForRelease`);
    try {
      return await realGate.waitForRelease(actionId, signal);
    } finally {
      parked.delete(actionId);
      console.info(`+${elapsed()}s gate: ${actionId} left waitForRelease`);
    }
  },
};

const events: RunEvent[] = [];
let runId: string | null = null;
let result: Extract<RunEvent, { type: "result" }> | null = null;
const real = createAgentRuntime(async () => ({ gate, budget }));
const runtime: AgentRuntime = {
  async *run(spec) {
    runId = spec.runId;
    for await (const event of real.run(spec)) {
      events.push(event);
      lastActivity = Date.now();
      if (event.type === "tool_call") console.info(`+${elapsed()}s [${event.agent}] calls ${event.tool}`);
      else if (event.type === "denied") console.info(`+${elapsed()}s [${event.agent}] denied ${event.tool}: ${event.reason}`);
      else if (event.type === "text") console.info(`+${elapsed()}s [${event.agent}] ${event.text.slice(0, 300)}`);
      else if (event.type === "result") result = event;
      yield event;
    }
  },
};

const server = createInboundServer({ db, mail, runtime, audit, tools: await loadTools() });
await new Promise<void>((resolve, reject) => {
  server.once("error", (error) => reject(new Error(`Port ${WEBHOOK_PORT} is taken, so demo-start cannot reach this run's webhook: ${error.message}`)));
  server.listen(WEBHOOK_PORT, "127.0.0.1", resolve);
});

const finished = () => result !== null;
let exitCode = 1;
try {
  const { stdout } = await promisify(execFile)("pnpm", ["demo:start"]);
  console.info(stdout.trim());
  assert.ok(runId, "demo-start returned, but no run started");
  const id: string = runId;

  const parkDeadline = Date.now() + PARK_TIMEOUT_MS;
  let timedOut = false;
  for (;;) {
    if (finished()) break;
    const pending = (await realGate.get(id))?.status === "pending";
    const rows = await audit.list(id);
    const latestRow = rows.reduce((latest, row) => Math.max(latest, row.createdAt.getTime()), 0);
    lastActivity = Math.max(lastActivity, latestRow);
    if (pending && parked.size > 0 && Date.now() - lastActivity >= HOLD_MS) break;
    if (Date.now() > parkDeadline) {
      timedOut = true;
      break;
    }
    await sleep(1000);
  }
  const heldSeconds = (Date.now() - (firstParkAt ?? Date.now())) / 1000;

  // Filtered here, because scripts/ has no drizzle-orm of its own and these tables are small in this database.
  const run = (await db.select().from(runs)).find((row) => row.id === id);
  const approvalRows = (await db.select().from(approvals)).filter((row) => row.runId === id);
  const bundleIds = approvalRows.flatMap((row) => row.actionIds);
  const bundle = (await db.select().from(actions)).filter((row) => bundleIds.includes(row.id));
  const auditRows = await audit.list(id);
  const customer = (await db.select().from(customers)).find((row) => row.id === CUSTOMER.id);

  const inbox = (await (await fetch(`${process.env.MAILPIT_API}/api/v1/search?query=${encodeURIComponent(`to:"${customer!.contactEmail}"`)}`)).json()) as { messages?: { Created: string }[] };
  const summaryEmails = (inbox.messages ?? []).filter((message) => Date.parse(message.Created) >= startedAt).length;

  const secrets: string[] = [];
  for (const provider of Provider.options) {
    secrets.push(await vault.get(portalVaultName(provider, "username")), await vault.get(portalVaultName(provider, "password")));
  }
  const everyRow = JSON.stringify(auditRows);

  const problems = stopProblems({
    run: run!,
    finished: finished(),
    approvals: approvalRows,
    bundle,
    totals: findingTotals((await db.select().from(findings)).filter((row) => row.status !== "rejected")),
    findings: await db.select().from(findings),
    phoneLines: await db.select().from(phoneLines),
    audit: auditRows,
    cards: (await db.select().from(boardCards)).filter((card) => card.runId === id),
    toolCalls: events.flatMap((event) => (event.type === "tool_call" ? [{ agent: event.agent, tool: event.tool }] : [])),
    parked: [...parked],
    callRows: (await db.select({ id: calls.id }).from(calls)).length,
    ledgerRows: (await db.select({ id: ledger.id }).from(ledger)).length,
    summaryEmails,
    leakedSecrets: secrets.filter((secret) => everyRow.includes(secret)).length,
  });
  if (timedOut) problems.unshift(`no stop within ${PARK_TIMEOUT_MS / 60_000} minutes`);

  // Read while parked, so ps after this process exits shows whether anything outlived it.
  const { stdout: table } = await promisify(execFile)("ps", ["-axo", "pid=,ppid=,command="], { maxBuffer: 64 * 1024 * 1024 });
  const processes = table.trim().split("\n").map((line) => {
    const [, pid, ppid, command] = /^\s*(\d+)\s+(\d+)\s+(.*)$/.exec(line)!;
    return { pid: Number(pid), ppid: Number(ppid), command: command! };
  });
  const ours = new Set([process.pid]);
  for (let grew = true; grew; ) {
    grew = false;
    for (const { pid, ppid } of processes) {
      if (ours.has(ppid) && !ours.has(pid)) {
        ours.add(pid);
        grew = true;
      }
    }
  }
  const children = processes.filter(({ pid, command }) => ours.has(pid) && pid !== process.pid && /chrom|headless|claude/i.test(command));
  const browsers = children.filter(({ command }) => /--headless|chrome-headless-shell/.test(command) && !/--type=/.test(command)).length;

  // Only the audit row has a time: approvals has no created_at.
  const requested = firstApprovalRequest(auditRows)?.createdAt.getTime();
  const toApproval = requested === undefined ? null : (requested - run!.startedAt.getTime()) / 1000;

  // A parked run has no SDK result, so denying is the only way to get the SDK's figure without an experimental API.
  let costUsd = acceptedCost(result);
  if (!finished() && !timedOut) {
    await realGate.decide({ runId: id, status: "denied", channel: "dashboard", approvedBy: "agents-e2e" });
    const deadline = Date.now() + WRAP_UP_TIMEOUT_MS;
    while (!finished() && Date.now() < deadline) await sleep(1000);
    costUsd = acceptedCost(result);
    const gatedRows = (await audit.list(id)).filter((row) => isGatedTool(row.tool));
    const ran = gatedRows.filter((row) => !(row.outputJson as { denied?: unknown } | null)?.denied);
    if (ran.length > 0) problems.push(`gated tools ran after the denial: ${ran.map((row) => row.tool).join(", ")}`);
    if ((await db.select({ id: calls.id }).from(calls)).length > 0) problems.push("a call was placed after the denial");
    const gatedCalls = events.filter((event) => event.type === "tool_call" && isGatedTool(event.tool)).length;
    if (result && gatedRows.length !== gatedCalls) problems.push(`${gatedCalls} gated calls, but ${gatedRows.length} audit rows after the decision`);
  }
  const cap = Number(process.env.RUN_BUDGET_USD || 5);
  if (costUsd === null) problems.push("no successful result, so no cost accepted");
  else if (costUsd > cap) problems.push(`estimated cost $${costUsd.toFixed(4)} is over RUN_BUDGET_USD $${cap}`);

  await rm(join(RUNS_DIR, id), { recursive: true, force: true });

  console.info("\n--- Report ---");
  console.info(`Run: ${id}`);
  console.info(`Time to approval: ${toApproval === null ? "never" : `${toApproval.toFixed(1)}s`} (demo mark ${DEMO_MARK_SECONDS}s)`);
  console.info(`Time to park: ${firstParkAt === null ? "never" : `${elapsed(firstParkAt)}s`}. Held parked for ${heldSeconds.toFixed(0)}s with no activity needed: ${HOLD_MS / 1000}s`);
  console.info(`Estimated cost: ${costUsd === null ? "unknown" : `$${costUsd.toFixed(4)}`} of $${cap}. An SDK estimate, not a bill, and slightly high: it includes the CEO's wrap-up after the denial.`);
  console.info(`Tool calls: ${events.filter((event) => event.type === "tool_call").length}`);
  console.info(`Browsers open while parked: ${browsers}. After this process exits, run: ps -p ${children.map(({ pid }) => pid).join(",") || "none"}`);
  if (problems.length > 0) {
    console.error(`FAILED, ${problems.length} problems:`);
    for (const problem of problems) console.error(`- ${problem}`);
  } else {
    console.info("PASSED: one pending approval, a gated call parked, nothing gated ran.");
  }
  exitCode = problems.length > 0 ? 1 : 0;
} finally {
  // A timeout or a throw must not leave this run holding the customer. Raw SQL because scripts/ has no drizzle-orm of its own.
  const started = runId as string | null;
  if (started) await abandonRun(started, finished(), realGate, (id) => db.$client.query("update runs set status = 'error', finished_at = now() where id = $1 and status = 'running'", [id]));
}
// process.exit, not a natural end: open browser sessions keep the process alive for 10 idle minutes, and this is the exit under test.
process.exit(exitCode);
