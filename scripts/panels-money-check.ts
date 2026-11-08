// Checks the panels-money acceptance list in a real browser at 1080p, against a running dashboard. Clears runs from your own database only.
// The dashboard must be running on that database. Pass a folder to keep screenshots. DASHBOARD_URL picks another port.
// pnpm exec tsx --env-file-if-exists=.env scripts/panels-money-check.ts
import assert from "node:assert/strict";
import { signedInContext } from "./dashboard-session.ts";
import { randomInt } from "node:crypto";
import { loadAuditInput } from "@bill-fighter/agents/audit-input";
import { financeLedgerTools } from "@bill-fighter/agents/tools/finance-ledger";
import { runAudit } from "@bill-fighter/core/rules/index";
import { db } from "@bill-fighter/db/client";
import { actions, approvals, auditLog, boardCards, calls, findings, ledger, runs, smsMessages } from "@bill-fighter/db/schema";
import { generateSeed } from "@bill-fighter/db/seed/generate";
import { loadSeed } from "@bill-fighter/db/seed/load";
import { chromium, type Page } from "playwright";
import { assertNotSharedDb, insertSampleRun } from "../apps/dashboard/lib/sample-data.ts";

const BASE = process.env.DASHBOARD_URL ?? "http://localhost:3000";
const VIEWPORT = { width: 1920, height: 1080 };
const MIN_FONT_PX = 22;
const RUN = "panels-money-check";
const CANARY = "from-the-vault-canary";
const MANY_ROWS = 5000;
const SLOWEST_POLL_MS = 1000;
const screenshotDir = process.argv[2];

const STATUS_BY_TYPE: Record<string, "filed" | "won"> = { meterMultiplierJump: "filed", rateOptimization: "filed", unusedLines: "won", promoExpiry: "won" };

type LedgerRow = { kind: string; amountCents: number };
type Live = { run: { costUsd: number } | null; ledger: LedgerRow[]; auditLog: unknown[]; auditTotal: number };

const usd = new Intl.NumberFormat("en-US", { style: "currency", currency: "USD" });
const shot = async (page: Page, name: string) => {
  if (screenshotDir) await page.screenshot({ path: `${screenshotDir}/${name}.png` });
};
const fetchLive = async (page: Page) => (await (await page.request.get(`${BASE}/api/live`)).json()) as Live;
const textOf = (page: Page, testId: string) => page.getByTestId(testId).innerText();
const panel = (page: Page, title: string) => page.locator("section", { has: page.getByRole("heading", { name: title }) });
const see = (page: Page, testId: string, text: string) => page.getByTestId(testId).filter({ hasText: text }).waitFor({ timeout: 5000 });

// Browser code goes in as strings, because the root tsconfig has no DOM types.
const MEASURE = `(() => {
  const walker = document.createTreeWalker(document.body, NodeFilter.SHOW_TEXT);
  const tooSmall = [];
  while (walker.nextNode()) {
    const text = walker.currentNode.textContent?.trim();
    const parent = walker.currentNode.parentElement;
    if (!text || !parent || parent.closest(".sr-only, script, style")) continue;
    const size = parseFloat(getComputedStyle(parent).fontSize);
    if (size < ${MIN_FONT_PX}) tooSmall.push(text + " (" + size + "px)");
  }
  const root = document.documentElement;
  return { scrollHeight: root.scrollHeight, scrollWidth: root.scrollWidth, tooSmall };
})()`;

async function checkFits(page: Page, where: string) {
  const { scrollHeight, scrollWidth, tooSmall } = await page.evaluate<{ scrollHeight: number; scrollWidth: number; tooSmall: string[] }>(MEASURE);
  assert.ok(scrollHeight <= VIEWPORT.height, `${where}: page scrolls vertically, ${scrollHeight}px tall`);
  assert.ok(scrollWidth <= VIEWPORT.width, `${where}: page scrolls sideways, ${scrollWidth}px wide`);
  assert.deepEqual(tooSmall, [], `${where}: text under ${MIN_FONT_PX}px`);
}

/** Children first. Own database only: assertNotSharedDb has already passed. */
async function clearRuns() {
  await db.delete(auditLog);
  await db.delete(boardCards);
  await db.delete(approvals);
  await db.delete(calls);
  await db.delete(ledger);
  await db.delete(actions);
  await db.delete(findings);
  await db.delete(smsMessages);
  await db.delete(runs);
}

/** The real path over the real seed: every rule's findings, the statuses a finished run leaves, then the record_savings tool. */
async function recordRealSeed() {
  const seed = generateSeed();
  await loadSeed(db, seed);
  const audit = runAudit(loadAuditInput());
  await db.insert(findings).values(
    audit.findings.map(({ evidence, ...columns }, i) => ({ ...columns, id: `check-finding-${i}`, evidenceJson: evidence, status: STATUS_BY_TYPE[columns.type] ?? ("proposed" as const) })),
  );
  // A random cost, because every lane's dashboard looks alike: only this proves the server reads this database.
  const costUsd = randomInt(1, 1_000_000) / 1_000_000;
  await db.insert(runs).values({ id: RUN, customerId: seed.customer.id, platform: "local", trigger: "manual", status: "running", costUsd });
  await financeLedgerTools({ db })[0]!.handler({}, { runId: RUN, agent: "finance" });
  return { costUsd, customerId: seed.customer.id };
}

