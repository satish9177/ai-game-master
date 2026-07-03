# Implementation Plan — `feature/npc-idle-animation-v0`

> Status: **Docs-only design plan. No implementation approved yet.**
> First feature of the NPC life/movement stack:
> `npc-idle-animation-v0` → [`npc-behavior-state-v0`](./npc-behavior-state-v0.md) →
> [`npc-movement-safety-contract-v0`](./npc-movement-safety-contract-v0.md) →
> [`npc-local-wander-v0`](./npc-local-wander-v0.md).
>
> Companion docs: [ARCHITECTURE](../ARCHITECTURE.md) · [BOUNDARIES](../BOUNDARIES.md) ·
> [CONVENTIONS](../CONVENTIONS.md) · [FAILURE-MODES](../FAILURE-MODES.md).
>
> Global stack invariants (apply to all four plans): NPC movement/animation is
> **presentation-only** unless a future ADR explicitly says otherwise. Never mutate
> `RoomSpec`/`LoadedRoom` positions. Never mutate `WorldState` per tick. Never append
> `WorldEvent`s for idle/wander steps. Never save/load NPC runtime positions. No
> provider/LLM calls. No memory writes. No quest/gate/objective authority. No dialogue
> text or memory text logging. Deterministic fake/test paths first.

---

## 1. Problem statement

NPCs (and every other room object) are statically posed meshes. A `buildHumanoid`
figure stands perfectly frozen from room entry until room exit, which reads as a
mannequin, not a character. The cheapest "alive" signal — a subtle idle bob/sway on
the NPC mesh — does not exist, and the renderer has no per-frame object-animation
hook at all: `Engine.renderLoop` (`renderer/engine/Engine.ts:161-170`) updates only
player movement, camera follow, and proximity.

## 2. Goals

- Renderer-only idle bob (small Y oscillation) on `npc`-type objects, so NPCs
  read as alive in both authored and generated rooms. **Bob-only for v0**: the
  yaw-sway math path exists but ships disabled (`IDLE_SWAY_AMPLITUDE_RAD = 0`);
  enabling it later is a constants-only change plus a fresh visual check.
- Deterministic phase per NPC derived from `room.id` + object `id` (fallback: object
  index), so two NPCs in one room don't bob in lockstep and the same room always
  animates identically.
- Bounded amplitude by construction — the offset math cannot exceed fixed
  constants for any input time — and **raise-only**: `bobY` stays in
  `[0, IDLE_BOB_AMPLITUDE]`, never below the spec base Y, so feet never clip
  below the floor and there is no symmetric sink/hover around the base.
- dt-driven through the existing `renderLoop` clock (`Engine.ts:163`), frame-rate
  independent, capped-dt safe (the existing `Math.min(dt, 0.1)` cap is upstream).
- Disposal-safe: all animation state dies with `Engine.dispose()`; no leaked
  references across room changes (the engine is recreated per room — see §5 facts).
- Pure, deterministic test path for phase derivation and offset math.

## 3. Non-goals

- No behavior states (`talking`/`wandering`) — that is `npc-behavior-state-v0`.
  In this v0, the idle animation runs unconditionally, including while a dialogue
  panel is open (the NPC keeps gently bobbing behind the panel; acceptable and
  arguably good). Intensity/pause hooks come in the next feature.
- No positional movement on X/Z — no wandering, no pathing, no facing-the-player.
- No skeletal/limb animation, no `AnimationMixer`, no clips, no GLTF, no assets.
- No animation of non-NPC types (`zombie` shamble is a possible later follow-up,
  explicitly out of scope here).
- No `RoomSpec`/schema/domain-contract change, no save/load change, no
  `WorldState`/event change, no provider/LLM/memory/quest change.
- No new dependency; no React/UI change; no `prefers-reduced-motion` handling in v0
  (flagged as a possible later accessibility follow-up).

## 4. Data/authority boundary

- **Presentation-only.** The animation mutates only the THREE node transforms the
  renderer already owns (`node.position.y`, optionally `node.rotation.y` around the
  spec-derived base). `LoadedRoom`/`RoomSpec` data is never written; the spec
  position stays the authoritative *home* value the animation oscillates around.
- **Interactables unaffected.** Proximity targeting (`Engine.updateProximity`,
  `Engine.ts:191-206`) reads `Interactable.position`, which this feature does not
  touch — the bob is vertical and the sway is rotational, so XZ targeting data
  stays exact.
