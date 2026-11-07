// Checks the dashboard-shell acceptance list in a real browser at 1080p, against a running dashboard. Writes to your own database only.
// pnpm dev:dashboard must be running. Pass a folder to keep screenshots.
// pnpm exec tsx --env-file-if-exists=.env scripts/dashboard-shell-check.ts
import assert from "node:assert/strict";
import { decideApproval } from "@bill-fighter/db/approvals";
import { db } from "@bill-fighter/db/client";
import { chromium, type Page } from "playwright";
import { assertNotSharedDb, insertSampleRun, SAMPLE_RUN_ID, updateSampleRun } from "../apps/dashboard/lib/sample-data.ts";

const BASE = "http://localhost:3000";
const VIEWPORT = { width: 1920, height: 1080 };
const MIN_FONT_PX = 22;
const screenshotDir = process.argv[2];

const shot = async (page: Page, name: string) => {
  if (screenshotDir) await page.screenshot({ path: `${screenshotDir}/${name}.png` });
};

const seeText = (page: Page, testId: string, text: string) =>
  page.getByTestId(testId).filter({ hasText: text }).waitFor({ state: "attached", timeout: 5000 });

// Browser code goes in as strings, because the root tsconfig has no DOM types and this is the only file that wants them.
const CURRENT_THEME = "document.documentElement.dataset.theme";
const MEASURE_PAGE = `(() => {
  const walker = document.createTreeWalker(document.body, NodeFilter.SHOW_TEXT);
  const found = [];
  while (walker.nextNode()) {
    const text = walker.currentNode.textContent?.trim();
    const parent = walker.currentNode.parentElement;
    if (!text || !parent || parent.closest(".sr-only, script, style")) continue;
    const size = parseFloat(getComputedStyle(parent).fontSize);
    if (size < ${MIN_FONT_PX}) found.push(text + " (" + size + "px)");
  }
  const root = document.documentElement;
  return { scrollHeight: root.scrollHeight, scrollWidth: root.scrollWidth, innerWidth: window.innerWidth, tooSmall: found };
})()`;
type PageMeasure = { scrollHeight: number; scrollWidth: number; innerWidth: number; tooSmall: string[] };

async function checkFitsOneScreen(page: Page, theme: string) {
  const { scrollHeight, scrollWidth, tooSmall } = await page.evaluate<PageMeasure>(MEASURE_PAGE);
  assert.ok(scrollHeight <= VIEWPORT.height, `${theme}: page scrolls vertically, ${scrollHeight}px tall`);
  assert.ok(scrollWidth <= VIEWPORT.width, `${theme}: page scrolls sideways, ${scrollWidth}px wide`);
  assert.deepEqual(tooSmall, [], `${theme}: text under ${MIN_FONT_PX}px`);
}

async function checkLiveUpdates(page: Page) {
  await page.goto(BASE);

  await seeText(page, "customer", "Golden Gate Noodle Co.");
  // A real reload wipes this. Counting navigation events would not do: the router's history calls fire them too.
  await page.evaluate("window.notReloaded = true");
  await seeText(page, "platform", "local");
  await seeText(page, "run-status", "Running");
  await seeText(page, "run-cost", "$1.24");
  await seeText(page, "demo-data", "Demo data");
  await seeText(page, "human-actions", "Human actions: 0");
  await checkFitsOneScreen(page, "light");
  await shot(page, "light-pending");

  await decideApproval(db, { runId: SAMPLE_RUN_ID, status: "approved", channel: "dashboard", approvedBy: "Linda Park" });
  await seeText(page, "human-actions", "Human actions: 1");

  // The owner also texts YES: the same approval, not a second human action.
  const second = await decideApproval(db, { runId: SAMPLE_RUN_ID, status: "approved", channel: "sms", approvedBy: "Linda Park" });
  assert.equal(second.channel, "dashboard", "the first decision must win");
  await page.waitForTimeout(2500);
  await seeText(page, "human-actions", "Human actions: 1");

  await updateSampleRun(db, { costUsd: 2.5, status: "over_budget" });
  await seeText(page, "run-cost", "$2.50");
  await seeText(page, "run-status", "Over budget");

  assert.equal(await page.evaluate("window.notReloaded"), true, "values must change with no page refresh");
  await page.waitForTimeout(800); // Let the drum finish rolling for the screenshot.
  await shot(page, "light-approved");
}

async function checkDarkTheme(page: Page) {
  await page.getByTestId("theme-toggle").click();
  assert.equal(await page.evaluate(CURRENT_THEME), "dark");
  await checkFitsOneScreen(page, "dark");
  await shot(page, "dark-approved");

  await page.reload();
  await seeText(page, "customer", "Golden Gate Noodle Co.");
  assert.equal(await page.evaluate(CURRENT_THEME), "dark", "dark theme must survive a reload");
  await page.getByTestId("theme-toggle").click();
  assert.equal(await page.evaluate(CURRENT_THEME), undefined);
}

async function checkConnectionLoss(page: Page) {
  await page.route("**/api/live", (route) => route.fulfill({ status: 500, body: "down" }));
  await seeText(page, "live-error", "Connection lost");
  // The last good values stay up.
  await seeText(page, "customer", "Golden Gate Noodle Co.");
  await shot(page, "light-connection-lost");
  await page.unroute("**/api/live");
  await page.getByTestId("live-error").waitFor({ state: "detached", timeout: 5000 });
}

// The real route is covered by lib/snapshot.test.ts, and faking it here leaves the rows of the running sample alone.
async function checkNoRun(page: Page, noRunBody: string) {
  await page.route("**/api/live", (route) => route.fulfill({ contentType: "application/json", body: noRunBody }));
  await page.goto(BASE);
  await seeText(page, "no-run", "No run yet. Start one with pnpm demo:start");
  await seeText(page, "human-actions", "Human actions: 0");
  assert.equal(await page.getByTestId("customer").count(), 0, "no customer before any run");
  await checkFitsOneScreen(page, "light, no run");
  await shot(page, "light-no-run");
}

// Stacked, the page may scroll down, but never sideways.
async function checkNarrow(page: Page) {
  await page.goto(BASE);
  await seeText(page, "customer", "Golden Gate Noodle Co.");
  const { scrollWidth, innerWidth } = await page.evaluate<PageMeasure>(MEASURE_PAGE);
  assert.ok(scrollWidth <= innerWidth, `narrow: page scrolls sideways, ${scrollWidth}px wide in ${innerWidth}px`);
  if (screenshotDir) await page.screenshot({ path: `${screenshotDir}/narrow.png`, fullPage: true });
}

const NO_RUN = {
  run: null,
  customer: null,
  humanActions: 0,
  approval: null,
  boardCards: [],
  findings: [],
  actions: [],
  calls: [],
  ledger: [],
  sms: [],
  auditLog: [],
  auditTotal: 0,
};

assertNotSharedDb();
await insertSampleRun(db);
const browser = await chromium.launch();
try {
  const page = await (await browser.newContext({ viewport: VIEWPORT })).newPage();
  await checkLiveUpdates(page);
  await checkDarkTheme(page);
  await checkConnectionLoss(page);

  const fresh = await (await browser.newContext({ viewport: VIEWPORT })).newPage();
  await checkNoRun(fresh, JSON.stringify(NO_RUN));

  await checkNarrow(await (await browser.newContext({ viewport: { width: 390, height: 844 } })).newPage());
  console.info("dashboard-shell check passed");
} finally {
  await browser.close();
  // Leaves the sample as a fresh start, so a later look at the dashboard shows the pending state.
  await insertSampleRun(db);
  await db.$client.end();
}
