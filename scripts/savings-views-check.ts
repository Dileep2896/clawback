// Checks the savings-views acceptance list in a real browser at 1080p: the recorded sim run plays into your own database
// while the Overview watches, then every money page is compared with the ledger, then Approve is double-clicked on a fresh run.
// The dashboard must be running on that database. Pass a folder to keep screenshots. DASHBOARD_URL picks another port.
// pnpm exec tsx --env-file-if-exists=.env scripts/savings-views-check.ts [folder]
import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";
import { fileURLToPath } from "node:url";
import { RUNS_DIR } from "@bill-fighter/agents/customer-data";
import { databaseUrl, db } from "@bill-fighter/db/client";
import { approvals, runs } from "@bill-fighter/db/schema";
import { chromium, type Page } from "playwright";
import { assertNotSharedDb, insertSampleRun } from "../apps/dashboard/lib/sample-data.ts";
import { RUN_TABLES } from "./demo-reset.ts";
import { parseRecording, replay } from "./replay.ts";

const BASE = process.env.DASHBOARD_URL ?? "http://localhost:3000";
const VIEWPORT = { width: 1920, height: 1080 };
const SPEED = 8;
const screenshotDir = process.argv[2];

// The stage numbers from docs/plan/phases/13-product-ui.md.
const REFUND = "$12,606.06";
const SAVINGS = "$18,319.32";
const FEE = "$9,277.61";
const KEEPS = "$21,647.77";

type LedgerRow = { kind: string; amountCents: number };
type Live = {
  run: { id: string } | null;
  humanActions: number;
  ledger: LedgerRow[];
  bills: unknown[];
  findings: { id: string; type: string }[];
};

const usd = new Intl.NumberFormat("en-US", { style: "currency", currency: "USD" });
const sumOf = (rows: LedgerRow[], kind: string) => usd.format(rows.filter((row) => row.kind === kind).reduce((sum, row) => sum + row.amountCents, 0) / 100);
const fetchLive = async (page: Page) => (await (await page.request.get(`${BASE}/api/live`)).json()) as Live;
const textOf = (page: Page, testId: string) => page.getByTestId(testId).innerText();
const see = (page: Page, testId: string, text: string, timeout = 10_000) => page.getByTestId(testId).filter({ hasText: text }).waitFor({ timeout });
const shot = async (page: Page, name: string) => {
  if (screenshotDir) await page.screenshot({ path: `${screenshotDir}/${name}.png` });
};
const open = (page: Page, path: string) => page.goto(`${BASE}${path}`, { timeout: 60_000 });

/** Own database only: assertNotSharedDb has already passed. */
const clearRuns = () => db.$client.query(`TRUNCATE ${RUN_TABLES.join(", ")}`);

/** The Overview stays open while the run plays, so the figures must arrive through the live feed with no reload. */
async function checkLiveDuringRun(page: Page) {
  await clearRuns();
  await open(page, "/overview");
  await page.evaluate("window.notReloaded = true");
  const recording = parseRecording(await readFile(fileURLToPath(new URL("../data/replay/run.jsonl", import.meta.url)), "utf8"));
  await replay({ pool: db.$client, url: databaseUrl(), runsDir: RUNS_DIR, allowNonlocal: false, recording, speed: SPEED, force: false });
  await see(page, "overview-keeps", KEEPS);
  assert.equal(await page.evaluate("window.notReloaded"), true, "the Overview must update with no page refresh");
  assert.equal(await db.$count(runs), 1, "the check holds exactly one run, so customer-wide sums are this run's");
}

