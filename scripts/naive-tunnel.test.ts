import { describe, expect, it } from "vitest";
import { tunnelUrl } from "./naive-tunnel.ts";

describe("tunnelUrl", () => {
  it("picks the quick tunnel host from cloudflared's banner", () => {
    const log = [
      "INF Requesting new quick Tunnel on trycloudflare.com...",
      "INF +--------------------------------------------------------------------------------------------+",
      "INF |  https://brave-otter-lamp-pine.trycloudflare.com                                           |",
    ].join("\n");
    expect(tunnelUrl(log)).toBe("https://brave-otter-lamp-pine.trycloudflare.com");
  });

  it("ignores the signup API and logs without a URL", () => {
    expect(tunnelUrl("ERR failed to request quick Tunnel: Post https://api.trycloudflare.com/tunnel")).toBeUndefined();
    expect(tunnelUrl("INF Starting tunnel")).toBeUndefined();
  });
});
