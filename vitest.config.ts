import { tmpdir } from "node:os";
import { join } from "node:path";
import { configDefaults, defineConfig } from "vitest/config";

export default defineConfig({
  test: {
    include: ["**/*.test.ts"],
    exclude: [...configDefaults.exclude, "**/.next/**", "apps/portal/e2e/**"],
    // The full suite passes the 5 second default under the fleet's machine load.
    testTimeout: 30000,
    // Tests that start a run through the webhooks must not fill the real data/run-events.
    env: { RUN_EVENT_LOG_DIR: join(tmpdir(), "clawback-test-run-events") },
  },
});
