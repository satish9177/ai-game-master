# Implementation Plan — `feature/npc-patrol-route-v0`

> Status: **DESIGN APPROVED / DOCS-FIRST / NOT IMPLEMENTED.**
> This document is written **before** any code so the later implementation slices
> can read and follow the approved design. No source, test, or runtime file is
> changed by landing this plan.
> See [ADR-0080](../decisions/ADR-0080-npc-patrol-route-v0.md).
>
> Companion docs: [ARCHITECTURE](../ARCHITECTURE.md) · [BOUNDARIES](../BOUNDARIES.md) ·
> [FAILURE-MODES](../FAILURE-MODES.md) · [CONVENTIONS](../CONVENTIONS.md) · [/AGENTS.md](../../../AGENTS.md).
> Follows the "land a dry/tested foundation before wiring behavior" pattern used by
> [`relationship-valence-reducer-v0`](./relationship-valence-reducer-v0.md)
> ([ADR-0077](../decisions/ADR-0077-relationship-valence-reducer-v0.md)) and
> [`lazy-room-environment-transitions-v0`](./lazy-room-environment-transitions-v0.md)
> ([ADR-0078](../decisions/ADR-0078-room-environment-transition-model-dry-v0.md)).

---

## 0. Approval status and locked invariants (read first)

The design is **approved as a generated deterministic in-room patrol foundation**.
These invariants may not be relaxed without explicit maintainer approval:

- **Generated deterministic route only.** v0 patrol waypoints are generated at
  runtime from the NPC's authoritative RoomSpec `home` plus the existing validated
  movement field. There is **no authored/predefined patrol metadata** in v0.
- **Authored/predefined route metadata is deferred to v1**, because attaching authored
  waypoints to an NPC would require RoomSpec/schema/save-game changes that need
  separate maintainer approval.
- **No blanket assignment.** v0 must not auto-assign patrol routes to every
  geometry-eligible NPC in real gameplay. Real NPCs keep the existing wander/idle path
  unless explicitly opted in through a **safe internal fixture/test seam**.
- **Presentation/runtime-only.** Patrol mutates only Three.js presentation refs via the
  existing `syncXZ`. It never touches `room.objects`, `WorldState`, `WorldEvent`,
  `WorldCommand`, the event log, SQLite, memory, or facts.
- **Reuse existing safety.** Route generation and stepping reuse `NpcWanderField`,
  `isWanderPositionAllowed`, and `isWanderSegmentAllowed` — no new bounds/exclusion math.
- **Explicit policy discriminant.** `WanderMotor` entries carry `policy: 'wander' |
  'patrol'`; patrol is **never inferred from route presence**.
- **Fail closed.** Any validation gap yields no route, and the NPC falls back to wander,
  then idle.
- **No `schemaVersion` bump.**

---

## 1. Title and status

- **Feature:** `npc-patrol-route-v0` — Generated Deterministic In-Room Patrol Route Foundation.
- **Lane:** worked on `main` directly; no feature branch.
- **Status:** DESIGN APPROVED / DOCS-FIRST / NOT IMPLEMENTED.
- **ADR:** [ADR-0080](../decisions/ADR-0080-npc-patrol-route-v0.md) (next free number).

## 2. Problem statement

NPCs either idle or wander randomly near their home position. We want a **generated
deterministic, in-room patrol route foundation** so an NPC *can* walk a fixed, safe beat
instead of standing still — deterministically, presentation-only, and composing with the
existing wander/idle behavior.

Naming honesty: the source of the route in v0 is **generated**, not authored. Calling
this a "patrol route" must not imply authored/predefined data. v0 lands the generation,
validation, stepping, motor branch, and a **tested opt-in wiring seam**; it does **not**
turn every NPC into a patroller and does **not** introduce authored route metadata.

## 3. Current movement architecture recap

Movement today is already **presentation-only** and deterministic:

