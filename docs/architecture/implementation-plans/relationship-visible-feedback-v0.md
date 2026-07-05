# Implementation Plan — `relationship-visible-feedback-v0`

> `relationship-visible-feedback-v0` is the **feature name**, not a Git branch —
> this work lands directly on `main` (see §1, "Lane").

> Status: **DESIGN LOCKED — NOT YET IMPLEMENTED (docs only).**
> Design approved by the maintainer; no runtime/source/test code has been
> written. This document and its ADR are the docs-first deliverable; the code
> slices in §11 are pending a separate implementation approval.
> See [ADR-0079](../decisions/ADR-0079-relationship-visible-feedback-v0.md).
>
> Companion docs: [ARCHITECTURE](../ARCHITECTURE.md) · [BOUNDARIES](../BOUNDARIES.md) ·
> [FAILURE-MODES](../FAILURE-MODES.md) · [CONVENTIONS](../CONVENTIONS.md) · [/AGENTS.md](../../../AGENTS.md).
> Builds directly on the closed-out
> `npc-relationship-state-v0` ([plan](./npc-relationship-state-v0.md)),
> `relationship-valence-reducer-v0`
> ([plan](./relationship-valence-reducer-v0.md) · [ADR-0077](../decisions/ADR-0077-relationship-valence-reducer-v0.md)),
> and clones the visible-feedback spine of
> `room-memory-visible-feedback-v0`
> ([plan](./room-memory-visible-feedback-v0.md) · [ADR-0071](../decisions/ADR-0071-room-memory-visible-feedback-v0.md)).

---

## 0. Approval status and locked invariants (read first)

The design is **locked**. These invariants may not be relaxed without explicit
maintainer approval:

- **Familiarity-only v0.** The only relationship movement that can produce
  visible feedback is an **upward familiarity bucket crossing** (including the
  first-interaction `none → low`).
- **Trust/respect/fear feedback is deferred** until valenced candidates become
  runtime-emittable. Those axes are dry today (see
  `relationship-valence-reducer-v0`), so any UI for them would be dead code.
- **One closed message constant.** The only string this feature can render is
  `RELATIONSHIP_FAMILIARITY_INCREASED_MESSAGE = 'They seem more familiar with you.'`
- **Generic text only.** No NPC names, room names, object names, or any spec
  text. No scores, deltas, bucket enum values, effect kinds, source kinds,
  confidence, or relationship-projection internals in the UI.
- **Single shared transient slot** with memory feedback, chosen by an explicit
  precedence — never a second stacked toast.
- **No new logs.** The message text is never logged; the existing reducer log
  shape is unchanged.
- **No authority / persistence / provider / prompt / NPC-behavior change.** No
  `WorldState`, `WorldEvent`, `WorldCommand`, memory, `Fact`/`fact_visibility`,
  persistence, migration, save-game, provider, or prompt change. The
  relationship projection and the feedback state stay ephemeral/in-memory only.
- **No `schemaVersion` bump** anywhere.
- **Reuse over new abstraction.** Reuse `familiarityBucket`, the
  `MemoryFeedback` presentational spine, the `roomEntrySeq`/auto-dismiss
  idioms, and the `App.helpers.ts` reducer-set pattern.

---

## 1. Title and status

- **Feature:** `relationship-visible-feedback-v0`
- **Lane:** worked on `main` directly (no feature branch).
- **Status:** DESIGN LOCKED — NOT YET IMPLEMENTED (docs only).
- **ADR:** [ADR-0079](../decisions/ADR-0079-relationship-visible-feedback-v0.md)
  (next free number; ADR-0078 is `room-environment-transition-model-dry-v0`).

## 2. Problem statement

The ephemeral NPC→player relationship projection (`relationshipsRef`,
`npc-relationship-state-v0`) evolves silently. `familiarity` rises as the player
converses with an NPC — driven by the two neutral candidate kinds
(`player_asked_question` / `npc_responded`) — but the player never sees any sign
of it. The projection only influences dialogue **tone** context, which is itself
invisible, so a player has no way to notice that an NPC is warming to them.

This feature adds a **safe, generic, rare, player-facing signal** the first time
an NPC becomes meaningfully familiar with the player: a single transient line on
an upward familiarity bucket crossing. It exposes no scores, deltas, effect
internals, provider text, or NPC identity, and mutates no authoritative state.

## 3. Current architecture recap

- **Only `familiarity` moves at runtime.** `RELATIONSHIP_EFFECT_DELTA_TABLE`
  (`domain/npcRelationship/reducer.ts`) keeps every signed valenced row dry
  (`classifyDialogueTurn` cannot emit them), and `dialogueContext.ts` hardcodes
  `trustBucket: 'neutral'`, `respectBucket: 'neutral'`, `fearBucket: 'none'`.
  `familiarity` is **monotonic non-decreasing** (the reducer guard forbids any
  decrease in v0).
