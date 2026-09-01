# WebMCP security gate — G3

Scope: make the browser-agent's reach *mechanically* tenant-bound, and show it
with tests that fail when the boundary is removed.

| | |
|---|---|
| Deployed application code | `3b3f465ddfaef922b3b5ea34ce8bc811ff9a45dd` |
| Evidence commit | the branch head, which adds only this document and the live-regression spec. It changes no file under `apps/`, `src/` or `packages/`, so the deployed build is exactly the code above. A commit cannot cite its own hash; the deployed SHA is the one that matters for this verdict. |
| Branch | G3 security branch — pushed, **not merged to `main`** |
| Deployed to | <https://neverasktwice.dev> (Railway, `railway up` from the branch) |
| Deployment | `25646008-4c9c-4b12-b80f-7b9a940e5cd3`, restarted as `d4b43d2d-8cf8-41d6-8958-fa30bd0a2b6c` |
| Rollback | deployment `9e334bf8-e80b-4fe6-a944-ad418b9f27de`, code `8e14058` (G2 head) |
| Verdict | **PASS** |

G1 shipped only the security needed to avoid proving WebMCP on an invalid
boundary — same-origin isolation from the global wildcard CORS, a closed topic
vocabulary, bounded output, opaque errors — and deferred the rest here. This
document records what changed, what was already true, and what is still true
only by argument rather than by test.

## What G1 had established, and why it was not sufficient

G1's claim was that the model cannot *name* a tenant: `get_support_context`
accepts `topics` and nothing else. That held, and still holds.

It was not sufficient, because naming a tenant is only one of the ways to reach
one. Three gaps remained, each independently enough to make the clean argument
surface cosmetic:

1. **The tenant selector had no integrity.** `getOrCreateVisitor` interpolated
   the raw cookie into `` `visitor_${cookie}` `` with no validation. Any string
   became a tenant, so a visitor id seen anywhere — a log line, a screenshot, a
   shared link — could be replayed as one. HttpOnly/Secure/SameSite protects a
   cookie in transit; it does not make its contents unforgeable.
2. **The page was handed its own tenant id.** `ChatView` embedded `accountId`
   and `customerId` into page script, and `/eval-snapshot` returned them in
   JSON. Making the cookie HttpOnly and then printing the same selector into the
   document undoes the reason for the flag.
3. **`/turn`, `/sessions/:id/close` and `POST /recall` took the tenant from the
   request body**, under wildcard CORS. Combined with (2), anything running in
   the browser could read and write another visitor's memory without touching
   the WebMCP surface at all.

Together those meant the boundary was a convention. G3 makes it a mechanism.

## Changes

### The tenant selector is authenticated

`nat_visitor` is now `<uuid>.<HMAC-SHA256>`, verified with a constant-time
comparison against a strict UUID payload (`apps/api/src/webmcp/scope.ts`). A
value that does not verify is treated as *absent*, not as a tenant: the visitor
is issued a fresh identity, and the rejected value is never echoed back.

Forging another visitor's scope now requires the server's signing key rather
than knowledge of their id.

The key comes from `NAT_VISITOR_SECRET`. When it is unset the process mints an
ephemeral one and logs a warning; that fails closed — old cookies stop
verifying and visitors are treated as new — rather than falling back to
unauthenticated scope. That fallback remains for local development.

**The deployed environment uses an externally configured secret.** It is held
in the deployment platform's own environment-variable store as a service-level
variable, so it is stable across process restarts and shared by every instance
of the service. It was generated with 384 bits of entropy, written directly to
that store over stdin so the value never appeared in a command line, a process
argument list, a shell variable, a file, or this repository. The value is not
recorded here and must not be. Its persistence is demonstrated by observation
below, not by asserting it.

### The browser cannot select a tenant, by argument or by body

- The page no longer receives `accountId` or `customerId` at all, and no longer
  sends them. The server derives scope from the signed cookie.
- `/eval-snapshot` no longer returns a visitor's tenant id. It still returns the
  pinned `acme_corp` / `jason_99` fixture under `?tenant=eval-fixture`, because
  those are public fixture constants and the recording harness reads them.
