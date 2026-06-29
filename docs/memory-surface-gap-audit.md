# Memory Surface V1: Design-to-Implementation Gap Audit

**Project**: Never Ask Twice / `apps/api/src/ui/views.ts` + `src/memory/service.ts`
**Audit date**: 2026-06-28

---

## Layer 1 — State Coverage

| Design state | Emitting code location | Rendering code location | Status |
|---|---|---|---|
| `trace-empty` | None | `views.ts:54` — hardcoded `"Waiting for interaction..."` in initial `#trace-logs` HTML | PARTIAL — label exists, not a named state |
| `trace-initializing` | None | None | **MISSING** |
| `trace-live-writing` | None — no per-character or streaming signal | None | **MISSING** |
| `episodic-written` | `views.ts:78` — `addTrace('Episodic event written')` fired client-side after any non-error /turn response | `views.ts:63` — `addTrace()` creates `.card` with `.badge.done` | PARTIAL — hardcoded client string, not a server event |
| `embedding-stored` | `views.ts:79` — `addTrace('Embedding stored.')` fired immediately after episodic-written | Same `addTrace()` | PARTIAL — fires even when `DASHSCOPE_API_KEY` absent and a zero-vector was stored |
| `distill-on-close` | `views.ts:97` — `addTrace('Qwen distillation complete')` after close response | Same `addTrace()` | PARTIAL — correct timing (post-close), but fired regardless of whether `distill()` returned facts |
| `semantic-written` | `views.ts:98` — `addTrace('Semantic facts written')` | Same `addTrace()` | PARTIAL — server returns `factsDistilled: N` in close response body; client ignores it and shows no count |
| `supersession-checked` | `views.ts:99` — `addTrace('Supersession check complete')` | Same `addTrace()` | PARTIAL — real supersession runs in `service.ts:163-175` (`updateSemanticFact` with `supersededBy`); client receives no evidence of it |
| `recall-glow` | None | None — no chip exists in message markup, no glow animation on trace rows | **MISSING** |
| `memory-off` | `server.ts` — `c.req.query('memory') !== 'off'` → `ChatView(..., false)` | `views.ts:18` — `.badge.todo` badge + "Memory OFF" label | **EXISTS** |

**Summary**: 1 fully exists, 6 partial (hardcoded strings, not real events), 3 entirely missing (`trace-initializing`, `trace-live-writing`, `recall-glow`).

---

## Layer 2 — Event Timing and Ordering

**Real service ordering is correct.** `service.ts:closeSession()` runs the stages in the right dependency sequence: fetch events → `qwenClient.distill()` → insert semantic facts (with dedup) → supersession check → update session. This is real ordered code.

**The UI lies about all of it.** After the close response arrives, the client fires four `addTrace()` calls sequentially on lines 95–99 of `views.ts`, all within the same synchronous JS block. They appear as a "climb" in the trace panel, but they are not tied to any server events — they fire whether distillation produced 10 facts or 0.

**The turn sequence is similarly faked.** Lines 78–79 of `views.ts` fire `"Episodic event written"` then `"Embedding stored."` back-to-back in the same `try` block after the `/turn` fetch resolves. The server does actually write the episodic event and call `qwenClient.embed()` synchronously before returning, so the timing is approximately correct — but the client has no way to know whether the embedding was real (1024-d Qwen vector) or zeroed-out (keyless mode).

**Cold-start replay does not exist.** The `/chat` GET route calls `store.getEvents(sessionId)` and renders prior messages, but the trace panel is always initialized empty. There is no re-emission of recall events, no replay of which facts were recalled, no restoration of prior trace state.

---

## Layer 3 — The Recall Beat (synchrony claim)

**The recall beat does not exist. Nothing in the codebase implements it.**

The `/recall` endpoint exists at `server.ts` and is correct — it returns a scored bundle of episodic, semantic, and working-memory results. But it is **never called from the chat UI**. The form submit handler in `views.ts` (lines 66–87) calls `POST /turn`, displays a hardcoded agent response (`"I've noted that for your record. Is there anything else?"` at line 84), and calls two hardcoded `addTrace()` strings. The `supportAgent.ts` module — which does call `memoryService.recall()` — is only invoked from the eval harness (`eval/run.ts`), not from any web route.

- **What fires the message chip**: Nothing — no chip element exists in the message markup. `views.ts:84` creates `<div class="content">I've noted that for your record...</div>` with no fact annotation, no chip, no inline indicator.
- **What fires the trace row glow**: `addTrace()` at `views.ts:63`, called with hardcoded strings. The `.card` element has a CSS `transition` for `transform` on hover but no pulse keyframe, no `.glow-text` application, no animation on trace rows.
- **Shared source**: None. There is no `EventBus`, no `EventEmitter`, no `BroadcastChannel`, no `CustomEvent`, no SSE, no WebSocket anywhere in the codebase.

