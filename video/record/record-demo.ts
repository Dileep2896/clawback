// Records the demo video's one take (.fleet-lane brief, docs/plan/demo-video.md) as CDP screencast frames plus an event log.
// Before the take, not captured: Linda signs up, connects BayCurrent, starts the audit and waits at approval in her own context.
// The take: landing hero, sample business signs up and uploads its bill, cut to Linda on /agents: the Collector, the Auditor's
// kWh chart, Approve in the amber card, the call in the Now pane to Success, then Findings, Overview, Money. A copy of scripts/rehearse-stage.ts's flow, not an import (it has no exports).
// Paced to the voiceover (video/src/vo-words.json): each step happens on its word, and every element the voice names is logged
// with its box before the edit highlights it (scenes.json; syncProblems checks it).
// Run from the repo root after pnpm demo:reset, with dashboard, portal and webhooks up:
// pnpm exec tsx --env-file-if-exists=.env video/record/record-demo.ts [--live]
// --live needs VOICE_MODE=live here and on the webhook process, and places one real call. Writes a new gitignored video/out/take-<time>/.
import assert from "node:assert/strict";
import { mkdirSync, writeFileSync } from "node:fs";
import { join } from "node:path";
import { CUSTOMER } from "@bill-fighter/db/seed/customer";
import { type BrowserContext, chromium, type Locator, type Page } from "playwright";
import { phraseAt, type Word } from "../src/timeline.ts";
import voWords from "../src/vo-words.json" with { type: "json" };
import { liveCallProblem, type TakeCall } from "./live-check.ts";

const BASE = process.env.DASHBOARD_URL ?? "http://localhost:3000";
// A new folder per take, so a failed attempt never touches earlier takes or renders in video/out/.
const OUT = join("video/out", `take-${new Date().toISOString().replace(/[:.]/g, "-")}`);
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
const events: { t: number; kind: string; label?: string; box?: Box; boxes?: Box[] }[] = [];
let origin = 0; // epoch ms of the first frame; every t is measured from it

const type = (page: Page, label: string, text: string) => page.getByLabel(label).pressSequentially(text, { delay: TYPE_DELAY_MS });
const think = (page: Page) => page.waitForTimeout(THINK_MS);
const boxOf = async (target: Locator): Promise<Box | undefined> => {
  const b = await target.boundingBox();
  return b ? { x: b.x, y: b.y, w: b.width, h: b.height } : undefined;
};
/** Logs a step (and the box of what it shows) at this moment; returns the moment, epoch ms, for pacing the voiceover from it. */
const log = async (kind: string, target?: Locator, label?: string) => {
  const at = Date.now();
  if (!origin) return at; // before the take: nothing is filmed yet
  events.push({ t: at - origin, kind, label, box: target && (await boxOf(target)) });
  console.info(`${((at - origin) / 1000).toFixed(1).padStart(7)}s  ${kind}${label ? ` ${label}` : ""}`);
  return at;
};
/** One spoken thing that is several elements: a box for each, all of which must be on screen. */
const logAll = async (kind: string, targets: Locator[]) => {
  const boxes = (await Promise.all(targets.map(boxOf))).filter((b): b is Box => !!b);
  assert.equal(boxes.length, targets.length, `${kind}: not every element is on screen`);
  events.push({ t: Date.now() - origin, kind, boxes });
  console.info(`${((Date.now() - origin) / 1000).toFixed(1).padStart(7)}s  ${kind} (${boxes.length})`);
};
/** Union of two boxes: the call's head is its waveform through its timer. */
const join2 = (a: Box, b: Box): Box => ({ x: Math.min(a.x, b.x), y: Math.min(a.y, b.y), w: Math.max(a.x + a.w, b.x + b.w) - Math.min(a.x, b.x), h: Math.max(a.y + a.h, b.y + b.h) - Math.min(a.y, b.y) });
/** A box cut to what its scrolling container shows (a long table in the Now pane). */
const clip = (b: Box, c: Box): Box => ({ x: Math.max(b.x, c.x), y: Math.max(b.y, c.y), w: Math.min(b.x + b.w, c.x + c.w) - Math.max(b.x, c.x), h: Math.min(b.y + b.h, c.y + c.h) - Math.max(b.y, c.y) });
const logBox = (kind: string, box: Box | undefined) => {
  assert.ok(box && box.w > 0 && box.h > 0, `${kind}: not on screen`);
  events.push({ t: Date.now() - origin, kind, box });
  console.info(`${((Date.now() - origin) / 1000).toFixed(1).padStart(7)}s  ${kind}`);
};

