import { mkdirSync, readdirSync, readFileSync, renameSync, rmSync, writeFileSync } from "node:fs";
import { pathToFileURL } from "node:url";
import {
  AccountFixture,
  BillFixture,
  CustomerFixture,
  LocationFixture,
  type Provider,
} from "@bill-fighter/shared/fixtures";
import { chromium, type Browser } from "playwright";
import { bayconnect } from "./templates/bayconnect.ts";
import { baycurrent } from "./templates/baycurrent.ts";
import { bayhearth } from "./templates/bayhearth.ts";
import { baytel } from "./templates/baytel.ts";
import type { BillView, Template } from "./templates/common.ts";

const SEED_DIR = new URL("../../../../data/seed/", import.meta.url);
const BILLS_DIR = new URL("../../../../data/bills/", import.meta.url);

const TEMPLATES: Record<Provider, Template> = { baycurrent, baytel, bayconnect, bayhearth };

// Any fixed value of the same width works. Same width keeps the PDF's byte offsets valid.
export const FIXED_PDF_DATE = "D:20260101000000+00'00'";

export const billPdfPath = (bill: Pick<BillFixture, "id">) => `data/bills/${bill.id}.pdf`;

export const billHtml = (view: BillView) => TEMPLATES[view.account.provider](view);

// Chromium stamps the wall clock into two fields, the only bytes that differ between runs.
// bill-parser keys its committed cache on the PDF's sha256, so a stamp would miss the cache on stage.
export function stabilizePdf(pdf: Buffer): Buffer {
  const keys: string[] = [];
  const text = pdf.toString("latin1").replace(/\/(CreationDate|ModDate) \((D:[^)]*)\)/g, (_, key: string, value: string) => {
    if (value.length !== FIXED_PDF_DATE.length) throw new Error(`Unexpected PDF date format: ${value}`);
    keys.push(key);
    return `/${key} (${FIXED_PDF_DATE})`;
  });
  if (keys.sort().join() !== "CreationDate,ModDate") {
    throw new Error(`Expected one CreationDate and one ModDate in the PDF, found: ${keys.join() || "none"}`);
  }
  return Buffer.from(text, "latin1");
}

export async function renderBillPdf(browser: Browser, view: BillView): Promise<Buffer> {
  const page = await browser.newPage();
  try {
    await page.setContent(billHtml(view), { waitUntil: "load" });
    await page.evaluate("document.fonts.ready.then(() => true)");
    return stabilizePdf(await page.pdf({ format: "Letter", printBackground: true }));
  } finally {
    await page.close();
  }
}

export function billViews({ customer, locations, accounts, bills }: {
  customer: CustomerFixture;
  locations: LocationFixture[];
  accounts: AccountFixture[];
  bills: BillFixture[];
}): BillView[] {
  return bills.map((bill) => {
    const account = accounts.find((a) => a.id === bill.accountId);
    const location = locations.find((l) => l.id === account?.locationId);
    if (!account || !location) throw new Error(`Bill ${bill.id} has no account or location in the seed`);
    return { bill, account, location, customer };
  });
}

export function readSeedFiles(dir: URL = SEED_DIR) {
  let customerFile, billsFile;
  try {
    customerFile = readFileSync(new URL("customer.json", dir), "utf8");
    billsFile = readFileSync(new URL("bills.json", dir), "utf8");
  } catch (cause) {
    throw new Error("No seed fixtures. Run `pnpm exec tsx packages/db/src/seed/generate.ts` first.", { cause });
  }
  const { customer, locations, accounts } = JSON.parse(customerFile) as {
    customer: unknown;
    locations: unknown[];
    accounts: unknown[];
  };
  return {
    customer: CustomerFixture.parse(customer),
    locations: locations.map((row) => LocationFixture.parse(row)),
    accounts: accounts.map((row) => AccountFixture.parse(row)),
    bills: (JSON.parse(billsFile) as unknown[]).map((row) => BillFixture.parse(row)),
  };
}

export async function renderBills(views: BillView[], dir: URL = BILLS_DIR) {
  // Render aside, so a failed run keeps the PDFs the database already points at.
  const staging = new URL(dir.href.replace(/\/$/, ".staging/"));
  rmSync(staging, { recursive: true, force: true });
  mkdirSync(staging, { recursive: true });
  try {
    const browser = await chromium.launch();
    try {
      for (const view of views) {
        writeFileSync(new URL(`${view.bill.id}.pdf`, staging), await renderBillPdf(browser, view));
      }
    } finally {
      await browser.close();
    }
    const written = readdirSync(staging).length;
    if (written !== views.length) throw new Error(`Wrote ${written} PDFs for ${views.length} bills`);
    // shortcut: a crash between these two lines leaves dir missing, the next `pnpm seed` restores it.
    rmSync(dir, { recursive: true, force: true }); // A removed bill must not leave an old PDF behind.
    renameSync(staging, dir);
  } finally {
    rmSync(staging, { recursive: true, force: true });
  }
}

if (process.argv[1] && import.meta.url === pathToFileURL(process.argv[1]).href) {
  const views = billViews(readSeedFiles());
  await renderBills(views);
  console.info(`Wrote ${views.length} PDFs to data/bills/`);
}
