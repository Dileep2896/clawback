import type { PhoneLinePurpose } from "@bill-fighter/shared/fixtures";
import type { RateSchedule } from "@bill-fighter/shared/tariff";

export const CUSTOMER = {
  id: "golden-gate-noodle",
  name: "Golden Gate Noodle Co.",
  contactName: "Linda Park",
  contactEmail: "linda@goldengatenoodle.example",
  contactPhone: "(415) 555-0100",
  savingsSharePct: 30,
};

// Fixed, not derived from today, so the seed regenerates byte for byte. "Ending last month" means October 2026.
export const FIRST_MONTH = "2025-11";
export const LAST_MONTH = "2026-10";

export const METER_SWAP = {
  storeId: "fremont-1",
  firstMonth: "2025-07",
  swapMonth: "2025-09",
  oldMeter: "BEM-1009011",
  multiplierAfter: 2,
};

export const VOICE_LINE_CENTS = 13_500;
export const POTS_LINE_CENTS = 6_000;
export const INTERNET_CENTS = 9_500;
export const INTERNET_LATER_CENTS = 18_500;
export const VOICE_PLAN = "BT-BIZ-VOICE";
export const INTERNET_PLAN = "BC-BIZ-300";

export const GAS = {
  storeId: "oakland-3",
  plan: "BH-FIXED-24",
  usdPerTherm: 1.24,
  monthlyFeeCents: 1_200,
  // January to December.
  therms: [780, 720, 660, 580, 520, 470, 450, 450, 480, 560, 660, 760],
};

export type PotsLine = { number: string; label: string; purpose: PhoneLinePurpose; calls: number };

export type Store = {
  // Also the load profile seed.
  id: string;
  name: string;
  address: string;
  city: string;
  schedule: RateSchedule;
  meter: string;
  accountSuffix: number;
  monthlyKwh: number;
  lunchKw: number;
  voiceNumber: string;
  voiceCalls: number;
  pots: PotsLine[];
  internetChangeMonth?: string;
};

