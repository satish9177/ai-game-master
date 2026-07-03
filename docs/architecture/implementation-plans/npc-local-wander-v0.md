# Implementation Plan — `feature/npc-local-wander-v0`

> Status: **Docs-only design plan. No implementation approved yet.**
> Fourth feature of the NPC life/movement stack; **depends on all three prior
> features being shipped**:
> [`npc-idle-animation-v0`](./npc-idle-animation-v0.md) (node tagging + stable hash) →
> [`npc-behavior-state-v0`](./npc-behavior-state-v0.md) (talking/wandering tracker) →
> [`npc-movement-safety-contract-v0`](./npc-movement-safety-contract-v0.md) (the frozen rules) →
> `npc-local-wander-v0`.
>
> Companion docs: [ARCHITECTURE](../ARCHITECTURE.md) · [BOUNDARIES](../BOUNDARIES.md) ·
> [CONVENTIONS](../CONVENTIONS.md) · [FAILURE-MODES](../FAILURE-MODES.md).
>
> Global stack invariants: presentation-only; no `RoomSpec` position mutation; no
> `WorldState` mutation per tick; no `WorldEvent`s for idle/wander steps; no
> save/load of NPC runtime positions; no provider/LLM calls; no memory writes; no
> quest/gate/objective authority; no dialogue/memory text logging; deterministic
> test paths first.

---

## 1. Problem statement

With idle animation shipped, NPCs breathe but never move. Local wandering — a few
slow, tethered steps around the NPC's home position with natural pauses — is the
next believability jump. Everything risky about it has been pre-solved: the
movement rules are frozen in `domain/npcMovementContract.ts` with pure tests, the
per-NPC behavior vocabulary exists, and NPC nodes are already taggable/findable.
What is missing is the runtime: an engine-side per-frame motor that executes
contract-approved steps, keeps the NPC talkable while it moves, and pauses
correctly.

## 2. Goals

- **Engine-side per-frame motor** (`renderer/engine/npc/WanderMotor.ts`) driven
  by the existing `renderLoop` dt (`renderer/engine/Engine.ts:161-170`), the same
  pattern as `MovementControls` (thin class, pure math elsewhere).
- **Deterministic seeded movement:** per-NPC seed =
  `stableHash32(`${room.id}:${objectId}`)`; steps and pauses come solely from the
  contract's stateless `chooseWanderStep` / `wanderPauseSeconds`, so a given room
  replays the same wander pattern every run (timing varies with frame cadence;
  the step *sequence* does not).
- **Respects the safety contract:** the motor imports every limit and every
  decision from `domain/npcMovementContract.ts` — it re-declares no constants and
  contains no placement logic of its own.
- **Never blocks exit arches:** guaranteed by the contract's exit exclusion discs
  plus its ≤ 0.4 m segment sampling (`SEGMENT_SAMPLE_SPACING`); re-verified here
  with a motor-level regression test and a manual smoke item.
- **Wandered NPC stays talkable/interactable:** each frame the motor syncs the
  moving mesh's XZ into (a) the NPC's `Interactable.position` (the engine's
  proximity source, `Engine.ts:191-206`) and (b) the NPC's floor ring node — the
  live-transform ruling from the safety contract, enforced by tests.
- **Pauses during dialogue/interaction lock:** motor freezes whenever
  `Engine.locked` is true (any panel/navigation, `Engine.ts:181-184`) or the
  NPC's behavior state is `talking`; while walking, the tracker reports
  `wandering`.
- **Save/load reset is acceptable and by design:** positions are
  non-authoritative presentation state; loading (or any room change) recreates
  the engine, and every NPC restarts from its spec position. Nothing is
  persisted.
- Disposal-safe teardown with the engine lifecycle; deterministic pure tests for
  all motor logic.

## 3. Non-goals

- No pathfinding, steering, collision response, or animation blending (no walk
  cycle — the mesh glides at ≤ `NPC_WANDER.MAX_SPEED`; a leg-swing polish is a
  possible later feature).
- No facing-the-player, greeting radius, or player-aware behavior.
- No cross-room travel, exit usage, or door awareness beyond exclusion discs.
- No zombie/creature wandering (`npc` type only).
- No per-NPC authored parameters (radius/speed/static flags) — would need a
  schema discussion; v0 uses contract constants uniformly.
