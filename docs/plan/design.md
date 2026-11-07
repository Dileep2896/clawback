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

Scale for product pages (landing, Overview, Bills, Findings, Money, sign-up). Nothing under 16 px.

| Role | Size / line height | Weight |
|---|---|---|
| Meta, table captions | 16 / 1.4 | 400 |
| Body | 18 / 1.5 | 400 |
| Lead, card title | 22 / 1.35 | 600 |
| Section heading (h2) | 28 / 1.2 | 600 |
| Page title (h1) | 40 / 1.1 | 700 |
| Stat figure (serif) | 48 / 1.05 | 600 |
| Hero figure (serif) | 72 to 88 / 1 | 600 |

Stat figures are at least 48 px so the room can read them from the back. Sentence case everywhere. No all-caps labels.

**`/agents` is the projector screen**: every word is 22 px or larger, checked by `scripts/dashboard-shell-check.ts` and the `panels-*-check.ts` scripts. The page wrapper sets 22 px body text; the top bar switches to 22 px there too.

## Space and shape

- Spacing steps: 4, 8, 12, 16, 24, 32, 48, 64 px (Tailwind 1, 2, 3, 4, 6, 8, 12, 16).
- Product pages: content left-aligned in a column up to 1200 px wide, 24 px side gutter (16 px under 640 px).
- Radii by hierarchy: 14 px for cards and panels (`rounded-card`), 8 px for buttons and inputs (`rounded-control`), full for badges and pills.
- Top bar: 56 px tall, white, hairline bottom border.
- `/agents`: full width, 12 px gaps, panels fill the rest of a 1080 px screen with no page scroll. If a panel gets tight, cut panel padding before text size.

## Components (`apps/dashboard/components/ui/`)

| Component | When |
|---|---|
| `Button` / `ButtonLink` | `primary` (green fill) for the one main action on a screen; `secondary` (outlined) for the rest; `ghost` for low-weight links in bars. The label says what happens: "Approve", "Start my audit". |
| `Card` | A surface grouping related content. Optional title. Don't nest cards. |
| `StatTile` | One money or count figure with a label and optional note. `tone="money"` for customer money (green serif), `tone="plain"` otherwise. |
| `Table` | Bills, findings, ledger rows. Money columns right-aligned with `tabular-nums`. |
| `EmptyState` | A page or card with nothing yet: say what will appear and give the one action that makes it appear. |
| `PageHeader` | h1 plus an optional one-line description and actions on the right. |
| `AppNav` | The signed-in top bar: Overview, Bills, Findings, Agents, Money. The current page is marked with `aria-current="page"` and a green underline. |

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
