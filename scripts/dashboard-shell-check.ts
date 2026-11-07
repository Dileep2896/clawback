// Checks the dashboard-shell acceptance list in a real browser at 1080p, against a running dashboard. Writes to your own database only.
// pnpm dev:dashboard must be running. Pass a folder to keep screenshots.
// pnpm exec tsx --env-file-if-exists=.env scripts/dashboard-shell-check.ts
import assert from "node:assert/strict";
import { signedInContext } from "./dashboard-session.ts";
import { stopMessage } from "@bill-fighter/agents/retry";
import { decideApproval } from "@bill-fighter/db/approvals";
import { db } from "@bill-fighter/db/client";
import { boardCards } from "@bill-fighter/db/schema";
import { RUN_CARD_AGENT } from "@bill-fighter/shared/run-card";
import { chromium, type Page } from "playwright";
import { assertNotSharedDb, insertSampleRun, SAMPLE_RUN_ID, updateSampleRun } from "../apps/dashboard/lib/sample-data.ts";

const BASE = process.env.DASHBOARD_URL || "http://localhost:3000";
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
  await page.goto(`${BASE}/agents`);

  await seeText(page, "customer", "Golden Gate Noodle Co.");
  // A real reload wipes this. Counting navigation events would not do: the router's history calls fire them too.
  await page.evaluate("window.notReloaded = true");
  await seeText(page, "platform", "local");
  await seeText(page, "run-status", "Running");
  await seeText(page, "run-cost", "$1.24");
  await seeText(page, "run-cost-note", "Model cost is added when the run ends");
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
  assert.equal(await page.getByTestId("run-cost-note").count(), 0, "the note is only for a running run");

  // The longest message there is, so this also checks that it fits on the one screen.
  await db.insert(boardCards).values({ id: "sample-stop", runId: SAMPLE_RUN_ID, agent: RUN_CARD_AGENT, title: stopMessage("over_budget"), status: "blocked" });
  await seeText(page, "run-problem", "is an estimate");
  await checkFitsOneScreen(page, "light, stopped");

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
  await page.goto(`${BASE}/agents`);
  await seeText(page, "no-run", "No run yet. Start one with pnpm demo:start");
  await seeText(page, "human-actions", "Human actions: 0");
  assert.equal(await page.getByTestId("customer").count(), 0, "no customer before any run");
  await checkFitsOneScreen(page, "light, no run");
  await shot(page, "light-no-run");
}

// A fresh sample, so its approval is still pending when the run stops.
async function checkStoppedRun(page: Page) {
  await insertSampleRun(db);
  await updateSampleRun(db, { costUsd: 1, status: "error" });
  await page.goto(`${BASE}/agents`);
  await seeText(page, "approval-stopped", "This run stopped, so nothing can be approved.");
  assert.equal(await page.getByTestId("approve").count(), 0, "no Approve button on a stopped run");
  const reply = await page.request.post(`${BASE}/api/approve`, { data: { runId: SAMPLE_RUN_ID } });
  assert.equal(reply.status(), 409);
  await seeText(page, "human-actions", "Human actions: 0");
  await checkFitsOneScreen(page, "light, stopped with a pending approval");
  await shot(page, "light-stopped");
}

// Stacked, the page may scroll down, but never sideways.
async function checkNarrow(page: Page) {
  await page.goto(`${BASE}/agents`);
  await seeText(page, "customer", "Golden Gate Noodle Co.");
  const { scrollWidth, innerWidth } = await page.evaluate<PageMeasure>(MEASURE_PAGE);
  assert.ok(scrollWidth <= innerWidth, `narrow: page scrolls sideways, ${scrollWidth}px wide in ${innerWidth}px`);
  if (screenshotDir) await page.screenshot({ path: `${screenshotDir}/narrow.png`, fullPage: true });
}

// The landing page: both ways in, and no sideways scroll at desktop or phone width.
async function checkLanding(page: Page, name: string) {
  await page.goto(BASE);
  assert.equal(await page.getByTestId("get-started").getAttribute("href"), "/signup");
  assert.equal(await page.getByTestId("log-in").getAttribute("href"), "/login");
  const { scrollWidth, innerWidth } = await page.evaluate<PageMeasure>(MEASURE_PAGE);
  assert.ok(scrollWidth <= innerWidth, `landing ${name}: page scrolls sideways, ${scrollWidth}px wide in ${innerWidth}px`);
  if (screenshotDir) await page.screenshot({ path: `${screenshotDir}/landing-${name}.png`, fullPage: true });
}

