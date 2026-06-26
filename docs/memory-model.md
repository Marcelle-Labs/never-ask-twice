# Memory Model

Never Ask Twice separates support continuity into three memory tiers and one forgetting layer. The goal is to remember durable customer context without dumping transcripts into the prompt.

## Working memory

Working memory stores facts stated during the current session. It lets Nat use information the customer already provided before the session is closed and distilled.

Example: if a customer says their escalation contact is Priya early in a session, Nat can use that later in the same session without asking again.

## Episodic memory

Episodic memory stores raw support turns as `episodic_events` rows. Each event includes:

- account and customer scope,
- session id,
- role,
- message,
- timestamp,
- Qwen embedding,
- metadata.

Episodic memory is the provenance layer. It is not treated as durable truth by itself.

## Semantic memory

Semantic memory stores distilled durable facts as `semantic_facts` rows. Each fact includes:

- `subject`, `predicate`, and `object`,
- controlled predicate enum,
- confidence,
- validity window,
- optional TTL expiry,
- optional supersession link,
- embedding,
- provenance links back to episodic events.

The controlled predicate set keeps the system auditable and makes supersession deterministic.

## Retrieval scoring

Current valid semantic facts are ranked with a blended score:

```text
factScore =
  0.45 * embeddingSimilarity(query, fact.embedding)
+ 0.25 * confidence
+ 0.20 * predicateRelevanceBoost
+ 0.10 * recencyScore
```

This prevents a high-confidence but unrelated fact from outranking a relevant support fact.

## Budgeted recall

Recall assembles a bounded bundle:

1. current valid semantic facts,
2. relevant episodic events,
3. current-session working facts.

If the bundle exceeds `MEMORY_TOKEN_BUDGET`, the lowest-scoring items are dropped first and recorded in a drop list.

## What this is not

This is not transcript replay. The agent does not shove every previous message into the prompt. It retrieves scoped, ranked, provenance-backed memory under a strict budget.
