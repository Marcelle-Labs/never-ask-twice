# WebMCP security gate — G3

Scope: make the browser-agent's reach *mechanically* tenant-bound, and show it
with tests that fail when the boundary is removed.

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
unauthenticated scope. **It must be set in any deployed environment**, or
visitor scope will not survive a restart and will not be shared across
instances.

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

Two consequences worth stating plainly:

- A broken or malicious agent surface can cause a request to **fail**. It cannot
  cause it to **widen**. The `frameId` error is an availability failure on an
  untrusted surface, which is exactly what the model predicts and tolerates.
- No hardening of the Inspector is in scope, and none is claimed. If the
  Inspector is ever relied on for a security property, that would be a change to
  this model and would need its own gate.

## Evidence

### Deterministic tests

`tests/webmcp-security-g3.test.ts` — 29 negative tests. Full suite: **87
passing**, `pnpm lint` clean.

### The tests were verified to fail when the boundary is removed

A passing negative test proves nothing unless it can fail. Each guard was
removed in turn and the suite re-run:

| Guard removed | Tests that failed |
|---|---|
| Cookie signature verification | 3 |
| Origin enforcement | 4 |
| Caller-supplied tenant trusted again | 5 |
| Wildcard CORS restored on tenant routes | 1 |
| Tenant id embedded in the page again | 2 |
| `/eval-snapshot` leaks the visitor tenant | 1 |
| Read capability writes again | 1 |
| Payload byte ceiling removed | 1 |
| Hidden-character stripping removed | 1 |
| Opaque error replaced with the raw error | 1 |
| Seed guard reverted to any-fact check | 1 |

This pass caught three of my own tests passing for the wrong reason, which are
recorded here because the mutation check is the only reason they were found:

- Two forgery tests were satisfied by the *format* check rather than the
  signature check, so they survived removing signature verification. They now
  replay a real victim's id in three shapes, including one paired with another
  visitor's genuine signature.
- The "performs no write" test used an already-seeded visitor, so a restored
  seed call short-circuited before writing and the test passed anyway. It now
  leaves the visitor's facts deliberately incomplete, so a capability that still
  seeded would have to write.
- The byte ceiling was unreachable behind the item and value caps, so no input
  could exercise it. The ceiling was lowered to a value that binds.

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

Post-condition on the targeted tenant after every probe above: **4 facts, 0
events** — unchanged.

No `Access-Control-Allow-Origin` header on any of these responses. Errors carry
no stack, driver text, credentials or tenant id; the store-failure test asserts
this against an error string deliberately containing all four.

## What this does and does not prove

**Proves:** a browser agent cannot select another tenant — not through the tool
schema, not through the query string, not through a request body, not by
replaying a visitor id, and not from another origin. The capability performs no
write, so it has no partial mutation to leave behind. Output is bounded and
marked untrusted.

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
4. `NAT_VISITOR_SECRET` is unset in the current deployment. Until it is set, an
   instance restart invalidates every visitor's scope. Fails closed, but it is a
   deployment step this gate has not performed.

## Not done in this gate

No escalation-contact mutation (G4), no rate limiting, no authentication of
visitors as people, no hardening of any agent surface, no media or submission
work.
