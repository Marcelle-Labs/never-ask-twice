# Never Ask Twice

![Never Ask Twice](docs/assets/brand/README-hero.png)

**The website already knows the answer. The browser agent can't reach it — until the site hands it over.**

[![License: Apache-2.0](https://img.shields.io/badge/License-Apache--2.0-blue.svg)](LICENSE)
![WebMCP](https://img.shields.io/badge/WebMCP-2%20browser%20tools-black)
![Entry](https://img.shields.io/badge/Entry-Existing%20project%2C%20extended-purple)
![Runtime](https://img.shields.io/badge/Runtime-Node.js%2020-green)
![Live](https://img.shields.io/badge/Live-neverasktwice.dev-brightgreen)
[![Demo](https://img.shields.io/badge/Demo-2%3A42%20video-red)](https://youtu.be/YggGztPaWpk)

**Live:** **<https://neverasktwice.dev/chat>** — renders in any browser. WebMCP tools register automatically in a WebMCP-capable browser. Add `?webmcp=off` to the same URL for the control condition.

**Demo (2:42):** **<https://youtu.be/YggGztPaWpk>** — *Never Ask Twice — The Website Already Knows.* Real browser, real WebMCP invocation, no scripted footage.

---

## The 15-second version

A support site holds real context about the person visiting it: their service
level, their integrations, their open issue, who they escalate to.

A browser agent standing on that same page cannot reliably use any of it. It
scrapes, it guesses, or it gives up and **asks the human to type it in again** —
the exact thing the person came to the site to avoid.

WebMCP closes that gap. The site declares typed, authorized capabilities; the
agent discovers and calls them.

| | Before this challenge | What the challenge window added |
|---|---|---|
| **Existed** | A support memory engine — working / episodic / semantic tiers, forgetting, budgeted recall — behind a chat UI and a **stdio** MCP server | — |
| **Reachable by a browser agent** | No. Context lived server-side behind a chat box. | **Yes.** Two typed WebMCP tools on `document.modelContext` |
| **Agent can read context** | Falls back to page inspection, then asks the human | Calls `get_support_context`, answers directly |
| **Agent can correct context** | Not possible | `update_escalation_contact`, gated on explicit human confirmation |
| **Tenant safety** | Convention | Mechanism — server-side scope, signed cookie, no model-supplied selectors |

The pre-existing stdio MCP server is **not** WebMCP. It is a separate,
non-browser surface that predates this challenge. Everything scored here is the
browser-native work listed in the right column.

## The two tools

Both are registered on the page via `document.modelContext.registerTool`.
Neither accepts an account, customer, tenant, or session selector — scope is
resolved server-side from a signed visitor cookie, so **the model cannot name
whose data it wants**.

| Tool | Kind | Arguments | Boundary |
|---|---|---|---|
| `get_support_context` | read | `topics[]` from a closed five-value vocabulary, optional | `readOnlyHint`, bounded output, result marked `untrusted` |
| `update_escalation_contact` | mutate | `newContact`, optional `reason` | Requires an explicit human **Confirm and persist** click; atomic supersession; independent readback before success is reported |

## Try it in 60 seconds

Open **<https://neverasktwice.dev/chat>** in a WebMCP-capable browser and watch
the **WebMCP Action Trace** panel while you ask:

**1 — Read.** The prompt used verbatim in the frozen counterfactual:

```
What does support already know about our setup?
```

Trace: `CALLED → SCOPED → RETURNED`. The agent answers with Gold SLA,
Salesforce, Priya — without asking you for any of it.
Run the same prompt at `/chat?webmcp=off` and the agent asks you to paste it in.

**2 — Confirmed correction.** A mutation a human must approve:

```
Priya has left the account. Our escalation contact is now Marcus Chen — please update it.
```

Trace: `CALLED → CONFIRMATION_REQUESTED →` *(you click Confirm and persist)* `→ EXECUTED → OBSERVED`.
Cancel instead, and nothing is written. After committing, ask prompt 1 again —
the old contact is gone and the new one is returned.

## Evidence

Each gate is a frozen document with its raw log beside it. None of it is
reconstructed after the fact.

| Gate | Claim | Document | Raw |
|---|---|---|---|
| G1 | A real browser discovered and executed the tool natively in Chrome | [`docs/webmcp-spike-evidence.md`](docs/webmcp-spike-evidence.md) | [`webmcp-live-verification.jsonl`](docs/webmcp-live-verification.jsonl) |
| G2 | **Counterfactual** — WebMCP ON vs OFF changes the user journey | [`docs/webmcp-counterfactual-comparison.md`](docs/webmcp-counterfactual-comparison.md) | [`webmcp-counterfactual-preconditions.jsonl`](docs/webmcp-counterfactual-preconditions.jsonl) |
| G3 | **Security** — the agent's reach is mechanically tenant-bound | [`docs/webmcp-security-g3.md`](docs/webmcp-security-g3.md) | [`webmcp-security-g3-negative-tests.jsonl`](docs/webmcp-security-g3-negative-tests.jsonl) |
| G4 | **Mutation** — confirmed, atomic, reread before success | [`docs/webmcp-mutation-g4.md`](docs/webmcp-mutation-g4.md) | [`webmcp-mutation-g4-negative-tests.jsonl`](docs/webmcp-mutation-g4-negative-tests.jsonl) |

Each document states its own limits. G2 is one pair, one model, one question,
and it does not claim browser agents *cannot* reach this data without WebMCP.
G4 does not claim prompt-injection immunity.

## Provenance

This is an **Existing Project, meaningfully extended**. The boundary is
mechanical, not asserted:

- Pre-challenge baseline: `c2997996` — tagged `baseline-pre-webmcp`, **zero** WebMCP files.
- All WebMCP work: 2026-09-01 → 2026-09-03.

```bash
git ls-tree -r baseline-pre-webmcp --name-only | grep -c webmcp   # 0
git log --oneline baseline-pre-webmcp..HEAD                       # the challenge window
```

Full table — baseline, challenge additions, deployed code and tree, deployment
id, final commit: **[`docs/webmcp-build-period.md`](docs/webmcp-build-period.md)**.

Third-party assets: [`THIRD_PARTY_NOTICES.md`](THIRD_PARTY_NOTICES.md).

## Run it yourself

```bash
pnpm install
pnpm vitest run tests/webmcp-escalation-contact-g4.test.ts \
                tests/webmcp-security-g3.test.ts \
                tests/webmcp-support-context.test.ts   # 57 tests, no secrets needed
```

These are the deterministic security and state-transition tests behind G3 and
G4 — selector rejection, cross-origin rejection, missing confirmation, rollback
under injected failure, retry, and cross-visitor isolation. They need no
database and no API key.

Full local setup (Postgres, migrations, live Qwen path) is in
[Local development](#local-development) below.

---

# Pre-existing system — historical background

> Everything in this section predates the WebMCP Challenge and is **not**
> submitted as challenge work. It is the system the challenge work extends.

Never Ask Twice was built for the **Qwen Cloud Global AI Hackathon — MemoryAgent
track** (July 2026), where it was submitted as a B2B support memory agent.

**Support that remembers.** Customers don't want a smarter chatbot if they still
have to repeat their SLA, setup, open issue, and escalation contact every time
they come back.

The demo agent is **Nat**, powered by **NATE** — the Never Ask Twice Engine — a
scoped memory layer that turns support conversations into durable, auditable
customer context.

## What makes it a MemoryAgent

- **Working memory** — current-session context usable before session-close distillation.
- **Episodic memory** — raw support events with Qwen embeddings and provenance.
- **Semantic memory** — distilled customer facts with confidence, validity windows, and source links.
- **Forgetting policy** — TTL expiry, supersession, stale-memory exclusion, audit-safe provenance.
- **Budgeted recall** — relevant memories only, capped to a strict context budget.
- **stdio MCP surface** — four memory tools for agent interoperability. *(Not WebMCP.)*

This is not transcript logging. It is structured memory with retrieval
discipline, provenance, forgetting, and measurable cross-session improvement.

## The deterministic eval harness

```bash
pnpm eval
```

Expected fixture output:

```text
memory-on re-ask rate: 0.00
memory-on recall accuracy: 1.00
memory-off re-ask rate: 1.00
memory-off recall accuracy: 0.00
re-ask rate: 0.00 (memory) vs 1.00 (no-memory)
```

**Read this as a fixture assertion, not a measurement.** The harness is
intentionally deterministic for reproducible scoring: fixed synthetic fixtures
and a fake Qwen client. It is a regression guard on the memory policy, not a
live benchmark, and it is unrelated to the WebMCP claims above. Details:
[`docs/evaluation.md`](docs/evaluation.md).

## Prior-period status

|Area|Status|Notes|
|---|---|---|
|Public clean-room repo|Done|Synthetic data only; boundary scan included.|
|Memory service|Done|Working, episodic, semantic, forgetting, budgeted recall.|
|stdio MCP surface|Done|Four memory tools via `pnpm mcp:list-tools`.|
|Qwen-backed live path|Done|`/health` reports `mode: "qwen-live"`.|
|Railway deployment|Live — judge-clickable|[`neverasktwice.dev`](https://neverasktwice.dev/chat) renders in a browser; re-verified 2026-09-02. See [`deploy/railway.md`](deploy/railway.md).|
|Alibaba FC deployment|Live — verify by curl|`curl https://never-awice-api-kvsvpczulb.us-east-1.fcapp.run/health`. Alibaba forces `Content-Disposition: attachment` on the free `*.fcapp.run` subdomain, so a browser downloads instead of rendering — platform policy, not a broken deploy. See [`deploy/alibaba-fc.md`](deploy/alibaba-fc.md).|
|Qwen-hackathon demo video|Done — **superseded**|[Watch](https://youtu.be/P254DPj-Mgw) — frozen Acme scenario, July 2026. **This is not the WebMCP Challenge video.** The challenge demo is [above](#never-ask-twice).|
|Build log|Done|[Building customer support memory that survives an audit](https://marcellelabs.io/insights/building-customer-support-memory-survives-audit)|

## Architecture

```text
Browser agent (WebMCP)          Customer chat / stdio MCP
        |                                |
        v                                v
  document.modelContext            Hono API
  get_support_context      -->  /webmcp/support-context
  update_escalation_contact -->  /webmcp/escalation-contact/{propose,commit}
        |                                |
        +--------> scope resolved server-side from signed visitor cookie
                                         |
                                         v
                                  MemoryService
                                    |-- working memory
                                    |-- episodic memory  (+ Qwen embeddings)
                                    |-- semantic memory
                                    |-- forgetting: TTL + supersession
                                         |
                                         +--> Qwen Cloud (DashScope-compatible API)
                                         +--> Postgres + pgvector
```

Full diagram and component map: [`docs/architecture.md`](docs/architecture.md).

## Brand assets

Logo files and usage rules: [`docs/assets/brand`](docs/assets/brand).
Tagline: **Support that remembers.** Descriptor: **Enterprise Support MemoryAgent.**

---

# Local development

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

Set `DASHSCOPE_API_KEY` for live Qwen-backed embeddings, distillation, and
adjudication. The example is pre-filled for local Postgres on port 5433.

```env
DATABASE_URL=postgresql://neverasktwice:neverasktwice@localhost:5433/neverasktwice
DASHSCOPE_API_KEY=your-key-here
QWEN_BASE_URL=https://dashscope-intl.aliyuncs.com/compatible-mode/v1
QWEN_CHAT_MODEL=qwen-plus
QWEN_EMBEDDING_MODEL=text-embedding-v3
QWEN_EMBEDDING_DIM=1024
MEMORY_TOKEN_BUDGET=1200
```

Without `DASHSCOPE_API_KEY`, the API boots in local-safe mode: zero-vector
embeddings and empty distillation responses so the server runs without secrets.
It does not perform real Qwen work.

### 3–7. Database, eval, and server

```bash
docker compose up -d   # Postgres on localhost:5433
pnpm migrate
pnpm eval              # deterministic fixture harness
pnpm boundary-scan     # clean-room scan
pnpm dev               # API on http://localhost:3000
```

API endpoints:

- `GET /health` — health and capability status.
- `GET /webmcp/support-context` — WebMCP read surface (same-origin, cookie-scoped).
- `POST /webmcp/escalation-contact/propose` · `/commit` — WebMCP confirmed mutation.
- `POST /turn` — append a customer/agent turn.
- `POST /sessions/:id/close` — close a session and distill episodic → semantic.
- `POST /recall` — recall a bounded memory bundle.

### 8. Run the stdio MCP server

```bash
pnpm build
node dist/src/mcp/server.js
```

Exposes `recall_memory`, `write_memory`, `distill_session`, and `forget`.

## Project structure

- `apps/api` — Hono API, local server, FC handler, and the `/chat` UI.
- `apps/api/src/webmcp` — **WebMCP surface**: support-context read, escalation-contact mutation, scope resolution.
- `src/agent` — deterministic support-agent policy used by the eval harness.
- `src/contracts.ts` — memory predicate enum, Zod contracts, shared types.
- `src/db` — Drizzle schema and SQL migration string.
- `src/memory` — memory service, stores, retrieval, supersession, forgetting.
- `src/mcp` — stdio MCP surface over the shared memory service.
- `src/qwen` — single Qwen Cloud client module.
- `src/testing` — deterministic fake Qwen client.
- `eval` — frozen three-session scenario, ground truth, expected output, runner.
- `scripts` — boundary scan, migration, MCP list-tools, WebMCP security evidence.
- `docs` — architecture, memory model, evaluation, forgetting, and all WebMCP evidence.
- `deploy` — Railway and Alibaba FC deployment proofs.

## Key commands

|Command|Purpose|
|---|---|
|`pnpm install`|Install dependencies|
|`pnpm build`|Build the project|
|`pnpm lint`|TypeScript type check|
|`pnpm test`|Full test suite|
|`pnpm eval`|Deterministic memory ON/OFF fixture harness|
|`pnpm migrate`|Run database migrations|
|`pnpm boundary-scan`|Clean-room boundary scan|
|`pnpm mcp:list-tools`|List the stdio MCP tools|
|`pnpm demo:script-check`|Verify demo fixtures are aligned|

## Security and clean-room boundary

Never Ask Twice uses synthetic data only. Do not commit real customer data,
secrets, `.env` files, or private platform identifiers. The repository includes
a boundary scan that fails on known forbidden tokens, and a local-safe mode so
judges can run the server without secrets.

See [`SECURITY.md`](SECURITY.md) and [`docs/webmcp-security-g3.md`](docs/webmcp-security-g3.md).

## License

Apache-2.0 — see [`LICENSE`](LICENSE). Third-party notices: [`THIRD_PARTY_NOTICES.md`](THIRD_PARTY_NOTICES.md).
