# Implementation Plan — `feature/npc-movement-safety-contract-v0`

> Status: **Docs-only design plan. No implementation approved yet.**
> Third feature of the NPC life/movement stack:
> [`npc-idle-animation-v0`](./npc-idle-animation-v0.md) →
> [`npc-behavior-state-v0`](./npc-behavior-state-v0.md) →
> `npc-movement-safety-contract-v0` → [`npc-local-wander-v0`](./npc-local-wander-v0.md).
>
> Companion docs: [ARCHITECTURE](../ARCHITECTURE.md) · [BOUNDARIES](../BOUNDARIES.md) ·
> [CONVENTIONS](../CONVENTIONS.md) · [FAILURE-MODES](../FAILURE-MODES.md).
> Pattern precedent: [generated-mechanical-gate-contract-v0](./generated-mechanical-gate-contract-v0.md)
> (ADR-0061) — a pure domain contract + tests shipped **before** any runtime
> enforcement, so the trust boundary is frozen and reviewable in isolation.
>
> Global stack invariants: presentation-only; no `RoomSpec` position mutation; no
> `WorldState` mutation per tick; no `WorldEvent`s for idle/wander; no save/load of
> NPC runtime positions; no provider/LLM calls; no memory writes; no
> quest/gate/objective authority; no dialogue/memory text logging; deterministic
> test paths first.

---

## 1. Problem statement

`npc-local-wander-v0` will move NPC meshes at runtime. Uncontracted movement can
break real gameplay affordances even though it is "only" presentation: an NPC
parked on an exit arch hides the exit ring and its prompt; an NPC drifting into
the spawn safe-area greets a loading player with mesh overlap; an NPC that walks
away from its floor ring and spec position becomes hard to target because
proximity/F-talk reads the **static** `Interactable.position` captured at
`setRoom` (`renderer/engine/Engine.ts:191-206`,
`domain/ports/interaction.ts:37-65`). This feature freezes the safety rules as a
**pure domain contract with exhaustive deterministic tests, before any runtime
code exists** — the same de-risking sequence used for the mechanical gate
(contract → fake → runtime).

## 2. Goals

- A pure, dependency-free domain contract (`domain/npcMovementContract.ts`) that
  answers, for one NPC in one validated `LoadedRoom`:
  1. **Walkable bounds** — reuse `computePlayableBounds`
     (`domain/generatedRoomLayout.ts:53-62`) so NPC bounds match the
     spawn/object-placement wall-margin formula already shipped.
  2. **Exclusion zones** (XZ discs):
     - every exit-carrying object with clearance `EXIT_CLEARANCE` — the
       predicate is the **presence of `interaction.exit` alone**, deliberately
       wider than `buildExitLookup` (`app/exits.ts:8-16`), which additionally
       requires a non-null, non-duplicate `id` before an exit can navigate;
       the clearance disc must not depend on ids. Covers forward arches **and**
       return exits, so exits are never blocked;
     - the spawn safe area — reuse the `LIMITS.SPAWN_CLEARANCE` radius semantics
       of `isSpawnSafeAreaOverlap` (`generatedRoomLayout.ts:81-88`);
     - every **other** interactable object (focal anchors, chests, scrolls —
       anything with an `interaction`, hence a floor ring) with clearance
       `INTERACTABLE_CLEARANCE`, excluding the wandering NPC itself;
     - every remaining non-interactable object's physical footprint via the
       shipped `objectFootprintRadius` (`generatedRoomLayout.ts:190`), so NPCs
       do not ghost through thrones and pillars.
  3. **Home tether** — max radius `MAX_RADIUS_FROM_HOME` from the NPC's spec
     position (the home never changes; it is the `RoomSpec` value).
  4. **Deterministic seeded step choice** — a pure, **stateless** chooser: same
     `(field, current, seed, stepIndex)` → same step, with no RNG stream object.
  5. **Speed cap** — `MAX_SPEED` well below the player's 4 m/s
     (`controls/movement.ts:22`), plus bounded step length.
  6. **Pause rules** — closed reasons `dialogue-open` and `interaction-lock`
     (a trivial pure predicate), with objective/combat pauses documented as
     future-only extensions.
- **Interaction-targeting ruling (contract text + future enforcement):**
  proximity/F-talk **must follow the live presentation transform** — any runtime
  implementation must keep the NPC's `Interactable.position` and floor ring in
  sync with the moving mesh each frame. Rationale: the stale spec position would
  make the HUD prompt fire at empty floor. The tether cap is a backstop, not the
  primary guarantee.
