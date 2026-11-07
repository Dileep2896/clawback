import { readFileSync } from "node:fs";
import { createRequire } from "node:module";
import type { AccountFixture, BillFixture, CustomerFixture, LocationFixture } from "@bill-fighter/shared/fixtures";

export type BillView = {
  bill: BillFixture;
  account: AccountFixture;
  location: LocationFixture;
  customer: CustomerFixture;
};
export type Template = (view: BillView) => string;

const require = createRequire(import.meta.url);
const fontFace = (weight: number) => {
  const file = require.resolve(`@fontsource/ibm-plex-sans/files/ibm-plex-sans-latin-${weight}-normal.woff2`);
  return `@font-face{font-family:"Plex";font-weight:${weight};src:url(data:font/woff2;base64,${readFileSync(file).toString("base64")}) format("woff2")}`;
};
// Inlined so the PDF bytes never depend on the fonts a machine has installed.
const FONTS = fontFace(400) + fontFace(600);

const ESCAPES: Record<string, string> = { "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;" };
export const esc = (text: string) => text.replace(/[&<>"]/g, (c) => ESCAPES[c]!);

const usd = new Intl.NumberFormat("en-US", { style: "currency", currency: "USD" });
export const money = (cents: number) => usd.format(cents / 100);
// Exact, never rounded further: the parser checks quantity x rate against the amount.
export const quantity = (value: number) => value.toLocaleString("en-US", { maximumFractionDigits: 3 });
export const rate = (value: number) =>
  `$${value.toLocaleString("en-US", { minimumFractionDigits: 2, maximumFractionDigits: 10 })}`;

const dateFormat = new Intl.DateTimeFormat("en-US", { timeZone: "UTC", year: "numeric", month: "short", day: "numeric" });
const addDays = (iso: string, days: number) => Date.parse(`${iso}T00:00:00Z`) + days * 86_400_000;
export const date = (iso: string, plusDays = 0) => dateFormat.format(addDays(iso, plusDays));

export const servicePeriod = ({ bill }: BillView) => `${date(bill.periodStart)} to ${date(bill.periodEnd)}`;
export const statementDate = ({ bill }: BillView) => date(bill.periodEnd, 3);
export const dueDate = ({ bill }: BillView) => date(bill.periodEnd, 21);
export const statementNumber = ({ bill, account }: BillView) =>
  `${account.accountNumber}-${bill.periodStart.slice(0, 7).replace("-", "")}`;

export const DEMO_MARK = `<span class="demo-mark">Demo data</span>`;

export const facts = (rows: [string, string][]) =>
  `<dl class="facts">${rows.map(([label, value]) => `<div><dt>${esc(label)}</dt><dd>${esc(value)}</dd></div>`).join("")}</dl>`;

export const billedTo = ({ customer, location }: BillView) =>
  `<address class="billed-to"><strong>${esc(customer.name)}</strong><br>${esc(location.name)}<br>${esc(location.address)}</address>`;

// One row per fixture line, so text extraction keeps each line's values together and in order.
export const lineTable = ({ bill }: BillView, totalLabel: string) => `<table class="lines">
<thead><tr><th>Description</th><th class="n">Quantity</th><th>Unit</th><th class="n">Rate</th><th class="n">Amount</th></tr></thead>
<tbody>${bill.lines
  .map(
    (line) =>
      `<tr><td>${esc(line.description)}</td><td class="n">${line.quantity === null ? "" : quantity(line.quantity)}</td><td>${esc(line.unit ?? "")}</td><td class="n">${line.rate === null ? "" : rate(line.rate)}</td><td class="n">${money(line.amountCents)}</td></tr>`,
  )
  .join("")}</tbody>
<tfoot><tr><td colspan="4">${esc(totalLabel)}</td><td class="n">${money(bill.totalCents)}</td></tr></tfoot>
</table>`;

export const waysToPay = (site: string, phone: string, mailTo: string) => `<section class="ways">
<h3>Ways to pay</h3>
<div class="ways-row">
<p><strong>Online</strong><br>Sign in at ${esc(site)}</p>
<p><strong>By phone</strong><br>Call ${esc(phone)}, Monday to Friday, 8 am to 6 pm</p>
<p><strong>By mail</strong><br>Send a check payable to ${esc(mailTo)}</p>
</div>
</section>`;

export const paymentStub = (view: BillView, remitTo: [string, string, string]) => `<section class="stub">
<p class="stub-note">Detach and return this portion with your payment</p>
<div class="stub-row">
${facts([
  ["Account number", view.account.accountNumber],
  ["Statement number", statementNumber(view)],
  ["Due date", dueDate(view)],
  ["Amount due", money(view.bill.totalCents)],
])}
<address>${remitTo.map(esc).join("<br>")}</address>
</div>
</section>`;

const BASE_CSS = `${FONTS}
@page{size:Letter;margin:0}
*{box-sizing:border-box;margin:0;padding:0}
html,body{width:8.5in;height:11in}
body{font-family:"Plex";font-weight:400;font-size:10.5pt;line-height:1.4;color:#1d2329;background:#fff;-webkit-print-color-adjust:exact}
strong,th,dt,h1,h2,h3{font-weight:600}
address{font-style:normal}
.demo-mark{display:inline-block;padding:2pt 7pt;border:1pt solid currentColor;border-radius:2pt;font-size:8.5pt;font-weight:600;letter-spacing:.06em;text-transform:none}
table{width:100%;border-collapse:collapse}
th{text-align:left}
td,th{padding:5pt 6pt;vertical-align:top}
.n{text-align:right;font-variant-numeric:tabular-nums}
.facts>div{display:flex;justify-content:space-between;gap:12pt;padding:3pt 0}
.facts dd{text-align:right}
.ways{margin-top:.25in;font-size:9pt}
.ways h3{font-size:10pt;margin-bottom:5pt}
.ways-row{display:grid;grid-template-columns:repeat(3,1fr);gap:.2in}
.stub-note{font-size:8.5pt;margin-bottom:8pt}
.stub-row{display:flex;justify-content:space-between;gap:36pt}
.stub-row .facts{flex:1}
.stub-row address{width:2.4in}`;

export const page = (title: string, css: string, body: string) =>
  `<!doctype html><html lang="en"><head><meta charset="utf-8"><title>${esc(title)}</title><style>${BASE_CSS}\n${css}</style></head><body>${body}</body></html>`;