- **No authoritative surface.** No `WorldSession`, `WorldCommand`, `WorldEvent`,
  `WorldState`, save blob, quest, gate, or objective code is imported or changed.
  Renderer layer keeps its lint walls (no React/world-session/memory imports).
- **Logging:** at most one count-only line (e.g. `idle animation registered`,
  `{ npcCount }`) via the existing injected `Logger`; likely zero new log lines.
  Never object names/ids beyond what `setRoom` already logs (room id, counts).

## 5. Current repo facts (verified against source)

- `Engine.renderLoop` (`renderer/engine/Engine.ts:161-170`) already computes a
  capped `dt` from `THREE.Clock` each frame — the natural update hook.
- `RoomViewer` (`renderer/RoomViewer.tsx:134-342`) **disposes and recreates the
  whole `Engine` when the room source changes**; `setRoom` is called once per
  engine lifetime. So "teardown on setRoom" for this stack means: initialize
  animation state in `setRoom`, release it in `dispose()` (`Engine.ts:218-242`),
  which `disposeObject(this.scene)` already complements for GPU resources.
- `buildObjects` (`renderer/engine/builders/index.ts:30-65`) builds each object
  node and adds it to a flat group named `'objects'`, but **does not tag nodes
  with their object id/type** — there is currently no way to find "the NPC nodes"
  after building. A minimal renderer-internal tagging hook is required.
- `buildNpc` (`builders/index.ts:216-222`) returns a `buildHumanoid` group whose
  base rests at local y=0; `applyTransform` (`builders/index.ts:358-362`) then sets
  the node to the spec position/rotation/scale. Base transform values are known at
  build time — the animator must capture them at registration and oscillate around
  them.
- The pure seeded PRNG lives in `generation/prng.ts`, but both `domain/**` and
  `renderer/**` are banned from importing `generation/**` — **banned by the
  BOUNDARIES dependency table and review-enforced, not mechanically
  lint-enforced** (`eslint.config.js` has no `**/generation/**` pattern in the
  domain/renderer blocks today). Precedent for a tiny pure local hash in the
  domain exists: FNV-1a `stableIndex` in `domain/ensureGeneratedNpcPresence.ts:275-282`.
- Engine tests do not construct a real Engine (no WebGL in vitest); they test pure
  helpers and use `Engine.prototype.setRoom.call(fakeEngine)` duck-typing
  (`Engine.test.ts:217-264`). Animation logic must therefore live in pure,
  separately-testable functions with a thin Engine wiring.

## 6. File-level change plan

**New files:**

- `apps/web/src/domain/stableHash.ts` — tiny pure FNV-1a string hash:
  `stableHash32(input: string): number` and `stableHash01(input: string): number`
  (in `[0, 1)`), mirroring the existing private `stableIndex` implementation.
  Shared by this feature (phase), the movement safety contract (step choice), and
  the wander motor (seed). Pure, dependency-free, allowed in domain and importable
  by the renderer (renderer → domain is ✓).
- `apps/web/src/domain/stableHash.test.ts` — determinism, distribution sanity,
  range.
- `apps/web/src/renderer/engine/animation/idleAnimation.ts` —
  - Constants (final proposal after review; still approval-gated):
    `IDLE_BOB_AMPLITUDE = 0.025` (m; conservative — anywhere in 0.02–0.025 is
    acceptable), `IDLE_BOB_FREQUENCY_HZ = 0.25` (breathing-like, ~15 cycles/min
    — deliberately calmer than a bounce), `IDLE_SWAY_AMPLITUDE_RAD = 0` (sway
    disabled for v0; the code path ships behind the constant),
    `IDLE_SWAY_FREQUENCY_HZ = 0.55` (inert while sway amplitude is 0).
  - `idlePhase(roomId: string, objectKey: string): number` → `stableHash01(...) * 2π`.
  - Pure `idleOffsets(phase: number, elapsedS: number): { bobY: number; swayRad: number }`
    — plain sines with a **raise-only bob shape**:
    `bobY = IDLE_BOB_AMPLITUDE * 0.5 * (1 + sin(…))`, so `bobY ∈
    [0, IDLE_BOB_AMPLITUDE]` and the node never dips below its base Y;
    `|swayRad| ≤ IDLE_SWAY_AMPLITUDE_RAD` (identically 0 in v0). Outputs
    bounded by the constants for any input time.
  - `class IdleAnimator` — `register(entry: { node: THREE.Object3D; phase: number;
    baseY: number; baseRotY: number })`, `update(dt: number)` (accumulates elapsed,
    applies offsets around the captured base values), `clear()`. Holds only node
    references and numbers; no I/O, no logger requirement.