- `apps/web/src/domain/npcMovementContract.ts` — pure `NpcWanderField` (home, playable
  bounds, exclusion discs for spawn / exits / interactables / other-NPC homes /
  footprints) plus pure predicates `isWanderPositionAllowed`, `isWanderSegmentAllowed`,
  `chooseWanderStep`, `shouldPauseWander`, `wanderPauseSeconds`, `distanceXZ`, and the
  `NPC_WANDER` constants (`MAX_SPEED`, `MAX_RADIUS_FROM_HOME = 2.5`, clearances,
  `SEGMENT_SAMPLE_SPACING = 0.4`, pause bounds).
- `apps/web/src/renderer/engine/npc/wanderStep.ts` — pure reducer `updateWanderStep`
  advancing an NPC toward a chosen target at `MAX_SPEED`, re-validating each incremental
  position and segment, pausing on arrival.
- `apps/web/src/renderer/engine/npc/WanderMotor.ts` — stateful motor. Holds one entry per
  NPC, calls `updateWanderStep` per frame, and `syncXZ` writes the result to the Three.js
  `node`, optional `ring`, and runtime `interactable` refs. `isWalking()` reports mode.
- `apps/web/src/renderer/engine/npc/behaviorTracker.ts` + `domain/ports/npcBehavior.ts` —
  track `idle` / `talking` / `wandering` (drives idle-animation intensity).
- `apps/web/src/renderer/engine/Engine.ts` — `registerWanderNpcs` builds a field per
  `type:'npc'` object with an id and registers it; `renderLoop` → `updateNpcWander(dt)` →
  `wanderMotor.update(dt, { interactionLocked, isNpcTalking })`, then mirrors walking
  state into the behavior tracker. `shouldPauseWander({ interactionLocked, npcTalking })`
  already freezes movement while a dialogue/interaction lock is active and re-syncs the
  frozen position.

Key facts (verified by inspection):

1. NPC positions originate from validated **RoomSpec** (`npc.position` → `home`).
2. The motor mutates **only** Three.js presentation refs via `syncXZ` — never
   `room.objects` or any authoritative state.
3. Validation already avoids bounds, spawn, exits, interactables, other-NPC homes, and
   footprints, with segment sampling. This is fully reusable for patrol.
4. Existing tests: `npcMovementContract.test.ts`, `wanderStep.test.ts`,
   `WanderMotor.test.ts`, `behaviorTracker.test.ts`, `Engine.test.ts`.

**Conclusion:** patrol is a *new traversal policy over the same validated field and the
same presentation-only sync* — not a new authority surface.

## 4. Approved v0 scope

- **Pure patrol model + validation** (`domain/npcPatrolContract.ts`):
  `buildNpcPatrolRoute(field, seed)` generates an ordered, validated, deterministic
  waypoint set reusing the existing field + predicates; returns `null` when a safe route
  cannot be formed.
- **Pure patrol step reducer** (`renderer/engine/npc/patrolStep.ts`):
  `updatePatrolStep` advances toward the current waypoint at `NPC_WANDER.MAX_SPEED`,
  pauses on arrival, ping-pong traversal.
- **Motor branch** in `WanderMotor` selected by an **explicit `policy` discriminant**.
- **Tested opt-in wiring seam** in `Engine`: the plumbing to assign a patrol route to an
  NPC exists and is tested, but is **not** auto-applied to arbitrary NPCs in real rooms.

## 5. Explicit non-goals

- No LLM / provider / prompt behavior changes.
- No `WorldEvent` / `WorldCommand`.
- No persistence / schema / save-game / `RoomSpec` changes (this is *why* authored routes
  are v1). No `schemaVersion` bump.
- No memory / fact / `fact_visibility` writes.
- No NPC awareness / chase / aggro / combat / damage / encounter triggering.
- No cross-room movement.
- No complex pathfinding / dynamic re-planning.
- No authored/predefined patrol metadata (deferred to v1).
- No blanket patrol assignment to real NPCs.

## 6. Route source decision: generated deterministic runtime route only

v0 route waypoints are **generated deterministically at runtime** from the NPC's
authoritative RoomSpec `home` and the existing validated `NpcWanderField`. No LLM, no
schema, no persistence, no authored data. Generation is seeded (`stableHash01` over a
stable `roomId:npcId` key) so the same room + NPC always yields the identical route.

## 7. Authored/predefined metadata deferred to v1

