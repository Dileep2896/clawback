import { describe, expect, it } from "vitest";
import { readSession, signSession, type Session } from "./session.ts";

const session: Session = { id: "abc", provider: "baytel", expiresAt: 2_000 };

describe("session token", () => {
  it("round trips", () => {
    expect(readSession(signSession(session, "secret"), "secret", 1_000)).toEqual(session);
  });

  it("refuses an expired session", () => {
    expect(readSession(signSession(session, "secret"), "secret", 2_000)).toBeNull();
  });

  it("refuses another secret's signature", () => {
    expect(readSession(signSession(session, "other"), "secret", 1_000)).toBeNull();
  });

  it("refuses a payload changed to another provider", () => {
    const [, sig] = signSession(session, "secret").split(".");
    const forged = Buffer.from(JSON.stringify({ ...session, provider: "baycurrent" })).toString("base64url");
    expect(readSession(`${forged}.${sig}`, "secret", 1_000)).toBeNull();
  });

  it.each(["", "abc", "a.b.c", "..", "%%%.%%%"])("refuses the malformed token %j", (token) => {
    expect(readSession(token, "secret", 1_000)).toBeNull();
  });

  it("refuses a correctly signed unknown provider", () => {
    const token = signSession({ ...session, provider: "pge" as Session["provider"] }, "secret");
    expect(readSession(token, "secret", 1_000)).toBeNull();
  });
});