// The hero at 320px: every piece of text in the playback sits inside the figure, which clips with overflow-hidden.
const CLIPPED_IN_HERO = `(() => {
  const figure = document.querySelector("figure");
  const box = figure.getBoundingClientRect();
  const clipped = [];
  const walker = document.createTreeWalker(figure, NodeFilter.SHOW_TEXT);
  while (walker.nextNode()) {
    const node = walker.currentNode;
    if (!node.textContent.trim() || node.parentElement.closest(".sr-only")) continue;
    const range = document.createRange();
    range.selectNodeContents(node);
    const r = range.getBoundingClientRect();
    if (r.left < box.left - 0.5 || r.right > box.right + 0.5) clipped.push(node.textContent.trim());
  }
  return clipped;
})()`;
async function checkLandingNarrowest(page: Page) {
  await page.emulateMedia({ reducedMotion: "reduce" }); // the finished run: every row, the evidence and the refund showing
  await page.goto(BASE);
  await page.getByText("Claimed, due only when granted").waitFor();
  assert.deepEqual(await page.evaluate<string[]>(CLIPPED_IN_HERO), [], "landing 320: hero text clipped");
  const { scrollWidth, innerWidth } = await page.evaluate<PageMeasure>(MEASURE_PAGE);
  assert.ok(scrollWidth <= innerWidth, `landing 320: page scrolls sideways, ${scrollWidth}px wide in ${innerWidth}px`);
  if (screenshotDir) await page.screenshot({ path: `${screenshotDir}/landing-320.png` });
}

// Turning reduced motion on while the hero plays stops it on the finished run, with no Pause button left.
async function checkLandingReducedMotionChange(page: Page) {
  await page.goto(BASE);
  const pause = page.getByRole("button", { name: "Pause" });
  await pause.waitFor();
  await page.waitForTimeout(1000);
  await page.emulateMedia({ reducedMotion: "reduce" });
  await page.getByText("Claimed, due only when granted").waitFor({ timeout: 2000 });
  assert.equal(await pause.isVisible(), false, "landing: Pause still shown under reduced motion");
  const progress = () => page.locator("figure [style*=scaleX]").getAttribute("style");
  const before = await progress();
  await page.waitForTimeout(1000);
  assert.equal(await progress(), before, "landing: playback still moving under reduced motion");
  assert.match(before ?? "", /scaleX\(1\)/, "landing: reduced motion does not show the finished run");
}

// Every nav link reaches its page, and the current page is marked.
async function checkNav(page: Page) {
  await page.goto(`${BASE}/agents`);
  for (const [label, path] of [["Overview", "/overview"], ["Bills", "/bills"], ["Findings", "/findings"], ["Money", "/money"], ["Agents", "/agents"]] as const) {
    await page.getByRole("navigation", { name: "Main" }).getByRole("link", { name: label }).click();
    await page.waitForURL(`**${path}`);
    assert.equal(await page.getByRole("navigation", { name: "Main" }).getByRole("link", { name: label }).getAttribute("aria-current"), "page", `${label} is not marked current`);
  }
}

const NO_RUN = {
  run: null,
  customer: null,
  humanActions: 0,
  approval: null,
  boardCards: [],
  findings: [],
  findingSites: {},
  actions: [],
  calls: [],
  ledger: [],
  sms: [],
  auditLog: [],
  auditTotal: 0,
  scheduledChecks: [],
};

assertNotSharedDb();
await insertSampleRun(db);
const browser = await chromium.launch();
try {
  const page = await (await signedInContext(browser, BASE, { viewport: VIEWPORT })).newPage();
  await checkLiveUpdates(page);
  await checkDarkTheme(page);
  await checkConnectionLoss(page);

  const fresh = await (await signedInContext(browser, BASE, { viewport: VIEWPORT })).newPage();
  await checkNoRun(fresh, JSON.stringify(NO_RUN));
  await checkStoppedRun(await (await signedInContext(browser, BASE, { viewport: VIEWPORT })).newPage());

  await checkNarrow(await (await signedInContext(browser, BASE, { viewport: { width: 390, height: 844 } })).newPage());
  await checkLanding(await (await signedInContext(browser, BASE, { viewport: VIEWPORT })).newPage(), "1920");
  await checkLanding(await (await signedInContext(browser, BASE, { viewport: { width: 390, height: 844 } })).newPage(), "390");
  await checkLandingNarrowest(await (await signedInContext(browser, BASE, { viewport: { width: 320, height: 640 } })).newPage());
  await checkLandingReducedMotionChange(await (await signedInContext(browser, BASE, { viewport: VIEWPORT })).newPage());
  await checkNav(await (await signedInContext(browser, BASE, { viewport: VIEWPORT })).newPage());
  console.info("dashboard-shell check passed");
} finally {
  await browser.close();
  // Leaves the sample as a fresh start, so a later look at the dashboard shows the pending state.
  await insertSampleRun(db);
  await db.$client.end();
}
