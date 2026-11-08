/* Hallmark · genre: modern-minimal (fintech) · macrostructure: intro → who serves × who works grid → sourced comparison by group → next
 * design-system: docs/plan/design.md · sources: docs/plan/competitors.md (read 2026-11-07) */
import type { Metadata } from "next";
import { Fragment } from "react";
import { LABEL, MoreLink, PageIntro, SiteFrame, Statement, WIDTH } from "../../components/landing/chrome.tsx";
import { Reveal } from "../../components/landing/motion.tsx";

export const metadata: Metadata = { title: "Why Clawback" };

// Every claim about another company is from its own public page (or, for EnergyCAP, whose site refused every fetch, its
// Wikipedia article), read on 2026-11-07 and quoted in docs/plan/competitors.md. "Not stated publicly" means we looked.

type Cell = { text: string; href?: string };
// A cell without its own link points at the page we checked for that player, so every cell has a source.
type Player = { name: string; source: string; cells: [Cell, Cell, Cell, Cell, Cell] };

const FIELDS = ["Who it serves", "Who does the work", "How it is priced", "Calls the provider and files the claim", "Time to first refund"];
const NOT_STATED = "Not stated publicly";

const P3 = "https://www.costanalysts.com/services/utility-auditing/";
const AUDITEL = "https://auditelinc.com/";
const AUDITEL_REFUND = "https://auditelinc.com/telecom-audit-services/telecom-recovery-audits/telecom-refund/";
const TROY = "https://www.troybanks.com/";
const TROY_SERVICES = "https://www.troybanks.com/services/index.html";
const TANGOE = "https://tangoe.com/telecom-expense-management/invoice-audit-optimization";
const CALERO = "https://www.calero.com/telecom-auditing";
const ARCADIA = "https://www.arcadia.com/";
const ENERGYCAP = "https://en.wikipedia.org/wiki/EnergyCAP";
const CASS = "https://www.cassinfo.com/utility-bill-management";
const ROCKET_FEE = "https://help.rocketmoney.com/en/articles/9744474-bill-negotiation-charge";
const ROCKET_HOW = "https://help.rocketmoney.com/en/articles/9744501-how-do-you-lower-my-bill";
const BILLSHARK = "https://www.billshark.com/";
const TRIM = "https://www.onemainmymoney.com/";
const FIE = "https://foodindustryexecutive.com/2023/06/are-utility-providers-overbilling-your-company/";
const CCS = "https://assets.crowncommercial.gov.uk/wp-content/uploads/RM3820-Telecoms-audit-white-paper-v.01.pdf";

