// Checks the panels-work acceptance list in a real browser at 1080p, against a running dashboard. Writes to your own database only.
// pnpm dev:dashboard must be running. Pass a folder to keep screenshots.
// pnpm exec tsx --env-file-if-exists=.env scripts/panels-work-check.ts
import assert from "node:assert/strict";
import { signedInContext } from "./dashboard-session.ts";
import { db } from "@bill-fighter/db/client";
import { chromium, type Page } from "playwright";
import { assertNotSharedDb, insertSampleRun, moveSampleCard } from "../apps/dashboard/lib/sample-data.ts";

const BASE = process.env.DASHBOARD_URL ?? "http://localhost:3000";
const VIEWPORT = { width: 1920, height: 1080 };
const MIN_FONT_PX = 12;
const METER = "sample-finding-meter";
const RATE = "sample-finding-rate";
const CARD = "sample-card-filer";
const DRAWER = '[data-testid="evidence-drawer"]';
const screenshotDir = process.argv[2];

type Finding = { id: string; evidenceJson: unknown };
type Measure = { scrollHeight: number; scrollWidth: number; tooSmall: string[] };

const shot = async (page: Page, name: string) => {
  if (screenshotDir) await page.screenshot({ path: `${screenshotDir}/${name}.png` });
};

const numbersIn = (text: string) => (text.match(/\d[\d,]*(?:\.\d+)?/g) ?? []).map((token) => Number(token.replaceAll(",", "")));

/** Every number a drawer may show: each value as stored, a cents value as dollars, and the digits inside text such as a month or a meter. */
function evidenceNumbers(value: unknown, found = new Set<number>()) {
  if (typeof value === "number") {
    found.add(Math.abs(value));
    found.add(Math.abs(value) / 100);
  } else if (typeof value === "string") {
    for (const n of numbersIn(value)) found.add(n);
  } else if (value && typeof value === "object") {
    for (const child of Object.values(value)) evidenceNumbers(child, found);
  }
  return found;
}

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
  const { scrollHeight, scrollWidth, tooSmall } = await page.evaluate<Measure>(MEASURE);
  assert.ok(scrollHeight <= VIEWPORT.height, `${where}: page scrolls vertically, ${scrollHeight}px tall`);
  assert.ok(scrollWidth <= VIEWPORT.width, `${where}: page scrolls sideways, ${scrollWidth}px wide`);
  assert.deepEqual(tooSmall, [], `${where}: text under ${MIN_FONT_PX}px`);
}

// The filer's timeline row follows its card: todo is up next, doing is working, blocked is stopped, done is done.
const seeFilerAs = (page: Page, state: string) => page.locator(`[data-agent-row="filer"][data-state="${state}"]`).waitFor({ state: "attached", timeout: 5000 });
// The sample waits on its approval; pinning the auditor's row puts the findings in the Now pane.
const showFindings = async (page: Page) => {
  await page.locator('[data-agent-row="auditor"]').click();
  await page.locator('[data-moment="findings"]').waitFor({ timeout: 5000 });
};

async function checkTimelineMovesLive(page: Page) {
  await page.goto(`${BASE}/agents`);
  await seeFilerAs(page, "next");
  await page.evaluate("window.notReloaded = true");
  await shot(page, "timeline-start");

  await moveSampleCard(db, CARD, "doing");
  await seeFilerAs(page, "working");

  await moveSampleCard(db, CARD, "blocked");
  await seeFilerAs(page, "failed");
  await shot(page, "timeline-blocked");

  await moveSampleCard(db, CARD, "done");
  await seeFilerAs(page, "done");

  assert.equal(await page.evaluate("window.notReloaded"), true, "the timeline must move with no page refresh");
}

async function liveFindings(page: Page) {
  const response = await page.request.get(`${BASE}/api/live`);
  return ((await response.json()) as { findings: Finding[] }).findings;
}

async function checkDrawerNumbersTrace(page: Page) {
  const findings = await liveFindings(page);
  assert.ok(findings.length > 0, "the sample has findings");
  for (const finding of findings) {
    await page.locator(`[data-finding="${finding.id}"]`).click();
    const sections = await page.locator(`${DRAWER} [data-evidence]`).allInnerTexts();
    assert.ok(sections.length > 0, `${finding.id}: the drawer has evidence sections`);
    const allowed = evidenceNumbers(finding.evidenceJson);
    const shown = numbersIn(sections.join(" "));
    assert.ok(shown.length > 0, `${finding.id}: the evidence sections show numbers`);
    for (const value of shown) assert.ok(allowed.has(value), `${finding.id}: ${value} is not in evidence_json`);
    await page.keyboard.press("Escape");
    await page.locator(DRAWER).waitFor({ state: "detached" });
  }
}

const barHeight = (month: string, series: string) =>
  `document.querySelector('dialog [data-chart-month="${month}"] [data-series="${series}"]').getBoundingClientRect().height`;

