# ADR-0080: NPC patrol is a generated deterministic in-room foundation, opt-in only until authored route metadata exists

- **Status:** Accepted (design) / DOCS-FIRST / Not yet implemented
- **Date:** 2026-07-06
- **Deciders:** Project owner
- **Builds on:** the existing presentation-only NPC movement stack
  (`apps/web/src/domain/npcMovementContract.ts`,
  `apps/web/src/renderer/engine/npc/wanderStep.ts`,
  `apps/web/src/renderer/engine/npc/WanderMotor.ts`), and the "land a dry/tested
  foundation before wiring behavior" pattern of
  [`relationship-valence-reducer-v0`](../implementation-plans/relationship-valence-reducer-v0.md)
  ([ADR-0077](./ADR-0077-relationship-valence-reducer-v0.md)) and
  [`lazy-room-environment-transitions-v0`](../implementation-plans/lazy-room-environment-transitions-v0.md)
  ([ADR-0078](./ADR-0078-room-environment-transition-model-dry-v0.md)).

> Full plan — route shape, validation rules, movement algorithm, motor integration,
> test plan, and slices — lives in
> [`npc-patrol-route-v0`](../implementation-plans/npc-patrol-route-v0.md).
> This ADR records the decision and its boundaries. It is written **docs-first**,
> ahead of implementation.

---

## Context

NPCs either idle or wander randomly near their home position. We want NPCs to be able to
move along a **safe, predictable in-room beat** instead of standing still, as a foundation
that later features (player awareness, day/night routine, hostile chase-lite) can build on.

The movement stack we would build on is already in a safe shape:

- NPC home positions come from validated **RoomSpec** (`npc.position`).
- The `WanderMotor` mutates **only** Three.js presentation refs via `syncXZ` (the NPC
  `node`, an optional `ring`, and the runtime `interactable`). It never writes
  `room.objects` or any authoritative state.
- A pure `NpcWanderField` already encodes playable bounds and exclusion discs (spawn,
  exits, interactables, other-NPC homes, footprints), and pure predicates
  `isWanderPositionAllowed` / `isWanderSegmentAllowed` already gate positions and segments.
- `shouldPauseWander({ interactionLocked, npcTalking })` already pauses movement during a
  dialogue/interaction lock.

Two facts shape the safe design:

1. Patrol is a **new traversal policy over the same validated field and the same
   presentation-only sync** — not a new authority surface.
2. The phrase "predefined patrol points" implies **authored** data, but authored waypoints
   (or roles/schedules) would require a RoomSpec/schema/save-game field and its own
   approval. So the honest, minimal v0 is **generated deterministic** routes, with authored
   metadata deferred.

A naive v0 would also auto-assign patrol to every geometry-eligible NPC. Because
`registerWanderNpcs` currently registers *all* NPCs for wander, that would silently turn
merchants/villagers into pacing guards — worse than wander and thematically wrong, with no
trusted role data to distinguish them.

---

## Decision

Adopt a **generated deterministic in-room patrol route foundation** that is
presentation/runtime-only, composes with existing wander, and is **not** blanket-assigned.

- **v0 is a generated deterministic in-room patrol route foundation.** Waypoints are
  generated at runtime from the NPC's authoritative RoomSpec `home` plus the existing
  `NpcWanderField`, seeded deterministically (`stableHash01` over a stable `roomId:npcId`
  key) so the same room + NPC always yields the identical route. Routes reuse
  `isWanderPositionAllowed` / `isWanderSegmentAllowed` for validation and fail closed
  (`null` route → wander → idle). Traversal is ping-pong over `>= 2` validated waypoints.

- **No authored/predefined route metadata in v0.** Attaching authored waypoints, roles, or
  schedules to an NPC would require a RoomSpec/schema/save-game change and separate
  approval; it is deferred to v1.

- **No blanket assignment to real NPCs.** Real rooms keep every NPC on the existing
  wander/idle path. An NPC patrols in v0 **only** when explicitly opted in through a **safe
  internal fixture/test seam** (an internal, presentation/runtime-only flag used by tests
  and controlled fixtures). Real gameplay assignment waits for trusted role/route metadata
  (v1).

- **Explicit movement policy discriminant in `WanderMotor`.** Each motor entry carries
  `policy: 'wander' | 'patrol'` and the `update()` branch selects on it. Patrol is **never
  inferred from route presence.** The pause path and `syncXZ` (node + ring + interactable)
  are shared unchanged. The `WanderMotor.ts` filename is kept in v0 (see limitation below).

