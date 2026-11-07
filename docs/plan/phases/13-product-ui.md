status: approved

# Phase 13: Clawback product UI

The human, 2026-11-07, in the terminal: "First change the name to Clawback. and why is the UI soo bad. now our task is to give it an acutal product view, How are people going to create their account and send bills and looks at their saving. This is really bad UI for demo".

Human's answers, 2026-11-07:
- Rename everything users see to Clawback. Internal package names `@bill-fighter/*` stay.
- Bills come in two ways at sign-up: upload bill PDFs, or connect a utility portal login (the local fake portals) so the agents pull the bills themselves.
- Customer app plus a live agents view: sign up, connect bills, savings overview, findings, one-click approve, money recovered. Today's panel screen becomes a restyled "Watch your agents work" page inside the app.
- Stage flow: open on a quick sign-up and connect (about 30 s), then the same rehearsed run in the new UI, ending on the savings page. The slot is still 3 to 4 minutes.

**Phase check:** A sim rehearsal from sign-up to the savings page fits the slot, at 1920x1080, with the same numbers as today (refund $12,606.06, yearly savings $18,319.32, fee $9,277.61).

**Hard rules for every lane:**
- The rehearsed run must keep working and produce the same numbers. `pnpm demo:replay`, `pnpm demo:reset`, `scripts/replay-check.ts` and the stage runbook in `docs/plan/rehearsal-notes.md` must still work. If a route moves, update every script that opens it.
- No live calls, no paid APIs, Stripe test mode only. Voice stays `VOICE_MODE=sim` in every lane.
- The app is local-first. Sign-up is a demo account system on our Postgres, not a real identity provider. Passwords are hashed (node `crypto.scrypt`), sessions are signed httpOnly cookies. Never log a password or a portal login.
- Portal logins entered at sign-up go into the existing vault (`portalVaultName`), never into a plain table column.
- Design must look like a real, polished fintech product, not a hackathon admin page. Use the `frontend-design` skill. Follow `docs/plan/design.md` once `product-shell` writes it.

**Needs from the human:** Nothing new.

## Tasks

### `clawback-rename`

**Goal:** Every user-facing "Bill Fighter" outside `apps/dashboard` says "Clawback": letters, emails, SMS text, the identity's display name, seed data text, docs the audience might see. `apps/dashboard` is owned by `product-shell`, leave it alone.

**Estimate:** 30 minutes

**Acceptance checks:**
- `grep -ri "bill fighter"` outside `apps/dashboard`, `docs/plan/phases/` and `node_modules` returns nothing user-facing. Package names and import paths are unchanged.
- If the agent's email address domain (`billfighter.local` or similar) changes, every allowlist, test and seed that names it changes with it, and `pnpm test` stays green. If changing the domain is risky, keep it and say so.
- The voice disclosure line and caller prompts are unchanged unless they name Bill Fighter.
- `pnpm test`, `pnpm lint`, `pnpm typecheck` pass.

**Likely files:**
- `packages/platform/src/local/identity.ts`
- `packages/agents/src/letters/render.ts`
- `packages/db/src/seed/customer.ts`
- `README.md`

**depends on:** nothing

**parallel with:** product-shell

### `product-shell`

**Goal:** Turn `apps/dashboard` into the Clawback product. Pick a design direction and write it to `docs/plan/design.md` (tokens, type, colour, spacing, components). Build the marketing landing page at `/` (what Clawback does, "Get started", "Log in"), the signed-in app layout with navigation (Overview, Bills, Findings, Agents, Money), and shared components (buttons, cards, stat tiles, tables, empty states). Move today's panel screen to `/agents` and restyle it in the new design as "Watch your agents work", keeping every panel's behaviour and the replay banner. Rename Bill Fighter to Clawback everywhere in the dashboard.

**Estimate:** 2 hours

**Acceptance checks:**
- `/` is a landing page; `/agents` shows the live run with every panel working, readable at 1920x1080 with no page scroll.
- `pnpm demo:replay` and `scripts/replay-check.ts`, `scripts/dashboard-shell-check.ts`, `scripts/panels-*-check.ts` open the new route and pass.
- Other app pages may be placeholder stubs with the real layout; `signup-connect` and `savings-views` fill them.
- Screenshots at 1920x1080 and 390x844 of `/` and `/agents` in `.fleet-lane/`.
- No "Bill Fighter" text left in `apps/dashboard`.

**Likely files:**
- `apps/dashboard/app/`
- `apps/dashboard/components/`
- `apps/dashboard/lib/`
- `docs/plan/design.md`
- `scripts/replay.ts`, `scripts/*-check.ts`

**depends on:** nothing

**parallel with:** clawback-rename

### `signup-connect`

**Goal:** Account creation and getting bills in. Sign up (name, company, email, password), log in, log out. Onboarding: add the business, then connect bills either by uploading PDFs or by entering a provider portal login (BayCurrent, BayTel, BayConnect, BayHearth). Uploaded PDFs are saved and parsed with the existing parser; portal logins go into the vault. A "Start my audit" button starts a run through the existing run trigger (manual trigger) and takes the user to the Overview while the agents work.

**Estimate:** 2 hours

**Acceptance checks:**
- Signing up as the demo customer (Linda Park, Golden Gate Noodle Co., her seeded email) and connecting the BayCurrent login leads to the same run and the same numbers as `pnpm demo:start`. A new user record links to the seeded customer by email; document how in the lane notes.
- A different new user can sign up, upload a sample PDF from `data/bills/`, and see it parsed into the Bills page. A full run for an unknown customer is not required; show an honest "audit queued" state if the pipeline cannot run it.
- Schema changes go through a migration. Passwords hashed, sessions signed, httpOnly. Pages need login except `/`, `/signup`, `/login`.
- `pnpm demo:reset` also clears users created during a demo, so sign-up can be repeated on stage.
- The sign-up and connect steps take under 30 s by hand in the stage flow.
- Tests for hashing, session checks and the vault write; `pnpm test` green.

