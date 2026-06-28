# ADR-0050: Multi-Call Usage Guardrails v0 — optional objective generation budget

- **Status:** Accepted — implemented
- **Date:** 2026-06-28
- **Deciders:** Project owner
- **Extends:**
  [ADR-0030](./ADR-0030-cost-usage-guardrails-v0.md) (cost/usage guardrails v0 —
  the `UsageGuard` domain model, App wiring pattern, and `UsageMeter` overlay),
  [ADR-0049](./ADR-0049-real-generated-objective-provider-v0.md) (real generated
  objective provider v0 — the `ObjectiveGenerator` port and `OpenAICompatibleObjectiveGenerator`),
  [ADR-0047](./ADR-0047-generated-story-objective-contract-v0.md) (generated story
  objective contract v0 — `assembleObjective`, `FakeObjectiveGenerator`)
- **Related:**
  [ADR-0023](./ADR-0023-real-room-generator-provider-v0.md) (real room generator
  provider v0 — the prompt-path real provider),
  [ADR-0048](./ADR-0048-generated-room-objective-target-enrichment-v0.md) (objective
  target enrichment v0)

> Design plan for the next implementation slice.
> See the implementation plan [`cost-usage-guardrails-v0`](../implementation-plans/cost-usage-guardrails-v0.md)
> (to be created on the feature branch).

## Context

ADR-0030 (`cost-usage-guardrails-v0`) shipped a single flat request counter for
the one path that could make real LLM calls at the time: the PromptBar
prompt-generation room call. Every real `handlePrompt` attempt increments
`usageCount` before `getRoom()` resolves; `evaluate(state, config)` derives a
`UsageGuardStatus`; `UsageMeter` surfaces the count and cap; and an at-cap
confirm-to-continue gate holds further prompts until the user explicitly
acknowledges. The fake provider path remains inert throughout.

ADR-0049 (`real-generated-objective-provider-v0`) subsequently wired a second
real provider call — `OpenAICompatibleObjectiveGenerator` — into the same
`handlePrompt` flow, executed after a successful room generation with
`provenance === 'generated'`. The ADR explicitly deferred an "objective usage
meter": at ship time, objective generation was awaited before room entry on the
real prompt path, and there was no async objective attach and no
objective-specific usage meter.

The result is that a single user press of Generate now silently costs two real
API calls — one for the room, one for the objective — but the second is
completely outside the guardrail. The `UsageMeter` shows `Generations: N / cap`,
where `N` counts only room generations, so the user's actual provider spend
grows faster than the visible counter indicates. Before expanding generated
objectives to each room (`generated-objective-per-room-v0`), where every room
navigation could trigger an additional real call, the guardrail must account for
this multi-call pattern.

Key properties the solution must preserve:
- Room generation is the **core call**: user-initiated (one press → one
  generation), user-visible in the meter, blocked at cap with confirm-to-continue
  (existing behavior, unchanged).
- Objective generation is an **optional background call**: it follows
  automatically from a successful room generation, is not user-initiated, and
  must degrade silently to no quest rather than blocking the user or requiring
  confirmation.
- The fake/offline provider path must remain completely inert.
- `assembleObjective`, `domain/repairRoom.ts`, `domain/assembleRoom.ts`, the
  room validation/repair/fallback pipeline, `WorldSession`, the renderer, the
  memory firewall, and all logging-redaction rules are unchanged.

ADR-0030 established the structural precedent — a pure domain logic module plus
App-owned state plus a read-only App-level overlay, tested by pure Vitest with no
new DOM dependency — that this ADR follows.

## Decision

Extend `domain/usage/usageGuard.ts` with one new pure function,
`canAttemptOptional`, and wire a budget check in `App.tsx` before the objective
generation call. The room generation counter, cap, config, confirm-to-continue
gate, in-flight lock, `UsageMeter` overlay, and all existing `usageGuard.ts`
exports are **unchanged**.

The defining property: **the room-generation counter tracks user-initiated spend
and remains user-comprehensible (one press = one increment). Objective generation
is budget-checked against that same counter but does not increment it. It skips
silently when the budget is consumed.**

