import { describe, expect, it } from "vitest";
import { hashPassword, isPublicPath, newSession, readSession, safeNext, sessionSecret, signSession, verifyPassword } from "./auth.ts";

const secret = sessionSecret({ VAULT_KEY: "a".repeat(43) + "=" })!;

describe("passwords", () => {
  it("verifies the right password and refuses a wrong one", async () => {
    const stored = await hashPassword("noodles-2026");
    expect(await verifyPassword("noodles-2026", stored)).toBe(true);
    expect(await verifyPassword("noodles-2027", stored)).toBe(false);
  });

  it("salts every hash and never stores the password", async () => {
    const [a, b] = [await hashPassword("same-password"), await hashPassword("same-password")];
    expect(a).not.toBe(b);
    expect(a).not.toContain("same-password");
  });

  it("refuses a malformed stored hash", async () => {
    expect(await verifyPassword("x", "not-a-hash")).toBe(false);
  });
});

describe("sessions", () => {
  const session = newSession("user-1", "customer-1", 1_000);

  it("reads back what it signed", () => {
    expect(readSession(signSession(session, secret), secret, 2_000)).toEqual(session);
  });

  it("refuses tampered, expired, foreign, malformed and missing sessions", () => {
    const token = signSession(session, secret);
    const [, sig] = token.split(".");
    const forged = `${Buffer.from(JSON.stringify({ ...session, cid: "someone-else" })).toString("base64url")}.${sig}`;
    expect(readSession(forged, secret, 2_000)).toBeNull();
    expect(readSession(token, secret, session.exp + 1)).toBeNull();
    expect(readSession(token, sessionSecret({ VAULT_KEY: "b".repeat(43) + "=" }), 2_000)).toBeNull();
    expect(readSession(`${token}.extra`, secret, 2_000)).toBeNull();
    expect(readSession("garbage", secret, 2_000)).toBeNull();
    expect(readSession(undefined, secret, 2_000)).toBeNull();
  });

  it("fails closed with no VAULT_KEY", () => {
    expect(sessionSecret({})).toBeNull();
    expect(readSession(signSession(session, secret), null, 2_000)).toBeNull();
  });
});

describe("the login guard's public paths", () => {
  it("leaves only the landing, sign-up, log-in, the SMS webhook and assets open", () => {
    for (const path of ["/", "/signup", "/login", "/api/sms", "/_next/static/x.css"]) expect(isPublicPath(path)).toBe(true);
    for (const path of ["/overview", "/bills", "/findings", "/money", "/agents", "/onboarding", "/api/approve", "/api/live", "/api/bills/upload", "/signup/x"]) {
      expect(isPublicPath(path)).toBe(false);
    }
  });
});

describe("safeNext", () => {
  it("keeps a path on this site", () => {
    expect(safeNext("/overview")).toBe("/overview");
    expect(safeNext("/bills?site=1#top")).toBe("/bills?site=1#top");
  });

  it("refuses anything a browser could take to another host", () => {
    for (const bad of ["//evil.example", "/\\evil.example", "/\t/evil.example", "/\n/evil.example", "/\r//evil.example", "/ /evil.example", "/\u0000/x", "https://evil.example", "evil.example", "", null, undefined, 1]) {
      expect(safeNext(bad), JSON.stringify(bad)).toBeNull();
    }
  });
});
