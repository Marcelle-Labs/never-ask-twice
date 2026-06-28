---
name: Clean-room boundary
activation: always-on
priority: highest
---
This repository is public and fully self-contained. It must never reference,
name, or import from any other project it was built alongside.
- Do not write the originating project's name, its internal package scopes, its
  private service or tooling names, or any internal identifier anywhere,
  including comments and config.
- Author every file from this repo's spec. Never copy or adapt source from
  another codebase. Reproduce intent, not implementation.
- scripts/boundary-scan.sh and gitleaks detect run on pre-push and must be green.
  If unsure whether something is safe to commit, it is not. Stop and flag it.
- Only .env.example is committed. Never commit .env or any secret. Fixtures are
  synthetic only.
