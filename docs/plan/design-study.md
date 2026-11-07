# Clawback design study: what the best AI and fintech pages do

Sources: 13 landing pages captured at 1440x900 on 2026-11-07 (first screen plus two scroll steps each), in `scratchpad/refs/`: linear, vercel, ramp, mercury, stripe, anthropic, sierra, decagon, harvey, cognition, attio, raycast, lovable. Ours: `ours-1/2/3.png`, `ours-settled.png` (hero after its animation ends), `ours-full.png`. The in-app pages at :3000 redirect to /login, so the in-app advice comes from what Linear, Ramp, Mercury, Harvey and Stripe show of their own apps on their marketing pages.

## Honest read of ours (127.0.0.1:3020)

It is not slop in content. The copy is specific (Fremont meter, BayTel, $12,606.06), there are no purple gradients and no emoji, and the "Follow one overcharge" strip and the fee table are good ideas. It looks amateur for five reasons:

1. **The first screen is a log, not a product.** The hero is a monospace agent log in a box. For the first 4 seconds the right half is an empty panel labelled "Yearly savings found" (see `ours-1.png`). The headline sits at y=650, under the log, so the first thing people read is `downloading bills and usage`.
2. **No chrome that says "real company".** The nav is a logo plus two buttons, with no product links. The footer is one line. There is no proof band (logos, a quote, or a "$X recovered" counter).
3. **Monospace carries too much.** Big mono at 20px+ reads as a dev terminal, not as finance software.
4. **One rhythm, repeated.** Dark band, light band, dark band, light band. Every section is a left H2, a small paragraph, then content in a 4- or 2-column grid of the same width. Nothing breaks the grid or bleeds off the edge, and no section is a big visual.
5. **Product cards are tiny.** The four screens in "Follow one overcharge" are about 300px wide each, with 13px text and no frame, so they read as stickers. Nobody can see the product.

## Patterns from the best pages

**Hero structure.** The headline comes first, top-left, then one line of subcopy, then 1 or 2 CTAs, then a large product frame that starts above the fold and gets cut off by it (Linear, Harvey, Attio, Ramp). Harvey splits it: a 2-line headline on the left, subcopy and CTA in the right column on the same baseline, then a full-width app frame. Linear puts a small "New: Loops →" link at the right end of the subcopy line. Ramp and Stripe put a live ticking metric above the headline as an eyebrow ("Global GDP running on Stripe: 1.74575182%", "US corporate payments processed by Ramp: 0.97366%").

