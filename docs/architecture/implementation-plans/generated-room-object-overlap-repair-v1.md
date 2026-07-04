# Implementation Plan — `feature/generated-room-object-overlap-repair-v1`

> Status: **LOCKED — approved to implement.** Docs-only until coding begins. Open decisions
> D1–D4 resolved by the maintainer (see §16). No code until the implementation slice is started
> per this locked plan.
>
> Companion docs: [ARCHITECTURE](../ARCHITECTURE.md) · [BOUNDARIES](../BOUNDARIES.md) ·
> [CONVENTIONS](../CONVENTIONS.md).
>
> **Builds on (implemented and merged):**
> - Generated Room Layout Contract v0 ([ADR-0031](../decisions/ADR-0031-generated-room-layout-contract-v0.md)) —
>   the footprint model (`objectFootprintRadius`), object-vs-wall bounds repair, count cap,
>   spawn safe-area repair, and exit wall-snap this plan extends.
> - Generated Room Composition v0 ([ADR-0032](../decisions/ADR-0032-generated-room-composition-v0.md)) —
>   the zone composer (`composeGeneratedRoom`) whose per-zone placement this plan de-clutters
>   without overriding.
> - Generated Room Story Anchors v0 ([ADR-0034](../decisions/ADR-0034-generated-room-story-anchors-v0.md)) —
>   the single derived story anchor whose focal placement must be preserved.
> - Generated Room Theme Materials v1 (COMPLETE) — the immediately preceding visual-mood slice;
>   the Fable review that closed it flagged **object footprint overlap / clutter repair** as the
>   remaining real gap in generated-room layout safety.

---

## 0. Pre-flight: is this already implemented?

**No.** Verified against the current tree on `main` (and the fresh feature branch):

- **No object-to-object overlap/collision repair exists anywhere.** A tree-wide search for
  `overlap|intersect|collision|separat|declutter` finds only:
  - `isSpawnSafeAreaOverlap` / `object-crowds-spawn` — **spawn-vs-object** crowding, not
    object-vs-object (`domain/generatedRoomLayout.ts`, `domain/validateRoom.ts`).
  - "collision-safe id" helpers — string **id** uniqueness, unrelated to geometry.
  - A doc-comment in `repairRoom.ts` listing "collision" as a *future* concern; `repairRoom`
    itself only clamps spawn and truncates object/light budgets — it does **not** separate
    objects.
- **The footprint model exists but is only used against walls, never against other objects.**
  `objectFootprintRadius(obj)` (rotation-invariant padded XZ radius per type) and
  `classifyObjectImportance(obj)` already exist. `repairGeneratedObjects` (stage 2.6) uses the
  footprint to keep each object *inside the walls* and to cap the count, but performs **no
  pairwise separation** — two objects may occupy identical or overlapping footprints and it will
  not notice.