- `/turn`, `/sessions/:id/close` and `POST /recall` bind a browser-attributable
  request to its cookie tenant. A body naming a different tenant is **refused**,
  not silently rewritten, so a probing agent is told the boundary exists rather
  than handed a success it did not earn.

### One origin rule, with a mutation mode

`enforceSameOrigin` replaces the route-local check. It refuses a mismatched
`Origin`, and refuses any request the browser itself labels `cross-site` or
`same-site` via `Sec-Fetch-Site` — a sibling subdomain is not this origin.

Mutations additionally require *positive* evidence of same-origin (a matching
`Origin`, or the browser's own `Sec-Fetch-Site: same-origin`) rather than the
mere absence of contrary evidence. G4's escalation-contact write inherits this
guard rather than inventing one.

### No wildcard CORS on anything that resolves a tenant

G1 carved out `/webmcp/*`. The same reasoning applies to every tenant-resolving
route, so `/turn`, `/recall`, `/sessions/`, `/chat`, `/facts` and
`/eval-snapshot` are served with no CORS headers either. `/health` and the
static assets keep the wildcard they always had.

This is the layer that keeps the trusted server-side API out of reach of
anything running in a browser.

### The read-only capability is now actually read-only

`GET /webmcp/support-context` is annotated `readOnlyHint: true` and was calling
`seedVisitorFacts` — a four-fact write loop. That was both a false annotation
and a real partial-mutation window: `seedVisitorFacts` skipped when *any* fact
existed, so a seed interrupted partway through left the visitor permanently
short of facts.

Both are fixed. The capability performs no write and mints no cookie; a caller
with no session reads an empty context rather than being issued a tenant by a
read. Seeding happens on `/chat`, which is also the only place the tool can be
registered. The seed guard is now per-predicate, so an interrupted seed
completes on the next page load instead of staying broken.

### Bounded output, and the invisible channel

- `MAX_PAYLOAD_BYTES` (4KB) bounds the whole serialized payload, not just item
  count and value length. It is deliberately set below what those two caps
  permit — 20 items of 200 characters serialize to about 6.2KB, so a ceiling
  above that would never engage and would be decoration rather than a limit.
  Dropped items are reported as `truncated`, not passed off as a complete
  answer.
- Stored values are stripped of C0/C1 controls, zero-width characters and the
  bidi override/isolate range before reaching a model.

  **This is not a prompt-injection defense and is not claimed as one.** Plainly
  visible instruction text survives it untouched, by design. It removes only the
  channel a human auditing the fact store cannot see, so that what the model
  reads is what a person reviewing that memory would read. The boundary for
  visible injected text is `contentTrust`, which marks every value as data.

## Is the WebMCP Inspector in the security model?

**Explicitly out of scope, and this is the deliberate answer rather than an
omission.**

G2 surfaced a third-party extension in the trust path: the OFF condition's
fallback hit a `frameId` communication error inside the Inspector, and that
error is entangled with the counterfactual result (see
`webmcp-counterfactual.md`, caveat 1).

The security model treats every agent surface — the Inspector, Chrome's own
WebMCP Tools UI, a future first-party agent, or a hostile one — as untrusted
input. Nothing an agent surface sends is trusted: not a tenant identifier, not
an origin claim, not a topic outside the closed vocabulary. Scope is resolved
from state the server signed and the surface cannot read.

The model in three statements:

1. **Agent and browser surfaces are untrusted callers.** They are input, never
   authority.
2. **Their failure may make a request unavailable.** A broken surface can stop a
   call from completing, and that is a tolerated outcome.
3. **Their failure must not widen tenant authority.** No malfunction,
   compromise, or hostile behaviour on an agent surface can cause a request to
   resolve to a tenant other than the one the server's own signed cookie names.

The `frameId` error sits squarely in (2): an availability failure on an
untrusted surface, which is what the model predicts and tolerates. **It is
deliberately not fixed**, and fixing it is not in scope for Never Ask Twice. If
the Inspector were ever relied on for a security property, that would be a
change to this model and would need its own gate.

## Evidence

### Deterministic tests

`tests/webmcp-security-g3.test.ts` — 31 negative tests. Full suite: **89
passing** across 18 files. `pnpm typecheck` and `pnpm lint` clean.

### The tests were verified to fail when the boundary is removed

A passing negative test proves nothing unless it can fail. Each guard was
removed in turn and the suite re-run:

| Guard removed | Tests that failed |
|---|---|
| Cookie signature verification | 3 |
| Origin enforcement | 4 |
| Browser tenant binding (body trusted again) | 5 |
| CORS carve-out for tenant routes | 1 |
| `/eval-snapshot` identifier suppression | 1 |
| Tenant id kept out of the page | 1 |
| Read capability performs no write | 1 |
| Payload byte ceiling | 1 |
| Hidden-character stripping | 1 |
| Opaque error boundary | 1 |
| Per-predicate seed guard | 1 |

This pass caught three of my own tests passing for the wrong reason, recorded
here because the mutation check is the only reason they were found:

- Two forgery tests were satisfied by the *format* check rather than the
  signature check, so they survived removing signature verification. They now
  replay a real victim's id in three shapes, including one paired with another
  visitor's genuine signature.
- The "performs no write" test used an already-seeded visitor, so a restored
  seed call short-circuited before writing and the test passed anyway. It now
  leaves the visitor's facts deliberately incomplete.
- The byte ceiling was unreachable behind the item and value caps, so no input
  could exercise it. Worst case measured 6169 bytes against an 8KB ceiling; the
  ceiling was lowered to 4KB so it binds.

### Raw negative-test transcript

`webmcp-security-g3-negative-tests.jsonl`, regenerate with `pnpm webmcp:evidence`.

| Probe | Status | Response |
|---|---|---|
| Visitor reads their own context | 200 | `knownVisitor: true`, 4 items |
| Victim's visitor id, unsigned | 200 | `knownVisitor: false`, 0 items |
| Victim's id + fabricated signature | 200 | `knownVisitor: false`, 0 items |
| Victim's id + another visitor's real signature | 200 | `knownVisitor: false`, 0 items |
| Tenant selectors smuggled in the query string | 200 | attacker's own context only |
| Unsupported topic | 400 | `Unsupported topic "all_customers". Supported: …` |
| Cross-origin read | 403 | `Cross-origin requests are not permitted.` |
| Sibling subdomain | 403 | `Cross-origin requests are not permitted.` |
| `Sec-Fetch-Site: cross-site`, no Origin | 403 | `Cross-origin requests are not permitted.` |
| Cross-tenant read via `POST /recall` | 403 | `Request scope does not match this visitor session.` |
| Cross-tenant write via `/turn` | 403 | `Request scope does not match this visitor session.` |
| Write with no same-origin evidence | 403 | `This request must be made from the site itself.` |
| `/eval-snapshot` for a real visitor | 200 | no `accountId`, no `customerId` |

Post-condition on the targeted tenant after every probe: **4 facts, 0 events** —
unchanged.

## Live regression on the deployed candidate

Everything below was run against <https://neverasktwice.dev> serving the
application code at `3b3f465`, after the stable secret was configured.

Before deploying, the pre-change production build was probed to confirm the
three gaps were real in production and not only in the source reading:
`/eval-snapshot` returned `accountId: "visitor_2ed81953-…"`, and `/chat` served
`const accountId = "visitor_94afeb35-…"`. Both are now absent.

### Core browser journey (`tests/chat-audit.spec.ts`, 7/7 passed)

Real Chromium against the deployed candidate.

- `/chat` opens, a visitor is established, one `/turn` fires per send, one
  customer bubble and one agent bubble appear.
- Seeded Acme state is recalled without re-asking: *"I have your account details
  on file — Salesforce integration, requires SSO, Gold SLA. I'll route this to
  Priya now."* — all four of Gold SLA, requires SSO, Salesforce and Priya, with
  4 glowing trace rows.
- Memory OFF control, Simulate Cold Start, session close, edge inputs and the
  manager dashboard all behave as before; dashboard and `/eval-snapshot` agree
  at 4/4.

### Visitor signing persistence (`docs`-safe markers only)

Correlation marker for the verification visitor: `7105b2ad48ad` (first 12 hex of
SHA-256 over the visitor id). The cookie value and the secret appear nowhere.

- Cookie shape observed: `<uuid>.<signature>`, uuid 36 chars, signature 43 chars.
- Three reloads issued **0** `Set-Cookie` headers — the existing signed cookie
  verified each time rather than minting a new visitor.
- **Restart persistence, tested directly.** The service was redeployed with no
  byte change (`25646008…` → `d4b43d2d…`, a genuine new process). The cookie
  minted *before* the restart still resolved afterwards: `knownVisitor=true`,
  4 items, identical `asOf` of `2026-09-01T19:34:00.131Z`, and `/chat` issued no
  new cookie. Under the ephemeral fallback this would have produced a new
  visitor and an empty context, so this is the observation that distinguishes a
  configured secret from the fallback. The startup log of the new process
  contains no `NAT_VISITOR_SECRET is not set` warning.

### WebMCP registration and execution (`tests/webmcp-live-regression.spec.ts`, 4/4 passed)

G1 verified native Chrome discovery by hand and separately ran a headless pass
under a stand-in WebMCP runtime, committing only that pass's output. This gate
re-creates that harness as a committed spec and points it at the candidate.

- Registration resolves; `REGISTERED` is emitted from real registration state.
- `getTools()` returns exactly `["get_support_context"]`.
- Model-facing `inputSchema` is `topics` only, over the closed five-value enum,
  `additionalProperties: false`. It contains none of `accountId`, `customerId`,
  `sessionId`, `tenant`, `factId`, `visitor`.
- Executing the tool produces the real chain, newest-first
  `["RETURNED","SCOPED","CALLED","REGISTERED"]` — ordered, with no `DISCOVERED`
  and no `REJECTED`.
- Scope reports `resolvedFrom: "browser-session-cookie"`, `knownVisitor: true`.
- Requesting `sla, integration, escalation_contact` returned exactly 3 items —
  gold, Salesforce, Priya — marked `untrusted`.
- The returned payload contains no `accountId`, `customerId`, `sessionId`,
  `factId`, `visitor_` or `embedding`.
- Reload preserves the same visitor and the same four facts with identical
  `asOf` values.

### OFF path and read-only behaviour

- `/chat?webmcp=off` registers **zero** tools (`getTools()` → `[]`) and emits no
  trace rows, while the chat form and thread remain present and usable.
- ON → OFF → ON preserves the same visitor's four facts with identical `asOf`:
  visiting OFF neither destroys nor reseeds state.
- Five consecutive WebMCP reads returned byte-identical payloads with unchanged
  `asOf` — the capability creates no facts and no state.
- `/chat` seeds the visitor before any WebMCP read, which is the only reason the
  read has anything to return; no write was reintroduced into the capability to
  make that convenient.

**One correction to G2's evidence.** `webmcp-counterfactual.md` states that
under `?webmcp=off` "the registration script is not sent to the browser at
all." That is not accurate: the script *is* served, with `WEBMCP_ENABLED =
false`, and the guard returns before `host.registerTool` is ever called. The
functional claim G2 measured — zero tools visible to an agent — does hold, and
is re-confirmed above. Only the stated mechanism is wrong. This is recorded
rather than silently corrected in G2's document, which belongs to a closed gate.

### Live bypass checks

| Check | Observed |
|---|---|
| Forged cookie: real id, fabricated signature | `returned: 0`, `knownVisitor: false` |
| Unsigned cookie: bare visitor id | `returned: 0`, `knownVisitor: false` |
| Scope selectors in the query string | ignored — caller's own 4 items returned |
| ACAO on `/webmcp/support-context`, `/chat`, `/facts`, `/eval-snapshot`, `/recall`, `/turn` | none on any |
| ACAO on `/health`, `/` | `*` — unchanged public behaviour |
| Cross-origin read with `Origin: https://evil.example` | `403 Cross-origin requests are not permitted.` |
| `/eval-snapshot` for a real visitor | no `accountId` / `customerId` |
| `/eval-snapshot?tenant=eval-fixture` | `acme_corp` / `jason_99` — the documented pinned public fixture |
| `visitor_` occurrences in `/chat` HTML | 0 |
| `const accountId` in `/chat` HTML | 0 |
| Unsupported topic | `400` bounded error naming the supported values |
| 50 topics | `400 Too many topics requested.` |
| Malformed JSON body | `400 Invalid JSON body` |

No live cross-tenant exposure was created to produce this table. Cross-tenant
isolation evidence is the deterministic A/B suite, not a live attack on a real
visitor.

### Integration fixes found by this regression pass

Two integration specs were repaired in commit `3b3f465`. Neither changes a
security assertion.

- `chat-audit` Scenario 1 read `#proof-mem-on` / `#proof-mem-off`, which
  `0436f2d` removed along with the fabricated no-memory baseline. The scenario
  had been failing since then — on `main` and against production — for a reason
  unrelated to any gate. Only the logging step was stale.
- `demo-preflight` seeded the pinned fixture through `page.request`, which
  shares the browser context's cookie jar. Measured directly: **201** on a fresh
  context, **403** after any navigation, because a browser-attributable request
  may no longer name a tenant. Seeding the public fixture is a trusted
  server-side action, so it now uses plain `fetch`, matching
  `scripts/record-demo.ts` and `demo/new_demo/demo.spec.ts`, which were already
  unaffected.

## What this does and does not prove

**Proves:** a browser agent cannot select another tenant — not through the tool
schema, not through the query string, not through a request body, not by
replaying a visitor id, and not from another origin. The capability performs no
write, so it has no partial mutation to leave behind. Output is bounded and
marked untrusted.

**Residual boundary, stated explicitly:** browser-originated access is
mechanically cookie-bound, while the trusted server-side MCP and eval APIs
remain tenant-parameterized. Those two facts coexist by design, and the second
is what the first is bounded against.

**Does not prove:**

1. **The trusted server-side API is still tenant-parameterized.** A caller with
   direct network access can still pass `accountId`/`customerId` to `/turn` and
   `/recall`; the MCP server and eval harness depend on it. What is bounded is
   *browser* reach: no wildcard CORS, no tenant id in the page, and every
   browser-attributable request forced onto its cookie scope. Anything reachable
   only by a caller who is already inside the network is outside this gate.
2. **No claim of prompt-injection resistance.** Visible instruction text stored
   as support memory is returned as data and marked untrusted. Whether a
   consuming model honours that marking is a property of that model, not of this
   server, and is not tested here.
3. **Not tested against a live deployment.** All evidence here is deterministic
   and in-process. G1's live checks were run against the Railway deployment; this
   gate does not repeat them.
4. **Native Chrome WebMCP was not re-verified in this gate.** G1 verified
   discovery and `executeTool` by hand in Chrome with
   `chrome://flags/#enable-webmcp-testing`, including that Chrome's WebMCP Tools
   UI lists the tool. The live regression above drives the page's own
   registration and execute callback under a stand-in runtime, which is the same
   code path a real runtime invokes but is not Chrome's implementation. "Chrome
   lists `get_support_context`" therefore remains carried forward from G1 rather
   than re-observed here.
5. **The G2 natural-language counterfactual was not re-run**, deliberately: it
   spends model credits and is not a security property.
6. Restart persistence was tested by redeploying identical bytes, which is a
   real process restart but a single-instance one. Behaviour across two
   concurrently running instances follows from the secret being a service-level
   variable, and was not separately observed.

## Not done in this gate

No escalation-contact mutation (G4), no rate limiting, no authentication of
visitors as people, no hardening of any agent surface, no media or submission
work.
