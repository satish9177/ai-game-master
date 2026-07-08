# Implementation Plan — `feature/npc-day-night-routine-v0`

> Status: **DESIGN APPROVED — Slice 0 (this document + ADR) only. No code written yet.**
> This plan is written **docs-first**, ahead of implementation, per `AGENTS.md`
> ("Design first. Do not implement until the maintainer approves.") and the
> "land a dry/tested foundation before wiring behavior" pattern used by
> [`npc-patrol-route-v0`](./npc-patrol-route-v0.md) ([ADR-0080](../decisions/ADR-0080-npc-patrol-route-v0.md)).
> See [ADR-0087](../decisions/ADR-0087-npc-day-night-routine-v0.md).
>
> Companion docs: [ARCHITECTURE](../ARCHITECTURE.md) · [BOUNDARIES](../BOUNDARIES.md) ·
> [FAILURE-MODES](../FAILURE-MODES.md) · [CONVENTIONS](../CONVENTIONS.md) · [/AGENTS.md](../../../AGENTS.md).

---

## 0. Approval status and locked invariants (read first)

The design is **approved** with the following maintainer decisions locked in. These may
not be relaxed without explicit re-approval:

1. **Default-off env gate:** `VITE_AIGM_DEMO_ROUTINE`, mirroring `VITE_AIGM_DEMO_CHASE`
   ([ADR-0086](../decisions/ADR-0086-hostile-npc-chase-demo-opt-in-v0.md)). With the gate
   off, behavior is byte-identical to today.
2. **`rest` maps to stationary idle/hold behavior in v0.** No separate sleep/lie-down
   animation or state; `rest` and `idle` are behaviorally identical movement policies in
   v0 (distinct presentation is a future, separately approved slice).
3. **`passive` is movement/presentation-only in v0.** It must **not** block dialogue,
   imply unavailability, trigger hostility, or change any gameplay consequence. It maps to
   the existing gentle wander policy — no new semantics.
4. **Routine metadata comes only from a trusted static authored config, keyed by explicit
   NPC id.** No generated/derived fallback from NPC name, type, prompt text, room text,
   provider output, dialogue, relationship state, or journal state.
5. **Closed routine modes:** `idle | patrol | rest | passive`. No fifth mode without
   separate approval.
6. **Same-room only.** No cross-room movement, no background simulation, no timers, no
   `setInterval`/`setTimeout`, no LLM/provider control of routines.
7. **Movement-only.** No combat, damage, HP, death, capture, injury, encounters, item, or
   quest effects. No relationship-driven routine behavior in v0.
8. **No authoritative-state path.** No `WorldState` mutation, no `WorldEvent`, no
   `WorldCommand`, no memory write, no fact/`fact_visibility` derivation, no
   schema/save-game/persistence change, no `schemaVersion` bump.
9. **No raw content logging.** No raw prompt/provider/dialogue/room/generated text in any
   log line this feature adds.
10. **Existing chase/patrol/awareness safety tests must not be weakened.** They are reused
    unmodified; routine composes with them, never replaces or relaxes them.
11. **No global routine activation.** Real rooms keep every NPC on the existing
    wander/patrol/idle path unless the NPC id is both explicitly configured **and** present
    in the room **and** the demo gate is on. No blanket assignment.

---

## 1. Title and status

- **Feature:** `npc-day-night-routine-v0` — Deterministic Same-Room NPC Day/Night Routine
  Foundation.
- **Lane:** worked on `main` directly; no feature branch.
- **Status:** Slice 0 (docs-only) in progress. Slices 1–6 not started.
- **ADR:** [ADR-0087](../decisions/ADR-0087-npc-day-night-routine-v0.md).

## 2. Problem statement

NPCs currently move by wander, an opt-in generated patrol route, or opt-in home-leashed
chase. None of these vary by time of day. We want a **closed, deterministic, same-room
routine layer** that lets an explicitly configured NPC change its **movement policy**
(idle / patrol / rest / passive) based on the existing deterministic world-clock time
bucket — composing with, not replacing, the existing wander/patrol/chase stack, and never
auto-activating for NPCs that have no trusted authored schedule.

## 3. Existing foundations this builds on (read-only reuse)