// Sizes and rushes come from pricing every store under all four schedules. Change them only by rerunning the tests.
export const STORES: Store[] = [
  {
    id: "sf-1",
    name: "San Francisco #1",
    address: "412 Clement St, San Francisco, CA 94118",
    city: "San Francisco",
    schedule: "B-6",
    meter: "BEM-1009001",
    accountSuffix: 7001,
    monthlyKwh: 4600,
    lunchKw: 11,
    voiceNumber: "(415) 555-0101",
    voiceCalls: 2140,
    pots: [
      { number: "(415) 555-0102", label: "Back office fax", purpose: "fax", calls: 0 },
      { number: "(415) 555-0103", label: "Alarm panel", purpose: "alarm", calls: 4 },
    ],
  },
  {
    id: "sf-2",
    name: "San Francisco #2",
    address: "1840 Irving St, San Francisco, CA 94122",
    city: "San Francisco",
    schedule: "B-6",
    meter: "BEM-1009002",
    accountSuffix: 7002,
    monthlyKwh: 4200,
    lunchKw: 10,
    voiceNumber: "(415) 555-0104",
    voiceCalls: 1880,
    pots: [],
    internetChangeMonth: "2026-02",
  },
  {
    id: "sf-3",
    name: "San Francisco #3",
    address: "655 Valencia St, San Francisco, CA 94110",
    city: "San Francisco",
    schedule: "B-6",
    meter: "BEM-1009003",
    accountSuffix: 7003,
    monthlyKwh: 5000,
    lunchKw: 12,
    voiceNumber: "(415) 555-0105",
    voiceCalls: 2510,
    pots: [
      { number: "(415) 555-0106", label: "Kitchen fax", purpose: "fax", calls: 0 },
      { number: "(415) 555-0107", label: "Spare line", purpose: "unknown", calls: 0 },
    ],
  },
  {
    id: "sf-4",
    name: "San Francisco #4",
    address: "230 Noriega St, San Francisco, CA 94122",
    city: "San Francisco",
    schedule: "B-6",
    meter: "BEM-1009004",
    accountSuffix: 7004,
    monthlyKwh: 3800,
    lunchKw: 9,
    voiceNumber: "(415) 555-0108",
    voiceCalls: 1620,
    pots: [],
  },
  {
    id: "oakland-1",
    name: "Oakland #1",
    address: "1520 Broadway, Oakland, CA 94612",
    city: "Oakland",
    schedule: "B-10",
    meter: "BEM-1009005",
    accountSuffix: 7005,
    monthlyKwh: 7125,
    lunchKw: 25.5,
    voiceNumber: "(510) 555-0111",
    voiceCalls: 2960,
    pots: [],
  },
  {
    id: "oakland-2",
    name: "Oakland #2",
    address: "3312 Grand Ave, Oakland, CA 94610",
    city: "Oakland",
    schedule: "B-10",
    meter: "BEM-1009006",
    accountSuffix: 7006,
    monthlyKwh: 7125,
    lunchKw: 25.5,
    voiceNumber: "(510) 555-0112",
    voiceCalls: 2810,
    pots: [],
  },
  {
    id: "oakland-3",
    name: "Oakland #3",
    address: "4801 Telegraph Ave, Oakland, CA 94609",
    city: "Oakland",
    schedule: "B-6",
    meter: "BEM-1009007",
    accountSuffix: 7007,
    monthlyKwh: 3400,
    lunchKw: 8,
    voiceNumber: "(510) 555-0113",
    voiceCalls: 1440,
    pots: [{ number: "(510) 555-0114", label: "Spare line", purpose: "unknown", calls: 0 }],
  },
  {
    id: "san-jose-1",
    name: "San Jose #1",
    address: "98 E Santa Clara St, San Jose, CA 95113",
    city: "San Jose",
    schedule: "B-6",
    meter: "BEM-1009008",
    accountSuffix: 7008,
    monthlyKwh: 4400,
    lunchKw: 10,
    voiceNumber: "(408) 555-0121",
    voiceCalls: 1990,
    pots: [],
    internetChangeMonth: "2026-04",
  },
  {
    id: "san-jose-2",
    name: "San Jose #2",
    address: "1175 Lincoln Ave, San Jose, CA 95125",
    city: "San Jose",
    schedule: "B-6",
    meter: "BEM-1009009",
    accountSuffix: 7009,
    monthlyKwh: 3600,
    lunchKw: 9,
    voiceNumber: "(408) 555-0122",
    voiceCalls: 1530,
    pots: [
      { number: "(408) 555-0123", label: "Office fax", purpose: "fax", calls: 0 },
      { number: "(408) 555-0124", label: "Alarm panel", purpose: "alarm", calls: 7 },
    ],
  },
  {
    id: "san-jose-3",
    name: "San Jose #3",
    address: "2005 Story Rd, San Jose, CA 95122",
    city: "San Jose",
    schedule: "B-1",
    meter: "BEM-1009010",
    accountSuffix: 7010,
    monthlyKwh: 2000,
    lunchKw: 0,
    voiceNumber: "(408) 555-0125",
    voiceCalls: 980,
    pots: [{ number: "(408) 555-0126", label: "Spare line", purpose: "unknown", calls: 0 }],
  },
  {
    id: "fremont-1",
    name: "Fremont #1",
    address: "39150 Fremont Blvd, Fremont, CA 94538",
    city: "Fremont",
    schedule: "B-6",
    meter: "BEM-2214077",
    accountSuffix: 7011,
    monthlyKwh: 2290,
    lunchKw: 0,
    voiceNumber: "(510) 555-0131",
    voiceCalls: 1110,
    pots: [],
  },
  {
    id: "fremont-2",
    name: "Fremont #2",
    address: "46525 Mission Blvd, Fremont, CA 94539",
    city: "Fremont",
    schedule: "B-1",
    meter: "BEM-1009012",
    accountSuffix: 7012,
    monthlyKwh: 1800,
    lunchKw: 0,
    voiceNumber: "(510) 555-0132",
    voiceCalls: 870,
    pots: [{ number: "(510) 555-0133", label: "Back office fax", purpose: "fax", calls: 0 }],
    internetChangeMonth: "2026-06",
  },
];