```
handlePrompt(prompt):
  in-flight lock check                         ← unchanged
  at-cap gate (room gen)                       ← unchanged
  increment usageCount (room gen)              ← unchanged: before async call
  await source.getRoom()                       ← unchanged
  if provenance === 'generated':
    if canAttemptOptional(                     ← NEW budget check
        { count: usageCountRef.current },
        { cap: guardCap, enabled: guardEnabled }):
      logger.info('optional objective generation allowed', { count, cap })
      await buildGeneratedObjectiveAttachment(...)  ← fires if allowed
    else:
      logger.info('optional objective generation skipped', { count, cap, reason: 'usage-cap' })
      attachment = null                        ← degrade: no quest
  enter play with attachment or null
  finally: clear in-flight                     ← unchanged
```

### Domain function (`domain/usage/usageGuard.ts`)

One new exported pure function, total and deterministic:

```ts
export function canAttemptOptional(
  state: UsageGuardState,
  config: UsageGuardConfig,
): boolean {
  if (!config.enabled) return true   // fake path: free, always allow
  return state.count < config.cap
}
```

**Semantics:**
- `!config.enabled` (fake provider selected) → `true`: the fake path makes no
  real calls; optional calls are unrestricted.
- `state.count < config.cap` → `true`: budget remains; proceed.
- `state.count >= config.cap` → `false`: budget consumed; skip silently.

`state.count` is read after the room generation increment, so the check reflects
the post-room-gen state. Objective generation never increments the counter.

**Why not a second counter or a second cap?** A separate objective-gen counter
would display a count (e.g., `2` after one prompt) that doesn't match the user's
mental model of "I pressed Generate once." A separate cap would add a new config
knob (`VITE_*` env var) and a new `LlmConfig` field for a v0 feature the user
doesn't need to configure. A second counter that feeds a second `UsageMeter`
widget would add UI surface for a background call the user didn't initiate. The
shared-counter + budget-check pattern is the minimum safe change: one new
function, three changed lines in `App`, and the user experience is identical
except that objective gen quietly stops at cap instead of firing unconditionally.

### Budget threshold analysis (`cap = N`, after room gen increment to count `k`)

| Post-room-gen count `k` | `canAttemptOptional` | Objective gen |
| --- | --- | --- |
| 1 … N-1 | `k < N` → `true` | fires |
| N (at cap) | `N < N` → `false` | skipped |
| N+1 … (after "generate anyway") | false | skipped |

With the default `cap = 10`: the first 9 successful room generations each receive
an objective generation attempt. The 10th brings the counter to 10 (at-cap), so
the 10th room's objective is skipped. The 11th room generation requires a
confirm-to-continue and also skips objective generation. The user-visible
`Generations: 10 / 10` count remains accurate.

Users who want more full room-plus-objective cycles configure
`VITE_AIGM_LLM_SESSION_CAP=20` (or higher) in `.env.local`. No new env var is
needed.

### Core vs. optional call policy

| Kind | Classification | Counted | Gate at cap | Degradation |
| --- | --- | --- | --- | --- |
| `room-generation` | Core | Yes, before call | confirm-to-continue | in-flight lock; at-cap gate holds prompt |
| `objective-generation` | Optional | No | No gate | silent skip → `null` → no quest |

All future optional calls (adjacent real room generation, NPC dialogue, memory
summaries) follow the same policy: call `canAttemptOptional` before attempting;
skip silently if `false`; do not increment the counter.

### Failure and degrade behavior

When `canAttemptOptional` returns `false`, `buildGeneratedObjectiveAttachment` is
not called. The result is `null`, identical in behavior to the already-tested paths
where the objective generator times out, returns invalid JSON, or `assembleObjective`
drops an unsatisfiable proposal. `questSpecRef.current = null`, no quest tracker
renders, `QuestHintState` is null, and NPC dialogue falls back to the default
authored `QUEST_CLUE` table. No error is shown to the user.

