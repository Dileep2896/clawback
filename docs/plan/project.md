# Bill Fighter: build instructions for the coding agent

You are building **Bill Fighter**, a demo of an autonomous company made of AI agents. The company audits and cuts utility and telecom bills for businesses with many locations, and gets paid a share of the savings. It will be shown live at the naïve x YC Autonomous Company Hackathon (YC, San Francisco, Nov 7 to 8, 2026). The demo is 2 to 4 minutes, and the judges score one thing above all: **how much of the company runs without the team.**

Read this whole file before writing code. Build in the order of the milestones at the end. Every milestone must work end to end before you start the next one.

---

## 1. What the finished demo must do

One non-human event starts everything, and exactly one human action happens on stage.

1. A new bill email arrives at the company inbox (`bills@<our domain>`). Nobody types a prompt.
2. A CEO agent creates a savings plan for that customer and hands out work on a shared board.
3. A Collector agent logs into a **replica** provider portal (which we build) and downloads 12 months of bills for all 12 locations of the demo customer.
4. An Auditor agent parses every bill, re-prices usage under every eligible PG&E business rate, and runs error rules. It finds the four planted problems (section 6).
5. A Filer agent writes the refund claim and the cancellation requests, with evidence attached.
6. The system asks for **one approval**. A human taps approve. This is the only human action.
7. A Negotiator agent places a **real phone call** to our own mock provider line. It says up front that it is an AI and that the call is recorded, navigates a phone menu, and asks a teammate playing the provider rep to cancel the unused lines and restore promo pricing.
8. A Finance agent records the savings in a ledger and creates a Stripe **test mode** invoice for our 30% share.
9. A Monitor agent schedules next month's bill check.
10. The dashboard shows the board, findings, the call transcript, the ledger and a full audit log of every agent action, ending on "1 human action".

---

## 2. Hard rules (never break these)

- **Never contact a real company.** No calls, emails or logins to PG&E, AT&T, Comcast or any real provider. All providers are replicas we run.
- **Never log into a real utility account.** The Collector only works on our replica portal.
- **Every outbound call starts with this disclosure**, word for word: "Hi, this is an AI assistant calling on behalf of Golden Gate Noodle Company. This call is being recorded." California requires AI disclosure and all-party consent to recording.
- **Never invent numbers.** Every finding must point to the exact bill lines and data that prove it. If the engine can't prove something, it doesn't claim it.
- **Nothing changes without approval.** Calls, plan changes, cancellations, claims and charges all go through the approval gate.
- **Stripe runs in test mode only.** No live keys anywhere in the repo.
- **Do not guess platform APIs.** For naïve, Retell or Vapi, Twilio, Stripe and OpenEI, read the current docs (links in section 13) before writing integration code. The naïve names in this file come from their docs as of Nov 2026; verify each one.
- Keep all secrets in environment variables. Commit a `.env.example`, never a `.env`.

---

## 3. Tech stack

- **Language:** TypeScript everywhere (the naïve SDK is TypeScript only). Node 20+.
- **Monorepo:** pnpm workspaces.
- **Agents:** naïve SDK, with a coordinator (CEO) and a roster of member agents, a shared board, policies and the audit log.
- **Database:** Postgres. Use naïve's managed Postgres if easy, otherwise a local Postgres in Docker. Access it through Drizzle ORM.
- **LLM:** the naïve model router, or a direct provider key as fallback. Use structured outputs (JSON schema) for all parsing.
- **Dashboard and replica portal:** Next.js (App Router) with Tailwind.
- **Voice:** Twilio for phone numbers and the mock IVR, plus Retell or Vapi for the AI caller. Pick whichever has the simplest outbound call API after reading both docs.
- **Payments:** Stripe test mode.
- **PDFs:** generate synthetic bills with `@react-pdf/renderer` or Playwright HTML to PDF; extract text with `pdf-parse` or `pdfjs-dist`.

---

## 4. Repository layout