const GROUPS: { title: string; lead: string; players: Player[] }[] = [
  {
    title: "Bill auditors on contingency",
    lead: "Firms whose people audit utility and phone bills and take a share of what they recover.",
    players: [
      {
        name: "P3 Cost Analysts",
        source: P3,
        cells: [
          { text: "Organizations above a spend minimum, such as real estate portfolios and local governments", href: P3 },
          { text: "P3’s auditors, from your invoices and a signed letter of authorization", href: P3 },
          { text: "Contingency, a share of verified savings each month; percentage not stated publicly", href: P3 },
          { text: "Yes: negotiates refunds and credits with the utility", href: P3 },
          { text: "Aims for findings in 30 days and savings in 90", href: P3 },
        ],
      },
      {
        name: "Auditel",
        source: AUDITEL,
        cells: [
          { text: "Corporations, cities, hospitals, schools; telecom only", href: AUDITEL },
          { text: "Auditel’s own analyst team", href: AUDITEL },
          { text: "Contingency, a portion of monthly savings; percentage not stated publicly", href: AUDITEL },
          { text: "Says a dispute must be filed with the carrier and that it can expedite recovery", href: AUDITEL_REFUND },
          { text: "About four weeks; larger refunds take months", href: AUDITEL_REFUND },
        ],
      },
      {
        name: "Troy & Banks",
        source: TROY_SERVICES,
        cells: [
          { text: "Public and private organizations; electric, gas, water and telecom", href: TROY },
          { text: NOT_STATED },
          { text: "Contingency; percentage not stated publicly", href: TROY },
          { text: "Lists dispute filing support and tracking claims until refunds are paid", href: TROY_SERVICES },
          { text: NOT_STATED },
        ],
      },
    ],
  },
  {
    title: "Expense management software",
    lead: "Platforms that collect, audit and pay bills for larger organizations, some with their own auditors on top.",
    players: [
      {
        name: "Tangoe",
        source: TANGOE,
        cells: [
          { text: "Enterprises", href: TANGOE },
          { text: "Software, plus Tangoe consultants", href: TANGOE },
          { text: `${NOT_STATED}; demo on request`, href: TANGOE },
          { text: "Handles invoice corrections and vendor disputes", href: TANGOE },
          { text: NOT_STATED },
        ],
      },
      {
        name: "Calero",
        source: CALERO,
        cells: [
          { text: "IT and finance teams with thousands of invoices", href: CALERO },
          { text: "Software, plus Calero’s auditors", href: CALERO },
          { text: NOT_STATED },
          { text: "Its auditors manage the dispute until the credit posts", href: CALERO },
          { text: NOT_STATED },
        ],
      },
      {
        name: "Arcadia (owns Urjanet)",
        source: ARCADIA,
        cells: [
          { text: "Businesses; 1,000+ enterprise customers", href: ARCADIA },
          { text: "A utility data platform and APIs, plus advisory", href: ARCADIA },
          { text: NOT_STATED },
          { text: "Not mentioned on its home page", href: ARCADIA },
          { text: NOT_STATED },
        ],
      },
      {
        name: "EnergyCAP",
        source: ENERGYCAP,
        cells: [
          { text: "750+ organizations, mostly education and government", href: ENERGYCAP },
          { text: "Software your own staff use; it audits bills for errors", href: ENERGYCAP },
          { text: NOT_STATED },
          { text: NOT_STATED },
          { text: NOT_STATED },
        ],
      },
      {
        name: "Cass Information Systems",
        source: CASS,
        cells: [
          { text: "Hundreds of US enterprises", href: CASS },
          { text: "Cass processes, audits and pays your bills", href: CASS },
          { text: NOT_STATED },
          { text: "Disputes and refunds not stated publicly", href: CASS },
          { text: NOT_STATED },
        ],
      },
    ],
  },
  {
    title: "Consumer bill negotiators",
    lead: "Services that call your internet, phone and TV providers to lower a household’s rate.",
    players: [
      {
        name: "Rocket Money",
        source: ROCKET_HOW,
        cells: [
          { text: "Consumers: internet, cable, phone, security", href: ROCKET_HOW },
          { text: "Rocket Money’s team calls the provider", href: ROCKET_HOW },
          { text: "Was 35 to 60% of first-year savings; from Nov 2, 2026, Premium+ members only, no added success fee", href: ROCKET_FEE },
          { text: "Negotiates rates; refund claims for billing errors not stated", href: ROCKET_HOW },
          { text: NOT_STATED },
        ],
      },
      {
        name: "Billshark",
        source: BILLSHARK,
        cells: [
          { text: "Consumers: internet, wireless, streaming", href: BILLSHARK },
          { text: "Billshark’s negotiators", href: BILLSHARK },
          { text: "40% of savings; no savings, no fee", href: BILLSHARK },
          { text: "Asks providers for lower rates; refund claims not stated", href: BILLSHARK },
          { text: NOT_STATED },
        ],
      },
      {
        name: "Trim",
        source: TRIM,
        cells: [
          { text: "Consumers; now OneMain MyMoney", href: TRIM },
          { text: NOT_STATED },
          { text: "Free to sign up; negotiation terms not stated", href: TRIM },
          { text: NOT_STATED },
          { text: NOT_STATED },
        ],
      },
    ],
  },
  {
    title: "Consultants and doing it in-house",
    lead: "Most bills are checked by nobody, or by a staff member or an outside consultant by hand.",
    players: [
      {
        name: "Consultants and staff",
        source: FIE,
        cells: [
          { text: "Any business that hires one, or has the expertise in-house", href: FIE },
          { text: "A person, reading bills by hand", href: FIE },
          { text: "Contingency, hourly or a fixed project fee", href: FIE },
          { text: "Depends on who you hire" },
          { text: NOT_STATED },
        ],
      },
    ],
  },
];