| Foundation | File(s) | What it gives us |
| --- | --- | --- |
| World clock / time buckets | `apps/web/src/domain/world/worldClock.ts` | `TimeOfDay = 'dawn' \| 'day' \| 'dusk' \| 'night'`, `computeWorldClock(log)` (pure, event-log-derived, no wall clock), `toPromptTimeContext`. Time advances **only** on `moved-to-room` events — one hour per move — so within one engine mount (one loaded room) the time bucket is fixed. |
| Time context flow | `App.tsx` (`worldClock` state, `toPromptTimeContext(worldClock)` at the `RoomViewer` call site) | `timeContext` already reaches `RoomViewer` today (used for dialogue prompts); the routine feature reads the same `worldClock.timeOfDay`, it does not add a new time source. |
| Movement motor | `apps/web/src/renderer/engine/npc/WanderMotor.ts` | Per-NPC entries with an explicit `policy` discriminant (`'wander' \| 'patrol'` today); `update()` runs pause-check → chase-override → policy branch, `syncXZ` writes presentation-only Three.js refs. |
| Patrol | `apps/web/src/domain/npcPatrolContract.ts`, `apps/web/src/renderer/engine/npc/patrolStep.ts` | Deterministic generated route + ping-pong stepping reducer, fail-closed to `null` → wander. |
| Awareness | `apps/web/src/domain/npcPlayerAwareness.ts`, `apps/web/src/renderer/engine/npc/awarenessTracker.ts` | Proximity-only tiers (`unaware/nearby/aware/alerted`), advisory, ephemeral, same-room. |
| Chase | `apps/web/src/renderer/engine/npc/chaseStep.ts`, `WanderMotor.update` chase branch | Home-leashed, movement-only pursuit; activates only when `chaseEligible && isChaseActive(npcId)` (driven by awareness `aware`/`alerted`); runs **before** the policy branch in `update()`, so it already pre-empts any base policy. |
| Pause | `apps/web/src/domain/npcMovementContract.ts` (`shouldPauseWander`) | Already pauses movement on `interactionLocked \|\| npcTalking`, for every current and future policy. |
| Opt-in wiring precedent | `apps/web/src/app/demoChaseOptIn.ts`, its wiring in `App.tsx` (~L1380–1414) and `RoomViewer.tsx` (`SetRoomOptions`, effect deps) | The exact shape to mirror: pure selector = frozen allowlist ∩ present NPC ids, gated by a default-off env var, forwarded through `RoomViewer` into `Engine.SetRoomOptions` only when non-empty. |

**Key stability fact used by this design:** because the world clock only advances on a
room move (which remounts the engine via a fresh `RoomViewer` room-load effect), the
resolved time bucket is stable for the lifetime of one engine mount. Routine mode can
therefore be resolved **once at room entry**, exactly like `demoChaseOptInNpcIds`, with no
per-frame re-evaluation and no timer.

## 4. Explicit non-goals (v0)

- No LLM / provider / prompt behavior change.
- No `WorldEvent` / `WorldCommand` / `WorldState` mutation.
- No persistence / schema / save-game / `RoomSpec` change. No `schemaVersion` bump.
- No memory / fact / `fact_visibility` write.
- No combat / damage / HP / death / capture / injury / encounters / items / quests.
- No relationship-driven routine behavior.
- No cross-room movement, no background simulation loop, no timers/`setInterval`.
- No generated/derived routine metadata (NPC name/type/prompt/room text/provider
  output/dialogue/relationship/journal state are never inputs to routine selection).
- No blanket routine assignment — only explicitly configured, present, gate-enabled NPCs.
- No new visual/debug presentation (Slice 4 optional, likely skipped, needs separate
  approval).
- No weakening of existing chase/patrol/awareness tests or behavior.

## 5. Closed routine modes and semantics

```
NpcRoutineMode = 'idle' | 'patrol' | 'rest' | 'passive'
```

