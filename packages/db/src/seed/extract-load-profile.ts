// One-off: pnpm exec tsx packages/db/src/seed/extract-load-profile.ts <downloaded ComStock csv>
// Turns one ComStock aggregate into data/loadprofiles/comstock-alameda-fsr.csv. See the README there.
import { readFileSync, writeFileSync } from "node:fs";
import { pathToFileURL } from "node:url";

const KWH_COLUMN = "out.electricity.total.energy_consumption.kwh";
const ROWS_IN_YEAR = 35_040;
const INTERVAL_MS = 15 * 60_000;

const PACIFIC = new Intl.DateTimeFormat("en-US", {
  timeZone: "America/Los_Angeles",
  hourCycle: "h23",
  month: "numeric",
  hour: "numeric",
  minute: "numeric",
  weekday: "short",
});

// ComStock labels are period-ending EST all year: "00:15:00" is the interval that started at 00:00 EST.
export function intervalStart(label: string): Date {
  const ending = Date.parse(`${label.replace(" ", "T")}-05:00`);
  if (Number.isNaN(ending)) throw new Error(`Bad ComStock timestamp: ${label}`);
  return new Date(ending - INTERVAL_MS);
}

// Averages a year into month x weekday or weekend x Pacific wall clock slot, scaled so the largest is 1.
export function extractProfile(csv: string): string {
  const [header, ...rows] = csv.trim().split("\n");
  const columns = header!.split(",");
  const tsAt = columns.indexOf("timestamp");
  const kwhAt = columns.indexOf(KWH_COLUMN);
  if (tsAt < 0 || kwhAt < 0) throw new Error(`Missing timestamp or ${KWH_COLUMN} column`);
  if (rows.length !== ROWS_IN_YEAR) throw new Error(`Expected ${ROWS_IN_YEAR} rows, got ${rows.length}`);

  const buckets = new Map<string, { sum: number; count: number }>();
  for (const row of rows) {
    const cells = row.split(",");
    const kwh = Number(cells[kwhAt]);
    if (!Number.isFinite(kwh)) throw new Error(`Bad kWh in row: ${cells[tsAt]}`);
    const parts = Object.fromEntries(PACIFIC.formatToParts(intervalStart(cells[tsAt]!)).map((p) => [p.type, p.value]));
    const dayType = parts.weekday === "Sat" || parts.weekday === "Sun" ? "weekend" : "weekday";
    const slot = Number(parts.hour) * 4 + Number(parts.minute) / 15;
    const key = `${parts.month},${dayType},${slot}`;
    const bucket = buckets.get(key) ?? { sum: 0, count: 0 };
    bucket.sum += kwh;
    bucket.count += 1;
    buckets.set(key, bucket);
  }

  const mean = (key: string) => {
    const bucket = buckets.get(key);
    if (!bucket) throw new Error(`No source rows for ${key}`);
    return bucket.sum / bucket.count;
  };
  const keys: string[] = [];
  for (let month = 1; month <= 12; month++) {
    for (const dayType of ["weekday", "weekend"]) {
      for (let slot = 0; slot < 96; slot++) keys.push(`${month},${dayType},${slot}`);
    }
  }
  const max = Math.max(...keys.map(mean));
  return ["month,day_type,slot,relative_kw", ...keys.map((key) => `${key},${(mean(key) / max).toFixed(4)}`), ""].join("\n");
}

if (process.argv[1] && import.meta.url === pathToFileURL(process.argv[1]).href) {
  const source = process.argv[2];
  if (!source) throw new Error("Usage: extract-load-profile.ts <downloaded ComStock csv>");
  const out = new URL("../../../../data/loadprofiles/comstock-alameda-fsr.csv", import.meta.url);
  writeFileSync(out, extractProfile(readFileSync(source, "utf8")));
}
