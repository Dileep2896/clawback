// The judge sandbox (SANDBOX=1): each sign-up gets its own copy of the demo customer, and the recorded run plays into
// that copy's rows. Nothing runs in the background: every /api/live poll writes the events whose time has come, so it
// works on a serverless host and any number of judges can watch at once. It never touches another customer's rows.
import { existsSync, readFileSync } from "node:fs";
import { join } from "node:path";
import { decideApproval } from "@bill-fighter/db/approvals";
import type { Db } from "@bill-fighter/db/client";
import { applyEvents, parseRecording, type Recording, type ReplayEvent, TABLES } from "@bill-fighter/db/replay";
import { CUSTOMER } from "@bill-fighter/db/seed/customer";
import { isSandboxReplay, sandboxId, type SandboxState } from "./replay.ts";

export { isSandboxReplay, sandboxId };

/** The human chose 2x, so a judge sees the whole run in about 2:14 plus their own wait at the approval. */
export const SANDBOX_SPEED = 2;

type Row = Record<string, unknown>;
type Client = Pick<Db["$client"], "query">;

// shortcut: read from disk next to the repo (next runs from apps/dashboard, tests from the root); bundle it as data if the host has no filesystem.
function readRecording(): Recording {
  for (const dir of [process.cwd(), join(process.cwd(), "../..")]) {
    const file = join(dir, "data/replay/run.jsonl");
    if (existsSync(file)) return parseRecording(readFileSync(file, "utf8"));
  }
  throw new Error("No recording at data/replay/run.jsonl");
}

export type SandboxPlan = {
  recordedAt: string;
  /** What plays, in order. The recorded decision and the recorded YES are left out: the judge's tap is the human action. */
  events: ReplayEvent[];
  /** The time of the recorded approval. Nothing from here on plays until the judge approves. */
  approvalT: number;
  /** Every id the recording writes, so a value is re-keyed only when it really is one of these rows or a seed row. */
  ids: Set<string>;
};

export function planOf(recording: Recording): SandboxPlan {
  const approvedAt = recording.events.find(({ table, row }) => table === "approvals" && row?.status === "approved")?.t;
  if (approvedAt === undefined) throw new Error("The recording has no approval to wait at");
  const events = recording.events.filter(
    ({ table, row }) => !(table === "approvals" && row?.status === "approved") && !(table === "sms_messages" && row?.direction === "inbound"),
  );
  return { recordedAt: recording.recordedAt, events, approvalT: approvedAt, ids: new Set(recording.events.map(({ id }) => id)) };
}

let cached: SandboxPlan | undefined;
export const sandboxPlan = () => (cached ??= planOf(readRecording()));

/** Ids and foreign keys by column or JSON key name: free text that happens to equal an id is never touched. */
const ID_KEY = /^id$|_ids?$|Ids?$/;

/** The row as it belongs to this judge: every id of a recorded or seed row gets the judge's prefix, the demo customer becomes theirs. */
export function rekey(value: unknown, customerId: string, known: Set<string>, key = ""): unknown {
  if (Array.isArray(value)) return value.map((item) => rekey(item, customerId, known, key));
  if (value && typeof value === "object") return Object.fromEntries(Object.entries(value).map(([k, v]) => [k, rekey(v, customerId, known, k)]));
  if (typeof value !== "string" || !ID_KEY.test(key)) return value;
  if (value === CUSTOMER.id) return customerId;
  return known.has(value) ? sandboxId(customerId, value) : value;
}

function eventFor(event: ReplayEvent, customerId: string, known: Set<string>): ReplayEvent {
  const id = sandboxId(customerId, event.id);
  if (!event.row) return { ...event, id };
  const row = rekey(event.row, customerId, known) as Row;
  // Unique across runs: the recorded email's key would let only one judge ever start.
  if (event.table === "runs") row.dedupe_key = null;
  return { ...event, id, row };
}

/** The seed rows the recording points at, read once from the database the dashboard serves. */
const SEED_IDS = `
  select id from locations where customer_id = $1
  union all select a.id from accounts a join locations l on l.id = a.location_id where l.customer_id = $1
  union all select b.id from bills b join accounts a on a.id = b.account_id join locations l on l.id = a.location_id where l.customer_id = $1
  union all select bl.id from bill_lines bl join bills b on b.id = bl.bill_id join accounts a on a.id = b.account_id join locations l on l.id = a.location_id where l.customer_id = $1
  union all select p.id from phone_lines p join accounts a on a.id = p.account_id join locations l on l.id = a.location_id where l.customer_id = $1`;