Attaching authored waypoints (or route roles/schedules) to an NPC would require a
RoomSpec/schema/save-game field and its own maintainer approval. That is **deferred to a
future `npc-patrol-route-authored-v1`**. v0 deliberately ships the generation + validation
+ stepping + motor branch + opt-in seam so v1 only has to supply a trusted authored source
into the already-reviewed contract.

## 8. Eligibility rule: no blanket auto-assignment; opt-in fixture/test seam only

- **Real rooms:** every NPC continues on the **existing wander/idle path**. No NPC is
  auto-promoted to patrol from geometry alone. (Note: `registerWanderNpcs` today registers
  *all* NPCs for wander; patrol must not silently convert that population.)
- **Opt-in only:** an NPC patrols in v0 **only** when explicitly opted in through a **safe
  internal fixture/test seam** — an internal, presentation/runtime-only flag used by tests
  and controlled fixtures to exercise the patrol path. It carries no authored data into
  RoomSpec/save-game.
- **Deferred:** real gameplay assignment of patrol routes waits until trusted NPC
  role/route metadata exists (v1), gated by the schema/save-game approval that metadata
  requires.

Net effect: v0 lands the full patrol engine + a *tested* wiring seam while real gameplay
behavior stays unchanged (wander/idle), removing the "villagers/merchants patrol like
guards" risk.

## 9. Patrol route data shape

Pure, renderer-agnostic domain types (mirroring `WanderXZ`):

```
PatrolWaypoint = WanderXZ                       // Readonly<{ x: number; z: number }>
PatrolRoute = Readonly<{
  npcId: string
  waypoints: readonly PatrolWaypoint[]          // ordered, >= 2, all validated
  mode: 'ping-pong'                             // v0 fixed; 'loop' deferred
}>
```

`buildNpcPatrolRoute` seeds candidate points around `home` within
`NPC_WANDER.MAX_RADIUS_FROM_HOME`, keeps points passing position + segment validation, and
returns `null` when fewer than 2 valid waypoints survive. Ping-pong traversal avoids
needing a validated closing segment back to the first point.

## 10. Route validation rules (fail closed)

A route is valid **iff**:

1. `waypoints.length >= 2`.
2. Every waypoint satisfies `isWanderPositionAllowed(field, wp)` (inside playable bounds,
   within home radius, clear of every exclusion disc — spawn, exits, interactables,
   other-NPC homes, footprints).
3. Every consecutive segment satisfies `isWanderSegmentAllowed(field, a, b)` (sampled at
   `SEGMENT_SAMPLE_SPACING`).
4. All coordinates are finite (guard as `updateWanderStep` guards `dtS`).

Otherwise `buildNpcPatrolRoute` returns `null` → the NPC uses wander, then idle. No route
is ever partially trusted.

## 11. Movement algorithm

Pure reducer `updatePatrolStep({ state, route, field, dtS })`, structurally parallel to
`updateWanderStep`:

- Patrol state: `{ mode: 'moving' | 'pausing', position, targetIndex, direction: +1 | -1,
  pauseRemainingS }`.
- Guard `dtS` (finite, `>= 0`).
- Re-check `isWanderPositionAllowed(field, position)` each tick; if the current position
  ever fails, pause safely **in place** — never step into an invalid cell.
- `moving`: step toward `waypoints[targetIndex]` by `MAX_SPEED * dtS`, re-validating the
  incremental position and its segment (`isWanderSegmentAllowed`); on arrival → `pausing`
  with `wanderPauseSeconds`.
- `pausing`: decrement the timer; when it elapses, advance `targetIndex` by `direction`,
  reversing `direction` at either end (ping-pong).
- Deterministic: no `Math.random`; all timing derives from the existing seeded
  `stableHash*` helpers.

## 12. WanderMotor integration with explicit policy discriminant

- `WanderMotor` entries gain an **explicit discriminant**:
  ```
  policy: 'wander' | 'patrol'
  ```
  with a matching per-policy state field (a wander state *or* a patrol state, plus the
  route for patrol). `update()` branches on `entry.policy` — **patrol is never inferred
  from "route present."**
- The pause path (`shouldPauseWander`) and `syncXZ` (node + ring + interactable) are
  **shared unchanged**. `isWalking` stays `mode === 'moving'`.
