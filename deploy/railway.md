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
Verified at: 2026-06-30, shortly after deployment 231c571d (build SUCCESS at 22:35:39 UTC)
/health: {"ok":true,"qwenConfigured":true,"databaseConfigured":true,"mode":"qwen-live"}
Turn -> Neon write -> agent response (smoke test, account "deploy_check"):
  POST /turn -> 201, sessionId returned, eventId returned,
  answer: "To get started, I'll need a few details — what SLA tier you're on, ..."
Landing page (/) and chat CSS (/static/index.css) confirmed serving real assets,
not the no-CSS fallback, after the asset-copy build fix.
```

## Known gaps vs. the FC path

- No custom domain yet — judges click the Railway-generated `*.up.railway.app` URL.
- Cold start is not a concern on Railway (long-lived container), unlike FC.

## Troubleshooting

- If the build fails on `prepare` with `fatal: not in a git directory`, the checkout has no `.git` — `scripts/install-hooks.mjs` now no-ops in that case; if this recurs, check the script wasn't reverted.
- If the build succeeds but the deploy crash-loops with `node: ../../.env: not found`, the Start Command reverted to `pnpm dev` — it must be `pnpm start`.
- If `/` or `/static/index.css` 500s or serves the bare fallback, the asset-copy step (`scripts/copy-api-assets.mjs`, wired into `apps/api`'s `build` script) didn't run — confirm `dist/apps/api/src/ui/landing.html` exists after `pnpm build`.
