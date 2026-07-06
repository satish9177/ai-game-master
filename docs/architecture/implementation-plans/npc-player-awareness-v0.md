# Implementation Plan — `feature/npc-player-awareness-v0`

> Status: **DESIGN APPROVED / DOCS-FIRST / NOT IMPLEMENTED.**
> This plan lands the design for a deterministic, ephemeral, same-room NPC→player
> proximity signal built on the existing presentation-only movement stack. No code,
> tests, or runtime behavior exist yet.
> See [ADR-0083](../decisions/ADR-0083-npc-player-awareness-v0.md).
>
> Companion docs: [ARCHITECTURE](../ARCHITECTURE.md) · [BOUNDARIES](../BOUNDARIES.md) ·
> [FAILURE-MODES](../FAILURE-MODES.md) · [CONVENTIONS](../CONVENTIONS.md) · [/AGENTS.md](../../../AGENTS.md).
> Follows the "land a dry/tested foundation before wiring behavior" pattern used by
> [`npc-patrol-route-v0`](./npc-patrol-route-v0.md)
> ([ADR-0080](../decisions/ADR-0080-npc-patrol-route-v0.md)),
> [`relationship-valence-reducer-v0`](./relationship-valence-reducer-v0.md)
> ([ADR-0077](../decisions/ADR-0077-relationship-valence-reducer-v0.md)), and
> [`lazy-room-environment-transitions-v0`](./lazy-room-environment-transitions-v0.md)
> ([ADR-0078](../decisions/ADR-0078-room-environment-transition-model-dry-v0.md)).

---

## 0. Approval status and locked invariants (read first)

The design is **approved as a deterministic, ephemeral, same-room NPC→player proximity
signal**. These invariants may not be relaxed without explicit maintainer approval:

- **Proximity-only tiers.** The four buckets — `unaware` / `nearby` / `aware` / `alerted` —
  are **pure distance tiers**. `alerted` does **not** mean chase, attack, aggro, alarm,
  event, encounter trigger, relationship change, or any behavior. It is the closest
  proximity band, nothing more.
- **Deterministic same-room distance only.** Awareness is a pure function of two same-room
  XZ positions and fixed radii. No randomness, no time, no history.
- **Constants-only radii in v0.** No per-NPC profile/radius metadata, no NPC
  type/hostility/relationship/time-of-day/facing/line-of-sight modifier.
- **Ephemeral/runtime-only.** Awareness lives in an in-memory tracker mirroring
  `NpcBehaviorTracker`. It never touches `WorldState`, `WorldEvent`, `WorldCommand`, the
  event log, SQLite, memory, facts, `fact_visibility`, save-game, or `RoomSpec`. No
  `schemaVersion` bump.
- **Advisory / no consumer.** The awareness signal is read-only advisory output. In v0
  **nothing consumes it** to affect movement, dialogue, relationships, or any other system.
  Chase-lite (a future feature) adds the first consumer.
- **Same-room only.** Awareness is evaluated only against NPCs in the room the Engine
  currently holds. No cross-room awareness.
- **No UI/debug indicator in v0.** No visible player-facing awareness marker (Slice 3 is
  deferred).
- **Fail closed.** Missing/non-finite positions or a different-room flag yield `unaware`.

---

## 1. Title and status

- **Feature:** `npc-player-awareness-v0` — Deterministic Ephemeral Same-Room NPC→Player
  Proximity Awareness.
- **Lane:** worked on `main` directly; no feature branch.
- **Status:** DESIGN APPROVED / DOCS-FIRST / NOT IMPLEMENTED.
- **ADR:** [ADR-0083](../decisions/ADR-0083-npc-player-awareness-v0.md).

## 2. Problem statement

NPCs move (idle / wander / patrol) with **no notion of where the player is**. We want a
deterministic, presentation-only, same-room, distance-based signal describing how close
each NPC is to the player, bucketed into closed proximity tiers, as a foundation a later
`hostile-npc-chase-lite-v0` can build on.

