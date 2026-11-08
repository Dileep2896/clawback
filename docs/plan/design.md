# Clawback design

Written by `product-shell`, 2026-11-07. Every Clawback screen follows this. Tokens live in `apps/dashboard/app/globals.css`; components live in `apps/dashboard/components/ui/`.

## Direction

Clawback reads a small business's utility and phone bills, finds what it was overcharged, and gets the money back. The customer is an owner, not an analyst: they want one number (what they got back) and one decision (approve). So the product looks like a calm, trustworthy statement of account, not a control room.

- **Dark only.** Near-black page, dark slate surfaces, soft white text (human theme, 2026-11-07). No light theme, no toggle.
- **One hue, one meaning.** Lime: money that is yours and the primary button. Blue: agents working and links (also the focus ring and the current nav item). Coral: wrong numbers on a bill and errors. Amber: pending approval and warnings (the dot on the sandbox pill). No other hues, and no hex outside `globals.css`.
- **Money is set in a serif.** Every money figure that matters uses Source Serif 4 with lining tabular figures, like a printed statement. That is the one memorable thing; everything else stays quiet.
- **Hairlines, not shadows.** Surfaces are separated by a 1 px line and the page colour. No drop shadows, no gradients.

## Colour

| Role | Name | Hex | Token |
|---|---|---|---|
| Background | Near black | `#0B0F14` | `paper`; also `action-text`, `agent-text`, `alert-text`, `warn-text` |
| Cards / panels | Dark slate | `#141A21` | `sheet` |
| Borders | Steel | `#263040` | `line` (borders only, never text) |
| Main text | Soft white | `#E8EDF2` | `ink` |
| Muted text | Gray blue | `#8A96A6` | `faded` |
| Accent: savings, buttons, logo | Electric lime | `#C6F432` | `money`, `action` |
| Agent activity / links | Voltage blue | `#3BA7FF` | `agent` |
| Overcharges / errors | Coral red | `#FF5C5C` | `alert` |
| Warnings / pending approval | Amber | `#FFB547` | `warn` |

Text on a filled colour (lime button) is near black. kWh charts: billed in coral, meter in blue, the overcharge gap shaded amber.

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

**Signed-in app pages** (Overview, Bills, Findings, Agents, Money, onboarding, sign-up and log in). The human's ruling (`agents-redesign`, 2026-11-07): a modern AI app in the Linear, Vercel, Attio and Claude.ai mould. Tokens in `globals.css` (`text-caption` … `text-hero`).

| Role | Token | Size / line height | Weight |
|---|---|---|---|
| Captions, table heads, chips under labels, the sandbox pill | `text-caption` | 12 / 16 | 400 |
| Secondary text and labels (muted, never bold) | `text-label` | 13 / 18 | 400 |
| Body, table rows, sidebar items | `text-body` | 14 / 20 | 400 |
| Card and section titles | `text-title` | 15 / 20 | 600 |
| Page title (h1), the Now pane title, stat and statement figures | `text-page` | 20 / 28 | 600 |
| The page's one hero money figure (serif, marked `data-hero-figure`) | `text-hero` | 36 / 40 | 600 |

600 is only for titles and the active item. Nothing is above 20 px except the one hero figure per page ("You keep" on Overview and Money, "found" in the `/agents` run header). Nothing is under 12 px; the browser checks measure a 12 px floor and `scripts/app-shots.ts` flags anything off the scale.

Sentence case everywhere. No all-caps labels.

**`/agents`** is no longer a 22 px projector screen: the 22 px floor is dropped (orchestrator, 2026-11-07). Timeline agent names are 14 px at 600, their actions 13 px muted, the Now pane title 20 px.

## Space and shape

- Spacing steps: 4, 8, 12, 16, 24, 32, 48, 64 px (Tailwind 1, 2, 3, 4, 6, 8, 12, 16).
- **App shell** (Linear/Harvey): a 240 px left sidebar on `paper` with a hairline right border; content on `sheet`. Sidebar: wordmark, the company in 13 px grey, nav items with a 16 px line icon and a 400 label (600 when current), the active item a `sheet` pill with a 1 px `line` ring and 6 px radius; Demo data chip and Log out at the foot on every page, `/agents` included, which no longer has an icon rail (dark is the only theme, so there is no toggle). Under 1024 px it is a top bar with a scrolling nav row.
- **In-content top bar** (`PageHeader`): the company in 13 px grey, a 20 px title with the sandbox pill beside it on a replayed run, a one-line description, actions on the right, a hairline under it. No full-width coloured header.
- App pages: centred column up to 1440 px, 32 px side gutter (16 px under 640 px).
- Radii by hierarchy: 10 px for cards and panels (`rounded-card`), 8 px for buttons and inputs (`rounded-control`), 6 px for nav pills and chips, full for status pills.
- Cards: 1 px `line` border, 24 px padding, no shadows, no glows.
- `/agents`: full width on `paper`, 16 px gaps. At 1100 px and up it fills one screen with no page scroll: a 360 px timeline column and the Now pane, each scrolling inside itself; below that they stack.

