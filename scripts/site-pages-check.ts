// Checks the public site pages (/, /how-it-works, /pricing, /compare, /market) in a real, signed-out browser, against a
// running dashboard: each opens without logging in, has no console errors, never scrolls sideways at 1920, 390 or 320 px,
// and links to the other pages from the footer (and the nav, where it shows). Needs no database.
// pnpm dev:dashboard must be running. Pass a folder to keep screenshots, including a reduced-motion frame of each page.
// pnpm exec tsx scripts/site-pages-check.ts [screenshot-dir]
import assert from "node:assert/strict";
import { chromium, type Browser } from "playwright";

const BASE = process.env.DASHBOARD_URL || "http://localhost:3000";
const PAGES = ["/how-it-works", "/pricing", "/compare", "/market"];
const VIEWPORTS = [
  { name: "1920", width: 1920, height: 1080 },
  { name: "390", width: 390, height: 844 },
  { name: "320", width: 320, height: 640 },
];
const screenshotDir = process.argv[2];

// Browser code goes in as strings, because the root tsconfig has no DOM types.
const WIDTHS = `({ scrollWidth: document.documentElement.scrollWidth, innerWidth: window.innerWidth })`;
const hrefsIn = (label: string) => `[...document.querySelectorAll('nav[aria-label="${label}"] a')].map((a) => a.getAttribute("href"))`;

async function checkPage(browser: Browser, path: string, viewport: (typeof VIEWPORTS)[number], reducedMotion: boolean) {
  const context = await browser.newContext({ viewport, reducedMotion: reducedMotion ? "reduce" : "no-preference" });
  const page = await context.newPage();
  const errors: string[] = [];
  page.on("console", (message) => {
    if (message.type() === "error") errors.push(message.text());
  });
  page.on("pageerror", (error) => errors.push(error.message));

  const response = await page.goto(`${BASE}${path}`);
  const where = `${path} at ${viewport.name}${reducedMotion ? ", reduced motion" : ""}`;
  assert.equal(response?.status(), 200, `${where}: status ${response?.status()}`);
  assert.equal(new URL(page.url()).pathname, path, `${where}: redirected to ${page.url()}`);
  // Scroll down half a screen at a time, so every section crosses the viewport and each reveal plays, as a reader would see it.
  await page.evaluate(`(async () => {
    while (scrollY + innerHeight < document.documentElement.scrollHeight) {
      scrollBy(0, innerHeight / 2);
      await new Promise((done) => setTimeout(done, 150));
    }
  })()`);
  await page.waitForFunction(`!document.querySelector('[data-reveal="ready"]')`, undefined, { timeout: 5000 }).catch(() => {
    throw new Error(`${where}: a reveal never played`);
  });
  await page.waitForTimeout(1200); // the longest reveal animation
  // /how-it-works: centring each step lights its node in the graph, and only that one.
  const steps = await page.locator("[data-step]").count();
  for (let i = 0; i < steps; i++) {
    await page.evaluate(`document.getElementById("step-${i + 1}").scrollIntoView({ block: "center" })`);
    const active = page.locator('ol[aria-label="The agents, in order"] a[aria-current="step"]');
    await page.waitForFunction(`document.querySelector('ol[aria-label="The agents, in order"] a[aria-current="step"]')?.getAttribute("href") === "#step-${i + 1}"`, undefined, { timeout: 3000 }).catch(() => {
      throw new Error(`${where}: step ${i + 1} in view but the graph does not mark it`);
    });
    assert.equal(await active.count(), 1, `${where}: more than one step marked current`);
  }
  if (path === "/how-it-works") assert.ok(steps >= 6, `${where}: expected six steps, found ${steps}`);
  await page.evaluate("window.scrollTo(0, 0)");

  const { scrollWidth, innerWidth } = await page.evaluate<{ scrollWidth: number; innerWidth: number }>(WIDTHS);
  assert.ok(scrollWidth <= innerWidth, `${where}: scrolls sideways, ${scrollWidth}px wide in ${innerWidth}px`);
  for (const target of PAGES) {
    assert.ok((await page.evaluate<string[]>(hrefsIn("Product"))).includes(target), `${where}: footer has no link to ${target}`);
    if (viewport.width >= 768) assert.ok((await page.evaluate<string[]>(hrefsIn("Site"))).includes(target), `${where}: nav has no link to ${target}`);
  }
  assert.equal(await page.locator('footer a[href="/naive"]').count(), 1, `${where}: footer has no link to /naive`);
  for (const id of ["log-in", "get-started"]) {
    const box = await page.getByTestId(id).boundingBox();
    assert.ok(box && box.x >= 0 && box.x + box.width <= innerWidth, `${where}: ${id} is cut off`);
  }
  assert.deepEqual(errors, [], `${where}: console errors`);

  if (screenshotDir) {
    const name = `${path === "/" ? "landing" : path.slice(1)}-${viewport.name}${reducedMotion ? "-reduced" : ""}`;
    await page.screenshot({ path: `${screenshotDir}/${name}.png`, fullPage: true });
  }
  await context.close();
}

const browser = await chromium.launch({ args: ["--mute-audio"] });
try {
  for (const path of ["/", ...PAGES, "/naive"]) {
    for (const viewport of VIEWPORTS) await checkPage(browser, path, viewport, false);
    await checkPage(browser, path, VIEWPORTS[0]!, true);
  }
  console.info("site pages check passed");
} finally {
  await browser.close();
}
