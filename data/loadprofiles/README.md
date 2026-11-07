# Load profiles

`comstock-alameda-fsr.csv` is the base electricity shape for every demo store. `packages/db/src/seed/load-profile.ts` scales it per store and adds fixed-seed noise. It is the only load data the seed uses.

## Source

| | |
|---|---|
| Dataset | ComStock 2025 Release 2 (AMY 2018), baseline (upgrade 0) |
| Geography, building type | Alameda County, California (G0600010), full service restaurant |
| Models behind the aggregate | 145 |
| Path | `s3://oedi-data-lake/nrel-pds-building-stock/end-use-load-profiles-for-us-building-stock/2025/comstock_amy2018_release_2/timeseries_aggregates/by_county/upgrade=0/county=G0600010/up0-g0600010-fullservicerestaurant.csv` |
| Repository | https://doi.org/10.25984/1876417 |
| File version | ETag `7ed77e4ed5ad9f9e293565f03fe97a42`, last modified 2025-08-14, downloaded 2026-11-06 |

## Terms

**License:** CC-BY-4.0, per the release's `citation.txt`.

**Attribution, as NREL asks:** "Data includes information from the ComStock™ dataset developed by the National Renewable Energy Laboratory (NREL) with funding from the U.S. Department of Energy (DOE)."

**Citation:** National Renewable Energy Laboratory (NREL). (2025). ComStock 2025 Release 2 (AMY 2018) [Data set]. Open Energy Data Initiative (OEDI). https://doi.org/10.25984/1876417

**Disclaimer in the release README:** "This Data is provided for research purposes only, and Alliance has no obligation to update, confirm the accuracy of, or in any way maintain the Data." The data is provided as is. The project's owner accepted both the license and this disclaimer for this demo on 2026-11-06.

This file is derived data: the source's 35,040 rows averaged into a shape, as described below.

## The file

Columns are `month,day_type,slot,relative_kw`, with 12 months x weekday or weekend x 96 slots.

- `slot` is the start of the 15 minute interval on the Pacific wall clock: slot 48 starts at noon.
- `relative_kw` is `out.electricity.total.energy_consumption.kwh`, averaged, then divided by the largest average. It has no absolute scale.

Averaging removes day to day weather variation, and the generator's noise stands in for it. It also flattens peaks a little.

To regenerate, download the file above and run:

```
pnpm exec tsx packages/db/src/seed/extract-load-profile.ts <downloaded csv>
```

## Why this release

| Release | Decision |
|---|---|
| 2025 Release 2 | Used. The data lake's known issues list names it as the one to use for California. |
| 2025 Release 3 (the current one) | Not used. KI-006: service water heating was not modeled in any California building, and restaurants are among the hardest hit. |
| 2024 Release 2 | Not used. Superseded. |

**KI-025, California equipment loads overstated:** this release's `manifest.json` does not list it. The upstream page says "ComStock 2024 Release 2 and earlier", with the fix planned for releases "starting in mid/late 2025", and does not name the first fixed release. The data does not visibly show a fix: interior equipment still tops out at about 40% of annual peak here, against about 38% in 2024 Release 2. Treat it as not listed, and not proven gone. Only the shape is used, so scale is unaffected.

## Timestamps

Source labels are **period-ending, in EST, all year**, which is what the data lake guide says. The extractor converts them to interval start on Pacific wall clock. Reading them as local time would put load 3 hours off, across the 4 to 9pm peak. Checked against the data on 2026-11-06:

- **Exterior lights:** dark 10:30 to 20:00 on the labels on January 15, which fits Oakland's daylight plus 3 hours. Dark 08:00 to 22:15 on June 15, with no daylight saving jump.
- **Kitchen equipment:** half-rise and half-fall are 08:15 and 23:15 on the labels in January, 07:15 and 22:15 in July. Both are about 5:15am and 8:15pm Pacific, so the schedule follows wall clock.

## What the shape does not have

There is no lunch peak, only a plateau from about 11am to 4pm, and the raw load factor is 0.545. So `loadProfile` takes energy and a lunch rush as separate inputs.