- **Presentation/runtime-only, fail-closed composition.**
  `patrol opt-in + valid route => patrol`;
  `otherwise => existing wander`;
  `no valid wander => idle`;
  `dialogue/interaction lock => pause`.
  Patrol writes only Three.js presentation refs via `syncXZ`; `buildNpcPatrolRoute` reads
  `room.objects` (home) read-only and never writes it.

- **Hard boundaries preserved.** No LLM/provider/prompt change; no `WorldEvent` /
  `WorldCommand`; no persistence / schema / save-game / `RoomSpec` mutation; no memory /
  fact / `fact_visibility`; no awareness / chase / combat / damage / encounter triggering;
  no cross-room movement; no complex pathfinding; no `schemaVersion` bump.

---

## Consequences

- **Safer by construction: no schema/save changes.** v0 adds pure generation + validation
  + a stepping reducer + a discriminated motor branch + a gated opt-in seam, all
  presentation/runtime-only. No authoritative state, RoomSpec, persistence, migration, or
  `schemaVersion` bump is introduced.

- **Real gameplay stays mostly existing wander/idle until v1 metadata.** Because there is
  no blanket assignment, players see no behavior change in real rooms; NPCs continue to
  wander/idle. Patrol becomes real gameplay only when a v1 authored role/route source
  opts NPCs in through the reviewed contract.

- **The patrol path is tested through the opt-in fixture/test seam.** The generation,
  validation, ping-pong stepping, motor `policy` branch, pause-no-drift, and eligibility
  behavior are all covered now, plus a `room.objects` no-mutation deep-equal assertion — so
  the v1 wiring is small and low-risk.

- **Build stays green.** No runtime behavior changes for existing NPCs; existing wander/idle
  and its tests are untouched except for additive coverage.

### Known limitation

Exclusion discs cover other NPCs' **home** positions, not their **live moving** positions.
A patrolling NPC can therefore overlap a *moving* NPC's current cell. This is **exact
wander parity** (the existing behavior) and is recorded here as a known limitation, not a
patrol regression.

### Deferred (each its own maintainer-approved feature/ADR)

- **Authored/predefined patrol route metadata** (the RoomSpec/schema/save-game field).
- **Route roles and schedules** (e.g., guard vs. villager selection).
- **Day/night route selection** (patrol driven by world-clock time-of-day).
- **Awareness / chase override** of patrol (a later policy pre-empting patrol).
- **Cross-room movement.**
- **Rename `WanderMotor` → `NpcMovementMotor`** — deferred cleanup; in v0 the class keeps
  its name but now owns wander + patrol.

---

## Alternatives considered

- **Ship authored "predefined" patrol points now.** Rejected for v0: requires a
  RoomSpec/schema/save-game field and separate approval; the honest minimal foundation is
  generated deterministic routes.
- **Auto-assign patrol to every geometry-eligible NPC.** Rejected: turns merchants/
  villagers into pacing guards with no trusted role data; worse than wander. v0 uses an
  opt-in fixture/test seam instead.
- **Infer the motor policy from "route present?"** Rejected: implicit and fragile. An
  explicit `policy: 'wander' | 'patrol'` discriminant keeps the branch decidable and
  testable.
- **Introduce a `MovementPolicy` strategy abstraction now.** Rejected for v0: future-proof
  abstraction without current use (only two policies). Extend the existing motor; revisit
  when a third policy (chase) actually lands.
- **Rename `WanderMotor` to `NpcMovementMotor` in v0.** Deferred: mid-feature file renames
  are discouraged; recorded as future cleanup.
- **Plan-only, no ADR.** Rejected: this establishes the movement-policy authority boundary
  and the generated-vs-authored decision, which warrants a decision record.

---

## Verification

**Not yet implemented — this ADR is docs-first.** No source, test, or runtime file is
changed by landing it.

Docs-only change:

- `docs/architecture/implementation-plans/npc-patrol-route-v0.md` (new)
- `docs/architecture/decisions/ADR-0080-npc-patrol-route-v0.md` (new)

Verification for this docs step:

```bash
git diff --stat        # docs files only
git status --short      # no source/test/runtime files changed
```

On implementation (Slices 1–3), the plan's test plan will be exercised and this ADR plus
the implementation plan flipped to Implemented, with the ARCHITECTURE.md status line added
at that time (implemented-only convention). Boundaries to re-confirm at closeout, all
unchanged:

- No `WorldState` / `WorldEvent` / `WorldCommand` / `applyEvent` change.
- No schema / save / persistence / migration / `schemaVersion` bump.
- No `RoomSpec` mutation.
- No memory / fact / `fact_visibility` write.
- No LLM / provider / prompt change.
- No awareness / chase / combat / damage / cross-room movement / complex pathfinding.
- Movement remains presentation/runtime-only; existing wander remains the fallback.