- Entries default to `policy: 'wander'`; only the opt-in seam registers `policy: 'patrol'`.
- **Filename unchanged in v0.** Keep `WanderMotor.ts`; the ADR records that the class now
  owns wander + patrol and that a rename to `NpcMovementMotor` is deferred cleanup.

## 13. Runtime/renderer seam

- `WanderMotor.register` accepts an optional patrol route and sets `policy` accordingly.
- `Engine.registerWanderNpcs` gains the **wiring seam** to build/attach a patrol route,
  but in real rooms only does so for NPCs flagged via the safe internal fixture/test seam
  (§8). Everything else registers as `wander` exactly as today.
- No new engine lifecycle, no new React seam, no persistence, no per-frame logging.

## 14. Safety/authority model

- **Presentation/runtime-only.** Patrol writes exclusively via `syncXZ`
  (Three.js `node` / `ring` / `interactable`). `buildNpcPatrolRoute` reads `room.objects`
  (home) **read-only** and never writes it.
- **No authoritative surface.** No `WorldState`, `WorldEvent`, `WorldCommand`, event log,
  SQLite, memory, fact, `fact_visibility`, save-game, or `RoomSpec` mutation. No
  `schemaVersion` bump.
- **Fail closed.** Any validation gap → `null` route → wander/idle fallback. An NPC can
  never patrol into an exit, spawn, interactable, other-NPC home, footprint, or out of
  bounds.
- **Composition:**
  `patrol opt-in + valid route => patrol`;
  `otherwise => existing wander`;
  `no valid wander => idle`;
  `dialogue/interaction lock => pause movement`.

## 15. Logging/debug safety

- Logger abstraction only, **safe values only**: `roomId`, `npcId`,
  `patrolWaypointCount`, `patrolRouteBuilt: boolean`, `fellBackToWander: boolean`.
- **No** per-frame logging (parity with wander, which logs none per frame).
- **No** coordinates-as-narrative, NPC/room/object names, dialogue, prompts, provider
  bodies, memory text, or PII.

## 16. Test plan

**`domain/npcPatrolContract.test.ts` (Slice 1):**

- `buildNpcPatrolRoute` returns `>= 2` validated waypoints in a clear room.
- Returns `null` when the room cannot fit 2 valid points (fail-closed).
- Every returned waypoint passes `isWanderPositionAllowed`; every segment passes
  `isWanderSegmentAllowed`.
- Waypoints avoid exit / spawn / interactable / other-NPC-home discs.
- **Determinism:** same room + seed → identical route.

**`renderer/engine/npc/patrolStep.test.ts` (Slice 2):**

- Advances toward the waypoint at `MAX_SPEED`; arrives → pauses.
- Ping-pong reverses `direction` at both ends.
- `dtS` guard (non-finite / negative treated as 0).
- Re-validates and pauses in place if the current position becomes invalid.

**`renderer/engine/npc/WanderMotor.test.ts` (extend, Slice 2):**

- `policy: 'patrol'` entry patrols deterministically; `policy: 'wander'` entry still
  wanders (composition, not replacement).
- `syncXZ` writes `ring` and `interactable` during patrol.
- **Patrol pause no-drift:** when `interactionLocked` or `npcTalking` is true, successive
  ticks re-sync the *same* position (no drift).

**`renderer/engine/Engine.test.ts` (extend, Slice 3):**

- **Eligibility rule:** ineligible (normal) NPCs do **not** receive a patrol route and
  remain on the existing wander/idle path; only the fixture/test-seam-opted NPC patrols.
- **No authoritative mutation:** deep-clone `room.objects` before running N patrol ticks
  and assert it is **unchanged** after (a real assertion, not a claim).

## 17. Implementation slices

1. **Slice 1 — Pure patrol route model + validation helpers + tests.**
   `domain/npcPatrolContract.ts` (`PatrolRoute`, `buildNpcPatrolRoute`, validation)
   reusing `NpcWanderField` predicates. Tests: `npcPatrolContract.test.ts`. No
   renderer/engine changes.
