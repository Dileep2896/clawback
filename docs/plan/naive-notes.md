# naïve recon notes (M10)

Lane `naive-recon`, 2026-11-07. I read the docs as raw Markdown with `curl` (`https://usenaive.ai/docs/<path>.md`; the index is at `https://usenaive.ai/docs/llms.txt`). The pages link to `vetta.sh/docs/...`, which is the same content. The live account was checked only with GET calls, plus the two free creates listed under "Account state".

## The basics

| What | Value |
|---|---|
| SDK package | `@usenaive-sdk/managed-agents` **0.12.3**, ESM only, its only dependency is `zod`. `@usenaive-sdk/vetta` is the old name. |
| Client | `createClient({ baseUrl: "https://api.vetta.sh", apiKey: process.env.NAIVE_API_KEY })` |
| CLI | `@usenaive-sdk/cli` **1.0.3** (`naive ...`). Not needed by our code. |
| REST | `https://api.vetta.sh/v1/...`, header `Authorization: Bearer sk_live_...`. The SDK also sends `Vetta-Version` and an `Idempotency-Key` on writes. |
| Money | Integer micro-USD on the wire (`*_micro_usd`, 1 USD = 1,000,000). Our cents need a ×10,000 conversion in the adapters. |
| Key check | `GET /v1/me` |

## Account state (checked live)

- Org `org_jv75x1hmnp8p0d2e3cr9qffcxs`, named **"New company"**, mode `live`. This matches `NAIVE_COMPANY_ID`. No second company was created.
- **Our API key's scopes:** `agents:read agents:write sessions:read sessions:write` only. It has no `audit:read`, `billing:read`, `billing:write`, `webhooks:*`, `computers:write` or `admin`. See the blockers below.
- Before this lane the org had no identities, agents, domains or vaults.
- **Created (both free, no DNS, no credit):**
  - Identity `Clawback`, id `idn_8jjf45tqdqqq8r966n3sfgcch5`. I set `NAIVE_IDENTITY_ID` in the worktree `.env`. Copy it to the root `.env`.
  - System domain `new-company-qffcxs.usenaive.ai`, id `dom_hkragd1xb361my9qtwz6yndvcp`. It is named after the org slug. `inbound_status: verified`; `dns_status` was still `pending_verification` a few minutes after creation (needed before we can **send**). Recheck with `GET /v1/domains/{id}`.
- **Not created:** inbox, agents, vault, card, phone number. The reasons are below.

## Section 5 interfaces on naïve

| Interface | naïve name and API | Scope | Usable Saturday? |
|---|---|---|---|
| `AgentRuntime` | An agent with `multiagent: { type: "coordinator", agents: [...], board: true }` (`POST /v1/agents`, `client.agents.create`), run as a session (`POST /v1/sessions`, `client.sessions.*`). Members are delegated to with `send_to_agent` (`wait: true`), and delegation is one level deep. | agents/sessions:write | Yes, but our tools need a public MCP server (see Blocker 1). |
| `ApprovalGate` | The tool policy `tools.configs.<name>.permission = "ask"` makes the session idle with `stop_reason: "awaiting_approval"` and `pending_actions[]`. Each action is answered with `client.sessions.confirmTool(sid, { tool_call_id, decision: "allow" })` or `naive session confirm --session --tool-call --allow`. | sessions:write | Yes. See "One approval releases the bundle". |
| `Mail` | Inbox `POST /v1/identities/{id}/emails` (`client.emails.create`; `owning_agent_id` is required and `wake` defaults to true). Send with `POST /v1/identities/{id}/emails/{eid}/send` (`client.emails.send`), $0.0008 a send. Read inbound with `GET /v1/identities/{id}/messages`. | agents:write | Yes, once DKIM is provisioned for sends. |
| `Sms` | Number `POST /v1/identities/{id}/phones` (a purchase). Send is `.../phones/{pid}/send` and always answers **501 feature_not_configured**. Inbound appears in `GET /v1/identities/{id}/messages`. | billing:write to buy | Send: **no**. Inbound: only if a number is bought (see Q2). |
| `Browser` | A managed browser on a **computer**: `POST /v1/computers/{id}/browser/actions` (goto/click/type...), and `.../browser/login` fills `%username%`/`%password%` from the identity's `login:<service>` credential. $0.10 an hour. Refuses private and loopback hosts. | computers:write | Not with our key. Keep Playwright (see Blocker 3). |
| `Vault` | `POST /v1/vaults` and `/v1/vaults/{id}/credentials`. Kinds are `static_bearer` and `mcp_oauth` only (`env_var` answers 501). There is no reveal route. | **admin** | Only for our MCP server's bearer token. Portal logins: **no**. |
| `Card` | `POST /v1/identities/{id}/cards/quote`, `POST .../cards`, `.../transactions` | billing:write | **No.** Issuing answers 501 (see the card terms). |
| `Board` | The board belongs to an agent: `client.board.*`, `/v1/...board` routes. Card status is `todo, doing, blocked, done`, which matches our `board_card_status` enum exactly. | agents:read/write | Yes. Mirror it to `board_cards`. |
| `Audit` | `GET /v1/audit_logs` (control-plane actions such as `policy.denied` and `session.interrupted`). Tool calls and confirm decisions, with the approver, are in the session **events** (`GET /v1/sessions/{id}/events`, stream with `fromSeq`). | **audit:read** for the logs | Events: yes. Audit logs: needs a new key. |
| `Budget` | The agent's `budget: { cap_micro_usd, max_task_micro_usd, period }`. A session reports `session.usage` with `consumed_micro_usd`. Every call is priced before it runs. | agents:write | Yes. |
| `Scheduler` | Deployment `POST /v1/deployments` with `cron`, `timezone` and `input_template`; `POST /v1/deployments/{id}/run` fires one now. | agents:write | Yes. |
| `Identity` | `GET /v1/identities/{id}` (name, emails, phones) | agents:read | Yes. |
| `Llm` | The model router: `anthropic/claude-haiku-5.5` is in `GET /v1/models`, and `POST /v1/proxy/anthropic/v1/messages` is billed to credits. | - | Keep local (Claude Code login). Moving it is optional. |

