import { GAS_SUPPLIER } from "@bill-fighter/shared/fixtures";
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

const CSS = `
body{padding:.5in .7in;color:#2c2320}
.head{text-align:center;border-bottom:3pt double #9c3f1d;padding-bottom:.14in}
.head svg{width:32pt;height:32pt}
.head h1{font-size:20pt;color:#9c3f1d;line-height:1.15}
.head p{font-size:9pt;color:#6e5c54}
.head .demo-mark{color:#9c3f1d;margin-top:6pt}
.pair{display:grid;grid-template-columns:1fr 1fr;gap:.4in;margin-top:.24in}
.pair .facts>div{border-bottom:.5pt dotted #b9a79e}
.balance{margin-top:.22in;background:#fbf1ea;padding:10pt 14pt;display:flex;justify-content:space-between;align-items:center}
.balance strong{font-size:17pt;color:#9c3f1d}
h2{font-size:10.5pt;color:#9c3f1d;margin:.24in 0 4pt}
.lines th{border-top:1pt solid #9c3f1d;border-bottom:1pt solid #9c3f1d;font-size:9pt}
.lines tbody td{border-bottom:.5pt dotted #b9a79e}
.lines tfoot td{font-weight:600;font-size:11.5pt;border-bottom:3pt double #9c3f1d}
.stub{position:absolute;left:.7in;right:.7in;bottom:.45in;border-top:1pt dashed #9c8a81;padding-top:8pt}
`;

export const bayhearth: Template = (view) =>
  page(
    `${GAS_SUPPLIER.name} statement ${statementNumber(view)}`,
    CSS,
    `<header class="head">
<svg viewBox="0 0 32 32" aria-hidden="true"><path d="M16 3c1 6 8 9 8 17a8 8 0 0 1-16 0c0-4 2-6 4-8 0 3 1 4 2 4 1-4 0-9 2-13z" fill="#9c3f1d"/></svg>
<h1>${GAS_SUPPLIER.name}</h1>
<p>Natural gas supply statement</p>
${DEMO_MARK}
</header>
<section class="pair">
${billedTo(view)}
${facts([
  ["Account number", view.account.accountNumber],
  ["Plan code", view.bill.planCode!],
  ["Statement number", statementNumber(view)],
  ["Statement date", statementDate(view)],
])}
</section>
<section class="balance"><span>Amount due by ${dueDate(view)}</span><strong>${money(view.bill.totalCents)}</strong></section>
<h2>Supply charges, ${servicePeriod(view)}</h2>
${lineTable(view, "Total charges")}
${waysToPay("bayhearth.example", "(800) 555-0170", GAS_SUPPLIER.name)}
${paymentStub(view, [GAS_SUPPLIER.name, "PO Box 5512", "Berkeley, CA 94705"])}`,
  );
