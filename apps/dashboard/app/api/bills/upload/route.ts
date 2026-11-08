import { db } from "@bill-fighter/db/client";
import { ParsedBill } from "@bill-fighter/shared/parsed-bill";
import { saveParsedBill } from "../../../../lib/accounts.ts";
import { currentSession } from "../../../../lib/session.ts";
import { isSandbox } from "@bill-fighter/shared/sandbox";
import { callWebhook } from "../../../../lib/webhook.ts";

const MAX_UPLOAD_BYTES = 5 * 1024 * 1024;
// A live parse can take a text pass and an image retry. Past this, the bill waits for a person.
const PARSE_TIMEOUT_MS = 120_000;

const error = (message: unknown, status: number) => Response.json({ error: String(message) }, { status });

/** One PDF per request, so each file on the page gets its own "Reading your bill" state. */
export async function POST(request: Request) {
  const session = await currentSession();
  if (!session) return error("Log in first", 401);
  // Before the body is read: the sandbox keeps no file and parses nothing.
  if (isSandbox()) return error("The sandbox takes no real bills. The sample bills are already on your account.", 403);
  const file = (await request.formData().catch(() => null))?.get("file");
  if (!(file instanceof File)) return error("Attach a PDF", 400);
  const name = file.name;
  if (file.size > MAX_UPLOAD_BYTES) return error(`${name} is over 5 MB`, 413);
  const pdf = Buffer.from(await file.arrayBuffer());
  if (pdf.subarray(0, 5).toString("latin1") !== "%PDF-") return error(`${name} is not a PDF`, 415);

  const parsed = await callWebhook("/parse-upload", { customerId: session.cid, pdfBase64: pdf.toString("base64") }, PARSE_TIMEOUT_MS);
  if (parsed.status === 503) return error(parsed.body.error, 503);
  const bill = ParsedBill.safeParse(parsed.body.bill);
  if (!parsed.ok || parsed.body.status !== "parsed" || !bill.success) {
    return Response.json({ name, status: "needs_review", reason: parsed.status === 504 ? "Reading it took too long" : "We could not read every line" });
  }
  return Response.json({ name, ...(await saveParsedBill(db, session.cid, bill.data, String(parsed.body.pdfPath))) });
}
