import { accounts, customers, locations } from "@bill-fighter/db/schema";
import { withTestDb } from "@bill-fighter/db/test-db";
import { describe, expect, it } from "vitest";
import { listAccounts, pageOf } from "./accounts.ts";

describe("pageOf", () => {
  it.each([
    [undefined, 1],
    ["2", 2],
    ["3", 3],
    ["99", 3],
    ["0", 1],
    ["-1", 1],
    ["1.5", 1],
    ["abc", 1],
  ])("page %s of 12 accounts is %i", (requested, page) => {
    expect(pageOf(12, requested).page).toBe(page);
  });

  it("gives an empty list one page", () => {
    expect(pageOf(0, "4")).toEqual({ page: 1, totalPages: 1, offset: 0 });
  });
});

describe("listAccounts", () => {
  it("only returns the provider's accounts, paged and filtered by location", async () => {
    await withTestDb("portal_accounts", async (db) => {
      await db.insert(customers).values({
        id: "c",
        name: "Test Noodle Co",
        contactName: "Test Owner",
        contactEmail: "owner@billfighter.local",
        contactPhone: "+15550001111",
      });
      const stores = Array.from({ length: 7 }, (_, i) => `store-${i}`);
      await db.insert(locations).values([
        ...stores.map((id) => ({ id, customerId: "c", name: id, address: "1 Test St", city: "Oakland" })),
        { id: "tel-only", customerId: "c", name: "tel-only", address: "2 Test St", city: "Oakland" },
      ]);
      await db.insert(accounts).values([
        ...stores.map((id) => ({
          id: `electric-${id}`,
          locationId: id,
          provider: "baycurrent" as const,
          accountNumber: `E-${id}`,
          serviceType: "electric" as const,
        })),
        { id: "tel-1", locationId: "tel-only", provider: "baytel", accountNumber: "T-1", serviceType: "telecom" },
        { id: "tel-2", locationId: "store-0", provider: "baytel", accountNumber: "T-2", serviceType: "telecom" },
      ]);

      const first = await listAccounts(db, "baycurrent");
      expect(first).toMatchObject({ total: 7, page: 1, totalPages: 2 });
      expect(first.rows).toHaveLength(5);
      expect(first.locations.map((l) => l.id)).not.toContain("tel-only");

      const second = await listAccounts(db, "baycurrent", { page: "2" });
      expect(second.rows.map((r) => r.id)).toEqual(["electric-store-5", "electric-store-6"]);

      const atStore = await listAccounts(db, "baycurrent", { location: "store-0" });
      expect(atStore.rows.map((r) => r.id)).toEqual(["electric-store-0"]);

      // A location that only another provider serves shows nothing, even when asked for directly.
      expect(await listAccounts(db, "baycurrent", { location: "tel-only" })).toMatchObject({ total: 0, rows: [] });

      const tel = await listAccounts(db, "baytel");
      expect(tel.rows.map((r) => r.id).sort()).toEqual(["tel-1", "tel-2"]);
      expect(await listAccounts(db, "bayhearth")).toMatchObject({ total: 0, rows: [], locations: [] });
    });
  });
});
