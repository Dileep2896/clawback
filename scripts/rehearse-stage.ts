// Rehearses the stage flow (docs/plan/rehearsal-notes.md, "Stage script") in a real browser at 1080p and times each step.
// Before the talk: sign up as Linda, connect BayCurrent, Start my audit, wait at approval.
// On stage: sign up the sample business and upload its bill, log out, log in as Linda, Approve on the Overview, watch /agents to the end, Overview.
// Run pnpm demo:reset first. Needs pnpm dev:dashboard, dev:portal and dev:webhooks with VOICE_MODE=sim. Starts one real sim run (Claude Code login usage).
// pnpm exec tsx --env-file-if-exists=.env scripts/rehearse-stage.ts [screenshot-folder] [--hand] [--live]
// --hand types and clicks at a person's pace. --live allows VOICE_MODE=live, which the webhook process must also run with: it places one real call.
import assert from "node:assert/strict";
import { join } from "node:path";
import { CUSTOMER } from "@bill-fighter/db/seed/customer";
import { chromium, type Page } from "playwright";

const BASE = process.env.DASHBOARD_URL ?? "http://localhost:3000";
const VIEWPORT = { width: 1920, height: 1080 };
const args = process.argv.slice(2);
const shots = args.find((arg) => !arg.startsWith("--"));
const hand = args.includes("--hand");
const live = args.includes("--live");
const SAMPLE_BILL = "data/sample-bills/mission-dumplings-baycurrent-2026-09.pdf";
const LINDA = { name: CUSTOMER.contactName, company: CUSTOMER.name, email: CUSTOMER.contactEmail, password: "noodles-on-stage" };
// The stage numbers from docs/plan/phases/13-product-ui.md.
const EXPECTED = { "overview-refund": "$12,606.06", "overview-savings": "$18,319.32", "overview-fee": "− $9,277.61" };
const MONEY_EXPECTED = { "money-refund": "$12,606.06", "money-savings": "$18,319.32", "money-fee": "$9,277.61" };
// About 50 words a minute by hand, with a moment to find each button; otherwise a fast typist.
const TYPE_DELAY_MS = hand ? 200 : 60;
const THINK_MS = hand ? 1500 : 0;

const mode = process.env.VOICE_MODE;
if (mode !== (live ? "live" : "sim")) throw new Error(`VOICE_MODE is "${mode}"; rehearse in sim, or pass --live with VOICE_MODE=live`);

const clock = Date.now();
let last = clock;
const mmss = (ms: number) => `${Math.floor(ms / 60_000)}:${String(Math.floor((ms % 60_000) / 1000)).padStart(2, "0")}`;
const mark = (step: string) => {
  const now = Date.now();
  console.info(`${mmss(now - last).padStart(6)}  ${step}`);
  last = now;
};
const shot = async (page: Page, name: string) => shots && (await page.screenshot({ path: join(shots, `${name}.png`) }));
const type = (page: Page, label: string, text: string) => page.getByLabel(label).pressSequentially(text, { delay: TYPE_DELAY_MS });
const think = (page: Page) => page.waitForTimeout(THINK_MS);
const textsOf = async (page: Page, ids: string[]) => Object.fromEntries(await Promise.all(ids.map(async (id) => [id, await page.getByTestId(id).innerText()])));
const runStatus = async (page: Page) =>
  ((await (await page.request.get(`${BASE}/api/live`)).json()) as { run: { status: string } | null }).run?.status;

async function signUp(page: Page, who: typeof LINDA) {
  await page.goto(BASE);
  await think(page);
  await page.getByTestId("get-started").click();
  await page.waitForURL(`${BASE}/signup`);
  await type(page, "Your name", who.name);
  await type(page, "Company", who.company);
  await type(page, "Work email", who.email);
  await type(page, "Password", who.password);
  await think(page);
  await page.getByRole("button", { name: "Create account" }).click();
  await page.waitForURL(`${BASE}/onboarding`);
}

