// Checks the portal-downloads acceptance list against a running portal, seeded database and seeded vault.
// Run: pnpm exec tsx --env-file-if-exists=.env apps/portal/e2e/downloads.ts
import assert from "node:assert/strict";
import { createHash } from "node:crypto";
import { readdirSync, readFileSync } from "node:fs";
import { fileURLToPath } from "node:url";
import { db } from "@bill-fighter/db/client";
import { accounts, bills, phoneLines, usageIntervals } from "@bill-fighter/db/schema";
import { getPlatform } from "@bill-fighter/platform/factory";
import { Provider } from "@bill-fighter/shared/fixtures";
import { portalVaultName } from "@bill-fighter/shared/portal";
import { asc, eq } from "drizzle-orm";
import { chromium, type Browser, type Page } from "playwright";

const BASE = process.env.PORTAL_URL ?? "http://localhost:3001";
const BILLS_DIR = fileURLToPath(new URL("../../../data/bills/", import.meta.url));
const EXPECTED_BILLS = 448;

const sha256 = (bytes: Buffer) => createHash("sha256").update(bytes).digest("hex");
const vault = await getPlatform().vault();

async function shot(page: Page, name: string) {
  if (process.env.PORTAL_SCREENSHOT_DIR) await page.screenshot({ path: `${process.env.PORTAL_SCREENSHOT_DIR}/${name}.png`, fullPage: true });
}

async function login(browser: Browser, provider: Provider) {
  const page = await (await browser.newContext()).newPage();
  await page.goto(`${BASE}/login?brand=${provider}`);
  await page.fill("#username", await vault.get(portalVaultName(provider, "username")));
  await page.fill("#password", await vault.get(portalVaultName(provider, "password")));
  await page.getByTestId("login-submit").click();
  await page.waitForURL("**/accounts");
  await page.getByTestId("session-modal-dismiss").click();
  await page.getByTestId("session-modal").waitFor({ state: "detached" });
  return page;
}

/** Walks the real account pages from the first, so a link missing from any page fails the count. */
async function accountLinks(page: Page, testId: string) {
  await page.goto(`${BASE}/accounts`);
  const hrefs: string[] = [];
  for (;;) {
    for (const link of await page.getByTestId(testId).all()) hrefs.push((await link.getAttribute("href"))!);
    const next = page.locator('a[rel="next"]');
    if ((await next.count()) === 0) return hrefs;
    await next.click();
    await page.waitForLoadState("load");
  }
}

async function downloadBills(page: Page) {
  const hashes = new Map<string, string>();
  for (const href of await accountLinks(page, "account-bills")) {
    await page.goto(`${BASE}${href}`);
    for (const row of await page.getByTestId("bill-row").all()) {
      const id = (await row.getAttribute("data-bill-id"))!;
      const [download] = await Promise.all([page.waitForEvent("download"), row.getByTestId("bill-pdf").click()]);
      assert.equal(download.suggestedFilename(), `${id}.pdf`);
      hashes.set(id, sha256(readFileSync(await download.path())));
    }
  }
  return hashes;
}

