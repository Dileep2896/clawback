status: draft

# Phase 04: Demo data and seed (M2)

Generate Golden Gate Noodle Co. deterministically from a fixed seed: load profiles, accounts, phone lines, the four planted problems, the decoy and real-looking PDF bills. Plant the problems in the data only. Nothing in the generator may pass answers to the audit rules.

**Phase check:** `pnpm seed` creates 12 locations, 37 accounts (36 plus the decoy gas account) and 448 bills, and the PDFs look like real bills.

**Needs from the human:** Nothing new.

## Tasks

### `load-profile`

**Goal:** Pick one ComStock or Green Button restaurant profile, store only the small extract needed, and scale it per store with fixed-seed noise.

**Estimate:** 0.5 hours

**Acceptance checks:**
- Same seed gives byte-identical intervals, proven by a test.
- The source and its license or terms are recorded next to the data.
- Output is 15 minute intervals covering at least the full 16 month window.

**Likely files:**
- `data/loadprofiles/`
- `packages/db/src/seed/load-profile.ts`

**depends on:** shared-contracts

**parallel with:** db-schema, platform-interfaces, platform-db-adapters, platform-io-adapters, platform-agent-runtime, tariff-data, tariff-calculator, agent-roster, tools-file-approve, run-trigger, voice-sim, call-provider-tool, voice-live-spike, voice-live-line, voice-live-caller, finance-ledger, finance-invoice, monitor-check, dashboard-shell, panels-work, panels-action, panels-money

### `seed-generator`

**Goal:** Generate the section 7 customer and plant all problems as deterministic fixtures in `data/seed/`, priced by the calculator. Fremont #1 gets 16 months of electric bills and intervals (2 before the meter swap, 14 after), because the $12,600 refund and the jump at the swap cannot be proven from 12. All other accounts stay at 12.

**Estimate:** 1.5 hours

**Acceptance checks:**
- Fremont #1: a new meter number and a multiplier change from 1 to 2 at the swap, billed kWh exactly 2.0 x interval kWh for 14 months.
- Oakland #1 and #2 are on B-10 with about 40 kW max demand and a lunch-heavy load, aiming for B-6 3 to 5% cheaper. Whatever the calculator shows is what gets used, and no number is ever forced.
- Nine POTS lines across six stores: seven with zero calls, two alarm lines with low use, $60 each.
- Three BayConnect accounts jump from $95 to $185 inside the 12 month window on the same plan code, with no usage change.
- Oakland #3 has one gas account with 12 bills at the fictional third party gas supplier. If gas is cut per section 17, totals drop to 36 accounts and 436 bills.
- Annual spend is about $300,000, within 10%.
- A test confirms no fixture contains a precomputed finding or savings figure.

**Likely files:**
- `packages/db/src/seed/generate.ts`
- `packages/db/src/seed/customer.ts`

**depends on:** tariff-data, tariff-calculator, load-profile

**parallel with:** db-schema, platform-interfaces, platform-db-adapters, platform-io-adapters, platform-agent-runtime, agent-roster, tools-file-approve, run-trigger, voice-sim, call-provider-tool, voice-live-spike, voice-live-line, voice-live-caller, finance-ledger, finance-invoice, monitor-check, dashboard-shell, panels-work, panels-action, panels-money

### `bill-pdfs`

**Goal:** Render every fixture bill to a PDF per provider using Playwright HTML to PDF, with original fictional branding and a "Demo data" mark.

**Estimate:** 1 hour

**Acceptance checks:**
- 448 PDFs are generated into `data/bills/` from one command.
- A human opens one bill per provider and agrees it looks like a real bill.
- No real company logo, design or text is used.
- PDF text extraction returns the account number, meter number, multiplier and every line item, proven by a test.

**Likely files:**
- `packages/db/src/seed/bill-pdf.ts`
- `packages/db/src/seed/templates/`

**depends on:** seed-generator

**parallel with:** db-schema, platform-interfaces, platform-db-adapters, platform-io-adapters, platform-agent-runtime, rules-billing, rules-rates-lines, agent-roster, tools-file-approve, run-trigger, voice-sim, call-provider-tool, voice-live-spike, voice-live-line, voice-live-caller, finance-ledger, finance-invoice, monitor-check, dashboard-shell, panels-work, panels-action, panels-money

### `seed-loader`

**Goal:** `pnpm seed` runs the generator and bulk loads Postgres, including `usage_intervals`, safely re-runnable.

**Estimate:** 0.5 hours

**Acceptance checks:**
- Counts are exactly 12 locations, 37 accounts and 448 bills, and running twice gives the same result.
- A full seed runs in under 2 minutes, using bulk inserts for the interval rows.
- A signed `authorizations` row modeled on Form 79-1095 exists for each provider.

**Likely files:**
- `scripts/seed.ts`
- `packages/db/src/seed/load.ts`

**depends on:** db-schema, bill-pdfs

**parallel with:** platform-interfaces, platform-db-adapters, platform-io-adapters, platform-agent-runtime, bill-parser, rules-billing, rules-rates-lines, audit-local-cli, agent-roster, tools-file-approve, run-trigger, voice-sim, call-provider-tool, voice-live-spike, voice-live-line, voice-live-caller, finance-ledger, finance-invoice, monitor-check, dashboard-shell, panels-work, panels-action, panels-money
