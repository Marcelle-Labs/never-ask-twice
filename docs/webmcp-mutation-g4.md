# G4 — confirmed escalation-contact correction

## Scope and contract

The page registers exactly one new mutating WebMCP capability:

```json
{"type":"object","properties":{"newContact":{"type":"string","minLength":1,"maxLength":120,"description":"The confirmed replacement escalation contact."},"reason":{"type":"string","maxLength":240,"description":"Optional short reason for the correction."}},"required":["newContact"],"additionalProperties":false}
```

It accepts no account, customer, tenant, session, fact, predicate, or arbitrary-key selector. Inputs are untrusted data: controls/bidi characters are rejected, whitespace is normalized, and visible instruction-like or HTML-like text remains data rather than an instruction.

## Confirmation UX and trace

The tool performs: proposal request → `CONFIRMATION_REQUESTED` → a visible modal naming the current contact, proposed replacement, and persistence consequence → explicit **Confirm and persist** click → commit → `EXECUTED` → separate scoped `get_support_context(["escalation_contact"])` reread → `OBSERVED`.

Cancel and abort before commit leave the proposal unused and perform no store write. Once confirmation begins the commit request intentionally is not attached to the caller's abort signal: an abort cannot truthfully imply the transaction was not committed. The client completes the independent readback or reports that observation as unavailable; it never emits a clean success from the request echo.

## State transition and provenance

`MemoryStore.correctEscalationContact` is a purpose-built operation, not a general fact editor. In Postgres it uses one transaction, locks the current escalation-contact row, inserts an internal action session/event, closes the old fact, inserts the replacement, links the old fact to it, and inserts `semantic_fact_provenance`.

The close precedes replacement only inside the transaction because the existing partial unique-current index requires it. `superseded_by` is set only after replacement insertion because it has a foreign key to the new fact. Any failure rolls back the transaction. The in-memory test store snapshots the same touched collections and restores them on an injected failure.

Replacement metadata identifies `source: "confirmed-webmcp-action"`, the opaque action id, and optional reason. The old fact remains historical (`validTo` set) and exactly one current contact remains.

## Scope, origin, retry

Both proposal and commit call `enforceSameOrigin(c, "mutation")`, require a valid signed `nat_visitor` cookie, and resolve tenant scope only server-side. Tenant-scoped routes have no wildcard CORS. Opaque bounded errors contain no internal IDs.

The proposal id is an opaque, visitor-bound, five-minute server-side record. A completed id replays its already-completed result rather than writing again. The store additionally treats an already-current identical contact as no change. Concurrent transitions are serialized by the row lock plus the existing one-current partial unique index; a different competing correction can fail, but cannot create two current facts.

## Deterministic evidence

`tests/webmcp-escalation-contact-g4.test.ts` covers schema selector rejection, origin rejection, missing confirmation, invalid/control input, supersession/current-value semantics, provenance, retry, other-visitor isolation, injected failures before close/after close/provenance, and trace ordering/readback. The focused G4 + G3 + support-context run reports **57 passing tests** at the submitted revision `c293e14`.

> **Erratum (2026-09-03, submission freeze).** This document originally recorded **55**, the count at the time G4 first landed (`914effc`). The follow-up fix `c293e14` — *lock confirmation while verifying* — added two regression tests, bringing the focused suite to 57. The frozen `*-negative-tests.jsonl` retains its original 55-test line as the record of that earlier run; a second line records the re-run at the submitted revision. Neither count is corrected retroactively.

The mutation verification test deliberately injects failures in `createSession`, replacement insertion (after the old row is closed), and provenance insertion. Each returns an opaque failure, preserves Priya as the sole current contact, and leaves no replacement visible.

## Limitations

This is a single bounded correction, not a generic memory editing surface. Confirmation is a browser-page modal; it demonstrates explicit human interaction in the supported WebMCP flow but does not claim cryptographic proof of user intent or model-level prompt-injection immunity. A commit that succeeds but whose reread transport fails is deliberately reported as execution-without-observation rather than success.
