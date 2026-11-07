// Checks the panels-action acceptance list in a real browser at 1080p, against a running dashboard. Writes to your own database only.
// pnpm dev:dashboard must be running. Pass a folder to keep screenshots.
// pnpm exec tsx --env-file-if-exists=.env scripts/panels-action-check.ts
import assert from "node:assert/strict";
import { db } from "@bill-fighter/db/client";
import { DISCLOSURE_LINE } from "@bill-fighter/shared/disclosure";
import { type Browser, chromium, type Page } from "playwright";
import { assertNotSharedDb, insertSampleRun, SAMPLE_RUN_ID } from "../apps/dashboard/lib/sample-data.ts";

const BASE = "http://localhost:3000";
const VIEWPORT = { width: 1920, height: 1080 };
const MIN_FONT_PX = 22;
const screenshotDir = process.argv[2];

type Snapshot = { run: { id: string } | null; calls: unknown[]; humanActions: number; approval: { status: string; channel: string | null; approvedBy: string | null; actionIds: string[] } };

const AT = "2026-11-06T17:00:00.000Z";
const END = "2026-11-06T17:02:03.000Z";
const row = (role: string, kind: string, content: string) => ({ role, kind, content, at: AT });
const DISCLOSURE = row("agent", "speech", DISCLOSURE_LINE);
const MENU = row("provider", "speech", "For billing, press 2.");
const PRESS = row("agent", "keypress", "2");
const REFUSED = row("system", "refused", "Refused by code: alarm line +15550004008, not requested.");
const FALLBACK = row("system", "fallback", "Live call failed, so this call is simulated: the line did not answer");
// The exact rows from services/voice/src/live/caller/engine.ts on fleet/voice-live-caller.
const IN_PROGRESS = row("system", "status", "Live call in progress.");
const WITH_ID = row("system", "status", "Live call in progress. Retell call call_abc.");
const ENDED = row("system", "status", "Retell call call_abc ended: user_hangup.");
const FAILED = row("system", "status", "Live call failed: Retell call call_abc: the call ended with no ticket number: user_hangup");

const call = (id: string, mode: "sim" | "live", transcriptJson: unknown[], endedAt: string | null = null) => ({
  id,
  actionId: "sample-action-call",
  mode,
  toNumber: "+15550003333",
  startedAt: AT,
  endedAt,
  recordingUrl: null,
  transcriptJson,
  outcomeJson: null,
});

const shot = async (page: Page, name: string) => {
  if (screenshotDir) await page.screenshot({ path: `${screenshotDir}/${name}.png` });
};

const see = (page: Page, testId: string, text: string) => page.getByTestId(testId).filter({ hasText: text }).waitFor({ state: "attached", timeout: 5000 });
const live = async (page: Page) => (await (await page.request.get(`${BASE}/api/live`)).json()) as Snapshot;

// The server on port 3000 can use another database than this script, and a click acts on whichever run it shows.
async function insertAndRequireSampleRun(page: Page) {
  await insertSampleRun(db);
  assert.equal((await live(page)).run?.id, SAMPLE_RUN_ID, "the dashboard is not showing the sample run this script inserted, so nothing was clicked");
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
  const { scrollHeight, scrollWidth, tooSmall } = await page.evaluate<{ scrollHeight: number; scrollWidth: number; tooSmall: string[] }>(MEASURE);
  assert.ok(scrollHeight <= VIEWPORT.height, `${where}: page scrolls vertically, ${scrollHeight}px tall`);
  assert.ok(scrollWidth <= VIEWPORT.width, `${where}: page scrolls sideways, ${scrollWidth}px wide`);
  assert.deepEqual(tooSmall, [], `${where}: text under ${MIN_FONT_PX}px`);
}

