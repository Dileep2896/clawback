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
const MIN_FONT_PX = 12;
const screenshotDir = process.argv[2];

const shot = async (page: Page, name: string) => {
  if (screenshotDir) await page.screenshot({ path: `${screenshotDir}/${name}.png` });
};

const seeText = (page: Page, testId: string, text: string) =>
  page.getByTestId(testId).filter({ hasText: text }).waitFor({ state: "attached", timeout: 5000 });

// Browser code goes in as strings, because the root tsconfig has no DOM types and this is the only file that wants them.
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
  await seeText(page, "run-status", "Running");
  await seeText(page, "run-cost", "$1.24");
  await seeText(page, "run-cost-note", "model cost added at the end");
  await seeText(page, "demo-data", "Demo data");
  await seeText(page, "human-actions", "0 human actions");
  await checkFitsOneScreen(page, "light");
  await shot(page, "light-pending");

  await decideApproval(db, { runId: SAMPLE_RUN_ID, status: "approved", channel: "dashboard", approvedBy: "Linda Park" });
  await seeText(page, "human-actions", "1 human action");

  // The owner also texts YES: the same approval, not a second human action.
  const second = await decideApproval(db, { runId: SAMPLE_RUN_ID, status: "approved", channel: "sms", approvedBy: "Linda Park" });
  assert.equal(second.channel, "dashboard", "the first decision must win");
  await page.waitForTimeout(2500);
  await seeText(page, "human-actions", "1 human action");

  await updateSampleRun(db, { costUsd: 2.5, status: "over_budget" });
  await seeText(page, "run-cost", "$2.50");
  await seeText(page, "run-status", "Over budget");
  assert.equal(await page.getByTestId("run-cost-note").count(), 0, "the note is only for a running run");

  // The longest message there is, so this also checks that it fits on the one screen.
  await db.insert(boardCards).values({ id: "sample-stop", runId: SAMPLE_RUN_ID, agent: RUN_CARD_AGENT, title: stopMessage("over_budget"), status: "blocked" });
  await seeText(page, "run-problem", "is an estimate");
  await checkFitsOneScreen(page, "light, stopped");

  assert.equal(await page.evaluate("window.notReloaded"), true, "values must change with no page refresh");
  await shot(page, "light-approved");
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
  await seeText(page, "no-run", "Waiting for a run. Start one with pnpm demo:start.");
  assert.equal(await page.getByTestId("human-actions").count(), 0, "no run figures before any run");
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
  await seeText(page, "human-actions", "0 human actions");
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

// The hero: every piece of text in the app frame sits inside its own card, or the frame when it is in no card (the frame
// clips with overflow-hidden). Text cut short on purpose with an ellipsis (the window bar's breadcrumb) is fine.
const CLIPPED_IN_HERO = `(() => {
  const figure = document.querySelector("figure");
  const clipped = [];
  const walker = document.createTreeWalker(figure, NodeFilter.SHOW_TEXT);
  while (walker.nextNode()) {
    const node = walker.currentNode;
    const parent = node.parentElement;
    if (!node.textContent.trim() || parent.closest(".sr-only") || getComputedStyle(parent).textOverflow === "ellipsis") continue;
    const range = document.createRange();
    range.selectNodeContents(node);
    const r = range.getBoundingClientRect();
    if (!r.width && !r.height) continue; // not laid out: hidden at this width
    const box = (parent.closest("figure [class*='rounded-[10px]']") ?? figure).getBoundingClientRect();
    if (r.left < box.left - 0.5 || r.right > box.right + 0.5) clipped.push(node.textContent.trim());
  }
  return clipped;
})()`;
// Below the hero: every figure tile (the counter strip, the market figures) holds its whole value.
const SPILLS_FROM_FIGURES = `[...document.querySelectorAll("main dl > div")].filter((cell) => {
  const box = cell.getBoundingClientRect();
  const walker = document.createTreeWalker(cell, NodeFilter.SHOW_TEXT);
  while (walker.nextNode()) {
    if (!walker.currentNode.textContent.trim() || walker.currentNode.parentElement.closest(".sr-only")) continue;
    const range = document.createRange();
    range.selectNodeContents(walker.currentNode);
    const r = range.getBoundingClientRect();
    if (r.left < box.left - 0.5 || r.right > box.right + 0.5) return true;
  }
  return false;
}).map((cell) => cell.textContent.trim())`;
async function checkLandingNarrowest(page: Page) {
  await page.goto(BASE);
  await page.getByText("Linda Park replied YES", { exact: true }).waitFor();
  assert.deepEqual(await page.evaluate<string[]>(CLIPPED_IN_HERO), [], "landing 320: hero text clipped");
  assert.deepEqual(await page.evaluate<string[]>(SPILLS_FROM_FIGURES), [], "landing 320: figure spills out of its tile");
  const { scrollWidth, innerWidth } = await page.evaluate<PageMeasure>(MEASURE_PAGE);
  assert.ok(scrollWidth <= innerWidth, `landing 320: page scrolls sideways, ${scrollWidth}px wide in ${innerWidth}px`);
  for (const id of ["log-in", "get-started"]) {
    const box = await page.getByTestId(id).boundingBox();
    assert.ok(box && box.x >= 0 && box.x + box.width <= innerWidth, `landing 320: ${id} is cut off`);
  }
  if (screenshotDir) await page.screenshot({ path: `${screenshotDir}/landing-320.png` });
}

