# UX Legibility Pass (M4 · Deploy & Demo UI)

**Project**: Never Ask Twice  
**Milestone**: M4 · Deploy & Demo UI  
**Linear issues**: VR-488 · VR-489 · VR-490  
**Scope**: Microcopy and framing on top of working code. Touches `views.ts` only — never the engine, memory service, or data boundary.

---

## Constraint that applies to all three

Each item reads from live data (`store.currentFacts()`, `/eval-snapshot`). Nothing may be asserted decoratively. If the data doesn't back it, the element hides rather than showing a stale fixture. This is the same honesty rule as the keyless-trace fix (VR-474).

After any change: run `boundary-scan` and `demo:script-check`.

---

## VR-488 · UX1 — Recall-moment clarity

**Goal**: A first-time, non-technical viewer can narrate what happened without help. The recall beat (chip + trace glow + ablation) already works; this pass makes it readable in ~10 seconds.

**Acceptance:**

- One-line plain-English bridge on Nat's recalled answer. Either form works:
  - `Remembered from prior session`
  - `Using 4 scoped memories from Acme`
- Chips use human-readable labels, not raw `predicate · object`. Examples:

  | Raw form | Human-readable chip |
  |---|---|
  | `sla_tier · enterprise` | `Gold SLA · remembered` |
  | `integration · Salesforce` | `Salesforce · remembered` |
  | `auth_requirement · SSO` | `SSO required · remembered` |
  | `escalation_contact · Priya` | `Priya · remembered` |

  The raw predicate form may remain available but is not the primary label.
- Trace rows map visually to chips in the same order and same label form. The cause→effect chain is obvious: Nat replied this way because it recalled these facts.

**Do not change:** recall logic, shared-event mechanism (VR-485), or any data path.

---

## VR-489 · UX2 — Inline proof card

**Goal**: Put the ablation number next to the moment it proves, not only on the manager dashboard.

**Acceptance:**

- A small, persistent proof card in the chat view showing:
  ```
  With memory: 0.00    Without memory: 1.00
  ```
- Label used in the UI: **repeat-question rate** (more emotionally legible on screen). In docs and eval output, keep `re-ask rate`.
- Value comes from the live `/eval-snapshot` endpoint (built for VR-486). Not a static string.
- If `/eval-snapshot` is unavailable, the card hides entirely — no stale fixture is shown.
- The card supports the chat moment; it does not crowd or distract from it.

**Do not add:** a new metric pipeline. Reuse `/eval-snapshot`.

---

## VR-490 · UX3 — Trust and governance microcopy

**Goal**: Turn "memory" into "governed memory" — the line between a toy demo and a B2B product. This is the item with the most strategic weight; the enterprise-pilot judge cares about exactly this.

**Acceptance:**

- A compact trust strip near the recalled answer:
  ```
  Scoped to Acme · Current · Provenance available · Not expired
  ```
  The strip is calm and informational, not a banner or an alert.
- Manager dashboard shows source session and validity state per fact: tenant, source session id, current/valid status, expiry. Most data already renders; this pass frames it as governance.
- Stale, expired, or superseded facts are visually distinct but calm. Use the amber "working" treatment from the design system — never red.
- Copy avoids surveillant energy. Tone: governed and controlled.

**Source of truth for all indicators:** `store.currentFacts()` and `validTo`/`expiresAt` fields on each fact. Never assert `Current` or `Scoped` without the data to back it.

**Do not add:** a real RBAC or governance backend. This is presentation of existing tenant and validity data.

---

## Terminology note (eval vs. UI)

| Term | Where to use |
|---|---|
| `re-ask rate` | eval harness output, docs, `evaluation.md` |
| `repeat-question rate` | chat UI proof card, manager dashboard |

Both refer to the same metric. The eval term stays in the data layer; the UI term is optimized for legibility to a non-technical judge.