Naming honesty: the tiers — including `alerted` — are **proximity levels with no behavioral
meaning** in v0. Calling the closest band `alerted` must not imply an alarm, chase, or any
reaction. v0 produces a **read-only advisory signal only**; it does not chase, attack,
damage, trigger encounters, change relationships, alter dialogue, or write memory. It lands
the pure detector, an ephemeral tracker, and a per-frame read seam — and stops there.

## 3. Current architecture/code recap

The movement/presentation stack we build on is already deterministic and
presentation-only (verified by inspection):

- **Player position** — `Engine.player` is a `THREE.Object3D`
  (`apps/web/src/renderer/engine/Engine.ts`); its `.position` (x, 0, z) is driven by
  `MovementControls.update` and is **already read for same-room proximity** in
  `updateProximity()` (nearest in-range interactable → HUD). This is the correct,
  precedented player-position source; there is no global/omniscient player registry.
- **Live NPC positions** — moving NPCs' Three.js `node.position` refs are written each
  frame by `WanderMotor.syncXZ` (node + optional ring + runtime interactable). The motor
  exposes only `isWalking(npcId)` today; it has **no public per-NPC position accessor**.
- **NPC node identity** — `Engine.setRoom` already filters NPC nodes
  (`userData.objectType === 'npc'`, keyed by `userData.objectId`) in `registerIdleNpcs` /
  `registerWanderNpcs`. Both moving and fully-static NPCs are top-level tagged nodes.
- **Per-frame same-room read precedent** — `Engine.updateProximity()` runs every frame,
  computes XZ distance from the player to each candidate, picks the nearest within a
  radius, and **notifies the UI only when the result changes**. Awareness is the mirror
  image (proximity of NPCs *to* the player) and belongs in the same `renderLoop` seam.
- **Ephemeral per-NPC runtime state precedent** — `NpcBehaviorTracker`
  (`apps/web/src/renderer/engine/npc/behaviorTracker.ts`) is a small in-memory holder of
  `idle` / `talking` / `wandering`, unit-tested in isolation, and **cleared in `setRoom()`
  and `dispose()`**. An awareness tracker is its sibling.
- **Pure renderer-agnostic contract precedent** — `apps/web/src/domain/npcMovementContract.ts`
  holds plain-value types (`WanderXZ`), a `NPC_WANDER` const block, and pure predicates
  (`distanceXZ`, etc.) with no `THREE` dependency. The awareness detector mirrors this.

**Conclusion:** awareness is a *new pure read over the same same-room positions and the same
ephemeral-tracker pattern* — not a new authority surface and not a movement change.

## 4. Proposed v0 scope

- **Pure detector** (`domain/npcAwarenessContract.ts`): a deterministic function that maps
  one NPC position + the player position + a `sameRoom` flag + fixed radii constants to a
  proximity tier. Renderer-agnostic (plain `{ x, z }`, no `THREE`).
- **Ephemeral tracker** (`renderer/engine/npc/npcAwarenessTracker.ts`): an in-memory
  per-NPC level holder mirroring `NpcBehaviorTracker`, with change detection and `clear()`.
- **Engine wiring**: retain an `npcId → THREE.Object3D` map at `setRoom` covering **all**
  same-room NPC nodes (moving *and* static); a per-frame `updateAwareness()` in `renderLoop`
  that adapts node/player positions to `{ x, z }`, calls the detector, and feeds the tracker;
  an emit-on-change callback; and `clear()` on room change and dispose.

## 5. Explicit non-goals

- No chase, combat, damage, NPC attack, aggro, or encounter triggering.
- No relationship-driven hostility; no relationship read or write.
- No LLM / provider / prompt behavior change; no awareness decided by a model.
- No `WorldState` mutation; no `WorldEvent` / `WorldCommand`.
- No persistence / schema / save-game / `RoomSpec` change; no `schemaVersion` bump.
- No memory / fact / `fact_visibility` read or write.
- No raw prompt / provider / dialogue / room-text logging; no per-frame logging.
- No cross-room awareness.
- No movement override; the detector output drives nothing in v0.
- No dialogue or relationship consumer of awareness.
- No optional NPC profile/radius metadata; no NPC type / hostility / time-of-day / facing /
  line-of-sight modifier.
