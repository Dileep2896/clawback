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

/** The WCAG ratio. */
function contrast(a: string, b: string) {
  const [hi, lo] = [luminance(a), luminance(b)].sort((x, y) => y - x);
  return (hi! + 0.05) / (lo! + 0.05);
}

const MIN_TEXT = 4.5;

// Every text colour on every ground it sits on. Dark is the only theme.
const TEXT_PAIRS = [
  ["ink", "paper"],
  ["ink", "sheet"],
  ["faded", "paper"],
  ["faded", "sheet"],
  ["money", "paper"],
  ["money", "sheet"],
  ["agent", "paper"],
  ["agent", "sheet"],
  ["alert", "paper"],
  ["alert", "sheet"],
  ["warn", "paper"],
  ["warn", "sheet"],
  ["action-text", "action"],
  ["agent-text", "agent"],
  ["alert-text", "alert"],
  ["warn-text", "warn"],
  ["paper", "ink"],
] as const;

describe("theme contrast", () => {
  const theme = tokens(":root");

  it.each(TEXT_PAIRS)("%s on %s passes on a plain screen", (text, ground) => {
    expect(contrast(theme[text]!, theme[ground]!)).toBeGreaterThanOrEqual(MIN_TEXT);
  });
});
