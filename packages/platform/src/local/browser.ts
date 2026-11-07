import { createServer, request as httpRequest } from "node:http";
import type { AddressInfo } from "node:net";
import { connect } from "node:net";
import { type Allowlist, allowlistFromEnv, isAllowedPortalUrl } from "@bill-fighter/shared/allowlist";
import { chromium } from "playwright";
import type { Browser, Vault } from "../types.ts";
import defaultVault from "./vault.ts";

/**
 * All Chromium traffic goes through this proxy, because Playwright's route handlers see only the first URL of a
 * redirect chain, so they cannot stop a redirect reaching a real company's site. A refusal drops the socket, so a
 * navigation rejects rather than loading an error page.
 */
async function startAllowlistProxy(allowed: (url: string) => boolean) {
  const proxy = createServer((request, response) => {
    const url = request.url ?? "";
    if (!allowed(url)) return void request.socket.destroy();
    const headers = { ...request.headers };
    delete headers["proxy-connection"];
    const upstream = httpRequest(url, { method: request.method, headers }, (reply) => {
      response.writeHead(reply.statusCode ?? 502, reply.headers);
      reply.pipe(response);
    });
    upstream.on("error", () => request.socket.destroy());
    request.pipe(upstream);
  });
  // HTTPS and WebSocket arrive as CONNECT host:port. Treated as https, so ws:// to an http-only origin is refused.
  // shortcut: this checks the origin, not the path, which is all ALLOWED_PORTAL_ORIGINS says anyway.
  proxy.on("connect", (request, client, head) => {
    const [host = "", port = "443"] = (request.url ?? "").split(/:(?=\d+$)/);
    if (!allowed(`https://${request.url}`)) return void client.destroy();
    // connect() wants a bare IPv6 address: Node treats "[::1]" as a hostname and fails with ENOTFOUND.
    const upstream = connect(Number(port), host.replace(/^\[|\]$/g, ""), () => {
      client.write("HTTP/1.1 200 Connection Established\r\n\r\n");
      upstream.write(head);
      upstream.pipe(client);
      client.pipe(upstream);
    });
    upstream.on("error", () => client.destroy());
    client.on("error", () => upstream.destroy());
  });
  await new Promise<void>((resolve) => proxy.listen(0, "127.0.0.1", resolve));
  return {
    server: `http://127.0.0.1:${(proxy.address() as AddressInfo).port}`,
    close() {
      proxy.closeAllConnections();
      proxy.close();
    },
  };
}

export function createBrowser(vault: Vault, getAllowlist: () => Allowlist = allowlistFromEnv): Browser {
  return {
    async open() {
      const allowlist = getAllowlist();
      const allowed = (url: string) => isAllowedPortalUrl(allowlist, url);
      const proxy = await startAllowlistProxy(allowed);
      try {
        // <-loopback>: Chromium skips proxies for localhost by default, and our portals are on localhost.
        // The WebRTC flag: UDP does not go through an HTTP proxy, so it would reach any STUN or TURN server unchecked.
        const browser = await chromium.launch({
          headless: true,
          // Playwright's own SIGINT handler exits as soon as the browsers close, so it would cut off a handler that is still saving.
          handleSIGINT: process.listenerCount("SIGINT") === 0,
          proxy: { server: proxy.server, bypass: "<-loopback>" },
          args: ["--force-webrtc-ip-handling-policy=disable_non_proxied_udp"],
        });
        const context = await browser.newContext();
        let navFailed = false;
        const newPage = async () => {
          const next = await context.newPage();
          next.on("requestfailed", (request) => {
            // ERR_ABORTED is a navigation replaced by a newer one, which commits no error page.
            const aborted = request.failure()?.errorText === "net::ERR_ABORTED";
            if (next === page && request.isNavigationRequest() && request.frame() === next.mainFrame() && !aborted) {
              navFailed = true;
            }
          });
          return next;
        };
        let page = await newPage();
        // Chromium commits a refused navigation's error page late, which would interrupt the next goto.
        // A fresh page cannot be interrupted, and the context keeps the login cookies.
        const swapPage = async () => {
          await page.close();
          page = await newPage();
          navFailed = false;
        };
        let lastUrl = "about:blank";
        // A refusal can commit just after goto returned, leaving the error page or destroying the read in progress.
        // shortcut: click and fill do not recover, so one hitting that error page times out and the next goto recovers.
        // Upgrade if an agent tool ever clicks straight after a goto to a page that navigates by itself.
        const read = async <T>(fn: () => Promise<T>) => {
          try {
            if (!navFailed) return await fn();
          } catch (error) {
            if (!String(error).includes("Execution context was destroyed")) throw error;
          }
          await swapPage();
          await page.goto(lastUrl);
          return fn();
        };
        return {
          async goto(url) {
            if (!allowed(url)) throw new Error(`Browser refused ${url}: outside ALLOWED_PORTAL_ORIGINS`);
            lastUrl = url;
            if (navFailed) await swapPage();
            try {
              await page.goto(url);
              if (!navFailed) return;
            } catch (error) {
              if (!/interrupted by another navigation|ERR_ABORTED/.test(String(error))) throw error;
            }
            // A refused click can start after click() returns, so it can race this goto. Go again once on a fresh page.
            await swapPage();
            await page.goto(url);
          },
          fill: (selector, value) => page.locator(selector).fill(value),
          async fillSecret(selector, vaultName) {
            try {
              await page.locator(selector).fill(await vault.get(vaultName));
            } catch {
              // A new error with no cause: Playwright's text must not carry the value into agent context or audit_log.
              throw new Error(`fillSecret failed for ${selector} using vault entry "${vaultName}"`);
            }
          },
          click: (selector) => page.locator(selector).click(),
          isVisible: (selector) => read(() => page.locator(selector).first().isVisible()),
          texts: (selector) => read(() => page.locator(selector).allInnerTexts()),
          attributes: (selector, name) =>
            read(() => page.locator(selector).evaluateAll((elements, attr) => elements.map((el) => el.getAttribute(attr) ?? ""), name)),
          async download(selector, destPath) {
            const [download] = await Promise.all([page.waitForEvent("download"), page.locator(selector).click()]);
            await download.saveAs(destPath);
          },
          async close() {
            await browser.close();
            proxy.close();
          },
        };
      } catch (error) {
        proxy.close();
        throw error;
      }
    },
  };
}

export default createBrowser(defaultVault);
