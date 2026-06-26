# Security

Never Ask Twice uses synthetic demo and evaluation data only. Do not commit real customer data, production credentials, `.env` files, or private platform identifiers.

## Reporting

For hackathon review, report security issues through GitHub Issues with the label `security` and avoid posting secrets, credentials, or real customer data in the report.

## Security model

The project is designed around a few explicit boundaries:

- memory is scoped by account and customer,
- stale facts are excluded through supersession and TTL expiry,
- deterministic eval data is synthetic,
- local-safe mode runs without requiring a Qwen API key,
- boundary scans block known private identifiers and accidental secret files.

## Known limits

This is a hackathon artifact, not a production security certification. Before production use, add authenticated tenant identity, production-grade authorization, rate limits, audit logging, and a private vulnerability disclosure channel.
