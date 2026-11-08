// The judge sandbox (SANDBOX=1): each sign-up gets its own copy of the demo customer, and the recorded run plays into
// that copy's rows. Nothing runs in the background: every /api/live poll writes the events whose time has come, so it
// works on a serverless host and any number of judges can watch at once. It never touches another customer's rows.
import { createHmac } from "node:crypto";
import { existsSync, readFileSync } from "node:fs";
import { join } from "node:path";
import type { Db } from "@bill-fighter/db/client";
import { applyEvents, parseRecording, type Recording, type ReplayEvent, TABLES } from "@bill-fighter/db/replay";
import { CUSTOMER } from "@bill-fighter/db/seed/customer";
import { isSandboxReplay, sandboxId, type SandboxState } from "./replay.ts";
import { EMAIL_INSTEAD } from "./run-state.ts";

export { isSandboxReplay, sandboxId };

/** The human chose 2x, so a judge sees the whole run in about 2:14 plus their own wait at the approval. */
export const SANDBOX_SPEED = 2;

type Row = Record<string, unknown>;
type Client = Pick<Db["$client"], "query">;

// shortcut: read from disk next to the repo (next runs from apps/dashboard, tests from the root); bundle it as data if the host has no filesystem.
function readReplayFile(name: string): string {
  for (const dir of [process.cwd(), join(process.cwd(), "../..")]) {
    const file = join(dir, "data/replay", name);
    if (existsSync(file)) return readFileSync(file, "utf8");
  }
  throw new Error(`No data/replay/${name}`);
}
const readRecording = (): Recording => parseRecording(readReplayFile("run.jsonl"));

type UsageSummary = { accountId: string; meterNumber: string | null; intervals: number; from: string; to: string }[];
let usageCache: UsageSummary | undefined;
/** The demo customer's meter readings as the judge's own accounts. The sandbox database holds no intervals, so they come from usageSummary in the seed. */
export const sandboxUsage = (customerId: string) =>
  (usageCache ??= JSON.parse(readReplayFile("usage.json")) as UsageSummary).map((u) => ({
    ...u,
    accountId: sandboxId(customerId, u.accountId),
    from: new Date(u.from),
    to: new Date(u.to),
  }));

export type SandboxPlan = {
  recordedAt: string;
  /** What plays, in order. The recorded decision, its audit row and the recorded YES are left out: the judge's tap is the human action. */
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
    ({ table, row }) =>
      !(table === "approvals" && row?.status === "approved") &&
      !(table === "sms_messages" && row?.direction === "inbound") &&
      !(table === "audit_log" && row?.agent === "owner" && row?.tool === "approve"),
  );
  return { recordedAt: recording.recordedAt, events, approvalT: approvedAt, ids: new Set(recording.events.map(({ id }) => id)) };
}

let cached: SandboxPlan | undefined;
export const sandboxPlan = () => (cached ??= planOf(readRecording()));

/** The run recorded with Email chosen. Its run id becomes the call recording's, so a judge has one run id whichever they pick. */
export function emailPlanOf(text: string, runId: string) {
  const recorded = parseRecording(text).events[0]!.id;
  return planOf(parseRecording(text.replaceAll(recorded, runId)));
}
let cachedEmail: SandboxPlan | undefined;
export const sandboxEmailPlan = () => (cachedEmail ??= emailPlanOf(readReplayFile("run-email.jsonl"), sandboxPlan().events[0]!.id));

/** The recording this judge is watching: the call one until they approve with Email. */
const planFor = (state: SandboxState) => (state.contact === "email" ? sandboxEmailPlan() : sandboxPlan());

/** Ids and foreign keys by column or JSON key name: free text that happens to equal an id is never touched. */
const ID_KEY = /^id$|_ids?$|Ids?$/;

