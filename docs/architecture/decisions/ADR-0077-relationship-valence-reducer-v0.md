# ADR-0077: Relationship Valence Reducer v0

- **Status:** Accepted / Implemented
- **Date:** 2026-07-05
- **Deciders:** Project owner
- **Builds on:**
  [`structured-dialogue-effects-v0`](../implementation-plans/structured-dialogue-effects-v0.md),
  [`valenced-dialogue-effect-candidates-v0`](../implementation-plans/valenced-dialogue-effect-candidates-v0.md)
  ([ADR-0075](./ADR-0075-valenced-dialogue-effect-candidates-v0.md)),
  [`npc-relationship-state-v0`](../implementation-plans/npc-relationship-state-v0.md).

> Full plan, test plan, and slices live in
> [`relationship-valence-reducer-v0`](../implementation-plans/relationship-valence-reducer-v0.md).
> This ADR records the decision and delivery closeout.

---

## Context

`valenced-dialogue-effect-candidates-v0` (ADR-0075) added an inert, validated
vocabulary of valenced `StructuredDialogueEffect` kinds — the player threatened,
apologized, thanked, insulted, refused, promised; the NPC warned, offered, refused —
each sourced only from a closed `DialogueSemanticEventKind`. The NPC relationship
reducer (`domain/npcRelationship/reducer.ts`) has no mapping for any of them: a
valenced candidate currently falls through `deltaRow === undefined` and is ignored.

Without a safe mapping, a future consumer would be pushed toward one of two unsafe
shortcuts already rejected upstream: re-deriving valence from **raw dialogue text**
(regex/keyword sniffing — a "no text sniffing" and logging-redaction violation), or
letting the **LLM propose the relationship delta** (an untrusted model in the
authority path).

Two facts about the current code shape the safe design:

1. The reducer is **live** on every resolved NPC dialogue turn
   (`App.tsx` `handleNpcDialogueResolved` → `classifyDialogueTurn` →
   `deriveStructuredDialogueEffects` → `deriveAndReduceRelationship` →
   `relationshipsRef`), but `classifyDialogueTurn` emits only
   `player_asked_question` and `npc_responded`. No valenced candidate can reach the
   reducer at runtime today, so a valenced mapping is inert until a separate emission
   source exists.
2. The reducer already enforces per-effect (`MAX_PER_EFFECT_DELTA = 5`) and
   **per-turn (`MAX_PER_TURN_DELTA = 3`)** clamps, bipolar/unipolar axis ranges, a
   monotonic-familiarity guard, dedupe, and scope/status/classifier gates. The
   per-turn clamp of 3 — not the per-effect bound of 5 — is the true delivered
   ceiling for a single-effect turn.

---

## Decision

Add a **closed, table-only** valence mapping to the relationship reducer. The reducer
gains **four signed rows** in `RELATIONSHIP_EFFECT_DELTA_TABLE`; no other reducer code
changes.

- **Closed-table driven.** Attitude movement is a pure, total function of the closed
  `StructuredDialogueEffectKind` enum via the frozen delta table — never from raw
  text, regex/keyword matching, heuristics over content, or an LLM label. No `valence`
  field is added.
- **Only four signed candidate rows are approved in v0:**

  | candidate kind | trust | respect | fear | familiarity |
  | --- | --- | --- | --- | --- |
  | `player_threat_candidate` | −3 | −2 | +3 | 0 |
  | `player_apology_candidate` | +2 | +1 | −1 | 0 |
  | `player_gratitude_candidate` | +1 | +2 | 0 | 0 |
  | `player_insult_candidate` | −2 | −3 | 0 | 0 |

- **Five no-op kinds remain absent/ignored** — `player_refusal_candidate`,
  `player_promise_candidate`, `npc_warning_candidate`, `npc_offer_candidate`,
  `npc_refusal_candidate`. They are deliberately *not* in the table: promise
  fulfillment is not validated, refusal lacks request context, and NPC-authored
  valenced kinds describe NPC behavior rather than validated movement of NPC attitude
  toward the player. Leaving them absent (rather than all-zero rows) is the Minimum
  Safe Change and keeps them out of the `applied` / `interactionCount` accounting.
- **Magnitudes are face-value ≤ 3 because `MAX_PER_TURN_DELTA` is 3.** Values are
  authored at their true delivered amount; there are no `>3` "pre-clamp intent"
  values. A single valenced effect is delivered without truncation; the per-turn clamp
  still governs repeats and opposing/combined turns. `apology fear −1` clamps at the
  fear floor 0, so it is inert at baseline and only de-escalates a previously elevated
  fear.