- Path safety, not just endpoint safety: a chosen step validates **sample
  points along the whole segment at ≤ `SEGMENT_SAMPLE_SPACING` (0.4 m)
  intervals, target included** — not merely the midpoint. Endpoint+midpoint
  alone would leave 0.8 m gaps at `STEP_MAX`, enough for the smallest footprint
  discs (candle-class, ≈ 0.24 m radius) to be crossed undetected. At 0.4 m
  spacing the worst-case undetected graze is shallower than the 0.15 m
  `FOOTPRINT_SAFETY` padding built into every footprint disc, so no rendered
  mesh — and no gameplay clearance (exit 1.6, interactable 1.4, spawn 1.0) —
  can actually be entered.
- Docs + pure tests only in this feature: **no runtime enforcement, no renderer
  change, no caller** until `npc-local-wander-v0`.

## 3. Non-goals

- No runtime movement, no Engine/renderer/builder/RoomViewer change of any kind.
- No pathfinding, navmesh, collision system, or steering — v0 is straight-line
  micro-steps with reject-and-pause.
- No door-to-door or cross-room NPC travel; the tether forbids it structurally.
- No schema change: no `RoomSpec` field for wander radius, speed, or "static"
  flags (a per-NPC authored opt-out is a possible future schema discussion, not
  v0).
- No zombie/creature movement; `npc` type only (consumed later by plan 4).
- No provider/LLM input to movement, ever — movement parameters are hand-written
  constants; generated content cannot widen them.
- No logging surface (pure module returns data; it never logs).

## 4. Data/authority boundary

- **Pure domain module**: imports only `LoadedRoom`/`RoomObject` types and the
  shipped pure helpers from `domain/generatedRoomLayout.ts` /
  `domain/validateRoom.ts` (`LIMITS`) and `domain/stableHash.ts` (plan 1) — all
  domain-internal. No Three.js, React, logger, I/O, or `Math.random`
  (BOUNDARIES.md domain row).
- **Consumes validated data only**: a `LoadedRoom` after the full trust pipeline;
  the contract adds no validation authority and repairs nothing.
- **Produces data only**: bounds/discs/steps as plain values. Nothing here can
  mutate a room, a world state, or an event log even if misused.
- **Authority**: none. The contract describes what presentation-layer movement
  *may* do; it grants no gameplay meaning to positions.

## 5. Current repo facts (verified against source)

- `computePlayableBounds`, `isInsidePlayableBounds`, `isSpawnSafeAreaOverlap`,
  `objectFootprintRadius`, and `GENERATED_ROOM` limits are shipped pure exports
  of `domain/generatedRoomLayout.ts` — the exclusion geometry largely exists.
- Navigation identifies exit objects by `object.interaction?.exit` **plus** a
  non-null, non-duplicate `id` (`app/exits.ts:8-16`). The contract's exclusion
  discs key on the `interaction?.exit` presence alone, read from domain data
  directly (it must not import `app/**`): an id-less exit object cannot
  navigate, but it still reads as an exit and still gets the full
  `EXIT_CLEARANCE`.
- Proximity targeting is static today: `buildInteractables` copies spec positions
  once (`domain/ports/interaction.ts:60`), and `Engine.updateProximity` reads
  that copy every frame. The `Interactable.position` doc comment already says
  "used by the engine for proximity" — mutating it live is within its contract.
- The floor ring is a **separate sibling node** placed at the object's spec XZ
  (`renderer/engine/builders/index.ts:44-53, 396-416`), so a moving NPC leaves
  its ring behind unless the runtime feature moves both (ruling in §2 covers
  this; enforcement lands in plan 4).
- `generation/prng.ts` is banned from domain by the BOUNDARIES dependency
  table (review-enforced, not mechanically lint-enforced); `domain/stableHash.ts`
  (created in plan 1) provides the deterministic scalar hash this contract needs
  for stateless step choice.
- Precedent for "pure contract first": `domain/generatedMechanicalGate.ts`
  shipped with tests and **no runtime enforcement** (ADR-0061), followed by fake
  (ADR-0062) and runtime (ADR-0063) slices.

## 6. File-level change plan

**New files:**

