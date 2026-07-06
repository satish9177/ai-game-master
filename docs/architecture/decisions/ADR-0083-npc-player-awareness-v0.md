# ADR-0083: NPC→player awareness is a deterministic same-room proximity signal — proximity-only tiers, ephemeral, advisory, with no behavior authority

- **Status:** Accepted / Not yet implemented (docs-first)
- **Date:** 2026-07-06
- **Deciders:** Project owner
- **Builds on:** the existing presentation-only NPC movement stack and per-frame same-room
  read seam (`apps/web/src/renderer/engine/Engine.ts` `updateProximity`,
  `apps/web/src/renderer/engine/npc/behaviorTracker.ts`,
  `apps/web/src/domain/npcMovementContract.ts`), and the "land a dry/tested foundation before
  wiring behavior" pattern of
  [`npc-patrol-route-v0`](../implementation-plans/npc-patrol-route-v0.md)
  ([ADR-0080](./ADR-0080-npc-patrol-route-v0.md)),
  [`relationship-valence-reducer-v0`](../implementation-plans/relationship-valence-reducer-v0.md)
  ([ADR-0077](./ADR-0077-relationship-valence-reducer-v0.md)), and
  [`lazy-room-environment-transitions-v0`](../implementation-plans/lazy-room-environment-transitions-v0.md)
  ([ADR-0078](./ADR-0078-room-environment-transition-model-dry-v0.md)).

> Full plan — data shape, detection rules, tracker/Engine integration, test plan, and
> slices — lives in
> [`npc-player-awareness-v0`](../implementation-plans/npc-player-awareness-v0.md).
> This ADR records the decision and its boundaries. It is written **docs-first**, ahead of
> implementation.

---

## Context

NPCs move (idle / wander / patrol, the last landed by [ADR-0080](./ADR-0080-npc-patrol-route-v0.md))
but have **no notion of where the player is**. A later `hostile-npc-chase-lite-v0` will need
to know how close an NPC is to the player. We want that proximity signal now, as a safe,
deterministic foundation — **without** introducing any of the behavior it will eventually
feed.

The stack we build on is already in a safe shape:

- The **player** is a `THREE.Object3D` (`Engine.player`) whose position is already read for
  same-room proximity in `Engine.updateProximity()` (nearest in-range interactable → HUD).
  This is the correct, precedented player-position source; there is no global/omniscient
  player registry.
- **NPC nodes** are top-level Three.js nodes tagged `userData.objectType === 'npc'` and keyed
  by `userData.objectId`, already filtered in `Engine.setRoom`. Moving NPCs' positions are
  synced each frame by `WanderMotor.syncXZ`; static NPCs sit at their home node.
- `NpcBehaviorTracker` is an established **ephemeral, in-memory, per-NPC runtime-state**
  holder, unit-tested in isolation and **cleared in `setRoom()` and `dispose()`**.
- `domain/npcMovementContract.ts` is an established **pure, renderer-agnostic** contract with
  a `NPC_WANDER` const block and `distanceXZ` — the model layer awareness should mirror.

Two facts shape the safe design:

1. Awareness is a **new pure read over the same same-room positions and the same ephemeral
   tracker pattern** — not a new authority surface and not a movement change.
2. The tier name `alerted` **sounds like** a behavior (alarm/chase). It must be defined
   honestly as the closest **proximity band only**, with no reaction attached, or v0 would
   overclaim exactly as "predefined patrol" would have in ADR-0080.

A naive v0 would (a) let `alerted` trigger a reaction, (b) evaluate only `WanderMotor` NPCs
and silently miss static ones, or (c) thread hostility/type/time modifiers now. Each of those
is rejected below.

---

## Decision

Adopt a **deterministic, ephemeral, same-room NPC→player proximity signal** that is
presentation/runtime-only, advisory, and has **no behavior authority**.

- **v0 is deterministic same-room distance/proximity awareness only.** A pure detector maps
  one same-room NPC position + the player position + fixed radii to a proximity tier. It is a
  pure function of two XZ positions and constants — no randomness, clock, or history.

- **Awareness buckets are proximity-only, not behavior authority.** The four tiers —
  `unaware` / `nearby` / `aware` / `alerted` — are **distance bands**. `alerted` is the
  closest band and means **nothing** beyond "closest"; it does not chase, attack, aggro,
  alarm, emit an event, trigger an encounter, or change a relationship. Selection uses
  **inclusive** thresholds, tightest tier wins: `d <= 1.5 → alerted`, else `d <= 3.0 →
  aware`, else `d <= 5.0 → nearby`, else `unaware`.

- **Constants-only radii in v0.** Radii are fixed constants (`ALERTED_RADIUS 1.5`,
  `AWARE_RADIUS 3.0`, `NEARBY_RADIUS 5.0`, strictly ordered). **No** per-NPC profile/radius
  metadata, and **no** NPC type / hostility / relationship / time-of-day / facing /
  line-of-sight modifier.

- **All same-room NPC nodes are evaluated, including static NPCs.** Awareness runs over an
  Engine-level `npcId → THREE.Object3D` map covering **every** current-room NPC node, not
  only `WanderMotor`-registered movers. Static NPCs are eligible for the same tiers.

- **Ephemeral / runtime-only.** Awareness lives in an in-memory tracker mirroring
  `NpcBehaviorTracker`, computed per frame in `renderLoop` (alongside `updateProximity`),
  cleared in `setRoom()` and `dispose()`. It reads positions read-only and writes nothing
  but its own map plus an emit-on-change callback.

- **Advisory / no consumer in v0.** The signal is read-only advisory output. **Nothing in v0
  consumes it** to change movement, dialogue, relationships, memory, or any other system.
  The first consumer arrives with a future, separately-approved `hostile-npc-chase-lite-v0`.