- **No familiarity movement from valenced rows.** Every valenced row is
  `familiarity: 0`; familiarity stays owned by the two neutral candidate kinds, and
  the monotonic-familiarity guard would swallow any decrease regardless. This avoids
  double-counting familiarity.
- **No emission source is added.** `classifyDialogueTurn` is unchanged and still emits
  only `player_asked_question` and `npc_responded`, reading only structural signals
  (`promptId`, `hasNpcReply`). Consequently the four new rows are **dry at runtime**:
  `classify → derive → reduce` yields zero valenced signed movement for every input —
  an invariant enforced by a live-chain non-emission test, not merely asserted.
- **No persistence or authority path is added.** The relationship projection stays
  ephemeral/in-memory only. No `WorldState`, `WorldEvent`, `WorldCommand`, memory,
  `Fact`, `fact_visibility`, persistence, migration, save-game, provider, prompt, or
  UI change. The reducer accepts only
  `provenance.classifier === 'deterministic-local'` and `status === 'candidate'`
  effects, so no LLM-proposed number can reach an axis.
- **Reducer machinery is untouched.** No change to gate logic, function signatures,
  clamp constants, dedupe, or scope logic — only four literal rows are added. No
  `schemaVersion` bump.

The four rows become live behavior only when a future, separately-approved closed
structured-action source makes a valenced semantic event emittable — turning them live
through the already-wired chain with no further schema change.

---

## Consequences

- The relationship reducer has a safe, closed, reviewed mapping for the four
  well-warranted valenced signals, with **zero runtime behavior change** and without a
  text- or LLM-based valence path.
- The pattern for a future valenced signal is clear: add its source semantic-event
  kind (if missing), its candidate kind, its map entry, its reducer row, and
  (separately) make a closed structured-action source emit the source event.
- Adding valenced rows exercises the bipolar negative pole (trust/respect `< 0`) and
  the fear floor for the first time, but through the **existing** clamp code, not new
  code.
- No authoritative-state, memory, fact, `fact_visibility`, persistence, migration,
  save-game, provider, prompt, UI, or lint-rule change is introduced. No
  `schemaVersion` bump.
- **`dialogueContext.ts` bucket widening is deferred.** Its hardcoded
  `trustBucket: 'neutral'` / `respectBucket: 'neutral'` / `fearBucket: 'none'` must
  widen to reflect real trust/respect/fear **only in the future structured-action
  emission slice**, in lockstep with emission, so the dialogue hint never lags the
  axes. It is intentionally untouched here.
- **Deferred (each its own maintainer-approved feature):** a closed structured-action
  source that makes emission live; mapping for the five currently-absent no-op kinds;
  `dialogueContext.ts` bucket widening; any persistence surface for the projection.
- **Recorded pre-existing risk (out of scope):** the `relationshipsRef` lifecycle
  across a world/session switch. The reducer scope gate protects correctness, so
  valence cannot corrupt state; the risk is only a stale carryover if the ref is not
  reset on session change. To be traced in a separate follow-up.

---

## Verification

Implemented and verified 2026-07-05.

Files changed:

- `apps/web/src/domain/npcRelationship/reducer.ts`
- `apps/web/src/domain/npcRelationship/reducer.test.ts`
- `apps/web/src/app/deriveAndReduceRelationship.test.ts`
- `apps/web/src/evaluation/noSideEffects.eval.test.ts`
- `apps/web/src/evaluation/logSafety.eval.test.ts`

Verification run:

```bash
npm.cmd run test -- npcRelationship
npm.cmd run test -- npcRelationship deriveAndReduceRelationship evaluation
npm.cmd run lint
```

Results:

- `npm.cmd run test -- npcRelationship` passed: 3 files, 64 tests.
- `npm.cmd run test -- npcRelationship deriveAndReduceRelationship evaluation`
  passed: 11 files, 115 tests.
- `npm.cmd run lint` passed.

Runtime invariant remains true: `classifyDialogueTurn` is unchanged and still emits
only `player_asked_question` / `npc_responded` from structural signals, so the four
new signed reducer rows are dry at runtime. Live-chain tests cover normal free text,
unknown prompt ids, known `ask-room` / `ask-help` prompt ids, and adversarial
player-line text containing candidate/source kind names; all produce zero signed
valenced movement.

Safety boundaries remained unchanged: no reducer logic/signature/gate/clamp/dedupe
change beyond the table rows; no `classify.ts`, `derive.ts`, `dialogueContext.ts`,
App runtime wiring, provider, prompt, UI, persistence, memory, facts, `WorldState`,
`WorldEvent`, or `WorldCommand` change; no `valence` field, raw text classifier,
regex/keyword sniffing, LLM-proposed score, schema bump, or persistence/authority path
was added.
