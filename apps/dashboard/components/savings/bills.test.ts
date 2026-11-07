import { expect, it } from "vitest";
import { bySite } from "./bills.tsx";

const bill = (id: string, locationId: string, city: string) =>
  ({ id, locationId, site: "Store #1", city, accountId: `${locationId}-acct` }) as Parameters<typeof bySite>[0][number];

it("keeps two locations with the same name apart, each with its own city", () => {
  const groups = bySite([bill("a1", "loc-a", "Fremont"), bill("a2", "loc-a", "Fremont"), bill("b1", "loc-b", "Oakland")]);
  expect(groups.map(([id, bills]) => [id, bills[0]!.city, bills.map((b) => b.id)])).toEqual([
    ["loc-a", "Fremont", ["a1", "a2"]],
    ["loc-b", "Oakland", ["b1"]],
  ]);
});
