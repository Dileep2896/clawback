import { ParsedBill } from "@bill-fighter/shared/parsed-bill";
import { z } from "zod";

export const PARSED_BILL_SCHEMA = z.toJSONSchema(ParsedBill) as Record<string, unknown>;

export const SYSTEM_PROMPT = `You extract one utility or telecom bill into the given JSON schema.

Copy values exactly as printed. Never compute, correct or invent a value. A value the bill does not print is null.

- lineItems: one entry per printed charge row, in printed order. Include credits as negative amounts, taxes, and any previous unpaid balance. Leave out subtotals and totals.
- description: the row's text as printed. If rows repeat under different section headings, keep the row's text as printed.
- quantity, rate: as printed on the row, as plain numbers. A rate is in dollars per unit. Null if the row does not print one.
- amountCents, totalCents: integer cents, so $12.34 is 1234.
- totalCents: the total amount due as printed.
- lineType, exactly one of:
  energy: an energy charge per kWh
  demand: a demand charge per kW
  fixed: a flat fee or service charge
  voice: a voice phone line
  pots: a copper phone line
  internet: an internet service charge
  gas_supply: a gas charge per therm
  tax: a tax
  credit: a credit or a payment
  prior_balance: a balance carried over from an earlier bill
  other: anything else
- kwhByTouPeriod: one entry per printed time of use period, or empty if none is printed.
- periodStart, periodEnd: the service period as YYYY-MM-DD.`;

export const textPrompt = (text: string) => `Extract this bill. Its text is below.\n\n${text}`;

export const IMAGE_PROMPT = "Extract this bill from these page images. Some pages may explain the bill around a picture of it: use only the bill itself.";