const browser = await chromium.launch();
try {
  const fresh = async () => (await browser.newContext({ viewport: VIEWPORT, locale: "en-US" })).newPage();

  // Before the talk.
  const before = await fresh();
  await signUp(before, LINDA);
  await before.getByTestId("demo-login").click();
  await before.getByTestId("connected-list").getByText("BayCurrent Electric connected").waitFor({ timeout: 15_000 });
  await before.getByTestId("start-audit").click();
  await before.waitForURL(`${BASE}/overview`, { timeout: 30_000 });
  mark("before the talk: Linda signed up, BayCurrent connected, audit started");
  await before.getByTestId("overview-approval").waitFor({ timeout: 20 * 60_000 });
  mark("before the talk: run waiting at approval");
  await before.context().close();

  // On stage.
  const stage = Date.now();
  const page = await fresh();
  await signUp(page, { name: "Sam Lee", company: "Mission Dumplings", email: `sam+${Date.now()}@missiondumplings.example`, password: "dumplings-2026" });
  await think(page);
  await page.getByTestId("upload-tab").click();
  // Finding the file in the picker takes a person longer than a click.
  await think(page);
  await think(page);
  await page.getByTestId("upload-input").setInputFiles(SAMPLE_BILL);
  await page.locator('[data-status="saved"]').waitFor({ timeout: 30_000 });
  await shot(page, "stage-1-sample-uploaded");
  mark("on stage: sample business signed up, bill uploaded and read");

  await think(page);
  await page.getByTestId("log-out").click();
  await page.waitForURL(`${BASE}/`);
  await think(page);
  await page.goto(`${BASE}/login`);
  await type(page, "Work email", LINDA.email);
  await type(page, "Password", LINDA.password);
  await think(page);
  await page.getByRole("button", { name: "Log in" }).click();
  await page.waitForURL(`${BASE}/overview`);
  await page.getByTestId("overview-approval").waitFor();
  await shot(page, "stage-2-approval-needed");
  mark("on stage: logged out, logged in as Linda, Approval needed");

  await think(page);
  await page.getByTestId("overview-approve").click();
  await page.getByTestId("overview-decision").waitFor({ timeout: 15_000 });
  await think(page);
  await page.goto(`${BASE}/agents`);
  await page.getByText("No cards yet").waitFor({ state: "hidden" });
  await shot(page, "stage-3-agents");
  mark("on stage: approved, watching /agents");
  while ((await runStatus(page)) === "running") await page.waitForTimeout(2000);
  await shot(page, "stage-4-agents-done");
  mark(`on stage: run ended (${await runStatus(page)})`);

  await think(page);
  await page.goto(`${BASE}/overview`);
  // The page first paints $0.00 while the live feed loads.
  await page.getByTestId("overview-run-status").waitFor();
  await shot(page, "stage-5-overview");
  const seen = await textsOf(page, Object.keys(EXPECTED));
  mark("on stage: Overview");
  console.info(`\nOn stage total ${mmss(Date.now() - stage)}, whole rehearsal ${mmss(Date.now() - clock)}. Overview: ${JSON.stringify(seen)}`);

  // After the stage clock: the Money page shows the same three amounts.
  await page.goto(`${BASE}/money`);
  await page.locator("[data-ledger-row]").first().waitFor();
  await shot(page, "after-money");
  const money = await textsOf(page, Object.keys(MONEY_EXPECTED));
  console.info(`Money: ${JSON.stringify(money)}`);

  const { calls } = (await (await page.request.get(`${BASE}/api/live`)).json()) as { calls: { mode: string; startedAt: string; endedAt: string | null }[] };
  for (const call of calls) console.info(`Call: ${call.mode}, ${call.endedAt ? mmss(Date.parse(call.endedAt) - Date.parse(call.startedAt)) : "not ended"}`);
  assert.equal(await runStatus(page), "success");
  assert.deepEqual(seen, EXPECTED);
  assert.deepEqual(money, MONEY_EXPECTED);
} finally {
  await browser.close();
}
