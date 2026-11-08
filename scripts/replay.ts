// Plays a recorded run back into local Postgres, so the dashboard shows it with no agents, model, portal, Stripe or network. Always labelled replay.
// Replay:  pnpm demo:replay [--speed N] [--force]. Clears run state first. N scales every gap by the same factor, 1 to 8, default 1.
// Capture: pnpm demo:reset, then pnpm demo:replay --capture [--approve-after SECONDS], then pnpm demo:start. VOICE_MODE=sim only.
import { mkdir, readFile, rename, writeFile } from "node:fs/promises";
import { dirname } from "node:path";
import { setTimeout as sleep } from "node:timers/promises";
import { fileURLToPath, pathToFileURL } from "node:url";
import { parseArgs } from "node:util";
import { RUNS_DIR } from "@bill-fighter/agents/customer-data";
import { databaseUrl, db, type Db } from "@bill-fighter/db/client";
import type { Vault } from "@bill-fighter/platform/types";
import { checkConnected, checkTarget, demoReset, RUN_TABLES } from "./demo-reset.ts";

type Pool = Db["$client"];
type Row = Record<string, unknown>;

// What the dashboard shows, parents first. Every one has a text id.
// Not scheduled_checks: no panel shows it, and a running scheduler fires any due pending row, which would start a real model run from a replay.
const TABLES = ["runs", "findings", "actions", "approvals", "calls", "ledger", "board_cards", "audit_log", "sms_messages"];
// One statement, so each read is one consistent view. Tool inputs and outputs never reach the browser, so they stay out of a committed file.
const SCAN = TABLES.map((table) => `select '${table}' as tbl, x.id as id, to_jsonb(x)${table === "audit_log" ? " - 'input_json'::text - 'output_json'::text" : ""} as row from ${table} x`).join(" union all ");

const REPLAY_LOCK = 7_300_511;
const MIN_SPEED = 1;
const MAX_SPEED = 8;
const DEFAULT_FILE = fileURLToPath(new URL("../data/replay/run.jsonl", import.meta.url));

export type ReplayEvent = { t: number; table: string; op: "upsert" | "delete"; id: string; row?: Row };
export type Recording = { recordedAt: string; durationMs: number; events: ReplayEvent[] };
type ScanRow = { tbl: string; id: string; row: Row };

const scan = async (pool: Pool) => (await pool.query<ScanRow>(SCAN)).rows;
const isRow = (rows: ScanRow[], table: string) => rows.filter(({ tbl }) => tbl === table).map(({ row }) => row);

/** The changes since the last read, and what to compare the next read with. */
export function diffRows(seen: Map<string, string>, rows: ScanRow[], t: number) {
  const now = new Map<string, string>();
  const events: ReplayEvent[] = [];
  for (const { tbl, id, row } of rows) {
    const key = `${tbl}/${id}`;
    const text = JSON.stringify(row);
    now.set(key, text);
    if (seen.get(key) !== text) events.push({ t, table: tbl, op: "upsert", id, row });
  }
  for (const key of seen.keys()) {
    if (now.has(key)) continue;
    const [table, ...id] = key.split("/");
    events.push({ t, table: table!, op: "delete", id: id.join("/") });
  }
  return { events, seen: now };
}

/** The rows as they stood when the recording ended. */
function finalRows(events: ReplayEvent[]) {
  const rows = new Map<string, ScanRow>();
  for (const { table, op, id, row } of events) {
    if (op === "delete") rows.delete(`${table}/${id}`);
    else rows.set(`${table}/${id}`, { tbl: table, id, row: row! });
  }
  return [...rows.values()];
}

/** Why this recording must not become the demo's backup. Empty means it is good. */
export function recordingProblems(recording: Recording, secrets: string[]) {
  const final = finalRows(recording.events);
  const problems: string[] = [];
  const runs = isRow(final, "runs");
  if (runs.length !== 1) problems.push(`expected one run, found ${runs.length}`);
  if (runs[0]?.status !== "success") problems.push(`run status is ${String(runs[0]?.status)}, not success`);
  const approved = isRow(final, "approvals").filter(({ status }) => status === "approved").length;
  if (approved !== 1) problems.push(`expected one human action, found ${approved}`);
  if (isRow(final, "ledger").length === 0) problems.push("no ledger rows");
  // The SDK calls a run a success even when a step could not finish, and a backup must not show that on stage.
  const blocked = isRow(final, "board_cards").filter(({ status }) => status === "blocked").map(({ title }) => String(title));
  if (blocked.length > 0) problems.push(`board cards ended blocked: ${blocked.join(", ")}`);
  const calls = isRow(final, "calls");
  if (calls.length === 0) problems.push("no call");
  // An email to BayTel's replica desk spends no voice credit, so it may be recorded like a sim call.
  if (calls.some(({ mode }) => mode !== "sim" && mode !== "email")) problems.push("a call is not sim");
  if (calls.some(({ transcript_json: rows }) => (rows as { kind?: string }[] | null)?.some(({ kind }) => kind === "fallback"))) problems.push("a call fell back from live");
  try {
    checkRecording(recording);
  } catch (error) {
    problems.push((error as Error).message);
  }
  const text = JSON.stringify(recording);
  // Escaped the way the file escapes it, so a secret holding quotes, backslashes or newlines still matches.
  // shortcut: misses a secret re-encoded inside a string (JSON in JSON, base64), upgrade if tool data ever enters the file.
  const leaks = secrets.filter((secret) => text.includes(JSON.stringify(secret).slice(1, -1))).length;
  if (leaks > 0) problems.push(`${leaks} secrets appear in the recording`);
  return problems;
}