async function checkApproveButton(page: Page) {
  await insertAndRequireSampleRun(page);
  await page.goto(BASE);
  await page.getByTestId("approve").waitFor({ timeout: 10000 });
  await page.evaluate("window.notReloaded = true");
  await checkFits(page, "pending");
  await shot(page, "approval-pending");
  const box = await page.getByTestId("approve").boundingBox();
  assert.ok(box && box.y + box.height <= VIEWPORT.height, "Approve must be on screen");

  // A real double click: the second one lands before the first has come back.
  await page.getByTestId("approve").dblclick();
  await see(page, "approval-decision", "Approved by Linda Park, on the dashboard");
  await see(page, "human-actions", "Human actions: 1");
  assert.equal(await page.getByTestId("approve").count(), 0, "no button once decided");

  const snapshot = await live(page);
  assert.equal(snapshot.humanActions, 1, "a double click is one approval");
  assert.equal(snapshot.approval.status, "approved");
  assert.equal(snapshot.approval.actionIds.length, 3, "the whole bundle");
  assert.equal(await page.evaluate("window.notReloaded"), true, "no page refresh");
  await checkFits(page, "approved");
  await shot(page, "approval-approved");

  // A YES after the button changes nothing.
  await page.getByTestId("sms-reply").fill("YES");
  await page.getByTestId("sms-reply").press("Enter");
  await page.locator('[data-sms="inbound"]').filter({ hasText: "YES" }).waitFor({ timeout: 5000 });
  const after = await live(page);
  assert.equal(after.humanActions, 1, "button plus SMS is still 1");
  assert.equal(after.approval.channel, "dashboard", "the first decision stays recorded");
}

async function checkYes(page: Page) {
  await insertAndRequireSampleRun(page);
  await page.goto(BASE);
  const reply = page.getByTestId("sms-reply");
  await reply.waitFor({ timeout: 10000 });

  await reply.fill("Not yet");
  await page.getByTestId("sms-send").click();
  await page.locator('[data-sms="inbound"]').filter({ hasText: "Not yet" }).waitFor({ timeout: 5000 });
  assert.equal((await live(page)).approval.status, "pending", "anything but YES approves nothing");
  await page.waitForFunction(`document.getElementById("sms-reply").value === ""`, undefined, { timeout: 5000 });

  // Typing through live updates: the poll must not take focus or the draft.
  await reply.focus();
  await page.keyboard.type("YE");
  await page.waitForTimeout(2500);
  assert.equal(await reply.inputValue(), "YE", "a live update keeps the draft");
  assert.equal(await page.evaluate("document.activeElement?.id"), "sms-reply", "a live update keeps focus");
  await page.keyboard.type("S");
  await page.keyboard.press("Enter");

  await see(page, "approval-decision", "Approved by Linda Park, by SMS");
  await see(page, "human-actions", "Human actions: 1");
  const snapshot = await live(page);
  assert.equal(snapshot.approval.channel, "sms");
  assert.equal(snapshot.approval.approvedBy, "Linda Park", "the approver is recorded");
  await checkFits(page, "approved by SMS");
  await shot(page, "phone-yes");
}

async function checkKeyboard(page: Page) {
  await insertAndRequireSampleRun(page);
  await page.goto(BASE);
  await page.getByTestId("approve").waitFor({ timeout: 10000 });
  let focused: string | null = null;
  for (let i = 0; i < 60 && focused !== "approve"; i++) {
    await page.keyboard.press("Tab");
    focused = await page.evaluate<string | null>("document.activeElement?.dataset?.testid ?? null");
  }
  assert.equal(focused, "approve", "Tab reaches Approve");
  for (let i = 0; i < 20 && focused !== "sms-reply"; i++) {
    await page.keyboard.press("Tab");
    focused = await page.evaluate<string | null>("document.activeElement?.dataset?.testid ?? null");
  }
  assert.equal(focused, "sms-reply", "Tab reaches the reply box");
  await page.getByTestId("approve").focus();
  await page.keyboard.press("Enter");
  await see(page, "approval-decision", "Approved by Linda Park");
}

/** Serves the real snapshot with calls swapped in, so no call row has to exist. Change `state.calls` to move on. */
async function fakeCalls(page: Page, state: { calls: unknown[] }) {
  await page.route("**/api/live", async (route) => {
    const body = (await (await route.fetch()).json()) as Snapshot;
    await route.fulfill({ contentType: "application/json", body: JSON.stringify({ ...body, calls: state.calls }) });
  });
}

// Records what would be said, and fails in the way asked for.
const speechStub = (mode: string) => `
  window.spoken = [];
  ${
    mode === "missing"
      ? "delete window.SpeechSynthesisUtterance; Object.defineProperty(window, 'speechSynthesis', { value: undefined });"
      : `window.SpeechSynthesisUtterance = class { constructor(text) { this.text = text; } };
         Object.defineProperty(window, 'speechSynthesis', { value: {
           cancel() {},
           speak(u) {
             ${mode === "throw" ? "throw new Error('blocked');" : ""}
             ${mode === "onerror" ? "setTimeout(() => u.onerror({ error: 'not-allowed' }));" : ""}
             window.spoken.push(u.text);
           },
         } });`
  }
`;

