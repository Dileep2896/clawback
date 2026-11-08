import { mkdtempSync, readFileSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { fileURLToPath } from "node:url";
import { expect, it } from "vitest";
import { bundle } from "./sandbox-bundle.ts";

const DASHBOARD = fileURLToPath(new URL("../apps/dashboard", import.meta.url));
// Gitignored names nobody else uses, so a real .env.local is never touched.
const PLANTED = [".env.bundle-test", "lib/.env.bundle-test"];

it("never puts an env file in the deployment payload", { timeout: 120_000 }, () => {
  const out = mkdtempSync(join(tmpdir(), "sandbox-bundle-test-"));
  try {
    for (const path of PLANTED) writeFileSync(join(DASHBOARD, path), "SECRET=planted-by-sandbox-bundle-test\n");
    bundle(out);
    const payload = readFileSync(join(out, "deploy.json"), "utf8");
    const names = Object.keys((JSON.parse(payload) as { files: Record<string, string> }).files);
    expect(names.filter((name) => /(^|\/)\.env/.test(name))).toEqual([]);
    expect(names).toContain("package.json");
    expect(payload).not.toContain(Buffer.from("SECRET=planted").toString("base64").slice(0, 16));
  } finally {
    for (const path of PLANTED) rmSync(join(DASHBOARD, path), { force: true });
    rmSync(out, { recursive: true, force: true });
  }
});
