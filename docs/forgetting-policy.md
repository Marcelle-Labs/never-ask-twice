# Forgetting Policy

Never Ask Twice treats forgetting as executable behavior, not a static documentation table. Facts can become invalid through supersession or TTL expiry while provenance remains available for audit.

## Supersession

When a new semantic fact arrives with the same customer, subject, and predicate as an existing current fact, the older fact is closed:

```text
old.valid_to = new.valid_from
old.superseded_by = new.fact_id
```

The new fact becomes the only current fact for that key.

Example:

```text
Old: Acme escalation_contact Priya
New: Acme escalation_contact Jordan
```

Recall should use Jordan. Priya remains in the database as historical provenance, not current memory.

## TTL expiry

Some facts are only useful for a limited time. TTL-class facts receive an `expires_at` timestamp at insert time.

Recall excludes facts when:

```text
valid_to IS NOT NULL
or expires_at <= now()
```

Expired facts are not deleted. They remain auditable through their original episodic provenance.

## Retrieval filter

Current semantic recall uses only facts that are both valid and unexpired:

```text
valid_to IS NULL
and (expires_at IS NULL or expires_at > now())
```

This keeps stale facts out of the prompt without destroying the record of why they once existed.

## Why this matters

Customer-support memory can become harmful if stale context is treated as current truth. Forgetting protects against:

- outdated escalation contacts,
- obsolete product configurations,
- expired follow-up promises,
- temporary incident details leaking into future sessions.

The goal is continuity without stale-memory drag.
