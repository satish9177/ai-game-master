# Implementation Plan — `feature/hostile-npc-chase-lite-v0`

> Status: **IMPLEMENTED.** Worked on `main` directly.
> This plan lands a deterministic, home-leashed, same-room chase **movement override** for
> opt-in "hostile" NPCs, built on the existing presentation/runtime-only movement stack and
> the advisory awareness signal. It is the first consumer of that signal.
> See [ADR-0084](../decisions/ADR-0084-hostile-npc-chase-lite-v0.md).
>
> Companion docs: [ARCHITECTURE](../ARCHITECTURE.md) · [BOUNDARIES](../BOUNDARIES.md) ·
> [FAILURE-MODES](../FAILURE-MODES.md) · [CONVENTIONS](../CONVENTIONS.md) · [/AGENTS.md](../../../AGENTS.md).
> Builds directly on
> [`npc-patrol-route-v0`](./npc-patrol-route-v0.md)
> ([ADR-0080](../decisions/ADR-0080-npc-patrol-route-v0.md)) and
> [`npc-player-awareness-v0`](./npc-player-awareness-v0.md)
> ([ADR-0083](../decisions/ADR-0083-npc-player-awareness-v0.md)).

---

## 0. Approval status and locked invariants (read first)

The design is **approved as a deterministic, home-leashed, same-room chase movement override,
opt-in via an internal Engine seam, with no gameplay authority.** These invariants may not be
relaxed without explicit maintainer approval:

- **Movement/intent only.** Chase changes only where an NPC node moves. **No** combat, damage,
  HP change, injury, item loss, capture, death, encounter, or quest effect. Contact with the
  player has **no** gameplay consequence.
- **Eligibility is an internal opt-in seam only.** `SetRoomOptions.chaseOptInNpcIds` (a
  `ReadonlySet<string>`) is the only way an NPC becomes chase-eligible. It is **not**
  `RoomSpec`/schema/save-game data and is **never** wired through `App`/`RoomViewer`. **No real
  room auto-enables chase in v0.**
- **Awareness-gated activation.** Chase is active for an eligible NPC **iff** its
  `NpcAwarenessTracker` tier is `aware` or `alerted`; `nearby`/`unaware` stops chase. The tier
  read is the prior frame's value — accepted, deterministic staleness.
- **Deterministic, no teleport.** Pursuit is a pure function of NPC position, player position,
  and `dt`; steps are capped at `NPC_WANDER.MAX_SPEED * dt` and every candidate is re-validated
  through the **existing, unchanged** `isWanderPositionAllowed` / `isWanderSegmentAllowed`
  (illegal → hold, never jump).
- **Home-leashed to `NPC_WANDER.MAX_RADIUS_FROM_HOME = 2.5`.** Chase never leaves the NPC's
  wander-legal area, keeping it in-bounds, obstacle-clear, and resume-compatible.
- **Contact standoff `CONTACT_STANDOFF = 0.8`.** The NPC stops advancing within `0.8 m` of the
  player. Standoff/contact has no gameplay effect.
- **Existing pause gates still pause chase.** `shouldPauseWander({ interactionLocked,
  npcTalking })` runs first; a dialogue/interaction lock or NPC "talking" pauses an active
  chase.
- **Non-opted NPCs remain behaviorally unchanged**, covered by regression tests (not claimed
  byte-for-byte-identical source).
- **No authoritative/persistence/provider surface.** No `WorldState`, `WorldEvent`,
  `WorldCommand`, event log, SQLite, memory, fact, `fact_visibility`, save-game, or `RoomSpec`
  change; no `schemaVersion` bump; no LLM/provider/prompt change; no `App`/`RoomViewer`/UI
  change.
- **Same-room only.** No cross-room chase.

---

## 1. Title and status

- **Feature:** `hostile-npc-chase-lite-v0` — Deterministic Home-Leashed Same-Room Hostile NPC
  Chase (movement/intent only, opt-in).