let seedIds: Promise<Set<string>> | undefined;
const knownIds = (client: Client) =>
  (seedIds ??= client.query<{ id: string }>(SEED_IDS, [CUSTOMER.id]).then(({ rows }) => new Set([...sandboxPlan().ids, ...rows.map(({ id }) => id)])));

/** Forget the cached seed ids, for tests that seed a fresh database. */
export const resetSandboxCache = () => {
  seedIds = undefined;
};

const prefixed = (column: string) => `$1::text || ':' || x.${column}`;
// Each table copied whole through jsonb, so a column added later is copied too. Only the keys change.
const CLONES: [table: string, from: string, keys: Record<string, string>][] = [
  ["locations", "locations x where x.customer_id = $2", { id: prefixed("id"), customer_id: "$1::text" }],
  ["accounts", "accounts x join locations l on l.id = x.location_id where l.customer_id = $2", { id: prefixed("id"), location_id: prefixed("location_id") }],
  [
    "bills",
    "bills x join accounts a on a.id = x.account_id join locations l on l.id = a.location_id where l.customer_id = $2",
    { id: prefixed("id"), account_id: prefixed("account_id") },
  ],
  [
    "bill_lines",
    "bill_lines x join bills b on b.id = x.bill_id join accounts a on a.id = b.account_id join locations l on l.id = a.location_id where l.customer_id = $2",
    { id: prefixed("id"), bill_id: prefixed("bill_id") },
  ],
  [
    "phone_lines",
    "phone_lines x join accounts a on a.id = x.account_id join locations l on l.id = a.location_id where l.customer_id = $2",
    { id: prefixed("id"), account_id: prefixed("account_id") },
  ],
];

/**
 * A new customer that is a copy of Golden Gate Noodle Co., under the judge's own ids. The recording's numbers come from these
 * bills, so the judge plays Linda Park's business; their own name stays on their user row. Runs in the caller's transaction.
 */
export async function cloneDemoCustomer(client: Client, customerId: string) {
  const { rowCount } = await client.query(
    "insert into customers select (jsonb_populate_record(null::customers, to_jsonb(c) || jsonb_build_object('id', $1::text))).* from customers c where c.id = $2",
    [customerId, CUSTOMER.id],
  );
  if (rowCount !== 1) throw new Error("The sandbox has no demo customer to copy. Run `pnpm seed` on its database first.");
  for (const [table, from, keys] of CLONES) {
    const patch = Object.entries(keys).map(([column, value]) => `'${column}', ${value}`).join(", ");
    await client.query(`insert into ${table} select (jsonb_populate_record(null::${table}, to_jsonb(x) || jsonb_build_object(${patch}))).* from ${from}`, [customerId, CUSTOMER.id]);
  }
}

/** Takes the pool's own connection, so the row lock and the writes are one transaction. */
async function inTransaction<T>(db: Db, fn: (client: Client) => Promise<T>): Promise<T> {
  const client = await db.$client.connect();
  try {
    await client.query("BEGIN");
    const result = await fn(client);
    await client.query("COMMIT");
    return result;
  } catch (error) {
    await client.query("ROLLBACK");
    throw error;
  } finally {
    client.release();
  }
}

export const sandboxRunId = (customerId: string) => sandboxId(customerId, sandboxPlan().events[0]!.id);

/** Starts the judge's replay once: a second click, or a second tab, finds the run already there. Returns its id. */
export async function startSandboxRun(db: Db, customerId: string, now = Date.now()) {
  const plan = sandboxPlan();
  const runId = sandboxRunId(customerId);
  await inTransaction(db, async (client) => {
    await client.query("select pg_advisory_xact_lock(hashtext($1))", [`sandbox:${customerId}`]);
    const { rowCount } = await client.query("select 1 from runs where id = $1", [runId]);
    if (rowCount) return;
    const state: SandboxState = { sandbox: true, recordedAt: plan.recordedAt, speed: SANDBOX_SPEED, startedAt: new Date(now).toISOString(), cursor: 0, approvedAt: null };
    await play(client, customerId, state, now);
  });
  return runId;
}

