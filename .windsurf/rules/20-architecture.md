---
name: Never Ask Twice architecture
activation: glob
globs: ["src/**", "apps/**", "eval/**"]
priority: high
---
Stack: TypeScript, Node 20, Hono, Drizzle, Postgres + pgvector, Qwen via the
OpenAI-compatible DashScope endpoint, MCP stdio. Do not add other frameworks or
swap the package manager.
- Memory logic lives in one place behind a single MemoryStore interface. Routes
  and MCP tools call the service; they never reimplement recall, distillation,
  or supersession.
- Canonical API surface only: POST /turn, POST /sessions/:id/close, /recall,
  GET /health. Do not invent REST shapes. Forget is a service call, not DELETE.
- All Qwen access goes through the single qwenClient module.
- Semantic distillation happens at session close only, never per turn. UI panels
  reflect the real write path, not an aspirational one.
- The zero-vector embedding fallback activates only when the key is absent and
  logs a warning on every call. It never ships to deploy.
- Retrieval is budget-bounded with hard caps. The eval ablation number is
  measured by pnpm eval, never hand-written.
