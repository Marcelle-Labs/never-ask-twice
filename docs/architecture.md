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
  -> Postgres + pgvector
  -> Qwen Cloud for embeddings, distillation, adjudication, and live response generation
```

## Components

| Component | Responsibility |
|---|---|
| `apps/api` | Hono API, local dev server, and Alibaba Function Compute handler. |
| `src/memory` | Shared memory service used by API, eval, and MCP. |
| `src/qwen` | Single Qwen Cloud client module using the DashScope OpenAI-compatible base URL. |
| `src/db` | Drizzle schema plus SQL migration string for Postgres and pgvector. |
| `src/mcp` | stdio MCP server exposing memory tools without forking memory logic. |
| `eval` | Deterministic memory ON/OFF harness with hidden ground truth. |

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
