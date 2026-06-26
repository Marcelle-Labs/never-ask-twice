# Agent Discipline

This file contains shared agent discipline rules that are read by Windsurf, Cursor, Claude Code, and other AI agent tools.

## Execution Discipline

- Done means verified, not written. Run the verification command, paste real output, then mark complete. Never infer completion from reading code.
- Report by counts against named checks, never by adjective.
- Never weaken, skip, or comment out a gate to get green. A red gate is signal.
- Build strictly from the spec and the issue's acceptance checks. If the spec is silent, stop and ask. Do not invent fields, routes, or file layouts.
- One implementation per concern. If a service method is hard to reuse, fix the abstraction; never copy its logic into a second location.
- After implementing, review your diff against the requirement adversarially before claiming done.

## Clean-Room Boundary

This repository is public and fully self-contained. It must never reference, name, or import from any other project it was built alongside.

- Do not write the originating project's name, its internal package scopes, its private service or tooling names, or any internal identifier anywhere, including comments and config.
- Author every file from this repo's spec. Never copy or adapt source from another codebase. Reproduce intent, not implementation.
- scripts/boundary-scan.sh and gitleaks detect run on pre-push and must be green.
- If unsure whether something is safe to commit, it is not. Stop and flag it.
- Only .env.example is committed. Never commit .env or any secret. Fixtures are synthetic only.

## Never Ask Twice Architecture

Stack: TypeScript, Node 20, Hono, Drizzle, Postgres + pgvector, Qwen via the OpenAI-compatible DashScope endpoint, MCP stdio. Do not add other frameworks or swap the package manager.

- Memory logic lives in one place behind a single MemoryStore interface. Routes and MCP tools call the service; they never reimplement recall, distillation, or supersession.
- Canonical API surface only: POST /turn, POST /sessions/:id/close, /recall, GET /health. Do not invent REST shapes. Forget is a service call, not DELETE.
- All Qwen access goes through the single qwenClient module.
- Semantic distillation happens at session close only, never per turn. UI panels reflect the real write path, not an aspirational one.
- The zero-vector embedding fallback activates only when the key is absent and logs a warning on every call. It never ships to deploy.
- Retrieval is budget-bounded with hard caps. The eval ablation number is measured by pnpm eval, never hand-written.

## Linear Operating Rules

- Work issues in dependency order; respect blockedBy. Do not start an issue whose blockers are open.
- An issue is Done only when its R# acceptance checks pass against a live run. Paste the command and its real output into an issue comment as evidence first.
- Never move an issue to Done from code-reading alone.
- Cut-candidate issues are not started unless the spine is complete and time allows.
- Close or archive issues; never hard-delete. Never change another issue's scope to make the current one pass.
- When you discover new work, file a new issue with evidence rather than silently expanding the current one.