/** The row as it belongs to this judge: every id of a recorded or seed row gets the judge's prefix, the demo customer becomes theirs. */
export const rekey = (value: unknown, customerId: string, known: Set<string>) =>
  mapStrings(value, (text, key) => {
    if (!ID_KEY.test(key)) return text;
    if (text === CUSTOMER.id) return customerId;
    return known.has(text) ? sandboxId(customerId, text) : text;
  });

/** Every string in the value, with the JSON key or column it sits under, mapped by fn. */
function mapStrings(value: unknown, fn: (text: string, key: string) => string, key = ""): unknown {
  if (Array.isArray(value)) return value.map((item) => mapStrings(item, fn, key));
  if (value && typeof value === "object") return Object.fromEntries(Object.entries(value).map(([k, v]) => [k, mapStrings(v, fn, k)]));
  return typeof value === "string" ? fn(value, key) : value;
}

const ISO = /^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}:\d{2}(\.\d+)?(Z|[+-]\d{2}:\d{2})$/;

/**
 * A recorded moment on the judge's clock: as far after their start as it was after the recording's, at their speed, plus
 * their wait when it came after the recorded approval. So a row written twice gets the same time both times, and calls
 * and refunds always sort after the tap that allowed them.
 */
export function wallTime(iso: string, state: SandboxState, approvalT = planFor(state).approvalT) {
  const sinceStart = Date.parse(iso) - Date.parse(state.recordedAt);
  const pausedMs = state.pausedMs ?? 0;
  const at = Date.parse(state.startedAt) - pausedMs + sinceStart / state.speed + (sinceStart >= approvalT ? pausedMs : 0);
  // An early tap skips the rest of the wait: what was recorded before the approval still lands no later than the tap.
  return new Date(sinceStart < approvalT && state.approvedAt ? Math.min(at, Date.parse(state.approvedAt)) : at).toISOString();
}