const CLAWBACK: Player = {
  name: "Clawback",
  source: "/how-it-works",
  cells: [
    { text: "Small businesses, such as a noodle shop with three sites" },
    { text: "AI agents; you approve once, by text" },
    { text: "30% of what is recovered, only once it comes back", href: "/pricing" },
    { text: "Yes: the agents call the provider and file the claim", href: "/how-it-works" },
    { text: "4 min 28 s to filed claims in the demo run; the refund itself waits on the provider", href: "/how-it-works" },
  ],
};

// The positioning grid: each name sits where its own row in the table puts it. Trim is left out: its terms aren't public.
const SERVES = ["Households", "Says it serves small businesses", "Organizations and enterprises"];
const WORK: { label: string; cells: [string[], string[], string[]] }[] = [
  { label: "Agents", cells: [[], ["Clawback"], []] },
  { label: "The vendor’s people", cells: [["Rocket Money", "Billshark"], [], ["P3", "Auditel", "Troy & Banks"]] },
  { label: "Software plus the vendor’s staff", cells: [[], [], ["Tangoe", "Calero", "Cass"]] },
  { label: "Software your staff run", cells: [[], [], ["EnergyCAP", "Arcadia"]] },
];

function Source({ cell, fallback }: { cell: Cell; fallback: string }) {
  return (
    <a
      href={cell.href ?? fallback}
      className={`underline decoration-line underline-offset-4 hover:decoration-agent ${cell.text === NOT_STATED ? "text-faded" : ""}`}
    >
      {cell.text}
    </a>
  );
}

const COLUMNS = "lg:grid-cols-[1.1fr_repeat(5,minmax(0,1fr))]";

function Row({ player, highlight = false }: { player: Player; highlight?: boolean }) {
  return (
    <div role="row" className={`grid gap-3 px-5 py-5 lg:gap-x-5 ${COLUMNS} ${highlight ? "rounded-[10px] border-2 border-ink bg-sheet" : "border-t border-line"}`}>
      <p role="rowheader" className="text-[1.125rem] font-semibold">
        {player.name}
      </p>
      {player.cells.map((cell, i) => (
        <div role="cell" key={FIELDS[i]} className="grid gap-0.5 text-[15px] lg:block">
          {/* Under lg each row is a card, so every value carries its own label. */}
          <span className="text-faded lg:sr-only">{FIELDS[i]}</span>
          <Source cell={cell} fallback={player.source} />
        </div>
      ))}
    </div>
  );
}

function PositionGrid() {
  return (
    <Reveal className="grid gap-4">
      <div className="grid gap-px overflow-hidden rounded-[12px] border border-line bg-line sm:grid-cols-[10rem_repeat(3,minmax(0,1fr))]">
        <span className="hidden bg-paper sm:block" />
        {SERVES.map((column) => (
          <span key={column} className="hidden bg-paper px-4 py-3 text-[15px] text-faded sm:block">
            {column}
          </span>
        ))}
        {WORK.map((row, r) => (
          <Fragment key={row.label}>
            <span className="bg-paper px-4 py-3 text-[15px] font-semibold sm:font-normal sm:text-faded">{row.label}</span>
            {row.cells.map((names, c) => (
              // Under sm the grid is one column, so empty squares are dropped and each filled one names its column.
              <div key={c} className={`grid min-h-16 content-start gap-1.5 bg-sheet px-4 py-3 ${names.length ? "" : "max-sm:hidden"}`}>
                <span className="text-[13px] text-faded sm:hidden">{SERVES[c]}</span>
                <div className="flex flex-wrap gap-1.5">
                  {names.map((name, n) => (
                    <span
                      key={name}
                      className={`reveal-line rounded-full border px-2.5 py-0.5 text-[15px] ${name === "Clawback" ? "border-agent font-semibold text-ink" : "border-line text-faded"}`}
                      style={{ animationDelay: `${name === "Clawback" ? 600 : (r * 3 + c + n) * 50}ms` }}
                    >
                      {name}
                    </span>
                  ))}
                </div>
              </div>
            ))}
          </Fragment>
        ))}
      </div>
      <p className="text-[15px] text-faded">
        Each name sits where its own public pages put it: whom it names as customers, and who does the work. An empty square is a combination none of
        them describes.
      </p>
    </Reveal>
  );
}

