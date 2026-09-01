# WebMCP counterfactual — G2

Question: does WebMCP availability cause a meaningful user-journey difference
on the same task, same visitor, same site state, same agent surface?

Only the observed record goes in this document. Agent behaviour that has not
been observed is not written here, and the OFF condition is never scripted or
simulated — whatever the agent actually does without the tool is the evidence.

## Held constant

| Variable | Value |
|---|---|
| Site | <https://neverasktwice.dev> |
| Build under test | `539d507496e796f15dfffd207c4271268c49277b` |
| Visitor | one `nat_visitor` cookie, reused across both conditions |
| Support state | identical in both conditions (verified below) |
| Prompts | two frozen prompts, sent verbatim in both conditions |
| Agent surface | WebMCP Inspector extension, natural-language agent interface |
| Browser | Chrome 152.0.7977.65, `chrome://flags/#enable-webmcp-testing` enabled |

**Only changed variable:** whether `get_support_context` is registered.

## Frozen prompts

1. `What does support already know about our setup?`
2. `Can we skip the setup questions this time?`

Sent verbatim. Not rewritten until one succeeds; adverse outcomes preserved.

## Conditions

| | ON | OFF |
|---|---|---|
| URL | `/chat` | `/chat?webmcp=off` |
| Registration | `document.modelContext.registerTool` runs | script never emitted |

The OFF control is a genuine absence, not a hidden tool: the registration
script is not sent to the browser at all.

## Precondition evidence (observed)

Captured against the live deployment on 2026-09-01. Raw output:
[`webmcp-counterfactual-preconditions.jsonl`](webmcp-counterfactual-preconditions.jsonl).

What a WebMCP-capable agent surface sees on each page, via `getTools()` —
the discovery call an agent makes before choosing a tool:

| Condition | `getTools()` | Tools visible | Trace rows | Site usable |
|---|---|---|---|---|
| ON | `["get_support_context"]` | 1 | `REGISTERED` | yes |
| OFF | `[]` | 0 | none | yes |

This establishes the **mechanism** half of "removing the capability removes
the advantage": with WebMCP off there is nothing for an agent to discover.
It does not by itself establish a behavioural difference — that requires the
agent runs below.

### Support state is invariant across conditions

Same cookie, ON page then OFF page, querying the capability either side:

- both reads returned the same four items — Gold SLA, requires SSO,
  Salesforce, Priya;
- identical `asOf` timestamps, so visiting the OFF page does not re-seed or
  mutate the fact store.

The two conditions therefore differ only in tool availability, not in the
support state the agent could in principle draw on.

## Agent runs

Not yet recorded. The natural-language agent interface requires a provider
credential, so these runs are performed manually on the configured browser
profile and transcribed here verbatim, including failures and retries.

Per prompt and condition the record must carry: exact prompt, timestamp,
tools visible to the agent, whether `get_support_context` was selected,
generated arguments, returned tool result, the visible Action Trace, the
final agent response, any unnecessary re-ask, and any retry or failure.

## Verdict

Not yet reached. PASS requires a behavioural difference a cold reviewer can
point to. FAIL if the same prompt succeeds essentially as well without
WebMCP, or if the difference is too weak to make WebMCP load-bearing.