This degrade path is the same one exercised by every fake-provider session today
(the fake generator returns `null` immediately, `buildGeneratedObjectiveAttachment`
returns `null`, no quest is attached). No new failure state is introduced.

`assembleObjective` is never called on this path; its safety guarantees — parse →
strict schema → satisfiability → text sanitization — are therefore never
weakened.

### Logging and diagnostics

Two new fixed-message log lines; both carry only non-sensitive integer counters
and the existing integer cap — no API keys, prompt text, generated content,
provider request/response bodies, room/object names, model output, or PII.

```
logger.info('optional objective generation allowed', { count: usageCountRef.current, cap: guardCap })
logger.info('optional objective generation skipped', { count: usageCountRef.current, cap: guardCap, reason: 'usage-cap' })
```

Exactly one of these fires per real-provider prompt that produces a
`provenance === 'generated'` room. The fake-provider path and non-generated
provenances emit neither line (the existing `provenance === 'generated'` gate
already excludes them).

### Preparation for `generated-objective-per-room-v0`

`canAttemptOptional` is designed to be reusable. When `generated-objective-per-room-v0`
adds objective generation at each room navigation, the same function can be called
in the adjacent room resolution path with the then-current `usageCountRef.current`.
No domain change is needed at that time; the wiring site changes, not the guard
model.

### Files to touch

| File | Change |
| --- | --- |
| `apps/web/src/domain/usage/usageGuard.ts` | Add `canAttemptOptional(state, config): boolean` |
| `apps/web/src/domain/usage/usageGuard.test.ts` | Tests for `canAttemptOptional` |
| `apps/web/src/App.tsx` | Guard the objective gen call; two new log lines |
| `docs/architecture/decisions/ADR-0050-multi-call-usage-guardrails-v0.md` | This ADR |
| `docs/architecture/ARCHITECTURE.md` | Status updates (🔜 planned pointer, ✅ implemented list) |

### Files not to touch

`renderer/ui/UsageMeter.tsx` · `app/llmConfig.ts` · `app/selectRoomGenerator.ts` ·
`app/selectObjectiveGenerator.ts` · `app/buildPromptGeneratedRoomSource.ts` ·
`app/generatedObjective.ts` · `domain/assembleRoom.ts` · `domain/assembleObjective.ts` ·
`domain/repairRoom.ts` · `domain/examples/fallbackRoom.ts` · `domain/quests/**` ·
`world-session/**` · `interactions/**` · `encounters/**` · `dialogue/**` · `memory/**` ·
`persistence/**` · `server/**` · `renderer/engine/**` · `eslint.config.js` ·
`package.json`

No new lint block is needed. `canAttemptOptional` lives in `domain/usage/` under
the existing `domain/**` lint block (imports nothing; exports only pure types and
functions — no React, Three.js, renderer, platform, or world-session). No new
ESLint rule, no new layer, no new module.

### Test plan

Pure Vitest tests in `domain/usage/usageGuard.test.ts`, co-located, no new
dependencies, no DOM:

- `canAttemptOptional({count:0}, {cap:10, enabled:false})` → `true`
  (disabled guard: fake path always allows)
- `canAttemptOptional({count:100}, {cap:10, enabled:false})` → `true`
  (disabled: any count)
- `canAttemptOptional({count:0}, {cap:10, enabled:true})` → `true` (below cap)
- `canAttemptOptional({count:8}, {cap:10, enabled:true})` → `true` (cap−2)
- `canAttemptOptional({count:9}, {cap:10, enabled:true})` → `true`
  (cap−1: still allowed)
- `canAttemptOptional({count:10}, {cap:10, enabled:true})` → `false` (at cap)
- `canAttemptOptional({count:11}, {cap:10, enabled:true})` → `false` (beyond cap)
- `canAttemptOptional({count:1}, {cap:1, enabled:true})` → `false`
  (cap=1 edge: at cap)
- `canAttemptOptional({count:0}, {cap:1, enabled:true})` → `true`
  (cap=1 edge: below cap)
- Purity: does not mutate `state` or `config`; returns a fresh boolean each call

