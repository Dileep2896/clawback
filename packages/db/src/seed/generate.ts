import { mkdirSync, rmSync, writeFileSync } from "node:fs";
import { pathToFileURL } from "node:url";
import { loadTariff } from "@bill-fighter/core/tariff/load";
import { priceUsage, roundCents, type PricedBill } from "@bill-fighter/core/tariff/price-usage";
import {
  AccountFixture,
  AuthorizationFixture,
  BillFixture,
  CustomerFixture,
  GAS_SUPPLIER,
  LocationFixture,
  PhoneLineFixture,
  Provider,
  UsageIntervalFixture,
  type ServiceType,
} from "@bill-fighter/shared/fixtures";
import type { RateSchedule, Tariff } from "@bill-fighter/shared/tariff";
import {
  AUTHORIZATION,
  CUSTOMER,
  FIRST_MONTH,
  GAS,
  INTERNET_CENTS,
  INTERNET_LATER_CENTS,
  INTERNET_PLAN,
  LAST_MONTH,
  METER_SWAP,
  POTS_LINE_CENTS,
  STORES,
  VOICE_LINE_CENTS,
  VOICE_PLAN,
  type Store,
} from "./customer.ts";
import { loadProfile } from "./load-profile.ts";

export type Seed = {
  customer: CustomerFixture;
  authorizations: AuthorizationFixture[];
  locations: LocationFixture[];
  accounts: AccountFixture[];
  phoneLines: PhoneLineFixture[];
  bills: BillFixture[];
  // Keyed by electric account id. True metered usage, ts is the interval start.
  intervals: Record<string, UsageIntervalFixture[]>;
};

const SEED_DIR = new URL("../../../../data/seed/", import.meta.url);
// Only decides which tariff age warnings get logged, and must not follow the clock.
const TARIFF_CHECK_DATE = new Date("2026-11-06T00:00:00Z");

const threeDecimals = (value: number) => Number(value.toFixed(3));

// "2026-02" through "2026-10", both inclusive.
export function monthsBetween(first: string, last: string): string[] {
  const months: string[] = [];
  const [year, month] = first.split("-").map(Number) as [number, number];
  for (let i = 0; ; i++) {
    const current = new Date(Date.UTC(year, month - 1 + i, 1)).toISOString().slice(0, 7);
    if (current > last) return months;
    months.push(current);
  }
}

export function calendarMonth(month: string) {
  const [year, number] = month.split("-").map(Number) as [number, number];
  return { start: `${month}-01`, end: new Date(Date.UTC(year, number, 0)).toISOString().slice(0, 10) };
}

const accountId = (storeId: string, service: ServiceType) => `${storeId}-${service}`;

function account(
  store: Store,
  provider: Provider,
  serviceType: ServiceType,
  prefix: string,
  electric?: { rateSchedule: string; meterNumber: string },
): AccountFixture {
  return AccountFixture.parse({
    id: accountId(store.id, serviceType),
    locationId: store.id,
    provider,
    accountNumber: `${prefix}-${store.accountSuffix}`,
    serviceType,
    rateSchedule: electric?.rateSchedule ?? null,
    meterNumber: electric?.meterNumber ?? null,
  });
}

const lineIds = (billId: string, lines: Omit<BillFixture["lines"][number], "id">[]) =>
  lines.map((line, index) => ({ id: `${billId}-${index + 1}`, ...line }));

function electricBillLines(priced: PricedBill) {
  return [
    ...priced.energy.flatMap(({ period, tiers }) =>
      tiers.map((t) => ({
        description: `${period} energy`,
        quantity: threeDecimals(t.kwh),
        unit: "kWh",
        rate: t.usdPerKwh,
        amountCents: t.cents,
        lineType: "energy",
      })),
    ),
    ...priced.demand.flatMap(({ period, tiers }) =>
      tiers.map((t) => ({
        description: period,
        quantity: threeDecimals(t.kw),
        unit: "kW",
        rate: t.usdPerKw,
        amountCents: t.cents,
        lineType: "demand",
      })),
    ),
    ...priced.fixed.map(({ name, cents }) => ({
      description: name,
      quantity: null,
      unit: null,
      rate: null,
      amountCents: cents,
      lineType: "fixed",
    })),
  ];
}