- No `RoomSpec`/save/`WorldState`/event/quest/gate/objective change; no
  provider/LLM/memory involvement; no React/UI change (`RoomViewer` untouched —
  the talking wiring already landed in `npc-behavior-state-v0`).
- No new logging beyond at most one count-only registration line.

## 4. Data/authority boundary

- **Writes, per frame:** THREE node transforms (NPC mesh XZ, ring XZ) and the
  engine-owned `Interactable.position` plain object — the documented proximity
  view-model, already described as "used by the engine for proximity"
  (`domain/ports/interaction.ts:29`). Nothing else. `LoadedRoom.objects[].position`
  (spec data) is never written; it remains the authoritative home tether anchor.
- **Reads:** the validated `LoadedRoom` (once, at `setRoom`, to build wander
  fields), `Engine.locked`, and the behavior tracker.
- **Never touched:** `WorldSession`/`WorldStore`/`WorldCommand`/`WorldEvent`/
  `WorldState`, save blobs (`saveGameJson` and all sidecars), quests, gates,
  objectives, memory layers, providers, persistence, server. Movement produces
  zero events and zero authoritative deltas — deleting the motor mid-session
  must change nothing but visuals.
- **Lint posture:** everything new lives in `renderer/engine/**` (imports domain
  + Logger port only — both allowed) and `domain/**` stays untouched. No new
  lint rules needed.

## 5. Current repo facts (verified against source)

- `Engine.renderLoop` already owns dt and calls `movement.update` +
  `updateProximity` each frame — the motor slots beside them.
- `Engine.setInteractionLock` sets `this.locked` for **every** panel type and
  during navigation (`renderer/RoomViewer.tsx:180-200`), so `locked` alone
  covers the contract's `interaction-lock` and `dialogue-open` pause reasons;
  per-NPC `talking` (behavior tracker) is a second, finer-grained freeze that
  also survives any future unlocked-panel design.
- The engine is disposed/recreated on every room change
  (`RoomViewer.tsx:134-342`), so wander state cannot leak across rooms and
  save/load reset comes for free.
- NPC nodes are findable via the plan-1 `userData.objectType`/`objectId` tags;
  floor rings are separate sibling nodes currently **not** linked to their object
  (`renderer/engine/builders/index.ts:44-53`) — a ring back-reference tag is a
  required enabling change here.
- `updateProximity` reads `Interactable.position` fresh every frame, so mutating
  that object live is sufficient for talkability — no `Engine` proximity change
  needed.
- The isometric clamp helper `clampToBounds` (`camera/isometric.ts`, reused by
  `MovementControls`) exists, but the contract's `isWanderPositionAllowed`
  already subsumes bounds checking — the motor uses contract calls only.

## 6. File-level change plan

**New files:**

- `apps/web/src/renderer/engine/npc/wanderStep.ts` — pure per-frame math,
  separated from the class for testability:
  - `type WanderEntryState = { pos: {x,z}; mode: 'pausing' | 'walking';
    target: {x,z} | null; pauseRemainingS: number; stepIndex: number }`
  - `advanceWander(state, field, seed, dt): WanderEntryState` — pausing counts
    down then asks `chooseWanderStep`; walking moves toward `target` at
    `NPC_WANDER.MAX_SPEED` (arrival snap within epsilon), then draws
    `wanderPauseSeconds`. Pure, no THREE import (operates on plain `{x,z}`).
- `apps/web/src/renderer/engine/npc/wanderStep.test.ts`.
- `apps/web/src/renderer/engine/npc/WanderMotor.ts` — thin stateful holder:
  - `register(entry: { objectId: string; node: THREE.Object3D;
    ring: THREE.Object3D | null; interactable: Interactable | null;
    field: NpcWanderField; seed: number })` — initial state `pausing` with a
    deterministic first pause;
  - `update(dt: number, isPaused: (objectId: string) => boolean)` — for each
    entry: if paused → freeze (state untouched, so motion resumes where it
    stopped); else `advanceWander`, then apply `state.pos` to `node.position`
    x/z, `ring.position` x/z, and `interactable.position` x/z; report
    `mode === 'walking'` to the caller (for the behavior tracker);
  - `clear()`.
- `apps/web/src/renderer/engine/npc/WanderMotor.test.ts` — duck-typed nodes,
  same style as `Engine.test.ts:217-264`.

**Modified files:**

