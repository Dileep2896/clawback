import { configDefaults, defineConfig } from "vitest/config";

export default defineConfig({
  test: {
    include: ["**/*.test.ts"],
    exclude: [...configDefaults.exclude, "**/.next/**", "apps/portal/e2e/**"],
    // The full suite passes the 5 second default under the fleet's machine load.
    testTimeout: 30000,
  },
});
