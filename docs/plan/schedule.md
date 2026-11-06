# Schedule, keys and decisions

Companion to `docs/plan/phases/`. The plan is M0 to M9 on `PLATFORM=local` today (Friday Nov 6), then M10 on Saturday when the human asks.

## Timing

- **Builder hours:** 34.5 across 37 lanes, against the 29.5 in section 17. The extra hours come from splitting work and from gaps this plan fills.
- **Wall clock on 3 slots:** about 13 hours if nothing slips. This excludes review, merge and waiting on keys, so plan on more.
- **Longest chain:** `repo-skeleton` > `shared-contracts` > `tariff-data` > `seed-generator` > `bill-pdfs` > `seed-loader` > `portal-shell` > `portal-downloads` > `tools-collect-audit` > `agents-e2e` > `demo-reset` > `rehearsal`. More builders would not shorten this chain.
- **Not scheduled:** `voice-live` (optional) and all of phase 12 (held for Saturday).

## Who runs when

Hours are from the moment `repo-skeleton` starts. A lane starts once its dependencies have merged. A checker confirmed no two lanes that overlap in time depend on each other or share a listed file.

| Start | End | Slot | Lane | Milestone |
|---|---|---|---|---|
| 0.0 | 0.5 | 1 | `repo-skeleton` | M0 |
| 0.5 | 1.0 | 1 | `shared-contracts` | M0 |
| 0.5 | 1.0 | 2 | `db-schema` | M0 |
| 1.0 | 2.5 | 1 | `tariff-data` | first part of M3 |
| 1.0 | 2.5 | 2 | `tariff-calculator` | first part of M3 |
| 1.0 | 1.5 | 3 | `load-profile` | M2 |
| 1.5 | 2.0 | 3 | `platform-interfaces` | M1 |
| 2.0 | 3.5 | 3 | `platform-agent-runtime` | M1 |
| 2.5 | 4.0 | 1 | `seed-generator` | M2 |
| 2.5 | 3.5 | 2 | `platform-io-adapters` | M1 |
| 3.5 | 4.5 | 2 | `agent-roster` | M5 |
| 3.5 | 4.0 | 3 | `platform-db-adapters` | M1 |
| 4.0 | 5.0 | 1 | `bill-pdfs` | M2 |
| 4.0 | 5.0 | 3 | `rules-billing` | rest of M3 |
| 4.5 | 5.5 | 2 | `rules-rates-lines` | rest of M3 |
| 5.0 | 5.5 | 1 | `seed-loader` | M2 |
| 5.0 | 6.5 | 3 | `bill-parser` | rest of M3 |
| 5.5 | 6.5 | 1 | `portal-shell` | M4 |
| 5.5 | 6.0 | 2 | `audit-local-cli` | rest of M3 |
| 6.0 | 8.0 | 2 | `voice-sim` | M6 |
| 6.5 | 7.5 | 1 | `portal-downloads` | M4 |
| 6.5 | 8.0 | 3 | `tools-file-approve` | M5 |
| 7.5 | 9.0 | 1 | `tools-collect-audit` | M5 |
| 8.0 | 9.0 | 2 | `run-trigger` | M5 |
| 8.0 | 9.0 | 3 | `dashboard-shell` | M8 |
| 9.0 | 10.0 | 1 | `agents-e2e` | M5 |
| 9.0 | 10.0 | 2 | `call-provider-tool` | M6 |
| 9.0 | 9.5 | 3 | `finance-ledger` | M7 |
| 9.5 | 10.5 | 3 | `panels-work` | M8 |
| 10.0 | 11.0 | 1 | `panels-action` | M8 |
| 10.0 | 11.0 | 2 | `panels-money` | M8 |
| 10.5 | 11.0 | 3 | `finance-invoice` | M7 |
| 11.0 | 11.5 | 1 | `monitor-check` | M7 |
| 11.0 | 11.5 | 2 | `demo-reset` | M9 |
| 11.0 | 11.5 | 3 | `demo-replay` | M9 |
| 11.5 | 12.0 | 1 | `run-resilience` | M9 |
| 12.0 | 13.0 | 1 | `rehearsal` | M9 |

## How lanes avoid editing the same files

- `repo-skeleton` owns root `package.json`, the lockfile, `.env.example` and `.gitignore`, and declares all known scripts and dependencies up front.
- If a lane must add a dependency, resolve any lockfile conflict by re-running `pnpm install`, never by hand.
- There are no barrel files, so no lane edits a shared `index.ts`.
- Platform checks and agent tools are discovered from their folders, so adding one edits no shared list.
- `dashboard-shell` creates a stub file per panel, and each panel lane owns only its own files.

