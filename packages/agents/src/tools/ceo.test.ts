import type { Db } from "@bill-fighter/db/client";
import { actions, auditLog, boardCards, findings, ledger } from "@bill-fighter/db/schema";
import { seedRun, withTestDb } from "@bill-fighter/db/test-db";
import { createApprovalGate } from "@bill-fighter/platform/local/approval-gate";
import { createAudit } from "@bill-fighter/platform/local/audit";
import { createBoard } from "@bill-fighter/platform/local/board";
import { createMail } from "@bill-fighter/platform/local/mail";
import type { Mail } from "@bill-fighter/platform/types";
import { eq } from "drizzle-orm";
import { describe, expect, it, vi } from "vitest";
import { amountsOf, seedFindings, run as runTool } from "../test-fixtures.ts";
import { type AgentTool, wrapTool } from "../tool-wrapper.ts";
import { ceoTools } from "./ceo.ts";

const RUN = "run";
const OWNER = "owner@billfighter.local";
const ALLOWLIST = { callNumbers: [], emailDomains: ["billfighter.local"], portalOrigins: [] };
const API = process.env.MAILPIT_API || "http://localhost:8025";
const EMAIL = { to: OWNER, subject: "Your savings summary", wording: "Here is what we found under Rule 17.1." };

const test = (name: string, fn: (db: Db) => Promise<void>) => it(name, () => withTestDb("tools_file_approve_ceo", fn));

function setup(db: Db, mail: Mail = createMail({ ...process.env, ALLOWED_EMAIL_DOMAINS: "billfighter.local" })) {
  const gate = createApprovalGate(db);
  const tools = ceoTools({ db, board: async () => createBoard(db), mail: async () => mail, gate: async () => gate });
  const wrapped = (name: string) => wrapTool(tools.find((tool) => tool.name === name) as AgentTool, { audit: createAudit(db), allowlist: ALLOWLIST });
  return { gate, tools, wrapped, call: (name: string, input: unknown, runId = RUN) => runTool(tools, name, input, runId, "ceo") };
}

const fakeMail = () => {
  const send = vi.fn<Mail["send"]>(async () => ({ id: "m1" }));
  return { send, mail: { send, parseInbound: () => ({ messageId: "", from: "", to: "", subject: "", text: "" }) } };
};