async function checkOverview(page: Page) {
  const live = await fetchLive(page);
  assert.equal(await textOf(page, "overview-refund"), REFUND);
  assert.equal(await textOf(page, "overview-savings"), SAVINGS);
  assert.equal(await textOf(page, "overview-fee"), `− ${FEE}`);
  assert.equal(await textOf(page, "overview-refund"), sumOf(live.ledger, "refund"), "refund is the ledger sum");
  assert.equal(await textOf(page, "overview-savings"), sumOf(live.ledger, "savings"), "savings is the ledger sum");
  assert.equal(await textOf(page, "overview-fee"), `− ${sumOf(live.ledger, "fee")}`, "fee is the ledger row");
  assert.match(await textOf(page, "overview-run-date"), /\d{4}/, "the run date shows");
  const text = await page.locator("main").innerText();
  assert.match(text, /Counts when the provider grants it/);
  assert.doesNotMatch(text, /recovered/i, "claimed money is never called recovered");
  // A replay plays back its own decision: no Approve button on a recording.
  assert.equal(await page.getByTestId("overview-approve").count(), 0, "a recording offers no Approve");
  // The stage ends on this page, so the hero figure must be on the first screen.
  const keeps = await page.getByTestId("overview-keeps").boundingBox();
  assert.ok(keeps && keeps.y + keeps.height <= VIEWPORT.height, "You keep is on the first screen at 1080p");
  await shot(page, "overview");
}

async function checkBills(page: Page) {
  const live = await fetchLive(page);
  await open(page, "/bills");
  await page.locator("[data-bill]").first().waitFor({ timeout: 10_000 });
  assert.ok(live.bills.length > 0, "the seed has bills");
  assert.equal(await page.locator("[data-bill]").count(), live.bills.length, "every bill shows");
  assert.ok((await page.getByTestId("bills-site").count()) > 1, "bills are grouped by location");
  await shot(page, "bills");
}

async function checkFindings(page: Page) {
  const live = await fetchLive(page);
  await open(page, "/findings");
  await page.locator("[data-finding-row]").first().waitFor({ timeout: 10_000 });
  assert.equal(await page.locator("[data-finding-row]").count(), live.findings.length, "every finding shows");
  const promos = live.findings.filter((finding) => finding.type === "promoExpiry");
  assert.ok(promos.length > 0, "the recording has promo findings");
  for (const promo of promos) {
    assert.equal(await page.locator(`[data-finding-row="${promo.id}"] [data-testid="finding-state"]`).innerText(), "Found, not acted on", "a promo is found, not acted on");
  }
  await shot(page, "findings");

  const meter = live.findings.find((finding) => finding.type === "meterMultiplierJump")!;
  await page.locator(`[data-finding="${meter.id}"]`).click();
  await page.getByTestId("evidence-drawer").waitFor({ timeout: 5000 });
  await page.getByText("Billed versus real kWh").waitFor({ timeout: 5000 });
  await shot(page, "findings-evidence");
  await page.getByTestId("evidence-close").click();
  await page.getByTestId("evidence-drawer").waitFor({ state: "detached", timeout: 5000 });
}

async function checkMoney(page: Page) {
  const live = await fetchLive(page);
  await open(page, "/money");
  await see(page, "money-keeps", KEEPS);
  assert.equal(await textOf(page, "money-refund"), REFUND);
  assert.equal(await textOf(page, "money-savings"), SAVINGS);
  assert.equal(await textOf(page, "money-fee"), FEE);
  assert.equal(await page.locator("[data-ledger-row]").count(), live.ledger.length, "every ledger row shows");
  assert.equal(await page.getByTestId("money-invoice-state").count(), 1, "the invoice state shows");
  await shot(page, "money");
}

/** A fresh, non-recorded run with a pending bundle: two quick clicks must record one approval through the same route as the panel. */
async function checkApprove(page: Page) {
  await clearRuns();
  await insertSampleRun(db);
  await open(page, "/overview");
  const button = page.getByTestId("overview-approve");
  await button.waitFor({ timeout: 10_000 });
  await shot(page, "overview-approval-needed");
  await button.dblclick();
  await see(page, "overview-decision", "Approved by");
  const rows = await db.select().from(approvals);
  assert.equal(rows.length, 1);
  assert.equal(rows[0]!.status, "approved");
  assert.equal(rows[0]!.channel, "dashboard");
  assert.equal((await fetchLive(page)).humanActions, 1, "a double click is one human action");
  await shot(page, "overview-approved");
}

assertNotSharedDb();
const browser = await chromium.launch();
try {
  const page = await (await browser.newContext({ viewport: VIEWPORT, locale: "en-US" })).newPage();
  await checkLiveDuringRun(page);
  await checkOverview(page);
  await checkBills(page);
  await checkFindings(page);
  await checkMoney(page);
  await checkApprove(page);
  console.info("savings-views check passed");
} finally {
  await browser.close();
  await db.$client.end();
}
