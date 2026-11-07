import { beforeEach, describe, expect, it, vi } from "vitest";

const mocks = vi.hoisted(() => ({ currentSession: vi.fn(), callWebhook: vi.fn(), saveParsedBill: vi.fn() }));
vi.mock("@bill-fighter/db/client", () => ({ db: {} }));
vi.mock("../../../../lib/session.ts", () => ({ currentSession: mocks.currentSession }));
vi.mock("../../../../lib/webhook.ts", () => ({ callWebhook: mocks.callWebhook }));
vi.mock("../../../../lib/accounts.ts", () => ({ saveParsedBill: mocks.saveParsedBill }));

const { POST } = await import("./route.ts");

const MB5 = 5 * 1024 * 1024;
const BILL = {
  accountNumber: "BE-9001",
  serviceAddress: "10 Valencia St, San Francisco, CA",
  providerName: "BayCurrent Electric",
  serviceType: "electric",
  meterNumber: "M1",
  multiplier: 1,
  rateSchedule: "B-19",
  planCode: null,
  periodStart: "2026-09-01",
  periodEnd: "2026-09-30",
  kwhByTouPeriod: [],
  maxKw: null,
  lineItems: [],
  totalCents: 2000,
};

const pdf = (size: number, head = "%PDF-") => new File([Buffer.concat([Buffer.from(head), Buffer.alloc(size - head.length)])], "bill.pdf");
const upload = (file?: File | string) => {
  const form = new FormData();
  if (file !== undefined) form.set("file", file);
  return POST(new Request("http://localhost/api/bills/upload", { method: "POST", body: form }));
};

beforeEach(() => {
  vi.clearAllMocks();
  mocks.currentSession.mockResolvedValue({ uid: "u", cid: "c" });
  mocks.callWebhook.mockResolvedValue({ ok: true, status: 200, body: { status: "parsed", bill: BILL, pdfPath: "/uploads/c/x.pdf" } });
  mocks.saveParsedBill.mockResolvedValue({ status: "saved", billId: "b" });
});

describe("POST /api/bills/upload", () => {
  it("files a parsed bill, up to exactly 5 MB", async () => {
    const response = await upload(pdf(MB5));
    expect(await response.json()).toEqual({ name: "bill.pdf", status: "saved", billId: "b" });
    expect(mocks.callWebhook).toHaveBeenCalledWith("/parse-upload", expect.objectContaining({ customerId: "c" }), 120_000);
    expect(mocks.saveParsedBill).toHaveBeenCalledWith({}, "c", BILL, "/uploads/c/x.pdf");
  });

  it("refuses, without parsing or filing, a file one byte over 5 MB, a file that is not a PDF, no file, and no session", async () => {
    expect((await upload(pdf(MB5 + 1))).status).toBe(413);
    expect((await upload(pdf(100, "<html"))).status).toBe(415);
    expect((await upload(new File([], "empty.pdf"))).status).toBe(415);
    expect((await upload("not a file")).status).toBe(400);
    expect((await upload()).status).toBe(400);
    mocks.currentSession.mockResolvedValue(null);
    expect((await upload(pdf(100))).status).toBe(401);
    expect(mocks.callWebhook).not.toHaveBeenCalled();
    expect(mocks.saveParsedBill).not.toHaveBeenCalled();
  });

  it("does not file a bill when the service is down, times out, fails, or returns something that is not a bill", async () => {
    mocks.callWebhook.mockResolvedValueOnce({ ok: false, status: 503, body: { error: "agents down" } });
    const down = await upload(pdf(100));
    expect([down.status, await down.json()]).toEqual([503, { error: "agents down" }]);

    mocks.callWebhook.mockResolvedValueOnce({ ok: false, status: 504, body: { error: "timeout" } });
    expect(await (await upload(pdf(100))).json()).toEqual({ name: "bill.pdf", status: "needs_review", reason: "Reading it took too long" });

    for (const reply of [
      { ok: false, status: 500, body: { error: "boom" } },
      { ok: true, status: 200, body: { status: "needs_review" } },
      { ok: true, status: 200, body: { status: "parsed", bill: { ...BILL, totalCents: "lots" } } },
    ]) {
      mocks.callWebhook.mockResolvedValueOnce(reply);
      expect(await (await upload(pdf(100))).json()).toEqual({ name: "bill.pdf", status: "needs_review", reason: "We could not read every line" });
    }
    expect(mocks.saveParsedBill).not.toHaveBeenCalled();
  });
});