- **Lane:** worked on `main` directly; no feature branch.
- **Status:** IMPLEMENTED.
- **ADR:** [ADR-0084](../decisions/ADR-0084-hostile-npc-chase-lite-v0.md).

## 2. Problem statement

NPCs move (idle / wander / patrol) and an advisory same-room proximity signal
([ADR-0083](../decisions/ADR-0083-npc-player-awareness-v0.md)) reports how close each NPC is to
the player — but **nothing consumes that signal**, so no NPC ever reacts to the player's
position. We want the first, deliberately minimal reaction: an **eligible "hostile" NPC** that,
when it is `aware`/`alerted` and in the same room, **moves toward the player**, and resumes its
normal wander/patrol when the player leaves or the room is locked.

Scope honesty: this is a **movement/intent change only**. "Hostile" and "chase" must not imply
combat. v0 does not deal damage, change HP, injure, take items, capture, kill, trigger an
encounter, or apply a quest effect; reaching the player does nothing. There is no hostility
field in `RoomSpec`, and we add none — eligibility comes from an internal opt-in seam that no
real room enables. The feature lands a pure pursuit reducer, a chase capability on the existing
`WanderMotor`, and a gated per-frame call in `Engine` — and stops there.

## 3. Current architecture/code recap

The movement/awareness stack we build on is deterministic and presentation/runtime-only
(verified by inspection):

- **Pure movement kernel** — `apps/web/src/domain/npcMovementContract.ts` holds
  `NPC_WANDER` (incl. `MAX_SPEED = 0.8`, `MAX_RADIUS_FROM_HOME = 2.5`), `distanceXZ`, and the
  legality predicates `isWanderPositionAllowed` (inside playable bounds **and** within
  `MAX_RADIUS_FROM_HOME` of home **and** clear of every exclusion disc) and
  `isWanderSegmentAllowed` (samples the segment at `SEGMENT_SAMPLE_SPACING`). `shouldPauseWander`
  is the single pause gate. All pure, renderer-agnostic, no `THREE`.
- **Per-frame steppers** — `renderer/engine/npc/wanderStep.ts` and `patrolStep.ts` are pure
  `moving | pausing` reducers that advance `≤ MAX_SPEED * dt` toward a target and re-validate
  every candidate; illegal → `pauseSafely` (this is the existing "no teleport" guarantee).
- **`WanderMotor`** (`renderer/engine/npc/WanderMotor.ts`) — owns per-NPC `entries` with an
  explicit `policy: 'wander' | 'patrol'` discriminant, the scene `node` (+ optional `ring`,
  `interactable`), the `field`, a string `seed`, and the reducer `state`. `update(dtS, context)`
  checks `shouldPauseWander` first (pause + `syncXZ` + `continue`), else advances the policy's
  reducer and `syncXZ`es node XZ. `isWalking(npcId)` returns `state.mode === 'moving'`. The
  motor has **no knowledge of the player position** today.
- **Awareness signal** — `domain/npcPlayerAwareness.ts` (`detectNpcPlayerAwareness`, radii
  `ALERTED 1.5 / AWARE 3.0 / NEARBY 5.0`) and the ephemeral
  `renderer/engine/npc/awarenessTracker.ts` (`NpcAwarenessTracker.levelOf(npcId)`), updated per
  frame in `Engine.updateAwareness()` over an `npcId → THREE.Object3D` map covering **all**
  same-room NPC nodes. Advisory-only; **no consumer** (ADR-0083).
- **Engine wiring** — `Engine.renderLoop`: `movement.update` → `updateNpcWander(dt)` →
  `updateAwareness()` → idle → camera → `updateProximity()`. `updateNpcWander` calls
  `wanderMotor.update(dt, { interactionLocked: this.locked, isNpcTalking })`. The player is
  `this.player` (`THREE.Object3D`); its XZ is already read in `updateAwareness`/`updateProximity`.
