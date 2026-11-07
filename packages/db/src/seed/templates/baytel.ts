import {
  billedTo,
  DEMO_MARK,
  dueDate,
  facts,
  lineTable,
  money,
  page,
  paymentStub,
  servicePeriod,
  statementDate,
  statementNumber,
  type Template,
  waysToPay,
} from "./common.ts";

export const NAME = "BayTel";

const CSS = `
body{display:grid;grid-template-columns:2.35in 1fr}
.side{background:#0f5c5c;color:#e6f3f2;padding:.45in .28in;min-height:11in}
.side svg{width:44pt;height:44pt;display:block;margin-bottom:6pt}
.side h1{font-size:21pt;line-height:1.1;color:#fff}
.side .tag{font-size:9pt;margin-bottom:.3in}
.side h2{font-size:8.5pt;letter-spacing:.08em;color:#a7d6d2;margin:.22in 0 4pt}
.side .due{font-size:21pt;font-weight:600;color:#fff;line-height:1.2}
.side .facts>div{display:block;padding:4pt 0;border-top:.5pt solid #3a8380}
.side .facts dt{font-size:8.5pt;color:#a7d6d2;font-weight:400}
.side .facts dd{text-align:left}
.side .demo-mark{margin-top:.3in;color:#fff}
.main{padding:.45in .45in 0;position:relative;height:11in}
.main h2{font-size:15pt;color:#0f5c5c;margin:.28in 0 8pt}
.lines th{background:#e3f0ef;color:#0f5c5c;font-size:9pt}
.lines tbody tr:nth-child(even) td{background:#f5f9f9}
.lines tfoot td{font-weight:600;font-size:12pt;border-top:2pt solid #0f5c5c}
.stub{position:absolute;left:.45in;right:.45in;bottom:.4in;border-top:1pt dashed #7b8791;padding-top:8pt}
.stub-row{gap:18pt}
.stub-row address{width:1.9in}
`;

export const baytel: Template = (view) =>
  page(
    `${NAME} statement ${statementNumber(view)}`,
    CSS,
    `<aside class="side">
<svg viewBox="0 0 44 44" aria-hidden="true"><rect x="2" y="2" width="40" height="40" rx="9" fill="none" stroke="#fff" stroke-width="2"/><path d="M9 30V14h7a4 4 0 0 1 0 8H9m7 0a4 4 0 0 1 0 8H9M25 14h11M30.5 14v16" fill="none" stroke="#fff" stroke-width="2.5"/></svg>
<h1>${NAME}</h1>
<p class="tag">Voice services for business</p>
<h2>TOTAL DUE</h2>
<p class="due">${money(view.bill.totalCents)}</p>
<p>Pay by ${dueDate(view)}</p>
<h2>YOUR ACCOUNT</h2>
${facts([
  ["Account number", view.account.accountNumber],
  ["Plan code", view.bill.planCode!],
  ["Statement number", statementNumber(view)],
  ["Statement date", statementDate(view)],
])}
${DEMO_MARK}
</aside>
<main class="main">
${billedTo(view)}
<h2>Services, ${servicePeriod(view)}</h2>
${lineTable(view, "Total monthly charges")}
${waysToPay("baytel.example", "(800) 555-0150", NAME)}
${paymentStub(view, [`${NAME} Remittance`, "PO Box 2280", "San Francisco, CA 94126"])}
</main>`,
  );
