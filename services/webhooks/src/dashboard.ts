// The dashboard's sign-up and connect steps. Next.js cannot load the platform adapters (see platform/factory.ts),
// so the dashboard asks this local service, which already has them. Same trust as /inbound: localhost only, no auth.
import { createHash } from "node:crypto";
import { existsSync, readFileSync } from "node:fs";
import { mkdir, writeFile } from "node:fs/promises";
import { join } from "node:path";
import { fileURLToPath } from "node:url";
import { CachedParse, createParseCache, SCHEMA_HASH } from "@bill-fighter/agents/parse-cache";
import { runs } from "@bill-fighter/db/schema";
import { CUSTOMER } from "@bill-fighter/db/seed/customer";
import type { Identity, Llm, Mail, Vault } from "@bill-fighter/platform/types";
import { Provider } from "@bill-fighter/shared/fixtures";
import { portalVaultName } from "@bill-fighter/shared/portal";
import { and, desc, eq, isNull, or, sql } from "drizzle-orm";
import { z } from "zod";
import { readCredentials, verifyLogin } from "../../../apps/portal/lib/credentials.ts";
import { billEmail } from "./bill-email.ts";
import { handleInbound, type InboundDeps, type InboundReply } from "./inbound.ts";

const ROOT = fileURLToPath(new URL("../../../", import.meta.url));
export const CREDENTIALS_PATH = join(ROOT, "data/seed/portal-credentials.json");
export const PARSED_DIR = join(ROOT, "data/parsed");
export const UPLOADS_DIR = join(ROOT, "data/uploads");
// The committed sample business's bill (scripts/make-sample-bill.ts). Kept out of data/parsed, the audit's input.
export const SAMPLE_PARSED_DIR = join(ROOT, "data/parsed-samples");

export type DashboardDeps = InboundDeps & {
  identity: Pick<Identity, "get">;
  mail: Pick<Mail, "send" | "parseInbound">;
  vault: Pick<Vault, "get" | "put">;
  llm?: Pick<Llm, "structured">;
  credentialsPath?: string;
  uploadsDir?: string;
  parsedDir?: string;
  sampleParsedDir?: string;
};

// A start this soon after another is a double click, a second tab or a retry after the dashboard's 15 s timeout, not a new audit.
export const START_GUARD_MINUTES = 5;

/**
 * What demo:start always did: the bill email goes to the company inbox, then into the same handler a webhook delivery reaches.
 * Each send has its own message id, so inbound deduplication cannot catch a second start: this refuses it, returning the run
 * already going. The lock makes racing starts take turns, so the second sees the first one's run row.
 */
export async function startBillRun(deps: DashboardDeps): Promise<InboundReply> {
  return deps.db.transaction(async (tx) => {
    await tx.execute(sql`select pg_advisory_xact_lock(hashtext(${`start-bill-run:${CUSTOMER.id}`}))`);
    const [recent] = await tx
      .select({ id: runs.id })
      .from(runs)
      .where(
        and(
          eq(runs.customerId, CUSTOMER.id),
          isNull(runs.replay),
          or(eq(runs.status, "running"), sql`${runs.startedAt} > now() - make_interval(mins => ${START_GUARD_MINUTES})`),
        ),
      )
      .orderBy(desc(runs.startedAt))
      .limit(1);
    if (recent) return { status: 200, body: { runId: recent.id, duplicate: true } };

    const { email: companyEmail } = await deps.identity.get();
    const email = billEmail(companyEmail);
    const { id } = await deps.mail.send(email);
    // handleInbound commits the run row on its own connection before the lock is released.
    return handleInbound({ messageId: id, ...email }, deps);
  });
}

const ConnectBody = z.union([
  z.strictObject({ provider: Provider, username: z.string().min(1).max(200), password: z.string().min(1).max(200) }),
  z.strictObject({ provider: Provider, demo: z.literal(true) }),
]);

/**
 * Checks a portal login against the portal's own hashes before it reaches the vault, so a typo never replaces the Collector's working login.
 * The demo path proves the login already in the vault still opens the portal, without the password ever leaving this process.
 */
export async function connectPortal(payload: unknown, deps: Pick<DashboardDeps, "vault" | "credentialsPath">): Promise<InboundReply> {
  const input = ConnectBody.safeParse(payload);
  if (!input.success) return { status: 400, body: { error: "Expected { provider, username, password } or { provider, demo: true }" } };
  const credentials = await readCredentials(deps.credentialsPath ?? CREDENTIALS_PATH);
  if (!credentials) return { status: 503, body: { error: "The provider portals are not set up yet. Run pnpm seed:portal." } };

  const { provider } = input.data;
  const login =
    "demo" in input.data
      ? { username: await deps.vault.get(portalVaultName(provider, "username")), password: await deps.vault.get(portalVaultName(provider, "password")) }
      : { username: input.data.username, password: input.data.password };
  if (!(await verifyLogin(credentials, provider, login.username, login.password))) {
    return { status: 422, body: { error: "That username and password did not open the portal" } };
  }
  if (!("demo" in input.data)) {
    await deps.vault.put(portalVaultName(provider, "username"), login.username);
    await deps.vault.put(portalVaultName(provider, "password"), login.password);
  }
  return { status: 200, body: { provider, connected: true } };
}

const SAFE_ID = /^\w[\w.-]*$/;
const ParseBody = z.strictObject({ customerId: z.string().regex(SAFE_ID), pdfBase64: z.string().min(1) });

/**
 * Saves an uploaded bill, then parses it. A seed bill is already in data/parsed and costs nothing.
 * Anything else is parsed live into data/uploads/parsed, never data/parsed: the audit reads that folder, and an upload must not join the demo run.
 */
export async function parseUpload(payload: unknown, deps: Pick<DashboardDeps, "llm" | "uploadsDir" | "parsedDir" | "sampleParsedDir">): Promise<InboundReply> {
  const input = ParseBody.safeParse(payload);
  if (!input.success) return { status: 400, body: { error: "Expected { customerId, pdfBase64 }" } };
  const pdf = Buffer.from(input.data.pdfBase64, "base64");
  if (pdf.subarray(0, 5).toString("latin1") !== "%PDF-") return { status: 415, body: { error: "That file is not a PDF" } };

  const uploadsDir = deps.uploadsDir ?? UPLOADS_DIR;
  const sha = createHash("sha256").update(pdf).digest("hex");
  const pdfPath = join(uploadsDir, input.data.customerId, `${sha}.pdf`);
  await mkdir(join(uploadsDir, input.data.customerId), { recursive: true });
  await writeFile(pdfPath, pdf);

  const committed = [deps.parsedDir ?? PARSED_DIR, deps.sampleParsedDir ?? SAMPLE_PARSED_DIR].map((dir) => join(dir, `${sha}.${SCHEMA_HASH}.json`)).find((entry) => existsSync(entry));
  const parsed = committed
    ? CachedParse.parse(JSON.parse(readFileSync(committed, "utf8")))
    : await createParseCache({ dir: join(uploadsDir, "parsed"), llm: deps.llm }).parse(pdf, `upload-${sha.slice(0, 16)}`);
  return { status: 200, body: { pdfPath, status: parsed.status, bill: parsed.bill, problems: parsed.problems } };
}
