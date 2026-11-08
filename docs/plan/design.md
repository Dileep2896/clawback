# Clawback design

Written by `product-shell`, 2026-11-07. Every Clawback screen follows this. Tokens live in `apps/dashboard/app/globals.css`; components live in `apps/dashboard/components/ui/`.

## Direction

Clawback reads a small business's utility and phone bills, finds what it was overcharged, and gets the money back. The customer is an owner, not an analyst: they want one number (what they got back) and one decision (approve). So the product looks like a calm, trustworthy statement of account, not a control room.

- **Light first.** Cool sage page, white surfaces, near-black ink. Dark theme is a toggle, never the default.
- **Green means money that is yours.** Recovered refunds, yearly savings, "you keep". Also the one primary action colour.
- **Crimson means it needs you or it went wrong.** Approval needed, a stopped run, the replay banner. Used sparingly so it always gets noticed.
- **Money is set in a serif.** Every money figure that matters uses Source Serif 4 with lining tabular figures, like a printed statement. That is the one memorable thing; everything else stays quiet.
- **Hairlines, not shadows.** Surfaces are separated by a 1 px line and the page colour. No drop shadows, no gradients.

## Colour

| Token | Light | Dark | Use |
|---|---|---|---|
| `paper` | `#edf1ee` | `#0e1613` | Page background |
| `sheet` | `#ffffff` | `#16211c` | Cards, panels, tables, top bar |
| `ink` | `#13201b` | `#e6eee9` | Text |
| `faded` | `#3c4a44` | `#a2b3aa` | Secondary text, labels, notes |
| `line` | `#d3dcd6` | `#2a3a33` | Borders and dividers only, never text |
| `money` | `#08573a` | `#6fd9a6` | Money figures that belong to the customer |
| `money-soft` | `#e5f3ea` | `#173a2a` | Background tint behind a money highlight |
| `action` / `action-text` | `#08573a` / `#ffffff` | `#4cc48c` / `#06140e` | Primary buttons, approved state, new-card flash |
| `alert` / `alert-text` | `#8e0c3e` / `#ffffff` | `#ff7ca8` / `#1a0710` | Needs you, errors, replay banner |
| `register` / `register-text` | `#13201b` / `#ffffff` | `#e6eee9` / `#0e1613` | The human-actions meter drums |
| `bar-billed`, `bar-real` | `#c2185b`, `#00889f` | `#e0528a`, `#2aa5b8` | kWh chart bars only |

`apps/dashboard/lib/contrast.test.ts` checks every text pair in both themes, and the light theme again for a projector in a lit room. Add a pair there when you add a text colour.

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
- **App shell** (Linear/Harvey): a 240 px left sidebar on `paper` with a hairline right border; content on `sheet`. Sidebar: wordmark, the company in 13 px grey, nav items with a 20 px line icon and label, the active item a `sheet` pill with a 1 px `line` ring and 6 px radius; Demo data chip, theme toggle and Log out at the foot. Under 1024 px it is a top bar with a scrolling nav row.
- **In-content top bar** (`PageHeader`): breadcrumb "Company / Page" in 16 px grey, 24 px title, one-line description, actions on the right, a hairline under it. No full-width coloured header.
- App pages: centred column up to 1440 px, 32 px side gutter (16 px under 640 px).
- Radii by hierarchy: 10 px for cards and panels (`rounded-card`), 8 px for buttons and inputs (`rounded-control`), 6 px for nav pills and chips, full for status pills.
- Cards: 1 px `line` border, 24 px padding (32 px on a hero tile), no shadows, no glows.
- `/agents`: full width on `paper`, 12 px gaps, panels fill the rest of a 1080 px screen with no page scroll. If a panel gets tight, cut panel padding before text size.

## Components (`apps/dashboard/components/ui/`)

