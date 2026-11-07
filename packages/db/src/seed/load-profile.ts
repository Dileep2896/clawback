import { readFileSync } from "node:fs";

export type LoadProfileOptions = {
  // One per store, such as "oakland-1". Same options give byte-identical output.
  seed: string;
  // ISO dates in Pacific time, both inclusive.
  start: string;
  end: string;
  // Average month over a year, lunch rush included.
  monthlyKwh: number;
  // Extra kW at the top of a daily 11am to 2pm Pacific rush. The source restaurant has no lunch peak.
  lunchKw?: number;
};

const SLOTS_PER_DAY = 96;
const LUNCH_FIRST_SLOT = 44;
const LUNCH_SLOTS = 12;
const NOISE = 0.03;
const HOURS_PER_MONTH = 8760 / 12;
const DAYS_PER_MONTH = 365 / 12;
const DAYS_IN_MONTH = [31, 28, 31, 30, 31, 30, 31, 31, 30, 31, 30, 31];

const PACIFIC = new Intl.DateTimeFormat("en-US", {
  timeZone: "America/Los_Angeles",
  hourCycle: "h23",
  year: "numeric",
  month: "2-digit",
  day: "2-digit",
  hour: "2-digit",
  weekday: "short",
});

const shapeIndex = (month: number, weekend: boolean, slot: number) =>
  (month * 2 + (weekend ? 1 : 0)) * SLOTS_PER_DAY + slot;

function readShape(): Float64Array {
  const url = new URL("../../../../data/loadprofiles/comstock-alameda-fsr.csv", import.meta.url);
  const shape = new Float64Array(12 * 2 * SLOTS_PER_DAY);
  for (const row of readFileSync(url, "utf8").trim().split("\n").slice(1)) {
    const [month, dayType, slot, relativeKw] = row.split(",");
    shape[shapeIndex(Number(month) - 1, dayType === "weekend", Number(slot))] = Number(relativeKw);
  }
  return shape;
}

// Mean of the shape over a typical year, so scaling it hits a kWh target.
function meanRelativeKw(shape: Float64Array): number {
  let weighted = 0;
  for (let month = 0; month < 12; month++) {
    for (let slot = 0; slot < SLOTS_PER_DAY; slot++) {
      const day = (5 * shape[shapeIndex(month, false, slot)]! + 2 * shape[shapeIndex(month, true, slot)]!) / 7;
      weighted += day * DAYS_IN_MONTH[month]!;
    }
  }
  return weighted / (365 * SLOTS_PER_DAY);
}

// mulberry32, seeded by an FNV-1a hash of the string.
function seededRandom(seed: string): () => number {
  let state = 0x811c9dc5;
  for (let i = 0; i < seed.length; i++) state = Math.imul(state ^ seed.charCodeAt(i), 0x01000193);
  return () => {
    state = (state + 0x6d2b79f5) | 0;
    let t = Math.imul(state ^ (state >>> 15), 1 | state);
    t = (t + Math.imul(t ^ (t >>> 7), 61 | t)) ^ t;
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
}

// Raised cosine over the rush, averaging exactly one half, so its energy is known up front.
const lunchShare = (slot: number) => {
  const inRush = slot - LUNCH_FIRST_SLOT;
  return inRush < 0 || inRush >= LUNCH_SLOTS ? 0 : Math.sin((Math.PI * (inRush + 0.5)) / LUNCH_SLOTS) ** 2;
};

// 15 minute intervals, ts as the UTC ISO start of each, ready for priceUsage.
export function loadProfile({ seed, start, end, monthlyKwh, lunchKw = 0 }: LoadProfileOptions): { ts: string; kwh: number }[] {
  const startMs = Date.parse(start);
  const endMs = Date.parse(end);
  if (!(startMs <= endMs)) throw new Error(`Bad load profile window: ${start} to ${end}`);
  const lunchMonthlyKwh = lunchKw * (LUNCH_SLOTS / 4) * 0.5 * DAYS_PER_MONTH;
  if (lunchKw < 0 || lunchMonthlyKwh >= monthlyKwh) {
    throw new Error(`A ${lunchKw} kW lunch rush does not fit in ${monthlyKwh} kWh a month`);
  }

  const shape = readShape();
  const kwPerRelative = (monthlyKwh - lunchMonthlyKwh) / HOURS_PER_MONTH / meanRelativeKw(shape);
  const random = seededRandom(seed);
  const noise = () => 1 + (random() - 0.5) * 2 * NOISE;

  const intervals: { ts: string; kwh: number }[] = [];
  let dayNoise = 1;
  let currentDate = "";
  // Pacific offsets are whole hours, so one lookup per hour is enough. Walking UTC keeps the
  // daylight saving days at 92 and 100 intervals. UTC midnight on `start` is still the Pacific day before.
  for (let hourMs = startMs; hourMs < endMs + 2 * 86_400_000; hourMs += 3_600_000) {
    const parts = Object.fromEntries(PACIFIC.formatToParts(new Date(hourMs)).map((p) => [p.type, p.value]));
    const date = `${parts.year}-${parts.month}-${parts.day}`;
    if (date < start) continue;
    if (date > end) break;
    if (date !== currentDate) {
      currentDate = date;
      dayNoise = noise();
    }
    const month = Number(parts.month) - 1;
    const weekend = parts.weekday === "Sat" || parts.weekday === "Sun";
    for (let quarter = 0; quarter < 4; quarter++) {
      const slot = Number(parts.hour) * 4 + quarter;
      const kw = shape[shapeIndex(month, weekend, slot)]! * kwPerRelative + lunchKw * lunchShare(slot);
      intervals.push({
        ts: new Date(hourMs + quarter * 900_000).toISOString(),
        // Three decimals keeps the output byte-stable.
        kwh: Number(((kw / 4) * dayNoise * noise()).toFixed(3)),
      });
    }
  }
  return intervals;
}
