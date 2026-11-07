// Checks the signup-connect acceptance list in a real browser, against a running dashboard and webhook service.
// Run pnpm demo:reset first, so Linda Park can sign up again. pnpm dev:dashboard and pnpm dev:webhooks must be running.
// pnpm exec tsx --env-file-if-exists=.env scripts/signup-check.ts [screenshot-folder] [--start]
// --start also presses "Start my audit" as Linda, which starts the real sim run (Claude Code login usage).
import assert from "node:assert/strict";
import { readdirSync } from "node:fs";
import { join } from "node:path";
import { CUSTOMER } from "@bill-fighter/db/seed/customer";
import { chromium, type Page } from "playwright";

const BASE = process.env.DASHBOARD_URL ?? "http://localhost:3000";
const VIEWPORT = { width: 1920, height: 1080 };
const args = process.argv.slice(2);
const shots = args.find((arg) => !arg.startsWith("--"));
const start = args.includes("--start");
const shot = async (page: Page, name: string) => shots && (await page.screenshot({ path: join(shots, `${name}.png`), fullPage: true }));

const LINDA = { name: CUSTOMER.contactName, company: CUSTOMER.name, email: CUSTOMER.contactEmail, password: "noodles-on-stage" };

async function signUp(page: Page, who: typeof LINDA) {
  await page.goto(`${BASE}/signup`);
  await page.getByLabel("Your name").fill(who.name);
  await page.getByLabel("Company").fill(who.company);
  await page.getByLabel("Work email").fill(who.email);
  await page.getByLabel("Password").fill(who.password);
  await page.getByRole("button", { name: "Create account" }).click();
  await page.waitForURL(`${BASE}/onboarding`);
}

async function checkGuard(page: Page) {
  for (const path of ["/overview", "/bills", "/findings", "/money", "/agents", "/onboarding"]) {
    await page.goto(`${BASE}${path}`);
    assert.equal(new URL(page.url()).pathname, "/login", `${path} opened without a login`);
  }
  assert.equal((await page.request.get(`${BASE}/api/live`)).status(), 401, "/api/live is open");
  assert.equal((await page.request.post(`${BASE}/api/approve`, { data: { runId: "x" } })).status(), 401, "/api/approve is open");
  assert.equal((await page.request.post(`${BASE}/api/bills/upload`)).status(), 401, "upload is open");
  assert.notEqual((await page.request.post(`${BASE}/api/sms`, { data: {} })).status(), 401, "/api/sms must stay open for the simulated phone");
  console.info("ok guard: pages redirect to log in, APIs answer 401, /api/sms stays open");
}

/** The stage path: landing, sign up as Linda, demo login for BayCurrent. Timed, against the 30 s budget, with no typing pauses. */
async function checkLinda(page: Page) {
  const started = Date.now();
  await page.goto(BASE);
  await page.getByTestId("get-started").click();
  await page.waitForURL(`${BASE}/signup`);
  await signUp(page, LINDA);
  assert.equal(await page.getByTestId("onboarding-sites").innerText(), "12");
  await shot(page, "onboarding-1920");

  const cookie = (await page.context().cookies()).find((c) => c.name === "clawback_session");
  assert.ok(cookie?.httpOnly, "the session cookie is not httpOnly");
  assert.equal(cookie.sameSite, "Lax");

  // A wrong typed login is refused and changes nothing.
  await page.getByLabel("Portal username").fill(`${CUSTOMER.id}-baycurrent`);
  await page.getByLabel("Portal password").fill("not-the-password");
  await page.getByTestId("connect-portal").click();
  await page.getByTestId("form-error").filter({ hasText: "did not open the portal" }).waitFor();
  await page.getByLabel("Portal username").fill("");
  await page.getByLabel("Portal password").fill("");

  await page.getByTestId("demo-login").click();
  await page.getByTestId("connected-list").getByText("BayCurrent Electric connected").waitFor({ timeout: 15_000 });
  const seconds = (Date.now() - started) / 1000;
  assert.ok(seconds < 30, `sign-up and connect took ${seconds}s`);
  assert.equal(await page.getByTestId("start-audit").isEnabled(), true);
  await shot(page, "onboarding-connected-1920");
  console.info(`ok linda: signed up, linked to the seeded customer, BayCurrent connected in ${seconds.toFixed(1)}s of script time`);

  // Log out and back in.
  await page.getByTestId("log-out").click();
  await page.waitForURL(`${BASE}/`);
  await page.goto(`${BASE}/login?next=/onboarding`);
  await page.getByLabel("Work email").fill(LINDA.email);
  await page.getByLabel("Password").fill("wrong-password");
  await page.getByRole("button", { name: "Log in" }).click();
  await page.getByTestId("form-error").filter({ hasText: "Email or password is wrong" }).waitFor();
  await page.getByLabel("Password").fill(LINDA.password);
  await page.getByRole("button", { name: "Log in" }).click();
  await page.waitForURL(`${BASE}/onboarding`);
  console.info("ok linda: log out, a wrong password refused, log in returns to ?next");
}