const browser = await chromium.launch();
try {
  const seen = new Map<string, string>();
  const pages = new Map<Provider, Page>();
  for (const provider of Provider.options) {
    const page = await login(browser, provider);
    pages.set(provider, page);
    const hashes = await downloadBills(page);
    assert.ok(hashes.size > 0, `${provider}: downloaded some bills`);
    for (const [id, hash] of hashes) {
      assert.equal(seen.has(id), false, `${id} is offered to two logins`);
      seen.set(id, hash);
    }
    console.info(`${provider}: ${hashes.size} PDFs`);
  }

  const onDisk = readdirSync(BILLS_DIR).sort();
  assert.equal(seen.size, EXPECTED_BILLS, "every bill downloaded");
  assert.deepEqual([...seen.keys()].map((id) => `${id}.pdf`).sort(), onDisk, "downloads are exactly data/bills/");
  for (const [id, hash] of seen) assert.equal(hash, sha256(readFileSync(`${BILLS_DIR}${id}.pdf`)), `sha256 of ${id}`);
  console.info(`${seen.size} PDFs match data/bills/ by sha256`);

  const power = pages.get("baycurrent")!;
  const tel = pages.get("baytel")!;

  // Usage CSV: the link on the sampled account's row, clicked in the browser, compared row for row with the database.
  assert.equal((await accountLinks(power, "account-usage")).length, 12, "one usage link per electric account");
  for (const provider of ["baytel", "bayconnect", "bayhearth"] as const) {
    assert.equal((await accountLinks(pages.get(provider)!, "account-usage")).length, 0, `${provider}: no usage links`);
  }
  await power.goto(`${BASE}/accounts`);
  await shot(power, "accounts");
  const sampleRow = power.getByTestId("account-row").first();
  const sampled = (await sampleRow.getAttribute("data-account-id"))!;
  const [csvDownload] = await Promise.all([power.waitForEvent("download"), sampleRow.getByTestId("account-usage").click()]);
  const [header, ...csvRows] = readFileSync(await csvDownload.path(), "utf8").trimEnd().split("\n");
  assert.equal(header, "account_id,ts,kwh");
  const stored = await db.select().from(usageIntervals).where(eq(usageIntervals.accountId, sampled)).orderBy(asc(usageIntervals.ts));
  assert.ok(stored.length > 0, "sampled account has usage");
  assert.equal(csvRows.length, stored.length, "CSV row count");
  csvRows.forEach((row, i) => {
    const [account, ts, kwh] = row.split(",");
    assert.equal(account, sampled);
    assert.equal(ts, stored[i]!.ts.toISOString());
    assert.equal(Number(kwh), stored[i]!.kwh);
  });
  console.info(`usage CSV for ${sampled}: ${csvRows.length} rows match usage_intervals`);
  await power.goto(`${BASE}/bills?account=${encodeURIComponent(sampled)}`);
  await shot(power, "bills");

  // Line inventory.
  const storedLines = await db
    .select({ id: phoneLines.id, calls: phoneLines.callsLast12mo })
    .from(phoneLines)
    .innerJoin(accounts, eq(phoneLines.accountId, accounts.id))
    .where(eq(accounts.provider, "baytel"));
  assert.ok(storedLines.length > 0, "seed has phone lines");
  await tel.goto(`${BASE}/accounts`);
  await tel.getByTestId("nav-lines").click();
  await tel.waitForURL("**/lines");
  await shot(tel, "lines");
  const shown = new Map<string, number>();
  for (const row of await tel.getByTestId("line-row").all()) {
    shown.set((await row.getAttribute("data-line-id"))!, Number(await row.getByTestId("line-calls").textContent()));
  }
  assert.deepEqual(shown, new Map(storedLines.map((line) => [line.id, line.calls])), "lines and call counts match phone_lines");
  await power.goto(`${BASE}/lines`);
  assert.equal(await power.getByTestId("line-row").count(), 0, "another brand sees no phone lines");
  assert.equal(await power.getByTestId("nav-lines").count(), 0, "another brand has no phone lines link");
  console.info(`line inventory: ${shown.size} lines match phone_lines`);

  // Refusals. The owner gets 200 first, so each 401 and 404 below is about the session, not a bad id.
  const [powerBill] = await db.select({ id: bills.id }).from(bills).where(eq(bills.accountId, sampled)).limit(1);
  const billUrl = `${BASE}/bills/${encodeURIComponent(powerBill!.id)}/pdf`;
  const usageUrl = `${BASE}/usage/${encodeURIComponent(sampled)}`;
  assert.equal((await power.request.get(billUrl)).status(), 200, "owner gets the bill");
  assert.equal((await power.request.get(usageUrl)).status(), 200, "owner gets the usage");

  const anonymous = await browser.newContext();
  assert.equal((await anonymous.request.get(billUrl)).status(), 401, "bill without a session");
  assert.equal((await anonymous.request.get(usageUrl)).status(), 401, "usage without a session");
  await anonymous.close();

  assert.equal((await tel.request.get(billUrl)).status(), 404, "another provider's bill");
  assert.equal((await tel.request.get(usageUrl)).status(), 404, "another provider's usage");
  assert.equal((await tel.request.get(`${BASE}/bills?account=${encodeURIComponent(sampled)}`)).status(), 404, "another provider's bills page");

  for (const id of ["..%2F..%2Fpackage.json", "..%2F..%2F..%2F..%2Fpackage.json", "%2e%2e%2f%2e%2e%2fpackage.json", "..%5C..%5Cpackage.json"]) {
    const response = await power.request.get(`${BASE}/bills/${id}/pdf`, { maxRedirects: 0 });
    assert.equal(response.status(), 404, `traversal ${id}`);
    assert.doesNotMatch(await response.text(), /"packageManager"/, `traversal ${id} returned the file`);
  }

  console.info("portal-downloads e2e passed");
} finally {
  await browser.close();
  await db.$client.end();
}
