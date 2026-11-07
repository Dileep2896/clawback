import { mkdtemp, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { describe, expect, it } from "vitest";
import { hashLogin, readCredentials, verifyLogin, type PortalCredentials } from "./credentials.ts";

const credentials = {
  sessionSecret: "secret",
  logins: {
    baycurrent: await hashLogin("current-user", "current-pass"),
    baytel: await hashLogin("tel-user", "tel-pass"),
    bayconnect: await hashLogin("connect-user", "connect-pass"),
    bayhearth: await hashLogin("hearth-user", "hearth-pass"),
  },
} satisfies PortalCredentials;

describe("verifyLogin", () => {
  it("accepts the right username and password", async () => {
    expect(await verifyLogin(credentials, "baycurrent", "current-user", "current-pass")).toBe(true);
  });

  it("refuses a wrong password or username", async () => {
    expect(await verifyLogin(credentials, "baycurrent", "current-user", "nope")).toBe(false);
    expect(await verifyLogin(credentials, "baycurrent", "nope", "current-pass")).toBe(false);
  });

  it("refuses one brand's login on another brand", async () => {
    expect(await verifyLogin(credentials, "baycurrent", "tel-user", "tel-pass")).toBe(false);
  });
});

describe("readCredentials", () => {
  it("returns null when the file is missing", async () => {
    const dir = await mkdtemp(join(tmpdir(), "portal-credentials-"));
    expect(await readCredentials(join(dir, "missing.json"))).toBeNull();
  });

  it("throws on a damaged file instead of treating it as empty", async () => {
    const path = join(await mkdtemp(join(tmpdir(), "portal-credentials-")), "bad.json");
    await writeFile(path, "not json");
    await expect(readCredentials(path)).rejects.toThrow();
  });
});
