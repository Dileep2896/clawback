// Refreshes data/tariffs/urdb/. Run: pnpm exec tsx --env-file-if-exists=.env scripts/fetch-tariffs.ts
import { mkdirSync, writeFileSync } from "node:fs";
import { RateSchedule } from "@bill-fighter/shared/tariff";
import { normalizeUrdb, pickCurrentRecord, URDB_RECORDS } from "@bill-fighter/core/tariff/normalize";
import { logTariffDates } from "@bill-fighter/core/tariff/load";

const PGE_EIA_ID = "14328";
const PAGE_SIZE = 500;

const key = process.env.OPENEI_API_KEY;
if (!key) throw new Error("OPENEI_API_KEY is not set");

// Errors name the status only, because the request URL carries the key.
async function fetchPage(offset: number): Promise<Record<string, unknown>[]> {
  const url = new URL("https://api.openei.org/utility_rates");
  url.search = new URLSearchParams({
    version: "8",
    format: "json",
    api_key: key!,
    eia: PGE_EIA_ID,
    sector: "Commercial",
    detail: "full",
    limit: String(PAGE_SIZE),
    offset: String(offset),
  }).toString();
  const response = await fetch(url, { signal: AbortSignal.timeout(120_000) });
  if (!response.ok) throw new Error(`URDB returned HTTP ${response.status}`);
  const body = (await response.json()) as { items?: Record<string, unknown>[] };
  if (!body.items) throw new Error("URDB returned no items");
  return body.items;
}

const records: Record<string, unknown>[] = [];
for (let offset = 0; ; offset += PAGE_SIZE) {
  const page = await fetchPage(offset);
  records.push(...page);
  if (page.length < PAGE_SIZE) break;
}

// Check all four before writing any, so a failed run leaves the old cache whole.
const picked = RateSchedule.options.map((schedule) => {
  const { name, periods } = URDB_RECORDS[schedule];
  const record = pickCurrentRecord(records, name);
  logTariffDates(normalizeUrdb(record, schedule, periods));
  return { schedule, record };
});

const dir = new URL("../data/tariffs/urdb/", import.meta.url);
mkdirSync(dir, { recursive: true });
for (const { schedule, record } of picked) {
  writeFileSync(new URL(`${schedule}.json`, dir), `${JSON.stringify(record, null, 2)}\n`);
}
console.info(`Cached ${picked.length} of ${records.length} PG&E commercial records`);
