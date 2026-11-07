import { dollars } from "@bill-fighter/core/rules/input";
import { NAME as BAYCURRENT } from "@bill-fighter/db/seed/templates/baycurrent";
import { NAME as BAYTEL } from "@bill-fighter/db/seed/templates/baytel";
import type { FindingEvidence } from "@bill-fighter/shared/finding";
import { PDFDocument, type PDFFont, StandardFonts } from "pdf-lib";
import { z } from "zod";

export const LETTER_KINDS = { meterMultiplierJump: "claim", rateOptimization: "plan_change", unusedLines: "letter" } as const;

export type LetterFinding = { type: string; refundCents: number; annualSavingsCents: number; evidence: FindingEvidence };

const cents = z.number().int();

// Parsed, so a rule changing its detail fails the letter instead of printing "$NaN" to a provider.
const meterDetail = z.object({
  swapMonth: z.string(),
  oldMeter: z.string(),
  newMeter: z.string(),
  kwhRatio: z.number(),
  bills: z.array(z.object({ billId: z.string(), periodStart: z.string(), billedCents: cents, correctCents: cents, overbilledCents: cents })),
});
const rateDetail = z.object({
  currentSchedule: z.string(),
  proposedSchedule: z.string(),
  windowStart: z.string(),
  windowEnd: z.string(),
  schedules: z.array(z.object({ schedule: z.string(), annualCents: cents })),
});
const lineDetail = z.object({
  number: z.string(),
  label: z.string().nullable(),
  callsLast12mo: z.number().int(),
  monthlyCents: cents,
  action: z.literal("cancel"),
});

function letterFacts({ type, refundCents, annualSavingsCents, evidence }: LetterFinding) {
  const yearly = `Yearly savings: ${dollars(annualSavingsCents)}`;
  if (type === "meterMultiplierJump") {
    const detail = meterDetail.parse(evidence.detail);
    return {
      title: "Electric Rule 17.1 billing adjustment claim",
      provider: BAYCURRENT,
      facts: [
        `Refund claimed: ${dollars(refundCents)}`,
        yearly,
        `Meter ${detail.oldMeter} was replaced by ${detail.newMeter} in ${detail.swapMonth}. Billed usage since then is ${detail.kwhRatio} times the interval data.`,
        // The claim window's bills only, so the table adds up to the refund.
        ...detail.bills
          .filter((bill) => evidence.billIds.includes(bill.billId))
          .map((bill) => `${bill.periodStart}: billed ${dollars(bill.billedCents)}, correct ${dollars(bill.correctCents)}, overbilled ${dollars(bill.overbilledCents)}`),
      ],
    };
  }
  if (type === "rateOptimization") {
    const detail = rateDetail.parse(evidence.detail);
    return {
      title: "Rule 12 rate schedule change request",
      provider: BAYCURRENT,
      facts: [
        `Current schedule: ${detail.currentSchedule}`,
        `Requested schedule: ${detail.proposedSchedule}`,
        yearly,
        `Usage re-priced from ${detail.windowStart} to ${detail.windowEnd}:`,
        ...detail.schedules.map((option) => `${option.schedule}: ${dollars(option.annualCents)} a year`),
      ],
    };
  }
  if (type === "unusedLines") {
    const detail = lineDetail.parse(evidence.detail);
    return {
      title: "Request to cancel an unused phone line",
      provider: BAYTEL,
      facts: [
        `Line: ${detail.number}${detail.label ? ` (${detail.label})` : ""}`,
        `Calls in the last 12 months: ${detail.callsLast12mo}`,
        `Monthly cost: ${dollars(detail.monthlyCents)}`,
        yearly,
      ],
    };
  }
  throw new Error(`Findings of type ${type} get no letter`);
}

const PAGE: [number, number] = [612, 792];
const MARGIN = 60;
const SIZE = 11;
const LEADING = 15;

/** Claude's wording sits between facts that code prints from the finding, so every number comes from the finding. */
export async function renderLetter({
  finding,
  accountNumber,
  customerName,
  contactName,
  wording,
}: {
  finding: LetterFinding;
  accountNumber: string;
  customerName: string;
  contactName: string;
  wording: string;
}): Promise<Uint8Array> {
  const { title, provider, facts } = letterFacts(finding);
  const doc = await PDFDocument.create();
  const regular = await doc.embedFont(StandardFonts.Helvetica);
  const bold = await doc.embedFont(StandardFonts.HelveticaBold);
  // Helvetica throws on a character it cannot encode, and model text may hold one.
  const encodable = new Set(regular.getCharacterSet());
  const clean = (word: string) => [...word].map((char) => (encodable.has(char.codePointAt(0)!) ? char : "?")).join("");

  let page = doc.addPage(PAGE);
  let y = PAGE[1] - MARGIN;
  const writeLine = (text: string, font: PDFFont) => {
    if (y < MARGIN) {
      page = doc.addPage(PAGE);
      y = PAGE[1] - MARGIN;
    }
    page.drawText(text, { x: MARGIN, y, size: SIZE, font });
    y -= LEADING;
  };
  const paragraph = (text: string, font: PDFFont = regular, gap = LEADING / 2) => {
    let line = "";
    for (const word of text.split(/\s+/).filter(Boolean).map(clean)) {
      const longer = line ? `${line} ${word}` : word;
      if (line && font.widthOfTextAtSize(longer, SIZE) > PAGE[0] - 2 * MARGIN) {
        writeLine(line, font);
        line = word;
      } else {
        line = longer;
      }
    }
    if (line) writeLine(line, font);
    y -= gap;
  };

  paragraph(title, bold);
  paragraph(`To: ${provider}`);
  paragraph(`From: Bill Fighter, as authorized agent for ${customerName}`);
  paragraph(`Account: ${accountNumber}`);
  paragraph(`Date: ${new Date().toISOString().slice(0, 10)}`);
  for (const text of wording.split(/\n+/)) paragraph(text);
  for (const fact of facts) paragraph(fact, regular, 1);
  y -= LEADING / 2;
  paragraph(`Evidence attached: ${finding.evidence.billIds.join(", ")}`);
  paragraph(`Authorized by ${contactName}.`);
  paragraph("Demo data: the customer and provider are fictional.");
  return doc.save();
}

export async function mergeEvidence(letter: Uint8Array, billPdfs: Uint8Array[]): Promise<Uint8Array> {
  const merged = await PDFDocument.load(letter);
  for (const bytes of billPdfs) {
    const bill = await PDFDocument.load(bytes);
    for (const page of await merged.copyPages(bill, bill.getPageIndices())) merged.addPage(page);
  }
  return merged.save();
}
