status: draft

# Phase 05: Parser and audit rules (rest of M3)

Parse bills and run every audit rule. All money math stays in code. `pnpm audit:local` must work with every agent and service down, so it reads generated fixtures, not Postgres or Claude. Parsing 448 bills live through Claude is probably too slow and too expensive for one demo run, so the parser caches by file hash and measures the real cost.

**Phase check:** `pnpm audit:local` prints the four findings near section 7 amounts, with no supplier switch advice, and the real sample bill parses.

**Needs from the human:** `ANTHROPIC_API_KEY` for `bill-parser`.

## Tasks

### `bill-parser`

**Goal:** Pure parser in `packages/core` with the LLM call injected through `Llm.structured`, arithmetic validation, retry once with page images, then "needs review". Includes a cache keyed by PDF sha256 and schema version, and the real public PG&E sample bill in `data/samples/`.

**Estimate:** 1.5 hours

**Acceptance checks:**
- Fails a bill whose lines do not sum to the total, or whose kWh x rate misses by more than 1%.
- The second parse of the same PDF makes no LLM call.
- Parsing all 448 bills reports total time and cost, and the numbers are written into the PR.
- The real sample bill parses. It is a solar billing statement, so if its layout breaks arithmetic validation, report the gap and do not loosen validation to pass.
- The sample is never loaded into the demo customer, proven by a test.

**Likely files:**
- `packages/core/src/parser/`
- `packages/agents/src/parse-cache.ts`
- `data/samples/`

**depends on:** platform-agent-runtime, bill-pdfs

**parallel with:** db-schema, platform-db-adapters, platform-io-adapters, seed-loader, rules-billing, rules-rates-lines, audit-local-cli, portal-shell, portal-downloads, agent-roster, tools-file-approve, run-trigger, voice-sim, call-provider-tool, voice-live, finance-ledger, finance-invoice, monitor-check, dashboard-shell, panels-work, panels-action, panels-money

### `rules-billing`

**Goal:** `meterMultiplierJump`, `promoExpiry`, `arithmeticCheck` and `thirdPartySupplier`.

**Estimate:** 1 hour

**Acceptance checks:**
- Fremont #1 is found with a refund near $12,600 (36 month cap applied) and yearly savings near $10,800, with evidence pointing at exact bill and line ids.
- Three promo findings total about $3,240 a year.
- The Oakland #3 decoy gives "review contract, check exit fees", with $0 savings and no switch advice.
- An unchanged bill set produces zero findings from these rules.

**Likely files:**
- `packages/core/src/rules/meter-multiplier.ts`
- `packages/core/src/rules/promo-expiry.ts`
- `packages/core/src/rules/arithmetic-check.ts`
- `packages/core/src/rules/third-party-supplier.ts`

**depends on:** seed-generator

**parallel with:** db-schema, platform-interfaces, platform-db-adapters, platform-io-adapters, platform-agent-runtime, bill-pdfs, seed-loader, bill-parser, rules-rates-lines, portal-shell, portal-downloads, agent-roster, tools-file-approve, run-trigger, voice-sim, call-provider-tool, voice-live, finance-ledger, finance-invoice, monitor-check, dashboard-shell, panels-work, panels-action, panels-money

### `rules-rates-lines`

**Goal:** `rateOptimization` and `unusedLines`.

**Estimate:** 1 hour

**Acceptance checks:**
- Oakland #1 and #2 get a Rule 12 B-6 proposal with a per month comparison, and savings are computed by the calculator, never hard coded.
- No proposal is made at or under 2% savings, or for a schedule the account does not qualify for.
- Seven unused lines total $5,040 a year.
- Two alarm lines get "confirm with alarm company", with $0 savings and no cancel action.

**Likely files:**
- `packages/core/src/rules/rate-optimization.ts`
- `packages/core/src/rules/unused-lines.ts`

**depends on:** seed-generator

**parallel with:** db-schema, platform-interfaces, platform-db-adapters, platform-io-adapters, platform-agent-runtime, bill-pdfs, seed-loader, bill-parser, rules-billing, portal-shell, portal-downloads, agent-roster, tools-file-approve, run-trigger, voice-sim, call-provider-tool, voice-live, finance-ledger, finance-invoice, monitor-check, dashboard-shell, panels-work, panels-action, panels-money

### `audit-local-cli`

**Goal:** Rule runner, `pnpm audit:local`, and the end-to-end test over the seeded customer.

**Estimate:** 0.5 hours

**Acceptance checks:**
- Runs with Docker stopped and no API keys.
- A test asserts all four planted findings, plus decoy with no switch advice.
- Totals print near $12,600 refund and $20,000 a year, with a failure if they drift more than 10% from section 7.

**Likely files:**
- `packages/core/src/rules/index.ts`
- `scripts/audit-local.ts`
- `packages/core/test/planted-findings.test.ts`

**depends on:** rules-billing, rules-rates-lines

**parallel with:** db-schema, platform-interfaces, platform-db-adapters, platform-io-adapters, platform-agent-runtime, bill-pdfs, seed-loader, bill-parser, portal-shell, portal-downloads, agent-roster, tools-file-approve, run-trigger, voice-sim, call-provider-tool, voice-live, finance-ledger, finance-invoice, monitor-check, dashboard-shell, panels-work, panels-action, panels-money
