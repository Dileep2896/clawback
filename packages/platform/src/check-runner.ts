import { existsSync, readdirSync } from "node:fs";
import { basename, join } from "node:path";
import { pathToFileURL } from "node:url";
import { ADAPTER_FILES, type PlatformName, SRC_DIR } from "./factory.ts";

const SUFFIX = ".check.ts";

/**
 * Runs every src/<platform>/**\/*.check.ts and returns the exit code. A check default-exports an async function:
 * returning passes, throwing fails, and returning { notAvailable: reason } prints N/A, which does not fail the run.
 * An interface with no check also fails, so a missing adapter never looks green.
 */
export async function runChecks(
  platform: PlatformName,
  srcDir: string = SRC_DIR,
  log: (line: string) => void = console.log,
): Promise<number> {
  const dir = join(srcDir, platform);
  const checks = existsSync(dir)
    ? readdirSync(dir, { recursive: true, encoding: "utf8" })
        .filter((file) => file.endsWith(SUFFIX))
        .sort()
    : [];

  let failed = 0;
  let notAvailable = 0;
  const fail = (line: string) => {
    failed++;
    log(`FAIL ${line}`);
  };

  for (const check of checks) {
    try {
      const run = (await import(/* @vite-ignore */ pathToFileURL(join(dir, check)).href)).default;
      if (typeof run !== "function") throw new Error("no default-exported check function");
      const result: unknown = await run();
      // A check returns { notAvailable } when the platform cannot do the thing at all, so it is never shown as a PASS.
      const reason = (result as { notAvailable?: unknown } | undefined)?.notAvailable;
      if (typeof reason === "string") {
        notAvailable++;
        log(`N/A ${platform}/${check}: not available on ${platform}: ${reason}`);
      } else log(`PASS ${platform}/${check}`);
    } catch (error) {
      fail(`${platform}/${check}: ${error instanceof Error ? error.message : String(error)}`);
    }
  }

  const covered = new Set(checks.map((check) => basename(check, SUFFIX)));
  for (const file of Object.values(ADAPTER_FILES)) {
    if (!covered.has(file)) fail(`${platform}/${file}: not built yet (expected ${platform}/${file}${SUFFIX})`);
  }

  const na = notAvailable ? ` (${notAvailable} N/A)` : "";
  log(failed ? `${failed} failed${na}` : `All checks passed${na}`);
  return failed ? 1 : 0;
}
