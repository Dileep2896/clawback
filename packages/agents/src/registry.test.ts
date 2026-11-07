import { mkdtempSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { afterEach, beforeEach, describe, expect, it } from "vitest";
import { loadTools } from "./registry.ts";

const tool = (name: string) => `{ name: "${name}", description: "", targets: () => [], handler: async () => null }`;

describe("loadTools", () => {
  let dir: string;
  const write = (file: string, body: string) => writeFileSync(join(dir, file), body);

  beforeEach(() => {
    dir = mkdtempSync(join(tmpdir(), "agent-tools-"));
  });
  afterEach(() => rmSync(dir, { recursive: true }));

  it("finds the tools of every file, so a new file needs no list edit", async () => {
    write("a.ts", `export default [${tool("one")}, ${tool("two")}];`);
    expect((await loadTools(dir)).map((t) => t.name)).toEqual(["one", "two"]);
    write("b.ts", `export default [${tool("three")}];`);
    expect((await loadTools(dir)).map((t) => t.name)).toEqual(["one", "two", "three"]);
  });

  it("scans the real tools folder by default", async () => {
    await expect(loadTools()).resolves.toBeInstanceOf(Array);
  });

  it("skips tests, checks, type files and anything that is not TypeScript", async () => {
    for (const file of ["a.test.ts", "a.check.ts", "a.d.ts"]) write(file, `throw new Error("loaded ${file}");`);
    write(".gitkeep", "");
    write("notes.md", "# notes");
    await expect(loadTools(dir)).resolves.toEqual([]);
  });

  it("rejects a file with no default-exported list", async () => {
    write("a.ts", `export const tools = [];`);
    await expect(loadTools(dir)).rejects.toThrow("tools/a.ts: must default-export a list of tools");
  });

  it("rejects a tool with no targets function, so none can skip the allowlist", async () => {
    write("a.ts", `export default [{ name: "send_email", handler: async () => null }];`);
    await expect(loadTools(dir)).rejects.toThrow("tools/a.ts: send_email has no targets function");
  });

  it("rejects the same tool name in two files", async () => {
    write("a.ts", `export default [${tool("one")}];`);
    write("b.ts", `export default [${tool("one")}];`);
    await expect(loadTools(dir)).rejects.toThrow("tools/b.ts: tool one is already defined");
  });

  it("does not hide a tool file that fails to load", async () => {
    write("a.ts", `throw new Error("stripe key missing");`);
    await expect(loadTools(dir)).rejects.toThrow("stripe key missing");
  });
});
