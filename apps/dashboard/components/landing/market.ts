// The market estimates (landing-tam, docs/plan/phases/13-product-ui.md) and how each one is worked out, with the sources
// checked in docs/plan/competitors.md ("Market sources"). Every figure here is an estimate; /market shows the derivation,
// the landing shows the two headline figures.

export const MARKET_TEASER = [
  { value: "$500B+", label: "US businesses pay every year in electricity, gas, water and phone bills" },
  { value: "$5 to 16B", label: "a year left on the table: 1 to 3% of it is billed wrong or on the wrong plan" },
];

/** The landing's one-line source note under the two figures. */
export const MARKET_NOTE =
  "Estimates. Electricity: US EIA, 2025 ($290B commercial and industrial). Phone and internet: Grand View Research, 2023 (the 42% business share of $468B). Gas: US EIA prices and volumes, 2025. We assume 1 to 3% is billed wrong.";

export type Source = { label: string; href: string };

/** What US businesses spend, line by line, in billions of dollars a year. */
export const SPEND: { label: string; billions: number; how: string; sources: Source[] }[] = [
  {
    label: "Electricity",
    billions: 290,
    how: "Commercial ($200.9B) and industrial ($89.4B) retail revenue, 2025.",
    sources: [{ label: "US EIA, Electric Power Monthly, table 5.2", href: "https://www.eia.gov/electricity/monthly/epm_table_grapher.php?t=epmt_5_02" }],
  },
  {
    label: "Phone and internet",
    billions: 197,
    how: "The US telecom services market was $468.08B in 2023, 58% of it consumers. Our estimate: the other 42% is business.",
    sources: [{ label: "Grand View Research, US telecom services market", href: "https://www.grandviewresearch.com/industry-analysis/us-telecom-services-market-report" }],
  },
  {
    label: "Natural gas",
    billions: 85,
    how: "Our estimate: 2025 commercial and industrial volumes times EIA’s average prices ($10.98 and $5.23 per thousand cubic feet).",
    sources: [
      { label: "US EIA, gas consumption by end use", href: "https://www.eia.gov/dnav/ng/ng_cons_sum_dcu_nus_a.htm" },
      { label: "US EIA, gas prices", href: "https://www.eia.gov/dnav/ng/ng_pri_sum_dcu_nus_a.htm" },
    ],
  },
];

/** Water is real spend but we found no national figure for it, so it is left out: the total errs low. */
export const SPEND_TOTAL = SPEND.reduce((sum, line) => sum + line.billions, 0);

/** The funnel, outermost first. */
export const FUNNEL: { value: string; label: string; how: string; sources: Source[] }[] = [
  {
    value: "$500B+",
    label: "US business utility and phone spend a year",
    how: `The three lines below add to about $${SPEND_TOTAL}B. We say $500B+ to stay under it.`,
    sources: [],
  },
  {
    value: "$5 to 16B",
    label: "billed wrong or on the wrong plan",
    how: "1% to 3% of that spend is our assumption, kept low on purpose. Published error rates run higher: Gartner, as cited by the UK government’s buying agency, puts telecom invoices with errors at up to 20%; a City of San Diego audit found 1.6% of water bills showing double the previous usage or more.",
    sources: [
      { label: "Crown Commercial Service, telecom audit white paper", href: "https://assets.crowncommercial.gov.uk/wp-content/uploads/RM3820-Telecoms-audit-white-paper-v.01.pdf" },
      { label: "San Diego City Auditor, 2018", href: "https://www.sandiego.gov/sites/default/files/19-003_pud_water_billing.pdf" },
    ],
  },
  { value: "$1.5 to 4.8B", label: "Clawback’s revenue at 30%", how: "30% of $5B to $16B, if every dollar were recovered. It won’t be: this is a ceiling, not a forecast.", sources: [] },
];