## Components (`apps/dashboard/components/ui/`)

| Component | When |
|---|---|
| `Button` / `ButtonLink` | `primary` (lime fill, near-black text) for the one main action on a screen; `secondary` (outlined) for the rest; `ghost` for low-weight links in bars. The label says what happens: "Approve", "Start my audit". |
| `Card` | A surface grouping related content. Optional 15 px title. Don't nest cards. |
| `StatTile` | One money or count figure (20 px serif) with a label and optional note. `tone="money"` for customer money, `tone="plain"` otherwise. |
| `Table` | Bills, findings, ledger rows: 14 px rows about 44 px tall, 12 px grey header, hairline dividers, no zebra, `paper` hover tint, money right-aligned with `tabular-nums`. `grouped` takes one `<tbody>` per group with a group header row (Bills by location). |
| `StatusDot` | A status as a dot plus a word, never a filled badge. `alert` (coral) only for a wrong bill amount or an error; `money` (lime) for money confirmed or won; `agent` (blue) for agents at work on it; `plain` (grey) otherwise; `live` pulses blue only while a run works, and not under reduced motion. |
| `Chip` | A small outlined 13 px label, such as a finding's rule. Filter chips on Bills are the pressable version (`aria-pressed`, ink fill when on). |
| `EmptyState` | A page or card with nothing yet: say what will appear and give the one action that makes it appear. |
| `PageHeader` | The in-content top bar above. Pass `crumb` (the customer's name) and `replay` (`replayOf(run)`), which shows the sandbox pill. |
| `SandboxPill` (`components/sandbox-pill.tsx`) | The replay notice, never a banner: a 12 px outlined pill "Sandbox replay · 2×" with an amber dot, beside the run status or page title. Clicking it opens a native popover with the full sentence (recorded when, at what speed, times as recorded). |
| `AppNav` | The sidebar above, `nav[aria-label="Main"]`, current page marked with `aria-current="page"`. |

## App pages

Each page has one idea and one loud element at most.

- **Overview** (Mercury): the approval card is the only loud thing: a plain card with a full 1 px `warn` (amber) border, an amber "Needs you" dot, the action count and one large lime Approve. No side stripe. Below, two equal cards: "You keep" as the hero figure in lime serif with "+ refund claimed across all audits", a small staircase of money arriving, and a You keep versus fee bar; and "Your statement" with refund, yearly savings and fee at 20 px. A slim run strip (status dot, start time, decision, findings) closes the page.
- **Bills** (Ramp/Stripe): filter row (Provider chips, Store select, Status chips), one table grouped by location. Status is honest: "Overcharged" only for a bill a finding's evidence names as billed too much (meter or bill-math evidence); other bills on an account with a finding read "Finding on account"; the rest "OK".
- **Findings** (Linear): a table with site, title, rule chip, state and amounts; a row opens a 720 px side sheet with the counter "n / N", J and K (and arrow buttons) to move, the amount in lime serif, "Why it was flagged" in a grey quote block, the evidence sections, and an Activity timeline built only from rows that exist (actions, the approval, calls, ledger rows; untimed rows have no time). On `/agents` the same sheet opens from a finding, without the counter and timeline.
- **Money** (Mercury): "You keep" with an "All audits" period chip (the ledger is per customer) and one lime staircase area chart (baseline only, no gridlines); a Totals card; then the ledger, where claimed or due amounts are grey and confirmed amounts lime, so the honesty rule is visible; invoice and card payments side by side below.
- **Agents** (one story, `agents-redesign`): one run header line (status dot and word, elapsed, money found so far as the page's hero figure in lime serif counting up, "1 human action", run cost), then two columns. Left, a 360 px timeline: a CEO header, then every agent in run order (intake, collector, auditor, filer, approver, negotiator, finance, monitor last), each with a dot (blue pulsing = working, lime = done, amber = waiting on the human, coral = failed, hollow grey = up next), its name, its action in plain words over up to two lines, and its elapsed time. Right, the Now pane follows the run: the bills, the lead finding with its kWh chart and evidence, the amber approval card with Approve (and the texts thread under it on a local run; one line, "The request went by email.", otherwise), the call with a waveform and the transcript streaming, then the ledger. Picking an agent pins the pane to it; "Follow live" unpins. Under it, the audit log is collapsed ("Show the full log, N entries"), each row in plain words with the tool name in small mono. No empty "No … yet" panels, no board, no drums, no platform line.

## Landing page (`/`)

Rebuilt by `landing-live` design pass 2, 2026-11-07, from `docs/plan/design-study.md` (Landing 1 to 8). The landing uses the app's own tokens; the old `band` tokens are gone (the frame canvas is `paper` with a dot grid, the CTA band is `sheet`).

- **Colour:** the theme above. Lime only on the main button and on money; blue on the agent in progress and the call waveform; coral only for wrong bill numbers (the doubled kWh line); amber for the overcharge gap. No glows, no glass, no shadows: 1 px `line` borders.
- **Structure:** sticky blurred nav, one row at every width with no bottom rule (links to the detail pages: How it works, Pricing, Why Clawback, The market; Log in as text, Start my audit filled) → hero (72 px two-tone headline left, subcopy and CTA right, Harvey split) → a large framed app screen on the dotted `paper` canvas, running past the fold (sidebar, Overview with money tiles, the meter finding with its kWh lines, the approval card with an amber status dot, and an Agents panel streaming the run) → counter strip (five demo-run figures in a hairline grid, marked demo data) → "How it works" bento (5 cards, Fig 1 to 5: bills, findings, calls, approval, ledger; each a two-tone title and a crop of the app's surface bleeding off the card's right and bottom edges) → the market (slate `sheet` band, giant serif figures) → pricing (stacked keep/fee bar plus the statement) → CTA band (`sheet`) → footer (two link columns plus the demo-data pill).
- **Type:** headline 72 px, weight 600, -0.03 em, two-tone (claim in ink, rest in `faded`); section intros are one 44 px two-tone sentence instead of h2 plus paragraph; body 18 px. Mono 12 px uppercase is for exactly two things: the figure captions (`Fig 1 · Bills`) and the counter strip label. Everything else, footer column heads included, is the sans. Inside the app frame and bento crops the text is app scale, 13 to 15 px: these depict the product, and the frame has a full-size screen-reader summary. Landing-only exception to the 16 px floor; the app pages keep it.
- **Width:** content up to 1320 px, 12-column grid, about 140 px between sections at desktop.
- **Detail pages** (`/how-it-works`, `/pricing`, `/compare`, `/market`, added by `landing-pages`): the same nav, CTA band and footer (`components/landing/chrome.tsx`), a mono caption plus 72 px two-tone headline, then their own figures: the six-agent graph that lights the step in view, the keep/fee bar and fee timing, a sourced comparison (sources in `docs/plan/competitors.md`), and the market as to-scale nested squares with its derivation. The landing's teasers link to them. `scripts/site-pages-check.ts` checks them signed out at 1920, 390 and 320 px.
- **Values** are the recorded demo run's (`components/landing/timeline.ts`, sourced from `data/replay/run.jsonl`); market figures are the landing-tam estimates with their source note.


## Motion

Only motion that shows a change. On `/agents`: the Now pane's content arrives with a 300 ms fade and 4 px rise when the moment changes, as do new call lines and ledger rows; the waveform moves only while the call is open; money found and the ledger totals count up over 600 ms. Under `prefers-reduced-motion` all of it shows its finished state. No entrance animations elsewhere in the product.

On the landing, every frame looks finished at t=0: the server renders the final state, and motion only replays it. The hero's Agents panel moves a cursor through the recorded run and streams the active entry's line (pauses off-screen, Pause button for WCAG 2.2.2, never changes size). Below the fold, things play once as they scroll into view, 300 to 600 ms ease-out: the kWh lines draw left to right, the call's waveform speaks for about 3 s while the transcript lines arrive, the refund rolls up, the keep/fee bar fills. An element already on screen at load never resets. Under `prefers-reduced-motion` (checked live, not only on load) everything shows its finished state.

## Copy

Plain words from the owner's side: "Money recovered", "You keep", "Approval needed". Buttons name the action. Empty states say what will show up and what to do. Every screen that shows demo data says "Demo data".
