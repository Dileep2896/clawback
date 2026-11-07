import { runChecks } from "@bill-fighter/platform/check-runner";
import { platformName } from "@bill-fighter/platform/factory";

let code = 1;
try {
  code = await runChecks(platformName());
} catch (error) {
  console.error(error instanceof Error ? error.message : error);
}
// An explicit exit: an adapter's database pool or cron job would otherwise keep the process alive.
process.exit(code);
