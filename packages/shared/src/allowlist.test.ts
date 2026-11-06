import { describe, expect, it } from "vitest";
import {
  allowlistFromEnv,
  isAllowedCallNumber,
  isAllowedEmail,
  isAllowedPortalUrl,
} from "./allowlist.ts";

const OUR_NUMBER = "+15550001234";

const allowlist = allowlistFromEnv({
  ALLOWED_CALL_NUMBERS: OUR_NUMBER,
  ALLOWED_EMAIL_DOMAINS: "billfighter.local",
  ALLOWED_PORTAL_ORIGINS: "http://localhost:3001",
});

const empty = allowlistFromEnv({});

describe("allowlistFromEnv", () => {
  it("splits, trims and drops blanks", () => {
    expect(
      allowlistFromEnv({
        ALLOWED_CALL_NUMBERS: ` ${OUR_NUMBER} , ,+15550005678`,
        ALLOWED_EMAIL_DOMAINS: "BillFighter.local,",
        ALLOWED_PORTAL_ORIGINS: "http://localhost:3001/, http://localhost:3002",
      }),
    ).toEqual({
      callNumbers: [OUR_NUMBER, "+15550005678"],
      emailDomains: ["billfighter.local"],
      portalOrigins: ["http://localhost:3001", "http://localhost:3002"],
    });
  });

  it("drops entries that could never be valid targets", () => {
    expect(
      allowlistFromEnv({
        ALLOWED_EMAIL_DOMAINS: "*",
        ALLOWED_PORTAL_ORIGINS: "*,file:///etc/passwd,data:text/plain,hi,localhost:3001",
      }),
    ).toEqual({ callNumbers: [], emailDomains: [], portalOrigins: [] });
  });
});

describe("our own targets", () => {
  it("are allowed", () => {
    expect(isAllowedCallNumber(allowlist, OUR_NUMBER)).toBe(true);
    expect(isAllowedEmail(allowlist, "bills@billfighter.local")).toBe(true);
    expect(isAllowedEmail(allowlist, "Linda@BillFighter.LOCAL")).toBe(true);
    expect(isAllowedPortalUrl(allowlist, "http://localhost:3001/bills?page=2")).toBe(true);
  });
});

describe("real providers", () => {
  it.each(["pge.com", "att.com", "comcast.com", "comcast.net", "xfinity.com"])(
    "rejects %s as an email domain and a portal",
    (domain) => {
      expect(isAllowedEmail(allowlist, `billing@${domain}`)).toBe(false);
      expect(isAllowedPortalUrl(allowlist, `https://www.${domain}/login`)).toBe(false);
    },
  );

  it.each(["+18007435000", "+18003310500", "+18009346489"])("rejects phone number %s", (number) => {
    expect(isAllowedCallNumber(allowlist, number)).toBe(false);
  });
});

describe("failing closed", () => {
  it("rejects everything when the lists are empty", () => {
    expect(empty).toEqual({ callNumbers: [], emailDomains: [], portalOrigins: [] });
    expect(isAllowedCallNumber(empty, OUR_NUMBER)).toBe(false);
    expect(isAllowedEmail(empty, "bills@billfighter.local")).toBe(false);
    expect(isAllowedPortalUrl(empty, "http://localhost:3001")).toBe(false);
  });

  it("rejects everything when the env vars are set but blank", () => {
    const blank = allowlistFromEnv({
      ALLOWED_CALL_NUMBERS: "",
      ALLOWED_EMAIL_DOMAINS: " , ",
      ALLOWED_PORTAL_ORIGINS: "",
    });
    expect(isAllowedCallNumber(blank, "")).toBe(false);
    expect(isAllowedEmail(blank, "a@")).toBe(false);
    expect(isAllowedPortalUrl(blank, "")).toBe(false);
  });

  it("gives a wildcard entry no power", () => {
    const wildcard = allowlistFromEnv({
      ALLOWED_CALL_NUMBERS: "*",
      ALLOWED_EMAIL_DOMAINS: "*",
      ALLOWED_PORTAL_ORIGINS: "*",
    });
    expect(isAllowedCallNumber(wildcard, "*")).toBe(false);
    expect(isAllowedEmail(wildcard, "a@*")).toBe(false);
    expect(isAllowedEmail(wildcard, "a@pge.com")).toBe(false);
    expect(isAllowedPortalUrl(wildcard, "https://www.pge.com")).toBe(false);
  });
});

describe("bypass attempts", () => {
  it.each([
    "a@pge.com@billfighter.local",
    "a@billfighter.local@pge.com",
    "a@billfighter.local.evil.com",
    "a@sub.billfighter.local",
    "a@pge.com,b@billfighter.local",
    "Linda <a@pge.com>",
    "Linda <a@billfighter.local>",
    '"a@pge.com"@billfighter.local',
    "a b@billfighter.local",
    "a@billfighter.local\n",
    "@billfighter.local",
    "billfighter.local",
    "",
  ])("rejects email %j", (address) => {
    expect(isAllowedEmail(allowlist, address)).toBe(false);
  });

  it.each([
    "http://localhost:3001@evil.com",
    "http://localhost:3001.evil.com",
    "http://evil.com\\@localhost:3001",
    "http://evil.com/http://localhost:3001",
    "https://localhost:3001",
    "http://localhost:3002",
    "http://localhost",
    "file:///etc/passwd",
    "data:text/plain,hi",
    "javascript:alert(1)",
    "localhost:3001",
    "not a url",
    "",
  ])("rejects portal url %j", (url) => {
    expect(isAllowedPortalUrl(allowlist, url)).toBe(false);
  });

  it.each(["15550001234", "+1 555 000 1234", "+1-555-000-1234", `${OUR_NUMBER}\n`, `${OUR_NUMBER}1`])(
    "rejects phone number %j",
    (number) => {
      expect(isAllowedCallNumber(allowlist, number)).toBe(false);
    },
  );
});
