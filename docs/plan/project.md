# Bill Fighter: build instructions for the coding agent

You are building **Bill Fighter**, a demo of an autonomous company made of AI agents. The company audits and cuts utility and telecom bills for businesses with many locations, and gets paid a share of the savings. It will be shown live at the naïve x YC Autonomous Company Hackathon (YC, San Francisco, Nov 7 to 8, 2026). The demo is 2 to 4 minutes, and the judges score one thing above all: **how much of the company runs without the team.**

Read this whole file before writing code. Build in the order of the milestones in section 17. Every milestone must work end to end before you start the next one.

---

## 0. Two modes: build locally now, switch to naïve on Saturday

The app must run in two modes, chosen by one environment variable:

- `PLATFORM=local` (build this first, now). Everything runs on a laptop with **Claude in headless mode** (the Claude Agent SDK, which is the programmatic form of `claude -p`) and **free services only**: local Postgres in Docker, Playwright, Mailpit for email, Stripe test mode, and a simulated phone call. No naïve account is needed.
- `PLATFORM=naive` (switch on Saturday at the hackathon). The same agents, tools, prompts and data run on the naïve platform: naïve identities and inbox, browser and vault, policies for approvals, SMS, virtual card, budgets, board and audit log.

**The rule that makes switching easy:** business logic never imports a platform SDK directly. Every platform feature goes through an interface in `packages/platform` (section 5). Local implementations live in `packages/platform/local`, naïve ones in `packages/platform/naive`. Agents, tools, dashboard and scripts only call the interfaces. Switching is then: write the naïve adapter files, set `PLATFORM=naive`, run the same demo.

When the user later says "switch to naïve", follow section 16 exactly.

---

## 1. What the finished demo must do

One non-human event starts everything, and exactly one human action happens on stage.

1. A new bill email arrives at the company inbox (`bills@...`). Nobody types a prompt.
2. A CEO agent opens a savings plan for that customer and hands out work on a shared board.
3. A Collector agent logs into a **replica** provider portal (which we build) and downloads 12 months of bills for all 12 locations of the demo customer.
4. An Auditor agent parses every bill, re-prices usage under every eligible PG&E business rate, and runs error rules. It finds the four planted problems (section 7).
5. A Filer agent writes the refund claim and the cancellation requests, with evidence attached.
6. The system sends the owner **one approval request** (on the dashboard, and by SMS in naïve mode). A human approves. This is the only human action.
7. A Negotiator agent places a phone call to our own mock provider line. It says up front that it is an AI and that the call is recorded, navigates a phone menu, and asks the provider rep (a teammate) to cancel the unused lines and restore promo pricing.
8. A Finance agent records the savings in a ledger and creates a Stripe **test mode** invoice for our 30% share.
9. A Monitor agent schedules next month's bill check.
10. The dashboard shows the board, findings, the call transcript, the ledger, the run cost and a full audit log of every agent action, ending on "Human actions: 1".

---

## 2. Hard rules (never break these)

- **Never contact a real company.** No calls, emails or logins to PG&E, AT&T, Comcast or any real provider. All providers are replicas we run. Enforce an allowlist in code for phone numbers, email domains and portal URLs.
- **Never log into a real utility account.**
- **Every outbound call starts with this disclosure**, word for word: "Hi, this is an AI assistant calling on behalf of Golden Gate Noodle Company. This call is being recorded." California requires AI disclosure and all-party consent to recording.
- **Never invent numbers.** Every finding must point to the exact bill lines and data that prove it. Money math happens in code (`packages/core`), never in the LLM.
- **Nothing changes without approval.** Calls, plan changes, cancellations, claims and charges go through the approval gate.
- **Stripe runs in test mode only.** No live keys anywhere.
- **Do not guess platform APIs.** For the Claude Agent SDK, naïve, Twilio, Retell or Vapi, Stripe, Mailpit and OpenEI, read the current docs (section 15) before writing integration code. The naïve names in this file come from their docs as of Nov 2026; verify each one.
- Keep all secrets in environment variables. Commit `.env.example`, never `.env`.

