# Never Ask Twice — demo narration script

Re-record pass: professional ElevenLabs voice replacing the original
personal-mic narration. Same product, same fixture, same measured number.

## Story order

1. Problem (0:00–0:16) — landing page, enter chat.
2. Memory ON — recall without re-asking (0:16–0:55).
3. Memory OFF — the counterfactual (0:55–1:24).
4. Facts dashboard + measured close (1:24–1:37+).

The proof beat (memory recall, no re-asking) happens by 0:55 — well before
any explanation of how it works, matching "prove behavior change before
explaining architecture."

## Scenes

### 01 — Problem (0:00–0:16)

> Stop making your customers repeat themselves. Every returning customer
> forced to re-explain their setup is a tax on support that doesn't
> remember. This is Never Ask Twice — a support agent that remembers a
> customer across sessions.

Visual: landing page hero, then entering the live chat demo.

### 02 — Memory ON (0:16–0:55)

> Jason, from Acme Robotics, already told us his SLA tier, his integration,
> and his escalation contact — in an earlier session. Now he's back with a
> new problem. Watch: the agent answers immediately, citing exactly what
> it remembered. No re-asking. The moment this session closes, the new
> turn gets distilled into fresh semantic facts, ready for next time.

Visual: chat thread, recall chips appearing ("· remembered"), close
session, trace log showing distillation complete.

### 03 — Memory OFF (0:55–1:24)

> Same question. Same agent. Memory switched off. Zero recall — nothing to
> work with, so it has to ask Jason to repeat everything he already told
> us. That's the counterfactual: same agent, same question, only memory
> toggled.

Visual: identical prompt sent with `memory=off`, zero recall chips visible.

### 04 — Facts dashboard + close (1:24–1:37+)

> That's the semantic fact store behind it — scoped to Acme, current, with
> session provenance. We measured the difference with a real evaluation
> harness: repeat-question rate moves from one-point-zero-zero without
> memory to zero-point-zero-zero with it. Never Ask Twice.
> github dot com slash Marcelle Labs slash never dash ask dash twice.

Visual: `/facts` dashboard, hold on the fact list, close on repo link
card or the landing page's "0.00 vs 1.00" callout.

## What's frozen vs. what's new in this pass

| | Original (2:56) | This re-record |
|---|---|---|
| Script beats | problem → session 1 write → session 2 recall → manager/ablation → architecture bridge | problem → memory-on recall → memory-off contrast → facts + close (matches actual `record-demo.ts` timeline) |
| Narration | personal mic | ElevenLabs voice (credentials from the environment) |
| Fixture | `acme_corp`/`jason_99` | unchanged |
| Ablation number | 0.00 vs 1.00 | unchanged — reverified live post-deploy |
| Architecture beat | included | dropped — confirmed a separate Devpost requirement, not video content |
| Hallucination-count line | never on screen (console/README only) | removed from console/README already; no video impact either version |

## Recording checklist

- [ ] `DEMO_BASE_URL` points at `https://neverasktwice.dev` (live, post-fix)
- [ ] `?tenant=eval-fixture` returns `factsCount: 4`, `missingPredicates: []`
      before recording starts (`scripts/record-demo.ts` polls this)
- [ ] No personal browser tabs, bookmarks bar, or notifications visible
- [ ] Window position/size matches production capture settings
      (`DEMO_WINDOW_POSITION`)
- [ ] Generate narration via `demo/narration/generate.mjs`
      (credentials injected from the environment, never typed into a file)
- [ ] Record screen via `pnpm tsx scripts/record-demo.ts`
- [ ] Mux screen capture + `narration/output/narration.mp3` in an editor
- [ ] Burn in or attach `narration/output/narration.srt`/`.vtt`
- [ ] Final export under 3:00, public on YouTube/Vimeo before resubmitting