- No UI / debug indicator (Slice 3 deferred).

## 6. Awareness data shape

Pure, renderer-agnostic domain types (parallel to `WanderXZ` / `NPC_WANDER`):

```
NPC_AWARENESS = {                    // constants-only; strictly ordered radii (meters, XZ)
  ALERTED_RADIUS: 1.5,
  AWARE_RADIUS:   3.0,
  NEARBY_RADIUS:  5.0,
} as const

AwarenessXZ = Readonly<{ x: number; z: number }>

AwarenessLevel  = 'unaware' | 'nearby' | 'aware' | 'alerted'
AwarenessReason = 'proximity' | 'different-room' | 'missing-position'

NpcAwareness = Readonly<{
  npcId: string
  level: AwarenessLevel
  distance: number | null            // finite XZ distance, or null when guarded to unaware
  reason: AwarenessReason
}>
```

Radii are asserted strictly ordered (`ALERTED_RADIUS < AWARE_RADIUS < NEARBY_RADIUS`) so the
tier selection is unambiguous.

## 7. Detection rules (inclusive thresholds, tightest tier wins, fail closed)

Detector input: `{ npcId, npcPosition, playerPosition, sameRoom }` (radii from the constants
block). Output: `NpcAwareness`.

1. `sameRoom === false` → `{ level: 'unaware', distance: null, reason: 'different-room' }`.
2. Any non-finite coordinate in either position → `{ level: 'unaware', distance: null,
   reason: 'missing-position' }`.
3. Otherwise compute `d = distanceXZ(npcPosition, playerPosition)` and select the **tightest**
   tier using **inclusive** thresholds:
   - `d <= 1.5` → `alerted`
   - else `d <= 3.0` → `aware`
   - else `d <= 5.0` → `nearby`
   - else → `unaware`
   with `distance: d`, `reason: 'proximity'` in every branch (including `unaware` by range).

Boundary semantics are inclusive (`<=`) and are an explicit, tested contract. Determinism:
same inputs → same output; no `Math.random`, no clock, no history.

## 8. Authority/ephemeral model

Identical ephemeral-runtime pattern to `NpcBehaviorTracker`:

- The tracker holds an in-memory `Map<string, AwarenessLevel>` (last known tier per NPC).
- It reads player/NPC positions **read-only** and writes nothing but its own map plus an
  on-change callback.
- **No authoritative surface.** No `WorldState`, `WorldEvent`, `WorldCommand`, event log,
  SQLite, memory, fact, `fact_visibility`, save-game, or `RoomSpec`. No `schemaVersion` bump.
- **Fail closed.** Guard branches (§7) yield `unaware`; an NPC never lands in a spurious tier.
- **Advisory only.** Nothing in v0 reads the tracker to change movement, dialogue,
  relationships, or any other system. This is the proven safe ephemeral pattern already used
  in the renderer.

## 9. Runtime/renderer integration seams

- **`Engine.setRoom`** — build/retain `npcNodes: Map<string, THREE.Object3D>` from the NPC
  nodes already filtered (all same-room NPCs, moving and static), and call
  `awarenessTracker.clear()` right beside the existing `this.npcBehavior.clear()` /
  `this.wanderMotor.clear()`.
- **`Engine.renderLoop`** — add `updateAwareness()` after `updateNpcWander(dt)`, alongside
  `updateProximity()`. It adapts `player.position` and each `node.position` to `{ x, z }`,
  calls the pure detector per NPC (with `sameRoom: true`, since the map only holds
  current-room nodes), and feeds the tracker.
- **Emit-on-change** — an optional `onNpcAwarenessChange?(changes)` callback fires **only**
  when an NPC's tier transitions (parity with `updateProximity`'s notify-on-change). No
  consumer is wired in v0.