---

## 3. Tech stack

- **Language:** TypeScript everywhere (the naïve SDK is TypeScript only). Node 20+. pnpm workspaces.
- **Agent runtime (local):** `@anthropic-ai/claude-agent-sdk`. Use `query()` with the CEO as the main agent, the other agents as programmatic subagents (`agents` option), custom tools defined with `tool()` and hosted in-process with `createSdkMcpServer()`, and approvals through the `canUseTool` callback. This is the same engine as `claude -p`; you may also add a `claude -p` CLI wrapper script for quick manual runs.
- **Agent runtime (naïve):** naïve SDK: a coordinator plus a roster of member agents, shared board, policies (`allow`, `ask`, `deny`), budgets and audit log.
- **Database:** Postgres through Drizzle ORM. Local: Docker Postgres. naïve mode: naïve managed Postgres if it is easy, otherwise keep the local or a free hosted Postgres. Only `DATABASE_URL` changes.
- **LLM:** Claude through the Agent SDK in both modes unless the naïve docs require their model router for agents. Keep the model name in config. All parsing uses structured output with a JSON schema.
- **Dashboard and replica portals:** Next.js (App Router) and Tailwind.
- **Browser automation:** Playwright locally; naïve browser in naïve mode.
- **Email:** Mailpit locally (free local SMTP server with a web inbox and an HTTP API); naïve identity mail in naïve mode.
- **Voice:** `VOICE_MODE=sim` (free, default) or `VOICE_MODE=live` (Twilio trial credit plus Retell or Vapi free credits). Voice is never on naïve, because naïve phone numbers are SMS only.
- **Payments:** Stripe test mode (free) in both modes. naïve virtual card is added in naïve mode for one small real spend.
- **PDFs:** generate synthetic bills with Playwright HTML to PDF; extract text with `pdfjs-dist` or `pdf-parse`.
- **Scheduling:** `node-cron` locally; naïve jobs or schedules in naïve mode.

Claude usage is the only paid piece in local mode. Use `ANTHROPIC_API_KEY` (bare or SDK mode reads this) and keep a per-run cost cap.

---

## 4. Repository layout

```
bill-fighter/
  apps/
    dashboard/          Next.js: board, findings, approvals, call view, phone (SMS) view, ledger, audit log
    portal/             Next.js: replica "BayCurrent Electric" and "BayTel" customer portals
  services/
    voice/              mock provider IVR, live call bridge, simulated call engine
    webhooks/           inbound email webhook that starts a run
  packages/
    core/               tariff engine, bill parser, audit rules, money math (pure, no network)
    platform/           interfaces + local/ and naive/ adapters + factory
    agents/             agent definitions, prompts, tool implementations (platform-agnostic)
    db/                 Drizzle schema, migrations, seed
    shared/             types, zod schemas, constants, allowlists
  data/
    tariffs/  loadprofiles/  bills/  samples/
  scripts/
    seed.ts  demo-start.ts  demo-reset.ts  replay.ts  run-local.ts  check-platform.ts
  docker-compose.yml    postgres + mailpit
  project.md
  .env.example
```

`packages/core` must have unit tests and run from a plain script (`pnpm audit:local`) even if every agent and service is down.

---

## 5. Platform interfaces (`packages/platform`)

Define these interfaces in `packages/platform/src/types.ts`. A factory `getPlatform()` returns the local or naïve implementation based on `PLATFORM`. Nothing outside `packages/platform` may import `@anthropic-ai/claude-agent-sdk`, naïve, Playwright, Mailpit or node-cron directly (Stripe and the voice service are the exceptions, since they are the same in both modes).

