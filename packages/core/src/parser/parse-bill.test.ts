import type { ParsedBill } from "@bill-fighter/shared/parsed-bill";
import { describe, expect, it, vi } from "vitest";
import { parseBill, type Extract } from "./parse-bill.ts";
import { pdfPageImages, pdfText } from "./pdf.ts";

// A smallest valid one page PDF with the text "Hello bill". pdfjs repairs the missing xref offsets.
const PDF = Buffer.from(
  `%PDF-1.4
1 0 obj<</Type/Catalog/Pages 2 0 R>>endobj
2 0 obj<</Type/Pages/Kids[3 0 R]/Count 1>>endobj
3 0 obj<</Type/Page/Parent 2 0 R/MediaBox[0 0 200 100]/Contents 4 0 R/Resources<</Font<</F1 5 0 R>>>>>>endobj
4 0 obj<</Length 41>>stream
BT /F1 12 Tf 10 50 Td (Hello bill) Tj ET
endstream endobj
5 0 obj<</Type/Font/Subtype/Type1/BaseFont/Helvetica>>endobj
trailer<</Root 1 0 R/Size 6>>
%%EOF`,
);

const GOOD: ParsedBill = {
  accountNumber: "A-1",
  serviceAddress: null,
  providerName: "Provider",
  serviceType: "internet",
  meterNumber: null,
  multiplier: null,
  rateSchedule: null,
  planCode: "P1",
  periodStart: "2026-01-01",
  periodEnd: "2026-01-31",
  kwhByTouPeriod: [],
  maxKw: null,
  lineItems: [{ description: "Internet", quantity: 1, unit: "month", rate: 50, amountCents: 5000, lineType: "internet" }],
  totalCents: 5000,
};
const BAD_SUM = { ...GOOD, totalCents: 5001 };

const extractReturning = (...outputs: unknown[]) => {
  const extract = vi.fn<Extract>();
  for (const output of outputs) extract.mockResolvedValueOnce(output);
  return extract;
};

describe("pdf helpers", () => {
  it("extracts text", async () => {
    expect(await pdfText(PDF)).toContain("Hello bill");
  });

  it("renders each page to a PNG", async () => {
    const images = await pdfPageImages(PDF);
    expect(images).toHaveLength(1);
    expect(images[0]!.mediaType).toBe("image/png");
    expect(Buffer.from(images[0]!.base64, "base64").subarray(1, 4).toString()).toBe("PNG");
  });

  it("leaves the caller's bytes usable", async () => {
    const pdf = new Uint8Array(PDF);
    await pdfText(pdf);
    expect(await pdfText(pdf)).toContain("Hello bill");
  });
});

describe("parseBill", () => {
  it("stops after the text pass when the bill validates", async () => {
    const extract = extractReturning(GOOD);
    expect(await parseBill({ pdf: PDF, extract })).toEqual({ status: "parsed", bill: GOOD, problems: [], attempts: 1 });
    expect(extract).toHaveBeenCalledOnce();
    expect(extract.mock.calls[0]![0].prompt).toContain("Hello bill");
    expect(extract.mock.calls[0]![0].images).toBeUndefined();
  });

  it("retries once with page images, and accepts a retry that validates", async () => {
    const extract = extractReturning(BAD_SUM, GOOD);
    expect(await parseBill({ pdf: PDF, extract })).toEqual({ status: "parsed", bill: GOOD, problems: [], attempts: 2 });
    expect(extract.mock.calls[1]![0].images).toHaveLength(1);
  });

  it("marks needs_review after two failures, keeping the problems and making no third call", async () => {
    const extract = extractReturning(BAD_SUM, BAD_SUM);
    const result = await parseBill({ pdf: PDF, extract });
    expect(result.status).toBe("needs_review");
    expect(result.problems.join()).toMatch(/Lines sum to 5000/);
    expect(result.attempts).toBe(2);
    expect(extract).toHaveBeenCalledTimes(2);
  });

  it("treats output that breaks the schema as a failed attempt", async () => {
    const extract = extractReturning({ ...GOOD, totalCents: 1.5 }, { nonsense: true });
    const result = await parseBill({ pdf: PDF, extract });
    expect(result).toMatchObject({ status: "needs_review", bill: null, attempts: 2 });
    expect(result.problems.length).toBeGreaterThan(0);
  });

  it("propagates a rejected extract on either pass, never reporting needs_review", async () => {
    const limit = new Error("Claude plan rate limit reached");
    await expect(parseBill({ pdf: PDF, extract: vi.fn<Extract>().mockRejectedValue(limit) })).rejects.toThrow(limit);
    const second = extractReturning(BAD_SUM);
    second.mockRejectedValueOnce(limit);
    await expect(parseBill({ pdf: PDF, extract: second })).rejects.toThrow(limit);
  });
});
