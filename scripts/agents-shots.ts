/// <reference lib="dom" />
// Screenshots /agents at five moments of the recorded run (start, finding, approval, call, done) at 1920x1080, 1440x900 and 390x844, and checks each:
// no "No … yet" text, no horizontal scroll, no clipped agent action, the call at its newest line. Then, on the finished run at 1440, picks
// each agent in turn (pick-<agent>-1440.png, and pick-follow-1440.png) and checks every pick shows a view of its own. Replays data/replay/run.jsonl into DATABASE_URL, so point it at your own database.
// pnpm dev:dashboard must be running. No model, voice or network cost.
// pnpm exec tsx --env-file-if-exists=.env scripts/agents-shots.ts <folder> [--speed N] [--no-check]
import { spawn } from "node:child_process";
import { mkdir } from "node:fs/promises";
import { join } from "node:path";
import { chromium, type Page } from "playwright";
import { ROSTER } from "../apps/dashboard/lib/agents.ts";
import { viewOf } from "../apps/dashboard/lib/calls.ts";
import type { Snapshot } from "../apps/dashboard/lib/snapshot.ts";
import { db } from "@bill-fighter/db/client";
import { signedInContext } from "./dashboard-session.ts";
import { assertNotSharedDatabase } from "./stop-check.ts";

const BASE = process.env.DASHBOARD_URL ?? "http://localhost:3000";
const args = process.argv.slice(2);
const folder = args.find((arg, i) => !arg.startsWith("--") && args[i - 1] !== "--speed");
const speed = args.includes("--speed") ? args[args.indexOf("--speed") + 1]! : "2";
const check = !args.includes("--no-check");
if (!folder) throw new Error("Pass a folder for the screenshots");
// The replay clears the run's rows, so never on the shared database. The server names it; the URL can be encoded.
await assertNotSharedDatabase((sql) => db.$client.query(sql));
await db.$client.end();

const VIEWPORTS = [
  { name: "1920", width: 1920, height: 1080 },
  { name: "1440", width: 1440, height: 900 },
  { name: "390", width: 390, height: 844 },
];

const callLines = (s: Snapshot) => s.calls.reduce((n, call) => n + viewOf(call).rows.length, 0);
const begun = Date.now();
// Only this script's replay counts: until it clears the database, the last run's rows are still there.
const ours = (s: Snapshot) => !!s.run && new Date((s.run.replay as { startedAt?: string } | null)?.startedAt ?? 0).getTime() >= begun;
const MOMENTS: [string, (s: Snapshot) => boolean][] = [
  ["start", (s) => s.boardCards.some((c) => c.agent === "collector")],
  ["finding", (s) => s.findings.length > 0 && !s.approval],
  ["approval", (s) => s.approval?.status === "pending"],
  ["call", (s) => s.calls.some((c) => !c.endedAt) && callLines(s) >= 6],
  ["done", (s) => !!s.run && s.run.status !== "running"],
];

/** What a judge must never see: an empty panel, a sideways scroll, an agent action cut off, a call stuck at its top. */
async function problems(page: Page) {
  return page.evaluate(() => {
    const found: string[] = [];
    const doc = document.documentElement;
    if (doc.scrollWidth > doc.clientWidth) found.push(`horizontal scroll: ${doc.scrollWidth} > ${doc.clientWidth}`);
    const empty = document.body.innerText.match(/\bNo [a-z ]+ yet\b/);
    if (empty) found.push(`empty state: "${empty[0]}"`);
    // Entering the call with a long transcript must land on its newest line, or useFollow stops following.
    const now = document.querySelector<HTMLElement>('[data-moment="call"] [role="group"]');
    if (now && now.scrollHeight > now.clientHeight && now.scrollTop + now.clientHeight < now.scrollHeight - 40) found.push(`call transcript not at its newest line: ${now.scrollTop}`);
    for (const el of document.querySelectorAll<HTMLElement>("[data-agent-action]")) {
      if (el.scrollWidth > el.clientWidth + 1 || el.scrollHeight > el.clientHeight + 1) found.push(`clipped action: "${el.innerText}"`);
    }
    return found;
  });
}

await mkdir(folder, { recursive: true });
const browser = await chromium.launch();
const pages = await Promise.all(
  VIEWPORTS.map(async (viewport) => {
    const context = await signedInContext(browser, BASE, { viewport, reducedMotion: "no-preference" });
    const page = await context.newPage();
    // Muted: the call speaks each line. A silent speak keeps the page as a judge sees it, with no "speech unavailable" note.
    await page.addInitScript(() => {
      if ("speechSynthesis" in window) window.speechSynthesis.speak = () => {};
    });
    await page.goto(`${BASE}/agents`);
    return { viewport, page };
  }),
);

const replay = spawn("pnpm", ["demo:replay", "--speed", speed, "--force"], { stdio: "inherit" });
const failures: string[] = [];
let next = 0;
try {
  while (next < MOMENTS.length) {
    if (replay.exitCode !== null && replay.exitCode !== 0) throw new Error(`replay exited ${replay.exitCode}`);
    const snapshot = (await (await pages[0]!.page.request.get(`${BASE}/api/live`)).json()) as Snapshot;
    if (!ours(snapshot)) {
      await pages[0]!.page.waitForTimeout(300);
      continue;
    }
    // A moment the replay has already passed is reported and skipped, not waited for.
    while (next < MOMENTS.length && !MOMENTS[next]![1](snapshot) && MOMENTS.slice(next + 1).some(([, seen]) => seen(snapshot))) {
      failures.push(`missed moment ${MOMENTS[next]![0]}`);
      next++;
    }
    const [name, seen] = MOMENTS[next] ?? [];
    if (name && seen!(snapshot)) {
      // Two polls, so every page shows what the API just said.
      await pages[0]!.page.waitForTimeout(2100);
      await Promise.all(
        pages.map(async ({ viewport, page }) => {
          await page.screenshot({ path: join(folder, `${name}-${viewport.name}.png`), fullPage: viewport.width < 1100 });
          if (check) for (const problem of await problems(page)) failures.push(`${name} at ${viewport.name}: ${problem}`);
        }),
      );
      console.info(`shot ${name}`);
      next++;
    }
    await pages[0]!.page.waitForTimeout(300);
  }

  // Each agent's pick on the finished run: its own view and its own content, never another agent's.
  const { page } = pages.find(({ viewport }) => viewport.name === "1440")!;
  const seen = new Map<string, string>();
  for (const agent of [...ROSTER, "follow"]) {
    if (agent === "follow") await page.getByRole("button", { name: "Follow live" }).click();
    else await page.locator(`[data-agent-row="${agent}"]`).click();
    await page.waitForTimeout(400);
    const now = page.locator("[data-moment]");
    const view = `${await now.getAttribute("data-moment")}\n${await now.innerText()}`;
    const same = [...seen].find(([, other]) => other === view);
    if (same) failures.push(`pick ${agent} shows the same view as ${same[0]}`);
    if (agent !== "follow" && !view.includes(`What ${agent.charAt(0).toUpperCase()}${agent.slice(1)} did`)) failures.push(`pick ${agent} has no "What … did" line`);
    seen.set(agent, view);
    await page.screenshot({ path: join(folder, `pick-${agent}-1440.png`) });
    if (check) for (const problem of await problems(page)) failures.push(`pick ${agent}: ${problem}`);
  }
  console.info("shot the picks");
} finally {
  replay.kill();
  await browser.close();
}
if (failures.length > 0) {
  console.error(failures.join("\n"));
  process.exitCode = 1;
}
