# Architecture

Never Ask Twice is a B2B support MemoryAgent. The system is intentionally small: a Hono API, a shared memory service, Qwen Cloud calls, Postgres with pgvector, and an MCP stdio surface over the same memory service.

## Request flow

```text
Customer turn
  -> Hono API on Alibaba Function Compute
  -> MemoryService
     -> working memory for current-session facts
     -> episodic memory for raw support events
     -> semantic memory for durable distilled facts
     -> forgetting logic for supersession and TTL expiry
  -> Neon Postgres + pgvector (us-east-1)
  -> Qwen Cloud for embeddings, session distillation, and conflict adjudication
```

## Components

| Component | Responsibility |
|---|---|
| `apps/api` | Hono API, local dev server, and Alibaba Function Compute handler (`server.handler`). |
| `src/memory` | Shared memory service used by API, eval, and MCP. Implements all three tiers plus forgetting. |
| `src/agent` | Support agent (`runSupportTurn`): recalls context, detects missing required predicates, returns cited facts. |
| `src/qwen` | Single Qwen Cloud client using the DashScope OpenAI-compatible base URL. Handles embeddings, distillation, and conflict adjudication. |
| `src/db` | Drizzle schema plus SQL migration for Postgres + pgvector (Neon). |
| `src/mcp` | stdio MCP server exposing memory tools (`recall`, `distill_session`, `forget`) without duplicating memory logic. |
| `eval` | Three-scenario deterministic harness: basic recall (Acme), supersession (Globex), TTL forgetting (Initech). Aggregate metrics across all three. |

## Memory tiers

- **Working memory:** facts stated in the current session before close/distillation.
- **Episodic memory:** raw events with embeddings and provenance.
- **Semantic memory:** distilled facts with confidence, validity windows, and source links.
- **Forgetting:** expired and superseded facts are excluded from recall without deleting provenance.

## Deployment shape

The intended judge-facing deployment is Alibaba Cloud Function Compute running Node.js 20. The root `s.yaml` points FC at `dist/apps/api/src/server.handler` after `pnpm build`.

The live path requires:

- `DATABASE_URL`
- `DASHSCOPE_API_KEY`
- `QWEN_BASE_URL=https://dashscope-intl.aliyuncs.com/compatible-mode/v1`
- `QWEN_CHAT_MODEL`
- `QWEN_EMBEDDING_MODEL=text-embedding-v3`
- `QWEN_EMBEDDING_DIM=1024`
- `MEMORY_TOKEN_BUDGET=1200`

## Local-safe mode

When `DASHSCOPE_API_KEY` is absent, the API still boots for local inspection. It returns zero-vector embeddings and empty distillation responses. That mode is for runnability only; it is not real Qwen work. Use `pnpm eval` for deterministic local scoring without secrets.
