import { mkdtempSync, readdirSync, readFileSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { pathToFileURL } from "node:url";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { RateSchedule } from "@bill-fighter/shared/tariff";
import { refreshTariffs } from "./fetch-tariffs.ts";

const KEY = "secret-test-key";
type Row = Record<string, unknown>;

const committed = (schedule: RateSchedule): Row =>
  JSON.parse(readFileSync(new URL(`../data/tariffs/urdb/${schedule}.json`, import.meta.url), "utf8"));
const [b1, b6, b10, b19] = RateSchedule.options.map(committed) as [Row, Row, Row, Row];

const page = (items: Row[]) => Response.json({ items });
function stubFetch(...responses: Response[]) {
  const stub = vi.fn<(url: URL) => Promise<Response>>();
  for (const response of responses) stub.mockResolvedValueOnce(response);
  vi.stubGlobal("fetch", stub);
  return stub;
}

describe("refreshTariffs", () => {
  let dir: string;
  const url = () => new URL(`${pathToFileURL(dir).href}/`);
  const cached = (name: string) => readFileSync(join(dir, name), "utf8");
  const expectOldCacheUntouched = () => {
    expect(readdirSync(dir)).toEqual(["B-1.json"]);
    expect(cached("B-1.json")).toBe("old\n");
  };

  beforeEach(() => {
    dir = mkdtempSync(join(tmpdir(), "urdb-"));
    writeFileSync(join(dir, "B-1.json"), "old\n");
    vi.spyOn(console, "info").mockImplementation(() => {});
    vi.spyOn(console, "warn").mockImplementation(() => {});
  });
  afterEach(() => {
    rmSync(dir, { recursive: true, force: true });
    vi.restoreAllMocks();
    vi.unstubAllGlobals();
  });

  it("reads every page and caches the four records it finds across them", async () => {
    const filler = Array.from({ length: 498 }, (_, i) => ({ name: `Other ${i}` }));
    const stub = stubFetch(page([b1, b6, ...filler]), page([b10, b19]));

    await refreshTariffs(KEY, url());

    expect(stub.mock.calls.map(([request]) => request.searchParams.get("offset"))).toEqual(["0", "500"]);
    expect(stub.mock.calls[0]![0].searchParams.get("eia")).toBe("14328");
    expect(readdirSync(dir).sort()).toEqual(["B-1.json", "B-10.json", "B-19.json", "B-6.json"]);
    expect(JSON.parse(cached("B-19.json"))).toEqual(b19);
  });

  it("asks for another page when the last one was exactly full", async () => {
    const filler = Array.from({ length: 496 }, (_, i) => ({ name: `Other ${i}` }));
    const stub = stubFetch(page([b1, b6, b10, b19, ...filler]), page([]));

    await refreshTariffs(KEY, url());

    expect(stub).toHaveBeenCalledTimes(2);
  });

  it("fails on an HTTP error on a later page, without the key and without writing", async () => {
    const filler = Array.from({ length: 500 }, (_, i) => ({ name: `Other ${i}` }));
    stubFetch(page(filler), new Response("", { status: 503 }));

    // Anchored, so the message cannot also carry the key or the URL.
    await expect(refreshTariffs(KEY, url())).rejects.toThrow(/^URDB returned HTTP 503$/);
    expectOldCacheUntouched();
  });

  it("fails on a response with no items, without writing", async () => {
    stubFetch(Response.json({ error: "nope" }));
    await expect(refreshTariffs(KEY, url())).rejects.toThrow("URDB returned no items");
    expectOldCacheUntouched();
  });

  it("fails on a missing record, without writing the ones it did find", async () => {
    stubFetch(page([b1, b6, b10]));
    await expect(refreshTariffs(KEY, url())).rejects.toThrow(`named "${String(b19.name)}", found 0`);
    expectOldCacheUntouched();
  });

  it("fails on an ambiguous record, without writing", async () => {
    stubFetch(page([b1, b6, b10, b19, { ...b19, label: "duplicate" }]));
    await expect(refreshTariffs(KEY, url())).rejects.toThrow(`named "${String(b19.name)}", found 2`);
    expectOldCacheUntouched();
  });

  it("ignores an ended record with the same name", async () => {
    stubFetch(page([b1, b6, b10, b19, { ...b19, label: "ended", enddate: 1 }]));
    await refreshTariffs(KEY, url());
    expect(JSON.parse(cached("B-19.json"))).toEqual(b19);
  });

  it("writes nothing when the last record fails validation, though earlier ones passed", async () => {
    stubFetch(page([b1, b6, b10, { ...b19, mincharge: 5 }]));
    await expect(refreshTariffs(KEY, url())).rejects.toThrow("Cannot price a minimum charge");
    expectOldCacheUntouched();
  });
});
