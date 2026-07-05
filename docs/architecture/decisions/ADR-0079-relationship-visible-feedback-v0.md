# ADR-0079: Relationship Visible Feedback v0

- **Status:** Accepted — Design locked; implementation pending (docs only)
- **Date:** 2026-07-05
- **Deciders:** Project owner
- **Builds on:**
  [`npc-relationship-state-v0`](../implementation-plans/npc-relationship-state-v0.md),
  [`relationship-valence-reducer-v0`](../implementation-plans/relationship-valence-reducer-v0.md)
  ([ADR-0077](./ADR-0077-relationship-valence-reducer-v0.md)).
- **Clones the spine of:**
  [`room-memory-visible-feedback-v0`](../implementation-plans/room-memory-visible-feedback-v0.md)
  ([ADR-0071](./ADR-0071-room-memory-visible-feedback-v0.md)) — pure decision gate,
  `App.helpers.ts` state reducer-set, presentational `role="status"` line,
  `roomEntrySeq` anti-spam/reset, and auto-dismiss idiom.

> Full plan, data shape, detection rules, test plan, and slices live in
> [`relationship-visible-feedback-v0`](../implementation-plans/relationship-visible-feedback-v0.md).
> This ADR records the decision; delivery closeout is added at implementation
> time.

---

## Context

The ephemeral NPC→player relationship projection (`relationshipsRef`,
`npc-relationship-state-v0`) evolves silently. `familiarity` rises as the player
converses with an NPC — driven by the two neutral candidate kinds
(`player_asked_question` / `npc_responded`) — but the change is invisible: it
only tints dialogue **tone** context, which the player never sees directly. A
player has no way to notice that an NPC is warming to them.

Two constraints shape any solution:

1. **Only `familiarity` moves at runtime.** Per `relationship-valence-reducer-v0`
   (ADR-0077), every signed valenced row in `RELATIONSHIP_EFFECT_DELTA_TABLE`
   stays dry (`classifyDialogueTurn` cannot emit them), and `dialogueContext.ts`
   hardcodes `trustBucket: 'neutral'` / `respectBucket: 'neutral'` /
   `fearBucket: 'none'`. Familiarity is also **monotonic non-decreasing**. So the
   only relationship signal that can change at runtime today is *increasing
   familiarity* — any "wary / afraid / trusting" UI would be dead code.
2. **The memory firewall and log-safety fences** (ADR-0024/0025/0071,
   `evaluation/logSafety.eval.test.ts`) forbid leaking raw text, scores, deltas,
   or axis internals into UI or logs.

## Decision

Ship **familiarity-only** visible relationship feedback in v0. On an **upward
familiarity bucket crossing** for the **active** dialogue NPC — including the
first-interaction `none → low` — surface a single, generic, transient line
through the **shared transient feedback slot** already used by room-memory
feedback. The feedback is a pure, read-only projection of the two
`FamiliarityBucket` values the reducer already produces; it writes no state,
appends no event, emits no command, and changes no relationship or world truth.

### Closed message constant

```ts
export const RELATIONSHIP_FAMILIARITY_INCREASED_MESSAGE =
  'They seem more familiar with you.'
```

This is the **only** string this feature can render in real wiring. It is
deliberately epistemic ("seem"), generic ("they"), and name-free — it asserts no
world fact, no quest/item change, and no player advantage. A presentational
leak-sweep test proves the component surfaces nothing beyond this constant (and
`null`).

### Familiarity-only; trust/respect/fear deferred

No feedback is produced for trust, respect, or fear. Those axes are dry at
runtime (ADR-0077), so surfacing them would be dead code. Their feedback — and
the `dialogueContext.ts` bucket widening it depends on — is deferred until a
future, separately approved slice makes valenced candidates runtime-emittable.

### Detection rule (pure, once-per-crossing)