- **Opt-in seam precedent** — `SetRoomOptions.patrolOptInNpcIds` (ADR-0080) is an internal,
  test/fixture-only `ReadonlySet<string>` consumed in `registerWanderNpcs`; it is never wired
  through `App`/`RoomViewer`, so real rooms keep every NPC on wander/idle.
- **Eligibility gap** — the `RoomSpec` `Npc` object is `type` / `name` / `interaction` /
  `color` / transform only; there is **no** hostility/faction/role/disposition field, and
  schema change is out of scope.

**Conclusion:** chase is *the awareness signal's first consumer plus a bounded pursuit variant
of the existing stepper* — reusing the movement kernel, the motor, the awareness tracker, and
the opt-in seam pattern. It is not a new authority surface, not a schema change, and not a
combat system.

## 4. Proposed v0 scope

- **Pure pursuit reducer** (`renderer/engine/npc/chaseStep.ts`): given `{ field, position,
  playerTarget, dtS }`, return the next `{ position }` by stepping toward `playerTarget`, capped
  at `NPC_WANDER.MAX_SPEED * dtS`, validated by the existing `isWanderPositionAllowed` /
  `isWanderSegmentAllowed`, stopping within `CONTACT_STANDOFF = 0.8`. Illegal candidate → hold
  position. Reuses `distanceXZ`; adds only the local `CONTACT_STANDOFF` constant. No randomness.
- **`WanderMotor` chase capability**: registration gains optional `chaseEligible?: boolean`;
  `update` gains an optional chase context `{ playerPosition, isChaseActive(npcId) }`. When an
  eligible entry's `isChaseActive` is true (and it is not paused), run `chaseStep`, writing the
  result back into the entry's existing wander/patrol `state.position` (and resetting
  target/mode so the reducer re-plans on resume). Otherwise the entry takes the identical
  existing wander/patrol path. `isWalking` reflects chase motion.
- **`Engine` wiring**: add `chaseOptInNpcIds?: ReadonlySet<string>` to `SetRoomOptions`; mark
  eligible entries in `registerWanderNpcs`; in `updateNpcWander`, pass `playerPosition` (from
  `this.player.position`) and `isChaseActive = (id) => eligible.has(id) && (tier === 'aware' ||
  tier === 'alerted')`, where `tier = this.npcAwareness.levelOf(id)` (prior frame). Clear
  eligibility on `setRoom`/`dispose` alongside the existing trackers.

## 5. Explicit non-goals

- No combat, damage, HP change, injury, item loss, capture, death, encounter, or quest effect;
  contact has no consequence.
- No hostility/faction/role/disposition field on `RoomSpec`; no schema change; no
  `schemaVersion` bump.
- No `App`/`RoomViewer`/UI wiring of eligibility; no real room auto-enables chase.
- No `WorldState` mutation; no `WorldEvent` / `WorldCommand` / event log / SQLite.
- No memory / fact / `fact_visibility` read or write.
- No LLM / provider / prompt change; no model decides chase.
- No persistence / save-game change.
- No cross-room chase; no following the player through exits.
- No longer-range chase / dedicated chase leash / return-to-home path (leash reuses
  `MAX_RADIUS_FROM_HOME`).
- No line-of-sight / facing / occlusion gating; no per-NPC speed/leash/standoff profiles.
- No `renderLoop` reorder; chase reads the prior frame's awareness tier.

## 6. Chase model and constants

Reused (unchanged): `NPC_WANDER.MAX_SPEED = 0.8`, `NPC_WANDER.MAX_RADIUS_FROM_HOME = 2.5`,
`distanceXZ`, `isWanderPositionAllowed`, `isWanderSegmentAllowed`, `shouldPauseWander`.
Reused awareness radii (unchanged): `ALERTED 1.5 / AWARE 3.0 / NEARBY 5.0`.

New (chase-local only):

