# WebMCP ON/OFF — frozen comparison

One task. One visitor. One changed variable.

**Prompt (verbatim, both conditions):**

```
What does support already know about our setup?
```

## Held constant

Chrome 152.0.7977.65 · WebMCP Inspector agent · Gemini 3.6 Flash ·
same `nat_visitor` cookie · same support state, same `asOf` ·
build `539d507` · <https://neverasktwice.dev>

**Changed:** whether `get_support_context` is registered.

## Result

| | **WebMCP ON** `/chat` | **WebMCP OFF** `/chat?webmcp=off` |
|---|---|---|
| WebMCP tools visible | `get_support_context` | none |
| Tool selected by agent | yes — unprompted | n/a |
| Arguments | agent-generated topics | n/a |
| Scope resolution | `browser-session-cookie`, server-side | n/a |
| Action Trace | `CALLED → SCOPED → RETURNED` | none |
| Context obtained | Gold SLA · requires SSO · Salesforce · Priya | none |
| Fallback attempted | — | generic page inspection |
| Outcome | answered directly from structured context | **asked the human to copy/paste it** |
| Human re-ask required | **no** | **yes** |

## The delta

With the site's capability available, the external agent found it on its own
and answered from the visitor's authorized context. With that capability
removed, the same agent on the same page fell back to generic inspection,
failed to recover the context, and pushed the work back to the person.

## Caveats

- The OFF fallback hit a `frameId` communication error in the Inspector
  extension. The OFF result is "this agent, on this surface, failed and asked
  the human" — not proof that generic inspection must fail.
- No claim that browser agents cannot reach this information without WebMCP.
- One pair, one model, one question. No variance or effect-size claim.
