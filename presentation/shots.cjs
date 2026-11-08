// Steps through the installed deck over file:// at 1920×1080 (muted), one screenshot per build step, then walks back
// and reports any step whose screen differs from the forward one, and checks a reload keeps the place.
// Run: NODE_PATH=node_modules node presentation/shots.cjs   (Google Chrome, for H.264)
const { chromium } = require("playwright");
const fs = require("fs");
const path = require("path");
const os = require("os");

const dir = path.join(os.homedir(), "Desktop/clawback-presentation");
const out = path.join(dir, "steps");

(async () => {
  fs.mkdirSync(out, { recursive: true });
  const browser = await chromium.launch({ channel: "chrome", args: ["--mute-audio", "--autoplay-policy=no-user-gesture-required"] });
  const page = await browser.newPage({ viewport: { width: 1920, height: 1080 } });
  const errors = [];
  page.on("pageerror", (e) => errors.push(e.message));
  page.on("console", (m) => m.type() === "error" && errors.push(m.text()));
  await page.goto("file://" + path.join(dir, "index.html"));
  await page.waitForTimeout(800);

  const where = () => page.evaluate(() => location.hash);
  // Wait for builds and count-ups, and for a playing clip to stop at its pause point or end.
  const settle = async () => {
    await page.waitForTimeout(1600);
    await page.waitForFunction(() => {
      const v = document.querySelector(".slide.is-current video");
      return !v || v.paused || v.ended;
    }, null, { timeout: 40000 });
    await page.waitForTimeout(300);
  };

  const forward = new Map();
  for (;;) {
    await settle();
    const h = await where();
    const v = await page.evaluate(() => {
      const el = document.querySelector(".slide.is-current video");
      return el ? { t: el.currentTime.toFixed(2), err: el.error && el.error.code } : null;
    });
    if (v && v.err) errors.push(`video error on ${h}: ${v.err}`);
    const shot = await page.screenshot({ path: path.join(out, `${h.slice(1)}.png`) });
    forward.set(h, shot);
    console.log(h, v ? `video at ${v.t}s` : "");
    await page.keyboard.press("PageDown");
    if ((await where()) === h) break;
  }

  // Back: PageUp from the end, compare each screen with the forward one.
  const differ = [];
  for (;;) {
    await page.keyboard.press("PageUp");
    const h = await where();
    await page.waitForTimeout(700);
    const shot = await page.screenshot();
    if (!shot.equals(forward.get(h))) { differ.push(h); fs.writeFileSync(path.join(out, `back-${h.slice(1)}.png`), shot); }
    if (h === "#1.0") break;
  }
  console.log("back differs from forward on:", differ.join(" ") || "none");

  await page.goto("file://" + path.join(dir, "index.html") + "#11.1");
  await page.reload();
  await page.waitForTimeout(800);
  console.log("reload keeps place:", (await where()) === "#11.1");
  console.log("errors:", errors.length ? errors : "none");
  await browser.close();
})();
