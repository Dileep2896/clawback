import { readFileSync } from "node:fs";
import { describe, expect, it } from "vitest";

const css = readFileSync(new URL("../app/globals.css", import.meta.url), "utf8");

function tokens(selector: string): Record<string, string> {
  const start = css.indexOf(`${selector} {`);
  if (start < 0) throw new Error(`No ${selector} block in globals.css`);
  const block = css.slice(start, css.indexOf("}", start));
  return Object.fromEntries([...block.matchAll(/--([\w-]+):\s*(#[0-9a-f]{6});/g)].map((m) => [m[1]!, m[2]!]));
}

// WCAG 2 relative luminance.
function luminance(hex: string) {
  const [r, g, b] = [1, 3, 5].map((i) => {
    const c = parseInt(hex.slice(i, i + 2), 16) / 255;
    return c <= 0.04045 ? c / 12.92 : ((c + 0.055) / 1.055) ** 2.4;
  });
  return 0.2126 * r! + 0.7152 * g! + 0.0722 * b!;
}

/** The WCAG ratio, with room light added to both colours. Projected black can only be as dark as the lit screen. */
function contrast(a: string, b: string, roomLight = 0) {
  const [hi, lo] = [luminance(a), luminance(b)].sort((x, y) => y - x);
  return (hi! + 0.05 + roomLight) / (lo! + 0.05 + roomLight);
}

// A projector in a lit room: the screen reflects 10% of the projected white everywhere, about 11:1 from white to black.
// A model, not a measurement. The real judgement is the human one during rehearsal.
const LIT_ROOM = 0.1;
const MIN_TEXT = 4.5;

const TEXT_PAIRS = [
  ["ink", "paper"],
  ["ink", "sheet"],
  ["faded", "paper"],
  ["faded", "sheet"],
  ["money", "paper"],
  ["money", "sheet"],
  ["money", "money-soft"],
  ["ink", "money-soft"],
  ["action-text", "action"],
  ["alert-text", "alert"],
  ["alert", "paper"],
  ["alert", "sheet"],
  ["register-text", "register"],
  ["band-text", "band"],
  ["band-faded", "band"],
  ["band-money", "band"],
] as const;

describe("theme contrast", () => {
  const light = tokens(":root");
  const dark = tokens(':root[data-theme="dark"]');

  it.each(TEXT_PAIRS)("light theme: %s on %s holds up on a projector in a lit room", (text, ground) => {
    expect(contrast(light[text]!, light[ground]!, LIT_ROOM)).toBeGreaterThanOrEqual(MIN_TEXT);
  });

  it.each(TEXT_PAIRS)("light theme: %s on %s passes on a plain screen", (text, ground) => {
    expect(contrast(light[text]!, light[ground]!)).toBeGreaterThanOrEqual(MIN_TEXT);
  });

  it.each(TEXT_PAIRS)("dark theme: %s on %s passes on a plain screen", (text, ground) => {
    expect(contrast(dark[text]!, dark[ground]!)).toBeGreaterThanOrEqual(MIN_TEXT);
  });
});
