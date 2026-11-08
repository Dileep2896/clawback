# naïve hosted App recon (judge-link)

Lane `judge-link`, 2026-11-07. Docs only, read as raw Markdown (`https://usenaive.ai/docs/<path>.md`, the full set at `https://usenaive.ai/docs/llms-full.txt`). Nothing was created or called on the account. Pages read: `api/apps`, `api/database`, `sdk/apps`, `cli/apps`, `cli/database`, `cli/naive` (the `apps[]` declaration), `platform/pricing`, `computer/limits-and-billing`.

## What an app is

| Question | What the docs say |
|---|---|
| Kinds | `frontend_only` ("a static or client-rendered frontend") or `fullstack` (the same plus a managed Postgres, object storage and an optional MCP endpoint the app serves). Org-level, outlives sessions. |
| Create | `POST /v1/apps { name, type: "fullstack" }` (scope `agents:write`), idempotent on name. CLI: `naive app create <name> --type fullstack`. A fullstack app is `provisioning` until its database is ready; poll `GET /v1/apps/{id}`. |
| Deploy | `POST /v1/apps/{id}/deployments { files: { path: base64 } }`, the whole tree in one request; the platform **builds it** (`queued → building → ready`). CLI `naive app deploy <id> <dir>` skips `node_modules`, `.git`, `dist`, `.wrangler`, `.open-next` and `.env*`. |
| Runtime | **Not documented.** The docs never name the build or the runtime. Skipping `.wrangler` and `.open-next` strongly suggests a Cloudflare Workers build through OpenNext, which can run a Next.js App Router app, but no page says so, and no page lists a size, CPU or request-time limit. A fullstack app does run server code (its MCP endpoint needs "a server to answer on it"). |
| Database | Managed Postgres per fullstack app; the version is not stated. Its connection string is pushed into the app's environment as `DATABASE_*` variables (platform-managed, we cannot set or read them). From outside: `POST /v1/apps/{id}/db/query` runs SQL (30 s per statement), a REST layer per table, and a migration ledger (`…/db/migrations`, named, immutable SQL; or `migrations:` files in a `naive.config`). No connection string is ever handed to us, so seeding goes through `db/query`. |
| Env and secrets | `POST /v1/apps/{id}/secrets { name, value }`, write-only, never read back. |
| Domain | The app gets a live `url` from the platform (format not documented). A custom domain points an existing org domain at the app (`POST /v1/apps/{id}/domains`); our only domain is the system one, `new-company-qffcxs.usenaive.ai`. |
| Access gate | Optional `DASHBOARD_PASSWORD` / `DASHBOARD_TOKEN` gate. We would **not** declare them: judges must reach the app with no naïve password. |

## Price

- App hosting, its database and `db/*` calls have **no published price**: pricing lists no app or hosting line, and says `/v1/apps/{id}/db/*` calls "carry no price of their own". Object storage: "no rate is published yet, so nothing is booked". We would not use storage.
- The org needs its plan (already active, the account has credit). Nothing about the sandbox calls a model, a browser, email or voice on naïve.
- **Expected naïve spend: $0.00** for create, deploys, secrets, the database and judge traffic, as documented today. Risk: an unpublished rate appearing later. Recheck the balance (`billing:read`) before and after, and record the numbers here.

## Open risks

1. Whether the build runs our Next.js 16 app at all (App Router, server actions, `pg` over TCP, `node:crypto` scrypt, reading `data/replay/run.jsonl`). On Workers, `pg` needs `nodejs_compat` and files must be bundled, not read from disk. Only a real deploy answers this.
2. The monorepo: the dashboard imports `@bill-fighter/db`, `core`, `shared` from workspace source (`.ts`). The deploy is one file map, so we would ship the repo subset the dashboard needs plus the lockfile, and hope the build runs `pnpm`. Not documented.
3. Postgres version unknown; our migrations use `gen_random_uuid()` (core since PG 13).

## What the probe showed (2026-11-08 UTC, after the human's go)

- **Runtime: Vercel.** A deploy is built with `npm run build` and served by Vercel (deployment URLs are `*.vercel.app`), with **Node 26.13.0** and `NEXT_RUNTIME=nodejs`. Next.js App Router, server actions and `pg` run unchanged. Vercel refuses a Next.js version with a known vulnerability ("Vulnerable version of Next.js detected"); 16.4.5 is accepted. Plain npm, no pnpm workspaces, so `scripts/sandbox-bundle.ts` packs the dashboard with `core`, `db` and `shared` as `file:` dependencies.
- **Database: Supabase Postgres 17.11** through `DATABASE_URL` (port 5432, `?sslmode=require`), plus `DATABASE_REST_URL` and `DATABASE_SERVICE_KEY`. Every `DATABASE_*` name is platform-managed, so our own settings are `PG_CA` and `PG_POOL_MAX`. The certificate chain is Supabase's own root ("Supabase Root 2021 CA", public, sha256 `80:70:25:AD:…:CA:FA`), so `pg` with the system CAs refuses it. The app verifies against that CA through `PG_CA` (`packages/db/src/client.ts`); verification stays on.
- **App:** `clawback-sandbox`, id `app_1hzp4arjghgndxtd91tm2qg5p4`, URL `https://clawback-sandbox-2e3cr9qffcxs.vercel.app`.
- **Secrets on the app:** `SANDBOX=1`, `VAULT_KEY` (fresh random, not any local one), `PUBLIC_HOST`, `PG_CA`, `PG_POOL_MAX=2`. No naïve agent key, no Retell, Vapi, Stripe or Anthropic key.
- **Schema and seed** went in through `POST /v1/apps/{id}/db/query` from `scripts/sandbox-seed-sql.ts` (migrations 0000–0004, then the demo customer's rows: 1 customer, 12 locations, 37 accounts, 448 bills, 940 bill lines, 21 phone lines; no usage intervals).
- **Rate limits:** the API often answered `429 rate_limited` ("the service is at capacity") on deploys and SQL; a retry a minute later went through.
- **Serverless connections:** each Vercel instance holds its own `pg` pool against a 60-connection database. `PG_POOL_MAX=2` caps it, idle connections close after 2 s, and the pool listens for `error`: a frozen instance's idle connection gets dropped, and with no listener that crashed the function ("This page couldn't load", "Connection lost").
- **Result (03:51 UTC):** `scripts/sandbox-check.ts` against the URL above, two judges at once (one desktop, one 390×844 phone): each got its own run, reached refund $12,606.06 / savings $18,319.32 / fee $9,277.61, in 189 s.

## Proposed probe (done: approved and run as below)

One `fullstack` app named `clawback-sandbox`, one throwaway deploy of a hello-world Next.js page that reads `select version()` from its database, then the real deploy. Expected spend $0.00 per the docs. If the hello-world build fails or cannot reach Postgres, stop and report options (see `.fleet-lane/questions.md`).

## Spend record

| When | What | Balance before | Balance after |
|---|---|---|---|
| 2026-11-08 03:17 UTC | before creating anything | $247.083550 | |
| 2026-11-08 03:23 UTC | app created, 4 probe deploys | $247.083550 | $247.083550 |
| 2026-11-08 03:52 UTC | schema and seed SQL, 5 secrets, 3 real deploys, judge checks | $247.083550 | $247.083550 |

**naïve spend so far: $0.00.**