---

## Layer 4 — Data the Design Displays

| Designed value | Source in app | Status |
|---|---|---|
| `sla_tier · enterprise` in nav | `views.ts:32` — hardcoded `"SLA: Enterprise (4h)"` | HARDCODED — not read from `store.currentFacts()` |
| 1024-d embedding confirmation | `MEMORY_EMBEDDING_DIM = 1024` in `contracts.ts` — value exists; never shown in UI | NOT DISPLAYED — "Embedding stored." has no dimension count |
| Semantic fact cards with provenance | `views.ts:133-146` — real `store.currentFacts()` data; predicate, confidence, subject, sessionId, validFrom rendered | **REAL** — live DB data; `sessionId ?? 'unknown'` edge case if null |
| Ablation metric headline (`re-ask rate: 0.00`) | `views.ts:130` — static fixture string | HARDCODED — `eval/run.ts` computes the real number but it is never piped to the view |
| Health / capability readout | `server.ts:capabilityStatus()` returns `{ qwenConfigured, databaseConfigured, mode }` | JSON ONLY — no HTML view exists for `/health`; never rendered in the browser |

---

## Layer 5 — Error-to-Calm + Session-Lookup Bug

**The `.badge.danger` CSS class is not defined.** `index.css` defines `.badge.done` (green) and `.badge.todo` (orange) but has no `.badge.danger` rule. `addTrace('Error: ...', 'danger')` at `views.ts:83` and `:102` creates a badge that falls through to unstyled. The design requirement of "never red" is accidentally met by omission, not by design.

**The raw error message IS shown.** The `addTrace()` call appends `err.message` directly into the trace panel DOM, so a judge who triggers an error sees raw system text like `"Error: Session 7f3a... not found"` — not a calm single-line state.

**Session-lookup bug — reproduced from the design side.** The exact path:

1. User loads `/chat` — server generates a fresh `sessionId` via `randomUUID()`. No session record is created in the DB at this point.
2. User clicks "Close session" WITHOUT sending any message. The inline script calls `POST /sessions/{sessionId}/close`.
3. Server calls `memory.closeSession()` → `requireSessionOwnership()` at `service.ts:64` → `store.getSession(sessionId)` returns `undefined` → throws `SessionNotFoundError`.
4. Handler returns `404 { error: "Session {uuid} not found" }`.
5. Client catches → `addTrace('Error: Session {uuid} not found', 'danger')` — raw error, unstyled badge.

The auto-create in `/turn` (which calls `memory.createSession()` first) does not run because the user never sent a turn. This is reproducible on a clean clone with zero configuration.

---

## Layer 6 — Cross-View Consistency

Both views share **one CSS file** (`/static/index.css`) for color tokens, card styles, badge styles, button styles, and layout primitives. Color tokens are consistent across both views. ✓

**Spacing and type are scattered inline.** Both `ChatView` and `FactsView` use `style="margin-bottom: 0.5rem;"`, `style="font-size: 0.8rem;"`, etc. as inline attributes throughout the HTML template strings in `views.ts`. There is no CSS utility class system, no spacing scale variables. Font sizes used inline across the two views: `0.7rem`, `0.75rem`, `0.8rem`, `0.9rem`, `0.95rem`, `1.1rem`, `1.2rem`, `1.4rem`, `1.5rem` — nine sizes, none of them named tokens.

**Porting the design means editing both templates independently**, not changing one shared layer. A single type-ramp change touches at least 14 inline `font-size` attributes across `views.ts`.

**Font**: `index.css:11` — `font-family: 'Inter', -apple-system, BlinkMacSystemFont, ...`. Inter is a system-font fallback only — no `@font-face`, no CDN link, no self-hosted font files. Geist and Geist Mono are absent from the project entirely.

---

## Layer 7 — Deploy and Runtime Fragility

**Font**: No self-hosted or CDN font. On Alibaba Function Compute (Linux container without Inter installed), the render falls through to DejaVu Sans or Nimbus. Any design that depends on Inter's metrics will look different.

**Keyless mode produces misleading traces.** When `DASHSCOPE_API_KEY` is absent:
- `embed()` returns `new Array(1024).fill(0)` — zero vector
- `distill()` returns `[]`
- The UI trace panel still shows "Episodic event written", "Embedding stored.", "Qwen distillation complete", "Semantic facts written" — all four are false
- `FactsView` correctly shows "No semantic facts captured yet" ✓
- Recall scoring: `cosineSimilarity(zeroVec, zeroVec)` hits the `leftMagnitude === 0` guard at `service.ts:30` and returns `0`. All zero-vector events score 0 on similarity and are ranked only by recency — recall ordering is undefined relative to query intent.

