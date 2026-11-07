import { writeFile } from "node:fs/promises";
import { join } from "node:path";
import type { Db } from "@bill-fighter/db/client";
import { accounts, bills, findings, locations, phoneLines } from "@bill-fighter/db/schema";
import { seedRun } from "@bill-fighter/db/test-db";
import { PDFDocument } from "pdf-lib";
import type { AgentTool } from "./tool-wrapper.ts";

export const ALARM_NUMBER = "(510) 555-0199";
export const FAX_NUMBER = "(510) 555-0142";

export const METER_DETAIL = {
  swapMonth: "2025-08",
  oldMeter: "M-OLD",
  newMeter: "M-NEW",
  kwhRatio: 2,
  // bill-base is the baseline, outside the claim, so its figures must not print.
  bills: [
    { billId: "bill-base", periodStart: "2025-07-01", billedCents: 77_700, correctCents: 77_700, overbilledCents: 0 },
    { billId: "bill-a", periodStart: "2025-08-01", billedCents: 180_000, correctCents: 90_000, overbilledCents: 90_000 },
    { billId: "bill-b", periodStart: "2025-09-01", billedCents: 170_000, correctCents: 85_000, overbilledCents: 85_000 },
  ],
};
export const METER_AMOUNTS = ["$1,750.00", "$1,234.00", "$1,800.00", "$900.00", "$1,700.00", "$850.00"];

export const RATE_DETAIL = {
  currentSchedule: "B-10",
  proposedSchedule: "B-6",
  windowStart: "2025-08-01",
  windowEnd: "2026-07-31",
  schedules: [
    { schedule: "B-10", annualCents: 2_000_000 },
    { schedule: "B-6", annualCents: 1_920_000 },
  ],
};
export const RATE_AMOUNTS = ["$800.00", "$20,000.00", "$19,200.00"];

export const LINE_DETAIL = { number: FAX_NUMBER, label: "Fax", purpose: "fax", callsLast12mo: 0, monthlyCents: 6_000, action: "cancel" };
export const LINE_AMOUNTS = ["$60.00", "$720.00"];

/** Runs a tool the way the runtime does: MCP validates the input first. */
export const run = (tools: AgentTool[], name: string, input: unknown, runId: string, agent = "test") => {
  const tool = tools.find((candidate) => candidate.name === name);
  if (!tool) throw new Error(`No tool ${name}`);
  return tool.handler(tool.inputSchema.parse(input), { runId, agent }) as Promise<never>;
};

export const amountsOf = (text: string) => text.match(/\$[\d,]+\.\d{2}/g) ?? [];

async function billPdf(text: string) {
  const doc = await PDFDocument.create();
  doc.addPage().drawText(text);
  return doc.save();
}

/** One customer on one run, with a finding of each type in the shape the rules write. Bill PDFs go in dir, when a test reads them. */
export async function seedFindings(db: Db, runId: string, dir?: string) {
  const { customerId } = await seedRun(db, runId);
  const id = (name: string) => `${runId}-${name}`;
  await db.insert(locations).values({ id: id("store"), customerId, name: "Store", address: "1 Main St", city: "Oakland" });
  await db.insert(accounts).values([
    { id: id("electric"), locationId: id("store"), provider: "baycurrent", serviceType: "electric", accountNumber: `E-${runId}`, rateSchedule: "B-10" },
    { id: id("telecom"), locationId: id("store"), provider: "baytel", serviceType: "telecom", accountNumber: `BT-${runId}` },
    { id: id("internet"), locationId: id("store"), provider: "bayconnect", serviceType: "internet", accountNumber: `BC-${runId}` },
  ]);
  for (const name of ["bill-a", "bill-b"]) {
    const pdfPath = dir ? join(dir, `${id(name)}.pdf`) : null;
    if (pdfPath) await writeFile(pdfPath, await billPdf(`Bill ${name}`));
    await db.insert(bills).values({ id: id(name), accountId: id("electric"), periodStart: "2025-08-01", periodEnd: "2025-08-31", totalCents: 180_000, pdfPath });
  }
  await db.insert(phoneLines).values([
    { id: id("fax"), accountId: id("telecom"), number: FAX_NUMBER, label: "Fax", monthlyCents: 6_000, callsLast12mo: 0, purpose: "fax" },
    { id: id("alarm"), accountId: id("telecom"), number: ALARM_NUMBER, label: "Alarm", monthlyCents: 6_000, callsLast12mo: 3, purpose: "alarm" },
  ]);

  const billIds = [id("bill-a"), id("bill-b")];
  const finding = (name: string, accountId: string, type: string, evidenceJson: unknown, refundCents = 0, annualSavingsCents = 0) => ({
    id: id(name),
    customerId,
    accountId: id(accountId),
    type,
    title: name,
    explanation: name,
    evidenceJson,
    refundCents,
    annualSavingsCents,
    confidence: 0.9,
  });
  const lineEvidence = (line: string, detail: unknown) => ({ billIds, billLineIds: [], phoneLineIds: [id(line)], detail });
  await db.insert(findings).values([
    finding(
      "meter",
      "electric",
      "meterMultiplierJump",
      {
        billIds,
        billLineIds: [],
        phoneLineIds: [],
        detail: { ...METER_DETAIL, bills: METER_DETAIL.bills.map((bill) => ({ ...bill, billId: bill.billId === "bill-base" ? "bill-base" : id(bill.billId) })) },
      },
      175_000,
      123_400,
    ),
    finding("rate", "electric", "rateOptimization", { billIds, billLineIds: [], phoneLineIds: [], detail: RATE_DETAIL }, 0, 80_000),
    finding("unused", "telecom", "unusedLines", lineEvidence("fax", LINE_DETAIL), 0, 72_000),
    finding("alarm", "telecom", "unusedLines", lineEvidence("alarm", { ...LINE_DETAIL, number: ALARM_NUMBER, purpose: "alarm", action: "confirmWithAlarmCompany" })),
    // Says "cancel" by mistake: phone_lines still knows it is an alarm line.
    finding("alarm-mislabelled", "telecom", "unusedLines", lineEvidence("alarm", { ...LINE_DETAIL, number: ALARM_NUMBER, purpose: "fax", action: "cancel" })),
    finding("promo", "internet", "promoExpiry", { billIds, billLineIds: [], phoneLineIds: [], detail: {} }, 0, 108_000),
    finding("supplier", "electric", "thirdPartySupplier", { billIds, billLineIds: [], phoneLineIds: [], detail: {} }),
  ]);
  return { customerId, id };
}