const sumOf = (rows: LedgerRow[], kind: string) => rows.filter((row) => row.kind === kind).reduce((sum, row) => sum + row.amountCents, 0);

async function checkRealFigures(page: Page, costUsd: number) {
  assert.equal((await fetchLive(page)).run?.costUsd, costUsd, "the dashboard is not reading the database this script wrote");
  await page.goto(`${BASE}/agents`);
  await page.getByTestId("ledger-refund").waitFor({ timeout: 5000 });

  assert.equal(await textOf(page, "ledger-refund"), "$12,606.06");
  assert.equal(await textOf(page, "ledger-savings"), "$21,559.32");
  assert.equal(await textOf(page, "ledger-fee"), "$10,249.61");
  assert.equal(await textOf(page, "ledger-keeps"), "$23,915.77");

  const rows = (await fetchLive(page)).ledger;
  assert.equal(rows.filter((row) => row.kind === "fee").length, 1, "one fee row");
  assert.equal(await textOf(page, "ledger-refund"), usd.format(sumOf(rows, "refund") / 100));
  assert.equal(await textOf(page, "ledger-savings"), usd.format(sumOf(rows, "savings") / 100));
  assert.equal(await textOf(page, "ledger-fee"), usd.format(sumOf(rows, "fee") / 100));
  await shot(page, "real-seed");
}

async function checkWording(page: Page) {
  const ledgerPanel = panel(page, "Ledger");
  const text = await ledgerPanel.innerText();
  assert.match(text, /Refund, claimed/, "the refund is labeled claimed");
  assert.doesNotMatch(text, /\bwon\b/i, "the panel never says won");
  assert.match(text, /Claimed and filed amounts count only when granted\./);
  assert.equal(await ledgerPanel.locator("[data-ledger-row]").first().getAttribute("data-kind"), "refund", "the refund is the first row");

  const statuses = await ledgerPanel.locator('[data-kind="savings"]').allInnerTexts();
  assert.ok(statuses.some((row) => row.includes("Yearly savings, due when granted")), "filed savings show as due when granted");
  assert.ok(statuses.some((row) => row.includes("Yearly savings, confirmed")), "won savings show as confirmed");
  for (const row of await ledgerPanel.locator('[data-kind="refund"]').allInnerTexts()) assert.match(row, /Refund, claimed/);

  const confirmed = (await textOf(page, "ledger-savings-confirmed")).replace(/[$,.]/g, "");
  const due = (await textOf(page, "ledger-savings-due")).replace(/[$,.]/g, "");
  assert.equal(Number(confirmed) + Number(due), 2_155_932, "confirmed plus due is the savings total");
}

async function checkLive(page: Page, customerId: string) {
  await page.evaluate("window.notReloaded = true");
  await db.insert(ledger).values({ customerId, kind: "savings", amountCents: 100, description: "check" });
  await see(page, "ledger-savings", "$21,560.32");
  await see(page, "ledger-keeps", "$23,916.77");
  await db.insert(auditLog).values({ id: "check-live-row", runId: RUN, agent: "finance", tool: "record_savings", costUsd: 0.04 });
  await page.locator('[data-audit-row="check-live-row"]').waitFor({ timeout: 5000 });
  assert.equal(await page.evaluate("window.notReloaded"), true, "values must change with no page refresh");
}

async function checkAuditColumns(page: Page) {
  await db.insert(auditLog).values({ id: "check-free-row", runId: RUN, agent: "collector", tool: "portal_login" });
  const free = page.locator('[data-audit-row="check-free-row"]');
  await free.waitFor({ timeout: 5000 });
  const cells = await free.locator("td").allInnerTexts();
  assert.match(cells[0]!, /\d:\d\d:\d\d/, "shows the time");
  assert.match(cells[1]!, /collector/, "shows the agent");
  assert.match(cells[1]!, /portal_login/, "shows the tool");
  assert.match(cells[2]!, /—/, "a cost of 0 shows a dash");
  assert.doesNotMatch(cells[2]!, /\$/, "a cost of 0 shows no amount");
  assert.match(await page.locator('[data-audit-row="check-live-row"]').innerText(), /\$0\.04/, "a real cost shows its amount");
  await shot(page, "audit-log");
}

async function checkVault(page: Page) {
  await db.insert(auditLog).values({ id: "check-vault-row", runId: RUN, agent: "collector", tool: "vault_read", inputJson: { password: CANARY }, outputJson: { password: CANARY } });
  await page.locator('[data-audit-row="check-vault-row"]').waitFor({ timeout: 5000 });
  assert.equal(JSON.stringify(await fetchLive(page)).includes(CANARY), false, "/api/live must not carry vault values");
  assert.equal((await page.content()).includes(CANARY), false, "the page must not hold vault values");
}