const serialize = ({ events, ...header }: Recording) => [header, ...events].map((line) => JSON.stringify(line)).join("\n") + "\n";
const isIsoTime = (text: unknown) => typeof text === "string" && !Number.isNaN(Date.parse(text)) && new Date(text).toISOString() === text;

/** Throws on a recording that cannot play as one labelled run. Called before anything is cleared. */
export function checkRecording({ recordedAt, durationMs, events }: Recording) {
  if (!isIsoTime(recordedAt) || !Number.isFinite(durationMs) || durationMs < 0) throw new Error("The recording has no valid header");
  if (events.length === 0) throw new Error("The recording has no events");
  let last = 0;
  for (const { t, table, op, id, row } of events) {
    // These names go into SQL. The file is committed, but a bad line must stop here rather than half way through a demo.
    if (!Number.isFinite(t) || t < last || !TABLES.includes(table) || !["upsert", "delete"].includes(op) || typeof id !== "string") throw new Error(`The recording has a bad event: ${table} ${id} at ${t}`);
    if (op === "upsert" && (!row || row.id !== id || !Object.keys(row).every((column) => /^\w+$/.test(column)))) throw new Error(`The recording has a bad row: ${table} ${id}`);
    last = t;
  }
  // A cut-off file ends early, and its header still says how long the run was.
  if (durationMs !== last) throw new Error(`The recording ends at ${last} ms but its header says ${durationMs} ms`);
  // The run row carries the replay label, so it must be there from the first tick.
  if (events.find(({ table, op }) => table === "runs" && op === "upsert")?.t !== 0) throw new Error("The recording does not start with its run");
  if (isRow(finalRows(events), "runs").length !== 1) throw new Error("The recording does not end with exactly one run");
}

export function parseRecording(text: string): Recording {
  const [header, ...events] = text.trim().split("\n").map((line) => JSON.parse(line) as Record<string, unknown>);
  const recording = { recordedAt: header?.recordedAt, durationMs: header?.durationMs, events } as Recording;
  checkRecording(recording);
  return recording;
}

export type CaptureOptions = {
  pool: Pool;
  file: string;
  secrets: string[];
  /** Posts YES to the real SMS route this long after the text arrives. Null waits for someone to answer. */
  approveAfterMs: number | null;
  dashboardUrl: string;
  pollMs?: number;
  tailMs?: number;
  timeoutMs?: number;
};

async function postYes(dashboardUrl: string, runId: string) {
  const response = await fetch(new URL("/api/sms", dashboardUrl), {
    method: "POST",
    headers: { "content-type": "application/json" },
    body: JSON.stringify({ runId, body: "YES" }),
    signal: AbortSignal.timeout(5000),
  });
  if (!response.ok) throw new Error(`/api/sms returned ${response.status}: ${await response.text()}`);
}

/**
 * Watches the database from an empty start until the run ends. It starts nothing itself. It polls because the rows cannot
 * rebuild the timeline afterwards: actions and findings have no times, and a transcript grows inside one calls row.
 * A failed capture goes to <file>.failed, so it can never replace a good recording.
 */
