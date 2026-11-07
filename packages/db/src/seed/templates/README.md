# Bill templates

One original layout per provider. Render all bills with `pnpm exec tsx packages/db/src/seed/bill-pdf.ts`, after `pnpm exec tsx packages/db/src/seed/generate.ts`.

## Byte stability

`bill-parser` keys its committed cache on each PDF's sha256, so the same bill must always produce the same bytes. Three things make that hold:

- `stabilizePdf` overwrites the wall-clock `/CreationDate` and `/ModDate`, and throws if Chromium changes that format.
- IBM Plex Sans (SIL OFL 1.1, `@fontsource/ibm-plex-sans`) is inlined, so installed fonts do not matter.
- The lockfile pins Playwright, which pins Chromium. Upgrading either can change every PDF's bytes, and `data/parsed/` then needs reparsing.

**Limit: tested on this Mac only. macOS to Linux is not verified.** Generate the bills on macOS for stage. Chromium's PDF output may differ on another OS.

## Rules for bills

- Meter and multiplier come from the bill, never the account. `account.meterNumber` is always the current meter, so using it would hide the Fremont #1 swap.
- Nothing on a bill may hint at an answer: no finding, savings or refund wording, no notes on price or meter changes, no call counts.
- Only fixture values and dates derived from them. Lines must sum to the total, so no invented balances, payments or taxes.
- The gas supplier's name comes from `GAS_SUPPLIER.name`.
- No real company's name, logo, design or text. Phone numbers use 555-01xx and sites use `.example`.
