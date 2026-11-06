# Tariff data

PG&E rates for B-1, B-6, B-10 and B-19. `loadTariff` in `packages/core/src/tariff/load.ts` reads these files and needs no network or key.

- `urdb/`: raw OpenEI URDB records. Refresh with `pnpm exec tsx --env-file-if-exists=.env scripts/fetch-tariffs.ts`.
- `fallback/`: hand-built from the PG&E sheets, checked 2026-11-06. Every `Tariff` records its source.

## Which source is used

URDB is used only when it bills exactly like the fallback. Otherwise the fallback is used and the differences are logged. URDB grids are never patched.

As of 2026-11-06:

| Schedule | Variant | Source | Why |
|---|---|---|---|
| B-1 | Poly-phase | Fallback | URDB has super off-peak 9am to 2pm in Jan, Feb, Oct, Nov, Dec. The sheet says March to May only. |
| B-6 | Poly-phase | URDB | Agrees with the sheet. |
| B-10 | Secondary | Fallback | URDB has no 4 to 9pm peak on Oct, Nov, Dec weekdays. The sheet says every day. Its flat demand months also split at May and November. |
| B-19 | Secondary, voluntary | Fallback | Prices agree, but its flat demand months split at May 1 and November 1, not June 1 and October 1. The calculator keeps one max kW per period, so a bill across those dates would be split wrongly. |

The URDB `startdate` is 2026-03-27, while the sheets' rates took effect March 1, 2026. URDB records have no `latest_update`, so `updatedAt` comes from the last `revisions` entry.

**When PG&E publishes new rates:** refresh the cache, then update the fallback JSON from the new sheets. Until the fallback is updated, new URDB rates will disagree with it and the old fallback stays in use, with a logged warning.

## Sheets used

Downloaded 2026-11-06 from `https://www.pge.com/tariffs/assets/pdf/tariffbook/ELEC_SCHEDS_<schedule>.pdf`. All rate pages are Advice 7846-E, effective March 1, 2026.

| Schedule | Rate page |
|---|---|
| B-1 | Sheet 3, Cal. P.U.C. 61066-E |
| B-6 | Sheet 3, Cal. P.U.C. 61090-E |
| B-10 | Sheet 3, Cal. P.U.C. 61068-E |
| B-19 | Sheet 4, Cal. P.U.C. 61071-E |

## Left out on purpose

- **Variants:** single-phase, primary and transmission voltage, mandatory B-19, Option R and Option S, B1-ST. Mandatory B-19 costs $58.62824 a day against $11.36882, so an account over 499 kW would be mispriced. No demo account is that large.
- **Charges:** Peak Day Pricing charges and credits, the B-19 power factor adjustment, and taxes and fees outside the bundled rates. `Tariff` cannot represent them. The sheets default many small and medium customers to Peak Day Pricing, so a real bill could differ from our price.
- **History:** one current tariff per schedule prices every month, though bills go back to about July 2025 and these rates began March 1, 2026. The demo's bills, audit and savings still agree with each other.

## Eligibility: project.md section 8 against the sheets

The thresholds hold. What section 8 leaves out is below.

| Section 8 | Sheet | Difference |
|---|---|---|
| B-1 and B-6 under 75 kW | Not eligible with max demand of 75 kW or more for three consecutive months in the most recent twelve. Reviewed annually, and transitions happen at the November billing cycle. | Section 8 omits the 3 month test. B-6 has a grandfathered exemption (A-6 customers, or a letter by March 31, 2017). B-1 excludes power bought for EV charging. |
| B-10 under 500 kW | Transferred to B-19 or B-20 if demand exceeds 499 kW for three consecutive months. No minimum. | Section 8 omits the 3 month test. |
| B-19 voluntary under 500, mandatory above 499 | Mandatory if demand exceeded 499 kW for at least three consecutive months in the last 12. Voluntary under 500 kW. | Section 8 omits the 3 month test. After 12 months at or below 499 kW, PG&E moves the account to voluntary B-19 or another schedule. |
| B-20 mandatory above 999 | Applies if demand exceeded 999 kW for at least three consecutive months in the last 12 (Sheet 1, Cal. P.U.C. 57687-E, Advice 7202-E, effective March 8, 2024). | Section 8 omits the 3 month test. To stay on B-20, demand must exceed 999 kW in 5 of the last 12 billing months, or in 3 consecutive of the last 14. Below that, PG&E transfers the account. |

## Bills that span June 1 or October 1

| Schedule | Sheet wording | Result |
|---|---|---|
| B-19 | Sheet 15, section 6 (Advice 7116-E-B, effective January 1, 2024): "It will consider the applicable maximum demands for the summer and winter portions of the billing month separately, calculate a demand charge for each, and then apply the two according to the number of billing days each represents." | Each season uses its own max kW, weighted by billing days. |
| B-10 | Seasons section (Advice 6603-E-A, effective June 1, 2022): "When billing includes use in both the summer and winter periods, charges will be prorated based upon the number of days in each period." Basis for demand charge: "the highest 15-minute average in the month". | Prorates charges, but does not say whether max kW is split. |
| B-1, B-6 | Same proration sentence as B-10. | No demand charge, so this does not arise. |

The B-10 fallback has separate summer and winter flat demand periods, so the calculator applies the B-19 method to it. That is an inference from "charges will be prorated", not sheet wording. Real B-10 bills were not checked.
