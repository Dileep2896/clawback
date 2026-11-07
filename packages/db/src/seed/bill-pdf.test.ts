import { createHash } from "node:crypto";
import { existsSync, mkdirSync, mkdtempSync, readdirSync, readFileSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { fileURLToPath, pathToFileURL } from "node:url";
import { GAS_SUPPLIER } from "@bill-fighter/shared/fixtures";
import { getDocument } from "pdfjs-dist/legacy/build/pdf.mjs";
import { chromium, type Browser } from "playwright";
import { afterAll, beforeAll, describe, expect, it, vi } from "vitest";
import { billHtml, billPdfPath, billViews, FIXED_PDF_DATE, readSeedFiles, renderBillPdf, renderBills, stabilizePdf } from "./bill-pdf.ts";
import { generateSeed, writeSeed } from "./generate.ts";
import { money, quantity, rate, type BillView } from "./templates/common.ts";

const SLOW = 180_000;
const FORBIDDEN = /finding|saving|refund|overbill|overcharg|expected|planted|promo|expired|decoy|error|wrong/i;
const REAL_BRANDS = /Pacific Power|PacifiCorp|PG&(amp;)?E|Pacific Gas|AT&(amp;)?T|Comcast|Xfinity|Verizon/i;
const SAMPLE_IDS = [
  "oakland-1-electric-2026-07",
  "fremont-1-electric-2025-08",
  "fremont-1-electric-2025-09",
  "sf-1-telecom-2026-01",
  "sf-2-internet-2026-02",
  "oakland-3-gas-2026-01",
];

const compact = (text: string) => text.replace(/\s+/g, "");
// The stylesheet holds base64 fonts, which match these patterns by chance.
const withoutStyles = (html: string) => html.replace(/<style[\s\S]*?<\/style>/g, "");
const fakePdf = (date: string) => Buffer.from(`%PDF\n<</CreationDate (${date})\n/ModDate (${date})>>\nbody`, "latin1");

async function readPdf(pdf: Buffer) {
  const task = getDocument({ data: new Uint8Array(pdf), verbosity: 0 });
  try {
    const doc = await task.promise;
    const page = await doc.getPage(1);
    const { items } = await page.getTextContent();
    const { info } = await doc.getMetadata();
    return {
      pages: doc.numPages,
      text: items.map((item) => ("str" in item ? item.str : "")).join(" "),
      info: info as Record<string, string>,
    };
  } finally {
    await task.destroy();
  }
}

let views: BillView[];
const viewOf = (id: string) => views.find((v) => v.bill.id === id)!;

beforeAll(() => {
  vi.spyOn(console, "info").mockImplementation(() => {});
  vi.spyOn(console, "warn").mockImplementation(() => {});
  views = billViews(generateSeed());
}, SLOW);

describe("stabilizePdf", () => {
  it("makes PDFs from different moments identical, at the same length", () => {
    const a = stabilizePdf(fakePdf("D:20261107010700+00'00'"));
    const b = stabilizePdf(fakePdf("D:20301231235959-08'00'"));
    expect(a.equals(b)).toBe(true);
    expect(a.length).toBe(fakePdf("D:20261107010700+00'00'").length);
    expect(a.toString("latin1")).toContain(`/ModDate (${FIXED_PDF_DATE})`);
  });

  it("throws rather than pass a PDF it could not make stable", () => {
    expect(() => stabilizePdf(Buffer.from("%PDF no dates"))).toThrow(/found: none/);
    expect(() => stabilizePdf(Buffer.from("/CreationDate (D:20261107010700+00'00')"))).toThrow(/found: CreationDate/);
    expect(() => stabilizePdf(fakePdf("D:2026"))).toThrow(/date format/);
  });
});

describe("number formats", () => {
  const digits = (text: string) => Number(text.replace(/[$,]/g, ""));

  it("prints every quantity and rate exactly as the fixture holds it", () => {
    for (const { bill } of views) {
      for (const line of bill.lines) {
        if (line.quantity !== null) expect(digits(quantity(line.quantity))).toBe(line.quantity);
        if (line.rate !== null) expect(digits(rate(line.rate))).toBe(line.rate);
        expect(Math.round(digits(money(line.amountCents)) * 100)).toBe(line.amountCents);
      }
    }
  });
});

describe("bill HTML", () => {
  it("covers all 448 bills with the demo mark and no answer or real brand on any of them", () => {
    expect(views).toHaveLength(448);
    for (const view of views) {
      const html = withoutStyles(billHtml(view));
      expect(html).toContain("Demo data");
      expect(html).not.toMatch(FORBIDDEN);
      expect(html).not.toMatch(REAL_BRANDS);
    }
  });

  it("takes the gas supplier name from GAS_SUPPLIER and never hard codes it", () => {
    for (const view of views.filter((v) => v.account.provider === GAS_SUPPLIER.provider)) {
      expect(billHtml(view)).toContain(GAS_SUPPLIER.name);
    }
    const dir = fileURLToPath(new URL("templates/", import.meta.url));
    for (const file of readdirSync(dir).filter((name) => name.endsWith(".ts"))) {
      expect(readFileSync(join(dir, file), "utf8")).not.toContain(GAS_SUPPLIER.name);
    }
  });

  it("prints the bill's own meter and multiplier, not the account's", () => {
    const before = viewOf("fremont-1-electric-2025-08");
    expect(before.account.meterNumber).toBe("BEM-2214077");
    expect(billHtml(before)).toContain("BEM-1009011");
    expect(billHtml(before)).not.toContain("BEM-2214077");
  });

  it("escapes fixture text", () => {
    const view = viewOf("sf-2-internet-2026-02");
    const customer = { ...view.customer, name: `A&B <i>"x"</i>` };
    expect(withoutStyles(billHtml({ ...view, customer }))).toContain("A&amp;B &lt;i&gt;&quot;x&quot;&lt;/i&gt;");
  });
});

describe("seed files", () => {
  it("reads back what writeSeed wrote", () => {
    const dir = mkdtempSync(join(tmpdir(), "bill-seed-"));
    try {
      const seed = generateSeed();
      writeSeed(seed, pathToFileURL(`${dir}/`));
      expect(billViews(readSeedFiles(pathToFileURL(`${dir}/`)))).toEqual(views);
    } finally {
      rmSync(dir, { recursive: true, force: true });
    }
  }, SLOW);

  it("says which command to run when the seed is missing", () => {
    expect(() => readSeedFiles(pathToFileURL(`${tmpdir()}/no-such-seed/`))).toThrow(/generate\.ts/);
  });

  it("refuses a bill with no account", () => {
    const { bill, location, customer } = views[0]!;
    expect(() => billViews({ customer, locations: [location], accounts: [], bills: [bill] })).toThrow(bill.id);
  });

  it("points at data/bills", () => {
    expect(billPdfPath({ id: "x-2026-01" })).toBe("data/bills/x-2026-01.pdf");
  });
});

describe("a failed render", () => {
  const fakeBrowser = {
    newPage: () => Promise.reject(new Error("render failed")),
    close: () => Promise.resolve(),
  } as unknown as Browser;

  it.each([
    ["Chromium is missing", () => Promise.reject(new Error("Executable doesn't exist")), /Executable doesn't exist/],
    ["a bill fails to render", () => Promise.resolve(fakeBrowser), /render failed/],
  ] as const)("keeps the existing PDFs when %s", async (_, launch, message) => {
    const parent = mkdtempSync(join(tmpdir(), "bill-rerun-"));
    const spy = vi.spyOn(chromium, "launch").mockImplementation(launch);
    try {
      mkdirSync(join(parent, "bills"));
      writeFileSync(join(parent, "bills", "kept.pdf"), "from the last good run");
      await expect(
        renderBills(views, { dir: pathToFileURL(`${parent}/bills/`), staging: pathToFileURL(`${parent}/staging/`) }),
      ).rejects.toThrow(message);
      expect(readFileSync(join(parent, "bills", "kept.pdf"), "utf8")).toBe("from the last good run");
      expect(readdirSync(parent)).toEqual(["bills"]);
    } finally {
      spy.mockRestore();
      rmSync(parent, { recursive: true, force: true });
    }
  });
});

const hasChromium = existsSync(chromium.executablePath());
if (!hasChromium) {
  // Not console.warn: vitest hides console output from a passing file, and this skip must be seen.
  process.stderr.write("WARNING: skipping bill PDF browser tests, Chromium is missing. Run `pnpm exec playwright install chromium`.\n");
}

describe.skipIf(!hasChromium)("rendered PDFs", () => {
  let dir: string;
  const pdfOf = (id: string) => readFileSync(join(dir, `${id}.pdf`));

  beforeAll(async () => {
    dir = mkdtempSync(join(tmpdir(), "bill-pdfs-"));
    writeFileSync(join(dir, "stale.pdf"), "left over from an older seed");
    await renderBills(views, { dir: pathToFileURL(`${dir}/`), staging: pathToFileURL(`${dir}.staging/`) });
  }, SLOW);

  afterAll(() => rmSync(dir, { recursive: true, force: true }));

  it("writes one PDF per bill and clears stale files", () => {
    expect(readdirSync(dir).sort()).toEqual(views.map((v) => `${v.bill.id}.pdf`).sort());
    expect(readdirSync(dir)).toHaveLength(448);
  });

  it("gives identical bytes from a new browser, in a different order, with the clock moved on", async () => {
    await new Promise((resolve) => setTimeout(resolve, 1100));
    const browser = await chromium.launch();
    try {
      for (const id of [...SAMPLE_IDS].reverse()) {
        const again = await renderBillPdf(browser, viewOf(id));
        expect(createHash("sha256").update(again).digest("hex")).toBe(createHash("sha256").update(pdfOf(id)).digest("hex"));
      }
    } finally {
      await browser.close();
    }
  }, SLOW);

  it("stamps the fixed date and embeds only the bundled font", async () => {
    for (const id of SAMPLE_IDS) {
      const pdf = pdfOf(id);
      const { info } = await readPdf(pdf);
      expect(info.CreationDate).toBe(FIXED_PDF_DATE);
      expect(info.ModDate).toBe(FIXED_PDF_DATE);
      const fonts = pdf.toString("latin1").match(/\/BaseFont\s*\/[^\s/]+/g) ?? [];
      expect(fonts.length).toBeGreaterThan(0);
      for (const font of fonts) expect(font).toMatch(/\+IBMPlexSans-/);
    }
  }, SLOW);

  it("extracts account, meter, multiplier and every line on all 448 bills, on one clean page", async () => {
    for (const { bill, account } of views) {
      const { pages, text, info } = await readPdf(pdfOf(bill.id));
      expect(pages, bill.id).toBe(1);
      const extracted = compact(text);
      expect(extracted, bill.id).toContain(compact(`Account number ${account.accountNumber}`));
      expect(extracted, bill.id).toContain(compact(`Amount due ${money(bill.totalCents)}`));
      expect(extracted, bill.id).toContain("Demodata");
      for (const line of bill.lines) {
        const row = [
          line.description,
          line.quantity === null ? "" : quantity(line.quantity),
          line.unit ?? "",
          line.rate === null ? "" : rate(line.rate),
          money(line.amountCents),
        ].join("");
        expect(extracted, `${bill.id} ${line.description}`).toContain(compact(row));
      }
      if (account.serviceType === "electric") {
        expect(extracted, bill.id).toContain(compact(`Meter number ${bill.meterNumber}`));
        expect(extracted, bill.id).toContain(compact(`Meter multiplier ${bill.multiplier} Rate schedule ${bill.rateSchedule}`));
      } else {
        expect(extracted, bill.id).not.toContain("Meter");
        expect(extracted, bill.id).toContain(compact(`Plan code ${bill.planCode}`));
      }
      expect(text, bill.id).not.toMatch(FORBIDDEN);
      expect(text, bill.id).not.toMatch(REAL_BRANDS);
      expect(JSON.stringify(info), bill.id).not.toMatch(FORBIDDEN);
    }
  }, SLOW);

  it("shows the Fremont #1 swap: old meter x1 in August 2025, new meter x2 in September 2025", async () => {
    const before = compact((await readPdf(pdfOf("fremont-1-electric-2025-08"))).text);
    const after = compact((await readPdf(pdfOf("fremont-1-electric-2025-09"))).text);
    expect(before).toContain("MeternumberBEM-1009011");
    expect(before).toContain("Metermultiplier1Rate");
    expect(after).toContain("MeternumberBEM-2214077");
    expect(after).toContain("Metermultiplier2Rate");
    expect(after).toContain(compact("Off-Peak Summer energy 3,508.236 kWh $0.38491 $1,350.36"));
  }, SLOW);

  it("shows the gas supplier's name on a gas bill", async () => {
    expect((await readPdf(pdfOf("oakland-3-gas-2026-01"))).text).toContain(GAS_SUPPLIER.name);
  }, SLOW);
});