2. **Slice 2 — Patrol step reducer + `WanderMotor` policy branch + tests.**
   `renderer/engine/npc/patrolStep.ts` (`updatePatrolStep`) + the `policy` discriminant
   branch. Tests: `patrolStep.test.ts`, extend `WanderMotor.test.ts` (incl. pause
   no-drift, ring/interactable sync).
3. **Slice 3 — Engine tested opt-in seam only + tests.**
   `Engine.registerWanderNpcs` gains the patrol-assignment seam gated by the safe internal
   fixture/test seam; real NPCs stay on wander/idle. Tests: extend `Engine.test.ts`
   (eligibility, `room.objects` no-mutation deep-equal).
4. **Slice 4 — Docs closeout after implementation.**
   Flip this plan and ADR-0080 to Implemented, add the ARCHITECTURE.md status line at
   implementation time only (implemented-only convention). No code.

Each slice is independently reviewable and keeps the build green.

## 18. Risk analysis

| Risk | Mitigation |
| --- | --- |
| Patrol steps into an unsafe cell | Reuse `isWanderPositionAllowed` / `isWanderSegmentAllowed`; fail closed to `null`/pause. |
| Non-determinism / flaky tests | Seeded `stableHash*`; deterministic `loadRoomSpec` fixtures. |
| All NPCs patrol like guards | Eligibility rule (§8): no blanket assignment; opt-in seam only. |
| Overselling authored behavior | Reframed as "generated deterministic foundation"; authored → v1. |
| Policy branch ambiguity | Explicit `policy` discriminant; never inferred from route presence. |
| Moving-NPC overlap | Documented as wander-parity known limitation (§19); not fixed in v0. |
| Motor name drift | `WanderMotor` retained; rename to `NpcMovementMotor` deferred, noted in ADR. |
| Silent authoritative mutation | Deep-equal `room.objects` no-mutation test (§16). |

## 19. Known limitation (documented, not fixed)

Exclusion discs cover other NPCs' **home** positions, not their **live moving** positions,
so a patrolling NPC can overlap a *moving* NPC's current cell. This is **exact wander
parity** (existing behavior) and is recorded, not treated as a patrol regression.

## 20. Open questions

1. Waypoint count / spacing target for generated routes (e.g., 2–4 points) — fix a
   constant in Slice 1 or tune?
2. Shape of the safe internal fixture/test seam for opt-in (internal runtime flag vs.
   test-only registration argument) — confirm the least-surface option in Slice 3.
3. `ping-pong` only for v0, `loop` deferred — confirm acceptable.

## 21. Final recommendation

Proceed to implement Slice 1 first: a **generated deterministic, in-room, presentation-only
patrol foundation** built on the existing validated `NpcWanderField`, predicates, and
motor/sync plumbing — with patrol as an **explicit `policy` branch** that composes with
(never replaces) wander, and **no blanket assignment** (patrol exercised only through a
safe internal fixture/test seam). This is the Minimum Safe Change: new pure model + reducer,
one discriminated motor branch, one gated wiring seam, plus tests — no schema, no
authoritative mutation, build stays green. Authored route metadata and real gameplay
assignment are deferred to v1.

### Minimum Safe Change Check

- **Reused:** `NpcWanderField`, `isWanderPositionAllowed`, `isWanderSegmentAllowed`,
  `NPC_WANDER`, `wanderPauseSeconds`, `distanceXZ`, `WanderMotor` + `syncXZ`,
  `shouldPauseWander`, `loadRoomSpec` fixtures, and the existing movement test suites.
- **Minimum new code:** `npcPatrolContract.ts` (model + validation), `patrolStep.ts`
  (reducer), one `policy`-discriminated branch in `WanderMotor`, one gated opt-in seam in
  `Engine`, plus tests.
- **Safety boundaries unchanged:** no `WorldState` / `WorldEvent` / `WorldCommand` /
  `applyEvent`; no persistence / migration / `schemaVersion`; no `RoomSpec` mutation; no
  memory / fact / `fact_visibility`; no provider / prompt / UI; presentation/runtime-only.
- **Tests prove it:** §16, anchored by the eligibility test and the `room.objects`
  no-mutation deep-equal assertion.
