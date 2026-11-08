# Clawback design

Written by `product-shell`, 2026-11-07. Every Clawback screen follows this. Tokens live in `apps/dashboard/app/globals.css`; components live in `apps/dashboard/components/ui/`.

## Direction

Clawback reads a small business's utility and phone bills, finds what it was overcharged, and gets the money back. The customer is an owner, not an analyst: they want one number (what they got back) and one decision (approve). So the product looks like a calm, trustworthy statement of account, not a control room.

- **Dark only.** Near-black page, dark slate surfaces, soft white text (human theme, 2026-11-07). No light theme, no toggle.
- **One hue, one meaning.** Lime: money that is yours and the primary button. Blue: agents working and links (also the focus ring and the current nav item). Coral: wrong numbers on a bill and errors. Amber: pending approval and warnings (the replay banner). No other hues, and no hex outside `globals.css`.
- **Money is set in a serif.** Every money figure that matters uses Source Serif 4 with lining tabular figures, like a printed statement. That is the one memorable thing; everything else stays quiet.
- **Hairlines, not shadows.** Surfaces are separated by a 1 px line and the page colour. No drop shadows, no gradients.

## Colour

| Role | Name | Hex | Token |
|---|---|---|---|
| Background | Near black | `#0B0F14` | `paper`; also `action-text`, `agent-text`, `alert-text`, `warn-text`, `register-text` |
| Cards / panels | Dark slate | `#141A21` | `sheet` |
| Borders | Steel | `#263040` | `line` (borders only, never text) |
| Main text | Soft white | `#E8EDF2` | `ink`; also `register` (the light meter drums) |
| Muted text | Gray blue | `#8A96A6` | `faded` |
| Accent: savings, buttons, logo | Electric lime | `#C6F432` | `money`, `action` |
| Agent activity / links | Voltage blue | `#3BA7FF` | `agent` |
| Overcharges / errors | Coral red | `#FF5C5C` | `alert` |
| Warnings / pending approval | Amber | `#FFB547` | `warn` |

Text on a filled colour (lime button, blue call row, coral or amber banner) is near black. kWh charts: billed in coral, meter in blue, the overcharge gap shaded amber.

`apps/dashboard/lib/contrast.test.ts` checks every text pair at 4.5:1 or better (the weakest, muted on slate, is about 5.8:1). Add a pair there when you add a text colour; fix contrast in the token, never per component.

## Type

Two families.

- **Atkinson Hyperlegible Next** (400, 600, 700): all interface text and headings. Chosen for legibility on a projector.
- **Source Serif 4** (600): money figures only, via the `font-figure` utility, always with `tabular-nums`.

Two scales. The app is denser and quieter than the landing (`product-polish`, 2026-11-07, after `docs/plan/design-study.md`).

**Landing and sign-up.** Nothing under 16 px.

| Role | Size / line height | Weight |
|---|---|---|
| Meta, table captions | 16 / 1.4 | 400 |
| Body | 18 / 1.5 | 400 |
| Lead, card title | 22 / 1.35 | 600 |
| Section heading (h2) | 28 / 1.2 | 600 |
| Page title (h1) | 40 / 1.1 | 700 |
| Stat figure (serif) | 48 / 1.05 | 600 |
| Hero figure (serif) | 72 to 88 / 1 | 600 |

**Signed-in app pages** (Overview, Bills, Findings, Money, onboarding). The human's ruling: tables at 15/13, the Overview at 16 px or more with money at 40 px or more, because the stage ends on it.

| Role | Size | Weight |
|---|---|---|
| Small labels: table headers, chips, sidebar company, timestamps | 13 | 600 (labels) / 400 |
| Table rows, sidebar items, drawer meta | 15 | 400 / 600 |
| Page body, Overview text, breadcrumb, card titles in grey | 16 | 400 / 600 |
| Card title (h2) | 18 | 600 |
| Page title (h1) | 24 | 600 |
| Overview statement figures (serif) | 40 | 600 |
| Hero figure, "You keep" (serif) | 56 to 72 | 600 |

Sentence case everywhere. No all-caps labels.