- `apps/web/src/domain/npcMovementContract.ts` —
  - `export const NPC_WANDER = { MAX_RADIUS_FROM_HOME: 2.5, MAX_SPEED: 0.8,
    STEP_MIN: 0.6, STEP_MAX: 1.6, EXIT_CLEARANCE: 1.6, INTERACTABLE_CLEARANCE: 1.4,
    SEGMENT_SAMPLE_SPACING: 0.4, PAUSE_MIN_S: 1.5, PAUSE_MAX_S: 4.5 } as const`
    (all meters/seconds; maintainer-tunable at approval; `MAX_SPEED` is 20% of
    player speed; `SEGMENT_SAMPLE_SPACING` is the contract-owned segment
    sampling interval that keeps undetected grazes below the 0.15 m
    `FOOTPRINT_SAFETY` padding of the smallest discs — the motor must import
    it, never re-declare it).
  - `type ExclusionDisc = { x: number; z: number; radius: number }`
  - `buildNpcWanderField(room: LoadedRoom, npcObjectId: string):
    NpcWanderField | null` — null when the id is missing/not an `npc`; otherwise
    `{ home: {x,z}, bounds: PlayableBounds, exclusions: ExclusionDisc[] }`
    assembled per §2.2 (exit discs, spawn disc, interactable discs, footprint
    discs; the NPC's own discs excluded).
  - `isWanderPositionAllowed(field, pos: {x,z}): boolean` — inside bounds ∧
    within tether ∧ outside every disc.
  - `chooseWanderStep(field, current: {x,z}, seed: number, stepIndex: number):
    { target: {x,z} } | null` — stateless determinism: candidate headings and a
    step length are derived from `stableHash01(`${seed}:${stepIndex}:…`)`;
    candidates are tried in deterministic order; a candidate is accepted only
    if **every sample point along the segment from `current` to the target —
    spaced ≤ `SEGMENT_SAMPLE_SPACING` (0.4 m), target included — passes
    `isWanderPositionAllowed`**; all rejected → `null` (caller pauses). Step
    length clamped to `[STEP_MIN, STEP_MAX]`, so a candidate needs at most
    `ceil(STEP_MAX / SEGMENT_SAMPLE_SPACING) = 4` sample checks — trivially
    cheap.
  - `wanderPauseSeconds(seed: number, stepIndex: number): number` — deterministic
    in `[PAUSE_MIN_S, PAUSE_MAX_S]`.
  - `shouldPauseWander(input: { interactionLocked: boolean; npcTalking: boolean }):
    boolean` — trivial closed predicate (`||`), the documented home for future
    closed reasons (objective/combat) so they are added here, not ad-hoc in the
    motor.
- `apps/web/src/domain/npcMovementContract.test.ts`.

**Modified files:** none. (This is the whole point of the feature.)

**Files NOT to touch:** `renderer/**` (all of it) · `domain/roomSpec.ts` ·
`domain/loadRoomSpec.ts` · `domain/validateRoom.ts` ·
`domain/generatedRoomLayout.ts` (reused via imports, not edited) · `app/**` ·
`App.tsx` · `world-session/**` · `interactions/**` · `encounters/**` ·
`dialogue/**` · `memory/**` · `persistence/**` · `server/**` · `generation/**` ·
`eslint.config.js` · `package.json`.

### Minimum Safe Change Check

- **Reused:** `computePlayableBounds` / `isInsidePlayableBounds` /
  `isSpawnSafeAreaOverlap` semantics / `objectFootprintRadius` / `LIMITS` —
  the exclusion geometry is mostly shipped code · `stableHash01` from plan 1 ·
  the `interaction.exit` marker that `app/exits.ts` also keys on (exclusion
  uses its presence alone, without the id requirement — §2) ·
  the contract-before-runtime pattern from ADR-0061.
- **Minimum new code:** one pure module (~150 lines) + one test file. Zero
  runtime wiring, zero modified files.
- **Safety boundaries unchanged:** domain stays dependency-free · renderer/trust
  pipeline untouched · no schema/save/provider/memory/logging change.
- **Targeted tests:** §7 — determinism, bounds, every exclusion class, tether,
  step/speed caps, segment-sampling safety (incl. small-disc crossing
  rejection), boxed-in null, pause predicate.

## 7. Tests

All deterministic, fixture-based (small hand-written `LoadedRoom`s via
`loadRoomSpec`, mirroring `Engine.test.ts` fixtures):

1. **Field assembly** — a room with an exit arch, a spawn, a chest (interactable),
   a pillar (footprint), and the NPC itself yields: exit disc at the arch XZ with
   `EXIT_CLEARANCE`; spawn disc with `LIMITS.SPAWN_CLEARANCE`; chest disc with
   `INTERACTABLE_CLEARANCE`; pillar disc from `objectFootprintRadius`; **no** disc
   for the NPC itself. Unknown id / non-npc id → `null`.
2. **Position predicate** — points inside/outside each disc class, outside the
   playable bounds, and beyond the tether are rejected; a legal point passes.
3. **Determinism** — `chooseWanderStep` with identical inputs returns identical
   output across repeated calls and across seeds differing only in `stepIndex`
   diverging as expected; no `Math.random` reachable (module-level lint +
   test spot-check that outputs are stable).
4. **Step safety sweep** — for a realistic fixture and, e.g., 500 sequential
   `stepIndex` values walking a simulated position: every accepted step's full
   sample chain (≤ `SEGMENT_SAMPLE_SPACING` spacing, target included) satisfies
   `isWanderPositionAllowed`; every step length ∈ `[STEP_MIN, STEP_MAX]`; the
   position never exits the tether or enters the exit disc (regression armor
   for "never blocks exit arches").
5. **Segment crossing rejection** — a hand-built field with a small disc
   (candle-class footprint, radius < 0.4 m) placed so a candidate segment's
   endpoints and midpoint all lie outside the disc while the segment passes
   through it: the candidate must be rejected. Proves the ≤ 0.4 m sampling
   catches what endpoint+midpoint checking would miss.
6. **Boxed-in** — a field whose home is surrounded by exclusions returns `null`
   (wander degrades to standing still, never to a rule violation).
7. **Pause values** — `wanderPauseSeconds` deterministic and within
   `[PAUSE_MIN_S, PAUSE_MAX_S]`.
8. **Pause predicate** — truth table for `shouldPauseWander`.

## 8. Manual smoke

None meaningful — this feature ships no runtime behavior. The only "smoke" is
that the full existing suite, lint, and build remain green (no modified files, so
this is a formality). Real visual smoke happens in `npc-local-wander-v0`.

## 9. Risks

- **Over-exclusion in cluttered generated rooms** (up to 30 objects → many
  discs): the NPC may be boxed in and never move. Mitigation: that is the *safe*
  failure mode by design (`null` step = stand still); the step-safety sweep test
  quantifies it on a realistic fixture; clearance constants are tunable.
- **Disc model vs. real geometry:** discs approximate footprints
  (rotation-invariant radius, same simplification `repairGeneratedObjects`
  already uses) — a wide table's corners may poke out. Accepted v0 fidelity;
  documented here so nobody "fixes" it with a physics dependency.
- **Constant drift between contract and motor:** the motor (plan 4) must import
  every limit from this module — flagged in plan 4's review checklist so no
  constant is re-declared renderer-side.
- **Scope temptation:** pathfinding/steering requests must become a new plan; the
  chooser's reject-and-pause shape is deliberately too simple to grow silently.

## 10. Slice breakdown

- **Slice 1 — Docs (this file).** `docs: plan NPC movement safety contract v0`.
- **Slice 2 — Contract + tests.** `feat(domain): NPC movement safety contract`
  — the single pure module and its test file. Independently shippable; nothing
  imports it yet.
- **Slice 3 — Docs closeout.** `docs: record NPC movement safety contract
  decisions` — update this plan's status; record whether the maintainer wants an
  ADR (recommended: yes, a short ADR mirroring ADR-0061's shape, since this
  freezes a boundary the runtime feature will rely on).

## 11. Verification commands

```bash
# Slice 1: docs-only — no build/test run required (report as skipped).

# Slice 2
npm.cmd run test -- npcMovementContract
npm.cmd run lint
npx.cmd tsc --noEmit -p .
```

Run from `apps/web`.

## 12. Decisions needing maintainer approval

1. **Numeric limits** in `NPC_WANDER` (§6) — proposed values are conservative;
   approve or tune before implementation.
2. **Footprint discs for non-interactable objects included** (recommended, reuses
   `objectFootprintRadius`) vs. minimal exclusions only (exits + spawn +
   interactables). Including footprints costs little and prevents
   walking-through-furniture.
3. **Interaction-targeting ruling:** live-transform tracking mandated (§2,
   recommended) vs. "keep radius small enough that spec-position targeting stays
   reachable". The plan mandates live tracking and keeps the tether as backstop.
4. **ADR or not:** this plan proposes a short ADR at closeout (Slice 3) because
   the contract constrains a future runtime boundary; maintainer may decide the
   plan itself suffices (precedent exists both ways).