- `apps/web/src/renderer/engine/builders/index.ts` — when adding an
  interactable's floor ring, also tag it:
  `ring.userData.forObjectId = obj.id` (~1 line; enables ring pairing).
- `apps/web/src/renderer/engine/Engine.ts` —
  - private `wanderMotor = new WanderMotor()`;
  - in `setRoom`: for each `npc`-tagged child with an id, call
    `buildNpcWanderField(room, objectId)`; when non-null, register with the
    matching ring (by `userData.forObjectId`), the matching entry from
    `this.interactables` (by `id`), and seed
    `stableHash32(`${room.id}:${objectId}`)`;
  - in `renderLoop`:
    `this.wanderMotor.update(dt, (id) => this.locked || this.behavior.stateOf(id) === 'talking')`,
    and feed the returned walking set into
    `this.behavior.setWandering(id, walking)` so the idle animation's intensity
    table applies (`wandering` intensity per plan-2 table);
  - in `dispose`: `this.wanderMotor.clear()`.
  ~15 lines of wiring; all decisions remain in domain/pure modules.
- `apps/web/src/renderer/engine/Engine.test.ts` — extend the duck-typed
  fake-engine fixture with the new `wanderMotor` field (plus any plan-1/2
  fields it still lacks): constructor field initializers do not exist on the
  prototype-call fake, so `setRoom`'s wander registration would otherwise
  throw.

**Files NOT to touch:** `domain/npcMovementContract.ts` (consumed, not edited —
any rule change goes back through that plan) · `domain/roomSpec.ts` and all
schemas · `domain/ports/interaction.ts` · `renderer/RoomViewer.tsx` ·
`renderer/ui/**` · `app/**` · `App.tsx` · `world-session/**` · `interactions/**` ·
`encounters/**` · `dialogue/**` · `memory/**` · `persistence/**` · `server/**` ·
`generation/**` · save/load modules · `eslint.config.js` · `package.json`.

### Minimum Safe Change Check

- **Reused:** the entire safety contract (fields, step choice, pauses, limits) ·
  plan-1 node tagging + `stableHash` · plan-2 behavior tracker + idle intensity ·
  existing `renderLoop`/dispose lifecycle · existing `Interactable.position`
  proximity path (no engine proximity change) · `MovementControls` as the
  structural template.
- **Minimum new code:** one pure step-advance module, one thin motor class,
  1-line ring tag, ~15 lines of Engine wiring.
- **Safety boundaries unchanged:** no authoritative surface gains a write path ·
  spec positions never mutated · no persistence of runtime positions · renderer
  lint walls intact · contract constants imported, never re-declared.
- **Targeted tests:** §7 — determinism, contract compliance, pause/freeze,
  live-targeting sync, exit-arch regression.

## 7. Tests

1. `wanderStep.test.ts` (pure):
   - determinism: identical `(state, field, seed, dt)` sequences produce
     identical trajectories;
   - contract compliance sweep: simulate many seconds of updates on a realistic
     fixture — every visited position satisfies `isWanderPositionAllowed`
     (tether, bounds, exits, spawn, interactables, footprints);
   - speed cap: per-update displacement ≤ `NPC_WANDER.MAX_SPEED * dt` (+epsilon);
   - arrival → pausing transition with pause duration in contract range;
   - boxed-in field: state stays `pausing` forever at home (no jitter loop).
2. `WanderMotor.test.ts` (duck-typed nodes):
   - `update` applies `pos` to node XZ, ring XZ, and `interactable.position` XZ
     in the same frame (live-targeting enforcement — the contract ruling's
     regression test);
   - node Y and rotation are untouched (idle bob owns Y);
   - paused predicate true → nothing moves, state resumes (not resets) when
     unpaused;
   - walking entries are reported for the behavior tracker; pausing entries are
     not;
   - `clear()` empties registrations; `update` after `clear` is a no-op.
3. Exit-arch regression (fixture with an exit near the NPC home): across a long
   simulated run, the NPC's position never enters the exit's exclusion disc —
   belt-and-braces on top of the contract's own sweep test.
4. Builders test extension: interactable rings carry `userData.forObjectId`.

## 8. Manual smoke (dev, local run)

1. Demo room: the NPC takes slow, short steps around its home, pausing between
   steps; motion is calm and never darts.