```
bill-fighter/
  apps/
    dashboard/          Next.js: board, findings, approvals, call view, ledger, audit log
    portal/             Next.js: replica "Pacific Power" and "BayTel" customer portals
  services/
    voice/              Twilio webhooks: mock provider IVR, call status, transcripts
    webhooks/           inbound email webhook that starts a run
  packages/
    core/               tariff engine, bill parser, audit rules, money math (no network calls)
    agents/             naïve team definition, agent prompts, tool implementations
    db/                 Drizzle schema, migrations, seed script
    shared/             types, zod schemas, constants
  data/
    tariffs/            cached OpenEI URDB JSON plus hand-checked fallback tariffs
    loadprofiles/       ComStock or Green Button restaurant load profiles (15 min)
    bills/              generated synthetic PDFs
    samples/            one real public PG&E sample business bill (parser test only)
  scripts/
    seed.ts             builds the demo customer, locations, accounts, bills
    demo-start.ts       sends the trigger email (or calls the webhook) to start a run
    demo-reset.ts       wipes run state so the demo can repeat
    replay.ts           replays a recorded run if live services fail
  project.md
  .env.example
```

Rule: `packages/core` must be pure functions with unit tests. Agents call core through tools. The whole audit must run from a plain script (`pnpm audit:local`) even if naïve or the voice stack is down.

---

## 5. Data model (Postgres)

Create these tables. Money is stored in integer cents.

- `customers` (id, name, contact_name, contact_email, contact_phone, savings_share_pct default 30)
- `locations` (id, customer_id, name, address, city)
- `accounts` (id, location_id, provider [pacific_power | baytel | bayconnect], account_number, service_type [electric | gas | telecom | internet], rate_schedule, meter_number)
- `authorizations` (id, customer_id, provider, form_type, scope, signed_by, signed_at, expires_at, pdf_path) for the signed letter of authorization, modeled on PG&E Form 79-1095
- `bills` (id, account_id, period_start, period_end, total_cents, pdf_path, parsed_json, parse_confidence)
- `bill_lines` (id, bill_id, description, quantity, unit, rate, amount_cents, line_type)
- `usage_intervals` (account_id, ts, kwh) for 15 minute data
- `phone_lines` (id, account_id, number, label, monthly_cents, calls_last_12mo, purpose [unknown | fax | alarm | voice])
- `findings` (id, customer_id, account_id, type, title, evidence_json, refund_cents, annual_savings_cents, confidence, status [proposed | approved | filed | won | rejected])
- `actions` (id, finding_id, kind [call | letter | claim | plan_change | cancel], payload_json, status, requires_approval bool, approved_by, approved_at)
- `calls` (id, action_id, to_number, started_at, ended_at, recording_url, transcript_json, outcome_json)
- `ledger` (id, customer_id, finding_id, kind [refund | savings | fee | invoice], amount_cents, stripe_id, created_at)
- `runs` (id, customer_id, trigger [email | schedule | manual], started_at, finished_at, status)
- `audit_log` (id, run_id, agent, tool, input_json, output_json, cost_cents, created_at). Mirror naïve's audit log here so the dashboard can show it even offline.

---

## 6. Demo customer and planted findings

Seed exactly this customer. All names are fictional. Label the dashboard "Demo data".

**Golden Gate Noodle Co.** Owner: Linda Park. 12 restaurants: 4 in San Francisco, 3 in Oakland, 3 in San Jose, 2 in Fremont. Each location has one electric account at "Pacific Power" (our PG&E stand in, using real PG&E rate structures), one telecom account at "BayTel" (AT&T stand in), and one internet account at "BayConnect" (Comcast stand in). Annual spend across all bills is about $300,000.

Generate 12 months of bills for every account, ending last month. Base electricity usage comes from a ComStock or Green Button restaurant load profile, scaled per store with a little random noise (fixed seed so it is repeatable). Then plant these four problems:

