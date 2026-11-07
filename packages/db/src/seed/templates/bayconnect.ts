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

export const NAME = "BayConnect";

const CSS = `
body{padding:.45in .55in;background:#fff}
.top{display:flex;justify-content:space-between;align-items:center;color:#4a2a8c}
.logo{display:flex;align-items:center;gap:8pt}
.logo svg{width:30pt;height:30pt}
.logo h1{font-size:20pt;letter-spacing:-.01em}
.hero{margin-top:.25in;border-radius:12pt;background:#4a2a8c;color:#fff;padding:.28in .32in;display:flex;justify-content:space-between;align-items:flex-end}
.hero strong{display:block;font-size:30pt;line-height:1.1}
.hero p{font-size:10pt;color:#dcd1f4}
.cards{display:grid;grid-template-columns:1fr 1fr;gap:.2in;margin-top:.22in}
.card{border:1pt solid #dcd1f4;border-radius:10pt;padding:12pt 14pt}
.card h2,.bill-card h2{font-size:9pt;letter-spacing:.04em;color:#4a2a8c;margin-bottom:6pt}
.bill-card{border:1pt solid #dcd1f4;border-radius:10pt;padding:12pt 14pt;margin-top:.2in}
.lines th{font-size:9pt;color:#6d6480;border-bottom:1pt solid #dcd1f4}
.lines tfoot td{font-weight:600;font-size:12pt;color:#4a2a8c;border-top:1pt solid #4a2a8c}
.stub{position:absolute;left:.55in;right:.55in;bottom:.45in;border-top:1pt dashed #9b90b4;padding-top:8pt}
`;

export const bayconnect: Template = (view) =>
  page(
    `${NAME} statement ${statementNumber(view)}`,
    CSS,
    `<header class="top">
<div class="logo">
<svg viewBox="0 0 30 30" aria-hidden="true"><circle cx="8" cy="22" r="4" fill="#4a2a8c"/><path d="M4 11a15 15 0 0 1 15 15M4 3a23 23 0 0 1 23 23" fill="none" stroke="#4a2a8c" stroke-width="3" stroke-linecap="round"/></svg>
<h1>${NAME}</h1>
</div>
${DEMO_MARK}
</header>
<section class="hero">
<div><p>Your business internet bill</p><strong>${money(view.bill.totalCents)}</strong></div>
<p>Due ${dueDate(view)}</p>
</section>
<section class="cards">
<div class="card"><h2>Service location</h2>${billedTo(view)}</div>
<div class="card"><h2>Account</h2>${facts([
      ["Account number", view.account.accountNumber],
      ["Plan code", view.bill.planCode!],
      ["Statement number", statementNumber(view)],
      ["Statement date", statementDate(view)],
    ])}</div>
</section>
<section class="bill-card"><h2>This month: ${servicePeriod(view)}</h2>
${lineTable(view, "Total")}
</section>
${waysToPay("bayconnect.example", "(800) 555-0160", NAME)}
${paymentStub(view, [`${NAME} Payments`, "PO Box 7730", "San Jose, CA 95150"])}`,
  );
