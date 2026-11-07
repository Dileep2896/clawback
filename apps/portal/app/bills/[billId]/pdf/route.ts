import { db } from "@bill-fighter/db/client";
import { findBill, readBillPdf } from "../../../../lib/bills.ts";
import { getSession } from "../../../../lib/session.ts";

export async function GET(_request: Request, { params }: { params: Promise<{ billId: string }> }) {
  const session = await getSession();
  if (!session) return new Response("Sign in to download this bill.", { status: 401 });

  const { billId } = await params;
  const bill = await findBill(db, session.provider, billId);
  const pdf = bill && (await readBillPdf(bill.pdfPath));
  // One answer for all of these, so nothing reveals that another provider's bill exists.
  if (!bill || !pdf) return new Response("Bill not found.", { status: 404 });

  return new Response(new Uint8Array(pdf), {
    headers: {
      "Content-Type": "application/pdf",
      "Content-Disposition": `attachment; filename="${bill.id}.pdf"`,
      "Cache-Control": "no-store",
    },
  });
}
