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
  // Scroll through once so every reveal plays, then come back: the measure covers the finished page.
  await page.evaluate("window.scrollTo(0, document.body.scrollHeight)");
  await page.waitForTimeout(800);
  await page.evaluate("window.scrollTo(0, 0)");

  const { scrollWidth, innerWidth } = await page.evaluate<{ scrollWidth: number; innerWidth: number }>(WIDTHS);
  assert.ok(scrollWidth <= innerWidth, `${where}: scrolls sideways, ${scrollWidth}px wide in ${innerWidth}px`);
  for (const target of PAGES) {
    assert.ok((await page.evaluate<string[]>(hrefsIn("Product"))).includes(target), `${where}: footer has no link to ${target}`);
    if (viewport.width >= 768) assert.ok((await page.evaluate<string[]>(hrefsIn("Site"))).includes(target), `${where}: nav has no link to ${target}`);
  }
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
  for (const path of ["/", ...PAGES]) {
    for (const viewport of VIEWPORTS) await checkPage(browser, path, viewport, false);
    await checkPage(browser, path, VIEWPORTS[0]!, true);
  }
  console.info("site pages check passed");
} finally {
  await browser.close();
}
