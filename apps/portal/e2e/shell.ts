// Checks the portal-shell acceptance list against a running portal, seeded database and seeded vault.
// Run: pnpm exec tsx --env-file-if-exists=.env apps/portal/e2e/shell.ts
import assert from "node:assert/strict";
import { getPlatform } from "@bill-fighter/platform/factory";
import { Provider } from "@bill-fighter/shared/fixtures";
import { portalVaultName } from "@bill-fighter/shared/portal";
import { chromium, type Page } from "playwright";
import { BRANDS } from "../lib/brands.ts";

const BASE = process.env.PORTAL_URL ?? "http://localhost:3001";
const SCREENSHOT_DIR = process.env.PORTAL_SCREENSHOT_DIR;
const EXPECTED_ACCOUNTS: Record<Provider, number> = { baycurrent: 12, baytel: 12, bayconnect: 12, bayhearth: 1 };
const BANNER = "Demo portal, not a real utility";

const vault = await getPlatform().vault();
const browser = await chromium.launch();

const fresh = async () => (await browser.newContext()).newPage();

async function hasBanner(page: Page) {
  assert.equal((await page.getByTestId("demo-banner").textContent())?.trim(), BANNER, `banner on ${page.url()}`);
}

async function shot(page: Page, name: string) {
  if (SCREENSHOT_DIR) await page.screenshot({ path: `${SCREENSHOT_DIR}/${name}.png`, fullPage: true });
}

async function submitLogin(page: Page, provider: Provider, username: string, password: string) {
  await page.goto(`${BASE}/login?brand=${provider}`);
  await page.fill("#username", username);
  await page.fill("#password", password);
  await page.getByTestId("login-submit").click();
}

const dismissModal = async (page: Page) => {
  await page.getByTestId("session-modal-dismiss").click();
  await page.getByTestId("session-modal").waitFor({ state: "detached" });
};

async function login(page: Page, provider: Provider) {
  const username = await vault.get(portalVaultName(provider, "username"));
  const password = await vault.get(portalVaultName(provider, "password"));
  await submitLogin(page, provider, username, password);
  await page.waitForURL("**/accounts");
}

async function allAccountIds(page: Page) {
  const ids: string[] = [];
  for (;;) {
    const rows = page.getByTestId("account-row");
    for (const row of await rows.all()) ids.push((await row.getAttribute("data-account-id"))!);
    const next = page.locator('a[rel="next"]');
    if ((await next.count()) === 0) return ids;
    await next.click();
    await page.waitForLoadState("load");
  }
}

try {
  const home = await fresh();
  await home.goto(BASE);
  await hasBanner(home);
  for (const provider of Provider.options) {
    assert.match((await home.getByTestId(`brand-${provider}`).textContent())!, new RegExp(BRANDS[provider].name));
  }
  await shot(home, "home");

  const anonymous = await fresh();
  await anonymous.goto(`${BASE}/accounts`);
  assert.equal(new URL(anonymous.url()).pathname, "/", "/accounts without a session goes to the home page");
  await hasBanner(anonymous);

  const seen = new Map<Provider, string[]>();
  for (const provider of Provider.options) {
    const page = await fresh();

    await submitLogin(page, provider, "wrong-user", "wrong-password");
    await page.getByTestId("login-error").waitFor();
    await hasBanner(page);
    assert.equal(new URL(page.url()).pathname, "/login", `${provider}: wrong credentials stay on login`);
    await shot(page, `${provider}-login-error`);

    await login(page, provider);
    await hasBanner(page);
    assert.equal(await page.getByTestId("brand-name").textContent(), BRANDS[provider].name);

    assert.ok(await page.getByTestId("session-modal").isVisible(), `${provider}: modal shows after login`);
    await page.reload();
    assert.ok(await page.getByTestId("session-modal").isVisible(), `${provider}: modal stays until dismissed`);
    await shot(page, `${provider}-modal`);
    await dismissModal(page);
    await page.reload();
    assert.equal(await page.getByTestId("session-modal").count(), 0, `${provider}: modal is gone after dismissal`);
    await shot(page, `${provider}-accounts`);

    const ids = await allAccountIds(page);
    assert.equal(ids.length, EXPECTED_ACCOUNTS[provider], `${provider}: account count across pages`);
    assert.equal(new Set(ids).size, ids.length, `${provider}: no account repeats across pages`);
    seen.set(provider, ids);
    assert.equal(await page.getByTestId("session-modal").count(), 0, `${provider}: modal does not return while paging`);

    await page.goto(`${BASE}/accounts`);
    const options = await page.locator("#location option").count();
    assert.equal(options - 1, EXPECTED_ACCOUNTS[provider], `${provider}: one picker entry per location`);
    await page.locator("#location").selectOption({ index: 1 });
    await page.getByTestId("location-apply").click();
    await page.waitForURL("**/accounts?location=*");
    assert.equal(await page.getByTestId("account-row").count(), 1, `${provider}: picker narrows to one location`);

    // A new login is a new session, so the modal returns exactly once more.
    await login(page, provider);
    assert.ok(await page.getByTestId("session-modal").isVisible(), `${provider}: modal returns on a new login`);
    await page.context().close();
  }

  const all = [...seen.values()].flat();
  assert.equal(new Set(all).size, all.length, "no account is visible to two logins");

  const other = await fresh();
  const telUser = await vault.get(portalVaultName("baytel", "username"));
  const telPassword = await vault.get(portalVaultName("baytel", "password"));
  await submitLogin(other, "baycurrent", telUser, telPassword);
  await other.getByTestId("login-error").waitFor();
  assert.equal(await other.context().cookies().then((c) => c.some((x) => x.name === "portal_session")), false, "another brand's login gets no session");

  console.info("portal-shell e2e passed");
} finally {
  await browser.close();
}