## The earlier notes, checked

1. **One approval, many tools: CONFIRMED (per call).** Each `ask` pauses one tool call and needs its own confirm. Nothing bundles calls. `--for-session` grants **one tool name** for the rest of a session, which does not cover six different tools. The fix is in "One approval releases the bundle" below.
2. **Outbound SMS not available: CONFIRMED.** Every send (API, CLI, SDK and the `phone.send` tool) answers `501 feature_not_configured`. Before campaign approval it answers `compliance_pending`.
3. **Inbound SMS: CONFIRMED that it works once a number is bought. The docs no longer disagree.** The phone, identity overview and capabilities pages now all say inbound SMS is stored and wakes the number's `owning_agent_id`. Carrier registration: numbers run under naïve's **one shared registration**, our own brand is not available, and `legal_name` must be **that shared registration's legal name** (not published, so we would have to ask naïve). Inbound works as soon as the number is bought; only outbound waits on the campaign. **The price of a number is not published** (the pricing page has no phone line). An org can hold at most 3 numbers. Buying needs `billing:write`, which our key lacks. Not tested: no number was bought.
4. **No voice in naïve: CONFIRMED.** No voice calling appears in the phone, identity or tools docs. Voice stays on Retell or Vapi.
5. **Inbound email wakes the inbox owner, and connection webhooks do not: CONFIRMED.** This means `project.md` §12 ("naïve inbound mail does not auto-wake agents yet") and §16 step 5 ("point the naïve inbound mail webhook at services/webhooks/inbound") are **wrong**. naïve has no inbound-mail webhook to our server. Its webhooks only push session events (`session.idle`, `budget.exceeded`...) to a public HTTPS URL. **Plan:** create `bills@` with `wake: false`, so mail is stored and no naïve session starts. Our service polls `GET /v1/identities/{id}/messages` and posts each new message to `services/webhooks/inbound`, which keeps one trigger path for both modes. This also avoids the trap described under Blocker 1.
6. **Inbound guards: CONFIRMED.** SPF, DKIM and DMARC must pass or the message is dropped. A wake is limited to 5 an hour per sender and 20 an hour per inbox, mail from our own persona never wakes, and a thread stops waking after 10 turns a day. With `wake: false` and polling, the rate limits and loop rules stop mattering, because held messages are still stored and listed. Authentication still applies, so a fake external "BayCurrent Electric" sender would be dropped. **demo-start in naïve mode** must send from a second inbox on our own system domain (for example `baycurrent-billing@...`) to `bills@`, or keep sending through Mailpit and post to the webhook as local mode does.
7. **Public reachability: CONFIRMED by the docs.** The naïve browser refuses "a private, loopback or metadata host" (403). Webhook URLs and MCP server URLs must be public HTTPS, and `localhost`, `*.local` and private IPs are refused.
8. **Team config: CONFIRMED.** `multiagent: { type: "coordinator", agents: [...], board: true }`. Delegation is one level deep (a member cannot delegate with `wait: true`). The policy lives in `tools: { default_config, configs }` on each agent. There is no organization-wide policy.
9. **Docs access: CONFIRMED and resolved.** `vetta.sh` is the old name. Every page is plain Markdown at `usenaive.ai/docs/<path>.md`, and `curl` works.

## One approval releases the bundle (written answer)

naïve has no bundle confirm. `ApprovalGate` stays **ours**, and naïve's `ask` is driven from it:

1. Gated tools get `permission: "ask"` and every other tool gets `allow`. The first gated call parks the session (`stop_reason: awaiting_approval`, `pending_actions[]`, each with `tool_call_id`, `name` and `args`).
2. Linda approves our `approvals` row once, by dashboard tap or by SMS YES (see Q2). This is the single human decision, recorded with `channel` and `approvedBy`.
3. A loop in the naïve `approval-gate`/`agent-runtime` adapter watches `session.idle` or `tool.confirm` (event stream or `GET /v1/sessions/{id}`). For each `pending_actions[]` row with `kind: "tool"`, it calls `confirmTool(..., "allow")` if `args.actionId` is in an **approved** bundle (`isReleased(actionId)`), and `"deny"` if it is not. The adapter branches on `kind`, never on `name`, as the docs warn. Later gated calls in the same run park again and are released by the same rule, so Linda never sees a second prompt.
4. naïve records our API key (`key_rwkj0j620035h2ex5pwpz3np6r`) as the approver on each confirm event. The person is in our `approvals` row, and the adapter writes both to `audit_log`.