- **Bucket helper already exists:** `familiarityBucket(n)` →
  `'none' | 'low' | 'medium' | 'high'` (`domain/npcRelationship/dialogueContext.ts`),
  thresholds `≤0 → none`, `≤33 → low`, `≤66 → medium`, `>66 → high`.
- **Prev + next state already available at one seam.** In `App.tsx`,
  `handleNpcDialogueResolved` computes `priorRelationship` and the reduced
  `relationshipResult.state` for the **active NPC** (`event.npcId`) on every
  resolved dialogue turn, then stores it in `relationshipsRef`. No new access
  path is required.
- **Reusable visible-feedback spine (ADR-0071):**
  - pure gate `decideMemoryFeedback` (`app/memoryFeedback.ts`);
  - state reducer-set in `app/App.helpers.ts` (`MemoryFeedbackState`,
    `memoryFeedbackAfterPromotion/AfterRecall/OnRoomEntry`,
    `INITIAL_MEMORY_FEEDBACK_STATE`);
  - presentational `renderer/ui/MemoryFeedback.tsx` — `{ message: string | null }`,
    `role="status" aria-live="polite"`, imports only React;
  - auto-dismiss `useEffect` keyed to the message (`MEMORY_FEEDBACK_AUTO_DISMISS_MS`);
  - `roomEntrySeq` anti-spam/reset key and the two reset points where
    `relationshipsRef.current = new Map()` already runs (new prompt, load).
- **Log-safety fence.** `evaluation/logSafety.eval.test.ts` asserts serialized
  logs never contain `trust` / `respect` / `fear` / `delta` / `-3` / `-2`. Any
  message text or axis word reaching a log breaks this gate.

## 4. Proposed v0 scope

1. In `handleNpcDialogueResolved`, compute `familiarityBucket(prior…)` vs
   `familiarityBucket(next…)` for the active NPC.
2. On any **upward** familiarity bucket crossing — headline case
   `none → low` (the first meaningful interaction), plus the rarer
   `low → medium` and `medium → high` — surface the single closed message
   through the shared transient slot.
3. Message is a closed constant, epistemic-voiced ("seem"), name-free,
   score-free.
4. Feedback auto-dismisses and clears on room entry / new prompt / load,
   mirroring memory feedback. It writes nothing and is never persisted.
5. Reuse `familiarityBucket`; clone the ADR-0071 spine; add **no new logs**.

## 5. Explicit non-goals

- **No trust / respect / fear feedback** (those axes are dry; deferred — §13).
- **No NPC names**, room names, object names, or any spec text in the message.
- **No raw scores, numeric deltas, bucket enum values, effect kinds, source
  kinds, confidence,** or any relationship-projection internals rendered or
  logged.
- **No raw dialogue text or provider/LLM output** anywhere in the feature.
- **No WorldState mutation, WorldEvent, WorldCommand, memory write, fact /
  fact_visibility derivation.**
- **No persistence / schema / save-game / SlotWrapper changes.** Feedback state
  is transient component state only.
- **No new NPC behavior** beyond the existing relationship tone context.
- **No new LLM / provider / prompt / network call.** Behaves identically in the
  fake/no-key demo, at zero cost.
- **No "less familiar" / downward direction** (impossible — familiarity is
  monotonic).
- **No `schemaVersion` bump.**

## 6. Feedback data shape

- **Closed message table (v0 = one string):**

  ```ts
  export const RELATIONSHIP_FAMILIARITY_INCREASED_MESSAGE =
    'They seem more familiar with you.'
  ```

  Epistemic ("seem"), generic ("they"), no name/score/tier. This is the **only**
  string the feature can render in real wiring. Tiered per-bucket phrasing is
  deferred (§13).

- **Message type:** a string-literal union of exactly this constant
  (extensible later), mirroring `MemoryFeedbackMessage`.

- **Gate input:** two `FamiliarityBucket` values only — never raw axis numbers,
  never the projection object.

- **Feedback state:** `RelationshipFeedbackState = { message: RelationshipFeedbackMessage | null }`,
  with `INITIAL_RELATIONSHIP_FEEDBACK_STATE`, mirroring `MemoryFeedbackState`.

- **Shared slot:** the message flows into the **same single visible transient
  slot** as memory feedback (§8), selected by precedence — never a second toast.

## 7. Familiarity bucket / change-detection rules

Pure, deterministic function (app layer, `app/relationshipFeedback.ts`):

