import {
  billedTo,
  date,
  DEMO_MARK,
  dueDate,
  esc,
  facts,
  lineTable,
  money,
  page,
  paymentStub,
  quantity,
  servicePeriod,
  statementDate,
  statementNumber,
  type Template,
  waysToPay,
} from "./common.ts";

export const NAME = "BayCurrent Electric";

const CSS = `
.band{background:#12355b;color:#fff;padding:.4in .55in .3in;display:flex;justify-content:space-between;align-items:flex-start}
.brand{display:flex;align-items:center;gap:10pt}
.brand svg{width:34pt;height:34pt}
.brand h1{font-size:19pt;line-height:1.1}
.brand p{font-size:9pt;color:#bcd3ea}
.main{padding:.3in .55in 0}
.summary{display:grid;grid-template-columns:1fr 1fr;gap:.35in;margin-bottom:.22in}
.amount{background:#eef4fa;border-left:4pt solid #e39a23;padding:9pt 12pt;margin-top:10pt}
.amount strong{display:block;font-size:19pt;line-height:1.2;color:#12355b}
h2{font-size:10.5pt;color:#12355b;border-bottom:1.5pt solid #12355b;padding-bottom:3pt;margin:.18in 0 4pt}
.facts>div{border-bottom:.5pt solid #d8e0e8}
.usage{display:grid;grid-template-columns:1fr 1fr;gap:.35in}
.lines th{border-bottom:1pt solid #12355b;color:#12355b;font-size:9pt}
.lines tbody td{border-bottom:.5pt solid #d8e0e8}
.lines tfoot td{font-weight:600;font-size:11.5pt;color:#12355b;border-top:1.5pt solid #12355b}
.stub{position:absolute;left:.55in;right:.55in;bottom:.4in;border-top:1pt dashed #7b8791;padding-top:8pt}
`;

export const baycurrent: Template = (view) => {
  const { bill } = view;
  const totalKwh = bill.kwhByTouPeriod.reduce((sum, p) => sum + p.kwh, 0);
  return page(
    `${NAME} statement ${statementNumber(view)}`,
    CSS,
    `<header class="band">
<div class="brand">
<svg viewBox="0 0 40 40" aria-hidden="true"><circle cx="20" cy="20" r="19" fill="none" stroke="#e39a23" stroke-width="2"/><path d="M5 23c5-7 10-7 15 0s10 7 15 0" fill="none" stroke="#fff" stroke-width="3" stroke-linecap="round"/><path d="M5 15c5-7 10-7 15 0s10 7 15 0" fill="none" stroke="#e39a23" stroke-width="3" stroke-linecap="round"/></svg>
<div><h1>${NAME}</h1><p>Business electric statement</p></div>
</div>
${DEMO_MARK}
</header>
<main class="main">
<section class="summary">
<div>${billedTo(view)}
<div class="amount">Amount due by ${dueDate(view)}<strong>${money(bill.totalCents)}</strong></div></div>
${facts([
  ["Account number", view.account.accountNumber],
  ["Statement number", statementNumber(view)],
  ["Statement date", statementDate(view)],
  ["Service period", servicePeriod(view)],
])}
</section>
<section class="usage">
<div><h2>Meter details</h2>
${facts([
  ["Meter number", bill.meterNumber!],
  ["Meter multiplier", String(bill.multiplier!)],
  ["Rate schedule", bill.rateSchedule!],
  ["Maximum demand", `${quantity(bill.maxKw!)} kW`],
])}</div>
<div><h2>Billed usage by time of use</h2>
${facts([
  ...bill.kwhByTouPeriod.map(({ period, kwh }): [string, string] => [period, `${quantity(kwh)} kWh`]),
  ["Total billed usage", `${quantity(totalKwh)} kWh`],
])}</div>
</section>
<h2>Charges for ${esc(date(bill.periodStart))} to ${esc(date(bill.periodEnd))}</h2>
${lineTable(view, "Total current charges")}
${waysToPay("baycurrent.example", "(800) 555-0140", NAME)}
</main>
${paymentStub(view, [NAME, "PO Box 4100", "Oakland, CA 94604"])}`,
  );
};