No DOM/component tests; the `App.tsx` wiring is smoke-tested manually.

### Manual smoke checklist

1. **Fake provider (no env vars):** submit prompt → `canAttemptOptional` returns
   `true` (disabled guard) → objective gen fires (fake, free, deterministic) →
   quest tracker appears. No `UsageMeter` shown. No log line for objective attempt
   is emitted on the fake path (the `provenance === 'generated'` and `guardEnabled`
   checks gate it).
2. **Real provider, count < cap (e.g., count=3 after room gen):**
   `canAttemptOptional(3, 10)` → `true` → objective gen fires → log `optional
   objective generation allowed { count:3, cap:10 }` → quest tracker appears with generated text.
3. **Real provider, count=9 after room gen (approaching):** `canAttemptOptional(9,
   10)` → `true` → objective gen fires → log `optional objective generation allowed { count:9, cap:10 }`.
   `UsageMeter` shows approaching.
4. **Real provider, count=10 after room gen (at cap):** `canAttemptOptional(10,
   10)` → `false` → log `optional objective generation skipped { count:10, cap:10, reason:'usage-cap' }` → room
   loads without quest tracker, no error shown.
5. **Real provider at-cap gate (count=10 before prompt):** prompt stored; user
   clicks "Generate anyway" → count=11 after room gen → `canAttemptOptional(11,
   10)` → `false` → objective still skipped. Room loads.
6. **Real provider, room gen returns repaired/fallback:** `result.provenance !==
   'generated'` → objective gen path not reached → neither log line emitted.
   Unchanged behavior.
7. **Reset usage:** click "Reset usage" → count=0. Next prompt → `canAttemptOptional(1,
   10)` → `true` → objective gen fires again.

### Minimum safe change check

**Existing code reused:** `UsageGuardState`, `UsageGuardConfig`, `guardEnabled`,
`guardCap`, `usageCountRef`, the existing `provenance === 'generated'` gate in
`handlePrompt`, `buildGeneratedObjectiveAttachment`, the fake-provider inert path.

**New code required:** `canAttemptOptional` (5 lines), two `logger.info` calls in
`App.tsx`, a conditional wrapper at the objective gen call site (~4 lines),
tests (~12 lines), this ADR.

**Safety boundaries unchanged:** `assembleObjective`, `domain/repairRoom.ts`,
`domain/assembleRoom.ts`, room validation/repair/fallback pipeline, `WorldSession`
event log, renderer, memory firewall, logging redaction.

**Targeted tests:** pure Vitest over `canAttemptOptional` only. Existing
`usageGuard.test.ts` tests remain green (new function is additive). No DOM test,
no new test dependency.

## Consequences

- **Objective generation now has a budget.** It skips silently when the room
  generation count reaches the session cap. The user never sees a confirmation
  prompt; the room loads normally, just without a quest.
- **The user-visible counter remains accurate.** `Generations: N / cap` still
  counts room generations — one per user press. Objective generation does not
  inflate the visible count.
- **Fake/offline path is unchanged.** `canAttemptOptional` returns `true` when
  `!config.enabled`, so the fake objective generator fires exactly as before.
  No meter, no log lines.
- **`generated-objective-per-room-v0` can reuse `canAttemptOptional` directly.**
  No domain change is needed when that feature arrives; only the call site changes.
- **No new env var, no UI change, no second counter, no second meter.** The
  extension is contained to one domain function and three lines in `App`.
- **Known limitation:** objective generation skips on the 10th successful real
  prompt (where room gen count goes 9→10). Users expecting objectives on every
  prompt should set `VITE_AIGM_LLM_SESSION_CAP=20` (or higher). This is
  consistent with the documented "local safety counter, not billing truth" property
  of ADR-0030.
- **Closes the deferred item from ADR-0049**: "objective usage meter; async
  objective attach" — the guard is now present; async attach remains future.
- **Not yet:** per-kind caps, token/cost metering, adjacent real room gen budget,
  NPC dialogue budget, memory/summary budget, backend/server-side enforcement,
  cross-session quota, or a second user-visible meter for background calls.