- **Composition can co-locate objects.** `composeGeneratedRoom` (stage 2.7) moves objects to
  zone targets computed **independently per object** (anchor → north-center `x=0`; NPC/interactable/
  clutter → `±frac·halfX` on the object's current side, `z` unchanged for flank moves). Two clutter
  props on the same side at similar `z`, or an anchor plus another north-center object, land on top
  of each other. Nothing in the pipeline pulls them apart afterward.
- **No ADR or plan** covers overlap/de-clutter. The highest ADR is 0074; the highest layout ADR
  is 0032 (composition). No `*overlap*` plan file exists.

Conclusion: the exact feature — *deterministic generated-room object footprint overlap repair* —
is **not shipped**. This plan is safe to pursue.

---

## 1. Goal

Add a **deterministic, pure-domain** generated-room repair pass that eliminates obvious object
**footprint intersections** so generated rooms avoid visibly clipping/stacked props, **while
preserving room intent, the story anchor, spawn safety, exits, NPCs, interactables, and all
existing layout/composition behavior**. Benign normalization only: provenance stays `generated`,
no repair/fallback notice, no schema/provider/App change.

---

## 2. Non-goals

- **No physically-perfect packing / no global optimizer.** Best-effort greedy separation with a
  bounded pass budget; residual overlap after the budget is accepted, not escalated.
- **No new object types, sizes, colors, assets, textures, GLTF, or renderer change.**
- **No new `RoomSpec` field** (no `footprint`, `radius`, `bbox`, `layer`, etc.). Footprints stay
  a derived repair-logic concept, exactly like today's wall-bounds repair.
- **No change to the footprint *values*** in `objectFootprintRadius` (reused verbatim) and no
  change to `classifyObjectImportance` semantics.
- **No new "overlap" semantic issue in `validateRoom`** and no fatal/notice path — overlap is
  cosmetic clutter, not an unplayable-room condition. (Tests assert absence, but the pipeline
  does not gate on it.)
- **No deletion of meaningful objects** beyond what stage 2.6's existing decorative-drop rule
  already permits; see §5 protected set.
- **No gameplay, quest, objective, NPC dialogue, memory, event-log, save-load, or persistence
  change.**

---

## 3. Current repo facts (verified)

| Concern | Where | Today's behavior |
| --- | --- | --- |
| Footprint radius per type | `domain/generatedRoomLayout.ts` `objectFootprintRadius` / `baseFootprint` | Rotation-invariant padded XZ radius (mirrors trusted builders). **Reused as-is.** |
| Importance class | `domain/generatedRoomLayout.ts` `classifyObjectImportance` | `critical` / `structural` / `decorative`. **Reused for drop/priority.** |
| Object-vs-wall bounds + count cap | `repairGeneratedObjects` (stage 2.6) | Clamps each footprint inside playable floor; drops unfittable decorative; caps at 30. **No pairwise check.** |
| Zone composition | `composeGeneratedRoom` (stage 2.7) | Places anchor north-center; flanks NPC/interactable/clutter to `±frac·halfX`. Per-object targets can collide. |
| Spawn safety | `repairGeneratedSpawn` (stage 2.8) | Clamps + nudges spawn away from blocking objects. Runs **after** composition. |
| Exit ensure + wall-snap | `ensureGeneratedExitNavigation` (2.9) / `repairGeneratedExits` (2.10) | Guarantees/relocates exit-carrying objects onto walls. |
| Playable bounds | `computePlayableBounds` | Symmetric half-extents using the `validateRoom` wall margin. |
| Assembly order | `domain/assembleRoom.ts` | 2.5 shell → 2.6 objects → 2.7 compose → 2.8 spawn → 2.9 exit ensure → 2.10 exit snap → 2.11+ purpose/NPC/etc. → 3 validate → 4 repair → fallback. |
| Diagnostics | `RoomDiagnostics` | Per-stage safe booleans/counts (`objectsRepaired`, `composed`, `spawnRepaired`, …). |

Domain purity holds: `generatedRoomLayout.ts` and `generatedRoomComposition.ts` import no
logger/React/Three.js/DB, never mutate inputs, and use the same-reference-return optimization to
signal "no change". This plan matches that discipline exactly — **no new lint rule needed.**

---

## 4. Where overlap repair fits in the pipeline

**Chosen: a new stage 2.7b, immediately after `composeGeneratedRoom` (2.7) and before
`repairGeneratedSpawn` (2.8).**

```
2.6 repairGeneratedObjects   (footprints inside walls, count cap)
2.7 composeGeneratedRoom     (zone targets — may co-locate)
2.7b separateGeneratedObjects  ← NEW: pull overlapping footprints apart, re-clamp to walls
2.8 repairGeneratedSpawn     (spawn gets final say vs the separated layout)
2.9 ensureGeneratedExitNavigation
2.10 repairGeneratedExits    (exit objects get the final wall-snap say)
```

Rationale:
- **After composition** so it corrects the co-location composition can introduce, and never
  fights the composer for zone intent (it nudges *within* intent, it does not re-zone).
- **Before spawn (2.8) and exit-snap (2.10)** so the two safety finalizers still get the last
  word: any object the separation pass moves near the spawn or off a wall is corrected by the
  existing, unchanged finalizers. This preserves spawn safety and exit-on-wall guarantees by
  construction — the new pass is deliberately *upstream* of them.
- Same shape as the other stage functions: `(room) → room` (same-ref when unchanged), reported
  by one new safe boolean diagnostic.

Rejected: running it *before* composition (composition would re-introduce overlaps) or *after*
exit-snap (would risk knocking exit objects off walls with no finalizer behind it).

---

## 5. Footprint / overlap model

- **Footprint = existing `objectFootprintRadius(obj)`**, treated as a rotation-invariant circle
  in the XZ plane centered on the object anchor. **Reused verbatim** — no new geometry, no new
  constants for object sizes.
- **Overlap test (pairwise):** objects `a`, `b` overlap when
  `hypot(ax−bx, az−bz) < r(a) + r(b) − EPS`, where `EPS = 0.01` (locked D4) is a tiny tolerance so
  touching footprints are not treated as overlapping. Circle-circle only (conservative, matches how
  the wall-bounds repair already treats footprints).
- **Which objects get footprints / participate:** every validated `RoomObject` in `room.objects`
  has a footprint via `objectFootprintRadius`. Participation rules:
  - **Exit-carrying objects** (`interaction.exit != null`) — **frozen**: they are wall-snapped by
    2.10 and must stay on their wall. They are treated as **fixed obstacles** (others separate
    away from them) but are **never moved** by this pass.
  - **Wall-light objects** (`torch`, per the existing `WALL_LIGHT_TYPES`) — **frozen** the same
    way: they read as wall-mounted; separating them into the floor would look wrong. Fixed
    obstacle, never moved.
  - **Skipped placeholders** (`room.skipped`) — **out of scope** for pairwise separation in v0
    (they already get an independent wall-bounds clamp in 2.6). Treated as neither obstacle nor
    movable. (Recorded as a known limitation; revisit only if manual eval shows marker stacking.)
  - All other objects are **movable participants**.

- **Protected from movement/deletion:**
  - The **selected story anchor** (from `selectGeneratedStoryAnchorIndex`, re-derived here for
    parity): may receive at most a **minimal** nudge that keeps it within its north-center focal
    zone; if it cannot be separated without leaving the focal zone, **other** objects move around
    it instead (anchor is treated as high-priority/near-fixed). Never dropped.
  - **Exit-carrying** and **wall-light** objects: never moved, never dropped (see above).
  - **`critical`** objects (NPC, scroll, interactive props/anchors — per
    `classifyObjectImportance`): never dropped by this pass; only moved.
  - **`structural`** objects (pillar/throne/torch/non-exit arch): moved, never dropped by this
    pass.
- **Deletion policy:** this pass **does not delete objects** in its own right. The only drop
  channel remains stage 2.6's existing decorative-cannot-fit rule and the count cap — unchanged.
  If separation genuinely cannot resolve an overlap within budget, the object is **left
  overlapping** (accepted residual), not deleted. (A future v2 could add opt-in decorative drop
  as a last resort; explicitly **out of scope** here to honor "do not delete important objects
  unless explicitly approved.")

---

## 6. Deterministic repair strategy

A pure, non-mutating `separateGeneratedObjects(room): LoadedRoom`.

1. **Compute** playable bounds (`computePlayableBounds`) and the footprint radius of every
   object once.
2. **Partition** objects into *fixed obstacles* (exit-carrying, wall-lights) and *movable*
   (everything else), and identify the anchor index.
3. **Deterministic processing order (the tie-breaker):** sort the movable set by a fixed key so
   the run is order-independent and stable —
   **(a) protection priority** `anchor > critical > structural > decorative`, then
   **(b) larger footprint first** (big props claim space before small clutter), then
   **(c) original object index** as the final stable tie-break.
   Higher-priority objects are placed first and treated as fixed once placed.
4. **Greedy placement:** iterate the sorted movable set. For each object, test it against all
   already-placed objects **and** all fixed obstacles. On overlap, push it along the
   **deterministic separation direction**: the normalized vector from the blocker's center to the
   object's center; **ties and exact-coincidence (zero vector) resolve to a fixed unit direction**
   (e.g. `+X`, then `+Z`) so identical inputs always yield identical output. Move by the minimal
   separation distance `(r_self + r_other − dist + EPS)`, then **re-clamp the object's footprint
   inside the playable floor** (`halfClamp` with `bounds − r_self`, reusing today's helper).
5. **Bounded passes:** repeat the sweep up to `MAX_SEPARATION_PASSES = 4` (locked D4).
   Stop early when a pass makes no move. Remaining overlaps after the budget are **accepted**
   (locked D1 — no deletion).
6. **Anchor handling:** the anchor is placed first (highest priority) at its composed position and
   thereafter treated as fixed; other objects yield to it, so the focal zone is preserved without
   the anchor being shoved out of the north-center.
7. **Same-reference return** when no object moved, so `assembleRoom` can set the diagnostic with a
   `!== ` check, matching every sibling normalizer.

Determinism guarantees: no randomness, clock, or global state; all directions/orders resolve to
fixed rules; output is a pure function of the input `LoadedRoom`.

---

## 7. Avoiding blocked exits, spawn, NPCs, and interactables

- **Exits:** exit-carrying objects are fixed obstacles here and re-snapped to walls by the
  **unchanged** stage 2.10 afterward → exits remain on walls and unobstructed by construction.
- **Spawn:** this pass runs **before** stage 2.8, which re-clamps and nudges spawn away from
  blocking objects against the final layout → spawn safety preserved by the existing finalizer.
  As belt-and-suspenders, the separation direction never *targets* the spawn point; it only
  resolves object-object overlap.
- **NPCs / interactables:** never dropped (critical class). They are moved only the minimal
  distance to clear overlap and are always re-clamped inside the playable floor, so they stay
  reachable. Composition already placed them in readable flanks; separation nudges within that
  neighborhood, it does not re-zone them.
- **Objective reachability:** the objective target is one of the (critical/interactable) objects;
  since it is never dropped and stays in-bounds, its reachability is preserved. Tests assert this
  explicitly (see §9).

---

## 8. Fallback / residual behavior

- **Total function, never throws** — like every other generated normalizer. If separation cannot
  resolve all overlaps within `MAX_SEPARATION_PASSES`, it returns the **best-effort improved
  layout** (fewer/less-severe overlaps) and the pipeline continues normally with provenance
  `generated`. Residual overlap is cosmetic and accepted.
- **Never triggers `repaired`/`fallback`** or a user notice; it is a benign normalization exactly
  like 2.6/2.7 (`objectsRepaired`/`composed`).
- If, hypothetically, the pass produced a room that failed `validateRoom` (it cannot — it only
  moves within bounds and drops nothing), the existing stage 4 repair/fallback still stands
  behind it unchanged. No new failure mode is introduced.

---

## 9. Tests (targeted, deterministic, no DOM/network)

New `domain/generatedRoomSeparation.test.ts` cases (own module per locked D2):

- **No-overlap invariant:** given fixture rooms with deliberately stacked/overlapping objects
  (same position; overlapping footprints; a cluster of clutter), after separation **no pair of
  movable objects overlaps** (or overlap count strictly decreases and is within the documented
  residual bound for over-crowded fixtures).
- **In-bounds invariant:** every object footprint stays inside the playable floor after
  separation (reuse `computePlayableBounds` + `objectFootprintRadius` in the assertion).
- **Anchor preserved:** the selected story anchor remains in its north-center focal zone
  (`z ≤ −ANCHOR_Z_THRESHOLD·halfZ`, `x` near 0 within tolerance); it is never dropped.
- **Exit/wall-light frozen:** exit-carrying and torch objects are byte-identical in position
  after the pass (they are fixed obstacles).
- **No deletion:** `room.objects.length` is unchanged by this pass (drops remain 2.6's job).
- **No blocked spawn (integration via `assembleRoom`):** a room whose composed layout crowds the
  spawn still yields a spawn not crowded by any blocking object after the full pipeline
  (stage 2.8 still owns this; the assertion guards the ordering).
- **Objective reachable:** the enriched objective target object is present and in-bounds after
  the full pipeline (add to `assembleRoom.test.ts`).
- **Determinism / purity:** same input → identical output across runs; input room and objects not
  mutated; same-reference return when nothing overlaps.
- **`assembleRoom` wiring:** the `overlapRepaired` diagnostic (locked D3) is `true` only when a
  move happened, `false` for already-clean and all fallback paths; provenance stays `generated`.

Commands: `npm run test -- generatedRoomLayout`, `npm run test -- generatedRoomComposition`,
`npm run test -- assembleRoom`, then `npm run lint` and `npm run build` before hand-off.

---

## 10. Manual evaluation checklist (uses the existing suite as-is)

Run `docs/evaluation/generated-room-manual-evaluation-suite-v0.md` **unchanged**. Focus rows:

- **Object placement / composition** row should **improve** (no visibly clipping/stacked props)
  on the fantasy and post-apoc scenarios; confirm dense rooms no longer show interpenetrating
  meshes.
- **Story anchor / focal read** — **no regression**: the focal anchor still reads north-center.
- **Exits** — **no regression**: exit arches remain on walls and usable.
- **NPC presence / interaction availability / objective** — **no regression**: NPCs, interactable
  rings, and the objective target remain reachable and readable.
- **Spawn** — **no regression**: player still spawns in a clear spot.
- **Save/load/reload/return smoke** — unchanged; no new state, notice, or console surface (repair
  is data-only, pre-validate).
- **Leakage / mutation safety** rows — must stay clean; the pass reads only validated
  `RoomObject.type`/`position`/`scale`/geometry, never names/prompts/body text.

---

## 11. Allowed files / modules

**New (pure domain, per locked D2):**
- `apps/web/src/domain/generatedRoomSeparation.ts` — `separateGeneratedObjects(room): LoadedRoom`
  (+ `apps/web/src/domain/generatedRoomSeparation.test.ts`). Imports the reused helpers from
  `generatedRoomLayout.ts` / `generatedRoomComposition.ts`; does **not** extend
  `generatedRoomLayout.ts`.

**Edit:**
- `apps/web/src/domain/assembleRoom.ts` — insert stage 2.7b call + one new safe diagnostic field
  on `RoomDiagnostics` and its every construction site (generated, repaired, both fallbacks).
- `apps/web/src/domain/assembleRoom.test.ts` — wiring/ordering/objective-reachability assertions.

**Read-only reuse:** `objectFootprintRadius`, `classifyObjectImportance`, `computePlayableBounds`,
`isInsidePlayableBounds`, `halfClamp`-equivalent clamp, `selectGeneratedStoryAnchorIndex`,
`domain/loadRoomSpec.ts`, `domain/roomSpec.ts`.

---

## 12. Forbidden files / modules (hard boundaries for this feature)

- `App.tsx`, `RoomViewer.tsx`, anything in `app/` or `room/` — **no changes**.
- `domain/roomSpec.ts` schema / `schemaVersion` — **no new field, no bump**.
- `renderer/**` — **no material/lighting/builder/engine change** (this is a pre-render data pass).
- Generation: `FakeRoomGenerator.ts`, `OpenAICompatibleRoomGenerator`, `generation/llmRoomPrompt.ts`,
  any prompt — **no changes**.
- `validateRoom.ts` — **no new issue code, no new fatal/notice** (overlap is not a validation gate).
- `repairRoom.ts`, `composeGeneratedRoom` intent tables, `repairGeneratedSpawn`,
  `repairGeneratedExits`, `ensureGeneratedExitNavigation` — **no behavior change** (2.7b is
  additive and ordered around them).
- Save/load, `SaveGame`/`WorldState`/`QuestSpec`, persistence, server, FTS, facts,
  dialogue-context, memory — **no changes, no writes**.
- Event log / world-session / gameplay authority — **untouched**.
- No new dependency, asset, texture, GLTF, shader, or font. No new logging surface beyond the one
  safe boolean diagnostic.

---

## 13. Safety boundaries unchanged (explicit confirmation)

- Pure domain, deterministic, no I/O, no logger, no mutation, no randomness/clock.
- Reads only validated `RoomObject` geometry/type — **no raw prompt/provider/generated text**,
  no object names, no body/prompt text; nothing new is logged.
- Provenance stays `generated`; **no repair/fallback notice**; **no gameplay authority change**;
  **no event-log/memory/save-load/persistence write**.
- Renderer stays trusted and hand-written; the trust boundary (`assembleRoom → validateRoom →
  repair → fallback`) is unchanged and still stands behind this benign pre-validate pass.
- Renderer→Domain and Domain-internal imports only → **no new lint rule**.

---

## 14. Minimum Safe Change Check (AGENTS.md requirement)

- **Reused:** `objectFootprintRadius`, `classifyObjectImportance`, `computePlayableBounds`, the
  bounds-clamp helper, `selectGeneratedStoryAnchorIndex`, the same-reference-return discipline,
  the existing diagnostic plumbing, and the existing manual eval suite.
- **New code:** one pure `separateGeneratedObjects` (greedy, bounded passes) + one stage call +
  one boolean diagnostic. No new abstraction, service, schema, state, or dependency.
- **Boundaries unchanged:** see §13.
- **Proof:** targeted deterministic unit tests (no-overlap, in-bounds, anchor/exit preserved, no
  deletion, purity) + `assembleRoom` wiring/ordering tests + the existing manual suite.

---

## 15. Review checklist (before hand-off, per approved slice)

- [ ] Only the approved files changed; no `App.tsx`/`app/`/`room/`/renderer/schema/provider/
      save-load edit.
- [ ] `separateGeneratedObjects` is pure, content-free, total (never throws), same-ref on no-op.
- [ ] Deterministic: fixed order + fixed tie-break directions; identical output across runs; no
      randomness/clock/global state.
- [ ] No object dropped by this pass; anchor/exit/wall-light/critical objects preserved per §5.
- [ ] Every object footprint in-bounds after the pass; overlaps removed or provably reduced within
      the residual bound.
- [ ] Spawn/exit safety intact — stage 2.8/2.10 still run after and are unchanged.
- [ ] Objective target present, in-bounds, reachable after the full pipeline.
- [ ] Provenance stays `generated`; no new notice; one safe boolean diagnostic only; nothing new
      logged.
- [ ] No schema change/bump; no new `validateRoom` code; no new dependency/asset.
- [ ] `npm run test` (targeted) + `npm run lint` + `npm run build` pass and reported honestly.
- [ ] Manual suite run; object-placement row improves, no safety-critical regression.

---

## 16. Resolved decisions (LOCKED by maintainer)

- **D1 — Residual overlap policy: LOCKED → accept residual overlap after bounded repair; no
  object deletion/drop in v1.** When a room is too crowded to fully resolve within
  `MAX_SEPARATION_PASSES`, `separateGeneratedObjects` returns the best-effort improved layout with
  the remaining (cosmetic) overlap accepted. This pass **never deletes or drops any object** — the
  only drop channel remains stage 2.6's existing decorative-cannot-fit rule and count cap, which
  are unchanged. (Governs §2, §5, §6 step 5, §8.)
- **D2 — File placement: LOCKED → new pure module `apps/web/src/domain/generatedRoomSeparation.ts`
  (+ `generatedRoomSeparation.test.ts`).** Do **not** extend `generatedRoomLayout.ts`. The new
  module imports the reused helpers (`objectFootprintRadius`, `classifyObjectImportance`,
  `computePlayableBounds`, the bounds-clamp helper) from `generatedRoomLayout.ts` and
  `selectGeneratedStoryAnchorIndex` from `generatedRoomComposition.ts`; it stays pure domain (no
  logger/React/Three.js/DB, no mutation, same-reference return) so **no new lint rule is needed**.
  (Governs §9, §11.)
- **D3 — Diagnostic name: LOCKED → `overlapRepaired: boolean` on `RoomDiagnostics`**, parallel to
  `objectsRepaired`/`spawnRepaired`. `true` only when at least one object moved; `false` for an
  already-clean generated room and for all `repaired`/`fallback` paths. (Governs §9, §11.)
- **D4 — Pass budget & tolerance constants: LOCKED → `MAX_SEPARATION_PASSES = 4`, `EPS = 0.01`.**
  Both are internal repair-logic constants defined in `generatedRoomSeparation.ts` — **not**
  `RoomSpec` fields, not schema, not `validateRoom` `LIMITS`. (Governs §5 overlap test, §6 steps
  4–5.)

With D1–D4 locked, this is a single-slice, docs-first plan. The choices above are fixed and must
not drift during coding.

---

## Return

**APPROVE PLAN.** All four open decisions (§16 D1–D4) are resolved and locked; the plan is
complete, internally consistent, and honors every hard boundary — pure domain overlap repair only,
no deletion in v1, no `App.tsx`/renderer/provider/schema/save-load/persistence/memory/event-log
change, deterministic trusted repair, one safe boolean diagnostic, provenance stays `generated`.
Ready to implement as a single slice on maintainer go-ahead.