async function pageWith(browser: Browser, speech: string) {
  const page = await (await browser.newContext({ viewport: VIEWPORT })).newPage();
  await page.addInitScript({ content: speechStub(speech) });
  return page;
}

async function checkCallStates(browser: Browser) {
  const page = await pageWith(browser, "record");
  await insertAndRequireSampleRun(page);
  const state = { calls: [] as unknown[] };
  await fakeCalls(page, state);
  await page.goto(BASE);
  // Not "No calls yet": that also shows before the first snapshot, and rows in the first snapshot count as already said.
  await see(page, "customer", "Golden Gate Noodle Co.");

  // Sim, arriving while the page is open: the disclosure comes first, on screen and in the speech.
  state.calls = [call("sim-1", "sim", [DISCLOSURE])];
  await see(page, "call-mode", "sim");
  const firstRow = page.locator('[data-testid="call-transcript"] li').first();
  assert.equal(await firstRow.getAttribute("data-call-row"), "disclosure", "the disclosure is first");
  assert.ok((await firstRow.innerText()).includes("Disclosure"), "the highlight has a label, not only a colour");
  await page.waitForFunction("window.spoken.length === 1");
  assert.deepEqual(await page.evaluate("window.spoken"), [DISCLOSURE_LINE], "the disclosure is spoken first");

  state.calls = [call("sim-1", "sim", [DISCLOSURE, MENU, PRESS, REFUSED])];
  await page.locator('[data-call-row="refused"]').filter({ hasText: "System: Refused by code" }).waitFor({ timeout: 5000 });
  await page.locator('[data-call-row="keypress"]').filter({ hasText: "Pressed 2" }).waitFor({ timeout: 5000 });
  await page.waitForFunction("window.spoken.length === 2");
  assert.deepEqual(await page.evaluate("window.spoken"), [DISCLOSURE_LINE, MENU.content], "only speech is spoken, once each");
  await checkFits(page, "sim call");
  await shot(page, "call-sim");

  // Live in progress: a label and no status text.
  state.calls = [call("live-1", "live", [IN_PROGRESS, WITH_ID])];
  await see(page, "call-mode", "live");
  await see(page, "call-in-progress", "The transcript appears when the call ends");
  assert.equal((await page.locator("main").innerText()).includes("call_abc"), false, "no Retell id on screen");
  await checkFits(page, "live in progress");
  await shot(page, "call-live-progress");

  // Live ended: the whole transcript at once, unspoken, still with no Retell id.
  state.calls = [call("live-1", "live", [DISCLOSURE, MENU, PRESS, ENDED], END)];
  await page.locator('[data-call-row="disclosure"]').waitFor({ timeout: 5000 });
  await see(page, "call-timer", "2:03");
  assert.equal(await page.getByTestId("call-in-progress").count(), 0);
  assert.equal((await page.locator("main").innerText()).includes("call_abc"), false, "no Retell id on screen");
  assert.equal(await page.evaluate("window.spoken.length"), 2, "a finished live call is not read out");
  await shot(page, "call-live-done");

  // Fallback: two rows for the action. The sim one shows, labelled, and the attempt stays out.
  state.calls = [call("live-2", "live", [DISCLOSURE, row("provider", "speech", "PARTIAL ATTEMPT"), ENDED, FAILED], AT), call("sim-2", "sim", [DISCLOSURE, FALLBACK, MENU])];
  await see(page, "call-fallback", "Live call failed, so this call is simulated: the line did not answer");
  await see(page, "call-mode", "sim");
  assert.equal(await page.locator("[data-call]").count(), 1, "one call shown for one action");
  const fallbackText = await page.locator("main").innerText();
  assert.equal(fallbackText.includes("PARTIAL ATTEMPT"), false, "the failed attempt stays out");
  assert.equal(fallbackText.includes("call_abc"), false, "no Retell id on screen");
  assert.equal(await page.locator('[data-testid="call-transcript"] li').first().getAttribute("data-call-row"), "disclosure");
  await page.waitForFunction("window.spoken.length === 4");
  assert.deepEqual((await page.evaluate<string[]>("window.spoken")).slice(2), [DISCLOSURE_LINE, MENU.content], "the fallback speaks from its disclosure, without the label");
  await checkFits(page, "fallback");
  await shot(page, "call-fallback");

  // A failed live row and no sim row: the reason, and still no partial transcript.
  state.calls = [call("live-3", "live", [DISCLOSURE, row("provider", "speech", "PARTIAL ATTEMPT"), ENDED, FAILED], AT)];
  await see(page, "call-failed", "Live call failed");
  assert.equal(await page.locator('[data-testid="call-transcript"] li').count(), 0);
  assert.equal((await page.locator("main").innerText()).includes("PARTIAL ATTEMPT"), false);
  await shot(page, "call-failed");

  // Dark.
  await page.getByTestId("theme-toggle").click();
  state.calls = [call("sim-1", "sim", [DISCLOSURE, FALLBACK, MENU, PRESS, REFUSED])];
  await page.locator('[data-call-row="refused"]').waitFor({ timeout: 5000 });
  await checkFits(page, "dark");
  await shot(page, "call-dark");
  await page.getByTestId("theme-toggle").click();
  await page.context().close();
}

