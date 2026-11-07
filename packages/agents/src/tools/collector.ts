import { mkdir, readdir, readFile, rename } from "node:fs/promises";
import { basename, join } from "node:path";
import { setTimeout as sleep } from "node:timers/promises";
import { db as sharedDb, type Db } from "@bill-fighter/db/client";
import { getPlatform } from "@bill-fighter/platform/factory";
import type { Browser, BrowserSession } from "@bill-fighter/platform/types";
import { Provider } from "@bill-fighter/shared/fixtures";
import { portalVaultName } from "@bill-fighter/shared/portal";
import { sql } from "drizzle-orm";
import { z } from "zod";
import { customerAccounts, customerBills, runPaths, RUNS_DIR } from "../customer-data.ts";
import { defineTool, type Target } from "../tool-wrapper.ts";

const testId = (id: string) => `[data-testid="${id}"]`;
const MODAL = testId("session-modal");
const MODAL_DISMISS = testId("session-modal-dismiss");
const ACCOUNT_ROW = testId("account-row");
const USAGE_ROW = `${ACCOUNT_ROW}:has(${testId("account-usage")})`;
const NEXT_PAGE = 'a[rel="next"]';
const USAGE_HEADER = "account_id,ts,kwh";

const SERVER_ACTION_WAIT_MS = 30_000;
const POLL_MS = 100;
const IDLE_CLOSE_MS = 10 * 60_000;
// Far beyond any customer, so a page that always offers a next link fails rather than loops.
const MAX_ACCOUNT_PAGES = 200;

const portalUrl = () => process.env.PORTAL_URL || "http://localhost:3001";
const portalTarget = (): Target[] => [{ kind: "portal", value: portalUrl() }];
const reasonOf = (error: unknown) => (error instanceof Error ? error.message : String(error));

const providersInput = z.strictObject({ providers: z.array(Provider).min(1) });
const customerInput = z.strictObject({ customerId: z.string().min(1) });

// Page content is untrusted, and these ids become file names and selectors.
function safeId(id: string | undefined): string {
  if (!id || !/^\w[\w.-]*$/.test(id)) throw new Error(`The portal gave an unusable id: ${JSON.stringify(id)}`);
  return id;
}

/** Server actions finish after click returns, so wait for what they lead to. */
async function until<T>(what: string, read: () => Promise<T | null>): Promise<T> {
  const deadline = Date.now() + SERVER_ACTION_WAIT_MS;
  for (;;) {
    const value = await read();
    if (value !== null) return value;
    if (Date.now() > deadline) throw new Error(`Timed out waiting for ${what}`);
    await sleep(POLL_MS);
  }
}

async function logIn(session: BrowserSession, provider: Provider) {
  await session.goto(`${portalUrl()}/login?brand=${provider}`);
  await session.fillSecret("#username", portalVaultName(provider, "username"));
  await session.fillSecret("#password", portalVaultName(provider, "password"));
  await session.click(testId("login-submit"));
  await until("the portal to answer the login", async () => {
    const [refused] = await session.texts(testId("login-error"));
    if (refused) throw new Error(`The portal refused the login: ${refused}`);
    return (await session.isVisible(MODAL_DISMISS)) || (await session.isVisible(testId("account-count"))) ? true : null;
  });
  // The modal blocks the whole page until dismissed, and shows once per login.
  if (await session.isVisible(MODAL_DISMISS)) {
    await session.click(MODAL_DISMISS);
    await until("the session modal to close", async () => ((await session.isVisible(MODAL)) ? null : true));
  }
}

/** A login redirect or error page has no rows either, so without this it would read as zero records. */
async function openPage(session: BrowserSession, url: string, marker: string) {
  await session.goto(url);
  if (!(await session.isVisible(marker))) throw new Error(`The portal did not show the expected page at ${url} (no ${marker})`);
}

async function eachAccountPage(session: BrowserSession, visit: () => Promise<void>) {
  for (let page = 1; page <= MAX_ACCOUNT_PAGES; page++) {
    await openPage(session, `${portalUrl()}/accounts?page=${page}`, testId("account-count"));
    await visit();
    if (!(await session.isVisible(NEXT_PAGE))) return;
  }
  throw new Error(`The portal still offers a next page after ${MAX_ACCOUNT_PAGES} pages`);
}