/** The voiceover's clock for one scene: the clip's second `anchorSec` fell at `anchorMs`. `until` waits for a clip second. */
const voClock = (page: Page, clip: string, anchorMs: number, anchorSec = 0) => {
  const words = (voWords as Record<string, Word[]>)[clip]!;
  return {
    word: (phrase: string) => phraseAt(words, phrase).start,
    until: async (sec: number) => {
      const ms = anchorMs + (sec - anchorSec) * 1000 - Date.now();
      if (ms > 0) await page.waitForTimeout(ms);
    },
  };
};
const click = async (kind: string, target: Locator) => {
  await target.scrollIntoViewIfNeeded();
  await log(kind, target);
  await target.click();
};
type Live = { run: { status: string } | null; calls: TakeCall[] };
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

mkdirSync("video/out", { recursive: true });
mkdirSync(OUT); // throws if it exists
mkdirSync(FRAMES);
console.info(`writing ${OUT}`);
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
  // V3 (scene 3 starts 2.4 s before this): "You upload a bill, or give us your provider login, and that's the last thing…"
  const v3 = voClock(sam, "V3.m4a", await log("onboarding"), 2.4);
  const portalTab = sam.getByRole("tab", { name: "Sign in to your provider" });
  const dropzone = sam.locator("label", { has: sam.getByTestId("upload-input") });
  await log("provider-login", portalTab);
  await v3.until(v3.word("upload a bill") - 0.6);
  await click("upload-tab", sam.getByTestId("upload-tab"));
  await dropzone.waitFor();
  await log("upload-field", dropzone);
  await v3.until(v3.word("and that's"));
  await log("upload", dropzone);
  await sam.getByTestId("upload-input").setInputFiles(SAMPLE_BILL);
  await sam.locator('[data-status="saved"]').waitFor({ timeout: 30_000 });
  await log("bill-saved", sam.getByTestId("upload-list"));
  await v3.until(10.5);
  await stopSam();

  // Part 2: cut to Linda, already signed in.
  await linda.reload();
  await linda.getByTestId("overview-approval").waitFor();
  await linda.evaluate(() => document.fonts.ready);
  const stopLinda = await capture(linda);
  await log("cut-to-linda");

  // /agents (timeline + Now pane) while the run waits on Linda: the Collector's view, then the Auditor's with the meter
  // finding's kWh chart inline (the lead finding is the biggest refund), then back to the amber approval card.
  await linda.goto(`${BASE}/agents`);
  const now = linda.locator('section[aria-labelledby="now-title"]');
  const nowBody = now.locator('[role="group"]');
  await linda.locator('section[data-moment="approval"]').waitFor();
  await linda.evaluate(() => document.fonts.ready);
  // V4 from here: "The Collector pulls two years of bills and meter data. The Auditor checks every line against the tariff.
  // Here it finds that since the meter was changed in September 2025, the Fremont store has been billed for double the electricity it used."
  const v4 = voClock(linda, "V4.m4a", await log("agents-before"));
  const collectorRow = linda.locator('[data-agent-row="collector"]');
  const auditorRow = linda.locator('[data-agent-row="auditor"]');
  await log("collector-row", collectorRow);
  await log("auditor-row", auditorRow);
  await v4.until(v4.word("collector") + 0.1);
  await click("collector", collectorRow);
  const bills = linda.getByTestId("collector-view").locator("table").first();
  await bills.waitFor();
  await linda.waitForTimeout(400); // the Now pane's fade-in
  logBox("collector-bills", clip((await boxOf(bills))!, (await boxOf(nowBody))!));
  await v4.until(v4.word("auditor") - 0.1);
  await click("auditor", auditorRow);
  await linda.getByTestId("kwh-plot").waitFor();
  await linda.waitForTimeout(400);
  const finding = now.locator("article").first();
  await log("finding", finding);
  await log("swap-marker", linda.getByTestId("swap-marker"));
  await log("fremont", finding.locator("p", { hasText: /^Fremont/ }).first());
  await log("kwh-bars", linda.getByTestId("kwh-plot"));
  await v4.until(18.7);
  await click("follow-live", linda.getByRole("button", { name: "Follow live" }));
  // V5: "…the Approver asks the owner once. One tap." The edit plays the Approve click on "tap".
  const card = linda.locator('section[aria-labelledby="approval-title"]');
  await card.waitFor();
  const v5 = voClock(linda, "V5.m4a", await log("approval-card", card), -0.55); // scene 5 starts 0.55 s after the card shows
  await log("approve-button", linda.getByTestId("approve"));
  // The card offers Call or Email (email-negotiator); the take keeps the default, Call.
  if (await linda.getByTestId("contact-choice").count()) assert.ok(await linda.getByTestId("contact-call").isChecked(), "the take keeps Call");
  await v5.until(v5.word("tap"));
  await click("approve", linda.getByTestId("approve"));
  // Once approved, the Now pane leaves the approval for the next moment, so the card (and its decision line) unmounts.
  await linda.locator('section[data-moment="approval"]').waitFor({ state: "detached", timeout: 15_000 });
  assert.equal(await linda.getByTestId("approve-error").count(), 0, "Approve failed");
  await log("approved", now);
  const deadline = Date.now() + 8 * 60_000;
  let callSeen = false;
  let callEnded = false;
  // The feed, not the panel: a live call shows no transcript until it ends, a sim call streams one.
  let snap: Live;
  while ((snap = await liveOf(linda)).run?.status === "running") {
    if (Date.now() > deadline) throw new Error("Run still running 8 minutes after Approve; is the webhook process alive?");
    if (await linda.getByTestId("speech-unavailable").isVisible()) throw new Error("Speech-unavailable text on screen");
    if (!callSeen && snap.calls.length) {
      callSeen = true;
      await log("call-start", now);
      // The call's head (waveform, timer) is what the call scenes zoom on; the pane itself is mostly empty during a live call.
      await now.getByTestId("call-timer").waitFor({ timeout: 10_000 });
      const wave = now.locator(".call-bar").first().locator("xpath=..");
      logBox("call-head", join2((await boxOf(wave))!, (await boxOf(now.getByTestId("call-timer")))!));
    }
    if (callSeen && !callEnded && snap.calls.every((call) => call.endedAt)) {
      callEnded = true;
      await log("call-end", now);
    }
    await linda.waitForTimeout(500);
  }
  const status = await runStatus(linda);
  await log("run-end", undefined, status);
  await linda.waitForTimeout(3000);

  // V7: "It cancels seven lines nobody uses, flags three expired promotions and the Filer files the overbilling claim…"
  await linda.goto(`${BASE}/findings`);
  const rows = linda.locator("tr[data-finding-row]");
  await rows.first().waitFor();
  await linda.evaluate(() => document.fonts.ready);
  const rule = (label: string) => rows.filter({ has: linda.getByText(label, { exact: true }) });
  const cancelled = rule("Unused line").filter({ hasNot: linda.getByText("Found, not acted on") });
  const promos = rule("Promo ended");
  const claim = rule("Meter multiplier");
  assert.equal(await cancelled.count(), 7, "seven cancelled lines");
  assert.equal(await promos.count(), 3, "three expired promotions");
  assert.equal(await claim.count(), 1, "one overbilling claim");
  // Show the lines and promos together (and the claim too when it all fits), centred under the sticky table header.
  const docSpan = async (locs: Locator[]) => {
    const spans = await Promise.all(locs.map((l) => l.evaluateAll((els) => els.map((el) => [el.getBoundingClientRect().top + scrollY, el.getBoundingClientRect().bottom + scrollY]))));
    const flat = spans.flat();
    return { top: Math.min(...flat.map((x) => x[0]!)), bottom: Math.max(...flat.map((x) => x[1]!)) };
  };
  const scrollToSpan = (span: { top: number; bottom: number }) => linda.evaluate(({ top, bottom }) => window.scrollTo(0, Math.max(0, top - 60 - (innerHeight - 60 - (bottom - top)) / 2)), span);
  const all = await docSpan([cancelled, promos, claim]);
  const together = all.bottom - all.top < 1080 - 120;
  const group = together ? all : await docSpan([cancelled, promos]);
  assert.ok(group.bottom - group.top < 1080 - 120, "the cancelled lines and the promos do not fit on one screen");
  await scrollToSpan(group);
  await linda.waitForTimeout(300);
  const v7 = voClock(linda, "V7.m4a", await log("findings"));
  await logAll("cancelled-lines", await cancelled.all());
  await logAll("promos", await promos.all());
  if (together) await log("claim-row", claim);
  else {
    await v7.until(phraseAt((voWords as Record<string, Word[]>)["V7.m4a"]!, "3 expired promotions").end + 0.05);
    await scrollToSpan(await docSpan([claim]));
    await log("claim-row", claim);
  }
  await v7.until(12.4);

  // V8: "Twelve thousand six hundred dollars back, and over eighteen thousand a year saved. We take thirty percent…"
  await linda.goto(`${BASE}/overview`);
  await linda.getByTestId("overview-run-status").waitFor();
  await linda.evaluate(() => document.fonts.ready);
  const v8 = voClock(linda, "V8.m4a", await log("overview"));
  await log("overview-refund", linda.getByTestId("overview-refund"));
  await log("overview-savings", linda.getByTestId("overview-savings"));
  await log("overview-fee", linda.getByTestId("overview-fee"));
  await v8.until(12.6);
  const seen = Object.fromEntries(await Promise.all(Object.keys(EXPECTED).map(async (id) => [id, await linda.getByTestId(id).innerText()])));
  await linda.goto(`${BASE}/money`);
  await linda.locator("[data-ledger-row]").first().waitFor();
  await log("money", linda.getByTestId("money-refund"));
  await linda.waitForTimeout(4000);
  await stopLinda();

  assert.equal(await linda.getByTestId("replay-banner").count(), 0, "a REPLAY banner was on screen");
  assert.equal(status, "success");
  if (live) {
    const problem = liveCallProblem((await liveOf(linda)).calls);
    assert.ok(!problem, `not a live take: ${problem}`);
  }
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