| Interface | Purpose | Local implementation (free) | naïve implementation (Saturday) |
|---|---|---|---|
| `AgentRuntime` | Run the CEO with its member agents and tools, stream events | Claude Agent SDK `query()` with `agents` subagents and an in-process MCP tool server | naïve coordinator plus roster, board on |
| `ApprovalGate` | Pause a gated tool until a human approves; record who approved | `canUseTool` callback creates a row in `approvals`, waits until the dashboard sets it approved (poll the DB), then allows | Tool policy set to `ask`; session pauses until `naive session confirm` (or Studio); approver read from audit log |
| `Mail` | Send email, receive inbound bill emails | Mailpit SMTP to send; inbound via webhook POST from `demo-start` (or Mailpit webhook/API poll, check its docs) | naïve identity inbox with inbound webhook |
| `Sms` | Text the owner the approval summary and receive "YES" | Simulated phone panel on the dashboard plus console log | naïve identity phone number (SMS) |
| `Browser` | Log into portals, download files | Playwright | naïve browser |
| `Vault` | Store portal credentials, return by name | Local JSON file encrypted with a key from `.env` | naïve vault (credential referenced by name, never value) |
| `Card` | Pay small fees with a hard cap | Mock card: writes to ledger, enforces cap | naïve virtual card with hard spend cap |
| `Board` | Task cards per agent | `board_cards` table | naïve shared board (mirror to `board_cards` for the dashboard) |
| `Audit` | Record every tool call with cost | `audit_log` table | naïve audit log, mirrored to `audit_log` |
| `Budget` | Cap run spend, report cost | Sum `total_cost_usd` from SDK result messages; stop when over `RUN_BUDGET_USD` | naïve budgets (`--budget`, per task cap) |
| `Scheduler` | Next month check | node-cron | naïve scheduled job |
| `Identity` | Company name, email, phone | Values from `.env` | naïve identity (custom domain inbox plus SMS number) |

Also write `scripts/check-platform.ts`: it calls each interface once (send a test email, write a board card, fake approval, mock card charge, etc.) and prints pass or fail. It must pass in local mode now and in naïve mode on Saturday.

---

## 6. Data model (Postgres)

Money is integer cents.

- `customers` (id, name, contact_name, contact_email, contact_phone, savings_share_pct default 30)
- `locations` (id, customer_id, name, address, city)
- `accounts` (id, location_id, provider [baycurrent | baytel | bayconnect], account_number, service_type [electric | gas | telecom | internet], rate_schedule, meter_number)
- `authorizations` (id, customer_id, provider, form_type, scope, signed_by, signed_at, expires_at, pdf_path), modeled on PG&E Form 79-1095
- `bills` (id, account_id, period_start, period_end, total_cents, pdf_path, parsed_json, parse_confidence)
- `bill_lines` (id, bill_id, description, quantity, unit, rate, amount_cents, line_type)
- `usage_intervals` (account_id, ts, kwh)
- `phone_lines` (id, account_id, number, label, monthly_cents, calls_last_12mo, purpose [unknown | fax | alarm | voice])
- `findings` (id, customer_id, account_id, type, title, explanation, evidence_json, refund_cents, annual_savings_cents, confidence, status [proposed | approved | filed | won | rejected])
- `actions` (id, finding_id, kind [call | letter | claim | plan_change | cancel | invoice], payload_json, status, requires_approval)
- `approvals` (id, run_id, action_ids, summary, status [pending | approved | denied], channel [dashboard | sms | naive], approved_by, approved_at)
- `calls` (id, action_id, mode [sim | live], to_number, started_at, ended_at, recording_url, transcript_json, outcome_json)
- `ledger` (id, customer_id, finding_id, kind [refund | savings | fee | invoice | card_spend], amount_cents, external_id, created_at)
- `runs` (id, customer_id, platform, trigger [email | schedule | manual], started_at, finished_at, status, cost_usd)
- `board_cards` (id, run_id, agent, title, status [todo | doing | done | blocked], updated_at)
- `audit_log` (id, run_id, agent, tool, input_json, output_json, cost_usd, created_at)
- `sms_messages` (id, direction, to, from, body, created_at) for the simulated phone panel

