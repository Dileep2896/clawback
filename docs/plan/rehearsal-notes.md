# Rehearsal notes

## Migrate every database first

Replay adds migration `0003_runs_replay` (`runs.replay`). `/api/live` selects every column of `runs`, so **a database that has not run `pnpm db:migrate` after this merges gets a 500 and an empty dashboard.** Migrate the stage database before rehearsing.

## Playing the backup

Needs only local Postgres and the dashboard. The recording must have been made with the same seed, so run `pnpm seed` if replay says the seed is missing.

```
pnpm dev:dashboard
pnpm demo:replay --speed N
```

- `--speed` is 1 to 8, default 1. It scales every gap by the same factor. Nothing is cut.
- Replay clears the run tables first. It refuses a non-local database and a second replay.
- If a real run is marked `running`, replay refuses. Restart `pnpm dev:webhooks`, then add `--force`, or the live agent writes into the replay.
- The banner stays on until the next reset and states the speed. Approve and the SMS reply are hidden, and their routes return 409.

## Picking the speed

Measured on the first recording (4:48 whole run, 2:01 call). **These change with the recapture, because that run adds steps.**

| Speed | Whole run | Call | Speech |
|---|---|---|---|
| 1× | 4:48 | 2:01 | normal |
| 1.5× | 3:12 | 1:21 | 1.5× rate |
| 2× | 2:24 | 1:01 | 2× rate |
| 8× | 0:36 | 0:15 | off, the panel says so |

The script's run window is 0:20 to 3:30, about 190 s, which points to about 1.5×. Nothing makes the call fit its 50 s slot and stay audible, because speech turns off above 2×.

Offline speech depends on the machine's local voices and has not been heard by a person. Listen for it in rehearsal.

## Recapturing

Do this after any change to agent behaviour, the seed, or what the panels expect. It costs one full run on the Claude Code login.

1. Check `VOICE_MODE=sim` and that `DATABASE_URL` is not the shared database.
2. Start `pnpm dev:portal`, `pnpm dev:dashboard` and `pnpm dev:webhooks`.
3. `pnpm demo:reset`, then restart `pnpm dev:webhooks` if a run was running.
4. `pnpm demo:replay --capture`, then `pnpm demo:start` in another terminal.
5. When the text arrives, post `YES` to `/api/sms`.

A capture that breaks a rule goes to `data/replay/run.jsonl.failed`, with the reason printed, and the good file stays. Then run `pnpm exec tsx --env-file-if-exists=.env scripts/replay-check.ts` with the dashboard running on a database of your own.