export default function ComparePage() {
  return (
    <SiteFrame current="/compare">
      <PageIntro caption="Why Clawback" lead="The help exists." rest="It is built for bigger companies, or for households.">
        <p>
          Bill auditors, expense software and bill negotiators already get money back. Here is what each one says it does, on its own pages, next to
          what Clawback does. Every claim links to its source.
        </p>
      </PageIntro>

      <section aria-labelledby="grid-title" className={`${WIDTH} grid gap-8 pb-24 lg:pb-36`}>
        <h2 id="grid-title" className={`${LABEL} text-faded`}>
          Who it serves, by who does the work
        </h2>
        <PositionGrid />
      </section>

      <section aria-labelledby="table-title" className="border-y border-line bg-sheet">
        <div className={`${WIDTH} py-24 lg:py-36`}>
          <Statement id="table-title" lead="Side by side.">
            On the five things an owner asks first. Clawback’s row comes first; the rest are grouped by kind.
          </Statement>
          <div role="table" aria-label="Clawback and the current players" className="mt-12 rounded-[12px] border border-line bg-paper p-2 pt-4">
            <div role="rowgroup">
              <div role="row" className={`hidden gap-x-5 px-5 pb-3 text-[15px] text-faded lg:grid ${COLUMNS}`}>
                <span role="columnheader">Who</span>
                {FIELDS.map((field) => (
                  <span role="columnheader" key={field}>
                    {field}
                  </span>
                ))}
              </div>
              <Row player={CLAWBACK} highlight />
            </div>
            {GROUPS.map((group) => (
              <div role="rowgroup" key={group.title}>
                <div role="row" className="px-5 pt-10 pb-3">
                  <p role="rowheader" className="text-[1.25rem] font-semibold">
                    {group.title} <span className="block text-[15px] font-normal text-faded">{group.lead}</span>
                  </p>
                </div>
                {group.players.map((player) => (
                  <Row key={player.name} player={player} />
                ))}
              </div>
            ))}
          </div>
          <p className="mt-8 max-w-[72ch] text-faded">
            Read on 7 November 2026 from each company’s public pages; vendor figures are their own claims. EnergyCAP’s site refused automated reads, so its
            row comes from its{" "}
            <a href={ENERGYCAP} className="text-agent underline underline-offset-2">
              Wikipedia article
            </a>
            . A UK government white paper adds that 85% of a large organisation’s telecom invoices are paid in full without an internal audit (
            <a href={CCS} className="text-agent underline underline-offset-2">
              Crown Commercial Service
            </a>
            ).
          </p>
        </div>
      </section>

      <section aria-labelledby="next-title" className={`${WIDTH} grid gap-6 py-24 lg:py-36`}>
        <Statement id="next-title" lead="What is the same, and what isn’t.">
          Like the auditors, Clawback is paid only from what it recovers. Unlike them, agents do the work in minutes, which is what makes a small
          business’s bills worth checking.
        </Statement>
        <div className="flex flex-wrap gap-x-8 gap-y-3">
          <MoreLink href="/how-it-works">Watch the agents work</MoreLink>
          <MoreLink href="/market">The size of the gap</MoreLink>
        </div>
      </section>
    </SiteFrame>
  );
}
