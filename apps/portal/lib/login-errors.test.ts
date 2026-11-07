import { describe, expect, it } from "vitest";
import { loginError } from "./login-errors.ts";

describe("loginError", () => {
  it("returns the message for each known code", () => {
    expect(loginError("wrong")).toContain("incorrect");
    expect(loginError("setup")).toContain("not set up");
  });

  it.each(["__proto__", "constructor", "toString", "nope", ""])("ignores %j", (code) => {
    expect(loginError(code)).toBeUndefined();
  });

  it("ignores a repeated query parameter and a missing one", () => {
    expect(loginError(["wrong", "setup"])).toBeUndefined();
    expect(loginError(undefined)).toBeUndefined();
  });
});
