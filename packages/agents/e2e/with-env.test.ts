import { afterEach, expect, it } from "vitest";
import { withEnv } from "./with-env.ts";

const NAME = "WITH_ENV_TEST";

afterEach(() => {
  delete process.env[NAME];
});

it("removes a variable that was unset, rather than storing the string undefined", async () => {
  const seen = await withEnv(NAME, "during", async () => process.env[NAME]);
  expect(seen).toBe("during");
  expect(NAME in process.env).toBe(false);
});

it("restores a variable that was set", async () => {
  process.env[NAME] = "before";
  await withEnv(NAME, "during", async () => {});
  expect(process.env[NAME]).toBe("before");
});

it("restores when the callback throws", async () => {
  await expect(
    withEnv(NAME, "during", async () => {
      throw new Error("boom");
    }),
  ).rejects.toThrow("boom");
  expect(NAME in process.env).toBe(false);
});