**Type.** The headline is 64 to 80px, weight 500 to 600 (not 800), with tight tracking (about -0.03em) and line-height about 1.0 (Linear, Decagon, Ramp, Attio). Vercel goes even lighter, at weight 400. A second-sentence trick appears on Linear, Stripe, Ramp and Attio: the first clause is in ink and the rest of the sentence continues in mid-grey at the same size ("A new species of product tool. *Purpose-built for…*"). Section intros use it as one large paragraph at about 40 to 48px, which replaces the H2-plus-paragraph pair. Body text is 16 to 18px. Mono appears only for tiny uppercase labels at 11px with wide tracking ("POWERING THE COMPANIES…", "FIG 0.1", Ramp's "AGENTS AT WORK TODAY:"). Harvey and Anthropic pair a serif display face with a sans, which is the closest match to our Source Serif for money figures.

**Colour.** Use one neutral ground plus one accent, used rarely. Linear is near-black with grey text, and the only colour is in the product UI. Ramp is white, ink and one acid yellow on a single CTA. Harvey is off-white `#f8f7f5`, black, and a textured slate-green panel behind the app. Sierra is white, grey and one deep green button, which is the closest palette to ours. The accent goes on the primary CTA and on money, never on headings. Dark pages (Linear, Raycast) use about 4 grey steps for text, not 2.

**Spacing rhythm.** 120 to 160px between sections, a 1280 to 1360px content width, and a 12-column grid. Text blocks stay at 6 to 7 columns while visuals run full width or bleed (Linear's app frame reaches the edge, and the cards in Ramp's bento grid crop the UI off their own right edge).

**Showing the product.** This is the biggest gap. Every top page shows a **large, real, framed app screen**:
- Linear: a full app window (sidebar, issue, agent chat) in a 1px `#ffffff14` border with a radial grey glow under it, cut off by the fold.
- Harvey: the app on a textured colour panel with rounded corners and generous padding (the "framed on a canvas" look).
- Attio: a window with traffic lights over a faint blue grid wash, with the agent "Thinking" live inside it.
- Mercury: their dashboard (balance chart, account tiles) on a laptop in a photo.
- Stripe and Ramp bento grids: each card has a title top-left (ink clause plus grey clause), and the bottom 70% is a cropped piece of real UI (a checkout, a draft invoice, a usage meter) that bleeds off the card edge, with an arrow button top-right.

**Motion.** This is restrained. Live counters tick (Ramp's "Agents at work today" marquee, Stripe's GDP %). UI inside the frame types or streams (Attio's "Thinking", Linear's agent panel). Logos scroll in a marquee. Nothing flies in and nothing bounces. The hero never starts empty: frames render complete, then animate.

**Section types, in the order they usually appear.** Thin announcement bar (Ramp, Harvey, Mercury, Attio, Decagon) → nav → hero with product frame → logo bar or counter strip → big two-tone statement paragraph → bento grid of product crops (Stripe, Ramp) → a feature section with tabs or numbered figures (Linear "FIG 0.1/0.2/0.3", Decagon tabs with a green progress underline) → customer quote or story carousel (Decagon) → CTA band → large multi-column footer.

**Nav and footer.** The nav has 4 to 6 text links at 14 to 15px in grey, sign-in as a ghost or text button, and one filled CTA. It is sticky and gets a blurred background on scroll (Linear, Ramp). Raycast floats the nav as a rounded bar. Footers are 4 to 5 columns of links with a small legal line (Mercury puts its "not a bank" disclosure in a pill, which is a good model for our "demo data" note).

## Landing page: changes ranked by impact

1. **Replace the log hero with a framed product screen.** Put the headline first (top-left, 72px, weight 600, -0.03em). Below it put a full-width app frame (sidebar: Overview, Bills, Findings, Money, Agents) showing the Overview with the $12,606.06 finding and the approval card. The agent log runs *inside* the frame as a right-hand "Agents" panel, the way Linear's agent chat does. The frame gets a 1px line border, 12px radius, and sits on a tinted `money-soft` or textured panel (Harvey) or a soft radial glow (Linear). Let it run past the fold. Render it complete on load, then animate the log lines. No empty panel, ever.
2. **Add a counter strip under the hero** (Ramp, Stripe): a mono 11px uppercase label, "RECOVERED FOR THE NOODLE SHOP THIS AUDIT:", then tabular figures in chips: $12,606.06 refunds · 14 bills read · 7 unused lines · 1 approval · 4 min 28 s. Mark it as demo data. It replaces a logo bar we don't have.
3. **Turn "Follow one overcharge" into a bento grid** (Stripe, Ramp): 2 large cards on top (Bills table with the doubled kWh in alert red, and Finding with evidence), then 3 smaller cards below (Call transcript, Approval by SMS, Ledger). Each card has a two-tone title ("**It reads every bill.** Next to the meter's own readings.") and a UI crop that bleeds off the bottom or right edge, at real app scale (14px text, not 13px stickers).
4. **Use the two-tone statement paragraph** in place of H2 plus paragraph for section intros, at 40 to 44px, ink then `faded` (Linear, Stripe, Attio). "Your bills are wrong. *Clawback reads every utility and phone bill, finds the overcharges, calls the provider and files the claim. You approve once.*"
5. **Give the nav and footer real weight.** Nav: How it works, Pricing, Security, Demo, with Log in as text and Start my audit filled. Make it sticky with a blurred background. Footer: 4 columns (Product, Company, Legal, Contact), with the demo-data disclosure in a Mercury-style pill. Optionally add a thin announcement bar: "Watch the agents audit a noodle shop's bills in 4 minutes →".
6. **Demote monospace.** Keep it only for 11px uppercase labels and figure-captions ("FIG 1 · BILLS"). Set the log lines in the sans at 15px, with the agent name in ink and the action in `faded`.
7. **Break the band rhythm.** One dark section at most (the hero, or the market stat section, not both). Make the rest off-white `paper`, with about 140px between sections. Keep "The market" giant serif figures, which are already the best thing on the page.
8. **End with a CTA band.** Full-width `band` colour, one 48px line ("You only pay from what comes back."), one button. This replaces the plain closing section.

## In-app pages: changes drawn from Linear, Ramp, Mercury, Stripe and Harvey

1. **App shell like Linear and Harvey.** A 240px left sidebar on a surface one step darker or lighter than the content (`paper` versus `sheet`), with 14px items, an icon and label, and the active item as a filled 6px-radius pill. Use a top bar inside the content area only, with page title, a breadcrumb ("Golden Gate Noodle Co. / Findings"), and actions on the right. No full-width coloured header.
2. **Overview tiles like Mercury and Harvey.** One hero tile: "Money back" at 40px Source Serif tabular, a "+$12,606.06 this audit" delta in money green, and a small area or bar sparkline below. The secondary tiles are smaller (24px figure, 12px grey label), all in one grid with 1px borders and no shadows. Mercury's pattern is a big balance card on the left and a list card of accounts with right-aligned figures on the right. Use it for "Refund claimed / Projected savings / Fee / You keep".
3. **Approval card as the one loud element.** This is the only card with an accent border or `alert` left rule, a title like "1 approval needed", the money figure, and two buttons. Linear keeps its UI grey and lets one thing carry colour, and the approval is that thing.
4. **Bills table like Ramp and Stripe.** 40px rows, 13 to 14px text, hairline row dividers and no zebra stripes, sticky header in 12px grey, figures right-aligned with tabular nums. Status is a small dot plus a word ("Overcharged" in alert, "OK" in faded), not a filled badge. The row hover fill is the `paper` tint. Add a filter chip row above the table (Provider, Store, Status) the way Ramp's Admin does.
5. **Findings list plus evidence drawer like Linear's issue view.** On the left, a list with a 1-line title, an amount, and a rule chip. Clicking opens a right drawer at about 480px with a header (title plus $ figure), sections for Evidence (the bills-versus-meter mini table with the doubled cells in alert), Rule (Electric Rule 17.1 quoted in a grey block), and Activity (a timeline of agent actions with 12px timestamps, as in Linear's "Activity" feed). Use J/K navigation and the "1 / 14" counter at the top right, as Linear does.
6. **Money and ledger like Mercury.** A balance-style header figure with a period selector ("Last 12 months"), one area chart in money green with a light fill and no gridlines except the baseline, then a ledger table where status is Claimed, Granted or Paid. Show the claimed-but-not-granted amount in `faded` and the granted amount in money green, so the honesty rule is visible.
7. **Live agents screen like Linear's agent panel and Attio's run card.** Each agent is a row with a status dot (pulsing only while working), a name, its current action in grey, and the elapsed time on the right. A detail pane streams the transcript. Add small run-stat chips ("1 in progress · 2 s avg run · 7 credits") as Attio does. Keep it calm: no spinners on everything, and one live element at a time.
8. **Density and type in the app.** 14px base, 12px labels, page titles at 20 to 24px weight 600, money in Source Serif only. Use 1px `line` borders instead of shadows, an 8 to 10px radius on cards, and 24px card padding. The app should look denser and quieter than the landing page.

## Anti-patterns to avoid

- Purple or blue-to-pink mesh gradients as the hero (Lovable, Stripe and Raycast can pull it off with a bespoke brand; for us it is pure slop). Our green is already distinctive.
- A centred headline over a row of three icon cards with "Fast / Secure / Smart" labels. Even Linear's three-column row uses custom line drawings and "FIG" labels, not icons.
- Emoji in UI or copy (Ramp's chat bubbles get away with it inside a mock product; we shouldn't).
- Vague copy: "AI-powered", "supercharge", "seamless", "unlock savings". Keep our specific figures and names. Specific copy is the one thing we already do better than most of these sites.
- Glassmorphism, glow on every card, drop shadows stacked on borders, gradient text.
- A hero that starts empty or mid-animation. Every frame must look finished at t=0.
- Fake logos or fake testimonials. If there is no proof, use the demo counter strip and say it is demo data.
- More than one accent colour, or the accent on headings.