export async function capture({ pool, file, secrets, approveAfterMs, dashboardUrl, pollMs = 250, tailMs = 3000, timeoutMs = 30 * 60_000 }: CaptureOptions) {
  if (process.env.VOICE_MODE !== "sim") throw new Error(`A capture needs VOICE_MODE=sim, and it is "${process.env.VOICE_MODE}"`);
  if ((await scan(pool)).length > 0) throw new Error("The run tables are not empty. Run `pnpm demo:reset` first.");

  const begun = Date.now();
  const events: ReplayEvent[] = [];
  const problems: string[] = [];
  let seen = new Map<string, string>();
  let firstRowAt: number | null = null;
  let endedAt: number | null = null;
  let textSeenAt: number | null = null;
  let approved = false;

  try {
    for (;;) {
      const rows = await scan(pool);
      const now = Date.now();
      if (rows.length > 0) firstRowAt ??= now;
      const change = diffRows(seen, rows, firstRowAt === null ? 0 : now - firstRowAt);
      seen = change.seen;
      events.push(...change.events);

      const run = isRow(rows, "runs")[0];
      if (run && run.status !== "running") endedAt ??= now;
      if (endedAt !== null && now - endedAt >= tailMs) break;
      if (now - begun > timeoutMs) throw new Error(`no finished run within ${timeoutMs / 60_000} minutes`);

      const pending = isRow(rows, "approvals").some(({ status }) => status === "pending");
      if (run && approveAfterMs !== null && !approved && pending && isRow(rows, "sms_messages").some(({ direction }) => direction === "outbound")) {
        textSeenAt ??= now;
        if (now - textSeenAt >= approveAfterMs) {
          // A failed post tries again on the next read, because the run is parked until this lands.
          await postYes(dashboardUrl, run.id as string).then(
            () => (approved = true),
            (error: unknown) => console.warn(`Could not post YES, will retry: ${String(error)}`),
          );
        }
      }
      await sleep(pollMs);
    }
  } catch (error) {
    problems.push(error instanceof Error ? error.message : String(error));
  }

  const recording: Recording = { recordedAt: new Date(firstRowAt ?? begun).toISOString(), durationMs: events.at(-1)?.t ?? 0, events };
  problems.push(...recordingProblems(recording, secrets));
  const target = problems.length > 0 ? `${file}.failed` : file;
  await mkdir(dirname(file), { recursive: true });
  // Rename, so an interrupted write cannot leave half a recording under the good name.
  await writeFile(`${target}.tmp`, serialize(recording));
  await rename(`${target}.tmp`, target);
  return { file: target, problems, recording };
}

export type ReplayOptions = {
  pool: Pool;
  url: string;
  runsDir: string;
  allowNonlocal: boolean;
  recording: Recording;
  speed: number;
  force: boolean;
};

export function checkSpeed(speed: number) {
  if (!Number.isFinite(speed) || speed < MIN_SPEED || speed > MAX_SPEED) throw new Error(`--speed must be a number from ${MIN_SPEED} to ${MAX_SPEED}`);
}

type Client = Pick<Pool, "query">;

async function applyEvents(client: Client, events: ReplayEvent[], label: Row) {
  const order = (event: ReplayEvent) => TABLES.indexOf(event.table);
  const deletes = events.filter(({ op }) => op === "delete").sort((a, b) => order(b) - order(a));
  const upserts = events.filter(({ op }) => op === "upsert").sort((a, b) => order(a) - order(b));
  for (const { table, id } of deletes) await client.query(`delete from ${table} where id = $1`, [id]);
  for (const { table, row } of upserts) {
    // On every run update, so no poll can ever read this run without its label.
    // Recordings made before approvals.contact existed hold no choice, and those runs called.
    const values = table === "runs" ? { ...row, replay: label } : table === "approvals" ? { contact: "call", ...row } : row!;
    const sets = Object.keys(values).filter((column) => column !== "id").map((column) => `"${column}" = excluded."${column}"`);
    await client.query(`insert into ${table} select * from jsonb_populate_record(null::${table}, $1::jsonb) on conflict (id) do update set ${sets.join(", ")}`, [JSON.stringify(values)]);
  }
}

/** Plays every tick into an empty copy of the run tables and rolls it all back, so a row this database cannot hold (a missing field, a bad value, a seed row it lacks) fails before the reset clears the last run. */
async function rehearse(client: Client, ticks: Iterable<ReplayEvent[]>, label: Row) {
  await client.query("BEGIN");
  try {
    await client.query("SET LOCAL lock_timeout = '5s'");
    await client.query(`TRUNCATE ${RUN_TABLES.join(", ")}`);
    for (const events of ticks) await applyEvents(client, events, label);
  } finally {
    await client.query("ROLLBACK");
  }
}

async function applyTick(client: Client, events: ReplayEvent[], label: Row) {
  await client.query("BEGIN");
  try {
    await applyEvents(client, events, label);
    await client.query("COMMIT");
  } catch (error) {
    await client.query("ROLLBACK");
    throw error;
  }
}

