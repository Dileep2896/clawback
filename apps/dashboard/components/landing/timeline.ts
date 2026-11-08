// The landing's figures and the hero's replay clock, as pure data and functions. live-run.tsx and bento.tsx render them.
// Every value is from the recorded demo run (data/replay/run.jsonl, 4 min 28 s); the landing-live lane notes list the row behind each.

/** The agent feed in the hero's app frame, in the run's order, stamped with the run's own clock (m:ss from the start). */
export type FeedEntry = { at: string; agent: string; text: string; detail?: string; found?: boolean; quote?: boolean };

export const FEED: FeedEntry[] = [
  { at: "0:17", agent: "Collector", text: "Downloaded and stored bills and usage" },
  { at: "1:03", agent: "Auditor", text: "Fremont meter billed 2x since September 2025", detail: "Sep 2025: billed 4,611 kWh, the meter read 2,305", found: true },
  { at: "1:41", agent: "Approver", text: "Asked Linda Park to approve by SMS", detail: "Refund to claim: $12,606.06. Yearly savings: $18,319.32." },
  { at: "1:57", agent: "Approver", text: "Linda Park replied YES" },
  { at: "1:59", agent: "Negotiator", text: "Calling BayTel to cancel 7 unused lines", detail: "Please cancel phone line (415) 555-0102 on account BT-7001.", quote: true },
  { at: "4:01", agent: "Filer", text: "Filed the Rule 17.1 refund claim and 2 rate changes" },
  { at: "4:03", agent: "Finance", text: "Recorded the $12,606.06 refund, due only when granted" },
];

/** How long the replay cursor stays on each entry, and the full loop. */
export const STEP = 2_400;
export const LOOP = STEP * FEED.length;
/** How long an entry's detail line takes to stream in once the cursor reaches it. */
export const TYPE_MS = 1_200;
/** A frame longer than this (a background tab, a stall) counts as this much, so the replay never jumps ahead. */
export const MAX_FRAME = 100;

/** The entry the cursor is on at t, or -1 before the replay starts (the finished feed, as rendered on the server). */
export const activeAt = (t: number) => (t < 0 ? -1 : Math.floor(t / STEP) % FEED.length);

/** How many characters of an entry's detail show at t: all of it unless the cursor is on it, then streaming in. */
export function typedAt(index: number, t: number) {
  const detail = FEED[index]?.detail ?? "";
  if (activeAt(t) !== index) return detail.length;
  return Math.round(detail.length * Math.min(1, (t % STEP) / TYPE_MS));
}

/** The clock after one animation frame of dt ms. It stands still while paused or off-screen, and wraps at the loop's end. */
export const advance = (elapsed: number, dt: number, running: boolean) => (running ? (elapsed + Math.min(Math.max(dt, 0), MAX_FRAME)) % LOOP : elapsed);

/** Fremont electric, one point per bill: what the bill charged for, and what the meter recorded (finding evidence_json.detail.bills). */
export const FREMONT = [
  { month: "2025-07", billed: 2510, meter: 2510 },
  { month: "2025-08", billed: 2424, meter: 2424 },
  { month: "2025-09", billed: 4611, meter: 2305 },
  { month: "2025-10", billed: 4778, meter: 2389 },
  { month: "2025-11", billed: 4383, meter: 2192 },
  { month: "2025-12", billed: 4479, meter: 2239 },
  { month: "2026-01", billed: 4475, meter: 2237 },
  { month: "2026-02", billed: 4068, meter: 2034 },
  { month: "2026-03", billed: 4569, meter: 2285 },
  { month: "2026-04", billed: 4402, meter: 2201 },
  { month: "2026-05", billed: 4598, meter: 2299 },
  { month: "2026-06", billed: 4719, meter: 2359 },
  { month: "2026-07", billed: 5035, meter: 2517 },
  { month: "2026-08", billed: 4848, meter: 2424 },
  { month: "2026-09", billed: 4653, meter: 2326 },
  { month: "2026-10", billed: 4742, meter: 2371 },
];
/** The first bill on the new meter: where the two lines split. */
export const SWAP_INDEX = FREMONT.findIndex((point) => point.billed !== point.meter);

/** Ledger and approval figures, in cents. KEEP is what is left of refund plus yearly savings after the fee. */
export const REFUND_CENTS = 1_260_606;
export const YEARLY_CENTS = 1_831_932;
export const FEE_CENTS = 927_761;
export const KEEP_CENTS = REFUND_CENTS + YEARLY_CENTS - FEE_CENTS;

const usd = new Intl.NumberFormat("en-US", { style: "currency", currency: "USD" });
export const dollars = (cents: number) => usd.format(cents / 100);

/** A roll-up from 0 to `to` over `ms`, eased out, landing exactly on `to`. Display only. */
export const rollAt = (to: number, elapsed: number, ms: number) => Math.round(to * (1 - (1 - Math.min(1, Math.max(0, elapsed / ms))) ** 3));