function electricBill(
  store: Store,
  month: string,
  tariff: Tariff,
  intervals: UsageIntervalFixture[],
): BillFixture {
  const period = calendarMonth(month);
  const swapped = store.id === METER_SWAP.storeId;
  const multiplier = swapped && month >= METER_SWAP.swapMonth ? METER_SWAP.multiplierAfter : 1;
  // Doubling a float is exact, so billed kWh stays exactly the multiplier times the interval kWh.
  const billedIntervals = multiplier === 1 ? intervals : intervals.map(({ ts, kwh }) => ({ ts, kwh: kwh * multiplier }));
  const priced = priceUsage(billedIntervals, tariff, period);

  // A prorated line's kW x rate would not equal its cents. Calendar months never prorate, so stop if one ever does.
  const days = (Date.parse(period.end) - Date.parse(period.start)) / 86_400_000 + 1;
  for (const demand of priced.demand) {
    if (demand.days !== days) throw new Error(`${store.id} ${month}: ${demand.period} covers ${demand.days} of ${days} days`);
  }

  const id = `${accountId(store.id, "electric")}-${month}`;
  return BillFixture.parse({
    id,
    accountId: accountId(store.id, "electric"),
    periodStart: period.start,
    periodEnd: period.end,
    totalCents: priced.totalCents,
    pdfPath: null,
    meterNumber: swapped && month < METER_SWAP.swapMonth ? METER_SWAP.oldMeter : store.meter,
    multiplier,
    rateSchedule: store.schedule,
    planCode: null,
    kwhByTouPeriod: priced.energy.map(({ period: name, kwh }) => ({ period: name, kwh: threeDecimals(kwh) })),
    maxKw: threeDecimals(priced.maxKw),
    lines: lineIds(id, electricBillLines(priced)),
  });
}

function flatBill(accountRef: string, month: string, planCode: string, lines: Omit<BillFixture["lines"][number], "id">[]) {
  const period = calendarMonth(month);
  const id = `${accountRef}-${month}`;
  return BillFixture.parse({
    id,
    accountId: accountRef,
    periodStart: period.start,
    periodEnd: period.end,
    totalCents: lines.reduce((sum, line) => sum + line.amountCents, 0),
    pdfPath: null,
    meterNumber: null,
    multiplier: null,
    rateSchedule: null,
    planCode,
    kwhByTouPeriod: [],
    maxKw: null,
    lines: lineIds(id, lines),
  });
}

function telecomBill(store: Store, month: string) {
  const line = (number: string, kind: string, cents: number) => ({
    description: `${kind} ${number}`,
    quantity: 1,
    unit: "line",
    rate: cents / 100,
    amountCents: cents,
    lineType: kind === "Voice line" ? "voice" : "pots",
  });
  return flatBill(accountId(store.id, "telecom"), month, VOICE_PLAN, [
    line(store.voiceNumber, "Voice line", VOICE_LINE_CENTS),
    ...store.pots.map((pots) => line(pots.number, "Copper line", POTS_LINE_CENTS)),
  ]);
}

function internetBill(store: Store, month: string) {
  const later = store.internetChangeMonth !== undefined && month >= store.internetChangeMonth;
  const cents = later ? INTERNET_LATER_CENTS : INTERNET_CENTS;
  return flatBill(accountId(store.id, "internet"), month, INTERNET_PLAN, [
    {
      description: "Business internet",
      quantity: 1,
      unit: "month",
      rate: cents / 100,
      amountCents: cents,
      lineType: "internet",
    },
  ]);
}

function gasBill(store: Store, month: string) {
  const therms = GAS.therms[Number(month.slice(5)) - 1]!;
  return flatBill(accountId(store.id, "gas"), month, GAS.plan, [
    {
      description: "Natural gas supply",
      quantity: therms,
      unit: "therm",
      rate: GAS.usdPerTherm,
      amountCents: roundCents(therms * GAS.usdPerTherm),
      lineType: "gas_supply",
    },
    {
      description: "Monthly service fee",
      quantity: null,
      unit: null,
      rate: null,
      amountCents: GAS.monthlyFeeCents,
      lineType: "fixed",
    },
  ]);
}