**`/agents` is the projector screen**: every word is 22 px or larger, checked by `scripts/dashboard-shell-check.ts` and the `panels-*-check.ts` scripts. The page wrapper sets 22 px body text, and the sidebar becomes a 64 px icon rail there (its hidden labels are set at 22 px too, because the check measures hidden text). The Demo data label moves into the `/agents` header on that page.

## Space and shape

- Spacing steps: 4, 8, 12, 16, 24, 32, 48, 64 px (Tailwind 1, 2, 3, 4, 6, 8, 12, 16).
- **App shell** (Linear/Harvey): a 240 px left sidebar on `paper` with a hairline right border; content on `sheet`. Sidebar: wordmark, the company in 13 px grey, nav items with a 20 px line icon and label, the active item a `sheet` pill with a 1 px `line` ring and 6 px radius; Demo data chip and Log out at the foot (dark is the only theme, so there is no toggle). Under 1024 px it is a top bar with a scrolling nav row.
- **In-content top bar** (`PageHeader`): breadcrumb "Company / Page" in 16 px grey, 24 px title, one-line description, actions on the right, a hairline under it. No full-width coloured header.
- App pages: centred column up to 1440 px, 32 px side gutter (16 px under 640 px).
- Radii by hierarchy: 10 px for cards and panels (`rounded-card`), 8 px for buttons and inputs (`rounded-control`), 6 px for nav pills and chips, full for status pills.
- Cards: 1 px `line` border, 24 px padding (32 px on a hero tile), no shadows, no glows.
- `/agents`: full width on `paper`, 12 px gaps, panels fill the rest of a 1080 px screen with no page scroll. If a panel gets tight, cut panel padding before text size.

## Components (`apps/dashboard/components/ui/`)