- `apps/web/src/renderer/engine/animation/idleAnimation.test.ts`.

**Modified files:**

- `apps/web/src/renderer/engine/builders/index.ts` — in the `buildObjects` loop,
  tag each built node with renderer-internal metadata:
  `node.userData.objectType = obj.type` and `node.userData.objectId = obj.id`
  (when present). ~2 lines; no visual change; this is the enabling hook the whole
  NPC stack reuses (plan 4 needs it too).
- `apps/web/src/renderer/engine/Engine.ts` —
  - new private `idleAnimator = new IdleAnimator()`;
  - in `setRoom`: traverse the freshly built objects group's direct children,
    filter `userData.objectType === 'npc'`, and register each with
    `idlePhase(room.id, objectId ?? String(index))` and its captured base
    `position.y` / `rotation.y`;
  - in `renderLoop`: `this.idleAnimator.update(dt)` next to the existing movement
    update;
  - in `dispose`: `this.idleAnimator.clear()`.
  Roughly 8-10 lines of wiring; all math stays in the pure module.
- `apps/web/src/renderer/engine/Engine.test.ts` — extend the duck-typed
  fake-engine fixture (`Engine.prototype.setRoom.call(fakeEngine)`,
  `Engine.test.ts:217-264`) with the new `idleAnimator` field: constructor
  field initializers do not exist on the prototype-call fake, so `setRoom`'s
  registration would otherwise throw.
- `apps/web/src/renderer/engine/builders/objectRegistry.test.ts` (or a small new
  assertion in an existing builders test) — built NPC nodes carry the
  `userData.objectType`/`objectId` tags.

**Files NOT to touch:** `domain/roomSpec.ts` · `domain/loadRoomSpec.ts` ·
`domain/validateRoom.ts` · `domain/generatedRoomLayout.ts` · `domain/ports/**` ·
`world-session/**` · `interactions/**` · `encounters/**` · `dialogue/**` ·
`memory/**` · `persistence/**` · `server/**` · `generation/**` · `app/**` ·
`App.tsx` · `RoomViewer.tsx` · `renderer/ui/**` · save/load modules ·
`eslint.config.js` · `package.json`.

### Minimum Safe Change Check

- **Reused:** existing `renderLoop` dt clock · existing `buildObjects` loop (2-line
  tag) · existing dispose lifecycle (engine-per-room recreation) · FNV-1a hash
  shape already proven in `ensureGeneratedNpcPresence.ts`.
- **Minimum new code:** one pure hash module, one pure offsets module + small
  animator class, ~10 lines of Engine wiring, 2 lines of builder tagging.
- **Safety boundaries unchanged:** renderer imports only domain + Logger port
  (both already allowed) · no schema/save/`WorldState`/event/provider/memory
  change · no new log content beyond counts · trusted hand-written renderer only.
- **Targeted tests:** pure hash + offsets determinism/boundedness; animator
  register/update/clear on duck-typed nodes; builder tagging assertion.

## 7. Tests

1. `stableHash.test.ts` — same input → same output; different inputs diverge;
   `stableHash01` always in `[0, 1)`.
2. `idleAnimation.test.ts` —
   - `idlePhase` is deterministic and in `[0, 2π)`; two ids in the same room get
     different phases (spot-check known inputs).
   - `idleOffsets` bounded and raise-only: for a sweep of elapsed values
     (including huge ones), `0 ≤ bobY ≤ IDLE_BOB_AMPLITUDE` and
     `|swayRad| ≤ IDLE_SWAY_AMPLITUDE_RAD` (identically 0 while sway ships
     disabled).
   - `IdleAnimator.update` mutates a registered duck-typed node's `position.y`
     upward from `baseY` (never below `baseY`, never above
     `baseY + IDLE_BOB_AMPLITUDE`) and leaves `rotation.y` at `baseRotY` while
     the sway constant is 0; X/Z are untouched.
   - `clear()` drops all entries; `update` after `clear` mutates nothing.
   - dt accumulation: two `update(0.5)` calls equal one `update(1.0)` in elapsed
     terms (frame-rate independence).
3. Builders test — a built `npc` object node carries
   `userData.objectType === 'npc'` and its `objectId`; a `throne` node carries its
   own tags (proves the tag is generic, not NPC-special-cased).