function eventFor(event: ReplayEvent, customerId: string, known: Set<string>, state: SandboxState): ReplayEvent {
  const id = sandboxId(customerId, event.id);
  if (!event.row) return { ...event, id };
  const row = mapStrings(rekey(event.row, customerId, known), (text) => (ISO.test(text) ? wallTime(text, state) : text)) as Row;
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
  (seedIds ??= client
    .query<{ id: string }>(SEED_IDS, [CUSTOMER.id])
    .then(({ rows }) => new Set([...sandboxPlan().ids, ...sandboxEmailPlan().ids, ...rows.map(({ id }) => id)]))
    // A failed lookup is not cached: the next start or poll asks again.
    .catch((error: unknown) => {
      seedIds = undefined;
      throw error;
    }));

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

/** One lock per judge, taken first by every writer of their replay (start, poll, approve, restart), so they take turns. */
const lockJudge = (client: Client, customerId: string) => client.query("select pg_advisory_xact_lock(hashtext($1))", [`sandbox:${customerId}`]);

/** Writes the judge's run from the start, unless it is already there. In the caller's transaction, under the judge's lock. */
async function startIn(client: Client, customerId: string, now: number) {
  if ((await client.query("select 1 from runs where id = $1", [sandboxRunId(customerId)])).rowCount) return;
  const state: SandboxState = { sandbox: true, recordedAt: sandboxPlan().recordedAt, speed: SANDBOX_SPEED, startedAt: new Date(now).toISOString(), cursor: 0, approvedAt: null, pausedMs: 0 };
  await play(client, customerId, state, now);
}

/** Starts the judge's replay once: a second click, or a second tab, finds the run already there. Returns its id. */
export async function startSandboxRun(db: Db, customerId: string, now = Date.now()) {
  await inTransaction(db, async (client) => {
    await lockJudge(client, customerId);
    await startIn(client, customerId, now);
  });
  return sandboxRunId(customerId);
}

/** Writes every event that is due, and the cursor with it. Waits at the approval until the judge has approved. */
async function play(client: Client, customerId: string, state: SandboxState, now: number) {
  const plan = planFor(state);
  const known = await knownIds(client);
  const recordedNow = (now - new Date(state.startedAt).getTime()) * state.speed;
  // Once approved, everything up to the approval is due at once, so an early tap jumps playback to it.
  const until = state.approvedAt ? Math.max(recordedNow, plan.approvalT - 1) : Math.min(recordedNow, plan.approvalT - 1);
  let cursor = state.cursor;
  while (cursor < plan.events.length && plan.events[cursor]!.t <= until) cursor++;
  if (cursor === state.cursor) return;
  const next: SandboxState = { ...state, cursor };
  // Tick by tick, in recorded order, so a parent row is always written before a later tick's child.
  const due = plan.events.slice(state.cursor, cursor);
  for (const t of new Set(due.map((event) => event.t))) {
    await applyEvents(client, due.filter((event) => event.t === t).map((event) => eventFor(event, customerId, known, state)), next);
  }
  await client.query("update runs set replay = $2 where id = $1", [sandboxRunId(customerId), JSON.stringify(next)]);
}

/** Brings the judge's replay up to now. Called on every live poll; a customer with no sandbox run is left alone. */
export async function advanceSandbox(db: Db, customerId: string, now = Date.now()) {
  await inTransaction(db, async (client) => {
    // Two tabs take turns, and the second finds nothing left to write.
    await lockJudge(client, customerId);
    const { rows } = await client.query<{ replay: unknown }>("select replay from runs where id = $1", [sandboxRunId(customerId)]);
    const replay = rows[0]?.replay;
    if (isSandboxReplay(replay)) await play(client, customerId, replay, now);
  });
}

/**
 * The judge's tap: the bundle is approved as theirs, on the dashboard, and the clock moves so the recording carries on from
 * the moment it was approved. One transaction under the judge's lock, so the approval never lands without the replay
 * resuming. The first decision wins, as everywhere else, so a double click is one approval.
 */
export async function approveSandbox(db: Db, customerId: string, runId: string, approvedBy: string, contact: "call" | "email" = "call", now = Date.now()) {
  if (!approvedBy) throw new Error("An approval decision must record who made it");
  return inTransaction(db, async (client) => {
    await lockJudge(client, customerId);
    const tap = new Date(now).toISOString();
    if ((await client.query("select 1 from approvals where run_id = $1 and status = 'pending'", [runId])).rowCount) {
      const found = (await client.query<{ replay: unknown }>("select replay from runs where id = $1", [runId])).rows[0]?.replay;
      if (!isSandboxReplay(found) || found.approvedAt) throw new Error(`Run ${runId} is not a sandbox replay waiting at its approval`);
      if (contact === "email") {
        // The email run's rows have their own ids, so the judge's call rows go and its rows up to the approval take their place.
        for (const table of [...TABLES].reverse()) await client.query(`delete from ${table} where starts_with(id, $1)`, [sandboxId(customerId, "")]);
      }
      const replay: SandboxState = contact === "email" ? { ...found, recordedAt: sandboxEmailPlan().recordedAt, cursor: 0, contact } : found;
      // pausedMs is how long the judge waited at the approval, so rows recorded after it land after the tap (wallTime).
      // A tap before playback reached the approval waited 0: the clock never moves back, and play() jumps to the approval.
      // Email is anchored at the tap either way: its recorded approval comes later than the call's, so a clamp would add that gap.
      const waited = now - planFor(replay).approvalT / replay.speed - Date.parse(replay.startedAt);
      const pausedMs = contact === "email" ? waited : Math.max(0, waited);
      const next: SandboxState = { ...replay, approvedAt: tap, startedAt: new Date(Date.parse(replay.startedAt) + pausedMs).toISOString(), pausedMs };
      // The email run starts again from its first event, so play() writes it up to the approval, with the cursor.
      if (contact === "email") await play(client, customerId, next, now);
      else await client.query("update runs set replay = $2 where id = $1", [runId, JSON.stringify(next)]);
      await client.query(
        "update approvals set status = 'approved', channel = 'dashboard', approved_by = $2, approved_at = $3, contact = $4 where run_id = $1 and status = 'pending'",
        [runId, approvedBy, tap, contact],
      );
      // The judge's own approval row, as approveRun writes it; the recorded one never plays. Prefixed, so Watch it again removes it.
      await client.query("insert into audit_log (id, run_id, agent, tool, input_json, output_json, created_at) values ($1, $2, 'owner', 'approve', $3, $4, $5)", [
        sandboxId(customerId, crypto.randomUUID()),
        runId,
        JSON.stringify({ contact }),
        JSON.stringify({ approvedBy, note: contact === "email" ? EMAIL_INSTEAD : "We will call BayTel." }),
        tap,
      ]);
    }
    const { rows } = await client.query<{ status: string; channel: string; approvedBy: string; approvedAt: Date; contact: "call" | "email" }>(
      `select id, run_id as "runId", status, channel, approved_by as "approvedBy", approved_at as "approvedAt", contact from approvals where run_id = $1`,
      [runId],
    );
    return rows[0]!;
  });
}

/** "Watch it again": the judge's run rows go, children first, and the replay starts over, in one transaction. Only ids with their prefix are touched. */
export async function restartSandbox(db: Db, customerId: string, now = Date.now()) {
  await inTransaction(db, async (client) => {
    await lockJudge(client, customerId);
    for (const table of [...TABLES].reverse()) await client.query(`delete from ${table} where starts_with(id, $1)`, [sandboxId(customerId, "")]);
    await startIn(client, customerId, now);
  });
  return sandboxRunId(customerId);
}

/** Sign-ups the sandbox takes, across every visitor: enough for a judging room, and a ceiling for a script. */
export const SIGNUPS_PER_MINUTE = 30;
export const SIGNUPS_PER_DAY = 1000;
/** Sign-ups from one client address a minute: a judge and a retry or two, not a script taking the whole allowance. */
export const SIGNUPS_PER_IP_PER_MINUTE = 3;
export const BUSY_TEXT = "The sandbox is busy. Try again in a minute.";

/** Keyed, so the stored hash cannot be reversed by hashing every IPv4 address. */
export const ipHash = (ip: string, key = process.env.VAULT_KEY ?? "") => createHmac("sha256", key).update(`signup-ip:${ip}`).digest("hex");

export type SandboxSignUp = { name: string; company: string; email: string; passwordHash: string; ipHash: string };

/**
 * A sandbox account: always a fresh copy of the demo customer, never linked by email to a real one, so no judge can reach
 * another's rows or the seeded customer's. The lock makes racing sign-ups take turns, so the rate limit holds.
 */
export async function createSandboxUser(db: Db, input: SandboxSignUp, customerId = `sandbox-${crypto.randomUUID()}`) {
  return inTransaction(db, async (client) => {
    await client.query("select pg_advisory_xact_lock(hashtext('sandbox:signup'))");
    const { rows } = await client.query<{ minute: number; day: number; ip: number }>(
      `select count(*) filter (where created_at > now() - interval '1 minute')::int as minute, count(*) filter (where created_at > now() - interval '1 day')::int as day,
        count(*) filter (where created_at > now() - interval '1 minute' and signup_ip_hash = $1)::int as ip from users`,
      [input.ipHash],
    );
    const { minute, day, ip } = rows[0]!;
    if (minute >= SIGNUPS_PER_MINUTE || day >= SIGNUPS_PER_DAY || ip >= SIGNUPS_PER_IP_PER_MINUTE) return "busy" as const;
    if ((await client.query("select 1 from users where email = $1", [input.email])).rowCount) return "taken" as const;
    await cloneDemoCustomer(client, customerId);
    const { rows: users } = await client.query<{ id: string }>(
      "insert into users (name, company, email, password_hash, customer_id, created_customer, signup_ip_hash) values ($1, $2, $3, $4, $5, true, $6) returning id",
      [input.name, input.company, input.email, input.passwordHash, customerId, input.ipHash],
    );
    return { id: users[0]!.id, customerId };
  });
}