/** Timestamps go in exactly as recorded, so every time on screen is true. Each tick is timed from the start, so errors cannot add up. */
export async function replay({ pool, url, runsDir, allowNonlocal, recording, speed, force }: ReplayOptions) {
  checkSpeed(speed);
  checkRecording(recording);
  checkTarget({ url, mailpitApi: null, allowNonlocal });
  await checkConnected({ pool, url });

  const client = await pool.connect();
  try {
    const { locked } = (await client.query<{ locked: boolean }>("select pg_try_advisory_lock($1) as locked", [REPLAY_LOCK])).rows[0]!;
    if (!locked) throw new Error("Another replay is already playing. Stop it first.");

    // A live agent would write into this replay's ledger. A stopped replay is harmless, so it does not count.
    const live = (await client.query<{ id: string }>("select id from runs where status = 'running' and replay is null")).rows.map(({ id }) => id);
    if (live.length > 0 && !force) {
      throw new Error(`Run ${live.join(", ")} is still marked running. If it may be alive, restart \`pnpm dev:webhooks\` so it cannot write into the replay, then add --force.`);
    }

    const ticks = new Map<number, ReplayEvent[]>();
    for (const event of recording.events) ticks.set(event.t, [...(ticks.get(event.t) ?? []), event]);
    await rehearse(client, ticks.values(), { recordedAt: recording.recordedAt, speed, startedAt: new Date().toISOString() });

    await demoReset({ pool, url, mailpitApi: null, runsDir, allowNonlocal });

    const start = Date.now();
    const label = { recordedAt: recording.recordedAt, speed, startedAt: new Date(start).toISOString() };
    for (const [t, events] of ticks) {
      const wait = start + t / speed - Date.now();
      if (wait > 0) await sleep(wait);
      await applyTick(client, events, label);
    }
    return { playedMs: Date.now() - start, recordedMs: recording.durationMs };
  } finally {
    // Destroyed rather than returned, because that is what lets go of the session lock.
    client.release(true);
  }
}

const minutes = (ms: number) => `${Math.floor(ms / 60_000)}:${String(Math.floor(ms / 1000) % 60).padStart(2, "0")}`;

/** Loaded only here, so plain replay never touches the platform, the vault or anything else that could need a network. */
export async function secretValues(vault?: Vault) {
  const { Provider } = await import("@bill-fighter/shared/fixtures");
  const { portalVaultName } = await import("@bill-fighter/shared/portal");
  vault ??= await (await import("@bill-fighter/platform/factory")).getPlatform().vault();
  const fields = ["username", "password"] as const;
  const credentials = await Promise.all(Provider.options.flatMap((provider) => fields.map((field) => vault.get(portalVaultName(provider, field)))));
  const fromEnv = Object.entries(process.env).flatMap(([name, value]) => (/(_KEY|_TOKEN|_SECRET)$/.test(name) && value ? [value] : []));
  return [...credentials, ...fromEnv];
}

function explain(error: unknown) {
  const code = (error as { code?: string }).code;
  if (code === "42703") return "This database is missing the replay column. Run `pnpm db:migrate` first.";
  if (code === "23503") return "The recording refers to seed rows this database does not have. Run `pnpm seed` first.";
  return error instanceof Error ? error.message : String(error);
}

async function main() {
  const { values } = parseArgs({
    options: {
      capture: { type: "boolean", default: false },
      "approve-after": { type: "string" },
      speed: { type: "string", default: "1" },
      force: { type: "boolean", default: false },
      file: { type: "string", default: DEFAULT_FILE },
    },
  });

  if (values.capture) {
    const approveAfter = values["approve-after"];
    console.info(`Watching for a run. Start it with \`pnpm demo:start\`. ${approveAfter === undefined ? "Answer the text yourself." : `YES goes in ${approveAfter}s after the text.`}`);
    const { file, problems, recording } = await capture({
      pool: db.$client,
      file: values.file,
      secrets: await secretValues(),
      approveAfterMs: approveAfter === undefined ? null : Number(approveAfter) * 1000,
      dashboardUrl: process.env.DASHBOARD_URL ?? "http://localhost:3000",
    });
    console.info(`Saved ${recording.events.length} events over ${minutes(recording.durationMs)} to ${file}`);
    if (problems.length > 0) throw new Error(`This capture is not usable: ${problems.join("; ")}`);
    return;
  }

  const speed = Number(values.speed);
  checkSpeed(speed);
  const recording = parseRecording(await readFile(values.file, "utf8").catch((cause: unknown) => {
    throw new Error(`No recording at ${values.file}. Capture one first, see the top of scripts/replay.ts.`, { cause });
  }));
  console.info(`REPLAY of the run recorded ${recording.recordedAt}, ${minutes(recording.durationMs)} long, at ${speed}x.`);
  const { playedMs, recordedMs } = await replay({
    pool: db.$client,
    url: databaseUrl(),
    runsDir: RUNS_DIR,
    allowNonlocal: process.env.DEMO_RESET_ALLOW_NONLOCAL === "1",
    recording,
    speed,
    force: values.force,
  });
  console.info(`Replay finished in ${minutes(playedMs)}. The recording is ${minutes(recordedMs)}.`);
}

if (process.argv[1] && import.meta.url === pathToFileURL(process.argv[1]).href) {
  try {
    await main();
  } catch (error) {
    console.error(`Replay stopped: ${explain(error)}`);
    process.exitCode = 1;
  } finally {
    await db.$client.end();
  }
}