```ts
decideRelationshipFeedback(
  prevBucket: FamiliarityBucket,
  nextBucket: FamiliarityBucket,
): RelationshipFeedbackMessage | null
```

- Ordered rank: `none < low < medium < high`. The rank table lives in the
  **app-layer gate**; domain `dialogueContext.ts` stays untouched.
- Return the message **iff `rank(nextBucket) > rank(prevBucket)`** (strictly
  upward). Otherwise `null`.
- No same-bucket case, no downward case (structurally impossible), no
  "tiny delta" case — a bucket either crossed or it did not.
- **First interaction is deliberately NOT suppressed:** the `none → low`
  crossing *is* the primary signal.
- **Inherent once-per-crossing.** Because familiarity is monotonic and
  `prev`/`next` are both computed from the stored projection within the same
  turn, each crossing is detected exactly once. No separate per-NPC
  "already shown" store is required. A crossing recurs only after a legitimate
  reset (new prompt/load rebuilds the NPC from `neutralRelationship` in a fresh
  session), which is correct.
- **At most one crossing per turn.** Buckets are 33 wide and the reducer's
  `MAX_PER_TURN_DELTA = 3`, so "one notice vs several" never arises for
  familiarity — a single turn can cross at most one boundary.

## 8. UI / rendering integration plan

**Shared single slot, `MemoryFeedback`-style spine, Minimum Safe Change:**

- **Seam.** In `handleNpcDialogueResolved`, after `relationshipsRef.current.set(...)`,
  compute `prevBucket`/`nextBucket` via `familiarityBucket` and fold the result
  into a new `relationshipFeedbackState` via a reducer helper
  (`relationshipFeedbackAfterReduction`) in `App.helpers.ts`. The handler keeps
  its empty dependency list (stable setter + refs).
- **State.** Add `relationshipFeedbackState` mirroring `MemoryFeedbackState`,
  with `INITIAL_RELATIONSHIP_FEEDBACK_STATE`, `relationshipFeedbackAfterReduction`,
  and `relationshipFeedbackOnRoomEntry` in `App.helpers.ts`.
- **One rendered line, precedence-selected.** Add a pure
  `selectTransientFeedbackMessage(memoryMessage, relationshipMessage)` selector
  and render a **single** presentational instance with the selected string.
  **Precedence: memory-created > memory-recalled > relationship-familiarity**
  (durable-world signals win; this preserves current memory-feedback behavior
  exactly and keeps existing memory tests green). Only one `role="status"` line
  is ever in the tree → no new stacked toast, no z-order regression, no doubled
  `aria-live` region.
- **Presentational component.** Reuse the existing `MemoryFeedback.tsx`
  primitive (already generic `{ message: string | null }`, React-only). Cosmetic
  open item: optionally rename it to a neutral `TransientFeedback` + neutral CSS
  class for honesty (touches one import + its test). Recommended but
  **non-blocking** for v0.
- **Auto-dismiss.** The relationship message auto-dismisses on the same
  `MEMORY_FEEDBACK_AUTO_DISMISS_MS` idiom via its own `useEffect` keyed to
  `relationshipFeedbackState.message`, with the timer cleared on change/unmount.
- **Reset lifecycle.** Clear relationship feedback wherever
  `relationshipsRef.current = new Map()` runs (new prompt, load) and on room
  entry (`enterActivePlay`, `handleNavigate`) via
  `relationshipFeedbackOnRoomEntry`, exactly parallel to memory feedback.

## 9. Logging / debug safety rules

- **Add zero new log lines** (ADR-0071 added none). The message string is
  **never logged** — defense against the `not.toContain('trust' …)` fence and
  against any future named variant.
- The existing reducer log (`app/deriveAndReduceRelationship.ts`) is
  **unchanged** — still counts + `familiarityBucket` + scope ids only.
- No axis names, deltas, bucket enum values, effect/source kinds, confidence, or
  projection objects appear in any log context.

## 10. Test plan

- **Pure gate** (`app/relationshipFeedback.test.ts`): `none→low`,
  `low→medium`, `medium→high` → message; same-bucket → `null`; every downward
  pair → `null` (guarded even though impossible); rank-table completeness.
- **Precedence selector**: memory-created wins; memory-recalled beats
  relationship; relationship shows only when both memory slots are `null`.
- **Presentational leak-sweep** (mirror `renderer/ui/MemoryFeedback.test.tsx`):
  renders only the closed constant or `null`; correct `role`/`aria-live`;
  imports only React.
- **App seam** (this repo asserts on source strings, cf. `App.test.tsx`):
  feedback computed in `handleNpcDialogueResolved` from `familiarityBucket(prior)`
  vs `familiarityBucket(next)`; reset added at the two `= new Map()` points and
  on room entry; auto-dismiss effect present; single rendered slot via the
  selector.
