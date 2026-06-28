---
name: Linear operating rules
activation: always-on
priority: high
---
- Work issues in dependency order; respect blockedBy. Do not start an issue whose
  blockers are open.
- An issue is Done only when its R# acceptance checks pass against a live run.
  Paste the command and its real output into an issue comment as evidence first.
- Never move an issue to Done from code-reading alone.
- Cut-candidate issues are not started unless the spine is complete and time allows.
- Close or archive issues; never hard-delete. Never change another issue's scope
  to make the current one pass.
- When you discover new work, file a new issue with evidence rather than silently
  expanding the current one.
