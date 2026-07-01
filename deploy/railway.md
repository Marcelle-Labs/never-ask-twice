# Railway Deployment

Never Ask Twice's primary judge-facing deployment runs on Railway. The app is deploy-target-agnostic — `apps/api/src/db.ts` opens a plain `pg.Pool` from `DATABASE_URL`, so Railway and Alibaba Function Compute run the same `dist/` build with no code changes between them. See [`alibaba-fc.md`](alibaba-fc.md) for the FC swap-over path, which becomes the preferred target once Alibaba ID verification clears (tracked separately).

> Status: live. Build, deploy, and a full turn → close → recall cycle are verified against the hosted URL.

## Pre-requisites

1. A Railway account and project, GitHub-connected to this repo.
2. A Neon (or other) Postgres database with `pgvector` reachable from Railway — `pnpm migrate` has already been run against it.
3. The [Railway CLI](https://docs.railway.com/guides/cli) for local verification and env var management (optional; the dashboard works too).

## Service configuration

| Setting | Value |
|---|---|
| Build Command | `pnpm build` |
| Start Command | `pnpm start` (`node dist/apps/api/src/server.js`) |
| Watch Paths | unset (any push rebuilds) |
| Root Directory | repo root |

Config is tracked as code in [`.railway/railway.ts`](../.railway/railway.ts) via the Railway SDK (`railway config plan` / `railway config apply`).

## Environment variables

Same set as the FC path, minus `ALIBABA_REGION`:

| Variable | Purpose |
|---|---|
| `DATABASE_URL` | Postgres connection string (Neon) |
| `DASHSCOPE_API_KEY` | Qwen Cloud API key |
| `QWEN_BASE_URL` | `https://dashscope-intl.aliyuncs.com/compatible-mode/v1` |
| `QWEN_CHAT_MODEL` | e.g. `qwen-plus` |
| `QWEN_EMBEDDING_MODEL` | `text-embedding-v3` |
| `QWEN_EMBEDDING_DIM` | `1024` |
| `MEMORY_TOKEN_BUDGET` | `1200` |

## Deploy

Push to `main` (Railway redeploys automatically), or deploy the current local tree directly:

```bash
railway up
```

## Verify after deployment

```bash
export RAILWAY_URL=https://never-ask-twice-production.up.railway.app

curl -fsS "$RAILWAY_URL/health"
```

## Proof block

```text
Railway URL: https://never-ask-twice-production.up.railway.app
Verified at: 2026-07-01, deployment fa6acbf9 (build SUCCESS)

/health: {"ok":true,"qwenConfigured":true,"databaseConfigured":true,"mode":"qwen-live"}

Landing page (/) and chat CSS (/static/index.css) confirmed serving real assets,
not the no-CSS fallback, after the asset-copy build fix.

Canonical demo scenario (accountId=acme_corp, customerId=jason_99) seeded for real
against the live Neon DB by replaying the frozen scenario-1 message through the
live API (POST /turn -> POST /sessions/:id/close), not a script that bypasses it:

  4 semantic facts written, all durable (no expires_at):
    sla_tier            = gold
    product_config      = SSO
    integration         = Salesforce
    escalation_contact  = Priya

GET /eval-snapshot on the live URL:
  {"ok":true,"memoryOnReaskRate":0,"memoryOffReaskRate":1,"factsCount":4,"missingPredicates":[]}

This is the ablation contrast the demo video needs (0.00 vs 1.00), verified live,
not just in the deterministic eval fixture.
```

## Known gaps vs. the FC path

- No custom domain yet — judges click the Railway-generated `*.up.railway.app` URL.
- Cold start is not a concern on Railway (long-lived container), unlike FC.

## Troubleshooting

- If the build fails on `prepare` with `fatal: not in a git directory`, the checkout has no `.git` — `scripts/install-hooks.mjs` now no-ops in that case; if this recurs, check the script wasn't reverted.
- If the build succeeds but the deploy crash-loops with `node: ../../.env: not found`, the Start Command reverted to `pnpm dev` — it must be `pnpm start`.
- If `/` or `/static/index.css` 500s or serves the bare fallback, the asset-copy step (`scripts/copy-api-assets.mjs`, wired into `apps/api`'s `build` script) didn't run — confirm `dist/apps/api/src/ui/landing.html` exists after `pnpm build`.
- If pushes stop deploying (`railway deployment list --json` shows `SKIPPED` / `"No changes to watched files"` even for real changes), the service's Watch Paths field has been reset — clear it in the dashboard (Settings → Build & Deploy → Watch Paths). `railway config apply` cannot reliably unset this field via the CLI; it reports success without the change actually persisting. Always re-run `railway config plan` after `apply` to confirm before trusting it.
- If `POST /sessions/:id/close` 500s with a Zod `invalid_enum_value` on `predicate`, real Qwen distillation returned a predicate outside `MemoryPredicateSchema` (e.g. `customer_name`). Fixed by dropping invalid candidates individually (`safeParse`, not `parse`) at both `QwenClient.distill()` and `MemoryService.closeSession` — if this recurs, one of those two call sites reverted to `.parse()`.
- If `/sessions/:id/close` returns `factsDistilled: 0` for a message that clearly states account facts, check `railway logs` for `[qwenClient.distill] dropping candidate that failed schema validation`. If every candidate fails with several `Required` field errors (not just a bad predicate), the model isn't returning the shape the schema expects — confirm the system prompt in `qwenClient.ts` still enumerates the exact predicate/predicateClass values and field list; it was previously just "use the approved predicate names" with no schema given at all.
