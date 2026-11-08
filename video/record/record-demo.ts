// Records the demo video's one take (.fleet-lane brief, docs/plan/demo-video.md) as CDP screencast frames plus an event log.
// Before the take, not captured: Linda signs up, connects BayCurrent, starts the audit and waits at approval in her own context.
// The take: landing hero, sample business signs up and uploads its bill, cut to Linda's Overview, Approve, /agents to Success,
// the meter finding's kWh chart, Overview, Money. A copy of scripts/rehearse-stage.ts's flow, not an import (it has no exports).
// Run from the repo root after pnpm demo:reset, with dashboard, portal and webhooks up:
// pnpm exec tsx --env-file-if-exists=.env video/record/record-demo.ts [--live]
// --live needs VOICE_MODE=live here and on the webhook process, and places one real call. Writes gitignored video/out/.
import assert from "node:assert/strict";
import { mkdirSync, rmSync, writeFileSync } from "node:fs";
import { join } from "node:path";
import { CUSTOMER } from "@bill-fighter/db/seed/customer";
import { type BrowserContext, chromium, type Locator, type Page } from "playwright";

const BASE = process.env.DASHBOARD_URL ?? "http://localhost:3000";
const OUT = "video/out";
const FRAMES = join(OUT, "frames");
const live = process.argv.includes("--live");
const SAMPLE_BILL = "data/sample-bills/mission-dumplings-baycurrent-2026-09.pdf";
const LINDA = { name: CUSTOMER.contactName, company: CUSTOMER.name, email: CUSTOMER.contactEmail, password: "noodles-on-camera" };
const EXPECTED = { "overview-refund": "$12,606.06", "overview-savings": "$18,319.32", "overview-fee": "− $9,277.61" };
const TYPE_DELAY_MS = 120;
const THINK_MS = 900;

const mode = process.env.VOICE_MODE;
if (mode !== (live ? "live" : "sim")) throw new Error(`VOICE_MODE is "${mode}"; record in sim, or pass --live with VOICE_MODE=live`);

type Box = { x: number; y: number; w: number; h: number };
const frames: { file: string; ts: number }[] = [];
const events: { t: number; kind: string; label?: string; box?: Box }[] = [];
let origin = 0; // epoch ms of the first frame; every t is measured from it

const type = (page: Page, label: string, text: string) => page.getByLabel(label).pressSequentially(text, { delay: TYPE_DELAY_MS });
const think = (page: Page) => page.waitForTimeout(THINK_MS);
const boxOf = async (target: Locator): Promise<Box | undefined> => {
  const b = await target.boundingBox();
  return b ? { x: b.x, y: b.y, w: b.width, h: b.height } : undefined;
};
const log = async (kind: string, target?: Locator, label?: string) => {
  if (!origin) return; // before the take: nothing is filmed yet
  events.push({ t: Date.now() - origin, kind, label, box: target && (await boxOf(target)) });
  console.info(`${((Date.now() - origin) / 1000).toFixed(1).padStart(7)}s  ${kind}${label ? ` ${label}` : ""}`);
};
const click = async (kind: string, target: Locator) => {
  await target.scrollIntoViewIfNeeded();
  await log(kind, target);
  await target.click();
};
type Live = { run: { status: string } | null; calls: { endedAt: string | null }[] };
const liveOf = async (page: Page) => (await (await page.request.get(`${BASE}/api/live`)).json()) as Live;
const runStatus = async (page: Page) => (await liveOf(page)).run?.status;

// Screencast frames only arrive on repaint; each carries its own capture time and must be acked.
async function capture(page: Page) {
  const cdp = await page.context().newCDPSession(page);
  cdp.on("Page.screencastFrame", ({ data, metadata, sessionId }) => {
    const ts = (metadata.timestamp ?? Date.now() / 1000) * 1000;
    if (!origin) origin = ts;
    const file = `${String(frames.length).padStart(6, "0")}.jpg`;
    writeFileSync(join(FRAMES, file), Buffer.from(data, "base64"));
    frames.push({ file, ts });
    void cdp.send("Page.screencastFrameAck", { sessionId }).catch(() => {});
  });
  await cdp.send("Page.startScreencast", { format: "jpeg", quality: 92, maxWidth: 3840, maxHeight: 2160 });
  return () => cdp.send("Page.stopScreencast");
}

