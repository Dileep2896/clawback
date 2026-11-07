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

## Motion

Only motion that shows a change: the meter drums rolling, a board card arriving. Both are off under `prefers-reduced-motion`. No entrance animations on product pages.

## Copy

Plain words from the owner's side: "Money recovered", "You keep", "Approval needed". Buttons name the action. Empty states say what will show up and what to do. Every screen that shows demo data says "Demo data".
