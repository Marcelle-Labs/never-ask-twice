# Throughline

Clean-room memory agent for multi-session customer support continuity.

## Workspace

- `apps/api`: Hono API and demo surface
- `packages/contracts`: Zod schemas and shared types
- `packages/db`: Drizzle schema and migrations
- `packages/memory`: memory services and retrieval logic
- `packages/eval`: eval harness
- `packages/mcp`: stdio MCP surface

## Getting Started

1. Copy `.env.example` to `.env`.
2. Install dependencies with `pnpm install`.
3. Start local Postgres with `docker compose up -d`.
4. Run `pnpm migrate`.
5. Run `pnpm boundary-scan`.

The local DB binds to `localhost:5433` so it does not collide with other Postgres services already using `5432`.

Additional run instructions land with the implementation issues.
