# Never Ask Twice

Enterprise Support MemoryAgent on Qwen Cloud

![License: Apache-2.0](https://img.shields.io/badge/License-Apache--2.0-blue.svg)
![TypeScript](https://img.shields.io/badge/TypeScript-5.x-blue)
![Runtime](https://img.shields.io/badge/Runtime-Node.js%2020-green)
![Cloud](https://img.shields.io/badge/Cloud-Alibaba%20Function%20Compute-orange)
![Model](https://img.shields.io/badge/Model-Qwen%20Cloud-purple)
![Memory](https://img.shields.io/badge/Memory-Working%20%7C%20Episodic%20%7C%20Semantic-black)
![MCP](https://img.shields.io/badge/MCP-4%20tools-black)

Never Ask Twice is a production-shaped B2B support memory agent that remembers customer context across sessions, retrieves only the memories that matter, forgets stale facts safely, and proves improvement with a live memory ON/OFF evaluation.

The demo agent is **Nat** — short for Never Ask Twice. Nat remembers what customers already told support: their SLA tier, product configuration, escalation preference, open issues, and promised follow-ups. When the customer returns days later, Nat does not restart from zero.

## The result

Re-ask rate: **0.00** with memory  
Re-ask rate: **1.00** without memory

The improvement is not asserted in the README. It is produced by the evaluation harness:

```bash
pnpm eval
```

Built for the Qwen Cloud Global AI Hackathon — Track: MemoryAgent.

## What makes it a MemoryAgent

Never Ask Twice implements explicit memory tiers:

- **Working memory** — current-session context.
- **Episodic memory** — raw support events with Qwen embeddings and provenance.
- **Semantic memory** — distilled customer facts with confidence, validity windows, and source links.
- **Forgetting policy** — TTL expiry, supersession, stale-memory exclusion, and audit-safe provenance.
- **Budgeted recall** — relevant memories only, capped to a strict context budget.
- **MCP surface** — memory tools exposed for agent interoperability.

This is not transcript logging. It is structured memory with retrieval discipline, provenance, forgetting, and measurable cross-session improvement.

## Architecture

```
┌─────────────┐     ┌─────────────┐     ┌─────────────────────────────┐
│  Customer   │────▶│  Hono API   │────▶│  Memory Service             │
│  chat / MCP │     │  on FC      │     │  (working, episodic,        │
└─────────────┘     └─────────────┘     │   semantic, forgetting)     │
                                        └─────────────┬───────────────┘
                                                      │
                              ┌───────────────────────┼───────────────────────┐
                              ▼                       ▼                       ▼
                        ┌───────────┐         ┌───────────┐         ┌───────────┐
                        │ Qwen Cloud │         │ Postgres  │         │  MCP stdio │
                        │ DashScope  │         │ + pgvector │         │  4 tools   │
                        └───────────┘         └───────────┘         └───────────┘
```

## Getting started

### 1. Clone and install

```bash
git clone https://github.com/marcelle-labs/never-ask-twice.git
cd never-ask-twice
pnpm install
```

### 2. Configure environment

```bash
cp .env.example .env
```

Edit `.env` and set your `DASHSCOPE_API_KEY` from [DashScope](https://dashscope.aliyun.com). The example is pre-filled for local Postgres on port 5433.

```
DATABASE_URL=postgresql://neverasktwice:neverasktwice@localhost:5433/neverasktwice
DASHSCOPE_API_KEY=your-key-here
QWEN_BASE_URL=https://dashscope-intl.aliyuncs.com/compatible-mode/v1
QWEN_CHAT_MODEL=qwen-plus
QWEN_EMBEDDING_MODEL=text-embedding-v3
QWEN_EMBEDDING_DIM=1024
MEMORY_TOKEN_BUDGET=1200
```

### 3. Start Postgres

```bash
docker compose up -d
```

The local database binds to `localhost:5433` so it does not collide with other Postgres services on `5432`.

### 4. Run migrations

```bash
pnpm migrate
```

### 5. Run the eval harness

```bash
pnpm eval
```

Expected output:

```
memory-on re-ask rate: 0.00
memory-on recall accuracy: 1.00
memory-on hallucination count: 0
memory-off re-ask rate: 1.00
memory-off recall accuracy: 0.00
memory-off hallucination count: 0
re-ask rate: 0.00 (memory) vs 1.00 (no-memory)
```

### 6. Run the boundary scan

```bash
pnpm boundary-scan
```

### 7. Start the local API

```bash
pnpm dev
```

The API will be available at `http://localhost:3000` with endpoints:

- `GET /health` — health check
- `POST /turn` — append a customer/agent turn
- `POST /sessions/:id/close` — close a session and distill episodic → semantic memory
- `POST /recall` — recall a bounded memory bundle

### 8. Run the MCP server

```bash
pnpm build
node dist/src/mcp/server.js
```

The MCP server exposes four tools: `recall_memory`, `write_memory`, `distill_session`, and `forget`.

## Project structure

- `apps/api` — Hono API and demo surface
- `packages/contracts` — Zod schemas and shared types
- `packages/db` — Drizzle schema and migrations
- `packages/memory` — memory services and retrieval logic
- `packages/eval` — eval harness
- `packages/mcp` — stdio MCP surface
- `src` — canonical implementation shared by the API and MCP
- `eval` — frozen three-session scenario, ground truth, and expected output
- `scripts` — boundary scan, migration, demo script check

## Key commands

| Command | Purpose |
|---|---|
| `pnpm install` | Install dependencies |
| `pnpm build` | Build the project |
| `pnpm lint` | Run TypeScript type check |
| `pnpm test` | Run the test suite |
| `pnpm eval` | Run the memory ON/OFF eval harness |
| `pnpm migrate` | Run database migrations |
| `pnpm boundary-scan` | Run the clean-room boundary scan |
| `pnpm mcp:list-tools` | List the MCP tools |
| `pnpm demo:script-check` | Verify demo fixtures are aligned |

## License

Apache-2.0