async function checkFremontChart(page: Page) {
  await page.locator(`[data-finding="${METER}"]`).click();
  await page.locator(`${DRAWER} [data-chart-month="2025-09"] [data-testid="swap-marker"]`).waitFor({ timeout: 5000 });
  assert.equal(await page.locator(DRAWER).getByTestId("swap-marker").count(), 1, "one swap marker");

  const heights = async (month: string) => ({
    billed: await page.evaluate<number>(barHeight(month, "billed")),
    real: await page.evaluate<number>(barHeight(month, "real")),
  });
  const before = await heights("2025-08");
  const after = await heights("2025-09");
  const later = await heights("2026-08");
  assert.ok(Math.abs(before.billed / before.real - 1) < 0.01, "billed matches real before the swap");
  assert.ok(Math.abs(after.billed / after.real - 2) < 0.02, "billed jumps to twice real at the swap");
  assert.ok(Math.abs(later.billed / later.real - 2) < 0.02, "billed stays at twice real after the swap");
  assert.ok(after.billed > before.billed * 1.8, "the billed bar itself jumps at the swap");

  await checkFits(page, "meter drawer, light");
  await shot(page, "drawer-meter-light");
  await page.keyboard.press("Escape");
  await page.locator(DRAWER).waitFor({ state: "detached" });
}

async function checkRateTable(page: Page) {
  await page.locator(`[data-finding="${RATE}"]`).click();
  await page.locator(DRAWER).getByText("B-6 (proposed)").waitFor({ timeout: 5000 });
  await page.locator(DRAWER).getByText("B-10 (current)").waitFor({ timeout: 5000 });
  await checkFits(page, "rate drawer");
  await shot(page, "drawer-rate-light");
  await page.keyboard.press("Escape");
  await page.locator(DRAWER).waitFor({ state: "detached" });
}

const ACTIVE_FINDING = "document.activeElement?.dataset?.finding ?? null";
const FOCUS_IN_DRAWER = "!!document.activeElement?.closest('dialog')";
// The dialog sits inside main in the DOM, so being in main only counts when outside the dialog.
const FOCUS_IN_PAGE = "!!document.activeElement?.closest('main, header') && !document.activeElement?.closest('dialog')";

async function checkKeyboard(page: Page) {
  await page.goto(`${BASE}/agents`);
  await showFindings(page);
  await page.locator(`[data-finding="${METER}"]`).waitFor();
  let focused: string | null = null;
  for (let i = 0; i < 40 && !focused; i++) {
    await page.keyboard.press("Tab");
    focused = await page.evaluate<string | null>(ACTIVE_FINDING);
  }
  assert.ok(focused, "Tab reaches a finding");

  await page.keyboard.press("Enter");
  await page.locator(DRAWER).waitFor({ timeout: 5000 });
  assert.equal(await page.evaluate(FOCUS_IN_DRAWER), true, "opening moves focus into the drawer");

  for (let i = 0; i < 3; i++) {
    await page.keyboard.press("Tab");
    assert.equal(await page.evaluate(FOCUS_IN_PAGE), false, "Tab stays out of the page behind the drawer");
  }

  await page.keyboard.press("Escape");
  await page.locator(DRAWER).waitFor({ state: "detached" });
  assert.equal(await page.evaluate(ACTIVE_FINDING), focused, "Esc returns focus to the finding that opened it");

  await page.keyboard.press("Enter");
  await page.getByTestId("evidence-close").focus();
  await page.keyboard.press("Enter");
  await page.locator(DRAWER).waitFor({ state: "detached" });
  assert.equal(await page.evaluate(ACTIVE_FINDING), focused, "the Close button also returns focus");
}

async function checkDrawerStaysOpenOnLiveData(page: Page) {
  await page.goto(`${BASE}/agents`);
  await showFindings(page);
  await page.locator(`[data-finding="${METER}"]`).click();
  await page.locator(DRAWER).waitFor({ timeout: 5000 });
  await moveSampleCard(db, CARD, "doing");
  await seeFilerAs(page, "working");
  assert.equal(await page.locator(DRAWER).count(), 1, "a live update must not close the drawer");
  await page.keyboard.press("Escape");
  await page.locator(DRAWER).waitFor({ state: "detached" });
}

async function checkUnreadableEvidence(page: Page) {
  const live = (await (await page.request.get(`${BASE}/api/live`)).json()) as { findings: { id: string; evidenceJson: { detail: unknown } }[] };
  for (const finding of live.findings) finding.evidenceJson.detail = {};
  await page.route("**/api/live", (route) => route.fulfill({ contentType: "application/json", body: JSON.stringify(live) }));
  await page.goto(`${BASE}/agents`);
  await showFindings(page);
  await page.locator(`[data-finding="${METER}"]`).click();
  await page.getByTestId("evidence-unreadable").waitFor({ timeout: 5000 });
  assert.equal((await page.locator(DRAWER).innerText()).includes("NaN"), false, "never show NaN");
  await page.keyboard.press("Escape");
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
  await page.getByTestId("no-run").waitFor({ timeout: 5000 });
  assert.equal(await page.getByText(/\bNo [a-z ]+ yet\b/).count(), 0, "no empty panels, only the one waiting line");
  await checkFits(page, "no run");
}

assertNotSharedDb();
await insertSampleRun(db);
const browser = await chromium.launch();
try {
  const page = await (await signedInContext(browser, BASE, { viewport: VIEWPORT })).newPage();
  await checkTimelineMovesLive(page);
  await checkFits(page, "closed");
  await showFindings(page);
  await checkDrawerNumbersTrace(page);
  await checkFremontChart(page);
  await checkRateTable(page);
  await checkKeyboard(page);
  await insertSampleRun(db);
  await checkDrawerStaysOpenOnLiveData(page);

  await checkUnreadableEvidence(await (await signedInContext(browser, BASE, { viewport: VIEWPORT })).newPage());
  await checkEmpty(await (await signedInContext(browser, BASE, { viewport: VIEWPORT })).newPage());
  console.info("panels-work check passed");
} finally {
  await browser.close();
  // Leaves the sample as a fresh start.
  await insertSampleRun(db);
  await db.$client.end();
}