| Component | When |
|---|---|
| `Button` / `ButtonLink` | `primary` (lime fill, near-black text) for the one main action on a screen; `secondary` (outlined) for the rest; `ghost` for low-weight links in bars. The label says what happens: "Approve", "Start my audit". |
| `Card` | A surface grouping related content. Optional 18 px title. Don't nest cards. |
| `StatTile` | One money or count figure (40 px serif) with a label and optional note. `tone="money"` for customer money, `tone="plain"` otherwise. |
| `Table` | Bills, findings, ledger rows: 15 px rows about 44 px tall, 13 px grey header, hairline dividers, no zebra, `paper` hover tint, money right-aligned with `tabular-nums`. `grouped` takes one `<tbody>` per group with a group header row (Bills by location). |
| `StatusDot` | A status as a dot plus a word, never a filled badge. `alert` (coral) only for a wrong bill amount or an error; `money` (lime) for money confirmed or won; `agent` (blue) for agents at work on it; `plain` (grey) otherwise; `live` pulses blue only while a run works, and not under reduced motion. |
| `Chip` | A small outlined 13 px label, such as a finding's rule. Filter chips on Bills are the pressable version (`aria-pressed`, ink fill when on). |
| `EmptyState` | A page or card with nothing yet: say what will appear and give the one action that makes it appear. |
| `PageHeader` | The in-content top bar above. Pass `crumb` (the customer's name). |
| `AppNav` | The sidebar above, `nav[aria-label="Main"]`, current page marked with `aria-current="page"`. |

## App pages

Each page has one idea and one loud element at most.

- **Overview** (Mercury): the approval card is the only loud thing: a plain card with a full 1 px `warn` (amber) border, an amber "Needs you" dot, the action count and one large lime Approve. No side stripe. Below, two equal cards: "You keep" as the hero figure in lime serif with "+ refund claimed across all audits", a small staircase of money arriving, and a You keep versus fee bar; and "Your statement" with refund, yearly savings and fee at 40 px. A slim run strip (status dot, start time, decision, findings) closes the page.
- **Bills** (Ramp/Stripe): filter row (Provider chips, Store select, Status chips), one table grouped by location. Status is honest: "Overcharged" only for a bill a finding's evidence names as billed too much (meter or bill-math evidence); other bills on an account with a finding read "Finding on account"; the rest "OK".
- **Findings** (Linear): a table with site, title, rule chip, state and amounts; a row opens a 720 px side sheet with the counter "n / N", J and K (and arrow buttons) to move, the amount in lime serif, "Why it was flagged" in a grey quote block, the evidence sections, and an Activity timeline built only from rows that exist (actions, the approval, calls, ledger rows; untimed rows have no time). The `/agents` projector drawer is the same component without the counter and timeline, unchanged at 22 px.
- **Money** (Mercury): "You keep" with an "All audits" period chip (the ledger is per customer) and one lime staircase area chart (baseline only, no gridlines); a Totals card; then the ledger, where claimed or due amounts are grey and confirmed amounts lime, so the honesty rule is visible; invoice and card payments side by side below.
- **Agents** (Linear agent panel, Attio run card): panels on `paper`; run-stat chips ("47 steps", "16 findings") whose dot pulses blue only while the run works. An Agents panel shares the call's column: one row per agent in the order it first acted (status dot, name, current action, elapsed from its first to last recorded row), and a detail pane with the selected agent's newest tool calls. The pane follows the working agent until someone picks a row. Dots: blue pulsing = working, coral = blocked, hollow = queued, grey = done. The CEO and the run card have no row: they show on the Board.

## Landing page (`/`)

Rebuilt by `landing-live` design pass 2, 2026-11-07, from `docs/plan/design-study.md` (Landing 1 to 8). The landing uses the app's own tokens; the old `band` tokens are gone (the frame canvas is `paper` with a dot grid, the CTA band is `sheet`).

- **Colour:** the theme above. Lime only on the main button and on money; blue on the agent in progress and the call waveform; coral only for wrong bill numbers (the doubled kWh line); amber for the overcharge gap. No glows, no glass, no shadows: 1 px `line` borders.
- **Structure:** sticky blurred nav, one row at every width with no bottom rule (How it works, Pricing, The market; Log in as text, Start my audit filled) → hero (72 px two-tone headline left, subcopy and CTA right, Harvey split) → a large framed app screen on the dotted `paper` canvas, running past the fold (sidebar, Overview with money tiles, the meter finding with its kWh lines, the approval card with an amber status dot, and an Agents panel streaming the run) → counter strip (five demo-run figures in a hairline grid, marked demo data) → "How it works" bento (5 cards, Fig 1 to 5: bills, findings, calls, approval, ledger; each a two-tone title and a crop of the app's surface bleeding off the card's right and bottom edges) → the market (slate `sheet` band, giant serif figures) → pricing (stacked keep/fee bar plus the statement) → CTA band (`sheet`) → footer (two link columns plus the demo-data pill).
- **Type:** headline 72 px, weight 600, -0.03 em, two-tone (claim in ink, rest in `faded`); section intros are one 44 px two-tone sentence instead of h2 plus paragraph; body 18 px. Mono 12 px uppercase is for exactly two things: the figure captions (`Fig 1 · Bills`) and the counter strip label. Everything else, footer column heads included, is the sans. Inside the app frame and bento crops the text is app scale, 13 to 15 px: these depict the product, and the frame has a full-size screen-reader summary. Landing-only exception to the 16 px floor; the app pages keep it.
- **Width:** content up to 1320 px, 12-column grid, about 140 px between sections at desktop.
- **Values** are the recorded demo run's (`components/landing/timeline.ts`, sourced from `data/replay/run.jsonl`); market figures are the landing-tam estimates with their source note.


## Motion

Only motion that shows a change: the meter drums rolling, a board card arriving. No entrance animations on product pages.

On the landing, every frame looks finished at t=0: the server renders the final state, and motion only replays it. The hero's Agents panel moves a cursor through the recorded run and streams the active entry's line (pauses off-screen, Pause button for WCAG 2.2.2, never changes size). Below the fold, things play once as they scroll into view, 300 to 600 ms ease-out: the kWh lines draw left to right, the call's waveform speaks for about 3 s while the transcript lines arrive, the refund rolls up, the keep/fee bar fills. An element already on screen at load never resets. Under `prefers-reduced-motion` (checked live, not only on load) everything shows its finished state.

## Copy

Plain words from the owner's side: "Money recovered", "You keep", "Approval needed". Buttons name the action. Empty states say what will show up and what to do. Every screen that shows demo data says "Demo data".
