import { mkdirSync, mkdtempSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { accounts, bills, customers, locations, phoneLines, usageIntervals } from "@bill-fighter/db/schema";
import { withTestDb } from "@bill-fighter/db/test-db";
import { afterAll, describe, expect, it } from "vitest";
import { billFile, findBill, listBills, money, readBillPdf } from "./bills.ts";
import { listLines } from "./lines.ts";
import { usageCsv } from "./usage.ts";

const ROOT = "/repo";

describe("billFile", () => {
  it("accepts a file inside the bills folder", () => {
    expect(billFile("data/bills/a.pdf", ROOT)).toBe("/repo/data/bills/a.pdf");
  });

  it.each([
    null,
    "",
    "../package.json",
    "data/bills/../../package.json",
    "data/bills/../seed/portal-credentials.json",
    "data/bills-other/a.pdf",
    "data/bills",
    "data/bills/",
    "/etc/passwd",
  ])("refuses %s", (path) => {
    expect(billFile(path, ROOT)).toBeNull();
  });
});

describe("readBillPdf", () => {
  const root = mkdtempSync(join(tmpdir(), "portal-bills-"));
  mkdirSync(join(root, "data/bills"), { recursive: true });
  writeFileSync(join(root, "data/bills/a.pdf"), "pdf bytes");
  writeFileSync(join(root, "secret.txt"), "secret");
  afterAll(() => rmSync(root, { recursive: true, force: true }));

  it("reads the exact bytes of a bill", async () => {
    expect((await readBillPdf("data/bills/a.pdf", root))?.toString()).toBe("pdf bytes");
  });

  it("gives null for a missing file and for a real file outside the folder", async () => {
    expect(await readBillPdf("data/bills/missing.pdf", root)).toBeNull();
    expect(await readBillPdf("secret.txt", root)).toBeNull();
  });

  it("throws on a read failure that is not a missing file", async () => {
    await expect(readBillPdf("data/bills/a.pdf/nested.pdf", root)).rejects.toMatchObject({ code: "ENOTDIR" });
  });
});

describe("money", () => {
  it("formats cents as dollars", () => {
    expect(money(123456)).toBe("$1,234.56");
  });
});

describe("provider isolation", () => {
  it("only gives a provider its own bills, usage and lines", async () => {
    await withTestDb("portal_downloads", async (db) => {
      await db.insert(customers).values({
        id: "c",
        name: "Test Noodle Co",
        contactName: "Test Owner",
        contactEmail: "owner@billfighter.local",
        contactPhone: "+15550001111",
      });
      await db.insert(locations).values({ id: "store", customerId: "c", name: "Store", address: "1 Test St", city: "Oakland" });
      await db.insert(accounts).values([
        { id: "power", locationId: "store", provider: "baycurrent", accountNumber: "E-1", serviceType: "electric" },
        { id: "phone", locationId: "store", provider: "baytel", accountNumber: "T-1", serviceType: "telecom" },
      ]);
      await db.insert(bills).values([
        { id: "power-feb", accountId: "power", periodStart: "2026-02-01", periodEnd: "2026-02-28", totalCents: 200, pdfPath: "data/bills/power-feb.pdf" },
        { id: "power-jan", accountId: "power", periodStart: "2026-01-01", periodEnd: "2026-01-31", totalCents: 100, pdfPath: "data/bills/power-jan.pdf" },
        { id: "phone-jan", accountId: "phone", periodStart: "2026-01-01", periodEnd: "2026-01-31", totalCents: 300, pdfPath: "data/bills/phone-jan.pdf" },
      ]);
      await db.insert(usageIntervals).values([
        { accountId: "power", ts: new Date("2026-01-01T08:15:00Z"), kwh: 0.5 },
        { accountId: "power", ts: new Date("2026-01-01T08:00:00Z"), kwh: 1.25 },
      ]);
      await db.insert(phoneLines).values([
        { id: "line-2", accountId: "phone", number: "(415) 555-0102", label: "Fax", monthlyCents: 6000, callsLast12mo: 0, purpose: "fax" },
        { id: "line-1", accountId: "phone", number: "(415) 555-0101", label: "Main", monthlyCents: 4500, callsLast12mo: 900, purpose: "voice" },
      ]);

      const own = await listBills(db, "baycurrent", "power");
      expect(own?.account).toEqual({ accountNumber: "E-1", locationName: "Store" });
      expect(own?.rows.map((b) => b.id)).toEqual(["power-jan", "power-feb"]);
      expect(await listBills(db, "baytel", "power")).toBeNull();
      expect(await listBills(db, "baycurrent", "no-such-account")).toBeNull();

      expect(await findBill(db, "baycurrent", "power-jan")).toEqual({ id: "power-jan", pdfPath: "data/bills/power-jan.pdf" });
      expect(await findBill(db, "baytel", "power-jan")).toBeNull();
      expect(await findBill(db, "baycurrent", "../../package.json")).toBeNull();

      expect(await usageCsv(db, "baycurrent", "power")).toBe(
        "account_id,ts,kwh\npower,2026-01-01T08:00:00.000Z,1.25\npower,2026-01-01T08:15:00.000Z,0.5\n",
      );
      expect(await usageCsv(db, "baytel", "power")).toBeNull();
      expect(await usageCsv(db, "baytel", "phone")).toBeNull();

      expect((await listLines(db, "baytel")).map((l) => l.id)).toEqual(["line-1", "line-2"]);
      expect(await listLines(db, "baycurrent")).toEqual([]);
    });
  });
});
