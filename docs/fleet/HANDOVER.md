# Handover

The orchestrator rewrites this before it stops, and reads it first when it starts.

## Current session
Picked up 2026-11-06

## Running
- rules-rates-lines: building. agent-roster: questions. voice-sim: planning.
- On main (18 of 40): repo-skeleton, shared-contracts, db-schema, tariff-calculator, tariff-data, load-profile, voice-live-spike, voice-live-line, platform-interfaces, seed-generator, bill-pdfs, platform-agent-runtime, rules-billing, platform-db-adapters, seed-loader, platform-io-adapters, portal-shell, bill-parser.
- Next when slots free: audit-local-cli, portal-downloads, call-provider-tool, tools-*, run-trigger, voice-live-caller, agents-e2e, dashboard, finance, monitor, demo-reset, replay, resilience, rehearsal.
- `fleet ask` writes to the orchestrator's inbox, not the lane. Use `fleet send` to ask a lane anything.
- For tools-file-approve: send_sms takes no `to` from the model, targets [], owner number from config.
- For run-trigger: wrap runtime.run() in auditDenied from tool-wrapper.ts; create the run row before tools run, because audit_log.run_id is a foreign key.
- For finance-invoice: refuse a non-test Stripe key at call or run start, never at import, because one throwing tool file breaks the whole tool scan.
- For agents-e2e: a gated call parks in waitForRelease while approval is pending; check this against "stops at one pending approval". fillSecret is first exercised by the collector tools.
- Portal login needs `pnpm seed:portal` once on main, with VAULT_KEY set, before the first full run.

## Waiting on the human
- Nothing right now.

## Decided
- Prebuilt code is allowed (human confirmed 2026-11-06). Build M0 to M9 before the event, no rebuild at kickoff.
- Human is solo. The provider rep is the second AI agent, never a teammate.
- Real calls are fine (human confirmed). Live voice is a must-have, sim is the fallback. Naive docs mention no voice calling, so voice stays on our own stack: Retell caller dialling a free Vapi number that plays the menu and rep, on free credits. No Twilio. Unverified until the voice spike.
- Human took all recommended answers: cached parsing on stage, invoice now with refund part due when granted, honest B-6, Bill Fighter on stage, approval by email plus YES text with dashboard backup.
- vetta.sh is naive's old name, per its docs.
- Telegram approvals count for this project (human, in the terminal, 2026-11-06): from user id 7355496775 only, a direct reply to the approval question, a clear yes. Add this to PLAYBOOK.md after repo-skeleton ships.
- Local mode uses Claude headless only, through the Claude Code login, with no ANTHROPIC_API_KEY for now (human, 2026-11-06). Brief platform-agent-runtime, bill-parser and agents-e2e on this at spawn: verify the Agent SDK works on that login from the docs, check canUseTool still gates, make sure a set ANTHROPIC_API_KEY cannot silently override, and treat cost figures as estimates. If the SDK cannot use the login, stop and ask.

