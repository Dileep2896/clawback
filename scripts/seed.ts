import { createDb } from "@bill-fighter/db/client";
import { billViews, renderBills } from "@bill-fighter/db/seed/bill-pdf";
import { generateSeed, writeSeed } from "@bill-fighter/db/seed/generate";
import { loadSeed } from "@bill-fighter/db/seed/load";

const startedAt = performance.now();
const seed = generateSeed();
writeSeed(seed);

// Before the load, so a missing browser changes nothing in the database.
try {
  await renderBills(billViews(seed));
} catch (error) {
  if (error instanceof Error && error.message.includes("Executable doesn't exist")) {
    console.error("Chromium is missing. Run `pnpm exec playwright install chromium`, then `pnpm seed` again.");
    process.exit(1);
  }
  throw error;
}

const db = createDb();
try {
  await loadSeed(db, seed);
} finally {
  await db.$client.end();
}

const intervals = Object.values(seed.intervals).flat().length;
const seconds = ((performance.now() - startedAt) / 1000).toFixed(1);
console.info(
  `Seeded ${seed.locations.length} locations, ${seed.accounts.length} accounts, ${seed.bills.length} bills and ${intervals} intervals in ${seconds}s`,
);
