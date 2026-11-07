import { createDb } from "@bill-fighter/db/client";
import { billViews, renderBills } from "@bill-fighter/db/seed/bill-pdf";
import { generateSeed, writeSeed } from "@bill-fighter/db/seed/generate";
import { loadSeed } from "@bill-fighter/db/seed/load";

const startedAt = performance.now();
const seed = generateSeed();
writeSeed(seed);

const db = createDb();
// Render, then load, then swap: a missing browser changes nothing in the database, and a failed load changes no PDFs.
try {
  await renderBills(billViews(seed), { beforeSwap: () => loadSeed(db, seed) });
} catch (error) {
  if (error instanceof Error && error.message.includes("Executable doesn't exist")) {
    console.error("Chromium is missing. Run `pnpm exec playwright install chromium`, then `pnpm seed` again.");
    process.exit(1);
  }
  throw error;
} finally {
  await db.$client.end();
}

const intervals = Object.values(seed.intervals).flat().length;
const seconds = ((performance.now() - startedAt) / 1000).toFixed(1);
console.info(
  `Seeded ${seed.locations.length} locations, ${seed.accounts.length} accounts, ${seed.bills.length} bills and ${intervals} intervals in ${seconds}s`,
);