async function checkSpeechFailures(browser: Browser) {
  for (const mode of ["missing", "throw", "onerror"]) {
    const page = await pageWith(browser, mode);
    const state = { calls: [] as unknown[] };
    await fakeCalls(page, state);
    await page.goto(BASE);
    await see(page, "customer", "Golden Gate Noodle Co.");
    state.calls = [call("sim-1", "sim", [DISCLOSURE, MENU])];
    await page.locator('[data-call-row="disclosure"]').waitFor({ timeout: 5000 });
    await see(page, "speech-unavailable", "Browser speech unavailable. Transcript only.");
    state.calls = [call("sim-1", "sim", [DISCLOSURE, MENU, PRESS])];
    await page.locator('[data-call-row="keypress"]').waitFor({ timeout: 5000 });
    await page.context().close();
  }
}

async function checkNaive(browser: Browser) {
  const page = await (await browser.newContext({ viewport: VIEWPORT })).newPage();
  await page.route("**/api/live", async (route) => {
    const body = (await (await route.fetch()).json()) as { run: object };
    await route.fulfill({ contentType: "application/json", body: JSON.stringify({ ...body, run: { ...body.run, platform: "naive" } }) });
  });
  await page.goto(BASE);
  await see(page, "phone-naive", "On naïve the request goes by email");
  assert.equal(await page.getByTestId("sms-reply").count(), 0, "no reply box on naïve");
  assert.equal(await page.getByTestId("approve").count(), 1, "Approve is there in both modes");
  await page.context().close();
}

async function checkRoutes(page: Page) {
  const send = (path: string, data: unknown, headers: Record<string, string> = {}) => page.request.post(`${BASE}${path}`, { data, headers });
  assert.equal((await send("/api/approve", "{not json", { "Content-Type": "application/json" })).status(), 400, "malformed JSON");
  assert.equal((await send("/api/approve", { runId: 7 })).status(), 400, "bad body");
  assert.equal((await send("/api/sms", { runId: SAMPLE_RUN_ID, body: "   " })).status(), 400, "empty text");
  assert.equal((await send("/api/approve", { runId: "no-such-run" })).status(), 404, "unknown run");
  assert.equal((await send("/api/approve", { runId: SAMPLE_RUN_ID }, { Origin: "https://evil.example" })).status(), 403, "another site");
  assert.equal((await send("/api/sms", { runId: SAMPLE_RUN_ID, body: "YES" }, { Origin: "https://evil.example" })).status(), 403, "another site, SMS");
  assert.equal((await page.request.get(`${BASE}/api/approve`)).status(), 405, "POST only");
  assert.equal((await live(page)).approval.status, "pending", "no refused request approved anything");
}

assertNotSharedDb();
await insertSampleRun(db);
const browser = await chromium.launch();
try {
  const fresh = async () => (await browser.newContext({ viewport: VIEWPORT })).newPage();
  await checkRoutes(await fresh());
  await checkApproveButton(await fresh());
  await checkYes(await fresh());
  await checkKeyboard(await fresh());
  await checkCallStates(browser);
  await checkSpeechFailures(browser);
  await insertSampleRun(db);
  await checkNaive(browser);
  console.info("panels-action check passed");
} finally {
  await browser.close();
  // Leaves the sample as a fresh start.
  await insertSampleRun(db);
  await db.$client.end();
}
