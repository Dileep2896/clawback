# Handover

The orchestrator rewrites this before it stops, and reads it first when it starts.

## Current session
Picked up 2026-11-06

## Running
- plan-phases (planner): replanning from the local-first project.md (cc64d62).

## Waiting on the human
- Approve phase files when the planner stops.
- Approve the final phase files.
- Set up Retell (KYC, card) and Vapi accounts.

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
