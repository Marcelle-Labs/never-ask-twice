# WebMCP Challenge — build period and provenance boundary

Never Ask Twice is an **Existing Project** entered into The WebMCP Challenge.
This document exists so a reviewer can separate every scored WebMCP addition
from pre-existing work **without inference**.

## The boundary in one line

Nothing under `apps/api/src/webmcp/`, no WebMCP tool registration, and no
WebMCP evidence document existed at the baseline. All of it was authored
between 2026-09-01 and 2026-09-03.

## Challenge window

| | |
|---|---|
| Challenge | The WebMCP Challenge (OpenAI × Devpost) |
| Window opened | 2026-08-25 |
| Original deadline | 2026-09-03, 1:00 PM PT |
| Extended deadline | **2026-09-04, 1:00 AM PT** — Devpost notice "Deadline Extension \| 12 more hours", 2026-09-03T17:08:07Z, issued for an upstream outage |
| Entry type | Existing Project, meaningfully extended |

## Provenance chain

| Stage | Revision | Timestamp | What it is |
|---|---|---|---|
| **Pre-challenge baseline** | `c2997996bbd137a8acf7d08799e7d04b0c8dfd48` | 2026-08-24T20:53:35-04:00 | Last commit before any challenge work. Tagged `baseline-pre-webmcp`. Contains zero WebMCP code. |
| Challenge-period work begins | `2931d06c29e42045cf2d2783f3766b65a2001973` | 2026-09-01T07:25:15-04:00 | First WebMCP commit — registers `get_support_context` |
| G1 spike evidence | `539d507` | 2026-09-01T11:03:56-04:00 | Native Chrome discovery + execution log |
| G2 counterfactual evidence | `8e14058` | 2026-09-01T13:16:28-04:00 | Frozen WebMCP ON/OFF comparison |
| G3 security — deployed code | `3b3f465ddfaef922b3b5ea34ce8bc811ff9a45dd` | 2026-09-01T15:30:08-04:00 | Tenant binding made mechanical |
| G3 security — evidence | `4581f5e` | 2026-09-02T04:54:48-04:00 | G3 verdict + deployment-status correction |
| G4 mutation — first landing | `914effc` | 2026-09-02T05:12:00-04:00 | Confirmed escalation-contact correction |
| **Deployed WebMCP application code** | `c293e14cd5400d7bf16e5c5aef13def3a71b905d` | 2026-09-03T06:36:19-04:00 | The code running at the live URL |
| **Deployed tree** | `5569cacaa90bf8365e6c94fbb150362bf5b9ff01` | — | Tree object of `c293e14`; identifies deployed content independent of commit metadata |
| Railway deployment | `af126f44…` | — | Platform deployment id for the live release. Sourced from the Railway console, not from git. |
| **Final judge-visible revision** | tag **`webmcp-submission-final`** | 2026-09-04 | The frozen submission revision on `main`. Docs-only above `c293e14`; contains no application-code change. |
| Submitted demo video | <https://youtu.be/YggGztPaWpk> | uploaded 2026-09-03T20:11:43-07:00 | 2:42, public, `playabilityStatus: OK` verified logged out |

A commit cannot cite its own hash, so the final row names the **tag** rather than
the SHA it points at. Resolve it with `git rev-parse webmcp-submission-final^{commit}`.
Everything above this row was already immutable before the freeze.

## Submission freeze

| | |
|---|---|
| Frozen at | 2026-09-04, before the 01:00 PT deadline |
| Deadline | 2026-09-04 01:00 PT — extended 12h from 2026-09-03 13:00 PT for an upstream outage |
| Repository | public, Apache-2.0 detected at top level, verified unauthenticated |
| Live URL | <https://neverasktwice.dev/chat> — `/health` reports `mode: "qwen-live"` |
| Verification | typecheck PASS · full suite 99 passed / 19 files · boundary scan clean · gitleaks clean |

GitHub Actions is disabled on this repository, so no CI run exists for the frozen
revision. The verification row above was produced locally against that exact
revision and is the substitute record.

## Baseline predates the challenge

The baseline commit is dated 2026-08-24T20:53:35-04:00 — 2026-08-24 17:53 PT —
before the challenge window opened on 2026-08-25.

The stronger evidence is the gap rather than the margin: the first WebMCP commit
lands 2026-09-01, a full week after the window opened. No WebMCP work sits near
the boundary, so no judgement call is required to place it.

Verify directly:

```bash
git log --oneline c2997996..HEAD          # every challenge-window commit
git show c2997996:apps/api/src/ui/views.ts | grep -c modelContext   # 0
git ls-tree -r c2997996 --name-only | grep -c webmcp                # 0
```

## What was pre-existing

Present at the baseline and **not** scored as challenge work:

- The memory engine — working, episodic, semantic tiers; forgetting; budgeted recall.
- The Hono API, the `/chat` UI, and the Postgres + pgvector schema.
- The stdio MCP server and its four tools. **This is not WebMCP.** It is a
  separate, pre-existing, non-browser surface.
- The deterministic memory ON/OFF eval harness and its fixtures.
- The Qwen Cloud integration and both deployment targets.
- Brand assets and the original demo video.

## What the challenge window added

- `apps/api/src/webmcp/supportContext.ts`, `scope.ts`, `escalationContact.ts`.
- Browser-native registration of two tools via `document.modelContext`.
- Server routes `GET /webmcp/support-context`, `POST /webmcp/escalation-contact/{propose,commit}`.
- The WebMCP Action Trace panel and the `?webmcp=off` control.
- Mechanical tenant binding: signed visitor cookie, server-side scope resolution,
  removal of body-supplied tenant selectors, same-origin enforcement.
- `tests/webmcp-*.test.ts` and `tests/webmcp-live-regression.spec.ts`.
- Every `docs/webmcp-*` evidence file, including this one.

## Prior competition history

Never Ask Twice was previously submitted to the Qwen Cloud Global AI Hackathon
(MemoryAgent track) in July 2026. That submission is the origin of the
pre-existing system described above and is preserved as historical authority,
not re-entered as new work. See the README's "Pre-existing system" section.

## Financial or preferential support

Reviewed against the Financial or Preferential Support rule.

A $100 OpenAI Build Week Codex promotional credit was awarded to this account on
2026-07-15 and, after an initial redemption failure from a Business workspace,
was redeemed in a personal workspace on or about 2026-07-18.

The Build Week project supported by that credit was a **separate** project,
`workspace.json for Codex` — a different repository, with its own npm and VS
Marketplace publications and its own Devpost submission confirmed 2026-07-21.

Stated precisely, and limited to what the records actually show: **no
attribution of that promotional credit to Never Ask Twice development was found
in the records reviewed.** The available evidence establishes the award and
redemption timeline and the separately named supported project. It does not
independently reconstruct per-repository credit consumption after redemption,
and this note does not claim that it does.

No Sponsor or Administrator provided funding, staffing, infrastructure, or
preferential access for the WebMCP work recorded here.

## Ownership

Never Ask Twice is owned by Marcelle Labs. The entrant is the sole author of the
challenge-window work above. No third-party contributor holds rights in it.

## Third-party assets

Bundled Geist and Geist Mono fonts are licensed under the SIL Open Font License
1.1. See [`THIRD_PARTY_NOTICES.md`](../THIRD_PARTY_NOTICES.md) and
[`apps/api/src/ui/fonts/LICENSE.txt`](../apps/api/src/ui/fonts/LICENSE.txt).

The repository is public and Apache-2.0 is detected at the repository top level.
