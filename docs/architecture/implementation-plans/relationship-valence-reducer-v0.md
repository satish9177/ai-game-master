# Implementation Plan — `feature/relationship-valence-reducer-v0`

> Status: **DESIGN LOCKED — implementation blocked / not yet started.**
> Docs-only slice. No runtime, source, or test code is delivered here.
> See [ADR-0077](../decisions/ADR-0077-relationship-valence-reducer-v0.md).
>
> Companion docs: [ARCHITECTURE](../ARCHITECTURE.md) · [BOUNDARIES](../BOUNDARIES.md) ·
> [FAILURE-MODES](../FAILURE-MODES.md) · [CONVENTIONS](../CONVENTIONS.md) · [/AGENTS.md](../../../AGENTS.md).
> Builds directly on the closed-out `structured-dialogue-effects-v0`
> ([plan](./structured-dialogue-effects-v0.md)), `valenced-dialogue-effect-candidates-v0`
> ([plan](./valenced-dialogue-effect-candidates-v0.md) · [ADR-0075](../decisions/ADR-0075-valenced-dialogue-effect-candidates-v0.md)),
> and `npc-relationship-state-v0` ([plan](./npc-relationship-state-v0.md)).

---

## 0. Approval status and locked invariants (read first)

The design is **approved for a single table-only slice**. These invariants may not
be relaxed without explicit maintainer approval:

- **Closed-table valence only.** Attitude movement is a pure, total function of the
  closed `StructuredDialogueEffectKind` enum via the frozen
  `RELATIONSHIP_EFFECT_DELTA_TABLE`. No raw-text classifier, no regex/keyword
  sniffing, no LLM-proposed relationship scores, no `valence` field.
- **Four signed rows only.** Only `player_threat_candidate`,
  `player_apology_candidate`, `player_gratitude_candidate`, and
  `player_insult_candidate` are mapped in v0.
- **Five kinds stay absent/ignored.** `player_refusal_candidate`,
  `player_promise_candidate`, `npc_warning_candidate`, `npc_offer_candidate`,
  `npc_refusal_candidate` are deliberately *not* in the table; they remain ignored
  (no axis movement, no `interactionCount` increment).
- **Face-value magnitudes ≤ 3.** Because `MAX_PER_TURN_DELTA = 3`, every per-effect
  delta is authored at its true delivered value; no `>3` "pre-clamp intent" values.
- **No familiarity movement from valenced rows.** Familiarity stays owned by the two
  neutral candidate kinds; every valenced row has `familiarity: 0`.
- **No emission source added.** `classifyDialogueTurn` is unchanged and still cannot
  produce a valenced semantic event, so valenced candidates remain dry at runtime.
- **No authority / persistence path.** No `WorldState`, `WorldEvent`, `WorldCommand`,
  memory, `Fact`, `fact_visibility`, persistence, migration, save-game, provider,
  prompt, or UI change. The relationship projection stays ephemeral/in-memory only.
- **Reducer machinery untouched.** No change to gates, signatures, clamp constants,
  dedupe, or scope logic — only four literal rows are added.
- **No `schemaVersion` bump** anywhere.

---

## 1. Title and status

- **Feature:** `relationship-valence-reducer-v0`
- **Lane:** A (worked on `main` directly; no feature branch).
- **Status:** DESIGN LOCKED; docs authored in this slice; implementation deferred to
  a later, separately-sequenced slice.
