import { describe, expect, it } from "vitest";
import { extractProfile, intervalStart } from "./extract-load-profile.ts";

const COLUMN = "out.electricity.total.energy_consumption.kwh";

// A year of labels with load only in the given ones, in ComStock's period-ending EST.
function yearCsv(loaded: string[]): string {
  const rows = [`timestamp,${COLUMN}`];
  for (let i = 1; i <= 35_040; i++) {
    const label = new Date(Date.UTC(2018, 0, 1) + i * 900_000).toISOString().slice(0, 19).replace("T", " ");
    rows.push(`${label},${loaded.includes(label) ? 100 : 0}`);
  }
  return rows.join("\n");
}

const row = (csv: string, key: string) => csv.split("\n").find((line) => line.startsWith(`${key},`));

describe("intervalStart", () => {
  it("reads a label as the end of an interval in EST", () => {
    expect(intervalStart("2018-01-01 00:15:00").toISOString()).toBe("2018-01-01T05:00:00.000Z");
  });

  it("rejects an unreadable label", () => {
    expect(() => intervalStart("not a time")).toThrow("Bad ComStock timestamp");
  });
});

describe("extractProfile", () => {
  it("files load under Pacific wall clock, in standard and daylight time", () => {
    // Mon Jan 15, ends 17:15 EST, starts 14:00 PST: slot 56.
    const winter = extractProfile(yearCsv(["2018-01-15 17:15:00"]));
    expect(row(winter, "1,weekday,56")).toBe("1,weekday,56,1.0000");
    expect(row(winter, "1,weekday,68")).toBe("1,weekday,68,0.0000");

    // Mon Jul 16, ends 17:15 EST, starts 15:00 PDT: slot 60.
    const summer = extractProfile(yearCsv(["2018-07-16 17:15:00"]));
    expect(row(summer, "7,weekday,60")).toBe("7,weekday,60,1.0000");
  });

  it("separates weekends by the Pacific day, not the EST one", () => {
    // Sat Jan 13 ends 01:15 EST, which starts 22:00 PST on Friday.
    const csv = extractProfile(yearCsv(["2018-01-13 01:15:00"]));
    expect(row(csv, "1,weekday,88")).toBe("1,weekday,88,1.0000");
    expect(row(csv, "1,weekend,88")).toBe("1,weekend,88,0.0000");
  });

  it("refuses a file that is not a whole year or lacks the column", () => {
    expect(() => extractProfile(`timestamp,${COLUMN}\n2018-01-01 00:15:00,1`)).toThrow("Expected 35040 rows");
    expect(() => extractProfile("timestamp,other\n2018-01-01 00:15:00,1")).toThrow("Missing");
  });

  it("refuses a bad kWh value rather than averaging it", () => {
    expect(() => extractProfile(yearCsv([]).replace(",0\n", ",oops\n"))).toThrow("Bad kWh");
  });
});