| Component | When |
|---|---|
| `Button` / `ButtonLink` | `primary` (green fill) for the one main action on a screen; `secondary` (outlined) for the rest; `ghost` for low-weight links in bars. The label says what happens: "Approve", "Start my audit". |
| `Card` | A surface grouping related content. Optional 18 px title. Don't nest cards. |
| `StatTile` | One money or count figure (40 px serif) with a label and optional note. `tone="money"` for customer money, `tone="plain"` otherwise. |
| `Table` | Bills, findings, ledger rows: 15 px rows about 44 px tall, 13 px grey header, hairline dividers, no zebra, `paper` hover tint, money right-aligned with `tabular-nums`. `grouped` takes one `<tbody>` per group with a group header row (Bills by location). |
| `StatusDot` | A status as a dot plus a word, never a filled badge. `alert` only for a wrong bill amount; `money` for money moving or confirmed; `plain` (grey) otherwise; `live` pulses only while a run works, and not under reduced motion. |
| `Chip` | A small outlined 13 px label, such as a finding's rule. Filter chips on Bills are the pressable version (`aria-pressed`, ink fill when on). |
| `EmptyState` | A page or card with nothing yet: say what will appear and give the one action that makes it appear. |
| `PageHeader` | The in-content top bar above. Pass `crumb` (the customer's name). |
| `AppNav` | The sidebar above, `nav[aria-label="Main"]`, current page marked with `aria-current="page"`. |

## App pages

Each page has one idea and one loud element at most.

- **Overview** (Mercury): the approval card is the only loud thing, a 4 px `alert` left rule on a plain card with "Needs you", the action count and one large Approve. Below, two equal cards: "You keep" as the hero figure in green serif with "+ refund claimed this audit", a small staircase of money arriving, and a You keep versus fee bar; and "Your statement" with refund, yearly savings and fee at 40 px. A slim run strip (status dot, start time, decision, findings) closes the page.
- **Bills** (Ramp/Stripe): filter row (Provider chips, Store select, Status chips), one table grouped by location. Status is honest: "Overcharged" only for a bill a finding's evidence names as billed too much (meter or bill-math evidence); other bills on an account with a finding read "Finding on account"; the rest "OK".
- **Findings** (Linear): a table with site, title, rule chip, state and amounts; a row opens a 720 px side sheet with the counter "n / N", J and K (and arrow buttons) to move, the amount in green serif, "Why it was flagged" in a grey quote block, the evidence sections, and an Activity timeline built only from rows that exist (actions, the approval, calls, ledger rows; untimed rows have no time). The `/agents` projector drawer is the same component without the counter and timeline, unchanged at 22 px.
- **Money** (Mercury): "You keep" with a "This audit" period chip and one green staircase area chart (baseline only, no gridlines); a Totals card; then the ledger, where claimed or due amounts are grey and confirmed amounts green, so the honesty rule is visible; invoice and card payments side by side below.
- **Agents**: calm chrome only: panels on `paper`, run-stat chips ("31 steps", "10 findings") whose dot pulses only while the run works.

## Landing page (`/`)

Added by `landing-redesign`, 2026-11-07. The landing is the one page allowed a darker voice than the app; it still uses the wordmark, the money green, both fonts and the app's own surfaces.

- **Idea: an audited statement.** The hero is a page of the demo customer's bills with each wrong amount struck through in crimson, the corrected amount in green serif beside it, an auditor's note under it, and the refund at the foot. Real product imagery, not icons.
- **Two dark ink bands** (hero, market) alternate with the sage paper (the run, the result). The bands stay dark in both themes.
- **Narrative structure:** hero statement → "One audit of one noodle shop" (four stages in a row under heavy 4 px ink rules, each with the static screen the run produced: kWh table, finding, call transcript, approval and ledger row) → the market → what the owner stands to keep (a statement total under a heavy rule) → footer with the demo-data line.
- **Width:** up to 1320 px, wider than app pages, so the four stages sit in one row at 1920.
- **Values are the recorded demo run's** (`data/replay/run.jsonl`); market figures are the landing-tam estimates with their source note.

| Token | Light | Dark | Use |
|---|---|---|---|
| `band` | `#0f1a15` | `#070d0a` | Landing dark band background |
| `band-text` | `#eef4f0` | `#eef4f0` | Text on the band |
| `band-faded` | `#c3d1c9` | `#c3d1c9` | Secondary text on the band |
| `band-line` | `#2c3e35` | `#24352d` | Rules on the band, hover fill for band buttons |
| `band-money` | `#8be6b9` | `#8be6b9` | Money figures, primary button and focus ring on the band |

The band text pairs are in `lib/contrast.test.ts`, lit-room check included. On the band, `.band :focus-visible` switches the ring to `band-money`.

## Motion

Only motion that shows a change: the meter drums rolling, a board card arriving, and on the landing the auditor's strike drawing through each wrong amount once on load. All are off under `prefers-reduced-motion` (the strike is then already drawn). No entrance animations on product pages.

## Copy

Plain words from the owner's side: "Money recovered", "You keep", "Approval needed". Buttons name the action. Empty states say what will show up and what to do. Every screen that shows demo data says "Demo data".