- **`Engine.dispose`** — `awarenessTracker.clear()`, drop the node map, null the callback.

No new engine lifecycle, no new React seam, no persistence, no per-frame logging.

## 10. Logging/debug safety

- **No per-frame logging** (wander/patrol parity — the movement stack logs none per frame).
- If any log is added at all, use the logger abstraction with **safe values only**:
  `roomId`, `npcId`, `level`, or aggregate tier counts.
- **Never** log coordinates, distances-as-narrative, NPC/room/object names, dialogue,
  prompts, provider bodies, memory text, or PII. **Never** frame `alerted` as an alarm event
  in logs.
- No UI/debug indicator surface in v0 (Slice 3 deferred).

## 11. Test plan

**`domain/npcAwarenessContract.test.ts` (Slice 1):**

- Each tier selected at an interior distance (`alerted` / `aware` / `nearby` / `unaware`).
- **Exact-boundary** distances (`1.5`, `3.0`, `5.0`) resolve inclusively to the tighter tier.
- Monotonic tightest-tier selection: shrinking distance only ever moves to an equal-or-tighter
  tier.
- `sameRoom === false` → `unaware` / `null` / `different-room`.
- Non-finite coordinate in either position → `unaware` / `null` / `missing-position`.
- Determinism: identical inputs → identical output.
- Radii-order assertion (`ALERTED_RADIUS < AWARE_RADIUS < NEARBY_RADIUS`).

**`renderer/engine/npc/npcAwarenessTracker.test.ts` (Slice 2):**

- Stores the computed level per NPC.
- Transition detection: change callback fires only on tier change, not on same-tier ticks.
- `clear()` empties all state.

**`renderer/engine/Engine.test.ts` (extend, Slice 2):**

- Awareness tier rises as the player approaches an NPC; both **moving and static** NPCs are
  evaluated (all same-room nodes).
- Awareness resets on `setRoom` (no cross-room bleed).
- **No authoritative mutation:** deep-clone `room.objects` before running N awareness frames
  and assert it is **unchanged** afterward (real assertion, patrol precedent).
- **No behavioral side effect:** movement/dialogue/relationship state is untouched by
  awareness computation (advisory-only).

## 12. Implementation slices

1. **Slice 1 — Pure awareness model/detection helpers + tests.**
   `domain/npcAwarenessContract.ts` (`NPC_AWARENESS`, `AwarenessLevel`, `AwarenessReason`,
   `NpcAwareness`, the detector), reusing `distanceXZ`. Tests:
   `npcAwarenessContract.test.ts`. No renderer/engine changes.
2. **Slice 2 — Runtime/renderer ephemeral tracker + Engine wiring + tests.**
   `renderer/engine/npc/npcAwarenessTracker.ts` (mirrors `NpcBehaviorTracker`) + the
   `npcId → node` map, `updateAwareness()` seam, emit-on-change callback, and `clear()` on
   room change/dispose in `Engine`. Tests: `npcAwarenessTracker.test.ts`, extend
   `Engine.test.ts` (moving+static coverage, reset, `room.objects` no-mutation, no
   behavioral side effect).
3. **Slice 3 — UI/debug indicator: DEFERRED / SKIPPED.**
   No visible player-facing awareness marker in v0. The existing debug-view pattern
   (`domain/memory/roomMemoryDebugView.ts`, `app/debugConfig.ts`) remains available if a
   later feature wants one, gated by its own approval.
4. **Slice 4 — Docs closeout only.**
   Flip this plan and ADR-0083 to Implemented, add the ARCHITECTURE.md status line at
   implementation time only (implemented-only convention). No code.

Each slice is independently reviewable and keeps the build green.

## 13. Risk analysis

