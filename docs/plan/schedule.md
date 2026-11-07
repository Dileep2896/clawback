# Schedule, keys and decisions

Companion to `docs/plan/phases/`. The plan is M0 to M9 on `PLATFORM=local` today (Friday Nov 6), then M10 on Saturday when the human asks.

## Timing

- **Builder hours:** 37.5 across 40 lanes, against the 29.5 in section 17. The extra hours come from splitting work and from gaps this plan fills.
- **Wall clock on 3 slots:** about 14 hours if nothing slips. This excludes review, merge and waiting on keys, so plan on more.
- **Longest chain:** `repo-skeleton` > `shared-contracts` > `tariff-data` > `seed-generator` > `bill-pdfs` > `seed-loader` > `portal-shell` > `portal-downloads` > `tools-collect-audit` > `agents-e2e` > `demo-reset` > `rehearsal`. More builders would not shorten this chain.
- **Not scheduled:** phase 12, held for Saturday.
- **Hold:** no builders start until the human approves these phases.

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
| 3.5 | 5.5 | 2 | `voice-sim` | M6 |
| 3.5 | 4.5 | 3 | `agent-roster` | M5 |
| 4.0 | 5.0 | 1 | `bill-pdfs` | M2 |
| 4.5 | 5.5 | 3 | `rules-billing` | rest of M3 |
| 5.0 | 5.5 | 1 | `seed-loader` | M2 |
| 5.5 | 7.0 | 1 | `bill-parser` | rest of M3 |
| 5.5 | 6.5 | 2 | `portal-shell` | M4 |
| 5.5 | 6.5 | 3 | `rules-rates-lines` | rest of M3 |
| 6.5 | 7.5 | 2 | `portal-downloads` | M4 |
| 6.5 | 7.0 | 3 | `platform-db-adapters` | M1 |
| 7.0 | 7.5 | 1 | `audit-local-cli` | rest of M3 |
| 7.0 | 7.5 | 3 | `voice-live-spike` | M6 |
| 7.5 | 9.0 | 1 | `tools-collect-audit` | M5 |
| 7.5 | 9.0 | 2 | `tools-file-approve` | M5 |
| 7.5 | 8.5 | 3 | `call-provider-tool` | M6 |
| 8.5 | 9.5 | 3 | `voice-live-line` | M6 |
| 9.0 | 10.0 | 1 | `run-trigger` | M5 |
| 9.0 | 10.0 | 2 | `dashboard-shell` | M8 |
| 9.5 | 11.0 | 3 | `voice-live-caller` | M6 |
| 10.0 | 11.0 | 1 | `agents-e2e` | M5 |
| 10.0 | 10.5 | 2 | `finance-ledger` | M7 |
| 10.5 | 11.5 | 2 | `panels-work` | M8 |
| 11.0 | 12.0 | 1 | `panels-action` | M8 |
| 11.0 | 12.0 | 3 | `panels-money` | M8 |
| 11.5 | 12.0 | 2 | `finance-invoice` | M7 |
| 12.0 | 12.5 | 1 | `monitor-check` | M7 |
| 12.0 | 12.5 | 2 | `demo-reset` | M9 |
| 12.0 | 12.5 | 3 | `demo-replay` | M9 |
| 12.5 | 13.0 | 1 | `run-resilience` | M9 |
| 13.0 | 14.0 | 1 | `rehearsal` | M9 |

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
| Claude Code login (no API key in local mode) | none | M1 | `platform-agent-runtime` | Yes, this blocks the agent and parser lanes |
| OpenEI key (free) | `OPENEI_API_KEY` | M3 work, moved ahead of M2 | `tariff-data` | Yes, this blocks seed data unless fallback tariffs are used |
| Stripe test account | `STRIPE_SECRET_KEY` (`sk_test_` only) | M7 | `finance-invoice` | Yes |
| Retell account with KYC done and a card on file ($10 free credit, number costs $2 a month and can take up to 2 minutes to provision) | `VOICE_PROVIDER=retell`, `RETELL_API_KEY` | M6 | `voice-live-spike` | Yes, live voice is a must-have |
| Vapi account ($5 free credit, one free inbound number) | `VAPI_API_KEY`, `ALLOWED_CALL_NUMBERS` (the Vapi number only) | M6 | `voice-live-spike` | Yes, live voice is a must-have |
| naïve account, identity and card | `NAIVE_API_KEY`, `NAIVE_COMPANY_ID`, `NAIVE_IDENTITY_ID`, `NAIVE_CARD_ID` | M10 | `naive-recon` | Saturday |
| Custom domain with DNS access | none | M10 | `naive-recon` | Saturday |
| Public URL or tunnel for portal and webhook | `ALLOWED_PORTAL_ORIGINS` | M10 | `naive-public-endpoints` | Saturday, likely |

