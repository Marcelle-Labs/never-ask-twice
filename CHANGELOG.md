# Changelog

All notable changes to Never Ask Twice are documented in this file.

The format is based on [Keep a Changelog](https://keepachangelog.com/en/1.1.0/),
and this project adheres to [Semantic Versioning](https://semver.org/spec/v2.0.0.html).

## [0.1.0] - 2026-07-07

Initial public release. Built for the Qwen Cloud Global AI Hackathon — Track: MemoryAgent.

### Added

- Three-tier memory system: working, episodic, and semantic memory with provenance.
- Forgetting policy: TTL expiry, supersession, and stale-memory exclusion with audit-safe provenance.
- Budgeted recall: relevant memories only, capped to a strict context budget.
- Hono API with four endpoints: `GET /health`, `POST /turn`, `POST /sessions/:id/close`, `POST /recall`.
- MCP stdio surface exposing four tools: `recall_memory`, `write_memory`, `distill_session`, `forget`.
- Deterministic eval harness with three scenarios: basic recall (Acme), supersession (Globex), TTL forgetting (Initech).
- Qwen Cloud integration via DashScope OpenAI-compatible endpoint for embeddings and session distillation.
- Local-safe mode for running without `DASHSCOPE_API_KEY` (zero-vector embeddings, empty distillation).
- Railway deployment — live at [neverasktwice.dev](https://neverasktwice.dev), Neon-backed.
- Alibaba Function Compute deployment shape (`s.yaml` + handler export) — pending Alibaba account verification.
- Clean-room boundary scan and gitleaks pre-push hook.
- 16 test files covering agent loop, chat audit, demo preflight, distillation, episodic, forgetting, idempotency, injection probing, MCP parity, predicates, retrieval budget/relevance, supersession, tenant isolation/scope, and working tier.
- Documentation: architecture, memory model, evaluation methodology, and forgetting policy.
- Brand assets: logo and usage guidelines.
- Demo video: [https://youtu.be/P254DPj-Mgw](https://youtu.be/P254DPj-Mgw) — frozen Acme scenario with eval output.
- Build log: [Building customer support memory that survives an audit](https://marcellelabs.io/insights/building-customer-support-memory-survives-audit).

### Known Limits

- Alibaba FC deployment is wired and ready; pending Alibaba account verification, not app readiness.
- Conflict adjudication (`adjudicate`) exists on the Qwen client but is not yet wired into the memory service.
