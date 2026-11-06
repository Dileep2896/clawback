status: draft

# Phase 03: Tariff engine (first part of M3, moved ahead of M2)

Build tariff loading and the bill calculator before the demo data. Section 17 lists data first, but synthetic bills have to be priced by the calculator, and the Oakland load has to be tuned against it, so this part of M3 must come first.

**Phase check:** Calculator unit tests match a hand-computed bill to the cent, on both a cached and a fallback tariff.

**Needs from the human:** `OPENEI_API_KEY` for `tariff-data`.

## Tasks

### `tariff-data`

**Goal:** Fetch and cache B-1, B-6, B-10 and B-19 from OpenEI URDB, normalize them to `Tariff`, and keep a hand-checked fallback JSON per schedule built from current PG&E tariff PDFs. Read the OpenEI docs first.

**Estimate:** 1.5 hours

**Acceptance checks:**
- Each cached record logs its start and update dates, and warns if older than 12 months.
- Every normalized tariff records whether its source was URDB or fallback.
- A test normalizes a saved URDB record to the expected 12 x 24 TOU periods, tiers, demand and fixed charges.
- Eligibility limits in section 8 are rechecked against current tariff sheets, and any difference is written down.
- Everything works offline from the cache once fetched.

**Likely files:**
- `packages/core/src/tariff/normalize.ts`
- `scripts/fetch-tariffs.ts`
- `data/tariffs/`

**depends on:** shared-contracts

**parallel with:** db-schema, platform-interfaces, platform-db-adapters, platform-io-adapters, platform-agent-runtime, tariff-calculator, load-profile, agent-roster, tools-file-approve, run-trigger, voice-sim, call-provider-tool, voice-live-spike, voice-live-line, voice-live-caller, finance-ledger, finance-invoice, monitor-check, dashboard-shell, panels-work, panels-action, panels-money

### `tariff-calculator`

**Goal:** `priceUsage(intervals, tariff, period)` and schedule eligibility, as pure functions.

**Estimate:** 1.5 hours

**Acceptance checks:**
- A flat load and a hand-computed TOU bill match to the cent.
- Weekday, weekend and month-boundary intervals land in the right period, covered by tests.
- Max kW comes from 15 minute kWh x 4 per demand window.
- Eligibility never offers B-6 at or above 75 kW.
- All money is integer cents, with one tested rounding rule.

**Likely files:**
- `packages/core/src/tariff/price-usage.ts`
- `packages/core/src/tariff/eligibility.ts`

**depends on:** shared-contracts

**parallel with:** db-schema, platform-interfaces, platform-db-adapters, platform-io-adapters, platform-agent-runtime, tariff-data, load-profile, agent-roster, tools-file-approve, run-trigger, voice-sim, call-provider-tool, voice-live-spike, voice-live-line, voice-live-caller, finance-ledger, finance-invoice, monitor-check, dashboard-shell, panels-work, panels-action, panels-money
