import { NaiveError } from "@bill-fighter/platform/naive/client";
import { describe, expect, it } from "vitest";
import { retrying, waitReady } from "./sandbox-redeploy.ts";

const noWait = async () => {};
const limited = () => new NaiveError(429, "rate_limited", "at capacity");

describe("retrying", () => {
  it("retries a 429 and nothing else", async () => {
    let n = 0;
    await expect(retrying(async () => (++n < 3 ? Promise.reject(limited()) : "ok"), noWait)).resolves.toBe("ok");
    expect(n).toBe(3);
    await expect(retrying(() => Promise.reject(new NaiveError(400, "validation_failed", "bad")), noWait)).rejects.toMatchObject({ status: 400 });
    await expect(retrying(() => Promise.reject(limited()), noWait, 2)).rejects.toMatchObject({ status: 429 });
  });
});

describe("waitReady", () => {
  const calls = (...statuses: string[]) => (async () => ({ data: [{ id: "apd_1", status: statuses.shift(), url: "https://x", error: "boom" }] })) as never;
  it("waits through queued and building to ready", async () => {
    await expect(waitReady(calls("queued", "building", "ready"), "apd_1", noWait)).resolves.toMatchObject({ status: "ready" });
  });
  it("throws on a failed build, and when it never gets ready", async () => {
    await expect(waitReady(calls("building", "error"), "apd_1", noWait)).rejects.toThrow(/Build failed: boom/);
    await expect(waitReady(calls("queued", "queued"), "apd_1", noWait, 2)).rejects.toThrow(/not ready/);
  });
});
