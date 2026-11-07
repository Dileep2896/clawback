// The local Postgres + node-cron scheduler, on purpose: a naïve deployment fires a naïve agent session, not the
// in-process onFire handler the Monitor relies on, and it fires at most every 5 minutes. Scheduled checks stay in our
// scheduled_checks table on both platforms (orchestrator's ruling, 2026-11-07).
export { default } from "../local/scheduler.ts";
