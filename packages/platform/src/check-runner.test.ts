import { mkdirSync, mkdtempSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { afterEach, beforeEach, describe, expect, it } from "vitest";
import { runChecks } from "./check-runner.ts";
import { ADAPTER_FILES } from "./factory.ts";

const PASSING = `export default async () => {};`;

describe("runChecks", () => {
  let src: string;
  let lines: string[];

  const write = (file: string, code: string) => writeFileSync(join(src, "local", file), code);
  const writeAllPassing = () => {
    for (const file of Object.values(ADAPTER_FILES)) write(`${file}.check.ts`, PASSING);
  };
  const run = () => runChecks("local", src, (line) => lines.push(line));

  beforeEach(() => {
    src = mkdtempSync(join(tmpdir(), "platform-checks-"));
    mkdirSync(join(src, "local"));
    lines = [];
  });
  afterEach(() => rmSync(src, { recursive: true }));

  it("passes with exit 0 when every interface has a passing check", async () => {
    writeAllPassing();
    expect(await run()).toBe(0);
    expect(lines).toContain("PASS local/board.check.ts");
    expect(lines.at(-1)).toBe("All checks passed");
  });

  it("reports a failing check, still runs the rest, and exits non-zero", async () => {
    writeAllPassing();
    write("audit.check.ts", `export default async () => { throw new Error("no row written"); };`);
    expect(await run()).toBe(1);
    expect(lines).toContain("FAIL local/audit.check.ts: no row written");
    expect(lines).toContain("PASS local/vault.check.ts");
    expect(lines.at(-1)).toBe("1 failed");
  });

  it("turns a check that throws on import into one failure", async () => {
    writeAllPassing();
    write("mail.check.ts", `throw new Error("bad import");`);
    expect(await run()).toBe(1);
    expect(lines).toContain("FAIL local/mail.check.ts: bad import");
    expect(lines).toContain("PASS local/vault.check.ts");
  });

  it("fails a check file with no default function", async () => {
    writeAllPassing();
    write("sms.check.ts", `export const check = 1;`);
    expect(await run()).toBe(1);
    expect(lines).toContain("FAIL local/sms.check.ts: no default-exported check function");
  });

  it("fails an interface that has no check, even when the others pass", async () => {
    write("board.check.ts", PASSING);
    expect(await run()).toBe(1);
    expect(lines).toContain("PASS local/board.check.ts");
    expect(lines).toContain("FAIL local/mail: not built yet (expected local/mail.check.ts)");
  });

  it("fails every interface when the platform folder does not exist", async () => {
    const code = await runChecks("naive", src, (line) => lines.push(line));
    expect(code).toBe(1);
    expect(lines).toContain("FAIL naive/llm: not built yet (expected naive/llm.check.ts)");
    expect(lines.at(-1)).toBe(`${Object.keys(ADAPTER_FILES).length} failed`);
  });

  it("prints a not-available check as N/A, never PASS, without failing the run", async () => {
    writeAllPassing();
    write("sms.check.ts", `export default async () => ({ notAvailable: "Sms send (501)" });`);
    expect(await run()).toBe(0);
    expect(lines).toContain("N/A local/sms.check.ts: not available on local: Sms send (501)");
    expect(lines).not.toContain("PASS local/sms.check.ts");
    expect(lines.at(-1)).toBe("All checks passed (1 N/A)");
  });

  it("finds checks in subfolders", async () => {
    writeAllPassing();
    mkdirSync(join(src, "local", "extra"));
    write(join("extra", "smoke.check.ts"), PASSING);
    expect(await run()).toBe(0);
    expect(lines).toContain(`PASS local/${join("extra", "smoke.check.ts")}`);
  });
});
