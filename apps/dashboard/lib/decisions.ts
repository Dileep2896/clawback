import { decideApproval } from "@bill-fighter/db/approvals";
import type { Db } from "@bill-fighter/db/client";
import { approvals, customers, runs, smsMessages } from "@bill-fighter/db/schema";
import { and, desc, eq, gte } from "drizzle-orm";
import { isSandbox } from "@bill-fighter/shared/sandbox";
import { z } from "zod";
import { isStopped, STOPPED_TEXT } from "./run-state.ts";
import { approveSandbox, isSandboxReplay } from "./sandbox.ts";

/** A refusal the caller can understand, as opposed to a failure. */
class Refused extends Error {
  constructor(
    message: string,
    readonly status: 404 | 409,
  ) {
    super(message);
  }
}

async function runOf(db: Db, runId: string) {
  const [found] = await db
    .select({ startedAt: runs.startedAt, platform: runs.platform, approver: customers.contactName, status: runs.status, replay: runs.replay, customerId: runs.customerId })
    .from(runs)
    .innerJoin(customers, eq(runs.customerId, customers.id))
    .where(eq(runs.id, runId));
  if (!found) throw new Refused(`Run ${runId} does not exist`, 404);
  // A judge's sandbox replay waits for the judge's own tap; any other recording plays back its own decision.
  if (found.replay && !isSandboxReplay(found.replay)) throw new Refused("This run is a recording, so nothing on it can be decided", 409);
  // An approval here would count as a human action, and nothing is left to act on it.
  if (isStopped(found.status)) throw new Refused(STOPPED_TEXT, 409);
  return found;
}

const bundleOf = async (db: Db, runId: string) => (await db.select({ id: approvals.id }).from(approvals).where(eq(approvals.runId, runId)))[0];

/** The backup path in both platform modes, so it touches only the run, its customer and its bundle. Never SMS. */
export async function approveRun(db: Db, runId: string, customerId?: string) {
  const { approver, customerId: owner, replay } = await runOf(db, runId);
  // The signed-in customer's own runs only: one customer never releases another's bundle. Same answer as a missing run.
  if (customerId !== undefined && owner !== customerId) throw new Refused(`Run ${runId} does not exist`, 404);
  if (!(await bundleOf(db, runId))) throw new Refused(`Run ${runId} has no approval request`, 404);
  if (isSandboxReplay(replay)) return approveSandbox(db, runId, approver);
  // The approver is the customer's contact, and the channel shows it was the button.
  return decideApproval(db, { runId, status: "approved", channel: "dashboard", approvedBy: approver });
}

export const SANDBOX_REPLY = "In the sandbox the phone only shows the text. Approve with the Approve button.";

// The whole reply, because "Yes, but not the alarm line" must not release the bundle.
export const isYes = (body: string) => /^yes[.!]*$/i.test(body.trim());

/** A reply from the simulated phone: stored whatever it says, and it approves only as a plain YES. */
export async function receiveSms(db: Db, { runId, body }: { runId: string; body: string }) {
  if (isSandbox()) throw new Refused(SANDBOX_REPLY, 409);
  const { platform, startedAt, approver } = await runOf(db, runId);
  if (platform !== "local") throw new Refused("The simulated phone only works on local runs", 409);

  // Texts have no run or customer id, so a reply to any older run would be matched to a newer run's text.
  const [newest] = await db.select({ id: runs.id }).from(runs).orderBy(desc(runs.startedAt), desc(runs.id)).limit(1);
  if (newest?.id !== runId) throw new Refused("A newer run has replaced this one", 409);

  const [latest] = await db
    .select({ to: smsMessages.to, from: smsMessages.from })
    .from(smsMessages)
    .where(and(eq(smsMessages.direction, "outbound"), gte(smsMessages.createdAt, startedAt)))
    .orderBy(desc(smsMessages.createdAt), desc(smsMessages.id))
    .limit(1);
  if (!latest) throw new Refused("There is no text to reply to", 409);

  // The numbers come from the text being answered, so the browser cannot claim to be anyone else.
  await db.insert(smsMessages).values({ direction: "inbound", to: latest.from, from: latest.to, body });

  const approved = isYes(body) && (await bundleOf(db, runId)) !== undefined;
  if (approved) await decideApproval(db, { runId, status: "approved", channel: "sms", approvedBy: approver });
  return { approved };
}

/**
 * These routes have no login, so a page on another site must not be able to post to them. Browsers always send Origin
 * on a POST. A request with none did not come from a page. The Host must be local first, because a rebound domain
 * sends a matching Origin and Host of its own.
 */
export function sameOrigin(request: Request) {
  const host = `http://${request.headers.get("host")}`;
  // PUBLIC_HOST is the one public name a hosted deployment (the judge sandbox) answers on, set by whoever deploys it.
  const hosts = ["localhost", "127.0.0.1", ...(process.env.PUBLIC_HOST ? [process.env.PUBLIC_HOST] : [])];
  if (!URL.canParse(host) || !hosts.includes(new URL(host).hostname)) return false;
  const origin = request.headers.get("origin");
  if (origin === null) return true;
  return URL.canParse(origin) && new URL(origin).host === request.headers.get("host");
}

/** What both routes do around their one call. */
export async function respond<S extends z.ZodType>(request: Request, schema: S, act: (input: z.infer<S>) => Promise<unknown>) {
  if (!sameOrigin(request)) return Response.json({ error: "Requests from other sites are refused" }, { status: 403 });
  const input = schema.safeParse(await request.json().catch(() => undefined));
  if (!input.success) return Response.json({ error: "Invalid request" }, { status: 400 });
  try {
    return Response.json(await act(input.data));
  } catch (error) {
    if (error instanceof Refused) return Response.json({ error: error.message }, { status: error.status });
    throw error;
  }
}