describe("board_update", () => {
  test("creates a card and moves it through every status, with the run id and agent in board_cards", async (db) => {
    await seedRun(db, RUN);
    const { call } = setup(db);
    const { cardId } = (await call("board_update", { agent: "collector", title: "Download bills" })) as { cardId: string };
    const row = async () => (await db.select().from(boardCards).where(eq(boardCards.id, cardId)))[0]!;
    expect(await row()).toMatchObject({ runId: RUN, agent: "collector", title: "Download bills", status: "todo" });
    for (const status of ["doing", "blocked", "doing", "done"]) {
      await call("board_update", { cardId, status });
      expect(await row()).toMatchObject({ runId: RUN, agent: "collector", status });
    }
  });

  test("refuses another run's card, an unknown status and incomplete input", async (db) => {
    await seedRun(db, RUN);
    await seedRun(db, "other");
    const { call } = setup(db);
    const { cardId } = (await call("board_update", { agent: "auditor", title: "Audit" }, "other")) as { cardId: string };
    await expect(call("board_update", { cardId, status: "done" })).rejects.toThrow(/not on this run's board/);
    expect((await db.select().from(boardCards))[0]!.status).toBe("todo");
    expect(() => call("board_update", { cardId, status: "paused" })).toThrow();
    await expect(call("board_update", { title: "No agent" })).rejects.toThrow(/needs agent and title/);
    await expect(call("board_update", { cardId })).rejects.toThrow(/needs a status/);
  });
});

describe("send_email", () => {
  test("appears in Mailpit, from the Mail interface", async (db) => {
    await seedFindings(db, RUN);
    const { wrapped } = setup(db);
    const { id } = (await wrapped("send_email").handler(EMAIL, { runId: RUN, agent: "ceo" })) as { id: string };

    const { messages } = (await (await fetch(`${API}/api/v1/messages?limit=200`)).json()) as { messages: { ID: string; MessageID: string }[] };
    const found = messages.find((message) => message.MessageID === id);
    expect(found, "the message is not in Mailpit").toBeTruthy();
    try {
      const message = (await (await fetch(`${API}/api/v1/message/${found!.ID}`)).json()) as { Subject: string; Text: string; To: { Address: string }[] };
      expect(message.Subject).toBe(EMAIL.subject);
      expect(message.To.map((to) => to.Address)).toEqual([OWNER]);
      expect(message.Text).toContain(EMAIL.wording);
      expect(message.Text).toContain("Refund found: $1,750.00");
    } finally {
      await fetch(`${API}/api/v1/messages`, { method: "DELETE", headers: { "content-type": "application/json" }, body: JSON.stringify({ IDs: [found!.ID] }) });
    }
  });

  test("refuses a recipient outside the allowlist before the handler runs, and audits it", async (db) => {
    await seedFindings(db, RUN);
    const { send, mail } = fakeMail();
    const { wrapped } = setup(db, mail);
    for (const to of ["billing@pge.com", `${OWNER}, billing@pge.com`]) {
      await expect(wrapped("send_email").handler({ ...EMAIL, to }, { runId: RUN, agent: "ceo" })).rejects.toThrow(/not on the allowlist/);
    }
    expect(send).not.toHaveBeenCalled();
    const rows = await db.select().from(auditLog);
    expect(rows).toHaveLength(2);
    expect(rows[0]).toMatchObject({ runId: RUN, agent: "ceo", tool: "send_email", outputJson: { refused: expect.any(String) } });
  });

  test("refuses while the approval is pending, and goes out once it is decided", async (db) => {
    await seedFindings(db, RUN);
    const { send, mail } = fakeMail();
    const { call, gate } = setup(db, mail);
    await db.insert(actions).values({ id: "a", kind: "claim", status: "proposed" });
    await gate.createBundle({ runId: RUN, actionIds: ["a"], summary: "s" });
    await expect(call("send_email", EMAIL)).rejects.toThrow(/still pending/);
    expect(send).not.toHaveBeenCalled();
    await gate.decide({ runId: RUN, status: "denied", channel: "dashboard", approvedBy: "Linda" });
    await expect(call("send_email", EMAIL)).resolves.toMatchObject({ id: "m1" });
  });

  test("refuses a subject or wording with its own numbers", async (db) => {
    await seedFindings(db, RUN);
    const { send, mail } = fakeMail();
    const { call } = setup(db, mail);
    await expect(call("send_email", { ...EMAIL, subject: "You saved $20,000" })).rejects.toThrow(/\$20,000/);
    await expect(call("send_email", { ...EMAIL, wording: "We saved you 20000 dollars." })).rejects.toThrow(/20000/);
    expect(send).not.toHaveBeenCalled();
  });

  test("every number in the summary equals the findings and the ledger, for this customer only", async (db) => {
    const { customerId, id } = await seedFindings(db, RUN);
    const other = await seedRun(db, "other");
    // A rejected finding no longer counts.
    await db.update(findings).set({ status: "rejected" }).where(eq(findings.id, id("promo")));
    await db.insert(ledger).values([
      { customerId, findingId: id("meter"), kind: "refund", amountCents: 175_000 },
      { customerId, findingId: id("rate"), kind: "savings", amountCents: 80_000 },
      { customerId, findingId: id("unused"), kind: "savings", amountCents: 72_000 },
      { customerId, kind: "fee", amountCents: 98_100 },
      { customerId: other.customerId, kind: "fee", amountCents: 55_500 },
    ]);
    const { send, mail } = fakeMail();
    await setup(db, mail).call("send_email", EMAIL);
    const text = send.mock.calls[0]![0].text;

    expect(text).toContain("Refund found: $1,750.00");
    // 123_400 + 80_000 + 72_000, with the 108_000 promo rejected.
    expect(text).toContain("Yearly savings found: $2,754.00");
    expect(text).toContain("Refund claimed: $1,750.00");
    expect(text).toContain("Yearly savings recorded: $1,520.00");
    expect(text).toContain("Our fee: $981.00");
    expect(amountsOf(text).sort()).toEqual(["$1,750.00", "$2,754.00", "$1,750.00", "$1,520.00", "$981.00"].sort());
  });
});
