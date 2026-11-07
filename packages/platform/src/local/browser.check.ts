import assert from "node:assert/strict";
import { randomBytes } from "node:crypto";
import { mkdtemp, readFile, rm } from "node:fs/promises";
import { createSocket } from "node:dgram";
import { createServer, type RequestListener, type Server } from "node:http";
import type { AddressInfo } from "node:net";
import { networkInterfaces, tmpdir } from "node:os";
import { join } from "node:path";
import { setTimeout as sleep } from "node:timers/promises";
import { createBrowser } from "./browser.ts";
import { createVault } from "./vault.ts";

const SECRET = "s3cret-value-never-in-errors";

async function listen(handler: RequestListener): Promise<{ server: Server; origin: string }> {
  const server = createServer(handler);
  await new Promise<void>((resolve) => server.listen(0, "127.0.0.1", resolve));
  return { server, origin: `http://127.0.0.1:${(server.address() as AddressInfo).port}` };
}

/** Servers on this machine stand in for "our portal" and "a real company". Nothing here leaves 127.0.0.1. */
export default async function check() {
  const dir = await mkdtemp(join(tmpdir(), "browser-check-"));
  let forbiddenHits = 0;
  const forbidden = await listen((_request, response) => response.end("<h1>forbidden site</h1>"));
  // Counted per TCP connection, so an https tunnel counts too, not only a finished HTTP request.
  forbidden.server.on("connection", () => forbiddenHits++);
  const forbiddenHttps = forbidden.origin.replace("http:", "https:");

  // Allowed as https but serving plain http: the TLS handshake fails, and arriving here proves the tunnel opened.
  let tunnelHits = 0;
  const tunnelled = await listen((_request, response) => response.end());
  tunnelled.server.on("connection", () => tunnelHits++);
  const tunnelledHttps = tunnelled.origin.replace("http:", "https:");

  // A STUN server stand-in. WebRTC's sockets skip loopback, so it is reached on this machine's own LAN address if any.
  let udpHits = 0;
  const udp = createSocket("udp4").on("message", () => udpHits++);
  await new Promise<void>((resolve) => udp.bind(0, "0.0.0.0", resolve));
  const lanAddress = Object.values(networkInterfaces())
    .flat()
    .find((address) => address?.family === "IPv4" && !address.internal)?.address;
  const stun = `stun:${lanAddress ?? "127.0.0.1"}:${udp.address().port}`;

  const refusedOnce = new Set<string>();
  let posted = "";
  const html =(body: string) => `<!doctype html><title>portal</title>${body}`;
  const portal = await listen((request, response) => {
    const send = (body: string) => response.setHeader("content-type", "text/html").end(html(body));
    const path = request.url ?? "/";
    if (path === "/login" && request.method === "POST") {
      let body = "";
      request.on("data", (chunk) => (body += chunk));
      request.on("end", () => {
        posted = new URLSearchParams(body).get("password") ?? "";
        response.writeHead(302, { location: "/accounts" }).end();
      });
    } else if (path === "/accounts") send(`<h1 class="welcome">Welcome</h1><p id="hidden" hidden>x</p>`);
    else if (path === "/to-forbidden") response.writeHead(302, { location: `${forbidden.origin}/redirect` }).end();
    else if (path === "/to-https") response.writeHead(302, { location: `${forbiddenHttps}/redirect` }).end();
    else if (path === "/hop") response.writeHead(302, { location: "/to-forbidden" }).end();
    else if (path === "/link") send(`<a id="out" href="${forbidden.origin}/link">out</a>`);
    else if (path === "/late-link") {
      send(`<a id="out" href="${forbidden.origin}/late" onclick="event.preventDefault();setTimeout(()=>location.href=this.href,20)">out</a>`);
    } else if (path.startsWith("/refuses-once")) {
      // The first visit leaves for the forbidden site once loaded, so the refusal lands after goto has returned.
      const leave = refusedOnce.has(path) ? "" : `<script>onload=()=>setTimeout(()=>location.href="${forbidden.origin}/late",${path.split("=")[1]})</script>`;
      refusedOnce.add(path);
      send(`<h1 class="welcome">Welcome</h1>${leave}`);
    } else if (path === "/webrtc") {
      send(`<script>
        const pc = new RTCPeerConnection({ iceServers: [{ urls: "${stun}" }] });
        pc.createDataChannel("x");
        pc.createOffer().then((offer) => pc.setLocalDescription(offer)).then(() => {
          document.body.insertAdjacentHTML("beforeend", '<p id="rtc">opened</p>');
        });
      </script>`);
    } else if (path === "/slow") setTimeout(() => send(`<h1 class="welcome">Welcome</h1>`), 150);
    else if (path === "/image") send(`<img src="${forbidden.origin}/image.png">`);
    else if (path === "/popup") send(`<a id="out" target="_blank" href="${forbidden.origin}/popup">out</a>`);
    else if (path === "/set-cookie") response.setHeader("set-cookie", "session=1").end();
    else if (path === "/read-cookie") send(`<p id="cookie">${request.headers.cookie ?? ""}</p>`);
    else if (path === "/bill.pdf") {
      response.setHeader("content-type", "application/pdf");
      response.setHeader("content-disposition", 'attachment; filename="bill.pdf"');
      response.end("%PDF-check");
    } else {
      send(`<form method="post" action="/login"><input id="password" name="password"><button id="go">Go</button></form>
            <a id="bill" href="/bill.pdf">bill</a>`);
    }
  });

  const VAULT_KEY = randomBytes(32).toString("base64");
  const vault = createVault({ VAULT_PATH: join(dir, "vault.json"), VAULT_KEY });
  await vault.put("portal", SECRET);
  const adapter = createBrowser(vault, () => ({
    callNumbers: [],
    emailDomains: [],
    portalOrigins: [portal.origin, tunnelledHttps],
  }));
  const session = await adapter.open();

  try {
    await assert.rejects(session.goto(`${forbiddenHttps}/direct`), /outside ALLOWED_PORTAL_ORIGINS/);
    await assert.rejects(session.goto(`${forbidden.origin}/direct`), /outside ALLOWED_PORTAL_ORIGINS/);
    await assert.rejects(session.goto("file:///etc/hosts"), /outside ALLOWED_PORTAL_ORIGINS/);

    // One redirect, then a chain whose second hop is the one that leaves: the handler sees only the first URL.
    await assert.rejects(session.goto(`${portal.origin}/to-forbidden`));
    await assert.rejects(session.goto(`${portal.origin}/hop`));
    assert.equal(forbiddenHits, 0, "a redirect reached a forbidden origin");

    // No waiting after a refused click: the very next goto has to land. /late-link leaves after click returns, and
    // /slow answers later still, so the refusal always lands while goto is in flight.
    for (const start of ["/link", "/late-link", "/late-link", "/late-link", "/late-link", "/late-link"]) {
      await session.goto(`${portal.origin}${start}`);
      await session.click("#out");
      await session.goto(`${portal.origin}/slow`);
      assert.deepEqual(await session.texts(".welcome"), ["Welcome"]);
    }
    // A refused click, a goto, then a read straight away, with the refusal landing at varying moments around that read.
    for (const delay of [0, 1, 2, 3, 5, 8, 12, 20, 30, 50]) {
      await session.goto(`${portal.origin}/late-link`);
      await session.click("#out");
      await session.goto(`${portal.origin}/refuses-once?delay=${delay}`);
      assert.deepEqual(await session.texts(".welcome"), ["Welcome"], `read straight after goto, delay ${delay}`);
    }
    // The refusal has fully landed, so the page holds Chromium's error page, for both kinds of read.
    await session.goto(`${portal.origin}/refuses-once?delay=settled`);
    await sleep(300);
    assert.equal(await session.isVisible(".welcome"), true, "isVisible read the error page");
    await session.goto(`${portal.origin}/refuses-once?delay=settled2`);
    await sleep(300);
    assert.deepEqual(await session.texts(".welcome"), ["Welcome"], "texts read the error page");

    // WebRTC is UDP, which the proxy cannot see. Waiting because nothing reports a STUN packet that was never sent.
    await session.goto(`${portal.origin}/webrtc`);
    await sleep(1000);
    assert.deepEqual(await session.texts("#rtc"), ["opened"], "the page did not open an RTCPeerConnection");
    assert.equal(udpHits, 0, "WebRTC reached a UDP listener outside the proxy");

    await session.goto(`${portal.origin}/image`);
    await session.goto(`${portal.origin}/popup`);
    await session.click("#out");
    await session.goto(`${portal.origin}/accounts`);
    assert.deepEqual(await session.texts(".welcome"), ["Welcome"]);

    await assert.rejects(session.goto(`${portal.origin}/to-https`));
    assert.equal(forbiddenHits, 0, "an https redirect opened a tunnel to a forbidden origin");

    await assert.rejects(session.goto(`${tunnelledHttps}/`));
    assert.ok(tunnelHits > 0, "the proxy did not open a tunnel to an allowed https origin");

    await session.goto(`${portal.origin}/`);
    await session.fillSecret("#password", "portal");
    await session.click("#go");
    await session.isVisible(".welcome");
    assert.equal(posted, SECRET, "fillSecret did not reach the form");
    assert.deepEqual(await session.texts(".welcome"), ["Welcome"]);
    assert.equal(await session.isVisible("#hidden"), false);

    await assert.rejects(session.fillSecret("#password", "missing"), (error: Error) => {
      assert.ok(!error.message.includes(SECRET));
      assert.equal(error.cause, undefined);
      return true;
    });
    // A fill that cannot work: Playwright would describe the call, so the value must not appear either.
    await session.goto(`${portal.origin}/accounts`);
    await assert.rejects(session.fillSecret("h1", "portal"), (error: Error) => {
      assert.ok(!error.message.includes(SECRET), "fillSecret's error holds the secret");
      assert.ok(!String(error.stack).includes(SECRET), "fillSecret's stack holds the secret");
      assert.equal(error.cause, undefined);
      return true;
    });

    // Login cookies must survive a refused navigation, because the session swaps pages after one.
    await session.goto(`${portal.origin}/set-cookie`);
    await assert.rejects(session.goto(`${portal.origin}/to-forbidden`));
    await session.goto(`${portal.origin}/read-cookie`);
    assert.deepEqual(await session.texts("#cookie"), ["session=1"]);

    await session.goto(`${portal.origin}/`);
    const dest = join(dir, "bill.pdf");
    await session.download("#bill", dest);
    assert.equal(await readFile(dest, "utf8"), "%PDF-check");

    // Last, so the link, image and popup requests have had the whole check to arrive if the proxy ever let them through.
    assert.equal(forbiddenHits, 0, "a link, image or popup reached a forbidden origin");
  } finally {
    await session.close();
    portal.server.close();
    forbidden.server.close();
    tunnelled.server.close();
    udp.close();
    await rm(dir, { recursive: true, force: true });
  }
}