```
CONTACT_STANDOFF = 0.8   // meters (XZ): NPC stops advancing within this of the player

chaseStep({ field, position, playerTarget, dtS }) -> { position }
```

`chaseStep` behavior:

1. Normalize `dtS` (finite, `>= 0`) exactly as the wander/patrol steppers do.
2. If `distanceXZ(position, playerTarget) <= CONTACT_STANDOFF` → hold (`position` unchanged).
3. Compute the desired point along `position → playerTarget` at `min(MAX_SPEED * dtS, distance
   - CONTACT_STANDOFF)`.
4. If `isWanderPositionAllowed(field, next)` **and** `isWanderSegmentAllowed(field, position,
   next)` → move to `next`. Otherwise → hold `position`.

Because legality includes the `MAX_RADIUS_FROM_HOME = 2.5` leash and the obstacle exclusions,
chase stays inside the wander-legal area (short-range/"lite"), never teleports, and always
leaves the NPC at a wander-legal position for clean resume.

## 7. Activation rules (awareness-gated, prior-frame tier)

For each `WanderMotor` entry on each `update` frame:

1. If `shouldPauseWander({ interactionLocked, npcTalking })` → pause + `syncXZ` + continue
   (unchanged; applies to chasers too).
2. Else if the entry is `chaseEligible` **and** `isChaseActive(npcId)` (tier `aware`/`alerted`)
   → run `chaseStep` toward `playerPosition`; write the result into the entry's `state.position`
   and reset `state` so wander/patrol re-plans on resume.
3. Else → run the entry's existing wander/patrol reducer (this is also the **resume** path when
   the tier drops to `nearby`/`unaware`).

`isChaseActive` is supplied by `Engine` and reads `NpcAwarenessTracker.levelOf(npcId)` from the
prior frame (the tracker updates later in `renderLoop`). First-frame default `unaware` →
inactive. Non-eligible entries never reach step 2.

## 8. Authority/ephemeral model

