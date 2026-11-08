// Two judges at once on the hosted sandbox, in a real browser: each taps "Try it now", starts the audit, approves, and must
// reach the recorded numbers on their own account, within the 4 minute budget. One plays on a phone-sized screen.
// pnpm exec tsx scripts/sandbox-check.ts <sandbox-url> [screenshot-folder]
import assert from "node:assert/strict";
import { join } from "node:path";
import { chromium, type Browser, type Page } from "playwright";

const [base, shots] = process.argv.slice(2);
if (!base) throw new Error("Usage: scripts/sandbox-check.ts <sandbox-url> [screenshot-folder]");
const BUDGET_MS = 4 * 60_000;
const shot = async (page: Page, name: string) => shots && (await page.screenshot({ path: join(shots, `${name}.png`), fullPage: true }));

async function judge(browser: Browser, name: string, viewport: { width: number; height: number }) {
  const page = await (await browser.newContext({ viewport })).newPage();
  const began = Date.now();
  try {
    return await steps(page, name, began);
  } catch (error) {
    await shot(page, `${name}-failed`);
    const live = await page.request.get(`${base}/api/live`).catch(() => null);
    if (live) console.error(`${name}: /api/live answered ${live.status()}: ${(await live.text()).slice(0, 300)}`);
    throw new Error(`${name} at ${page.url()}: ${(error as Error).message}`, { cause: error });
  }
}

async function steps(page: Page, name: string, began: number) {
  await page.goto(`${base}/signup`);
  await page.getByRole("button", { name: "Try it now" }).click();
  await page.waitForURL(/\/onboarding$/, { timeout: 30_000 });
  await shot(page, `${name}-onboarding`);
  await page.getByTestId("start-audit").click();
  await page.waitForURL(/\/agents$/, { timeout: 30_000 });
  await page.getByTestId("replay-banner").filter({ hasText: "Sandbox replay" }).first().waitFor();

  // The run waits at the approval for this judge's tap.
  const approve = page.getByTestId("approve");
  await approve.waitFor({ timeout: BUDGET_MS });
  await shot(page, `${name}-approval`);
  await approve.click();
  // "Watch it again" lives in the sandbox pill's popover once the run has finished.
  await page.getByText("Finished").first().waitFor({ timeout: BUDGET_MS });
  await page.getByTestId("replay-banner").first().click();
  await page.getByTestId("watch-again").waitFor({ timeout: 10_000 });
  await shot(page, `${name}-agents-done`);

  const live = (await (await page.request.get(`${base}/api/live`)).json()) as { run: { id: string; status: string }; ledger: { kind: string; amountCents: number }[] };
  const sum = (kind: string) => live.ledger.filter((row) => row.kind === kind).reduce((total, row) => total + row.amountCents, 0);
  await page.goto(`${base}/overview`);
  await shot(page, `${name}-overview`);
  return { name, runId: live.run.id, status: live.run.status, refund: sum("refund"), savings: sum("savings"), fee: sum("fee"), ms: Date.now() - began };
}

const browser = await chromium.launch();
try {
  const results = await Promise.all([judge(browser, "desktop", { width: 1920, height: 1080 }), judge(browser, "phone", { width: 390, height: 844 })]);
  console.table(results);
  assert.notEqual(results[0]!.runId, results[1]!.runId, "the two judges share a run");
  for (const result of results) {
    assert.equal(result.status, "success", `${result.name}: run ${result.status}`);
    assert.deepEqual([result.refund, result.savings, result.fee], [1_260_606, 1_831_932, 927_761], `${result.name}: wrong numbers`);
    assert.ok(result.ms < BUDGET_MS, `${result.name}: took ${Math.round(result.ms / 1000)} s`);
  }
  console.info("Sandbox check passed");
} finally {
  await browser.close();
}