**Likely files:**
- `packages/db/src/schema.ts` and a new migration
- `apps/dashboard/app/(auth)/`, `apps/dashboard/app/(app)/onboarding/`
- `apps/dashboard/app/api/`
- `scripts/demo-reset.ts`

**depends on:** product-shell

**parallel with:** savings-views

### `savings-views`

**Goal:** The customer's money pages, reading the same Postgres rows the panels use. Overview: money recovered, yearly savings, Clawback's fee, what the customer keeps, run status, and a prominent "Approval needed" card with one Approve button that uses the existing approval path. Bills: every bill per account and location. Findings: list and detail with the existing evidence (bill snippet, kWh chart, rate table). Money: ledger rows, invoice, Stripe test payment state.

**Estimate:** 2 hours

**Acceptance checks:**
- Numbers equal the ledger rows (refund $12,606.06 claimed, yearly savings $18,319.32, fee $9,277.61) with no money math in pages beyond sums; money math stays in `packages/core`.
- Approve from the Overview releases the bundle exactly like the old Approval panel; a double click records one approval; SMS YES still works.
- Pages update live during a run, using the existing live feed.
- Promo findings show as found but not acted on, as today.
- Ledger and findings today sum every run for the customer, so two runs double the numbers. The stage resets before each run; keep that behaviour, but test with a database holding exactly one run, and show the run date on the Overview.
- Screenshots at 1920x1080 of every page after a sim run in `.fleet-lane/`.

**Likely files:**
- `apps/dashboard/app/(app)/overview/`, `bills/`, `findings/`, `money/`
- `apps/dashboard/components/`
- `apps/dashboard/lib/`

**depends on:** product-shell

**parallel with:** signup-connect

### `landing-tam`

**Goal:** Add a "The market" section to the landing page at `/`, in the existing design, between "How it works" and the demo result. Human, 2026-11-07: "add the TAM to the landing page".

Content (use these numbers exactly, labelled as estimates):
- Headline figure: "$500B+" with "US businesses pay every year in electricity, gas, water and phone bills".
- "1 to 3% of it is billed wrong or on the wrong plan" → "$5 to 16B a year left on the table".
- One line: "Today only large companies pay auditors to get it back. Clawback's agents do it for every business."
- Small source note under the section: "Estimates. Electricity: US EIA, 2025 retail sales ($290B commercial and industrial). Telecom: Grand View Research, 2022 ($187B). Error rates: bill-audit industry reports (3 to 5% recovered); we assume 1 to 3%."

**Estimate:** 20 minutes

**Acceptance checks:**
- The section reads well at 1920x1080 and 390x844; screenshots in `.fleet-lane/`.
- The demo customer's numbers on the page are unchanged; `scripts/dashboard-shell-check.ts` passes.
- No other page changes.

**Likely files:**
- `apps/dashboard/app/page.tsx` or the landing component

**depends on:** product-shell

**parallel with:** rehearsal-product

### `landing-redesign`

**Goal:** Redesign the landing page at `/` so it looks designed by a senior product designer, not generated. Human, 2026-11-07: "The landing page is too generic AI created page. We need to make it professional with really good UI and should look like designed by a professional UI".

Use the `hallmark` skill (anti-generic design) first, then `frontend-design`. Study 3 to 5 real fintech or B2B landing pages you admire as references and name them in the lane notes; do not copy any. Concretely:
- A real point of view: one strong typographic idea, a deliberate grid, real product imagery (render actual Clawback screens, such as the Overview with the refund and the approval card, or a bill with the overcharge marked), not icon rows or generic gradient blobs.
- Show the product working: a bill line, the finding, the call transcript line, the money landing. Motion only where it explains something, and respect `prefers-reduced-motion`.
- Keep the copy honest and specific (numbers from the demo; the market section from `landing-tam`, same numbers and source note). No "AI-powered", "revolutionize", "seamless", emoji, or stock-style claims.
- Keep "Get started" and "Log in" working, the demo-data disclaimer, the existing design tokens where they work (you may evolve them; update `docs/plan/design.md` if you do), and accessibility (contrast, keyboard, alt text).
- Only the landing page and its components change; the app pages and `/agents` stay as they are.

**Estimate:** 2 hours

**Acceptance checks:**
- Screenshots at 1920x1080 (full page) and 390x844 in `.fleet-lane/`, plus a short note on the design decisions.
- Run the `hallmark` audit on the result and fix what it flags; include its verdict in the notes.
- `scripts/dashboard-shell-check.ts` passes; `pnpm test`, lint and typecheck pass.

**Likely files:**
- `apps/dashboard/app/page.tsx` and landing components
- `docs/plan/design.md`

**depends on:** landing-tam

**parallel with:** naive lanes

### `rehearsal-product`

**Goal:** Rehearse the new stage flow in sim mode: `demo:reset`, sign up, connect BayCurrent, start, watch `/agents`, approve, end on the Overview. Time it against the 3 to 4 minute slot, recapture the replay if the screens changed, and update `docs/plan/rehearsal-notes.md`. No live calls; the human decides on a live rehearsal afterwards.

**Estimate:** 1 hour

**Acceptance checks:**
- Three sim runs from sign-up pass with the same numbers.
- Timings table and the new stage script in `rehearsal-notes.md`.
- The replay backup shows the new UI and still carries the replay label.
- The safety search from the last rehearsal passes again.

**Likely files:**
- `docs/plan/rehearsal-notes.md`
- `data/replay/`

**depends on:** signup-connect, savings-views

**parallel with:** nothing
