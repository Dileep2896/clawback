import { createHash } from "node:crypto";
import { mkdtempSync, readdirSync, readFileSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { SCHEMA_HASH } from "@bill-fighter/agents/parse-cache";
import { portalVaultName } from "@bill-fighter/shared/portal";
import { afterAll, describe, expect, it } from "vitest";
import { seedPortalCredentials } from "../../../scripts/seed-portal-credentials.ts";
import { connectPortal, parseUpload } from "./dashboard.ts";

const root = mkdtempSync(join(tmpdir(), "webhooks-dashboard-"));
afterAll(() => rmSync(root, { recursive: true, force: true }));

function fakeVault() {
  const secrets = new Map<string, string>();
  const writes: string[] = [];
  return {
    secrets,
    writes,
    async get(name: string) {
      const value = secrets.get(name);
      if (value === undefined) throw new Error(`no ${name}`);
      return value;
    },
    async put(name: string, value: string) {
      writes.push(name);
      secrets.set(name, value);
    },
  };
}

/** A vault and portal hash file as pnpm seed:portal leaves them, with the writes it made forgotten. */
async function seeded() {
  const vault = fakeVault();
  const credentialsPath = join(mkdtempSync(join(root, "seed-")), "portal-credentials.json");
  await seedPortalCredentials(vault, credentialsPath);
  vault.writes.length = 0;
  const login = { username: vault.secrets.get(portalVaultName("baycurrent", "username"))!, password: vault.secrets.get(portalVaultName("baycurrent", "password"))! };
  return { vault, credentialsPath, login };
}

describe("connectPortal", () => {
  it("writes a login that opens the portal into the vault, under the Collector's names", async () => {
    const { vault, credentialsPath, login } = await seeded();
    const reply = await connectPortal({ provider: "baycurrent", ...login }, { vault, credentialsPath });
    expect(reply.status).toBe(200);
    expect(vault.writes).toEqual([portalVaultName("baycurrent", "username"), portalVaultName("baycurrent", "password")]);
    expect(JSON.stringify(reply.body)).not.toContain(login.password);
  });

  it("refuses a wrong login and leaves the vault alone", async () => {
    const { vault, credentialsPath, login } = await seeded();
    const before = new Map(vault.secrets);
    const reply = await connectPortal({ provider: "baycurrent", username: login.username, password: "typo" }, { vault, credentialsPath });
    expect(reply.status).toBe(422);
    expect(vault.writes).toEqual([]);
    expect(vault.secrets).toEqual(before);
  });

  it("refuses one brand's login for another brand", async () => {
    const { vault, credentialsPath, login } = await seeded();
    expect((await connectPortal({ provider: "baytel", ...login }, { vault, credentialsPath })).status).toBe(422);
    expect(vault.writes).toEqual([]);
  });

  it("checks the demo login from the vault without writing or returning it", async () => {
    const { vault, credentialsPath, login } = await seeded();
    const reply = await connectPortal({ provider: "baycurrent", demo: true }, { vault, credentialsPath });
    expect(reply.status).toBe(200);
    expect(vault.writes).toEqual([]);
    expect(JSON.stringify(reply.body)).not.toContain(login.password);
  });

  it("refuses when the portals are not set up, and a malformed body", async () => {
    const vault = fakeVault();
    expect((await connectPortal({ provider: "baycurrent", demo: true }, { vault, credentialsPath: join(root, "missing.json") })).status).toBe(503);
    expect((await connectPortal({ provider: "pge", demo: true }, { vault })).status).toBe(400);
  });
});

describe("parseUpload", () => {
  const pdf = Buffer.from("%PDF-1.7 a seed bill");
  const sha = createHash("sha256").update(pdf).digest("hex");

  it("refuses anything that is not a PDF, and an unsafe customer id", async () => {
    expect((await parseUpload({ customerId: "c1", pdfBase64: Buffer.from("hello").toString("base64") }, { uploadsDir: root })).status).toBe(415);
    expect((await parseUpload({ customerId: "../etc", pdfBase64: pdf.toString("base64") }, { uploadsDir: root })).status).toBe(400);
  });

  it("answers the committed sample business's bill from data/parsed-samples with no model call", async () => {
    const sample = readFileSync(new URL("../../../data/sample-bills/mission-dumplings-baycurrent-2026-09.pdf", import.meta.url));
    const llm = {
      structured: async () => {
        throw new Error("must not be called");
      },
    };
    const reply = await parseUpload({ customerId: "c2", pdfBase64: sample.toString("base64") }, { uploadsDir: mkdtempSync(join(root, "uploads-")), llm });
    expect(reply).toMatchObject({ status: 200, body: { status: "parsed", bill: { accountNumber: "BE-8801", providerName: expect.stringContaining("BayCurrent") } } });
  });

  it("answers a seed bill from data/parsed with no model call, and saves the PDF under the customer", async () => {
    const parsedDir = mkdtempSync(join(root, "parsed-"));
    const uploadsDir = mkdtempSync(join(root, "uploads-"));
    const entry = { source: "seed-bill", pdfSha256: sha, schemaHash: SCHEMA_HASH, status: "needs_review", bill: null, problems: ["x"], attempts: 1, costUsd: 0 };
    writeFileSync(join(parsedDir, `${sha}.${SCHEMA_HASH}.json`), JSON.stringify(entry));
    const llm = {
      structured: async () => {
        throw new Error("must not be called");
      },
    };

    const reply = await parseUpload({ customerId: "c1", pdfBase64: pdf.toString("base64") }, { parsedDir, uploadsDir, llm });
    expect(reply).toMatchObject({ status: 200, body: { status: "needs_review", pdfPath: join(uploadsDir, "c1", `${sha}.pdf`) } });
    expect(readdirSync(join(uploadsDir, "c1"))).toEqual([`${sha}.pdf`]);
  });
});
