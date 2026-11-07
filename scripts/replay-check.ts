// Checks the replay acceptance list in a real browser at 1080p, playing the real recording. Clears runs from your own database only.
// The dashboard must be running on that database. Pass a folder to keep screenshots. DASHBOARD_URL picks another port.
// pnpm exec tsx --env-file-if-exists=.env scripts/replay-check.ts [folder]
import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";
import { setTimeout as sleep } from "node:timers/promises";
import { fileURLToPath } from "node:url";
import { RUNS_DIR } from "@bill-fighter/agents/customer-data";
import { databaseUrl, db } from "@bill-fighter/db/client";
import { chromium, type Page } from "playwright";
import { assertNotSharedDb } from "../apps/dashboard/lib/sample-data.ts";
import { parseRecording, replay, type Recording } from "./replay.ts";

const BASE = process.env.DASHBOARD_URL ?? "http://localhost:3000";
const VIEWPORT = { width: 1920, height: 1080 };
const MIN_FONT_PX = 22;
const screenshotDir = process.argv[2];

// Browser code goes in as strings, because the root tsconfig has no DOM types.
const RECORD_SPEECH = `(() => {
  window.__spoken = [];
  window.speechSynthesis.speak = (utterance) => window.__spoken.push({ text: utterance.text, rate: utterance.rate });
  window.speechSynthesis.cancel = () => {};
})()`;
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

const finalRow = (recording: Recording, table: string) => recording.events.filter((event) => event.table === table && event.op === "upsert").at(-1)!.row!;
const shot = async (page: Page, name: string) => {
  if (screenshotDir) await page.screenshot({ path: `${screenshotDir}/${name}.png` });
};
const play = (recording: Recording, speed: number) =>
  replay({ pool: db.$client, url: databaseUrl(), runsDir: RUNS_DIR, allowNonlocal: false, recording, speed, force: false });
const clock = (ms: number) => `${Math.floor(ms / 60_000)}:${String(Math.floor(ms / 1000) % 60).padStart(2, "0")}`;

/** Samples the screen for the whole playback, so one unlabelled moment fails it. Only samples after the run row is in. */
async function watch(page: Page, recording: Recording, speed: number) {
  const banner = page.getByTestId("replay-banner");
  const seen = { samples: 0, approveButton: 0, reply: 0, liveTimes: new Set<string>() };
  let done = false;
  const playing = play(recording, speed).finally(() => (done = true));
  await banner.waitFor({ timeout: 15_000 });
  while (!done) {
    const live = (await (await page.request.get(`${BASE}/api/live`)).json()) as { run: { replay: unknown } | null };
    if (live.run) {
      assert.ok(live.run.replay, "a replaying run came back with no label");
      assert.ok(await banner.isVisible(), "the banner is not visible during playback");
      const text = await banner.innerText();
      assert.match(text, /REPLAY/);
      seen.samples += 1;
      seen.approveButton += await page.getByTestId("approve").count();
      seen.reply += await page.getByTestId("sms-reply").count();
      const timer = page.getByTestId("call-timer");
      if ((await timer.count()) > 0) seen.liveTimes.add(await timer.first().innerText());
    }
    await sleep(500);
  }
  await sleep(1500);
  assert.match(await banner.innerText(), speed === 1 ? /real speed/ : new RegExp(`${speed}× speed`));
  return { ...seen, ...(await playing) };
}

assertNotSharedDb();
const recording = parseRecording(await readFile(fileURLToPath(new URL("../data/replay/run.jsonl", import.meta.url)), "utf8"));
const call = finalRow(recording, "calls");
const recordedCall = clock(new Date(call.ended_at as string).getTime() - new Date(call.started_at as string).getTime());

const browser = await chromium.launch();
try {
  const page = await browser.newPage({ viewport: VIEWPORT });
  const external: string[] = [];
  page.on("request", (request) => {
    if (!request.url().startsWith("data:") && !["localhost", "127.0.0.1"].includes(new URL(request.url()).hostname)) external.push(request.url());
  });
  await page.addInitScript(RECORD_SPEECH);
  await page.goto(`${BASE}/agents`);

  // Fast, with no sound: the label, the controls and the timer.
  const fast = await watch(page, recording, 8);
  assert.ok(fast.samples > 5, `only ${fast.samples} samples`);
  assert.equal(fast.approveButton, 0, "Approve was shown during playback");
  assert.equal(fast.reply, 0, "the SMS reply box was shown during playback");
  assert.ok(Math.abs(fast.playedMs - fast.recordedMs / 8) < 3000, `played ${fast.playedMs} ms against ${fast.recordedMs / 8} ms`);
  await page.getByTestId("sound-off").waitFor({ timeout: 5000 });
  assert.equal(await page.getByTestId("call-timer").first().innerText(), recordedCall, "the timer does not end on the recorded length of the call");
  assert.ok(fast.liveTimes.size > 1, "the call timer never ticked");
  assert.equal(await page.evaluate<number>("window.__spoken.length"), 0, "speech played above 2×");
  await page.getByTestId("human-actions").filter({ hasText: "Human actions: 1" }).waitFor({ state: "attached", timeout: 5000 });
  await shot(page, "replay-finished-8x");

  const { scrollHeight, scrollWidth, tooSmall } = await page.evaluate<{ scrollHeight: number; scrollWidth: number; tooSmall: string[] }>(MEASURE);
  assert.ok(scrollHeight <= VIEWPORT.height, `page scrolls vertically, ${scrollHeight}px tall`);
  assert.ok(scrollWidth <= VIEWPORT.width, `page scrolls sideways, ${scrollWidth}px wide`);
  assert.deepEqual(tooSmall, [], `text under ${MIN_FONT_PX}px`);

  // The same tab again at 2×: the call must speak again, though its id repeats, and at the replay's rate.
  const second = await watch(page, recording, 2);
  assert.ok(second.samples > 5);
  const spoken = await page.evaluate<{ text: string; rate: number }[]>("window.__spoken");
  assert.ok(spoken.length > 3, `only ${spoken.length} lines spoken on the second replay`);
  assert.ok(spoken.every(({ rate }) => rate === 2), "speech did not follow the speed");
  await shot(page, "replay-finished-2x");

  // Refused by the routes as well as hidden.
  const live = (await (await page.request.get(`${BASE}/api/live`)).json()) as { run: { id: string } };
  for (const [path, body] of [["/api/approve", { runId: live.run.id }], ["/api/sms", { runId: live.run.id, body: "YES" }]] as const) {
    assert.equal((await page.request.post(`${BASE}${path}`, { data: body })).status(), 409, `${path} accepted a replay`);
  }

  assert.deepEqual(external, [], "the page reached outside this machine");
  console.info(`PASSED. ${fast.samples + second.samples} samples, all labelled. Call timer ended on ${recordedCall}. Recording ${clock(fast.recordedMs)}: played ${clock(fast.playedMs)} at 8×, ${clock(second.playedMs)} at 2×. ${spoken.length} lines spoken at 2×.`);
} finally {
  await browser.close();
  await db.$client.end();
}