async function checkThousands(page: Page) {
  const startedTotal = (await fetchLive(page)).auditTotal;
  for (let batch = 0; batch < MANY_ROWS / 1000; batch++) {
    await db.insert(auditLog).values(Array.from({ length: 1000 }, (_, i) => ({ runId: RUN, agent: "collector", tool: `tool_${batch}_${i}`, costUsd: 0.000123 })));
  }
  const total = startedTotal + MANY_ROWS;
  await see(page, "audit-capped", `Newest 200 of ${total.toLocaleString("en-US")}`);
  assert.equal(await page.locator("[data-audit-row]").count(), 200, "the page holds only the newest rows");

  const startedAt = performance.now();
  const live = await fetchLive(page);
  const pollMs = performance.now() - startedAt;
  assert.equal(live.auditTotal, total);
  assert.ok(pollMs < SLOWEST_POLL_MS, `/api/live took ${pollMs}ms with ${total} rows, slower than the poll`);

  // A new row reaches the screen on the next poll, and the panel still scrolls by itself.
  const appearAt = performance.now();
  await db.insert(auditLog).values({ id: "check-after-thousands", runId: RUN, agent: "finance", tool: "record_savings" });
  await page.locator('[data-audit-row="check-after-thousands"]').waitFor({ timeout: 5000 });
  const appearMs = performance.now() - appearAt;
  assert.ok(appearMs < SLOWEST_POLL_MS * 3, `a new row took ${appearMs}ms to appear`);

  const body = panel(page, "Audit log").locator('[role="group"]');
  const scrolls = await body.evaluate((element) => {
    const box = element as unknown as { scrollTop: number; scrollHeight: number; clientHeight: number };
    box.scrollTop = 400;
    return box.scrollTop > 0 && box.scrollHeight > box.clientHeight;
  });
  assert.equal(scrolls, true, "the audit log scrolls inside its panel");
  await checkFits(page, `${total} audit rows`);
  console.info(`/api/live ${Math.round(pollMs)}ms and a new row on screen in ${Math.round(appearMs)}ms, with ${total} rows`);
}

async function checkNoFeeRowYet(page: Page) {
  const live = (await fetchLive(page)) as Live & Record<string, unknown>;
  live.ledger = live.ledger.filter((row) => row.kind !== "fee");
  await page.route("**/api/live", (route) => route.fulfill({ contentType: "application/json", body: JSON.stringify(live) }));
  await page.goto(`${BASE}/agents`);
  await see(page, "ledger-fee", "Not recorded yet");
  await see(page, "ledger-keeps", "Not recorded yet");
  await checkFits(page, "no fee row");
  await page.unroute("**/api/live");
}

async function checkEmpty(page: Page) {
  await page.route("**/api/live", (route) =>
    route.fulfill({
      contentType: "application/json",
      body: JSON.stringify({ run: null, customer: null, humanActions: 0, approval: null, boardCards: [], findings: [], findingSites: {}, actions: [], calls: [], ledger: [], sms: [], auditLog: [], auditTotal: 0 }),
    }),
  );
  await page.goto(`${BASE}/agents`);
  await page.getByText("No ledger rows yet").waitFor({ timeout: 5000 });
  await page.getByText("No tool calls yet").waitFor({ timeout: 5000 });
  await checkFits(page, "no run");
}

async function checkSample(page: Page) {
  await clearRuns();
  await insertSampleRun(db);
  await page.goto(`${BASE}/agents`);
  await see(page, "ledger-refund", "$12,600.00");
  await see(page, "ledger-savings", "$17,000.00");
  await see(page, "ledger-savings-confirmed", "$5,040.00");
  await see(page, "ledger-savings-due", "$11,960.00");
  await see(page, "ledger-fee", "$8,880.00");
  await see(page, "ledger-keeps", "$20,720.00");
  await checkFits(page, "sample");
  await shot(page, "sample");
}

assertNotSharedDb();
await clearRuns();
const browser = await chromium.launch();
try {
  const context = await signedInContext(browser, BASE, { viewport: VIEWPORT, locale: "en-US" });
  const page = await context.newPage();
  const { costUsd, customerId } = await recordRealSeed();
  await checkRealFigures(page, costUsd);
  await checkWording(page);
  await checkFits(page, "real seed");
  await checkLive(page, customerId);
  await checkAuditColumns(page);
  await checkVault(page);
  await checkThousands(page);
  await checkNoFeeRowYet(await context.newPage());
  await checkEmpty(await context.newPage());
  await checkSample(page);
  console.info("panels-money check passed");
} finally {
  await browser.close();
  // Leaves the sample as a fresh start.
  await clearRuns();
  await insertSampleRun(db);
  await db.$client.end();
}