- Chase writes **only** node XZ (via the motor's existing `syncXZ`) and the entry's in-memory
  reducer `state`. It has **no** authoritative surface: no `WorldState`, `WorldEvent`,
  `WorldCommand`, event log, SQLite, memory, fact, `fact_visibility`, save-game, or `RoomSpec`;
  no `schemaVersion` bump.
- Eligibility (`chaseOptInNpcIds` → per-entry `chaseEligible`) is ephemeral runtime state set at
  `setRoom` and cleared on `setRoom`/`dispose`, mirroring the existing tracker lifecycle.
- **Fail safe:** illegal pursuit candidate → hold; awareness guards already fold different-room
  / non-finite positions to `unaware` (inactive). Contact is inert.

## 9. Runtime/renderer integration seams

- **`SetRoomOptions`** — add `chaseOptInNpcIds?: ReadonlySet<string>` with a doc comment
  identical in spirit to `patrolOptInNpcIds`: internal test/fixture seam only, never wired
  through `RoomViewer`/`App`, no real gameplay assignment.
- **`Engine.registerWanderNpcs`** — mark `chaseEligible: chaseOptInNpcIds?.has(objectId) ===
  true` on registration (independent of `policy`; a chaser may resume as either wander or
  patrol).
- **`Engine.updateNpcWander`** — pass the chase context: `playerPosition` from
  `this.player.position`, and `isChaseActive` reading `this.npcAwareness.levelOf(id)`. No
  `renderLoop` reorder.
- **`Engine.setRoom` / `dispose`** — no new tracker is needed (eligibility lives on motor
  entries, cleared by the existing `wanderMotor.clear()`), so lifecycle stays as-is; confirm no
  stale eligibility can survive a room swap.

No new engine lifecycle, no new React seam, no persistence, no per-frame logging.

## 10. Logging/debug safety

- **No per-frame logging** (movement-stack parity).
- If any log is added, use the logger abstraction with **safe values only** (`roomId`,
  `npcId`, `chaseEligible` count, tier enum). **Never** log coordinates, distances-as-narrative,
  NPC/room/object names, dialogue, prompts, provider bodies, memory text, or PII. **Never** frame
  chase/contact as a combat/damage event.
- No UI/debug indicator in v0.

## 11. Test/verification plan

**`renderer/engine/npc/chaseStep.test.ts` (Slice 1):**

- Determinism: identical `{ field, position, playerTarget, dtS }` → identical output.
- Step cap: displacement per call `<= MAX_SPEED * dtS` (no teleport).
- Legality: never returns a position failing `isWanderPositionAllowed` /
  `isWanderSegmentAllowed`; a blocked path → hold (position unchanged).
- Standoff: at `distance <= CONTACT_STANDOFF` → hold; approaching stops at ~`0.8 m`, no
  overshoot/jitter.
- Leash: a `playerTarget` beyond `MAX_RADIUS_FROM_HOME` from home → NPC advances only to the
  legal leash edge, then holds.
- Convergence: repeated calls with a reachable in-leash target strictly reduce distance until
  standoff.

**`renderer/engine/npc/WanderMotor.test.ts` (extend, Slice 2):**

- Eligible + active (`isChaseActive` true) → entry moves toward `playerPosition`.
- Awareness-drop: eligible entry with `isChaseActive` false runs its wander/patrol reducer and
  resumes from its current position (no stall) — covers both a former-wanderer and a
  former-patroller.
- **Non-eligible regression:** an entry not marked `chaseEligible` produces the **same output
  with and without** the chase context present (proves "non-opted NPCs unchanged").
- Pause precedence: `shouldPauseWander` (lock or `npcTalking`) freezes an **active chaser**.
- `isWalking` is true while chasing.
- No-teleport at the motor level: chase displacement per `update` `<= MAX_SPEED * dt`.

**`renderer/engine/Engine.test.ts` (extend, Slice 2/3):**

- An NPC in `chaseOptInNpcIds` with the player inside `AWARE_RADIUS` moves toward the player
  across frames; when the player leaves (tier `nearby`/`unaware`) it resumes wander/patrol.
- An NPC **not** opted in never deviates from wander/patrol under the same player motion.
- `setInteractionLock(true)` halts an active chase.
- `setRoom` clears chase eligibility (no cross-room bleed); a re-registered room without the
  opt-in set has no chasers.
- **No authoritative mutation:** deep-clone `room.objects` before running N chase frames and
  assert it is unchanged (patrol/awareness precedent).

**Verification commands (targeted first, from `apps/web`):**

```bash
npx vitest run src/renderer/engine/npc/chaseStep.test.ts
npx vitest run src/renderer/engine/npc/WanderMotor.test.ts
npx vitest run src/renderer/engine/Engine.test.ts
npm.cmd run test -- wanderStep
npm.cmd run test -- patrolStep
npm.cmd run test -- awarenessTracker
npx tsc --noEmit -p tsconfig.json
npx eslint <the changed/added files>
```

Then `npm run lint` and `npm run build` before closeout, since the touched area (renderer
movement) is central.

## 12. Implementation slices

1. **Slice 1 — Pure chase model + tests.** `renderer/engine/npc/chaseStep.ts`
   (`CONTACT_STANDOFF`, `chaseStep`), reusing the movement kernel. Tests:
   `chaseStep.test.ts`. No motor/Engine change.
2. **Slice 2 — `WanderMotor` chase capability + tests.** Registration `chaseEligible`, `update`
   chase context, chase-vs-wander/patrol branch with state write-back and clean resume. Tests:
   extend `WanderMotor.test.ts` (eligible chases, resume-on-drop, non-eligible regression, pause
   precedence, no-teleport).
3. **Slice 3 — `Engine` wiring + tests.** `SetRoomOptions.chaseOptInNpcIds`, `registerWanderNpcs`
   marking, `updateNpcWander` chase context, lifecycle confirmation. Tests: extend
   `Engine.test.ts` (opted-in chases, non-opted unchanged, lock halts, room-swap clears,
   `room.objects` no-mutation).
4. **Slice 4 — Docs closeout only.** Flip this plan and ADR-0084 to Implemented; move the
   ARCHITECTURE.md status line from planned to implemented (implemented-only convention). No code.

Each slice is independently reviewable and keeps the build green.

## 13. Safety invariants (must hold at every slice)

- Movement/intent only — contact is inert; no combat/damage/HP/injury/item/capture/death/
  encounter/quest effect.
- No `WorldState` / `WorldEvent` / `WorldCommand` / `applyEvent`.
- No persistence / schema / save-game / `RoomSpec` mutation; no `schemaVersion` bump.
- No memory / fact / `fact_visibility` read or write.
- No LLM / provider / prompt change.
- No `App` / `RoomViewer` / UI change; eligibility stays behind the internal
  `chaseOptInNpcIds` seam; no real room enables chase.
- Deterministic and non-teleporting; reuses the capped, re-validated wander kernel.
- Home-leashed to `MAX_RADIUS_FROM_HOME = 2.5`; resume-compatible.
- Existing pause gates (interaction lock / talking) still pause chase.
- Non-opted NPCs behaviorally unchanged, proven by regression tests.
- Same-room only; no cross-room chase.

## 14. Known limitations

- **Short-range / "lite" by design.** Leash reuse (`2.5`) plus the `aware` band (`3.0`) means
  an eligible NPC closes only on a player within ~2.5 m of its home; a player just outside is
  held at the leash edge. Deliberate trade-off for safety and clean resume.
- **Distance-only awareness.** Inherited from ADR-0083: no walls/occluders/facing, so an NPC
  can chase toward a player who is close but behind a wall (still bounded and non-teleporting).
- **One-frame awareness staleness.** Chase reads the prior frame's tier; deterministic and
  harmless at frame rate.
- **No real hostility source.** Eligibility is a test/fixture seam; no real room chases in v0.

## 15. Manual smoke plan

Run the app (`npm run dev` from `apps/web`) with a **fixture/dev harness** that injects a
single NPC id into `chaseOptInNpcIds` (never through normal room load; no committed real-room
change). Verify by eye:

1. **Approach triggers chase.** Walk the player toward the opted-in NPC. As the player enters
   the `aware` band (~3 m), the NPC turns from wander/patrol to moving **toward** the player.
2. **No teleport.** The NPC slides continuously; it never jumps, clips through a wall/pillar, or
   snaps position.
3. **Standoff, inert contact.** The NPC stops ~`0.8 m` from the player and does not overlap;
   nothing happens on contact — no HUD/health/inventory/quest/encounter/dialogue change, no
   damage, no notice.
4. **Leash is short-range.** Lead the NPC to its leash edge, then step further away: the NPC
   holds at the edge (does not follow indefinitely) and does not leave its home area.
5. **Awareness-drop resumes movement.** Walk away past the `aware` band: the NPC stops chasing
   and returns to normal wander/patrol from wherever it stopped (no freeze/stall).
6. **Lock/dialogue pauses chase.** Trigger an interaction/dialogue lock while the NPC is
   chasing: the NPC halts for the duration and resumes afterward.
7. **Non-opted NPCs unchanged.** Any NPC not in the injected set wanders/patrols exactly as
   before regardless of player proximity.
8. **Room swap clears chase.** Navigate to another room and back: no stale chaser; a room
   without the injected id has no chasers.

Record only safe observations (behavior seen, tier transitions); never capture coordinates,
room/NPC names, or narrative text in notes.

## 16. Risk analysis

| Risk | Mitigation |
| --- | --- |
| "Chase/hostile" reads as combat | Movement/intent only; contact inert; no combat/encounter path exists or is added (§0, §5, §13). |
| Teleport / wall-clip | Reuse capped `MAX_SPEED * dt` step + `isWanderPositionAllowed`/`isWanderSegmentAllowed` re-validation; illegal → hold (§6, tested §11). |
| Stall on resume (NPC left illegal area) | Leash reuses `MAX_RADIUS_FROM_HOME = 2.5`, so chase never leaves wander-legal space; resume path re-plans (§6, §7, tested §11). |
| Non-opted NPC behavior drift | Chase branch is gated on `chaseEligible`; regression test asserts identical output with/without chase context (§11). |
| Real room accidentally chases | Eligibility only via internal `chaseOptInNpcIds`; never wired through `App`/`RoomViewer`; no real room populates it (§0, §9). |
| Cross-room omniscience | Motor/awareness see only current-room nodes + same-room player; `clear()` on `setRoom` (§8, §9, tested §11). |
| Silent authoritative mutation | Deep-equal `room.objects` no-mutation test (§11). |
| One-frame staleness misread as a bug | Documented accepted behavior; deterministic (§0, §7, §14). |
| Per-frame perf | Chase is O(1) per eligible entry, same class as the existing stepper; no throttle needed at room scale. |

## 17. Open questions

1. **Chase state write-back shape** — settle in Slice 2 at the least-surface option: overwrite
   the existing wander/patrol `state.position` and reset `target`/`mode` (so the shared
   `WanderMotorEntry` union is unchanged) vs. a small dedicated transient chase state. Default:
   reuse the existing state (smaller diff), unless a resume edge case needs otherwise.
2. **`isChaseActive` band** — confirmed `aware`+`alerted` activate. Keep `nearby` inactive
   (matches ADR-0084); no open decision, recorded for traceability.
3. **Facing on chase** — whether the NPC node should rotate to face the player while chasing
   (presentation only) or keep its current idle-driven rotation. Default: no facing change in
   v0 (movement-only); a facing polish is deferrable.

## 18. Implemented outcome

Slices 1-3 landed as planned. **Slice 1** added the pure `chaseStep` reducer beside
`wanderStep`/`patrolStep`, reusing `distanceXZ` and the existing legality predicates, with
`CONTACT_STANDOFF = 0.8` and unit coverage for determinism, step cap, legality/hold, standoff,
leash, non-finite inputs, and immutability. **Slice 2** added `WanderMotor`'s opt-in
`chaseEligible` flag and optional chase context, branching to `chaseStep` only when active,
while preserving normal wander/patrol behavior for inactive or non-eligible NPCs and preserving
pause behavior. **Slice 3** wired `Engine`'s internal `SetRoomOptions.chaseOptInNpcIds` seam,
registration marking, and awareness-gated `isChaseActive` using `NpcAwarenessTracker.levelOf`.
This remained the Minimum Safe Change: one pure reducer + tests, one gated motor branch, then one
gated Engine seam. There was no schema, authority, combat, provider, prompt, persistence,
save-game, `App`, or `RoomViewer` change. Real hostility sources, real gameplay consumers,
longer-range chase, contact consequences, LOS, and cross-room pursuit remain deferred to their own
approved features.

### Minimum Safe Change Check

- **Reused:** `NPC_WANDER` (`MAX_SPEED`, `MAX_RADIUS_FROM_HOME`), `distanceXZ`,
  `isWanderPositionAllowed`, `isWanderSegmentAllowed`, `shouldPauseWander`, the `WanderMotor`
  entry/`syncXZ`/`isWalking` machinery, `NpcAwarenessTracker.levelOf`, and the
  `SetRoomOptions.patrolOptInNpcIds` opt-in seam pattern.
- **Minimum new code:** `chaseStep.ts` (reducer + `CONTACT_STANDOFF`), a `chaseEligible` flag +
  chase context branch on `WanderMotor`, a `chaseOptInNpcIds` set + gated `isChaseActive` in
  `Engine`, plus tests.
- **Safety boundaries unchanged:** no `WorldState`/`WorldEvent`/`WorldCommand`/`applyEvent`; no
  persistence/schema/save-game/`RoomSpec`/`schemaVersion`; no memory/fact/`fact_visibility`; no
  LLM/provider/prompt; no `App`/`RoomViewer`/UI; no combat/damage/encounter/quest/capture/death;
  movement/intent-only, opt-in, same-room, deterministic, non-teleporting, home-leashed.
- **Tests prove it:** §11 — the `chaseStep` determinism/no-teleport/legality/standoff/leash
  tests, the `WanderMotor` eligible-chases/resume/non-eligible-regression/pause tests, and the
  `Engine` opted-in-vs-non-opted/lock/room-swap/`room.objects` no-mutation tests.

## 19. Closeout (Slice 4)

Implemented files:

- `apps/web/src/renderer/engine/npc/chaseStep.ts` - pure deterministic chase reducer and
  `CONTACT_STANDOFF = 0.8`.
- `apps/web/src/renderer/engine/npc/chaseStep.test.ts` - reducer tests.
- `apps/web/src/renderer/engine/npc/WanderMotor.ts` - `chaseEligible`, optional chase context,
  chase write-back/resume behavior, and chase-aware `isWalking`.
- `apps/web/src/renderer/engine/npc/WanderMotor.test.ts` - motor integration tests.
- `apps/web/src/renderer/engine/Engine.ts` - internal `chaseOptInNpcIds` room setup seam,
  registration marking, and awareness-gated chase context.
- `apps/web/src/renderer/engine/Engine.test.ts` - Engine seam, awareness gating, cleanup, and
  no-authority regression tests.

Final behavior summary:

- Movement/intent only: chase moves renderer nodes and in-memory movement reducer state only.
- Eligibility is the internal `Engine`/`SetRoomOptions.chaseOptInNpcIds` seam only; no real room
  or app composition path auto-enables chase.
- Same-room awareness gates chase: `aware` and `alerted` activate; `nearby` and `unaware` stop
  chase and resume existing wander/patrol behavior.
- Chase is deterministic, capped by `NPC_WANDER.MAX_SPEED * dt`, non-teleporting, and reuses
  `isWanderPositionAllowed` / `isWanderSegmentAllowed`.
- Chase is home-leashed through the existing `NPC_WANDER.MAX_RADIUS_FROM_HOME = 2.5`, keeping it
  short-range/"lite" and resume-compatible.
- `CONTACT_STANDOFF = 0.8`; contact is inert and produces no combat, damage, HP/injury, item
  loss, capture, death, encounter, quest, relationship, event, command, memory, or fact effect.
- Existing interaction-lock and NPC-talking pauses still run before chase movement.
- The render-loop order was not changed; chase reads the prior frame's awareness tier, then
  `updateAwareness()` refreshes the tracker later in the frame.

Verification results:

- `npm.cmd run test -- chaseStep` - 9 tests passed.
- `npm.cmd run test -- WanderMotor` - 26 tests passed.
- `npm.cmd run test -- Engine` - 23 files, 315 tests passed.

Safety boundaries re-confirmed:

- No `App` / `RoomViewer` / UI wiring.
- No `RoomSpec` / schema / save-game / persistence change; no `schemaVersion` bump.
- No provider / prompt / LLM change.
- No `WorldState`, `WorldEvent`, `WorldCommand`, or `applyEvent` change.
- No memory, fact, or `fact_visibility` read/write path.
- No combat, damage, HP, item, encounter, quest, capture, death, or contact consequence.
- No cross-room chase.
- Non-opted NPCs remain behaviorally unchanged, proven by regression tests.

Known limitations kept:

- There is still no real gameplay consumer or real hostility source; eligibility is a
  test/fixture seam.
- Chase is short-range/"lite" because it reuses the 2.5m home leash.
- Awareness may be one frame stale by design.
- There is no combat, damage, encounter, capture, or other contact behavior.