`VAULT_KEY` is generated locally and needs no account. `PROVIDER_REP_FORWARD_NUMBER` is not used, because the human is solo and the rep is an AI agent. The Twilio vars are optional, because the demo does not use Twilio. Everything else in section 18 has a working default.

## Settled decisions

Gaps in `project.md` and what this plan does about them. `project.md` itself is unchanged, so these take precedence over it. Items 2 to 7, 9, 11 and 13 to 16 were settled by the orchestrator or the human. The others are planner calls, so say so if any are wrong.

1. **Tariff work comes before seed data.** Section 17 has M2 first, but bills are priced by the calculator and the Oakland load is tuned against it.
2. **Fremont #1 gets 16 months of bills and intervals.** That is 2 before the swap and 14 after, because the refund and the jump cannot be proven from 12. All other accounts stay at 12, and the Collector downloads every bill the portal offers.
3. **The decoy adds a 37th account.** Oakland #3 gets one gas account with 12 bills at a fictional third party gas supplier, using one added `provider` value. Totals are 37 accounts and 448 bills (432, plus 12 gas, plus 4 extra for Fremont #1). If gas is cut, that drops to 36 accounts and 436 bills.
4. **BayConnect is a third portal brand from config, not extra pages.** It goes with "second portal" in the cut order. The gas supplier is one more config entry, so every bill can still be downloaded (planner call).
5. **Gated tools have owners.** The Filer holds `submit_claim` and `change_rate_plan` and runs them after approval. The Negotiator holds `cancel_service` and records cancellations from the call outcome.
6. **Core stays pure.** It holds the parser schema, validation and audit rules, and takes LLM extraction as an injected function. The Claude call lives outside core, through a new `Llm` interface in `packages/platform`.
7. **`audit:local` runs from cached parsed JSON committed with the seed.** The real PG&E sample parse is a separate script that needs a key.
8. **BayTel gets a line inventory page.** The `unusedLines` rule needs call counts, and section 9 lists no source for them.
9. **Live voice is a must-have and is off the cut list.** Sim is the automatic fallback, labeled on screen. The human is solo, so the rep is always the second AI agent. To use free credits, a Retell outbound agent calls a free inbound Vapi number, replacing the section 11 Twilio IVR. `ALLOWED_CALL_NUMBERS` holds only the Vapi number.
10. **Seed and test scripts may import Playwright directly.** PDF generation and portal e2e are build and test tools, so `scripts/`, `packages/db/src/seed/` and `apps/portal/e2e/` are exempt from the section 5 import rule. Runtime browser use still goes through `Browser`.
11. **Saturday approval is an email and a YES text.** naïve outbound SMS is not available, so the Approver emails Linda and she replies YES by text to the naïve number. M10 tests the inbound SMS wake, because the naïve docs disagree on it, and uses the dashboard tap if it fails. Local mode keeps the simulated phone panel.
12. **The disclosure line is inserted by code, not spoken from a prompt.** This way a model cannot skip or reword it.
13. **Bills are parsed ahead of time.** The stage run reuses cached results, the audit log shows them as cached, and the run stays inside `RUN_BUDGET_USD`.
14. **The refund shows as "claimed" and we invoice now.** The invoice has a line saying the refund part is due only when it is granted.
15. **B-6 uses whatever the engine computes.** The two Oakland stores get a lunch-heavy load. If savings still do not exceed 2%, the finding is dropped from the pitch.
16. **The name is Clawback in the product and on stage** (the human, 2026-11-07). Package names stay `@bill-fighter/*`.
17. **The CEO's tools are built in `tools-file-approve`.** That lane already depends on the `Board` and `Mail` adapters, so `board_update` and `send_email` need no new lane. The summary email's numbers are filled in from findings and the ledger, like the letters.

## Top risks

- **`platform-agent-runtime`:** everything in M5 sits on subagents, in-process tools and `canUseTool` working together. It runs early so a problem surfaces early.
- **Demo time and cost:** even with cached parsing, nine agents may not fit a 2 to 4 minute slot or `RUN_BUDGET_USD=5`. `agents-e2e` and `rehearsal` measure this.
- **B-6 savings:** B-6 may not come out 3 to 5% cheaper even with a lunch-heavy load. If so, the finding drops out of the pitch.
- **Live voice:** three points are unverified: Retell dialing the Vapi free number, the Vapi assistant reacting to tones, and Retell transcript and recording retrieval. `voice-live-spike` tests them with one call, and a failure goes to the orchestrator with no provider switch.
- **Call credits:** $10 on Retell and $5 on Vapi are small, and each live call spends on both. Rehearsals use sim, and live calls are limited to the spike, about 5 full tests and the stage run.
- **naïve on Saturday:** see the notes in phase 12, especially single-tap approval and outbound SMS.