---

## 7. Demo customer and planted findings

Seed exactly this customer. All names are fictional. Label the dashboard "Demo data".

**Golden Gate Noodle Co.** Owner: Linda Park. 12 restaurants: 4 in San Francisco, 3 in Oakland, 3 in San Jose, 2 in Fremont. Each location has one electric account at "BayCurrent Electric" (our PG&E stand in, using real PG&E rate structures), one telecom account at "BayTel" (AT&T stand in) and one internet account at "BayConnect" (Comcast stand in). Annual spend across all bills is about $300,000.

Generate 12 months of bills for every account, ending last month. Base electricity usage comes from a ComStock or Green Button restaurant load profile, scaled per store with small random noise (fixed seed). Then plant:

1. **Meter multiplier error (Fremont #1).** 14 months ago the meter was replaced. Since then billed kWh is exactly 2.0 times the real interval data: about $1,800 a month instead of about $900. The bill shows the new meter number and a multiplier that changed from 1 to 2. Expected refund about $12,600 (within PG&E Electric Rule 17.1's 3 year window); expected yearly savings about $10,800.
2. **Wrong rate schedule (Oakland #1 and #2).** Both on B-10 with 12 month max demand about 40 kW, so they qualify for B-6 (under 75 kW). The tariff engine computes the savings; tune the load so B-6 comes out roughly 3 to 5% cheaper. Fix: rate change request under Rule 12 (one change per 12 months).
3. **Unused copper phone lines.** Nine BayTel POTS lines across six stores. Seven have zero calls in 12 months (fax or spare). Two are alarm lines with low use. $60 a month each. Expected savings 7 x $60 x 12 = $5,040 a year. Alarm lines are flagged "confirm with alarm company", never cancelled.
4. **Expired internet promos (three stores).** Same BayConnect plan code, monthly charge jumps from $95 to $185. Expected savings 3 x $90 x 12 = $3,240 a year.

**Decoy:** Oakland #3 buys gas from a third party supplier. Flag "review contract, check exit fees". Never recommend switching.

Check totals (the engine computes them): about $12,600 in refunds and about $20,000 a year in savings; Bill Fighter's 30% of first year value is about $9,900.

Put one real public PG&E sample business bill in `data/samples/` only for parser testing.

---

## 8. Core engine (`packages/core`)

**Tariffs.** Fetch PG&E commercial rates from the OpenEI Utility Rate Database API (`https://api.openei.org/utility_rates`, free key, `format=json`, `detail=full`, `sector=Commercial`, `limit` up to 500 with `offset`, `getpage` for one rate). Cache B-1, B-6, B-10, B-19 JSON in `data/tariffs/`. Log each record's start and update dates and warn if older than 12 months. Normalize into a `Tariff` type (TOU periods from 12 x 24 weekday and weekend schedules, energy rates by period and tier, flat and TOU demand charges, fixed charges). Keep a hand-checked fallback JSON per schedule from the current PG&E tariff PDFs. Record which source was used.

**Bill calculator.** `priceUsage(intervals, tariff, period)` returns energy, demand, fixed and total cents with a breakdown. Map each 15 minute interval to its TOU period, sum kWh per period, compute max kW per demand window, add fixed charges. Unit test against a hand-computed bill to the cent.

**Eligibility.** B-1 and B-6 under 75 kW; B-10 under 500 kW; B-19 voluntary under 500 kW and mandatory above 499 kW; B-20 mandatory above 999 kW. Recheck against current tariff sheets. Only compare schedules an account qualifies for.

**Parser.** Extract PDF text, ask Claude to fill a strict JSON schema (account, address, meter number, multiplier, rate schedule, period, kWh per TOU period, max kW, line items, total). Validate: lines sum to total; kWh times rate matches each energy line within 1%. On failure retry once with page images, then mark "needs review".

**Audit rules** (each returns `Finding[]` with evidence and money):
- `meterMultiplierJump`: billed versus interval kWh ratio jumps to a near integer above 1 after a meter number change. Refund = overbilled amounts within 36 months.
- `rateOptimization`: re-price last 12 months under every eligible schedule; propose a Rule 12 change if savings exceed 2%.
- `unusedLines`: zero calls in 12 months and not an alarm line. Alarm lines get a "confirm first" finding with no savings.
- `promoExpiry`: same plan code, monthly charge up more than 30% with no usage change.
- `arithmeticCheck`: bills whose lines don't add up.
- `thirdPartySupplier`: contract review flag only.

Unit tests must assert all four planted findings are found and the decoy gives no switch advice.

---

## 9. Replica provider portals (`apps/portal`)

Two clearly fictional portals: "BayCurrent Business" and "BayTel Business", with a banner "Demo portal, not a real utility". Login (credentials from the vault), account list with a location picker and pagination, bills page with PDF downloads, usage CSV download (15 minute data), and one "Your session will expire" modal for realistic friction. No CAPTCHA. Do not copy any real company's design, logo or text.

---

## 10. The agents (`packages/agents`)

Agents and tools are written once and run on either platform. Each agent has a short system prompt (stored in `packages/agents/prompts/*.md`), a narrow tool list and a turn limit. Tools are plain async functions with zod input schemas; the platform adapter wraps them (in local mode with `tool()` plus `createSdkMcpServer()`, in naïve mode with the naïve tool format).

| Agent | Job | Tools | Gate |
|---|---|---|---|
| CEO (main agent) | Opens a savings plan, creates board cards, delegates to members, emails the owner a summary at the end | `board_update`, `send_email`, delegation to subagents | none |
| Intake | Reads the inbound bill email, identifies the customer, starts the plan | `parse_inbound_email`, `get_customer` | none |
| Collector | Logs into replica portals with vault credentials, downloads bills and usage | `portal_login`, `download_bills`, `download_usage`, `store_bill`, `store_usage` | none |
| Auditor | Parses bills and runs every audit rule | `parse_bill`, `run_audit`, `price_usage` | none |
| Filer | Writes the Rule 17.1 claim, Rule 12 rate change request and cancellation letters with evidence | `draft_letter`, `attach_evidence` | none |
| Approver | Bundles all proposed actions into one request and sends it to the owner (dashboard and SMS) | `request_approval`, `send_sms` | none (it only asks) |
| Negotiator | Calls the provider line and records the outcome | `call_provider` | **gated** |
| Finance | Ledger entries, Stripe test invoice for 30%, one small card spend in naïve mode | `record_savings`, `create_invoice`, `card_pay` | **gated** for `create_invoice` and `card_pay` |
| Monitor | Schedules next month's check | `schedule_check` | none |

**Gated tools:** `call_provider`, `submit_claim`, `change_rate_plan`, `cancel_service`, `create_invoice`, `card_pay`. One approval must release the whole bundle: the Approver creates one `approvals` row listing all action ids; every gated tool checks that its action id is in an approved bundle. In local mode the `canUseTool` callback does this check (do not put gated tools in `allowedTools`, because `canUseTool` only runs when the call falls through to a permission prompt). In naïve mode the same tools are set to `ask` and the confirm releases them.

**Denied:** any tool call whose target is not on the allowlist (real provider numbers, domains or URLs) is rejected in code before the platform sees it.

Every tool call writes to `audit_log` through the `Audit` interface. Every agent step updates `board_cards` through the `Board` interface.

---

## 11. Voice (`services/voice`)

Voice is the same in both platform modes. Two voice modes:

- **`VOICE_MODE=sim` (default, free).** The dashboard shows a phone call screen. The Negotiator speaks its lines (browser speech synthesis is fine), the "provider" side is either a teammate typing or speaking into the dashboard, or a second Claude call playing the rep with a fixed script. The IVR menu is simulated ("For billing, press 2" and the agent "presses" 2). Transcript, disclosure and outcome are stored exactly as in live mode.
- **`VOICE_MODE=live`.** A Twilio number we own answers with an IVR ("Thanks for calling BayTel Business. For billing, press 2.") and forwards to a teammate's phone or to a second AI agent playing the rep. The AI caller is a Retell or Vapi outbound agent (read both docs, pick the simpler outbound API, use free trial credits). Dial only allowlisted numbers.

In both modes the caller must: say the disclosure first, navigate the menu, give the account number, ask to cancel the seven unused lines and restore promo pricing on three internet accounts, confirm each item back, ask for a ticket number, repeat it, and end politely. After the call, Claude extracts `{ cancelled_lines, credits, ticket }` into `calls.outcome_json`. Expose everything as one tool, `call_provider`. If a live call fails, fall back to sim mode automatically and label it on screen.

---

## 12. Trigger, scheduling and demo controls

- **Trigger:** `scripts/demo-start.ts` sends a bill email from a "BayCurrent Electric" sender to `bills@...` through the `Mail` interface. Locally it also POSTs the same payload to `services/webhooks/inbound` (or Mailpit notifies it), which starts a run with `trigger=email`. In naïve mode the naïve inbound mail webhook calls the same endpoint (naïve inbound mail does not auto-wake agents yet).
- `scripts/demo-reset.ts`: clears runs, findings, actions, approvals, calls, ledger, board, audit and sms rows; keeps seed data.
- `scripts/replay.ts`: replays a recorded run event by event at real speed if live services fail.
- `scripts/run-local.ts`: runs the whole flow in the terminal with auto approval, for fast testing (never used on stage).
- Monitor uses the `Scheduler` interface.

---

## 13. Dashboard (`apps/dashboard`)

One screen built for a projector, large text, dark theme option. Panels: header (customer, platform badge "local" or "naïve", run status, run cost, big "Human actions: N" counter), board, findings with evidence drawers (bill snippet, billed versus real kWh chart, rate comparison table), approval panel with one Approve button, phone panel showing the SMS thread to Linda, call panel with live transcript and the disclosure line highlighted, ledger (refunds, yearly savings, our fee, customer keeps), and a scrolling audit log. All panels read from Postgres, so they work in both modes. Use server sent events or short polling for live updates.

---

## 14. Using naïve fully (what judges will look for on Saturday)

In naïve mode, make each primitive visible on screen and in the pitch:

- **Identity:** a company identity with a custom domain inbox (`bills@`) and an SMS number.
- **Inbox:** the bill email arrives there and its webhook starts the run.
- **SMS:** the Approver texts Linda the one approval summary; her "YES" reply (or the naïve confirm) releases the bundle.
- **Browser and vault:** the Collector logs into the replica portals with credentials referenced from the vault.
- **Policies:** gated tools set to `ask`; everything else `allow`; approver shown from the audit log.
- **Virtual card:** one small real purchase under a hard cap (for example $1 to $5 for something the company actually needs, such as an API credit), shown in the ledger as `card_spend`.
- **Budgets:** run budget set and the cost shown live.
- **Board and audit log:** mirrored on our dashboard; also keep naïve Studio open in a second tab as a backup view.
- **Postgres:** use naïve managed Postgres if setup takes under 30 minutes.

---

## 15. Reference links (read before building)

- Claude Agent SDK (TypeScript): https://code.claude.com/docs/en/agent-sdk/typescript and overview https://code.claude.com/docs/en/agent-sdk/overview.md
- Claude headless (`claude -p`): https://code.claude.com/docs/en/headless
- naïve: https://usenaive.ai/docs , https://usenaive.ai/primitives , teams https://usenaive.ai/docs/capabilities/team.md , policies https://usenaive.ai/docs/concepts/policies.md , identity https://usenaive.ai/docs/capabilities/identity.md , pricing https://usenaive.ai/pricing , hackathon https://usenaive.ai/hackathon
- Mailpit (local email): https://mailpit.axllent.org
- OpenEI URDB: https://openei.org/services/doc/rest/util_rates?version=3 and https://developer.nrel.gov/docs/electricity/openei-utility-rates/
- Bill calculator reference: https://github.com/LBNL-ETA/elecprice and NREL PySAM's utility rate example
- Load profiles: https://nrel.github.io/ComStock.github.io/docs/data.html and https://archive.greenbuttondata.org/samples
- PG&E: Rule 17.1 https://www.pge.com/tariffs/assets/pdf/tariffbook/ELEC_RULES_17.1.pdf , B-6 https://www.pge.com/tariffs/assets/pdf/tariffbook/ELEC_SCHEDS_B-6.pdf , B-19 https://www.pge.com/tariffs/assets/pdf/tariffbook/ELEC_SCHEDS_B-19.pdf , rate options insert https://www.pge.com/assets/pge/docs/account/billing-and-assistance/bill-inserts/0325-biz-rate-options.pdf , Form 79-1095 https://www.pge.com/tariffs/assets/pdf/tariffbook/GAS_FORMS_79-1095.pdf , sample business bill https://www.pge.com/assets/pge/docs/clean-energy/solar/commercial-business-monthly-statement-sbp.pdf
- Twilio voice: https://twilio.com/en-us/voice/pricing/us ; Retell and Vapi outbound call docs; Stripe test mode invoice docs

---

## 16. Switching to naïve (do this only when the user asks)

1. Read the naïve docs pages in section 15 again; note exact SDK package name, auth, and the names for teams, policies, mail webhooks, SMS, browser, vault, card, budgets, board and audit log.
2. Create the naïve company and identity (custom domain inbox and SMS number), store portal credentials in the naïve vault, and create the virtual card with a hard cap. Put the new values in `.env` (section 18).
3. Implement each interface in `packages/platform/naive/`, one file per interface, matching section 5. Keep the same function signatures. For `AgentRuntime`, map: CEO to the naïve coordinator, each member agent to a roster member, each tool to a naïve tool with the same name and schema, gated tools to policy `ask`, all others to `allow`.
4. Mirror naïve board updates and audit log entries into our `board_cards` and `audit_log` tables so the dashboard keeps working unchanged.
5. Point the naïve inbound mail webhook at `services/webhooks/inbound`.
6. Set `PLATFORM=naive`, run `scripts/check-platform.ts` until every check passes.
7. Run `demo-reset` then `demo-start` three times in a row. Fix anything that differs from local mode.
8. Keep `PLATFORM=local` working as the fallback; if naïve breaks on stage, flip the variable and use local mode or `replay`.

Do not change `packages/core`, `packages/agents` prompts, the dashboard or the seed data during the switch unless a test proves it is needed.

---

## 17. Milestones (build in this order)

Each has a check. Don't move on until it passes. Times are rough.

- **M0. Skeleton (1 h).** Monorepo, `docker-compose.yml` with Postgres and Mailpit, Drizzle schema, `.env.example`, tests. Check: `pnpm test`, `pnpm db:migrate`, Mailpit web inbox opens.
- **M1. Platform layer, local (2 h).** All interfaces with local implementations and the factory; `check-platform.ts`. Check: every local check passes.
- **M2. Data and seed (3 h).** Tariffs cached, load profile, demo customer, 36 accounts, about 432 synthetic PDF bills, phone lines, planted problems. Check: PDFs look like real bills.
- **M3. Core engine (5 h).** Tariffs, calculator, eligibility, parser, rules, tests. Check: `pnpm audit:local` prints the four findings near section 7 amounts, no supplier switch advice, real sample bill parses.
- **M4. Replica portals (2 h).** Check: a Playwright script logs in and downloads every bill.
- **M5. Agents on the Claude Agent SDK (6 h).** CEO plus subagents, tools, approval gate via `canUseTool`, budget, audit and board writes, email trigger. Check: `demo-start` runs everything with no human input and stops at one pending approval.
- **M6. Voice (3 h).** Sim mode fully; live mode if Twilio and Retell or Vapi trial credits work. Check: after approval the call runs, transcript shows the disclosure first, outcome saved.
- **M7. Finance and monitor (1.5 h).** Ledger, Stripe test invoice, mock card spend, schedule. Check: ledger shows refunds, savings, fee, customer keeps.
- **M8. Dashboard (4 h).** All panels live. Check: a full run is clear on a 1080p projector.
- **M9. Hardening (2 h).** Reset, replay, retries, recorded backup video. Check: three runs in a row from reset; replay works offline.
- **M10. Switch to naïve (Saturday, when asked).** Follow section 16. Check: `check-platform.ts` passes with `PLATFORM=naive` and three full runs succeed.

If time runs short, cut in this order: gas accounts, Monitor, portal friction, second portal, live voice (keep sim). Never cut the disclosure, the approval gate, the allowlist or the audit log.

---

## 18. Environment variables (`.env.example`)

```
# mode
PLATFORM=local                 # local | naive
VOICE_MODE=sim                 # sim | live
RUN_BUDGET_USD=5

# claude (agent runtime, local mode and LLM calls)
ANTHROPIC_API_KEY=
CLAUDE_MODEL=sonnet

# local services (docker-compose)
DATABASE_URL=postgres://bill:bill@localhost:5432/billfighter
SMTP_HOST=localhost
SMTP_PORT=1025
MAILPIT_API=http://localhost:8025
VAULT_KEY=                     # encrypts the local vault file
COMPANY_EMAIL=bills@billfighter.local
OWNER_PHONE_SIM=+15550001111

# data
OPENEI_API_KEY=

# payments
STRIPE_SECRET_KEY=sk_test_...

# voice (live mode only)
TWILIO_ACCOUNT_SID=
TWILIO_AUTH_TOKEN=
TWILIO_PROVIDER_NUMBER=
TWILIO_CALLER_NUMBER=
PROVIDER_REP_FORWARD_NUMBER=
VOICE_PROVIDER=retell          # retell | vapi
RETELL_API_KEY=
VAPI_API_KEY=

# allowlist (our numbers, domains and portal URLs only)
ALLOWED_CALL_NUMBERS=
ALLOWED_EMAIL_DOMAINS=billfighter.local
ALLOWED_PORTAL_ORIGINS=http://localhost:3001

# naive (fill on Saturday)
NAIVE_API_KEY=
NAIVE_COMPANY_ID=
NAIVE_IDENTITY_ID=
NAIVE_CARD_ID=
NAIVE_CARD_CAP_USD=5
```

---

## 19. Demo script (for reference)

- 0:00 "Businesses lose money on bills nobody reads. We built a company with no employees that fights them, and only gets paid when you save."
- 0:20 Run `demo-start`. A bill lands in the inbox; the board fills. "No one is typing."
- 0:50 Collector logs into the portal on screen and pulls a year of bills for 12 stores.
- 1:20 Findings: the Fremont meter doubled after a swap ($12,600 back under PG&E Rule 17.1), wrong rate plan, seven dead phone lines, three expired promos.
- 2:00 Linda gets one text. She replies YES. "Human actions: 1".
- 2:10 The AI calls the provider on speaker: disclosure, menu, cancels the lines, gets a ticket number.
- 3:00 Ledger: about $12,600 back, about $20,000 a year saved, our 30% fee, invoice sent; audit log scrolls; run cost shown.
- 3:30 "That ran on its own. Next: real restaurants in the Bay Area."

---

## 20. Out of scope

Real utility data access (PG&E Share My Data takes weeks), real provider calls, real customer onboarding, e-signature integrations, gas rate optimization, states outside California, mobile apps.

## 21. Open questions to confirm at kickoff

Whether a remote teammate can contribute, whether code written before the event is allowed, whether naïve can place voice calls now, and whether live calls during judging are fine. If prebuilt code is not allowed, rebuild from this file during the event starting at M0, and go straight to `PLATFORM=naive` for the agent layer.