| Mode | v0 movement mapping | Notes |
| --- | --- | --- |
| `idle` | Stationary hold at home (new motor policy value) | No wander drift; distinct from `rest` only in name/intent, not behavior, in v0. |
| `patrol` | Existing generated deterministic patrol (`buildNpcPatrolRoute` + `patrolStep`) | Fails closed to `wander` if no valid route can be built — never to a broken/absent route. |
| `rest` | Stationary hold at home — **same mechanism as `idle`** (decision #2, §0) | Deferred: a distinct sleep/lie-down presentation is future work. |
| `passive` | Existing gentle wander | Decision #3 (§0): movement/presentation-only; never blocks dialogue, never implies unavailability, never triggers hostility, never changes gameplay consequences. |

## 6. Routine metadata source (decision #4, §0)

A **trusted static authored config, keyed by explicit NPC id**, living in the domain
layer as a frozen `Record`:

```ts
// domain/npcRoutineConfig.ts (Slice 1)
export type NpcRoutineSchedule = Partial<Record<TimeOfDay, NpcRoutineMode>>

export const NPC_ROUTINE_CONFIG: Readonly<Record<string, NpcRoutineSchedule>> =
  Object.freeze({
    // example only — final entries confirmed in Slice 1
    'herald-asha': { dawn: 'idle', day: 'patrol', dusk: 'passive', night: 'rest' },
  })
```

This map **is** the allowlist: only NPC ids present as keys can ever receive a routine.
It is never derived, discovered, inferred, or expanded at runtime from any content
source (name, type, prompt, room text, provider output, dialogue, relationship, journal).
A bucket absent from an NPC's schedule, or an NPC id absent from the map entirely,
degrades to existing (non-routine) behavior — never a runtime error, never a default
mode invented on the fly.

## 7. Movement priority / composition order

Priority is realized by **where each decision already sits** in `WanderMotor.update()` —
routine only supplies the *base* policy; everything listed above it in the existing loop
still pre-empts unchanged:

1. **Dialogue / interaction lock** (`shouldPauseWander`) — pauses movement for every
   policy, including the new `idle`/`rest` hold. Highest priority, unchanged.
2. **Chase override** — existing branch; activates only when `chaseEligible &&
   isChaseActive(npcId)` (driven by unchanged awareness `aware`/`alerted`). Runs before
   the policy branch, so it pre-empts a routine-selected base policy exactly as it
   pre-empts `patrol`/`wander` today. **Routine does not gain a chase override of its
   own** — it reuses the existing one verbatim.
3. **Routine base policy** (new, this feature) — resolved once at registration from
   `NPC_ROUTINE_CONFIG[npcId][timeOfDay]`, mapped to a motor policy:
   - `patrol` → motor `policy: 'patrol'` (fail-closed to `wander` if no valid route).
   - `passive` → motor `policy: 'wander'`.
   - `idle` / `rest` → motor `policy: 'idle'` (new).
4. **Existing wander fallback** — unchanged, used when the NPC has no configured/valid
   routine for the current bucket (or routine is disabled/absent).
5. **Missing/invalid time bucket, missing config, missing NPC id, invalid mode, or the
   demo gate off** — all degrade to (4), never to an error or a stall.

## 8. Eligibility rule — no blanket activation

- **Real rooms, gate off (default):** every NPC stays on the existing wander/patrol/idle
  path, byte-identical to today. This is the default; `VITE_AIGM_DEMO_ROUTINE` is unset in
  production builds exactly as `VITE_AIGM_DEMO_CHASE` is today.
- **Gate on:** an NPC gets a routine-selected policy **only** when its id is a key in
  `NPC_ROUTINE_CONFIG` **and** it is present in the current room **and** its schedule maps
  the current `timeOfDay` to a valid mode. All other NPCs in the same room are unaffected.
- **Composability with chase opt-in:** a routine-eligible NPC may independently also be
  chase-eligible (`chaseOptInNpcIds`) exactly as an ordinary/patrol NPC can be today; the
  two opt-in sets are unrelated and chase still wins per §7.

## 9. Proposed pure API (Slice 1 shape, non-binding on naming details)

```ts
// domain/npcRoutine.ts
export type NpcRoutineMode = 'idle' | 'patrol' | 'rest' | 'passive'
export type NpcRoutineSchedule = Partial<Record<TimeOfDay, NpcRoutineMode>>

export function selectRoutineMode(
  schedule: NpcRoutineSchedule,
  timeOfDay: TimeOfDay,
): NpcRoutineMode | null   // null on missing/invalid bucket — never throws

export function routineModeToMotorPolicy(
  mode: NpcRoutineMode,
): 'wander' | 'patrol' | 'idle'   // total, pure mapping table (§5)
```

```ts
// app/npcRoutine.ts (Slice 3), mirrors app/demoChaseOptIn.ts exactly
export function readRoutineEnabled(env = import.meta.env): boolean  // VITE_AIGM_DEMO_ROUTINE
export function selectNpcRoutineModes(args: {
  enabled: boolean
  presentNpcIds: ReadonlySet<string>
  timeOfDay: TimeOfDay | null
  config?: Readonly<Record<string, NpcRoutineSchedule>>  // defaults to NPC_ROUTINE_CONFIG
}): ReadonlyMap<string, NpcRoutineMode>   // empty when disabled, timeOfDay null, or no matches
```

## 10. Engine / motor integration shape (Slice 2, non-binding on internals)

- `WanderMotor`: add `'idle'` to the policy discriminant. Pause and chase branches in
  `update()` are unchanged; a new idle branch holds the entry's position (no drift),
  reusing the existing `resetEntryPosition`/`syncXZ` shape. `isWalking()` reports idle
  entries as not walking (unless a chase override is currently moving them).
- `Engine.SetRoomOptions`: add an internal-seam field, e.g. `npcRoutineModes?:
  ReadonlyMap<string, NpcRoutineMode>` — documented the same way as
  `patrolOptInNpcIds`/`chaseOptInNpcIds`: not RoomSpec/schema/save-game data, never
  auto-populated for real gameplay.
- `Engine.registerWanderNpcs`: for an NPC id present in the routine map, use
  `routineModeToMotorPolicy` to decide registration (building/validating a patrol route
  exactly as `patrolOptInNpcIds` does today, failing closed to wander); all other NPCs
  keep the current unmodified branch.

## 11. App / RoomViewer wiring shape (Slice 3, non-binding on internals)

Mirrors `demoChaseOptIn` end to end:

- `App.tsx`: a `useMemo` keyed on `[activePlay?.room, worldClock?.timeOfDay]` builds the
  resolved routine map from validated `room.objects` ids + the existing `worldClock` state
  + the new gate reader; forwarded to `RoomViewer` only when non-empty (same conditional
  spread pattern already used for `chaseOptInNpcIds`/`resolvedObjectIds`).
- `RoomViewer.tsx`: a new optional prop, added to `SetRoomOptions` when non-empty and to
  the room-load effect's dependency array, exactly like `chaseOptInNpcIds` today.
- No change to `timeContext`/dialogue wiring — routine reads the same `worldClock` value
  the dialogue prompt path already reads; it does not add a second time source.

## 12. Safety / authority model

- **Presentation/runtime-only.** Routine only selects a `WanderMotor` policy; it writes
  no authoritative state and reads `room.objects` (ids only) and the pure `worldClock`
  projection, both already-existing read paths.
- **Fail closed everywhere.** Disabled gate, absent config, absent NPC id, invalid/missing
  mode, invalid/missing time bucket, or an unbuildable patrol route all degrade to the
  existing wander/idle behavior — never a stall, never a thrown error surfaced to the
  player.
- **No new chase/awareness authority.** Chase and awareness are reused unmodified; routine
  never adds a second pre-emption path around them.
- **Dialogue never blocked by routine mode.** `rest`/`idle`/`passive` affect movement
  only; the existing dialogue lookup (built from `room.objects` independent of movement
  policy) and `shouldPauseWander` (which already pauses movement during dialogue) are
  unchanged.

## 13. Logging/debug safety

- If any diagnostic is added, it is logger-abstraction-only and safe-value-only (e.g.
  boolean/enum/count such as `routineModeResolved: boolean`), never NPC id/name, room
  name/text, prompt, provider body, or coordinates-as-narrative. No per-frame logging
  (parity with wander/patrol, which log nothing per frame).

## 14. Test plan (for Slices 1–3, written now, executed later)

**`domain/npcRoutine.test.ts` (Slice 1):**
- `selectRoutineMode` returns the configured mode for a matching bucket.
- Returns `null` for a bucket absent from the schedule (no throw).
- `routineModeToMotorPolicy` covers all four modes; `rest` and `idle` both map to
  `'idle'`; `patrol` maps to `'patrol'`; `passive` maps to `'wander'`.

**`domain/npcRoutineConfig.test.ts` (Slice 1):**
- `NPC_ROUTINE_CONFIG` is frozen (`Object.isFrozen`).
- Every configured mode value is one of the four closed modes (type-level plus a runtime
  guard test).

**`app/npcRoutine.test.ts` (Slice 3):**
- `readRoutineEnabled` defaults to `false`; recognizes `'1'`/`'true'` only.
- `selectNpcRoutineModes` returns empty when disabled, when `timeOfDay` is `null`, or when
  no configured id is present in the room.
- Returns only the intersection of configured ∩ present ids, with each id's resolved mode
  for the given `timeOfDay`.

**`renderer/engine/npc/WanderMotor.test.ts` (extend, Slice 2):**
- `policy: 'idle'` entry holds position across ticks (no drift).
- Idle entry pauses correctly under `interactionLocked`/`npcTalking` (parity with
  wander/patrol pause tests).
- Chase override still activates and moves an idle-policy entry when
  `chaseEligible && isChaseActive` (proves chase pre-empts routine, §7 item 2).
- `isWalking()` correctness for idle vs. chase-moving.

**`renderer/engine/Engine.test.ts` (extend, Slice 2/3):**
- An NPC in the routine map registers with the policy `routineModeToMotorPolicy` implies
  for the given bucket.
- Patrol-mapped NPC with an unbuildable route falls back to `wander` (fail-closed, same
  assertion style as the existing patrol eligibility test).
- NPCs **not** in the routine map are unaffected — byte-identical registration to today.
- `room.objects` deep-equal before/after N ticks (no authoritative mutation), extending
  the existing pattern from `npc-patrol-route-v0`.

**`RoomViewer.test.ts` / `App.test.tsx` (extend, Slice 3):**
- Gate off → no `npcRoutineModes` reaches `SetRoomOptions`.
- Gate on, no configured NPC present → empty map, no behavior change.
- Gate on, configured NPC present → forwarded map matches expected mode for the current
  `worldClock.timeOfDay`.

**Safety/eval tests (Slice 5):**
- A scan test proving the new modules import no `setInterval`/`setTimeout`, no
  `WorldEvent`/`WorldCommand`/`WorldState`-mutating helper, and no provider/network code —
  mirroring the "dry at runtime" / no-side-effect scan pattern used by
  `room-environment-transition-model-dry-v0` (ADR-0078) and
  `memory-poisoning-redteam-v0` (ADR-0072).
- Existing chase (`chaseStep.test.ts`, `WanderMotor.test.ts` chase cases), patrol
  (`npcPatrolContract.test.ts`, `patrolStep.test.ts`), and awareness
  (`npcPlayerAwareness.test.ts`, `awarenessTracker.test.ts`) suites re-run **unmodified**
  and must stay green, proving routine did not weaken them.

## 15. Implementation slices

1. **Slice 1 — Pure routine model + config + tests.** `domain/npcRoutine.ts`,
   `domain/npcRoutineConfig.ts`, and their tests. No renderer/engine/app changes.
2. **Slice 2 — Motor `idle` policy + Engine routine integration + tests.** Extend
   `WanderMotor.ts` (new policy branch) and `Engine.ts` (`registerWanderNpcs` routine
   branch, `SetRoomOptions.npcRoutineModes`), plus extended `WanderMotor.test.ts` /
   `Engine.test.ts`.
3. **Slice 3 — App/RoomViewer opt-in wiring + tests.** `app/npcRoutine.ts` selector,
   `App.tsx` memo + conditional prop spread, `RoomViewer.tsx` prop/`SetRoomOptions`/effect
   deps, plus their tests.
4. **Slice 4 — Optional visual/debug presentation.** Only if separately approved after
   Slice 3 lands; likely skipped, mirroring the ADR-0086 Slice 3 precedent where manual
   smoke testing showed the transition was already observable without one.
5. **Slice 5 — Safety/eval tests.** No-side-effect scan + regression run of existing
   chase/patrol/awareness suites to prove no weakening.
6. **Slice 6 — Docs/ADR closeout.** Flip this plan and ADR-0087 to Implemented, add the
   `ARCHITECTURE.md` implemented-status line (replacing the planned line added in Slice
   0), record verification results.

Each slice is independently reviewable and keeps the full suite green.

## 16. Risk analysis

| Risk | Mitigation |
| --- | --- |
| Routine silently activates for unconfigured NPCs | Config map **is** the allowlist; gate defaults off; Engine test proves unconfigured NPCs are byte-identical to today. |
| Routine weakens chase/patrol/awareness safety | Those modules and their tests are reused **unmodified**; routine only supplies a base policy below the existing chase branch. Regression run in Slice 5. |
| `passive` accidentally gates dialogue or implies unavailability | Explicitly scoped as movement/presentation-only (decision #3); dialogue lookup and `shouldPauseWander` are untouched; a dedicated test can assert dialogue availability is independent of routine mode if judged necessary in Slice 3. |
| Cross-room leakage | Routine only ever selects among existing in-room motor policies; positions stay gated by unchanged `isWanderPositionAllowed`/`isWanderSegmentAllowed`. |
| Non-determinism | Pure lookup keyed by the deterministic, event-log-derived `timeOfDay`; no `Date.now()`, no unseeded RNG. |
| Timers / background simulation | None added; the motor is driven only by the existing render-loop `update(dt)` call. Enforced by the Slice 5 scan test. |
| Mid-session drift from time-bucket changes | Time only advances via `moved-to-room` (→ new room load → engine remount), so the resolved bucket is stable for an engine mount's lifetime — same stability property `demoChaseOptInNpcIds` already relies on. |
| Persistence/schema creep | No RoomSpec/save-game/WorldState field; nothing persisted; no `schemaVersion` bump. |
| Logging leakage | Only safe enums/booleans/counts, if anything; no NPC/room names, prompts, or provider bodies. |

## 17. Open questions

1. Final `NPC_ROUTINE_CONFIG` entries (which NPC id(s), which mode per bucket) — confirm
   the concrete authored schedule in Slice 1; the example in §6 is illustrative only.
2. Whether Slice 3 needs an explicit "dialogue availability independent of routine mode"
   test, or whether existing dialogue-lookup tests already cover it by construction
   (dialogue lookup does not consult movement state at all) — resolve during Slice 3.
3. Whether the internal seam name is `npcRoutineModes` (a resolved `Map`) vs. two separate
   fields (`routineOptInNpcIds` + a schedule lookup) — the resolved-map shape is
   recommended (§9–§11) because it keeps time-bucket resolution in the composition root
   and the Engine mechanical, mirroring how `chaseOptInNpcIds` is already a resolved set
   rather than a raw config reference.

## 18. Final recommendation

Proceed to Slice 1: a **pure, deterministic, config-driven routine model** with a frozen,
id-keyed authored schedule and a total mapping to existing motor policies — no engine,
motor, App, or RoomViewer changes yet. This is the Minimum Safe Change for this slice:
new pure functions and a new frozen config object only, fully unit-testable in isolation,
with zero surface for the chase/patrol/awareness/dialogue/authoritative-state boundaries
to regress.

### Minimum Safe Change Check

- **Reused:** `worldClock.TimeOfDay`/`computeWorldClock` (unmodified), `WanderMotor`
  policy-discriminant pattern, `buildNpcPatrolRoute` fail-closed shape, the
  `demoChaseOptIn.ts` selector/gate pattern, the existing `timeContext`→`RoomViewer` flow,
  the `chaseOptInNpcIds` conditional-prop-spread wiring shape.
- **Minimum new code (across all slices):** one closed enum + one pure selector + one
  pure mapping function (`domain/npcRoutine.ts`), one frozen authored config
  (`domain/npcRoutineConfig.ts`), one composition selector + env gate (`app/npcRoutine.ts`),
  one new motor policy value (`'idle'`), one new `SetRoomOptions` field.
- **Safety boundaries unchanged:** renderer trust boundary, chase/patrol/awareness logic
  and their tests, `WorldState`/`WorldEvent`/`WorldCommand`/event-log authority, memory
  firewall, schema/save-game/persistence, provider/prompt path, logging redaction.
- **Tests prove it:** §14, anchored by the Engine no-mutation/unconfigured-NPC-unaffected
  tests, the idle-hold/chase-override motor tests, and the Slice 5 no-side-effect scan
  plus unmodified regression run of chase/patrol/awareness suites.

## 19. Slice 0 record (this update)

This document and [ADR-0087](../decisions/ADR-0087-npc-day-night-routine-v0.md) are the
entire Slice 0 deliverable. No `.ts`/`.tsx` source or test file was created or modified.
`docs/architecture/ARCHITECTURE.md` gained one planned-status bullet line (§ "Slice 0"
convention below) pointing at this plan and ADR-0087; it will be replaced with an
implemented-status line at Slice 6 closeout, per the `npc-patrol-route-v0` precedent.
