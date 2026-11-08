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

### `landing-live`

**Goal:** Third landing attempt. Human, 2026-11-07: "the landing page is still boring AI slop". The human chose the **"Agents at work (live)"** direction: the hero plays a short, real run. Their chosen sketch:

```
● Collector   downloading 12 bills ...  ✓
● Auditor     Fremont meter billed 2x   !
● Negotiator  calling BayTel            ☎
  "Please cancel line (415) 555-0102"
  "Yes, that is cancelled."
● Finance     refund claimed
       $ 1 2 , 6 0 6 . 0 6  ▲
  Your bills are wrong. Agents fix them.
         [ Start my audit ]
```

Build it as the first screen, full height, dark:
- A scripted, looping playback (about 15 to 20 s) of the real demo run: agent rows light up in order with real text from the recorded run (`data/replay/`, the audit log, the call transcript), the call lines type out, the refund counter rolls up to $12,606.06, the finding rows flash the overcharge. Every word and number comes from the real run; nothing invented.
- It must feel like watching software work: monospace or tabular figures for the live rows, a strong display face for the headline, real timing (not all at once), subtle status dots, a progress line. No gradient blobs, no glassmorphism, no icon grids, no emoji (use real glyphs or small drawn SVGs, not ☎ emoji).
- `prefers-reduced-motion`: show the finished state, no animation. Pause when off-screen. No layout shift.
- Below the hero keep the rest of today's landing (the "follow one overcharge" strip, the market section, what the owner kept, footer), tightened to match the new hero. Delete anything that reads generic.
- Pure CSS and small client code; no new animation library unless a few lines cannot do it.

Use the `hallmark` skill and run its audit; fix what it flags. Before calling it done, look at your own screenshots and ask: "Would a design-literate founder think a human designer made this?" If not, iterate.

**Estimate:** 2 hours

**Acceptance checks:**
- A short screen recording or 4 to 6 frame screenshots of the hero animation at 1920x1080, plus 390x844, in `.fleet-lane/`.
- Every animated value traces to the recorded run; list the sources in the lane notes.
- Reduced-motion shows a complete, static hero.
- `scripts/dashboard-shell-check.ts`, `pnpm test`, lint and typecheck pass. Only landing files change.

**Likely files:**
- `apps/dashboard/app/page.tsx`, `apps/dashboard/components/landing/`

**depends on:** landing-redesign

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

## Design pass 2 for `landing-live` (human, 2026-11-07, after viewing the preview)

Human, verbatim: "use proper coloring and format is bad. With modern design. and graphics animations"

Finish the two review fixes first, then do this pass in the same lane. Keep the "agents at work" idea and every real number; change how it looks.

**Colour.** Today is one dark green-black plus mint: monotone and flat. Build a real palette and write it into docs/plan/design.md:
- Background: deep ink (near-black with a slight blue, not green), with one or two very soft radial glows behind the hero graphic, and a faint grid or dot texture. No purple gradients.
- One vivid brand accent for money recovered (keep green, but brighter and cleaner, like emerald or lime-green), one warm signal colour for "overcharge found" (amber), red only for wrong numbers on a bill, and a cool secondary (sky or cyan) for agents working. Each colour has one meaning.
- Cards: slightly lighter ink surfaces with 1px hairline borders and a subtle inner highlight; no heavy shadows.

**Format.** Today the run panel sits above the headline and the page reads as a terminal dump.
- Hero: headline and subcopy on the left, the animated graphic on the right, both above the fold at 1920x1080; a short row of three proof numbers under the headline ($12,606.06 refund claimed, $18,319.32 a year, 1 approval).
- Clear type scale: big confident headline (tight tracking), readable 18px body, small caps labels. Generous spacing, a 12-column grid.
- Sections below: each with one idea, one graphic, short copy. Cut anything that repeats.

**Graphics and animation** (SVG plus CSS or small client code; use a motion library only if one is already installed). Real data from the recorded run in every graphic:
1. Hero graphic: the agents as connected nodes (Collector, Auditor, Approver, Negotiator, Finance) with a pulse travelling along the edges as each one works; the active node expands into a small card showing what it is doing (the real lines you already have).
2. A kWh chart that draws itself: billed versus meter readings for Fremont, the two lines splitting at the September 2025 meter change, the gap shaded amber, the overcharge labelled.
3. The call: an animated audio waveform while the transcript lines appear.
4. The money: a counter that rolls up to $12,606.06 and a stacked bar that fills into "You keep $21,647.77" versus "Clawback's fee $9,277.61".
- Motion is smooth (ease-out, 200 to 600 ms), sequenced, and plays only when on screen. prefers-reduced-motion shows the finished state.

**Bar to clear:** compare your screenshots against Linear, Ramp, Mercury and Vercel landing pages for polish (do not copy them). Run the hallmark audit. Ship frames at 1920x1080 (hero at 3 moments, plus each section) and 390x844.

