export type Allowlist = {
  callNumbers: string[];
  emailDomains: string[];
  portalOrigins: string[];
};

const E164 = /^\+[1-9]\d{1,14}$/;
const EMAIL = /^[^\s@<>,"]+@([a-z0-9.-]+)$/;
const DOMAIN = /^[a-z0-9.-]+$/;

const splitList = (value: string | undefined) =>
  (value ?? "")
    .split(",")
    .map((entry) => entry.trim())
    .filter(Boolean);

function httpOrigin(url: string): string | null {
  try {
    const parsed = new URL(url);
    // file: and data: URLs all share the origin "null", so they must never match each other.
    return parsed.protocol === "http:" || parsed.protocol === "https:" ? parsed.origin : null;
  } catch {
    return null;
  }
}

export function allowlistFromEnv(env: Record<string, string | undefined> = process.env): Allowlist {
  return {
    callNumbers: splitList(env.ALLOWED_CALL_NUMBERS),
    emailDomains: splitList(env.ALLOWED_EMAIL_DOMAINS)
      .map((domain) => domain.toLowerCase())
      .filter((domain) => DOMAIN.test(domain)),
    portalOrigins: splitList(env.ALLOWED_PORTAL_ORIGINS)
      .map(httpOrigin)
      .filter((origin) => origin !== null),
  };
}

export function isAllowedCallNumber(allowlist: Allowlist, number: string): boolean {
  return E164.test(number) && allowlist.callNumbers.includes(number);
}

export function isAllowedEmail(allowlist: Allowlist, address: string): boolean {
  const domain = EMAIL.exec(address.toLowerCase())?.[1];
  return domain !== undefined && allowlist.emailDomains.includes(domain);
}

export function isAllowedPortalUrl(allowlist: Allowlist, url: string): boolean {
  const origin = httpOrigin(url);
  return origin !== null && allowlist.portalOrigins.includes(origin);
}