function parseUsageCsv(csv: string, accountId: string) {
  const [header, ...rows] = csv.trimEnd().split("\n");
  if (header !== USAGE_HEADER) throw new Error(`unexpected header ${JSON.stringify(header)}`);
  if (rows.length === 0) throw new Error("no rows");
  const timestamps: string[] = [];
  const kwhs: string[] = [];
  rows.forEach((row, index) => {
    const [account, ts, kwh, extra] = row.split(",");
    const usable = account === accountId && extra === undefined && ts && !Number.isNaN(Date.parse(ts)) && kwh && Number(kwh) >= 0;
    if (!usable) throw new Error(`bad row ${index + 2}`);
    timestamps.push(ts);
    // Kept as text, so the value is stored as the portal printed it.
    kwhs.push(kwh);
  });
  return { timestamps, kwhs };
}

export function createCollectorTools({ db, browser, root = RUNS_DIR }: { db: Db; browser: () => Promise<Browser>; root?: string }) {
  const sessions = new Map<string, { session: BrowserSession; idle: NodeJS.Timeout }>();
  const keyOf = (runId: string, provider: Provider) => `${runId}:${provider}`;

  async function closeSession(key: string) {
    const entry = sessions.get(key);
    if (!entry) return;
    sessions.delete(key);
    clearTimeout(entry.idle);
    await entry.session.close();
  }

  /** Refreshes the idle timer, so a long batch is not closed under itself. */
  function sessionFor(runId: string, provider: Provider): BrowserSession {
    const entry = sessions.get(keyOf(runId, provider));
    if (!entry) throw new Error(`Not logged in to ${provider} in this run. Call portal_login first.`);
    entry.idle.refresh();
    return entry.session;
  }

  // One provider failing must not hide what the others collected, so each reports for itself.
  async function perProvider<T>(providers: Provider[], work: (provider: Provider) => Promise<T>) {
    const unique = [...new Set(providers)];
    const settled = await Promise.allSettled(unique.map(work));
    return {
      done: settled.flatMap((result) => (result.status === "fulfilled" ? [result.value] : [])),
      failed: settled.flatMap((result, index) =>
        result.status === "rejected" ? [{ provider: unique[index]!, reason: reasonOf(result.reason) }] : [],
      ),
    };
  }

  const tools = [
    defineTool({
      name: "portal_login",
      description: "Logs into each provider's portal, using the login held in the vault for it. You never pass or see a password.",
      inputSchema: providersInput,
      targets: portalTarget,
      async handler({ providers }, { runId }) {
        const adapter = await browser();
        const { done, failed } = await perProvider(providers, async (provider) => {
          const key = keyOf(runId, provider);
          await closeSession(key);
          const session = await adapter.open();
          try {
            await logIn(session, provider);
          } catch (error) {
            await session.close();
            throw error;
          }
          // The timer is unref'd and only closes the session. A failed close means the browser has already gone.
          const idle = setTimeout(() => void closeSession(key).catch(() => {}), IDLE_CLOSE_MS);
          idle.unref();
          sessions.set(key, { session, idle });
          return { provider, vaultEntries: [portalVaultName(provider, "username"), portalVaultName(provider, "password")] };
        });
        return { loggedIn: done, failed };
      },
    }),
    defineTool({
      name: "download_bills",
      description: "Downloads every bill each provider's portal offers, across every account. Returns counts per account.",
      inputSchema: providersInput,
      targets: portalTarget,
      async handler({ providers }, { runId }) {
        const { downloadedBills } = runPaths(runId, root);
        const { done, failed } = await perProvider(providers, async (provider) => {
          const session = sessionFor(runId, provider);
          const accountIds: string[] = [];
          await eachAccountPage(session, async () => {
            accountIds.push(...(await session.attributes(ACCOUNT_ROW, "data-account-id")).map(safeId));
          });
          const billsByAccount: Record<string, number> = {};
          for (const accountId of accountIds) {
            sessionFor(runId, provider);
            await openPage(session, `${portalUrl()}/bills?account=${encodeURIComponent(accountId)}`, testId("bill-count"));
            const billIds = (await session.attributes(testId("bill-row"), "data-bill-id")).map(safeId);
            const dir = join(downloadedBills, accountId);
            await mkdir(dir, { recursive: true });
            for (const billId of billIds) {
              await session.download(`[data-bill-id="${billId}"] ${testId("bill-pdf")}`, join(dir, `${billId}.pdf`));
            }
            billsByAccount[accountId] = billIds.length;
          }
          return { provider, bills: Object.values(billsByAccount).reduce((sum, count) => sum + count, 0), billsByAccount };
        });
        return { downloaded: done, failed };
      },
    }),
    defineTool({
      name: "download_usage",
      description: "Downloads the usage CSV of every account each provider's portal offers one for. Returns the accounts covered.",
      inputSchema: providersInput,
      targets: portalTarget,
      async handler({ providers }, { runId }) {
        const { downloadedUsage } = runPaths(runId, root);
        await mkdir(downloadedUsage, { recursive: true });
        const { done, failed } = await perProvider(providers, async (provider) => {
          const session = sessionFor(runId, provider);
          const accounts: string[] = [];
          await eachAccountPage(session, async () => {
            for (const accountId of (await session.attributes(USAGE_ROW, "data-account-id")).map(safeId)) {
              sessionFor(runId, provider);
              await session.download(`[data-account-id="${accountId}"] ${testId("account-usage")}`, join(downloadedUsage, `${accountId}.csv`));
              accounts.push(accountId);
            }
          });
          return { provider, accounts };
        });
        return { downloaded: done, failed };
      },
    }),
    defineTool({
      name: "store_bill",
      description: "Checks and files every bill downloaded in this run for the customer. Parsing reads only filed bills.",
      inputSchema: customerInput,
      targets: () => [],
      async handler({ customerId }, { runId }) {
        const { downloadedBills, storedBills } = runPaths(runId, root);
        const known = new Map((await customerBills(db, customerId)).map((bill) => [bill.id, bill.accountId]));
        await mkdir(storedBills, { recursive: true });
        const accountDirs = await readdir(downloadedBills).catch((error: NodeJS.ErrnoException) => {
          if (error.code === "ENOENT") throw new Error("No bills were downloaded in this run. Call download_bills first.");
          throw error;
        });

        let stored = 0;
        const failed: { billId: string; reason: string }[] = [];
        for (const accountId of accountDirs) {
          for (const file of await readdir(join(downloadedBills, accountId))) {
            const billId = basename(file, ".pdf");
            const path = join(downloadedBills, accountId, file);
            if (known.get(billId) !== accountId) failed.push({ billId, reason: `not on file for account ${accountId} of this customer` });
            else if ((await readFile(path)).subarray(0, 4).toString("latin1") !== "%PDF") failed.push({ billId, reason: "not a PDF" });
            else {
              await rename(path, join(storedBills, `${billId}.pdf`));
              stored++;
            }
          }
        }
        const onFile = (await readdir(storedBills)).filter((file) => known.has(basename(file, ".pdf"))).length;
        return { stored, totalStored: onFile, notCollected: known.size - onFile, failed };
      },
    }),
    defineTool({
      name: "store_usage",
      description: "Checks and saves every usage CSV downloaded in this run for the customer. Returns row counts.",
      inputSchema: customerInput,
      targets: () => [],
      async handler({ customerId }, { runId }) {
        const { downloadedUsage } = runPaths(runId, root);
        const known = new Set((await customerAccounts(db, customerId)).map((account) => account.id));
        const files = await readdir(downloadedUsage).catch((error: NodeJS.ErrnoException) => {
          if (error.code === "ENOENT") throw new Error("No usage was downloaded in this run. Call download_usage first.");
          throw error;
        });

        const rowsByAccount: Record<string, number> = {};
        const failed: { accountId: string; reason: string }[] = [];
        for (const file of files) {
          const accountId = basename(file, ".csv");
          try {
            if (!known.has(accountId)) throw new Error("not an account of this customer");
            const { timestamps, kwhs } = parseUsageCsv(await readFile(join(downloadedUsage, file), "utf8"), accountId);
            // One statement, so a failure stores none of this account. Arrays keep it clear of Postgres's parameter limit.
            await db.execute(sql`
              INSERT INTO usage_intervals (account_id, ts, kwh)
              SELECT ${accountId}, * FROM unnest(${sql.param(timestamps)}::timestamptz[], ${sql.param(kwhs)}::numeric[])
              ON CONFLICT (account_id, ts) DO UPDATE SET kwh = excluded.kwh`);
            rowsByAccount[accountId] = timestamps.length;
          } catch (error) {
            failed.push({ accountId, reason: reasonOf(error) });
          }
        }
        return { accounts: Object.keys(rowsByAccount).length, rows: Object.values(rowsByAccount).reduce((sum, rows) => sum + rows, 0), failed };
      },
    }),
  ];

  return { tools, closeSessions: () => Promise.all([...sessions.keys()].map(closeSession)) };
}

export default createCollectorTools({ db: sharedDb, browser: () => getPlatform().browser() }).tools;
