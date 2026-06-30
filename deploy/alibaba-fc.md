# Alibaba Cloud Function Compute Deployment

Never Ask Twice is designed to deploy to Alibaba Cloud Function Compute (FC) via the root `s.yaml`. **FC is the preferred target but is not the current judge-facing URL** — it's blocked on Alibaba ID verification (KYC), not on app readiness. The live, judge-clickable URL today is Railway: see [`deploy/railway.md`](railway.md) and the README Status table. Swapping from Railway to FC once KYC clears is a `DATABASE_URL` config change and a redeploy, not a code change.

> Status: deployment instructions are present and verified deployable in shape. Final FC deployment proof (live FC URL plus successful `/health` and Qwen-backed API evidence) is still pending Alibaba account verification.

## Proof of Alibaba Cloud deployment (Devpost submission requirement)

Per the [official hackathon rules](https://qwencloud-hackathon.devpost.com/rules), proof of Alibaba Cloud deployment is satisfied by a code-file link demonstrating real use of Alibaba Cloud services and APIs — it does not require the backend to be live on Alibaba Cloud at judging time. The working-demo link required separately in Testing has no platform restriction, and that link is Railway today.

For the Devpost submission's proof-of-deployment field, link both of these together:

- [`apps/api/src/server.ts#L415-L483`](https://github.com/Marcelle-Labs/never-ask-twice/blob/main/apps/api/src/server.ts#L415-L483) — the `handler()` export: adapts Alibaba FC's event/context request shape to the same Hono app (`app.fetch`) that serves every other deploy target, and converts the response back to FC's expected `{statusCode, headers, body, isBase64Encoded}` shape.
- [`s.yaml`](https://github.com/Marcelle-Labs/never-ask-twice/blob/main/s.yaml) — the Alibaba FC deployment manifest pointing at that exact handler (`dist/apps/api/src/server.handler`).

This project is deploy-target-agnostic by design (see [`docs/architecture.md`](../docs/architecture.md)) and runs against Alibaba FC via this exact handler. Railway is used as the live demo endpoint during the Alibaba ID verification delay; nothing about the application changes when that clears — see "Updating the deployment" below.

## Pre-requisites

1. An Alibaba Cloud account with the hackathon coupon applied.
2. A DashScope API key for Qwen Cloud.
3. Serverless Devs CLI (`s`) installed and configured:
   ```bash
   npm install -g @serverless-devs/s
   s config add --AccessKeyID <key> --AccessKeySecret <secret> --AccountID <account>
   ```
4. A Neon or other Postgres + pgvector database reachable from Function Compute.

## Environment variables

Set these before running `s deploy`:

| Variable | Purpose |
|---|---|
| `ALIBABA_REGION` | FC region, e.g. `cn-hongkong` |
| `DATABASE_URL` | Postgres connection string |
| `DASHSCOPE_API_KEY` | Qwen Cloud API key |
| `QWEN_BASE_URL` | `https://dashscope-intl.aliyuncs.com/compatible-mode/v1` |
| `QWEN_CHAT_MODEL` | e.g. `qwen-plus` |
| `QWEN_EMBEDDING_MODEL` | `text-embedding-v3` |
| `QWEN_EMBEDDING_DIM` | `1024` |
| `MEMORY_TOKEN_BUDGET` | `1200` |

## Build and deploy

```bash
pnpm install
pnpm build
s deploy -y
```

This uploads the built `dist/` tree to Function Compute and wires the environment variables defined in `s.yaml`.

## Verify after deployment

```bash
export FC_URL=<your-function-compute-url>

# Health and capability status
curl -fsS "$FC_URL/health"
# Expected shape:
# {"ok":true,"qwenConfigured":true,"databaseConfigured":true,"mode":"qwen-live"}

# Create a session and write a turn
curl -X POST "$FC_URL/turn" \
  -H "Content-Type: application/json" \
  -d '{"accountId":"acct-1","customerId":"cust-1","sessionId":"sess-1","role":"customer","message":"Our SLA tier is gold, product config requires SSO, failing integration is Salesforce, escalation contact is Priya."}'

# Close the session and distill
curl -X POST "$FC_URL/sessions/sess-1/close" \
  -H "Content-Type: application/json" \
  -d '{"accountId":"acct-1","customerId":"cust-1"}'

# Recall in a new session
curl -X POST "$FC_URL/recall" \
  -H "Content-Type: application/json" \
  -d '{"accountId":"acct-1","customerId":"cust-1","sessionId":"sess-2","query":"Route the Salesforce outage without making me repeat the setup."}'
```

## Proof block for final submission

Do not treat this file as deployment proof until this section is filled in.

```text
FC URL: <paste live URL>
Verified at: <timestamp>
/health: <paste successful qwen-live response>
Qwen-backed request evidence: <paste redacted curl response or screenshot reference>
```

## Handler entry point

`s.yaml` points to:

```yaml
handler: dist/apps/api/src/server.handler
```

This is the `handler` export from `apps/api/src/server.ts`, which adapts the Hono app to the Function Compute request/response format.

## Cold-start and latency

Function Compute cold starts can add several seconds. The demo video is the primary artifact, so cold start is acceptable for scoring. The live URL must remain reachable during the judging window.

## Updating the deployment

```bash
pnpm build
s deploy -y
```

## Troubleshooting

- **License must be visible in the GitHub About widget before submitting.**
- **Do not commit `.env` to the repo.** Only `.env.example` is tracked.
- If `s deploy` fails, confirm the `dist/` directory exists and contains `dist/apps/api/src/server.js`.
- If `/health` reports `mode: "local-safe"`, `DASHSCOPE_API_KEY` is missing or not visible to the deployed function.