2. Its green talk ring and the HUD "Press F · Talk" prompt **follow the NPC** —
   walk beside the moved NPC and press F: the dialogue panel opens.
3. While the panel is open the NPC is frozen (and idle bob paused, per plan 2);
   closing resumes wandering from the same spot.
4. Open a scroll/chest panel: **all** NPCs freeze (global lock), resume on close.
5. The NPC never stands on or blocks the exit arch or the spawn area; walking
   into the exit still triggers navigation normally.
6. Stand near an exit while the NPC wanders close by: the HUD prompt may flip
   between the exit and the NPC as the nearest target changes — confirm the
   flipping is acceptable (no rapid flicker), and confirm both interactions
   remain usable: E on the exit still navigates, F on the NPC still opens
   dialogue.
7. Generated room via PromptBar: the ensured generated NPC wanders under the
   same rules; reload the page and watch the first steps repeat (determinism
   spot-check).
8. Navigate away and back: NPC restarts at its spec position (engine
   recreation — expected reset).
9. Save, then Load: same reset behavior, no errors, no position persistence
   anywhere in the save blob (inspect `localStorage` wrapper if in doubt).
10. Leave the tab idle for a minute, return: no teleporting (dt cap upstream)
    and no rule violation.

## 9. Risks

- **Ring/interactable pairing misses** (id-less NPCs): unmatched entries are not
  registered — an id-less NPC simply never wanders (safe degradation; generated
  NPCs always carry ids via `ensureGeneratedNpcDialogue`).
- **Visual glide without a walk cycle** may read as "floating chess piece" at
  higher speeds — mitigated by the low `MAX_SPEED`; a leg-swing/lean polish is a
  candidate follow-up feature, not scope creep here.
- **Two writers on one node:** idle bob writes Y/rotation, wander writes XZ —
  disjoint by design and asserted by the "Y untouched" test; any future animation
  must keep this axis split or route through one owner.
- **Frame-cadence timing drift:** the step *sequence* is deterministic but wall-
  clock timing varies with FPS; accepted (presentation-only, nothing replays it).
- **Player/NPC mesh overlap:** the player is not an exclusion disc (it moves);
  an NPC can brush the player marker. Accepted v0; noted for a possible
  player-proximity yield rule later (would be added to the contract first).

## 10. Slice breakdown

- **Slice 1 — Docs (this file).** `docs: plan NPC local wander v0`.
- **Slice 2 — Pure step advance.** `feat(renderer): pure wander step advance`
  — `wanderStep.ts` + tests. Nothing imports it yet.
- **Slice 3 — Motor + ring tagging.** `feat(renderer): NPC wander motor
  (unwired)` — `WanderMotor.ts` + tests, 1-line ring tag + builders test.
  Still no runtime behavior change.
- **Slice 4 — Engine wiring + smoke.** `feat(renderer): NPCs wander locally
  within the movement safety contract` — `Engine.ts` wiring, `Engine.test.ts`
  fake extension, full §8 checklist, status update in this plan. If the
  maintainer wants an ADR for the stack, it lands with this slice (one ADR
  covering behavior-state + contract + wander is reasonable; decision at
  approval).

## 11. Verification commands

```bash
# Slice 1: docs-only — no build/test run required (report as skipped).

# Slice 2
npm.cmd run test -- wanderStep

# Slice 3
npm.cmd run test -- wanderStep WanderMotor builders

# Slice 4 — regression
npm.cmd run test -- wanderStep WanderMotor npcMovementContract idleAnimation behaviorTracker Engine
npm.cmd run lint
npm.cmd run build
```

Run from `apps/web`. `npm.cmd run build` is included in the final slice because
the touched area (render loop) is central.

## 12. Decisions needing maintainer approval

1. **Scope of rooms:** wander in **all** rooms with `npc` objects (recommended —
   the contract consumes any validated `LoadedRoom`, and presentation-only means
   authored rooms are safe) vs. generated-play rooms only as a first step.
2. **Ring follows NPC** (recommended, specified here) vs. static ring with a
   tighter tether — the live-targeting ruling in the safety contract already
   points at the former.
3. **Walking idle-intensity:** keep full idle bob while walking
   (`wandering: 1` in the plan-2 table) or damp it (e.g. `0.5`) so bob+glide
   don't stack oddly — visual call at implementation review.
4. **ADR for the stack** at Slice 4 (see §10).