Delegated members run in threads of the coordinator's session, so their parked calls should appear on the same session. This is **unverified**: test it with one member call in `naive-runtime-adapter`.

## Blockers and what can't work Saturday (with fallbacks)

**Blocker 1. Our tools can only reach a naïve agent through a public MCP server.** naïve's "custom tools" (run by our app) are listed as **Coming soon**. A naïve agent can only call built-ins, connections or an **MCP server at a public HTTPS URL**. Our `ToolDef` handlers (DB writes, portal downloads, Stripe, voice) run in our process. So `naive-runtime-adapter` must serve the run's tools as an MCP server behind the public tunnel from `naive-public-endpoints`, authenticated by a `static_bearer` credential in a naïve vault (this needs the `admin` scope). MCP tools default to `ask`; the ungated ones get an explicit `allow`.
- **Trap:** once a chat has read mail or messages, **every MCP tool asks on every call, even at `allow`**. The coordinator must never read the inbox itself. That is why the inbound plan uses `wake: false` plus polling, with the bill text sent in as the session's first message.
- **Fallback:** `PLATFORM=local`.

**Blocker 2. The API key lacks scopes.** We need a new key (the human makes it in the naïve dashboard) with `agents:*`, `sessions:*`, plus `audit:read` (Audit mirror), `webhooks:*` (session events), `admin` (vault for the MCP bearer), `billing:read` (show credit) and `computers:write` (only if we use the naïve browser). `billing:write` is needed only to buy a number or a card. Keep that out of the key the app uses.

**Blocker 3. Browser and vault cannot hold the portal logins as specified.** A vault holds only MCP bearer and OAuth tokens. The naïve browser's `login:<service>` credential has no documented route to create it, and the browser will not open a private host. **Fallback:** the Collector keeps **Playwright and our local vault** (credentials referenced by name, never by value, as today), run from our MCP tool. naïve vault is still shown on stage, holding the MCP server token. I did **not** store the portal logins in the naïve vault, because it cannot hold them.

**Card: not available.** Docs: "Card issuing is not configured on the hosted service yet": quote, issue, retry and reveal answer `501 feature_not_configured`, and no credit moves. Terms for when it is turned on: a **prepaid** card loaded once with $1 to $150 from org credits, plus an issuer fee shown by `POST .../cards/quote` (example: a $50 load costs 50.50). It is never reloaded, and spend is logged by us (`.../transactions`, the card refuses spend over its load). There is no live authorisation feed. Issuing needs `billing:write`. **Fallback:** the local mock card (hard cap 5 USD, writes `card_spend`). `check-platform` reports the naïve card as not available, not as a pass.

**Outbound SMS: not available.** **Fallback** (the default plan): the Approver emails Linda through `Mail`, and she approves by dashboard tap, or by SMS YES if a number is bought and the polling test passes.

**Voice: not on naïve.** **Fallback:** our Retell/Vapi stack, unchanged.

**Postgres:** naïve managed Postgres is tied to a naïve app. Not worth it Saturday. Keep the Docker Postgres.

## Questions for the human (via orchestrator)

- **Q1 (key):** Can the human create an API key with the scopes in Blocker 2? Without `audit:read`, `webhooks:*` and `admin`, the runtime adapter cannot mirror audit entries, receive session events or store the MCP bearer.
- **Q2 (number):** Should we buy a number? The price is not published. It needs a `billing:write` key and naïve's shared-registration legal name (ask naïve support or the hackathon desk). Inbound works as soon as it is bought, with no carrier wait for receiving. Without it, approval is the emailed request plus the dashboard tap.
- **Q3 (org name):** The org is named "New company", so the free system domain and the `bills@` address read `...@new-company-qffcxs.usenaive.ai` on screen. Rename the org before we create inboxes? The system domain is already minted under the old slug; it is unclear whether a rename re-mints it. A custom domain needs DNS.

## Reshaping the later lanes

- `naive-public-endpoints`: also expose the **MCP tool server** URL, not only the portal and webhook. The webhook is for naïve **session events**, not inbound mail. The portal may not need to be public if the Collector stays on Playwright.
- `naive-io-adapters`:
  - `mail.ts`: create the inbox with `wake: false` and poll the inbound messages.
  - `sms.ts`: send throws or reports not available; `receive` stays as it is.
  - `browser.ts` and `vault.ts`: re-export local.
  - `card.ts`: local mock with an honest note.
  - `scheduler.ts`: deployment.
  - `identity.ts`: GET the identity.
  - The "card shows card_spend" check is met by the local mock only.
- `naive-runtime-adapter`: the MCP server plus the coordinator and roster agents, the approval loop above, and event-stream mirroring to `board_cards` and `audit_log`. This is the biggest lane and the riskiest; it needs the new key first.
