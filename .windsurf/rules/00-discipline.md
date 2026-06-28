---
name: Execution discipline
activation: always-on
priority: highest
---
- Done means verified, not written. Run the verification command, paste real
  output, then mark complete. Never infer completion from reading code.
- Report by counts against named checks, never by adjective.
- Never weaken, skip, or comment out a gate to get green. A red gate is signal.
- Build strictly from the spec and the issue's acceptance checks. If the spec is
  silent, stop and ask. Do not invent fields, routes, or file layouts.
- One implementation per concern. If a service method is hard to reuse, fix the
  abstraction; never copy its logic into a second location.
- After implementing, review your diff against the requirement adversarially
  before claiming done.
