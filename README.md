# Never Ask Twice

![Never Ask Twice](docs/assets/brand/README-hero.png)

**Support that remembers.**

Enterprise Support MemoryAgent on Qwen Cloud

![License: Apache-2.0](https://img.shields.io/badge/License-Apache--2.0-blue.svg)
![TypeScript](https://img.shields.io/badge/TypeScript-5.x-blue)
![Runtime](https://img.shields.io/badge/Runtime-Node.js%2020-green)
![Cloud](https://img.shields.io/badge/Cloud-Railway%20(live)%20%7C%20Alibaba%20FC%20pending-orange)
![Model](https://img.shields.io/badge/Model-Qwen%20Cloud-purple)
![Memory](https://img.shields.io/badge/Memory-Working%20%7C%20Episodic%20%7C%20Semantic-black)
![MCP](https://img.shields.io/badge/MCP-4%20tools-black)

**Live demo:** [never-ask-twice-production.up.railway.app](https://never-ask-twice-production.up.railway.app) — try `/chat`, or hit `/health` directly.

Customers don't want a smarter chatbot if they still have to repeat their SLA, setup, open issue, and escalation contact every time they come back.

Never Ask Twice is a production-shaped B2B support memory agent that remembers customer context across sessions, retrieves only the memories that matter, forgets stale facts safely, and proves improvement with a deterministic memory ON/OFF evaluation harness plus a live Qwen-backed API path.

The demo agent is **Nat**. Nat is powered by **NATE** — the Never Ask Twice Engine — a scoped memory layer that turns support conversations into durable, auditable customer context.

Built for the Qwen Cloud Global AI Hackathon — Track: MemoryAgent.

## Brand assets

Official logo files and usage rules live in [`docs/assets/brand`](docs/assets/brand). The public tagline is **Support that remembers.** Descriptor: **Enterprise Support MemoryAgent.**

## Status

|Area|Status|Notes|
|---|---|---|
|Public clean-room repo|Done|Synthetic data only; boundary scan included.|
|Local Postgres + pgvector setup|Done|`docker compose up -d` binds Postgres on `localhost:5433`.|
|Deterministic eval harness|Done|`pnpm eval` prints memory ON/OFF re-ask, recall, and hallucination metrics.|
|Memory service|Done|Working, episodic, semantic, forgetting, and budgeted recall paths are implemented.|
|MCP stdio surface|Done|Four memory tools are exposed through `pnpm mcp:list-tools`.|
|Qwen-backed live path|Done|Live on Railway with `DASHSCOPE_API_KEY` set; `/health` reports `mode: "qwen-live"`.|
|Railway deployment (primary live URL)|Done|[never-ask-twice-production.up.railway.app](https://never-ask-twice-production.up.railway.app) — Neon-backed, turn → close → recall cycle verified end-to-end. See [`deploy/railway.md`](deploy/railway.md).|
|Alibaba Function Compute deployment|Blocked on Alibaba ID verification (KYC)|`s.yaml` and deployment instructions exist and are deployable in shape; not the app. Swap from Railway is a `DATABASE_URL` change. See [`deploy/alibaba-fc.md`](deploy/alibaba-fc.md).|
|Demo video|Pending|Should use the frozen Acme scenario and the eval output line.|

## Judge path

1. Try the live deployment: [never-ask-twice-production.up.railway.app](https://never-ask-twice-production.up.railway.app) — `/chat` for the UI, `/health` for capability status.
2. Read the memory model: [`docs/memory-model.md`](docs/memory-model.md).
3. Run the ablation:

   ```bash
   pnpm eval
   ```

4. Inspect the forgetting behavior: [`docs/forgetting-policy.md`](docs/forgetting-policy.md).
5. Read the system architecture: [`docs/architecture.md`](docs/architecture.md).
6. List MCP tools:

   ```bash
   pnpm build
   pnpm mcp:list-tools
   ```

7. Review deployment proof: [`deploy/railway.md`](deploy/railway.md) (live, primary) and [`deploy/alibaba-fc.md`](deploy/alibaba-fc.md) (preferred target, pending Alibaba KYC).

## The measurable result

Run:

```bash
pnpm eval
```

Expected deterministic fixture output:

```text
memory-on re-ask rate: 0.00
memory-on recall accuracy: 1.00
memory-on hallucination count: 0
memory-off re-ask rate: 1.00
memory-off recall accuracy: 0.00
memory-off hallucination count: 0
re-ask rate: 0.00 (memory) vs 1.00 (no-memory)
```

The evaluation path is intentionally deterministic for reproducible scoring. It uses fixed synthetic fixtures and a fake Qwen client. The live API path uses Qwen Cloud when `DASHSCOPE_API_KEY` is configured.

## What makes it a MemoryAgent

Never Ask Twice implements explicit memory tiers:

- **Working memory** — current-session context usable before session-close distillation.
- **Episodic memory** — raw support events with Qwen embeddings and provenance.
- **Semantic memory** — distilled customer facts with confidence, validity windows, and source links.
- **Forgetting policy** — TTL expiry, supersession, stale-memory exclusion, and audit-safe provenance.
- **Budgeted recall** — relevant memories only, capped to a strict context budget.
- **MCP surface** — memory tools exposed for agent interoperability.

This is not transcript logging. It is structured memory with retrieval discipline, provenance, forgetting, and measurable cross-session improvement.

## Architecture

```text
Customer chat / MCP
        |
        v
Hono API (same code, two deploy targets:
           Railway - primary, live | Alibaba FC - swap-to-when-cleared)
        |
        v
MemoryService
  |-- working memory: current-session facts
  |-- episodic memory: turn events + Qwen embeddings
  |-- semantic memory: distilled durable facts
  |-- forgetting: TTL + supersession + scoped recall
        |
        +--> Qwen Cloud via DashScope-compatible OpenAI API
        +--> Neon Postgres + pgvector
        +--> MCP stdio tools
```

Full diagram and component map: [`docs/architecture.md`](docs/architecture.md).

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

Edit `.env` and set your `DASHSCOPE_API_KEY` from DashScope for live Qwen-backed embeddings, distillation, and adjudication. The example is pre-filled for local Postgres on port 5433.

```env
DATABASE_URL=postgresql://neverasktwice:neverasktwice@localhost:5433/neverasktwice
DASHSCOPE_API_KEY=your-key-here
QWEN_BASE_URL=https://dashscope-intl.aliyuncs.com/compatible-mode/v1
QWEN_CHAT_MODEL=qwen-plus
QWEN_EMBEDDING_MODEL=text-embedding-v3
QWEN_EMBEDDING_DIM=1024
MEMORY_TOKEN_BUDGET=1200
```

Without `DASHSCOPE_API_KEY`, the API boots in local-safe mode. Local-safe mode uses zero-vector embeddings and empty distillation responses so the server can run without secrets; it does not perform real Qwen work. Use `pnpm eval` for deterministic local scoring without a key.

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

### 6. Run the boundary scan

```bash
pnpm boundary-scan
```

### 7. Start the local API

```bash
pnpm dev
```

The API will be available at `http://localhost:3000` with endpoints:

- `GET /health` — health and capability status.
- `POST /turn` — append a customer/agent turn.
- `POST /sessions/:id/close` — close a session and distill episodic memory into semantic memory.
- `POST /recall` — recall a bounded memory bundle.

### 8. Run the MCP server

```bash
pnpm build
node dist/src/mcp/server.js
```

The MCP server exposes four tools: `recall_memory`, `write_memory`, `distill_session`, and `forget`.

## Project structure

- `apps/api` — Hono API, local server, and Function Compute handler. Deploy-target-agnostic; live on Railway today.
- `src/agent` — deterministic support-agent policy used by the eval harness.
- `src/contracts.ts` — memory predicate enum, Zod contracts, and shared types.
- `src/db` — Drizzle schema and SQL migration string.
- `src/memory` — memory service, stores, retrieval, supersession, and forgetting behavior.
- `src/mcp` — stdio MCP surface over the shared memory service.
- `src/qwen` — single Qwen Cloud client module.
- `src/testing` — deterministic fake Qwen client for the eval harness.
- `eval` — frozen three-session scenario, ground truth, expected output, and runner.
- `scripts` — boundary scan, migration, MCP list-tools, and demo script checks.
- `docs` — judge-facing architecture, memory model, evaluation, and forgetting documentation.
- `deploy` — Railway deployment proof (live, primary) and Alibaba Function Compute deployment instructions (preferred target, pending KYC).

## Key commands

|Command|Purpose|
|---|---|
|`pnpm install`|Install dependencies|
|`pnpm build`|Build the project|
|`pnpm lint`|Run TypeScript type check|
|`pnpm test`|Run the test suite|
|`pnpm eval`|Run the deterministic memory ON/OFF eval harness|
|`pnpm migrate`|Run database migrations|
|`pnpm boundary-scan`|Run the clean-room boundary scan|
|`pnpm mcp:list-tools`|List the MCP tools|
|`pnpm demo:script-check`|Verify demo fixtures are aligned|

## Security and clean-room boundary

Never Ask Twice uses synthetic data only. Do not commit real customer data, secrets, `.env` files, or private platform identifiers. The repository includes a boundary scan to fail on known forbidden tokens and a local-safe mode so judges can run the server without secrets.

See [`SECURITY.md`](SECURITY.md).

## License

Apache-2.0
