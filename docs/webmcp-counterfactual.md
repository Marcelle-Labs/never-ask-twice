# WebMCP counterfactual — G2

Question: does WebMCP availability cause a meaningful user-journey difference
on the same task, same visitor, same site state, same agent surface?

Only the observed record goes in this document. The OFF condition was never
scripted or simulated — what the agent actually did without the tool is the
evidence, including the part where the tooling itself errored.

## Held constant

| Variable | Value |
|---|---|
| Site | <https://neverasktwice.dev> |
| Build under test | `539d507496e796f15dfffd207c4271268c49277b` |
| Browser | Chrome 152.0.7977.65, `chrome://flags/#enable-webmcp-testing` enabled |
| Agent surface | WebMCP Inspector extension, natural-language agent interface |
| Model | Gemini 3.6 Flash |
| Visitor | one `nat_visitor` cookie, reused across both conditions |
| Support state | identical in both conditions, same `asOf` (verified below) |
| Prompt | one frozen canonical question, sent verbatim in both conditions |

**Only changed variable:** whether `get_support_context` is registered.

## Frozen canonical question

```
What does support already know about our setup?
```

The gate takes one canonical question, singular. A second question was drafted
during protocol design but never run as a matched pair, so it forms no part of
this comparison and no result is claimed for it.

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

What a WebMCP-capable agent surface sees on each page, via `getTools()` — the
discovery call an agent makes before choosing a tool:

| Condition | `getTools()` | Tools visible | Trace rows | Site usable |
|---|---|---|---|---|
| ON | `["get_support_context"]` | 1 | `REGISTERED` | yes |
| OFF | `[]` | 0 | none | yes |

### Support state is invariant across conditions

Same cookie, ON page then OFF page, querying the capability either side: both
reads returned the same four items — Gold SLA, requires SSO, Salesforce, Priya
— with identical `asOf` timestamps. Visiting the OFF page does not re-seed or
mutate the fact store, so the two conditions differ only in tool availability.

## Canonical run — ON

Prompt sent verbatim: `What does support already know about our setup?`

Observed:

- `get_support_context` was available to the agent;
- Gemini **independently selected the tool**, with no coaching or prompting
  toward it;
- the Action Trace emitted the real execution chain `CALLED → SCOPED → RETURNED`;
- server scope resolved from `browser-session-cookie`;
- returned context: Gold SLA, requires SSO, Salesforce, Priya;
- Gemini answered directly from the structured support context.

No re-ask. The visitor was not asked to restate anything.

## Canonical run — OFF

Same profile, same visitor, same support state, same model, same prompt
verbatim.

Observed:

- zero WebMCP site tools registered;
- Gemini attempted generic browser/page inspection instead;
- those fallback calls hit a `frameId` communication error in the Inspector;
- Gemini could not recover the support context;
- **it asked the human to copy and paste the relevant information.**

That final step is the user-journey cost: the visitor is asked to supply
context the site already holds.

## Comparison

See the compact artifact: [`webmcp-counterfactual-comparison.md`](webmcp-counterfactual-comparison.md).

| | ON | OFF |
|---|---|---|
| Tool available | yes | no |
| Tool selected | yes, unprompted | n/a |
| Support context obtained | yes, visitor-scoped | no |
| Human asked to restate context | **no** | **yes** |
| Final answer | direct, from structured context | not reached |

## Verdict

**PASS.**

On the same task, same visitor, same site state, same model and the same
verbatim prompt, the only changed variable — tool registration — produced a
visible difference a cold reviewer can point to: with the capability present
the agent answered directly from the site's authorized context; with it absent
the agent ended up asking the human to paste that context in by hand.

## Caveats — read before reusing this result

These bound the claim and must not be dropped when this evidence is reused.

1. **The OFF failure is entangled with a tooling error.** Gemini's fallback
   path hit a `frameId` communication error in the Inspector extension. The
   OFF run therefore shows "this agent, on this surface, could not recover the
   context and asked the human" — **not** that generic inspection would
   necessarily have failed on a healthy surface.
2. **No universal claim.** This does not show that browser agents cannot in
   general reach this information without WebMCP. It shows what happened in
   one controlled pair.
3. **Single pair, single model.** One canonical question, one model
   (Gemini 3.6 Flash), one surface. No repetition count, no variance estimate,
   and no probabilistic claim is made or implied.
4. The comparison is causal with respect to tool availability, and is not a
   measurement of effect size.

## Supplemental — incomplete, not part of the pair

A further OFF attempt was made with **non-canonical wording**:

```
Can we skip setup?
```

This is not the frozen prompt and is **not** used as a paired counterfactual
result. Recorded only as supplemental observation:

- WebMCP site function declarations were empty;
- Gemini attempted generic browser automation — `get_page_text`,
  `get_page_html`, `get_focused_element_text`;
- those fallback calls hit the same Inspector `frameId` type error;
- the run terminated with provider HTTP 429 before any final answer.

No conclusion is drawn from it. It is retained because discarding an
unsuccessful run would misrepresent the record.