**CSS static-file path**: `server.ts` serves CSS via `readFileSync(new URL('./ui/index.css', import.meta.url).pathname)`. On Function Compute, `import.meta.url` may not resolve to the file's actual disk path post-bundle. If it fails, the server returns `body { background: #000; color: #fff; }` — the entire design disappears.

**Close on fresh session** (see Layer 5): Reproducible with a clean clone, zero configuration required. Judge opens `/chat`, clicks "Close session" → raw error.

---

## Blockers

1. ~~**Recall beat entirely absent** — no chip in message markup (`views.ts:84`), no glow animation, no shared event source, `/recall` endpoint never called from the UI.~~ **RESOLVED** (VR-484 · TL-U1, 2026-06-28): `/recall` and `supportAgent.ts` are now wired into the chat route.

2. ~~**Hardcoded agent response** (`views.ts:84`). `supportAgent.ts` is never invoked from the web UI.~~ **RESOLVED** (VR-484 · TL-U1, 2026-06-28): `runSupportTurn()` now called from `/turn` handler.

3. **Session-lookup crash on close before turn** (`service.ts:64-73`, `server.ts:/sessions/:id/close` handler). Fresh session + close button = raw 404 error in the trace panel. Reproduced on clean clone.

4. ~~**Ablation metric is a static fixture** (`views.ts:130`).~~ **RESOLVED** (VR-486 · TL-U3): `/eval-snapshot` endpoint now serves live numbers; static fixture removed.

5. **`sla_tier` in nav is hardcoded** (`views.ts:32`). Always shows "Enterprise (4h)" regardless of what `store.currentFacts()` would return.

6. **`trace-initializing` and `trace-live-writing` states do not exist** anywhere in the codebase — no emitting code, no rendering code.

**Open UX legibility pass (M4):** With the core wiring fixed, three legibility items remain before the demo is judge-ready. See `docs/ux-legibility-pass.md` for acceptance criteria.

- **VR-488 · UX1** — Recall-moment clarity: human-readable chips, plain-English bridge on recalled answer, chip-to-trace visual mapping.
- **VR-489 · UX2** — Inline proof card: repeat-question rate live from `/eval-snapshot` in the chat view (hides if unavailable).
- **VR-490 · UX3** — Trust/governance microcopy: `Scoped to Acme · Current · Provenance available · Not expired` trust strip; calm amber treatment for expired/stale facts.

---

## Fidelity Gaps

1. All four close-sequence trace strings fire synchronously from one JS block — not staged by real server events. The server returns `factsDistilled: N` in the close response; the client ignores it and shows no count.

2. `.badge.danger` has no CSS rule — error state renders unstyled (accidentally calm, but by accident, not design).

3. `"Embedding stored."` fires in keyless mode where `embed()` returns a zero vector. The label is false.

4. `/health` is JSON-only; the capability readout the design implies has no HTML template.

5. Type scale is 9 inline values with no CSS variables — porting a type ramp requires editing both view templates manually.

---

## Fragility Risks

1. **Font on Linux / Function Compute**: Inter not installed → system font substitution; design metrics break.
2. **Zero-vector recall ordering** (keyless mode): all events score 0 on similarity, ranked by recency only — ordering is undefined relative to query intent.
3. **CSS static-file path**: `readFileSync` + `import.meta.url` may not resolve on Function Compute post-bundle; fallback strips all design.
4. **Cold start**: trace panel always empty on load; no prior recall state is restored regardless of session history.

---

## Build Sequence

Dependency order. Recall beat is highest priority; health view is lowest.

1. **Wire `/recall` into the chat UI per turn** — POST /recall after each /turn succeeds; return `bundle` to the client. Everything downstream depends on this.
2. **Fix session-lookup bug** — auto-create session on GET /chat (not only on POST /turn) so "Close session" never hits a missing-session 404.
3. **Add in-message chips** — use the recall bundle from step 1 to annotate the agent response with cited fact labels inline in the message `.content` div.
4. **Shared recall event → trace row glow** — extract a single client-side event that fires both the chip render and the trace row glow animation on the same tick.
5. **Wire support agent into the chat route** — call `runSupportTurn()` from the `/turn` handler instead of the hardcoded string; return `answer` and `citedFacts` to the client.
6. **Replace hardcoded `sla_tier` in nav** — call `store.currentFacts()` at `/chat` load, find the `sla_tier` predicate, interpolate the live value.
7. **Replace hardcoded ablation metric** — expose a `/eval-snapshot` endpoint that runs the deterministic fixture and returns the re-ask/recall numbers; render from that.
8. **Add health HTML view** — render `capabilityStatus()` as an HTML page at `/status`.
9. **Font self-hosting** — add Geist or Inter via `@font-face` with self-hosted files in the static dir.
