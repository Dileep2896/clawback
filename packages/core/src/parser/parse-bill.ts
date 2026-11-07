import { LlmOutputError } from "@bill-fighter/shared/llm-output-error";
import { ParsedBill } from "@bill-fighter/shared/parsed-bill";
import { pdfPageImages, pdfText } from "./pdf.ts";
import { IMAGE_PROMPT, PARSED_BILL_SCHEMA, SYSTEM_PROMPT, textPrompt } from "./prompt.ts";
import { validateParsedBill } from "./validate.ts";

export type ExtractInput = { prompt: string; system: string; images?: { mediaType: string; base64: string }[] };

// Same shape as Llm.structured, so callers pass that in and core never imports the platform.
export type Extract = (input: ExtractInput, jsonSchema: Record<string, unknown>) => Promise<unknown>;

export type ParseResult = {
  status: "parsed" | "needs_review";
  bill: ParsedBill | null;
  problems: string[];
  attempts: number;
};

function check(output: unknown): Pick<ParseResult, "bill" | "problems"> {
  const shape = ParsedBill.safeParse(output);
  if (!shape.success) return { bill: null, problems: shape.error.issues.map((i) => `${i.path.join(".")}: ${i.message}`) };
  return { bill: shape.data, problems: validateParsedBill(shape.data) };
}

// Any other rejection (rate limit, login) rejects here too: it says nothing about the bill, so it must not read as needs_review.
async function attempt(extract: Extract, input: ExtractInput): Promise<Pick<ParseResult, "bill" | "problems">> {
  try {
    return check(await extract(input, PARSED_BILL_SCHEMA));
  } catch (error) {
    if (error instanceof LlmOutputError) return { bill: null, problems: [error.message] };
    throw error;
  }
}

export async function parseBill({ pdf, extract }: { pdf: Uint8Array; extract: Extract }): Promise<ParseResult> {
  const first = await attempt(extract, { system: SYSTEM_PROMPT, prompt: textPrompt(await pdfText(pdf)) });
  if (first.problems.length === 0) return { status: "parsed", ...first, attempts: 1 };

  const images = await pdfPageImages(pdf);
  const second = await attempt(extract, { system: SYSTEM_PROMPT, prompt: IMAGE_PROMPT, images });
  return { status: second.problems.length === 0 ? "parsed" : "needs_review", ...second, attempts: 2 };
}
