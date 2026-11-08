// A recorded run (data/replay/run.jsonl) and how its rows are written. Shared by scripts/replay.ts, which plays it
// into the stage database, and the dashboard's judge sandbox, which plays it into one judge's own rows.
import type { Db } from "./client.ts";

type Row = Record<string, unknown>;
type Client = Pick<Db["$client"], "query">;

export // What the dashboard shows, parents first. Every one has a text id.
// Not scheduled_checks: no panel shows it, and a running scheduler fires any due pending row, which would start a real model run from a replay.
const TABLES = ["runs", "findings", "actions", "approvals", "calls", "ledger", "board_cards", "audit_log", "sms_messages"];

export type ReplayEvent = { t: number; table: string; op: "upsert" | "delete"; id: string; row?: Row };
export type Recording = { recordedAt: string; durationMs: number; events: ReplayEvent[] };
export type ScanRow = { tbl: string; id: string; row: Row };

export const isRow = (rows: ScanRow[], table: string) => rows.filter(({ tbl }) => tbl === table).map(({ row }) => row);

/** The rows as they stood when the recording ended. */
export function finalRows(events: ReplayEvent[]) {
  const rows = new Map<string, ScanRow>();
  for (const { table, op, id, row } of events) {
    if (op === "delete") rows.delete(`${table}/${id}`);
    else rows.set(`${table}/${id}`, { tbl: table, id, row: row! });
  }
  return [...rows.values()];
}

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

export async function applyEvents(client: Client, events: ReplayEvent[], label: Row) {
  const order = (event: ReplayEvent) => TABLES.indexOf(event.table);
  const deletes = events.filter(({ op }) => op === "delete").sort((a, b) => order(b) - order(a));
  const upserts = events.filter(({ op }) => op === "upsert").sort((a, b) => order(a) - order(b));
  for (const { table, id } of deletes) await client.query(`delete from ${table} where id = $1`, [id]);
  for (const { table, row } of upserts) {
    // On every run update, so no poll can ever read this run without its label.
    const values = table === "runs" ? { ...row, replay: label } : row!;
    const sets = Object.keys(values).filter((column) => column !== "id").map((column) => `"${column}" = excluded."${column}"`);
    await client.query(`insert into ${table} select * from jsonb_populate_record(null::${table}, $1::jsonb) on conflict (id) do update set ${sets.join(", ")}`, [JSON.stringify(values)]);
  }
}