| Risk | Mitigation |
| --- | --- |
| `alerted` overclaims (reads as alarm/behavior) | Documented as a proximity-only tier (§0, §2); never logged as an alarm; no consumer in v0. |
| Accidental chase/behavior coupling | Awareness is advisory; **no** system reads the tracker in v0. Chase-lite adds the first consumer later, in its own ADR. |
| Omniscience / cross-room bleed | Node map holds only current-room nodes; `sameRoom` guard is a tested contract; `clear()` on `setRoom`. |
| Bad player-position source | Reuse `Engine.player.position` (same source as `updateProximity`); no global registry. |
| Renderer coupling in the model | Detector is pure `{ x, z }` in `domain/`; only the tracker/Engine touch `THREE` nodes. |
| Per-frame perf | O(#NPCs) per frame, same class as `updateProximity`; emit-on-change avoids callback churn; no throttle needed for room-scale N. |
| Boundary/tie ambiguity | Inclusive `<=` semantics documented and boundary-tested at 1.5 / 3.0 / 5.0. |
| Silent authoritative mutation | Deep-equal `room.objects` no-mutation test (§11). |
| Static NPCs missed | Node map covers all tagged NPC nodes, not just `WanderMotor` entries (locked decision). |

## 14. Open questions

1. Emit-on-change callback payload shape (per-NPC delta list vs. full snapshot) — settle in
   Slice 2 at the least-surface option; no external consumer depends on it in v0.
2. Whether the Engine needs any read-only awareness getter for integration assertions, or
   whether unit-testing the tracker directly (per `behaviorTracker.test.ts`) suffices —
   default to no getter; add a minimal `get`-only accessor mirroring `get activeInteraction()`
   only if a test truly requires it.
3. Confirm `updateAwareness()` ordering relative to `updateProximity()` within `renderLoop`
   (either order is correct since both are pure reads; fix one for determinism in Slice 2).

## 15. Final recommendation

Proceed to **Slice 1**: a pure, deterministic, same-room distance detector in `domain/` with
a constants-only radii block and inclusive-threshold tier selection, mirroring
`npcMovementContract` conventions, fully unit-tested (tiers, exact boundaries, guards,
determinism). Then **Slice 2**: an ephemeral `NpcAwarenessTracker` mirroring
`NpcBehaviorTracker` plus a per-frame `updateAwareness()` read seam over an Engine-level
`npcId → node` map covering all same-room NPCs, with emit-on-change and reset-on-room-change.
This is the Minimum Safe Change: new pure model + tests, then one ephemeral tracker and one
gated per-frame read seam — no schema, no authority, no behavior, build stays green.
Chase/behavior consumption, hostility metadata, LOS, and time-of-day are deferred to their
own approved features.

### Minimum Safe Change Check

- **Reused:** `distanceXZ`, `WanderXZ`-style value types, the `NPC_WANDER`-style const-block
  convention, the `Engine.updateProximity` per-frame same-room read pattern, the
  `NpcBehaviorTracker` ephemeral/`clear()` pattern, the existing NPC-node filtering in
  `setRoom`, and `loadRoomSpec` fixtures.
- **Minimum new code:** `npcAwarenessContract.ts` (model + detector), `npcAwarenessTracker.ts`
  (ephemeral tracker), one `npcId → node` map + one `updateAwareness()` seam + one
  emit-on-change callback in `Engine`, plus tests.
- **Safety boundaries unchanged:** no `WorldState` / `WorldEvent` / `WorldCommand` /
  `applyEvent`; no persistence / migration / `schemaVersion`; no `RoomSpec` mutation; no
  memory / fact / `fact_visibility`; no provider / prompt / UI; no chase / combat / damage /
  encounter / relationship / dialogue effect; presentation/runtime-only, advisory-only.
- **Tests prove it:** §11, anchored by the boundary/guard/determinism detector tests, the
  moving+static Engine coverage, the `room.objects` no-mutation deep-equal assertion, and the
  no-behavioral-side-effect assertion.

## 16. Closeout (Slice 4) — pending

_Not implemented yet. This section is filled in at Slice 4 with the implemented file list,
the verification run, and a re-checked boundary confirmation, following the
[`npc-patrol-route-v0` closeout](./npc-patrol-route-v0.md#22-closeout-slice-4) format._