A pure app-layer gate `decideRelationshipFeedback(prevBucket, nextBucket)`
returns the message iff `nextBucket` ranks strictly above `prevBucket`
(`none < low < medium < high`), else `null`. Because familiarity is monotonic and
`prev`/`next` are computed from the stored projection within the same resolved
turn, each crossing is detected exactly once; a single turn can cross at most one
33-wide boundary (reducer `MAX_PER_TURN_DELTA = 3`). The `none → low`
first-interaction crossing is deliberately **not** suppressed — it is the primary
signal, and monotonicity makes it fire at most once per NPC per session. The gate
reads two `FamiliarityBucket` values only — never raw axis numbers or the
projection object. The existing `familiarityBucket` helper is reused; the rank
table lives in the app-layer gate so domain `dialogueContext.ts` is untouched.

### Single shared transient slot with memory feedback

Relationship feedback renders into the **same single visible slot** as room
memory feedback, selected by an explicit precedence:
**memory-created > memory-recalled > relationship-familiarity**. Only one
`role="status" aria-live="polite"` line is ever in the tree, preserving current
memory-feedback behavior and avoiding a second stacked toast, a z-order
regression, or a doubled live region. Feedback auto-dismisses on the existing
`MEMORY_FEEDBACK_AUTO_DISMISS_MS` timer and clears on room entry, new prompt, and
load — the same points where `relationshipsRef` is already reset. Feedback state
is transient component state only, never persisted or restored.

## No name / score / delta / raw-text / effect / source-kind leakage

Reaffirming the existing firewalls: this feature renders and logs **no** NPC name,
room/object name, spec text, raw relationship score, numeric delta, bucket enum
value, effect kind, source kind, confidence, raw dialogue text, or provider/LLM
output. The only rendered string is the closed constant above; the gate's inputs
are two closed-enum bucket values.

## No new logs

The feature adds **zero** new log lines (as ADR-0071 did). The message text is
never logged — this also protects the `logSafety.eval.test.ts` fence that asserts
serialized logs never contain `trust` / `respect` / `fear` / `delta`. The
existing reducer log (`app/deriveAndReduceRelationship.ts`) — counts +
`familiarityBucket` + scope ids only — is unchanged.

## No authority / persistence / provider changes

Feedback is derived entirely from bucket values the reducer already produces on
each resolved turn. It reads no `WorldState`, appends no `WorldEvent`, issues no
`WorldCommand`, writes no memory, and derives no `Fact` / `fact_visibility`. No
`SaveGame` / `WorldState` / `RoomSpec` / `QuestSpec` schema, `SlotWrapper` field,
save-load sidecar, migration, or `schemaVersion` changes. No new LLM / provider /
prompt / network call — the feature keys off bucket transitions that exist in the
fake/no-key demo, so it behaves identically offline at zero cost. No NPC behavior
changes beyond the existing relationship tone context. The relationship
projection and the feedback state remain ephemeral/in-memory only.

## Consequences

- **Positive:** the first meaningful conversation with an NPC now produces a
  safe, once-per-NPC signal; players can notice the relationship system exists.
  The change is tiny (one pure gate + one selector + a shared slot), fully
  unit/component/eval-testable without rendering the full game, and cannot leak
  internals or mutate truth.
- **Accepted trade-off:** after the first-interaction `none → low`, further
  crossings are rare (`low → medium` needs familiarity ≥ 34, `medium → high`
  ≥ 67, at +3/turn), so the feature is intentionally quiet in a normal session.
  This is the intended non-spammy behavior, not a defect.
- **Deferred:** trust/respect/fear feedback, tiered phrasing, and NPC-name-aware
  messages — each behind its own future approval.

## Alternatives considered

- **Ship the wary/afraid/trusting messages now.** Rejected: those axes are dry at
  runtime (ADR-0077), so the UI would be unreachable dead code.
- **Suppress the first-interaction `none → low` crossing.** Rejected: with it
  suppressed the feature is essentially silent in normal play. Monotonicity makes
  the crossing fire at most once per NPC, so showing it is the safe primary
  signal.
- **A second independent toast alongside memory feedback.** Rejected in favor of
  a single shared slot with explicit precedence, avoiding stacked-notice z-order
  and screen-reader collisions.
- **Render the NPC's name** ("Malik seems more familiar…"). Deferred: names are a
  new render surface; v0 stays generic and name-free per the firewall precedent.