async function checkStart(page: Page) {
  await page.getByTestId("demo-login").click();
  await page.getByTestId("connected-list").waitFor();
  await page.getByTestId("start-audit").click();
  await page.waitForURL(`${BASE}/overview`, { timeout: 30_000 });
  const live = (await (await page.request.get(`${BASE}/api/live`)).json()) as { run: { customerId: string; trigger: string } | null };
  assert.equal(live.run?.customerId, CUSTOMER.id);
  assert.equal(live.run?.trigger, "email");
  await shot(page, "overview-after-start-1920");
  console.info("ok start: the run started for the seeded customer and the page moved to Overview");
}

/** A new customer uploads a seed PDF, sees it on Bills, and gets an honest queued audit. */
async function checkNewCustomer(page: Page) {
  const email = `sam+${Date.now()}@missiondumplings.example`;
  await signUp(page, { name: "Sam Lee", company: "Mission Dumplings", email, password: "dumplings-2026" });
  assert.equal(await page.getByTestId("demo-login").count(), 0, "a new customer was offered the demo login");

  const bill = readdirSync("data/bills").filter((f) => f.endsWith(".pdf")).sort()[0]!;
  await page.getByTestId("upload-tab").click();
  await page.getByTestId("upload-input").setInputFiles(join("data/bills", bill));
  await page.getByTestId("upload-list").getByText("Reading your bill…").waitFor();
  await page.locator('[data-status="saved"]').waitFor({ timeout: 30_000 });
  await shot(page, "onboarding-upload-1920");

  await page.getByTestId("start-audit").click();
  await page.getByTestId("audit-queued").waitFor();
  await shot(page, "onboarding-queued-1920");

  await page.goto(`${BASE}/bills`);
  await page.getByTestId("bills-site").first().waitFor({ timeout: 15_000 });
  assert.equal(await page.locator("[data-bill]").count(), 1, "the new customer should see exactly their one uploaded bill");
  await shot(page, "bills-new-customer-1920");
  console.info(`ok new customer: ${bill} parsed from the cache, filed, shown on Bills, audit queued`);
}

const browser = await chromium.launch();
try {
  const fresh = async (viewport = VIEWPORT) => (await browser.newContext({ viewport, locale: "en-US" })).newPage();
  await checkGuard(await fresh());
  const linda = await fresh();
  await checkLinda(linda);
  if (start) await checkStart(linda);
  await checkNewCustomer(await fresh());
  const narrow = await fresh({ width: 390, height: 844 });
  await narrow.goto(`${BASE}/signup`);
  assert.ok((await narrow.evaluate(() => document.documentElement.scrollWidth)) <= 390, "sign-up scrolls sideways at 390 px");
  await shot(narrow, "signup-390");
  console.info("ok narrow: sign-up fits 390 px");
} finally {
  await browser.close();
}