1. **Meter multiplier error (Fremont store #1).** 14 months ago the meter was replaced. Since then, billed kWh is exactly 2.0 times the real interval data, so the bill is about $1,800 a month instead of about $900. The bill shows the new meter number and a multiplier field that changed from 1 to 2. Expected refund: 14 months of overbilling, about $12,600, inside the 3 year window of PG&E Electric Rule 17.1. Expected yearly savings once fixed: about $10,800.
2. **Wrong rate schedule (two Oakland stores).** Both are on B-10. Their 12 month max demand is about 40 kW, so they qualify for B-6 (under 75 kW). Do not hard code the savings: the tariff engine must compute it. Tune the load profile so the engine shows B-6 is roughly 3 to 5% cheaper for these two stores. The fix is a rate change request under Rule 12 (one change per 12 months).
3. **Unused copper phone lines.** Nine BayTel POTS lines across six stores. Seven have zero calls in the last 12 months (labeled fax or spare). Two are alarm lines with low but non-zero use. Each line costs $60 a month. Expected savings: 7 x $60 x 12 = $5,040 a year. The alarm lines must be flagged "do not cancel, confirm with alarm company", never cancelled.
4. **Expired internet promos (three stores).** The BayConnect plan code stays the same, but the monthly charge jumps from $95 to $185 when a promo ends. Expected savings: 3 x $90 x 12 = $3,240 a year.

Also plant one **decoy**: the Oakland #3 store buys gas from a third party supplier. The Auditor should flag it as "review contract, check exit fees" and must not recommend switching. Third party supplier complaints are rising in California, so caution is the right behavior.

Expected demo totals (the engine computes them; these are only for checking): about $12,600 in refunds and about $20,000 a year in savings. Bill Fighter's 30% share of first year value is about $9,900.

Include one real public PG&E sample business bill in `data/samples/` only to prove the parser handles a real layout. Never mix it into the demo customer.

---

## 7. Core engine (`packages/core`)

### 7.1 Tariff loading
- Fetch PG&E commercial rates from the OpenEI Utility Rate Database API (`https://api.openei.org/utility_rates`, free API key, `format=json`, `detail=full`, `sector=Commercial`, page with `limit` and `offset`, max 500 per request). Use `getpage` to fetch a single rate by label.
- Cache the JSON for B-1, B-6, B-10 and B-19 in `data/tariffs/`. Log each record's `startdate` and last update, and warn if it is older than 12 months.
- Write a normalized `Tariff` type: TOU periods from the 12 x 24 weekday and weekend schedules, energy rates per period and tier, demand charges (flat and TOU), fixed customer charges.
- Keep a hand-checked fallback JSON per schedule, built from the current PG&E tariff PDFs (links in section 13), in case URDB is stale. Mark which source was used on every calculation.

### 7.2 Bill calculator
- `priceUsage(intervals, tariff, period) => { energyCents, demandCents, fixedCents, totalCents, breakdown }`
- Map every 15 minute interval to month, hour and weekday or weekend, find its TOU period, sum kWh per period, apply rates, compute max kW per demand window, and add fixed charges.
- Unit test it: a flat load and a hand-computed bill must match to the cent.

### 7.3 Eligibility rules
- B-1 and B-6: max demand under 75 kW.
- B-10: under 500 kW.
- B-19: voluntary under 500 kW, mandatory above 499 kW.
- B-20: mandatory above 999 kW.
- Only compare schedules the account qualifies for. Recheck these limits against the current PG&E tariff sheets.

### 7.4 Bill parser
- Extract text from the PDF, then ask the LLM to fill a strict JSON schema: account number, service address, meter number, multiplier, rate schedule, billing period, kWh per TOU period, max kW, line items and total.
- Validate with arithmetic: line items must sum to the total, and kWh times rate must match each energy line within 1%. Store `parse_confidence`. If validation fails, retry once with page images, then mark the bill "needs review".

### 7.5 Audit rules
Each rule returns zero or more `Finding` objects with evidence (bill ids, line ids, charts data) and money amounts.

- `meterMultiplierJump`: billed kWh versus interval kWh. If the ratio jumps and stays near an integer above 1 after a meter number change, flag it. Refund = sum of overbilled amounts within the last 36 months.
- `rateOptimization`: re-price the last 12 months under every eligible schedule. If the best one saves more than 2%, propose a Rule 12 rate change and show the per month comparison.
- `unusedLines`: phone lines with zero calls in 12 months that are not alarm lines. Alarm lines get a "confirm first" finding with no savings counted.
- `promoExpiry`: same plan code, monthly charge up more than 30% month over month, with no usage change.
- `arithmeticCheck`: any bill whose lines don't add up.
- `thirdPartySupplier`: flag for contract review only.

Write unit tests that run the rules on the seeded customer and assert all four planted findings are found and that the decoy produces no "switch supplier" advice.

---

## 8. Replica provider portals (`apps/portal`)

- Two simple branded portals: "Pacific Power Business" and "BayTel Business". Clearly fictional names and logos. Add a small banner: "Demo portal, not a real utility".
- Login page (username and password from the vault), account list, bills page with PDF downloads, and a usage download (CSV of 15 minute data).
- Add realistic friction so the browser agent has real work: a location picker, pagination, and one "Your session will expire" modal.
- No CAPTCHA. Do not copy any real company's design, logo or text.

---

## 9. The agents (`packages/agents`)

Build them on the naïve SDK: one coordinator plus a roster of members, with the shared board turned on. Each agent gets a short system prompt, a narrow set of tools and a budget. Read the naïve docs for teams, policies, identity mail, vault, browser and budgets before you start.

| Agent | Job | Tools | Policy |
|---|---|---|---|
| CEO (coordinator) | Opens a savings plan per run, creates board cards, delegates, sends the owner a summary email at the end | board, delegate, `send_email` | allow |
| Intake | Receives the bill email webhook, identifies the customer, starts the run | `parse_inbound_email`, `start_run` | allow |
| Collector | Logs into the replica portals with vault credentials, downloads bills and usage, stores them | naïve browser, vault, `store_bill`, `store_usage` | allow |
| Auditor | Parses bills and runs every audit rule from `packages/core` | `parse_bill`, `run_audit`, `price_usage` | allow |
| Filer | Writes the Rule 17.1 refund claim, the Rule 12 rate change request and cancellation letters as PDFs, with evidence | `draft_letter`, `attach_evidence` | allow |
| Approver gate | Bundles all proposed actions into one approval request for the owner | `request_approval` | ask |
| Negotiator | Calls the provider line, follows the script, records outcomes | `call_provider` | ask |
| Finance | Writes ledger entries, creates the Stripe test invoice for 30% of first year value | `record_savings`, `create_invoice` | ask for invoice |
| Monitor | Schedules next month's check | `schedule_check` | allow |

Policies: set `call_provider`, `submit_claim`, `change_rate_plan`, `cancel_service` and `create_invoice` to `ask`. In naïve an `ask` pauses the session until someone confirms (the docs describe `naive session confirm`); the approver is recorded in the audit log. Design it so **one** approval releases the whole approved action bundle, so the demo has a single tap. Everything else is `allow`. Nothing is `deny` except any tool that could reach a real provider domain or phone number (enforce an allowlist in code too).

Budgets: set a run budget (for example $25 total, $5 per task) so the demo can show "this run cost $X".

Every tool call writes to `audit_log`.

---

## 10. Voice (`services/voice`)

naïve phone numbers send SMS only, so calls use our own stack.

- **Mock provider line:** a Twilio number we own that answers with an IVR: "Thanks for calling BayTel Business. For billing, press 2." Then it forwards the call to a teammate's phone (the "provider rep") or, as a backup, to a second AI agent playing the rep with a fixed script.
- **AI caller:** a Retell or Vapi outbound agent that dials only numbers on our allowlist. It must:
  1. Say the disclosure line from section 2 first.
  2. Navigate the menu with DTMF tones.
  3. Give the account number, ask to cancel the seven unused lines and restore promo pricing on the three internet accounts, and confirm each item back.
  4. Ask for a confirmation or ticket number and repeat it.
  5. End politely.
- Stream the live transcript to the dashboard. Save the recording URL, the transcript and a structured outcome (`{ cancelled_lines: [...], credits: [...], ticket: "..." }`) extracted by the LLM after the call.
- Expose the whole thing to naïve as one tool, `call_provider`, gated by `ask`.
- Backup: if the call fails, play the best saved recording and transcript and mark it "replay" on screen.

---

## 11. Trigger, scheduling and demo controls

- **Trigger:** naïve inbound email does not wake agents on its own yet. Register an inbound mail webhook to `services/webhooks`, which starts the run. If that fails, fall back to a scheduled poll every minute.
- `scripts/demo-start.ts` sends a bill email from a "Pacific Power" sender to `bills@` so the run starts with no one typing a prompt. Run it right before walking on stage.
- `scripts/demo-reset.ts` clears run state, findings, calls, ledger and audit rows but keeps seeded data.
- `scripts/replay.ts` plays back a recorded run event by event onto the dashboard at real speed if anything live breaks.
- A hidden `?speed=2` dashboard flag can speed up animations, never the data.

---

## 12. Dashboard (`apps/dashboard`)

One screen, built for a projector (large text, dark theme option).

- **Header:** customer name, run status, run cost so far, and a big counter: "Human actions: 0" that becomes 1 after approval.
- **Board:** cards per agent task moving through To do, Doing, Done (mirror naïve's board).
- **Findings:** four cards with title, plain English explanation, money amounts and an "Evidence" drawer (bill snippet, chart of billed versus real kWh, rate comparison table).
- **Approval panel:** the single approval request listing every action, with an Approve button that calls naïve's confirm flow.
- **Call panel:** live transcript, call timer, disclosure line highlighted, outcome when done.
- **Ledger:** refunds, yearly savings, our fee, customer keeps.
- **Audit log:** scrolling list of every tool call with agent, tool, time and cost.

---

## 13. Reference links (read before building)

- naïve: https://usenaive.ai/docs , https://usenaive.ai/primitives , teams: https://usenaive.ai/docs/capabilities/team.md , policies: https://usenaive.ai/docs/concepts/policies.md , identity and mail: https://usenaive.ai/docs/capabilities/identity.md , pricing: https://usenaive.ai/pricing , hackathon: https://usenaive.ai/hackathon
- OpenEI URDB API: https://openei.org/services/doc/rest/util_rates?version=3 and https://developer.nrel.gov/docs/electricity/openei-utility-rates/
- Example bill calculator to learn from: https://github.com/LBNL-ETA/elecprice (OpenEI tariff analyzer) and NREL PySAM's utility rate example
- Load profiles: NREL ComStock https://nrel.github.io/ComStock.github.io/docs/data.html , Green Button samples https://archive.greenbuttondata.org/samples
- PG&E tariffs: Rule 17.1 https://www.pge.com/tariffs/assets/pdf/tariffbook/ELEC_RULES_17.1.pdf , B-6 https://www.pge.com/tariffs/assets/pdf/tariffbook/ELEC_SCHEDS_B-6.pdf , B-19 https://www.pge.com/tariffs/assets/pdf/tariffbook/ELEC_SCHEDS_B-19.pdf , business rate options insert https://www.pge.com/assets/pge/docs/account/billing-and-assistance/bill-inserts/0325-biz-rate-options.pdf
- Authorization form model: PG&E Form 79-1095 https://www.pge.com/tariffs/assets/pdf/tariffbook/GAS_FORMS_79-1095.pdf
- Real sample business bill for parser testing: https://www.pge.com/assets/pge/docs/clean-energy/solar/commercial-business-monthly-statement-sbp.pdf
- Twilio voice pricing and docs: https://twilio.com/en-us/voice/pricing/us
- Retell and Vapi docs for outbound calls (read both, pick one)
- Stripe test mode invoices (Stripe docs)

---

## 14. Environment variables (`.env.example`)

```
NAIVE_API_KEY=
DATABASE_URL=
LLM_API_KEY=                # only if not using the naïve model router
OPENEI_API_KEY=
TWILIO_ACCOUNT_SID=
TWILIO_AUTH_TOKEN=
TWILIO_PROVIDER_NUMBER=     # our mock provider line
TWILIO_CALLER_NUMBER=
PROVIDER_REP_FORWARD_NUMBER= # teammate's phone
VOICE_PROVIDER=retell       # or vapi
RETELL_API_KEY=
VAPI_API_KEY=
STRIPE_SECRET_KEY=sk_test_...
ALLOWED_CALL_NUMBERS=       # comma separated allowlist, our numbers only
DEMO_DOMAIN=
```

---

## 15. Milestones (build in this order)

Each milestone has a check. Do not move on until the check passes.

**M0. Skeleton (1 hour).** Monorepo, Postgres, Drizzle schema, `.env.example`, lint and test setup.
Check: `pnpm test` and `pnpm db:migrate` succeed.

**M1. Data and seed (3 hours).** Fetch and cache tariffs, load a restaurant profile, generate the demo customer with all accounts, 12 months of synthetic PDF bills, phone lines and the planted problems.
Check: `pnpm seed` creates 12 locations, 36 accounts, about 432 bills, and the PDFs open and look like real bills.

**M2. Core engine (5 hours).** Tariff normalizer, bill calculator, eligibility, parser, all audit rules, unit tests.
Check: `pnpm audit:local` prints the four planted findings with amounts close to section 6 and no supplier switch advice. The real PG&E sample bill parses with valid arithmetic.

**M3. Replica portals (2 hours).** Pacific Power and BayTel portals with login, bills, usage download.
Check: a Playwright script can log in and download every bill.

**M4. Agents on naïve (6 hours).** Team, tools, policies, budgets, audit log mirroring, inbound email trigger.
Check: running `scripts/demo-start.ts` makes the agents collect bills from the replica portal, run the audit, draft letters and stop at one approval request, with no human input.

**M5. Voice (4 hours).** Mock IVR, AI caller with disclosure, transcript streaming, outcome extraction, allowlist.
Check: after approval, a real call reaches the teammate's phone, the transcript shows the disclosure first, and the outcome is saved.

**M6. Finance and monitor (1.5 hours).** Ledger, Stripe test invoice for 30%, next month schedule.
Check: the ledger shows refunds, savings, fee and customer keeps, and a Stripe test invoice exists.

**M7. Dashboard (4 hours).** All panels from section 12, live updates.
Check: a full run looks clear on a 1080p projector from the back of a room.

**M8. Hardening and rehearsal (3 hours).** `demo-reset`, `replay`, error handling, retries, a recorded backup video of a full successful run.
Check: three full runs in a row succeed from reset, and replay works with the network unplugged.

If time runs short, cut in this order: gas accounts, Monitor agent, portal friction, second portal. Never cut the disclosure, the approval gate or the audit log.

---

## 16. Demo script (for reference while building)

- 0:00 Hook: "Businesses lose money on bills nobody reads. We built a company with no employees that fights them, and only gets paid when you save."
- 0:20 Run `demo-start`. A bill lands in the inbox. The board starts filling. "No one is typing."
- 0:50 Collector logs into the portal on screen and pulls a year of bills for 12 stores.
- 1:20 Findings appear: the Fremont meter doubled after a swap ($12,600 back under PG&E Rule 17.1), the wrong rate plan, seven dead phone lines, three expired promos.
- 2:00 One approval request. Tap approve. Counter shows "Human actions: 1".
- 2:10 The AI calls the provider on speaker: disclosure, menu, cancels the lines, gets a ticket number.
- 3:00 Ledger: about $12,600 back, about $20,000 a year saved, our 30% fee, invoice sent. Audit log scrolls. Run cost shown.
- 3:30 Close: "That ran on its own. Next: real restaurants in the Bay Area."

---

## 17. Out of scope for the hackathon

Real utility data access (PG&E Share My Data takes weeks), real provider calls, real customer onboarding, e-signature integrations, gas rate optimization, states outside California, mobile apps.

## 18. Open questions to confirm at kickoff

Ask the organizers whether a remote teammate can contribute code, whether code written before the event is allowed, whether naïve can place voice calls now, and whether live calls during judging are fine. If prebuilt code is not allowed, rebuild from this file during the event, starting from M0.