async function signUp(page: Page, who: typeof LINDA, filmed: boolean) {
  await page.goto(BASE);
  await page.evaluate(() => document.fonts.ready);
  if (filmed) {
    // Long enough to sit under the first voiceover line (V1, 13.4 s): the hero, a slow look at the live run, back up.
    await log("landing");
    await page.waitForTimeout(5000);
    await page.evaluate(() => window.scrollTo({ top: 640, behavior: "smooth" }));
    await page.waitForTimeout(6000);
    await page.evaluate(() => window.scrollTo({ top: 0, behavior: "smooth" }));
    await page.waitForTimeout(2500);
  }
  await click("get-started", page.getByTestId("get-started"));
  await page.waitForURL(`${BASE}/signup`);
  if (filmed) await log("signup-form", page.getByTestId("signup-form"));
  await type(page, "Your name", who.name);
  await type(page, "Company", who.company);
  await type(page, "Work email", who.email);
  await type(page, "Password", who.password);
  await think(page);
  await click("create-account", page.getByRole("button", { name: "Create account" }));
  await page.waitForURL(`${BASE}/onboarding`);
}

rmSync(OUT, { recursive: true, force: true });
mkdirSync(FRAMES, { recursive: true });
// Without the flag, headless screencast frames come at CSS size (1920x1080) even with deviceScaleFactor 2.
const browser = await chromium.launch({ args: ["--mute-audio", "--force-device-scale-factor=2"] });
const fresh = async (): Promise<[BrowserContext, Page]> => {
  const context = await browser.newContext({ viewport: { width: 1920, height: 1080 }, deviceScaleFactor: 2, locale: "en-US", reducedMotion: "no-preference" });
  return [context, await context.newPage()];
};
try {
  // Before the take: Linda's run waits at approval in her own signed-in context.
  const [, linda] = await fresh();
  await signUp(linda, LINDA, false);
  await linda.getByTestId("demo-login").click();
  await linda.getByTestId("connected-list").getByText("BayCurrent Electric connected").waitFor({ timeout: 15_000 });
  await linda.getByTestId("start-audit").click();
  await linda.waitForURL(`${BASE}/overview`, { timeout: 30_000 });
  console.info("before the take: Linda's audit started");
  await linda.getByTestId("overview-approval").waitFor({ timeout: 20 * 60_000 });
  console.info("before the take: waiting at approval");

  // The take, part 1: the sample business.
  const [, sam] = await fresh();
  await sam.goto(BASE);
  await sam.evaluate(() => document.fonts.ready);
  const stopSam = await capture(sam);
  await sam.waitForTimeout(500);
  await signUp(sam, { name: "Sam Lee", company: "Mission Dumplings", email: `sam+${Date.now()}@missiondumplings.example`, password: "dumplings-2026" }, true);
  await think(sam);
  await click("upload-tab", sam.getByTestId("upload-tab"));
  await think(sam);
  await log("upload", sam.getByTestId("upload-input"));
  await sam.getByTestId("upload-input").setInputFiles(SAMPLE_BILL);
  await sam.locator('[data-status="saved"]').waitFor({ timeout: 30_000 });
  await log("bill-saved", sam.getByTestId("upload-list"));
  await sam.waitForTimeout(2500);
  await stopSam();

  // Part 2: cut to Linda, already signed in.
  await linda.reload();
  await linda.getByTestId("overview-approval").waitFor();
  await linda.evaluate(() => document.fonts.ready);
  const stopLinda = await capture(linda);
  await log("cut-to-linda");

  // The Auditor's evidence, before the approval as in the story: the board so far, then the meter finding's kWh chart.
  await linda.goto(`${BASE}/agents`);
  await linda.getByText("No cards yet").waitFor({ state: "hidden" });
  await log("agents-before");
  await linda.waitForTimeout(6000);
  const meter = linda.locator("[data-finding]", { hasText: "Refund" }).first();
  await click("finding", meter);
  await linda.getByTestId("kwh-plot").waitFor();
  await linda.waitForTimeout(800);
  await log("kwh-plot", linda.getByTestId("kwh-plot"));
  await linda.waitForTimeout(12_000);
  await click("evidence-close", linda.getByTestId("evidence-close"));
  await think(linda);
  await linda.goto(`${BASE}/overview`);
  await linda.getByTestId("overview-approval").waitFor();
  await log("approval", linda.getByTestId("overview-approval"));
  await linda.waitForTimeout(3000);
  await click("approve", linda.getByTestId("overview-approve"));
  await linda.getByTestId("overview-decision").waitFor({ timeout: 15_000 });
  await log("approved", linda.getByTestId("overview-decision"));
  await think(linda);
  await linda.goto(`${BASE}/agents`);
  await linda.getByText("No cards yet").waitFor({ state: "hidden" });
  await log("agents");

  const callPanel = linda.locator("section", { has: linda.getByRole("heading", { name: "Call", exact: true }) });
  const deadline = Date.now() + 8 * 60_000;
  let callSeen = false;
  let callEnded = false;
  // The feed, not the panel: a live call shows no transcript until it ends, a sim call streams one.
  let live: Live;
  while ((live = await liveOf(linda)).run?.status === "running") {
    if (Date.now() > deadline) throw new Error("Run still running 8 minutes after Approve; is the webhook process alive?");
    if (await linda.getByTestId("speech-unavailable").isVisible()) throw new Error("Speech-unavailable text on screen");
    if (!callSeen && live.calls.length) {
      callSeen = true;
      await log("call-start", callPanel);
    }
    if (callSeen && !callEnded && live.calls.every((call) => call.endedAt)) {
      callEnded = true;
      await log("call-end", callPanel);
    }
    await linda.waitForTimeout(500);
  }
  const status = await runStatus(linda);
  await log("run-end", undefined, status);
  await linda.waitForTimeout(3000);

  await linda.goto(`${BASE}/overview`);
  await linda.getByTestId("overview-run-status").waitFor();
  await log("overview-refund", linda.getByTestId("overview-refund"));
  await log("overview-savings", linda.getByTestId("overview-savings"));
  // Under the money line (V8, 12 s).
  await linda.waitForTimeout(13_000);
  const seen = Object.fromEntries(await Promise.all(Object.keys(EXPECTED).map(async (id) => [id, await linda.getByTestId(id).innerText()])));
  await linda.goto(`${BASE}/money`);
  await linda.locator("[data-ledger-row]").first().waitFor();
  await log("money", linda.getByTestId("money-refund"));
  await linda.waitForTimeout(4000);
  await stopLinda();

  assert.equal(await linda.getByTestId("replay-banner").count(), 0, "a REPLAY banner was on screen");
  assert.equal(status, "success");
  assert.deepEqual(seen, EXPECTED);
  console.info(`Take done: ${frames.length} frames, ${((frames.at(-1)!.ts - origin) / 1000).toFixed(1)} s, Overview ${JSON.stringify(seen)}`);
} finally {
  await browser.close();
  // ffmpeg's concat demuxer: each frame lasts until the next one arrives.
  const concat = frames.map((f, i) => `file 'frames/${f.file}'\nduration ${(((frames[i + 1]?.ts ?? f.ts + 1000 / 60) - f.ts) / 1000).toFixed(4)}`);
  if (frames.length) concat.push(`file 'frames/${frames.at(-1)!.file}'`);
  writeFileSync(join(OUT, "frames.ffconcat"), `ffconcat version 1.0\n${concat.join("\n")}\n`);
  writeFileSync(join(OUT, "events.json"), JSON.stringify({ dpr: 2, events }, null, 2));
}