- **ADR:** [ADR-0077](../decisions/ADR-0077-relationship-valence-reducer-v0.md)
  (next free number; ADR-0076 is Lane B's `read-only-timeofday-dialogue-context-v0`).

## 2. Problem statement

`valenced-dialogue-effect-candidates-v0` added an inert, validated vocabulary for
richer dialogue signals — the player threatened, apologized, thanked, insulted,
refused, promised; the NPC warned, offered, refused — sourced only from closed
semantic-event kinds. The NPC relationship reducer, however, has no mapping for any
of them: a valenced candidate currently hits `deltaRow === undefined`
(`reducer.ts`) and is ignored. A future consumer would be tempted to re-derive that
movement from raw text (a logging / "no text sniffing" violation) or from an LLM
label (an untrusted model in the authority path).

This feature closes that gap for the four signals with a clear modeling warrant —
**threat, apology, gratitude, insult** — by adding four rows to the closed delta
table, deterministically and from the closed enum, and proves the change is inert at
runtime until a separate, approved structured-action source makes valenced
candidates emittable. This is the same safe order used by the upstream dialogue-chain
features: land the closed, reviewed mapping before any emission exists.

## 3. Current architecture recap

The relationship reducer is **live** on every resolved NPC dialogue turn
(`apps/web/src/App.tsx`, `handleNpcDialogueResolved`):

```
NpcDialogueResolvedEvent
 → classifyDialogueTurn              emits only player_asked_question / npc_responded (structural signals only)
 → deriveStructuredDialogueEffects   sourceKind→candidateKind map; valenced entries live but starved of input
 → deriveAndReduceRelationship → applyRelationshipEffects   delta-table lookup + clamp
 → relationshipsRef.current.set(npcId, state)   ephemeral in-memory ref; no persistence
```

Reducer invariants already in place (`apps/web/src/domain/npcRelationship/reducer.ts`):

- validate-or-ignore each effect; fail closed on invalid;
- status/classifier gate (`status === 'candidate'`,
  `provenance.classifier === 'deterministic-local'`);
- scope gate (`worldId` / `sessionId` / `npcId` must match the reduction context);
- `effectId` dedupe within a call;
- `isInteractionPair` gating (only direct `player`↔`npc` pairs move axes);
- per-effect static bound `MAX_PER_EFFECT_DELTA = 5` (checked by a unit test over the
  table);
- **per-axis per-turn clamp `MAX_PER_TURN_DELTA = 3`** applied to the accumulator;
- axis-range clamps — trust/respect `[-100, 100]` (bipolar), fear/familiarity
  `[0, 100]` (unipolar);
- monotonic-familiarity guard (familiarity never decreases in v0);
- `interactionCount` — a bounded provenance-only counter that is logged but never
  projected to dialogue, prompt, or UI (verified: no non-test reader).

Because `classifyDialogueTurn` can only produce the two neutral kinds, **no valenced
candidate reaches the reducer at runtime today.** The four new rows are therefore
inert in live gameplay.

## 4. Proposed v0 scope

- Add **four signed rows** to `RELATIONSHIP_EFFECT_DELTA_TABLE` in
  `apps/web/src/domain/npcRelationship/reducer.ts`.
- All magnitudes are **face-value ≤ 3**, so a single valenced effect is delivered
  without per-turn-clamp truncation; the clamp still governs repeats and
  combinations.
- Add tests: reducer unit, a live-chain (`classify → derive → reduce`) non-emission
  proof, and eval extensions.
- Nothing else.

## 5. Explicit non-goals

- **No new runtime emission** of valenced candidates. `classify.ts` and `derive.ts`
  are untouched.
- **No `valence` field**, no raw-text classifier, no regex/keyword sniffing, no
  LLM-proposed relationship scores.
- **No change** to reducer gate logic, function signatures, clamp constants
  (`MAX_PER_EFFECT_DELTA`, `MAX_PER_TURN_DELTA`, `MAX_INTERACTION_COUNT`), dedupe, or
  scope logic.
- **No rows** for the five no-op kinds (they stay absent/ignored).
- **No change** to `dialogueContext.ts`, provider, prompt, or UI.
- **No persistence/schema/save-game**, memory, fact/`fact_visibility`, `WorldState`,
  `WorldEvent`, or `WorldCommand` changes.
- Relationship projection stays **ephemeral/in-memory only**.
- **No `schemaVersion` bump.**

## 6. Final delta table

Four signed rows added; five no-op kinds **deliberately absent**.

| candidate kind | trust | respect | fear | familiarity |
| --- | --- | --- | --- | --- |
| `player_threat_candidate` | −3 | −2 | +3 | 0 |
| `player_apology_candidate` | +2 | +1 | −1 | 0 |
| `player_gratitude_candidate` | +1 | +2 | 0 | 0 |
| `player_insult_candidate` | −2 | −3 | 0 | 0 |

**Absent (remain ignored — no axis movement, no `interactionCount` increment):**
`player_refusal_candidate`, `player_promise_candidate`, `npc_warning_candidate`,
`npc_offer_candidate`, `npc_refusal_candidate`.

**Delivered single-effect outcomes from a neutral prior** (what tests assert):

- threat → `{ trust: -3, respect: -2, fear: +3, familiarity: 0 }`, `clampedAxes: 0`
  (all values at or inside ±3).
- apology → `{ trust: +2, respect: +1, fear: 0, familiarity: 0 }` — **fear −1 clamps
  at the floor 0**, so `clampedAxes: 1`; the −1 only bites when fear is already
  elevated (e.g. after a prior threat), giving apology a bounded de-escalation role.
- gratitude → `{ trust: +1, respect: +2, fear: 0, familiarity: 0 }`, `clampedAxes: 0`.
- insult → `{ trust: -2, respect: -3, fear: 0, familiarity: 0 }`, `clampedAxes: 0`.

Rationale summary:

- **Familiarity 0 everywhere** avoids double-counting with the neutral candidates that
  already own familiarity; the monotonic guard would swallow any decrease regardless.
- **Threat / insult** are the strong negative signals; **apology / gratitude** are the
  small positive ones.
- **The five absent kinds** are no-ops in v0: promise fulfillment is not validated,
  refusal lacks request context, and NPC-authored valenced kinds describe NPC behavior
  rather than validated movement of NPC attitude toward the player. Leaving them absent
  (rather than adding all-zero rows) is the Minimum Safe Change and keeps them out of
  the `applied` / `interactionCount` accounting entirely.

## 7. Authority model

The relationship projection is a **non-authoritative, ephemeral, in-memory** view of
how one NPC feels toward the player. It is never a `WorldEvent`, `WorldCommand`,
`WorldState` field, memory record, or fact, and nothing may treat it as truth.
Valence is a **pure, total function of the closed `StructuredDialogueEffectKind`
enum** via the frozen delta table — never derived from text, heuristics, or a model.
The reducer accepts only effects whose `provenance.classifier === 'deterministic-local'`
and `status === 'candidate'`; there is no field through which an LLM-proposed number
can reach an axis. Candidates remain `status: 'candidate'`, consumed only into this
ephemeral projection.

## 8. Reducer impact: table-only

- **Only** `RELATIONSHIP_EFFECT_DELTA_TABLE` gains four literal rows. The object stays
  `Object.freeze`d and typed
  `Partial<Record<StructuredDialogueEffectKind, RelationshipAxisDelta>>`.
- **Unchanged:** `applyRelationshipEffects` signature and body,
  `MAX_PER_EFFECT_DELTA`, `MAX_PER_TURN_DELTA`, `MAX_INTERACTION_COUNT`,
  `AXIS_RANGES`, validate/status/classifier gate, scope gate, `effectId` dedupe,
  `isInteractionPair` gating, per-turn clamp, axis-range clamp, monotonic-familiarity
  guard, and `interactionCount` logic.
- All four new rows satisfy the existing static invariant
  (`abs(delta) ≤ MAX_PER_EFFECT_DELTA`) and the ±3 per-turn clamp applies to them
  unchanged. The bipolar negative pole (trust/respect `< 0`) and the fear floor are
  exercised for the first time, but by the **existing** clamp code — not new code.

## 9. Test plan

**Reducer unit (`domain/npcRelationship/reducer.test.ts`):**

- Static invariant still green across all rows (`abs ≤ MAX_PER_EFFECT_DELTA`).
- Per-kind direct injection for the four signed kinds → assert the exact delivered
  outcomes in §6, including `apology fear −1` clamping to 0 at baseline and the
  `clampedAxes` counts.
- No-op proof for each of the five absent kinds → inject one → assert `axes
  unchanged`, `appliedCount 0`, `ignoredCount 1`, `interactionCount` unchanged. This
  pins "absent = intentionally inert," proving they neither move an axis nor count.
- Fear de-escalation: prior fear elevated (e.g. 3) + apology → fear decreases by 1
  (never below 0), proving the −1 is reachable and bounded.
- Per-turn clamp under repeats: two/three threats in one turn → each over-±3 axis
  clamps to ±3 (e.g. trust floor −3), `clampedAxes ≥ 1`.
- Opposing-sign accumulation: threat + apology in one turn →
  `{ trust: -1, respect: -1, fear: +2, familiarity: 0 }` (net, deterministic,
  order-independent).
- Familiarity untouched by valenced rows; monotonic guard still holds.
- Existing determinism / no-prior-mutation / malformed / wrong-scope /
  non-`candidate` / non-`deterministic-local` tests remain green; update the stale
  description of the "only moves familiarity for the two currently emitted kinds"
  case so it no longer reads as a global invariant.

**Live-chain non-emission (extend `app/deriveAndReduceRelationship.test.ts` or a small
dedicated file):**

- Drive `classify → derive → reduce` (mirroring `App.tsx` `handleNpcDialogueResolved`)
  over normal and **adversarial free-text `promptId`** inputs (candidate/kind names as
  `playerLine`) → assert **zero valenced signed movement**; only familiarity moves.
  This is the load-bearing proof that the four new rows stay dry in production.

**Cross-cutting evals:**

- `evaluation/noSideEffects.eval.test.ts` — injecting valenced candidates into the
  reducer appends no `WorldEvent`, issues no command, writes no memory / fact /
  `fact_visibility`, and touches no persistence / provider / prompt / UI.
- `evaluation/logSafety.eval.test.ts` — the reducer log shape stays **unchanged**:
  counts + `familiarityBucket` + scope ids only; no raw `playerLine` / NPC reply text,
  and **no new kind or delta logging** introduced.

## 10. Runtime integration impact

**Zero behavioral change to live gameplay.** The reducer runs every resolved turn,
but only the two neutral candidate kinds reach it, so familiarity continues to tick
and trust/respect/fear stay at baseline exactly as today. The four new rows become
reachable at runtime only if and when a future, separately-approved structured-action
source makes a valenced semantic event emittable — at which point movement goes live
**automatically through the already-wired chain**, which is precisely why the values
are production-authoritative and reviewed now. No wiring, ref, or handler changes in
this feature.

## 11. Logging / debug safety

The reducer log (`app/deriveAndReduceRelationship.ts`) emits only
`processed` / `applied` / `rejected` / `clampedAxes` / `interactionCount` /
`familiarityBucket` plus scope ids — **no kinds, no deltas, no raw text.** This
feature adds nothing to that payload; the eval asserts the shape is unchanged.
`interactionCount` remains provenance/log-only (no non-test reader), so leaving the
five no-op kinds absent also keeps them out of the `applied` / interaction counters
entirely.

## 12. Implementation slices

Single slice, committed in this order (at implementation time, in a later
separately-sequenced session):

1. **Table rows** — add the four signed rows to `RELATIONSHIP_EFFECT_DELTA_TABLE`;
   static-invariant test green; no other change.
2. **Reducer unit tests** — per-kind, no-op absence, fear de-escalation, per-turn
   clamp under repeats, opposing-sign accumulation; update the stale test description.
3. **Live-chain non-emission + eval extensions** — `classify → derive → reduce`
   non-emission (incl. adversarial free text), plus `noSideEffects` and `logSafety`
   extensions.
4. **Docs closeout** — flip this plan and ADR-0077 to Implemented and add the
   ARCHITECTURE.md status line, at implementation time only (implemented-only
   convention).

Verification:

```bash
npm.cmd run test -- npcRelationship
npm.cmd run test -- structuredDialogueEffects
npm.cmd run test -- evaluation
npm.cmd run lint
```

`npm.cmd run build` may remain red for known, pre-existing, unrelated TypeScript
failures noted in prior dialogue-chain closeouts; report status honestly rather than
claiming green.

## 13. Deferred work

- **`dialogueContext.ts` bucket widening.** Its hardcoded `trustBucket: 'neutral'` /
  `respectBucket: 'neutral'` / `fearBucket: 'none'` must widen to reflect real
  trust/respect/fear **only in the future structured-action emission slice**, in
  lockstep with emission, so the dialogue hint never lags the axes. Explicitly out of
  scope here.
- **A closed structured-action source** that makes valenced candidates emittable at
  runtime — turning these rows live with no schema change.
- **The five no-op kinds** (`player_refusal_candidate`, `player_promise_candidate`,
  `npc_warning_candidate`, `npc_offer_candidate`, `npc_refusal_candidate`) — mapping
  deferred until a modeling warrant exists; each future addition is a row + test under
  its own review.
- **Any persistence surface** for the relationship projection. None in v0.

## 14. Risks

- **`relationshipsRef` lifecycle across world/session switch — pre-existing,
  out-of-scope.** The reducer scope gate protects correctness (cross-scope effects are
  ignored), so valence cannot corrupt state; valence only raises the visibility of a
  stale carryover if the ref is not reset on a session change. To be traced in a
  separate follow-up, not this feature.
- **Dry-now, authoritative-later.** The values ship inert but become live behavior
  automatically once an emission source arrives. Mitigation: full per-kind + clamp
  coverage now, and the live-chain non-emission test guarding the "still dry today"
  claim.
- **Stale test intent.** The existing "only moves familiarity" test description would
  mislead once other axes move; addressed in slice 2.

## 15. Final recommendation

**Approve implementation of this single table-only slice as specified.** The change is
minimal and closed-table-driven: four face-value (≤ 3) signed rows, five no-op kinds
intentionally absent and proven inert, every gate / clamp / dedupe / scope / signature
untouched, no emission or authority path added, and the reducer's live status covered
by a `classify → derive → reduce` non-emission proof. The design satisfies every hard
boundary and is ready to implement in the slice order of §12 when scheduled.

### Minimum Safe Change Check

- **Reused:** `RELATIONSHIP_EFFECT_DELTA_TABLE`, `applyRelationshipEffects`, the
  existing reducer gates/clamps/dedupe/scope logic, `StructuredDialogueEffect`
  contracts, the `deriveAndReduceRelationship` seam, and the `noSideEffects` /
  `logSafety` eval suites.
- **Minimum new code:** four delta-table rows — no new runtime files, functions, or
  abstractions; the five no-op kinds stay absent; test additions only.
- **Safety boundaries unchanged:** no `WorldEvent` / `WorldCommand` / reducer gate /
  `WorldState`; `classify.ts` / `derive.ts` / `dialogueContext.ts` untouched; memory
  firewall and facts intact; no persistence / migration / `schemaVersion` bump; no
  provider / prompt / UI change; valence derives only from the closed candidate-kind
  enum and inspects no text.
- **Tests prove it:** §9, anchored by the live-chain non-emission proof (§10).