- **No UI/debug indicator in v0.** No visible player-facing awareness marker (Slice 3
  deferred).

- **Hard boundaries preserved.** No chase / combat / damage / NPC attack / encounter
  triggering; no relationship-driven hostility or any relationship read/write; no LLM /
  provider / prompt change; no `WorldState` mutation; no `WorldEvent` / `WorldCommand`; no
  persistence / schema / save-game / `RoomSpec` change and no `schemaVersion` bump; no memory
  / fact / `fact_visibility` read or write; no raw prompt/provider/dialogue/room-text logging
  and no per-frame logging; no cross-room awareness; no movement override; no dialogue/
  relationship consumer. **Fail closed:** missing/non-finite position or different-room →
  `unaware`.

---

## Consequences

- **Safer by construction: no schema/save/authority changes.** v0 adds a pure detector, an
  ephemeral tracker, and one per-frame read seam — all presentation/runtime-only. No
  authoritative state, `RoomSpec`, persistence, migration, or `schemaVersion` bump is
  introduced.

- **No gameplay behavior change.** Because awareness has no consumer, players see no
  difference in v0. NPCs move exactly as before (idle/wander/patrol). The value is the
  tested foundation, not a visible effect.

- **The signal is honest.** Defining `alerted` as a proximity-only band (not an alarm)
  prevents the "the NPC noticed me, so it must be about to react" misread and keeps the
  contract truthful ahead of chase-lite.

- **Chase-lite wiring is small and low-risk.** Because the detector, tiers, tracker, and
  same-room read seam are landed and tested (moving + static NPCs, exact boundaries, guards,
  no-mutation, no-side-effect), the future consumer only has to read an existing signal.

- **Build stays green.** Existing movement/idle/wander/patrol and their tests are untouched
  except for additive coverage.

### Known limitation

Awareness is **distance-only**: it ignores walls, occluders, and facing, so an NPC is
"aware" of a player who is close but behind a wall. Line-of-sight / facing is a deliberate
deferral (below), recorded here as a known limitation, not a defect.

### Deferred (each its own maintainer-approved feature/ADR)

- **`hostile-npc-chase-lite-v0`** — the first consumer of the awareness signal (movement
  override on `alerted`).
- **Per-NPC awareness radii / profiles** and **NPC type/hostility modifiers**.
- **Relationship-driven awareness or hostility.**
- **Time-of-day-driven awareness** (world-clock modulation).
- **Facing / line-of-sight / occlusion** awareness.
- **UI / debug awareness indicator** (Slice 3).
- **Cross-room awareness.**

---

## Alternatives considered

- **Let `alerted` trigger a reaction now (chase/alarm/event).** Rejected: that is behavior
  authority, out of scope, and would couple v0 to combat/encounter systems. v0 is
  advisory-only; the reaction is chase-lite's job.
- **Evaluate only `WanderMotor` NPCs.** Rejected: it silently misses static NPCs, producing
  an inconsistent signal. Awareness runs over all same-room NPC nodes via an Engine-level map.
- **Thread NPC type / hostility / relationship / time / facing modifiers into v0.** Rejected:
  no trusted closed metadata exists for most of these (mirrors ADR-0080's authored-metadata
  deferral), and each adds surface without a v0 consumer. Constants-only keeps v0 minimal and
  honest.
- **Store awareness in `WorldState` / persist it.** Rejected: awareness is derived, ephemeral,
  and recomputable each frame from positions; persisting it would add an authoritative surface
  and a save/schema change for no benefit. Use the `NpcBehaviorTracker` ephemeral pattern.
- **Put the detector in the renderer with `THREE` types.** Rejected: keeps the model layer
  renderer-agnostic and untestable-in-isolation. The detector lives in `domain/` over plain
  `{ x, z }`; only the tracker/Engine touch `THREE` nodes.
- **Ship a debug awareness indicator in v0.** Deferred: no v0 consumer or player value, and a
  visible marker would imply behavior the tiers deliberately lack.
- **Plan-only, no ADR.** Rejected: this establishes the awareness authority boundary
  (proximity-only, advisory, ephemeral) that chase-lite will build on, which warrants a
  decision record.

---

## Verification

Not implemented yet (docs-first). Planned verification at implementation time, per the
[implementation plan test plan](../implementation-plans/npc-player-awareness-v0.md#11-test-plan):

- `domain/npcAwarenessContract.test.ts` — tiers, **exact inclusive boundaries** (1.5 / 3.0 /
  5.0), monotonic tightest-tier selection, `sameRoom === false` guard, non-finite-position
  guard, determinism, radii-order assertion.
- `renderer/engine/npc/npcAwarenessTracker.test.ts` — per-NPC storage, emit-on-change, `clear()`.
- `renderer/engine/Engine.test.ts` (extend) — tier rises on approach for **moving and static**
  NPCs, reset on `setRoom`, `room.objects` no-mutation deep-equal, no behavioral side effect.
- `npx tsc --noEmit` and `eslint` on the new/changed files.

Boundaries to re-confirm at closeout (must all hold):

- No `WorldState` / `WorldEvent` / `WorldCommand` / `applyEvent` change.
- No schema / save / persistence / migration / `schemaVersion` bump; no `RoomSpec` mutation.
- No memory / fact / `fact_visibility` read or write.
- No LLM / provider / prompt change.
- No chase / combat / damage / encounter / relationship / dialogue / memory effect.
- No cross-room awareness; no movement override; no awareness consumer.
- Awareness remains ephemeral/runtime-only and advisory; existing movement is unchanged.
- No UI/debug indicator added (Slice 3 deferred).