/** Writes every event that is due, and the cursor with it. Waits at the approval until the judge has approved. */
async function play(client: Client, customerId: string, state: SandboxState, now: number) {
  const plan = sandboxPlan();
  const known = await knownIds(client);
  const recordedNow = (now - new Date(state.startedAt).getTime()) * state.speed;
  const until = state.approvedAt ? recordedNow : Math.min(recordedNow, plan.approvalT - 1);
  let cursor = state.cursor;
  while (cursor < plan.events.length && plan.events[cursor]!.t <= until) cursor++;
  if (cursor === state.cursor) return;
  const next: SandboxState = { ...state, cursor };
  // Tick by tick, in recorded order, so a parent row is always written before a later tick's child.
  const due = plan.events.slice(state.cursor, cursor);
  for (const t of new Set(due.map((event) => event.t))) {
    await applyEvents(client, due.filter((event) => event.t === t).map((event) => eventFor(event, customerId, known)), next);
  }
  await client.query("update runs set replay = $2 where id = $1", [sandboxRunId(customerId), JSON.stringify(next)]);
}

/** Brings the judge's replay up to now. Called on every live poll; a customer with no sandbox run is left alone. */
export async function advanceSandbox(db: Db, customerId: string, now = Date.now()) {
  await inTransaction(db, async (client) => {
    // The row lock makes two tabs take turns, and the second finds nothing left to write.
    const { rows } = await client.query<{ replay: unknown }>("select replay from runs where id = $1 for update", [sandboxRunId(customerId)]);
    const replay = rows[0]?.replay;
    if (isSandboxReplay(replay)) await play(client, customerId, replay, now);
  });
}

/**
 * The judge's tap: the bundle is approved as theirs, on the dashboard, and the clock moves so the recording carries on from
 * the moment it was approved. The first decision wins, as everywhere else, so a double click is one approval.
 */
export async function approveSandbox(db: Db, runId: string, approvedBy: string, now = Date.now()) {
  const decided = await decideApproval(db, { runId, status: "approved", channel: "dashboard", approvedBy });
  const startedAt = new Date(now - sandboxPlan().approvalT / SANDBOX_SPEED).toISOString();
  // Merged into the row as it is now, and only once, so a poll writing its cursor at the same moment loses nothing.
  await db.$client.query(
    "update runs set replay = replay || jsonb_build_object('approvedAt', $2::text, 'startedAt', $3::text) where id = $1 and replay->>'sandbox' = 'true' and replay->>'approvedAt' is null",
    [runId, new Date(now).toISOString(), startedAt],
  );
  return decided;
}

/** "Watch it again": the judge's run rows go, children first, and the replay starts over. Only ids with their prefix are touched. */
export async function restartSandbox(db: Db, customerId: string, now = Date.now()) {
  await inTransaction(db, async (client) => {
    await client.query("select pg_advisory_xact_lock(hashtext($1))", [`sandbox:${customerId}`]);
    for (const table of [...TABLES].reverse()) await client.query(`delete from ${table} where starts_with(id, $1)`, [sandboxId(customerId, "")]);
  });
  return startSandboxRun(db, customerId, now);
}

/** Sign-ups the sandbox takes, across every visitor: enough for a judging room, and a ceiling for a script. */
export const SIGNUPS_PER_MINUTE = 30;
export const SIGNUPS_PER_DAY = 1000;
export const BUSY_TEXT = "The sandbox is busy. Try again in a minute.";

export type SandboxSignUp = { name: string; company: string; email: string; passwordHash: string };

/**
 * A sandbox account: always a fresh copy of the demo customer, never linked by email to a real one, so no judge can reach
 * another's rows or the seeded customer's. The lock makes racing sign-ups take turns, so the rate limit holds.
 */
export async function createSandboxUser(db: Db, input: SandboxSignUp, customerId = `sandbox-${crypto.randomUUID()}`) {
  return inTransaction(db, async (client) => {
    await client.query("select pg_advisory_xact_lock(hashtext('sandbox:signup'))");
    const { rows } = await client.query<{ minute: number; day: number }>(
      "select count(*) filter (where created_at > now() - interval '1 minute')::int as minute, count(*) filter (where created_at > now() - interval '1 day')::int as day from users",
    );
    if (rows[0]!.minute >= SIGNUPS_PER_MINUTE || rows[0]!.day >= SIGNUPS_PER_DAY) return "busy" as const;
    if ((await client.query("select 1 from users where email = $1", [input.email])).rowCount) return "taken" as const;
    await cloneDemoCustomer(client, customerId);
    const { rows: users } = await client.query<{ id: string }>(
      "insert into users (name, company, email, password_hash, customer_id, created_customer) values ($1, $2, $3, $4, $5, true) returning id",
      [input.name, input.company, input.email, input.passwordHash, customerId],
    );
    return { id: users[0]!.id, customerId };
  });
}