## Next
- After phase approval, write task files and spawn builders from M0.
- Lanes spawn in auto mode (human approved 2026-11-06). The running planner is still on allowlist.
- Sweeps stay silent while a prompt alert repeats (same text as last sweep), so read each lane on every timer tick.
- Plan conflicts settled with the planner in .fleet/tmp/plan-conflicts.md: Fremont #1 history, parser purity, gated tool owners, BayConnect portal, gas account.
- Naive only at M10, when the human asks. The planner tried to fetch vetta.sh during naive research; declined, not in the plan.
- Lane relays owed: interval ts is the interval start (tell load-profile, seed-generator). seed-generator owns the real-tariff calculator check. audit-local-cli regenerates inputs offline from the seed generator. Copy .env into any new lane needing keys.
- For seed-generator: Fremont #1 goes on a schedule where the bill is mostly energy (B-10 at 40 kW has about $1,166 a month before energy, so it cannot be a $900 bill, and a 2.0 multiplier must double the bill). Oakland #1 and #2 need about 7,000 kWh a month for B-6 to save 3 to 5% (tariff-data estimate, confirm with the calculator).
- For seed-generator and bill-pdfs: demand entries carry a days field; on a prorated line kw x rate does not equal cents, so print the days. Seed bills should be calendar months.
- Voice calls (human, 2026-11-06): be very careful with usage, no unnecessary calls. Every lane placing a live call needs my word first, and I check with the human. voice-live-line and voice-live-caller test against sim where they can. Brief them on this at spawn.
- For platform-db-adapters and panels-action: the approval decision (first decision wins) lives in one function in packages/db, used by the local ApprovalGate.decide and by the api/approve and api/sms routes. Dashboard routes go straight to Postgres and never call getPlatform(). Adapter contract: one file per interface in src/<platform>/, export default; checks are <file>.check.ts. phases 02 and 07 and schedule.md still say ANTHROPIC_API_KEY is required: the playbook wins.
- For voice-sim: import the rep script from services/voice/src/live/line/script.ts (voice-live-line owns it).
- For voice-live-caller: its first full test also proves the voice-live-line check (a real call hears the menu and reaches the rep), deferred by the human. Rep grants everything, ticket BT-48213; refusals only tested in sim.
- For rules-rates-lines: rateOptimization prices from usage_intervals, never billed kWh, or Fremont #1 (doubled kWh) shows a false B-19 finding. Oakland single months are 5.1% dearer to 10.5% cheaper, annual claim only.
- For voice-live-caller and call-provider-tool: the rep agrees to anything, so the caller must keep alarm lines off the cancellation list itself. The Vapi rehearsal (cli.ts rehearse) needs a card on file; waiting on the human.
- Vapi card: skipped by the human (2026-11-06). No text rehearsal, so the first voice-live-caller full test is the first run of the rep script on the model. Expect possible off-script replies. rehearse CLI stays but returns 402.
- For bill-parser: a parse cache miss must fail visibly, never quietly call the LLM on stage. PDFs tested byte-stable on this Mac only. Orchestrator owes a docs cleanup: ANTHROPIC_API_KEY is still called required in phases 02, 05, 07, schedule.md, project.md:67,321 and .env.example:10. Local mode: SDK works on the login, claude.ai connectors must stay removed from runs (Gmail, Drive).
- Decided (human on Telegram, 2026-11-07 UTC): local mode is for the owner only; budget cap is a labelled estimate; Pacific Power renamed BayCurrent Electric, slug baycurrent, done in the bill-pdfs lane. Later lanes use the new name.
- Before the first voice-live-caller full test: run services/voice/src/live/line/cli.ts provision, since the live baytel-line assistant still has the old prompt. Its checks reject any hook on the number; the one read-only check returned no hooks field but could not rule out the number missing from the list, so provision is the real proof.
- For audit-local-cli: rules take BillFixture-shaped bills; turning data/parsed JSON into that shape, ids included, is that lane. For rules-rates-lines: build on rules/input.ts from rules-billing (has phoneLines); start after it merges or read its branch. Findings use Rule 17.1 with no utility name, refund worded as claimed.
- STANDING APPROVAL (human, terminal, 2026-11-06): "Okay I have seen all the plans, so approve everything until we have a working demo and keep on building, You can ask me when it comes to actual API which cost us money, but till then just keep on building". Record this quote per lane through M9; take recommended defaults on product questions and list them for the human. Still ask before every live call or paid API. Not M10.
- For agent-roster and tool lanes: repeat protection is theirs: a released action must not run twice; ApprovalGate does not stop that. platform-db-adapters owns migration 0002; next free after it is 0003.
- For run-trigger: demo-start POSTs exactly the InboundEmail shape (messageId, from, to, subject, text) to services/webhooks/inbound; Mail.parseInbound accepts only that. Duplicate test db helpers possible: packages/db/src/test-db.ts and packages/platform/src/local/temp-db.ts; drop one when the second lane merges.