- **Eval extensions:**
  - `evaluation/logSafety.eval.test.ts` — exercise the relationship-feedback
    path; reaffirm no `trust`/`respect`/`fear`/`delta` and no message text
    reaches any log.
  - `evaluation/noSideEffects.eval.test.ts` — the feedback path appends no
    `WorldEvent`, issues no command, writes no memory/fact/`fact_visibility`,
    and makes no provider/network call.
- **Verification (targeted first):** run the `npcRelationship`,
  `relationshipFeedback`, `App`, `MemoryFeedback`, and the two eval suites
  before any broad run.

## 11. Implementation slices

1. **Pure gate + message constant** (`app/relationshipFeedback.ts`) + unit
   tests. No wiring.
2. **State reducer-set + precedence selector** in `app/App.helpers.ts` + tests.
   Still inert.
3. **App wiring:** compute the crossing in `handleNpcDialogueResolved`, single
   precedence-selected render slot, auto-dismiss effect, resets at the two
   `= new Map()` points + room entry, plus App seam tests.
4. **Eval extensions** to `logSafety` and `noSideEffects`.
5. *(Optional, non-blocking)* rename `MemoryFeedback` → `TransientFeedback` +
   neutral CSS class.
6. **Docs closeout** (implemented-only convention): flip this plan and ADR-0079
   to Implemented and add the ARCHITECTURE.md status line — at implementation
   time only.

Planned verification commands (run during implementation):

```bash
npm.cmd run test -- npcRelationship relationshipFeedback App MemoryFeedback evaluation
npm.cmd run lint
```

## 12. Risk analysis

| Risk | Severity | Mitigation |
| --- | --- | --- |
| Log-eval breakage via axis words / message text in logs | High | No new logs; message text never logged; eval extension re-proves the count-only shape |
| Feature nearly always silent after the first crossing | Medium (product, accepted) | `none → low` once per NPC is the intended headline signal; higher crossings are rare bonuses |
| Collision with memory feedback at the same moment | Low | Single slot + explicit precedence; only one line ever shows |
| Reset misalignment (stale message across session/room) | Low | Clear at both `= new Map()` points + room entry, parallel to memory feedback |
| Cosmetic: memory-named component rendering relationship text | Low | Optional Slice 5 rename |
| Accidental exposure of internals in message | Low | Closed single constant + presentational leak-sweep test |

## 13. Deferred work

- **Trust / respect / fear feedback** — gated on valenced candidates becoming
  runtime-emittable (the signed rows in `RELATIONSHIP_EFFECT_DELTA_TABLE` going
  live) and the corresponding `dialogueContext.ts` bucket widening.
- **Tiered / per-bucket phrasing** (`low`/`medium`/`high` variants) and any
  "less familiar" direction (only if familiarity ever becomes non-monotonic).
- **NPC-name-aware messages** — only if a safe, spec-sourced name channel is
  approved (never provider/dialogue text).
- **Session-scoped fatigue tuning** if higher crossings ever become frequent.
- **Any persistence surface** for the relationship projection or feedback
  state. None in v0.
- **ARCHITECTURE.md status line** — added at closeout only, per the
  implemented-only convention.

## 14. Final recommendation

Proceed to implementation on this locked design when approved. It clones the
proven ADR-0071 spine, adds one tiny pure gate + one precedence selector + a
single shared render slot, reuses `familiarityBucket`, touches no authoritative
or persisted state, adds no logs, and is fully coverable by pure + component +
App-seam + eval tests without rendering the full game. The only cosmetic open
item is the optional component rename (Slice 5), which does not block v0.

### Minimum Safe Change Check (planned)

- **Reuse:** `familiarityBucket`, the `MemoryFeedback` presentational primitive,
  the `App.helpers.ts` reducer-set pattern, the `roomEntrySeq`/auto-dismiss
  idioms, the existing `handleNpcDialogueResolved` prev/next seam, and the
  `logSafety` / `noSideEffects` eval suites.
- **Minimum new code:** one app-layer gate + message constant, one state
  reducer-set + precedence selector, and the wiring/render in `App.tsx`; test
  additions. No new domain module, no reducer change, no schema.
- **Safety boundaries unchanged:** no `WorldState` / `WorldEvent` /
  `WorldCommand` / memory / fact / `fact_visibility`; no persistence / migration
  / `schemaVersion` bump; no provider / prompt / NPC-behavior change; no new
  logs; relationship projection and feedback state remain ephemeral/in-memory
  only.
- **Tests prove it:** §10, anchored by the presentational leak-sweep and the two
  eval extensions.
