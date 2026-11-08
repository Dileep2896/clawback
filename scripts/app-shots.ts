/// <reference lib="dom" />
// Screenshots every signed-in app page and the sign-up and log-in pages at 1440x900 and 390x844 (full page), for before/after comparisons.
// Also reports text the app type scale does not allow: under 12px, over 20px outside the one [data-hero-figure], or money off body size.
// pnpm dev:dashboard must be running, with a finished run in the database (scripts/agents-shots.ts leaves one).
// pnpm exec tsx --env-file-if-exists=.env scripts/app-shots.ts <folder> [--no-check]
import { mkdir } from "node:fs/promises";
import { join } from "node:path";
import { chromium, type Page } from "playwright";
import { signedInContext } from "./dashboard-session.ts";

const BASE = process.env.DASHBOARD_URL ?? "http://localhost:3000";
const folder = process.argv.slice(2).find((arg) => !arg.startsWith("--"));
const check = !process.argv.includes("--no-check");
if (!folder) throw new Error("Pass a folder for the screenshots");

const SIGNED_IN = ["overview", "bills", "findings", "money", "onboarding", "agents"];
const SIGNED_OUT = ["signup", "login"];
const VIEWPORTS = [
  { name: "1440", width: 1440, height: 900 },
  { name: "390", width: 390, height: 844 },
];

/** Visible text outside the app scale, as "size: text". */
const offScale = (page: Page) =>
  page.evaluate(() => {
    const found = new Set<string>();
    const walker = document.createTreeWalker(document.body, NodeFilter.SHOW_TEXT);
    for (let node = walker.nextNode(); node; node = walker.nextNode()) {
      const el = node.parentElement;
      const text = node.textContent?.trim();
      if (!el || !text || el.closest("[data-hero-figure], .sr-only, [aria-hidden='true']")) continue;
      const style = getComputedStyle(el);
      if (style.visibility === "hidden" || style.display === "none" || el.getClientRects().length === 0) continue;
      const px = Number.parseFloat(style.fontSize);
      if (px < 12 || px > 20) found.add(`${px}px: ${text.slice(0, 40)}`);
      // Every money figure but the hero sits at body size (14px), not just under the 20px ceiling.
      else if (el.closest(".font-figure") && px !== 14) found.add(`${px}px money, not body size: ${text.slice(0, 40)}`);
    }
    return [...found];
  });

await mkdir(folder, { recursive: true });
const browser = await chromium.launch();
const failures: string[] = [];
try {
  for (const viewport of VIEWPORTS) {
    const signedIn = await signedInContext(browser, BASE, { viewport });
    const signedOut = await browser.newContext({ viewport });
    for (const [context, paths] of [[signedIn, SIGNED_IN], [signedOut, SIGNED_OUT]] as const) {
      const page = await context.newPage();
      for (const path of paths) {
        await page.goto(`${BASE}/${path}`);
        await page.waitForLoadState("networkidle");
        await page.screenshot({ path: join(folder, `${path}-${viewport.name}.png`), fullPage: true });
        if (check) for (const problem of await offScale(page)) failures.push(`/${path} at ${viewport.name}: ${problem}`);
      }
    }
    await signedIn.close();
    await signedOut.close();
  }
} finally {
  await browser.close();
}
if (failures.length > 0) {
  console.error(failures.join("\n"));
  process.exitCode = 1;
}