## Design study (2026-11-07)

Human, verbatim: "see all the AI platform landing page and learn from it to make a really professional landing page and also improving our product page." The study is `docs/plan/design-study.md` (13 reference sites; screenshots in the orchestrator's scratchpad `refs/`, not committed). **Where it conflicts with "Design pass 2" above, the study wins:** one neutral ground plus one accent (money green) used only on the main button and money, `alert` red only for wrong bill numbers; no glows on cards, no glass; the hero is the headline first, then a large framed app screen with the agent log streaming inside it; graphics and animation live inside the frame and the bento cards (the kWh chart draws itself, the call waveform, the counter rolls up), restrained, and every frame looks finished at t=0.

### `product-polish`

**Goal:** Apply the study's "In-app pages" section 1 to 8 to the signed-in app: Linear/Harvey-style sidebar shell, Mercury-style Overview money tiles with the approval card as the one loud element, Ramp/Stripe-style Bills table with filter chips, Linear-style Findings list and evidence drawer with an activity timeline, Mercury-style Money page with one area chart and claimed versus granted shown differently, a calm Agents screen with run-stat chips. Use the `hallmark` skill; follow `docs/plan/design.md` and update it.

**Hard rules:** `/agents` stays the stage screen: readable at 1920x1080 with the 22 px floor and no page scroll; every `data-testid` and panel behaviour stays; `scripts/rehearse-stage.ts` (sim), `replay-check.ts`, `dashboard-shell-check.ts`, `panels-*-check.ts`, `savings-views-check.ts` and the sign-up checks pass. Numbers come from ledger rows only. No landing page files (owned by `landing-live`).

**Estimate:** 2.5 hours

**Acceptance checks:**
- Screenshots of every app page at 1920x1080 after one sim run, plus the evidence drawer open and the approval-pending Overview, in `.fleet-lane/`.
- All the checks above, `pnpm test`, lint and typecheck pass; one `rehearse-stage.ts` sim run passes with the same three numbers.

**Likely files:** `apps/dashboard/app/(app)/`, `apps/dashboard/components/`, `docs/plan/design.md`

**depends on:** savings-views, signup-connect

**parallel with:** landing-live, naive-rehearsal
## New colour theme (human, 2026-11-07, from a screenshot; overrides earlier colour guidance in design-study.md and Design pass 2)

| Role | Name | Hex |
|---|---|---|
| Background | Near black | #0B0F14 |
| Cards / panels | Dark slate | #141A21 |
| Borders | Steel | #263040 |
| Main text | Soft white | #E8EDF2 |
| Muted text | Gray blue | #8A96A6 |
| Accent: savings, buttons, logo | Electric lime | #C6F432 |
| Agent activity / links | Voltage blue | #3BA7FF |
| Overcharges / errors | Coral red | #FF5C5C |
| Warnings / pending approval | Amber | #FFB547 |

Orchestrator decisions:
- Applies to the whole product: landing page and every in-app page. Dark is the only theme; drop the light palette and the prefers-color-scheme switch.
- Map onto the existing token names in apps/dashboard/app/globals.css (paper=#0B0F14, sheet=#141A21, line=#263040, ink=#E8EDF2, faded=#8A96A6, money and action=#C6F432 with near-black #0B0F14 text on lime, alert=#FF5C5C, a new warn/pending token=#FFB547, a new agent/link token=#3BA7FF; band tokens collapse onto these). Kwh chart: billed line coral, meter line voltage blue, gap shaded amber.
- Each colour keeps one meaning: lime = money and the primary button only, blue = agents working and links, coral = wrong numbers and errors, amber = pending approval and warnings. No other hues; no hard-coded hex outside globals.css.
- Check text contrast ≥ 4.5:1 for body and labels (muted #8A96A6 on #141A21 included) and fix by token, not per component. Update docs/plan/design.md with this table.

### `landing-pages`

**Goal:** Four public pages linked from the landing nav and footer: Pricing, Market, Why Clawback (how we differ from current players) and How it works. Human, 2026-11-07: "add more detailed pages about pricing, our market size, how we are different from all the current players and how it work with good motion design and illustrations."

Orchestrator decisions:
- Routes `/pricing`, `/market`, `/compare`, `/how-it-works`, sharing the landing's nav, footer, tokens and the new dark colour theme. Reuse the landing's components and motion helpers; the hero and bento stay on `/`.
- **Pricing:** 30% of what is actually recovered (refund plus first-year savings), nothing up front, nothing if nothing comes back. A worked example from the recorded run ($12,606.06 refund, $18,319.32 a year, fee $9,277.61, you keep $21,647.77) with the stacked-bar animation, a "what counts / what doesn't" list (claimed is not granted; fee is charged only on granted money), and an FAQ. No invented plans or tiers.
- **Market:** the TAM already on the landing (about $500B+ of US business utility and telecom spend, 1–3% recoverable, $5–16B a year, about $1.6–4.9B revenue at 30%), with how each number is derived and its sources, as a drawn funnel or nested-area graphic. Mark estimates as estimates.
- **Why Clawback:** research the current players from their public pages and cite each claim with a link in the page or in `docs/plan/competitors.md`: utility and telecom bill auditors on contingency, energy and telecom expense management software (for example Tangoe, Calero, Urjanet/Arcadia, EnergyCAP, Cass), consumer bill negotiators (for example Rocket Money, BillShark, Trim) and manual consultants. Verify each one exists and what it does before naming it. Compare on who it serves, who does the work, how it's priced, whether it calls the provider and files the claim, and time to first refund. Fair and factual: no logos, no claims about them we can't link, no "10x" style figures.
- **How it works:** the five agents step by step (Collector, Auditor, Approver, Negotiator, Finance) with the human's one approval, each step an illustration plus real data from the recorded run; scroll-driven sequence (agent graph lights up, bill → finding → call waveform → ledger).
- **Illustrations and motion:** hand-built SVG and CSS in the theme colours (lime money, blue agents, coral wrong numbers, amber pending), no stock art, no AI images, no emoji. Motion ease-out, 200–600 ms, plays when on screen, finished state under prefers-reduced-motion. Every page looks complete at t=0.
- Run the Hallmark slop test and the design study's anti-patterns list on each page.

**Acceptance checks:**
- Four routes render with no console errors and link from the landing nav and footer.
- Screenshots at 1920x1080, 390x844 and 320x640 per page, no sideways scroll, reduced-motion frames.
- Every competitor claim has a source link; every figure comes from the recorded run, the TAM derivation, or is labelled an estimate.
- `pnpm test`, lint, typecheck pass.

**Estimate:** 2.5 hours

**depends on:** landing-live

**parallel with:** product-polish, naive-runtime-cost

### `demo-video`

**Goal:** A 2:00 demo video for the hackathon submission, recorded from one real live run, edited in Remotion with zooms, cursor, callouts and captions, under the human's own voiceover. Research: `docs/plan/demo-video.md` (read it first; this section overrides it).

Orchestrator decisions:
- **One live run, approved by the human on 2026-11-07 in the terminal: "yes, plan one live run for the video".** Real Retell and Vapi call, expected about $0.23 Retell plus $0.17 Vapi plus about $0.40 Claude. Only one. Before dialing, ask the orchestrator in `questions.md` and wait for "go" (the orchestrator checks the credit floor: keep at least $3 Retell and $2 Vapi). If the take fails, stop and ask; never redial on your own. Allowlisted numbers only.
- Not replay: no REPLAY banner, Linda taps Approve on screen. Follow the stage script in `docs/plan/rehearsal-notes.md` (sign up Mission Dumplings, upload the sample bill, Linda approves, /agents, end on Overview).
- **Call audio:** after the run, fetch the call's recording from Retell (or Vapi) with a read-only API GET (free) and use it as the call audio. Never use the Mac's built-in speech. Keys stay in `.env`, never printed.
- **Capture:** CDP `Page.startScreencast` at 1920x1080 (deviceScaleFactor 2), ffmpeg to a constant 60 fps ProRes master, browser muted; log `events.json` with `{t, kind, box}` for every step and click (approve button, finding, refund figure `overview-refund`, call panel). Footage and audio go in a gitignored `video/out/`; keep the master outside git.
- **Edit:** `video/` folder at the repo root, outside the pnpm workspace (`pnpm install --ignore-workspace`), Remotion pinned to 4.0.528. About 6 scenes in about 1:50: problem (landing hero), sign-up and upload, agents at work, the call (real audio and transcript, sped up only if labelled), approval, money on Overview, close. `ZoomTo` driven by `events.json` (spring scale plus translate), drawn cursor, ring and count-up on $12,606.06, short title cards in the dark theme fonts and colours. Hard cap 3,600 frames at 30 fps.
- **Voiceover:** script in `docs/plan/voiceover.md` (update figures if the live take differs). Render a silent rough cut with a scene timeline for the human to read against, then re-time scenes to their recording (`video/in/voiceover.wav`, supplied by the human). Captions from the voiceover via whisper.cpp only if time allows.
- **Render:** H.264 CRF 16 for upload plus a ProRes HQ master; check for banding on the dark background (add light grain if needed).
- Check before recording that the sample-bill upload uses the parse cache; if it would call a paid model, ask first.

**Acceptance checks:**
- One live run recorded end to end, with its cost (Retell, Vapi, Claude) written in `docs/plan/rehearsal-notes.md`.
- Silent rough cut and timeline handed to the human; final render at 1920x1080, at most 2:00, real call audio, no Mac speech, no replay label.
- No product code changes; `video/` is not part of the workspace and nothing in `video/out/` is committed.

**Estimate:** 3 hours plus the human's voiceover

**depends on:** product-polish (final look on screen)

**parallel with:** landing-pages, naive-runtime-cost