// The hero at 1024px, where the app frame shows its sidebar and agents beside a narrow Overview: no tile spills.
async function checkLanding1024(page: Page) {
  await page.goto(BASE);
  await page.getByText("Linda Park replied YES", { exact: true }).waitFor();
  assert.deepEqual(await page.evaluate<string[]>(CLIPPED_IN_HERO), [], "landing 1024: hero text spills out of its card");
  if (screenshotDir) await page.locator("figure").screenshot({ path: `${screenshotDir}/landing-1024.png` });
}

// The hero's replay: it moves a cursor through the agents' feed; turning reduced motion on mid-replay stops it on the
// finished feed (no cursor, every line whole) and takes the Pause button away.
const FEED_STATE = `[document.querySelectorAll("figure .live-pulse").length, document.querySelector("figure ol").innerText]`;
async function checkLandingReducedMotionChange(page: Page) {
  await page.goto(BASE);
  const finished = await page.evaluate<[number, string]>(FEED_STATE);
  assert.equal(finished[0], 0, "landing: the hero does not start on the finished feed");
  const pause = page.getByRole("button", { name: "Pause the agents’ replay" });
  await pause.waitFor();
  await page.locator("figure .live-pulse").waitFor({ timeout: 5000 });
  await page.emulateMedia({ reducedMotion: "reduce" });
  await page.locator("figure .live-pulse").waitFor({ state: "detached", timeout: 2000 });
  assert.equal(await pause.isVisible(), false, "landing: Pause still shown under reduced motion");
  const still = await page.evaluate<[number, string]>(FEED_STATE);
  await page.waitForTimeout(1500);
  assert.deepEqual(await page.evaluate<[number, string]>(FEED_STATE), still, "landing: the replay still moves under reduced motion");
  assert.equal(still[1], finished[1], "landing: reduced motion does not show the finished feed");
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
  await checkConnectionLoss(page);

  const fresh = await (await signedInContext(browser, BASE, { viewport: VIEWPORT })).newPage();
  await checkNoRun(fresh, JSON.stringify(NO_RUN));
  await checkStoppedRun(await (await signedInContext(browser, BASE, { viewport: VIEWPORT })).newPage());

  await checkNarrow(await (await signedInContext(browser, BASE, { viewport: { width: 390, height: 844 } })).newPage());
  await checkLanding(await (await signedInContext(browser, BASE, { viewport: VIEWPORT })).newPage(), "1920");
  await checkLanding(await (await signedInContext(browser, BASE, { viewport: { width: 390, height: 844 } })).newPage(), "390");
  await checkLandingNarrowest(await (await signedInContext(browser, BASE, { viewport: { width: 320, height: 640 } })).newPage());
  await checkLanding1024(await (await signedInContext(browser, BASE, { viewport: { width: 1024, height: 768 } })).newPage());
  await checkLandingReducedMotionChange(await (await signedInContext(browser, BASE, { viewport: VIEWPORT })).newPage());
  await checkNav(await (await signedInContext(browser, BASE, { viewport: VIEWPORT })).newPage());
  console.info("dashboard-shell check passed");
} finally {
  await browser.close();
  // Leaves the sample as a fresh start, so a later look at the dashboard shows the pending state.
  await insertSampleRun(db);
  await db.$client.end();
}