## Keys and accounts the human must supply

| Item | Env var | First needed | Lane | Required? |
|---|---|---|---|---|
| Docker, Node 20+, pnpm | none | M0 | `repo-skeleton` | Yes |
| Anthropic API key with credit | `ANTHROPIC_API_KEY` | M1 | `platform-agent-runtime` | Yes, this blocks the agent and parser lanes |
| OpenEI key (free) | `OPENEI_API_KEY` | M3 work, moved ahead of M2 | `tariff-data` | Yes, this blocks seed data unless fallback tariffs are used |
| Stripe test account | `STRIPE_SECRET_KEY` (`sk_test_` only) | M7 | `finance-invoice` | Yes |
| Twilio account and two numbers | `TWILIO_ACCOUNT_SID`, `TWILIO_AUTH_TOKEN`, `TWILIO_PROVIDER_NUMBER`, `TWILIO_CALLER_NUMBER` | M6 | `voice-live` | Only for live voice |
| Retell or Vapi key | `RETELL_API_KEY` or `VAPI_API_KEY` | M6 | `voice-live` | Only for live voice |
| Teammate phone number | `PROVIDER_REP_FORWARD_NUMBER`, `ALLOWED_CALL_NUMBERS` | M6 | `voice-live` | Only for live voice |
| naïve account, identity and card | `NAIVE_API_KEY`, `NAIVE_COMPANY_ID`, `NAIVE_IDENTITY_ID`, `NAIVE_CARD_ID` | M10 | `naive-recon` | Saturday |
| Custom domain with DNS access | none | M10 | `naive-recon` | Saturday |
| Public URL or tunnel for portal and webhook | `ALLOWED_PORTAL_ORIGINS` | M10 | `naive-public-endpoints` | Saturday, likely |

`VAULT_KEY` is generated locally and needs no account. Everything else in section 18 has a working default.

## Technical decisions to check

Gaps in `project.md` that this plan settled. `project.md` itself is unchanged. Say so if any of these are wrong.

1. **Tariff work comes before seed data.** Section 17 has M2 first, but bills are priced by the calculator and the Oakland load is tuned against it.
2. **Fremont #1 gets 16 months of bills.** Section 7 says 12 months for every account, but a 14 month refund and a visible meter swap cannot be proven from 12.
3. **The decoy adds a 37th account.** Section 7 counts 36 accounts but also needs Oakland #3 gas. Delivery is modeled at `pacific_power` with a third party supply line on the bill, so the schema enum does not change. Bills total 448 (432, plus 12 gas, plus 4 extra for Fremont #1). Cutting gas accounts removes this and the decoy.
4. **BayConnect is a third portal brand.** Section 9 names two portals, but the promo finding needs BayConnect bills. It reuses the same app and routes through a brand config.
5. **BayTel gets a line inventory page.** The `unusedLines` rule needs call counts, and section 9 lists no source for them.
6. **Gated tools with no owner get one.** Section 10 lists `submit_claim`, `change_rate_plan` and `cancel_service` but gives them to no agent. They go to the Filer and only change status on our own tables.
7. **The parser gets its LLM injected.** Section 4 says core makes no network calls, while section 8 has the parser calling Claude. A new `Llm` interface in `packages/platform` resolves this.
8. **`audit:local` reads generated fixtures.** It must run with every service down, so it cannot need Postgres or Claude.
9. **Seed and test scripts may import Playwright directly.** PDF generation and portal e2e are build and test tools, so they are exempt from the section 5 import rule. Runtime browser use still goes through `Browser`.
10. **The disclosure line is inserted by code, not spoken from a prompt.** This way a model cannot skip or reword it.

## Top risks

- **`platform-agent-runtime`:** everything in M5 sits on subagents, in-process tools and `canUseTool` working together. It runs early so a problem surfaces early.
- **Demo time and cost:** 448 bills and nine agents may not fit a 2 to 4 minute slot or `RUN_BUDGET_USD=5`. `bill-parser` and `agents-e2e` measure this, and the on-stage answer is a product question.
- **B-6 savings:** B-6 may not come out 3 to 5% cheaper with a dinner-heavy restaurant load. `seed-generator` reports this rather than forcing a number.
- **naïve on Saturday:** see the notes in phase 12, especially single-tap approval and outbound SMS.
