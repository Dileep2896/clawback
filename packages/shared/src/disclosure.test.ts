import { readFileSync } from "node:fs";
import { describe, expect, it } from "vitest";
import { DISCLOSURE_LINE } from "./disclosure.ts";

describe("DISCLOSURE_LINE", () => {
  it("is the exact sentence", () => {
    expect(DISCLOSURE_LINE).toBe(
      "Hi, this is an AI assistant calling on behalf of Golden Gate Noodle Company. This call is being recorded.",
    );
  });

  it("appears word for word in section 2 of the spec", () => {
    const spec = readFileSync(new URL("../../../docs/plan/project.md", import.meta.url), "utf8");
    const section2 = spec.slice(spec.indexOf("## 2. Hard rules"), spec.indexOf("## 3. Tech stack"));
    expect(section2).toContain(`"${DISCLOSURE_LINE}"`);
  });
});