// Pure and offline: the only inputs are committed files and the constants in customer.ts.
export function generateSeed(): Seed {
  const tariffs = new Map<RateSchedule, Tariff>();
  const tariffFor = (schedule: RateSchedule) => {
    const tariff = tariffs.get(schedule) ?? loadTariff(schedule, { now: TARIFF_CHECK_DATE });
    tariffs.set(schedule, tariff);
    return tariff;
  };

  const yearMonths = monthsBetween(FIRST_MONTH, LAST_MONTH);
  const seed: Seed = {
    customer: CustomerFixture.parse(CUSTOMER),
    authorizations: Provider.options.map((provider) =>
      AuthorizationFixture.parse({
        id: `${CUSTOMER.id}-${provider}-authorization`,
        customerId: CUSTOMER.id,
        provider,
        formType: AUTHORIZATION.formType,
        scope: AUTHORIZATION.scope[provider],
        signedBy: AUTHORIZATION.signedBy,
        signedAt: AUTHORIZATION.signedAt,
        expiresAt: AUTHORIZATION.expiresAt,
        pdfPath: null,
      }),
    ),
    locations: [],
    accounts: [],
    phoneLines: [],
    bills: [],
    intervals: {},
  };

  for (const store of STORES) {
    seed.locations.push(
      LocationFixture.parse({
        id: store.id,
        customerId: CUSTOMER.id,
        name: store.name,
        address: store.address,
        city: store.city,
      }),
    );

    seed.accounts.push(
      account(store, "baycurrent", "electric", "BE", { rateSchedule: store.schedule, meterNumber: store.meter }),
      account(store, "baytel", "telecom", "BT"),
      account(store, "bayconnect", "internet", "BC"),
    );
    if (store.id === GAS.storeId) seed.accounts.push(account(store, GAS_SUPPLIER.provider, "gas", "BH"));

    const electricMonths =
      store.id === METER_SWAP.storeId ? monthsBetween(METER_SWAP.firstMonth, LAST_MONTH) : yearMonths;
    const intervals = loadProfile({
      seed: store.id,
      start: calendarMonth(electricMonths[0]!).start,
      end: calendarMonth(LAST_MONTH).end,
      monthlyKwh: store.monthlyKwh,
      lunchKw: store.lunchKw,
    }).map((interval) => UsageIntervalFixture.parse({ accountId: accountId(store.id, "electric"), ...interval }));
    seed.intervals[accountId(store.id, "electric")] = intervals;

    const tariff = tariffFor(store.schedule);
    seed.bills.push(...electricMonths.map((month) => electricBill(store, month, tariff, intervals)));
    seed.bills.push(...yearMonths.map((month) => telecomBill(store, month)));
    seed.bills.push(...yearMonths.map((month) => internetBill(store, month)));
    if (store.id === GAS.storeId) seed.bills.push(...yearMonths.map((month) => gasBill(store, month)));

    const telecomAccount = accountId(store.id, "telecom");
    seed.phoneLines.push(
      PhoneLineFixture.parse({
        id: `${telecomAccount}-voice`,
        accountId: telecomAccount,
        number: store.voiceNumber,
        label: "Main line",
        monthlyCents: VOICE_LINE_CENTS,
        callsLast12mo: store.voiceCalls,
        purpose: "voice",
      }),
      ...store.pots.map((pots, index) =>
        PhoneLineFixture.parse({
          id: `${telecomAccount}-pots-${index + 1}`,
          accountId: telecomAccount,
          number: pots.number,
          label: pots.label,
          monthlyCents: POTS_LINE_CENTS,
          callsLast12mo: pots.calls,
          purpose: pots.purpose,
        }),
      ),
    );
  }
  return seed;
}

/** Per meter: how many readings and over what dates. Committed as data/replay/usage.json for the judge sandbox, whose database holds no intervals (scripts/sandbox-seed-sql.ts). */
export const usageSummary = ({ accounts, intervals }: Pick<Seed, "accounts" | "intervals">) =>
  accounts
    .filter((a) => intervals[a.id]?.length)
    .map((a) => {
      const ts = intervals[a.id]!.map((r) => r.ts).sort();
      return { accountId: a.id, meterNumber: a.meterNumber ?? null, intervals: ts.length, from: ts[0]!, to: ts.at(-1)! };
    })
    .sort((a, b) => (a.accountId < b.accountId ? -1 : 1));

export function writeSeed(seed: Seed, dir: URL = SEED_DIR) {
  // A removed account must not leave an old intervals file behind.
  rmSync(new URL("intervals/", dir), { recursive: true, force: true });
  mkdirSync(new URL("intervals/", dir), { recursive: true });
  const { customer, authorizations, locations, accounts, phoneLines, bills, intervals } = seed;
  writeFileSync(new URL("customer.json", dir), `${JSON.stringify({ customer, authorizations, locations, accounts, phoneLines }, null, 2)}\n`);
  writeFileSync(new URL("bills.json", dir), `${JSON.stringify(bills, null, 2)}\n`);
  for (const [id, rows] of Object.entries(intervals)) {
    writeFileSync(new URL(`intervals/${id}.json`, dir), `${JSON.stringify(rows)}\n`);
  }
}

if (process.argv[1] && import.meta.url === pathToFileURL(process.argv[1]).href) {
  const seed = generateSeed();
  writeSeed(seed);
  console.info(`Wrote ${seed.accounts.length} accounts and ${seed.bills.length} bills to data/seed/`);
}