No Engine construction in tests (no WebGL); Engine wiring is covered by the
existing prototype-call pattern only if cheap, otherwise left to manual smoke.

## 8. Manual smoke (dev, local run)

1. `npm.cmd run dev` from `apps/web`; load the authored demo room.
2. The NPC visibly, subtly rises and settles (raise-only bob at a calm,
   breathing-like cadence); motion is smooth and small — feet never sink below
   the floor and the lift never reads as hovering.
3. Generate a room via PromptBar; the generated NPC (ensured by
   `ensureGeneratedNpcPresence`) also idles; two NPCs (if present) are out of
   phase.
4. Reload the page: the same room animates with the same phase (determinism
   spot-check).
5. Open the NPC dialogue (F): panel opens; idle motion continuing behind the panel
   is expected in this v0.
6. Navigate to an adjacent room and back several times; no console errors, no
   visual residue, no growing memory in dev tools (engine recreation stays clean).
7. Save, load: NPC animates from its spec position as before (nothing persisted).

## 9. Risks

- **Sway fighting authored rotation.** Resolved for v0: sway ships disabled
  (`IDLE_SWAY_AMPLITUDE_RAD = 0`), so no yaw oscillation occurs. If a later
  slice enables it, re-check whether it reads as jitter against authored
  `rotationY` values before raising the constant.
- **Tag traversal fragility.** Filtering direct children of the objects group by
  `userData` is robust to ordering (unlike index-matching rings), but any future
  builder that nests groups must preserve the tag on the top-level node — noted in
  the builder comment.
- **Perceived motion during dialogue** (until `npc-behavior-state-v0` lands) —
  accepted, called out in §3.
- **Floating-point elapsed growth** over very long sessions: `Math.sin` of a large
  argument stays bounded, so no correctness risk; at most a slow precision drift
  in phase, invisible at these amplitudes.

## 10. Slice breakdown

Each slice independently shippable; do not merge slices.

- **Slice 1 — Docs (this file).** `docs: plan NPC idle animation v0`. No source.
- **Slice 2 — Pure foundations.** `feat(domain): stable hash helper` +
  `feat(renderer): idle animation math and animator (unwired)`.
  New: `domain/stableHash.ts` + test, `renderer/engine/animation/idleAnimation.ts`
  + test. No behavior change (nothing imports them yet).
- **Slice 3 — Builder tagging.** `feat(renderer): tag built object nodes with
  object id/type`. Modified: `builders/index.ts` + builders test. No visual or
  behavior change.
- **Slice 4 — Engine wiring + manual smoke.** `feat(renderer): wire NPC idle
  animation into the render loop`. Modified: `Engine.ts`, `Engine.test.ts`
  (extend the duck-typed fake with the new `idleAnimator` field). Run the §8
  checklist; update this plan's status.

## 11. Verification commands

```bash
# Slice 1: docs-only — no build/test run required (report as skipped).

# Slice 2
npm.cmd run test -- stableHash idleAnimation

# Slice 3
npm.cmd run test -- builders objectRegistry

# Slice 4 — regression
npm.cmd run test -- idleAnimation Engine
npm.cmd run lint
npx.cmd tsc --noEmit -p .
```

Run from `apps/web`. Targeted tests first per `AGENTS.md`.

## 12. Decisions needing maintainer approval

1. **`domain/stableHash.ts` as a new shared pure domain module** (recommended) vs.
   a private hash local to the renderer module (precedent:
   `ensureGeneratedNpcPresence.ts` keeps its own). The domain module is preferred
   because plans 3 and 4 need the same deterministic hash and neither may import
   `generation/prng.ts`.
2. Amplitude/frequency constants in §6 — final proposal after review:
   `IDLE_BOB_AMPLITUDE = 0.025` m (0.02–0.025 acceptable), **raise-only** shape
   (`bobY ∈ [0, amplitude]`, never below base Y), `IDLE_BOB_FREQUENCY_HZ =
   0.25` (breathing-like, not bouncy). Still approval-gated: approve or tune
   these exact numbers here.
3. Bob-only vs. bob+sway for v0 — **resolved by review: bob-only.** Sway ships
   behind `IDLE_SWAY_AMPLITUDE_RAD = 0`; enabling it later is a constants-only
   change plus a fresh visual check.
4. Whether `zombie` gets the idle treatment now or stays deferred (plan says
   deferred).
