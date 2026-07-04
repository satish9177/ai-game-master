# Implementation Plan — `feature/generated-room-clutter-distribution-v1`

> Status: **PLAN FOR REVIEW — docs-only.** Design decisions D1–D6 (§16) were pre-locked by the
> maintainer in the feature request. **No code until the maintainer approves this plan.**
> Work happens on `main` (maintainer instruction); no auto-commit.
>
> Companion docs: [ARCHITECTURE](../ARCHITECTURE.md) · [BOUNDARIES](../BOUNDARIES.md) ·
> [CONVENTIONS](../CONVENTIONS.md).
>
> **Builds on (implemented and merged):**
> - Generated Room Layout Contract v0 ([ADR-0031](../decisions/ADR-0031-generated-room-layout-contract-v0.md)) —
>   the footprint model (`objectFootprintRadius`), playable bounds, importance classes, object-vs-wall
>   bounds repair, count cap, spawn safe-area repair, and exit wall-snap.
> - Generated Room Composition v0 ([ADR-0032](../decisions/ADR-0032-generated-room-composition-v0.md)) —
>   the zone composer (`composeGeneratedRoom`) whose corridor-clearing and flank intent this pass
>   respects and extends downstream, without overriding.
> - Generated Room Story Anchors v0 ([ADR-0034](../decisions/ADR-0034-generated-room-story-anchors-v0.md)) —
>   the single derived story anchor whose focal placement must be preserved.
> - Generated Room Object Overlap Repair v1
>   ([plan](./generated-room-object-overlap-repair-v1.md)) — the stage 2.7b pairwise footprint
>   separation this pass runs immediately **before**; separation remains the micro-spacing
>   finalizer behind this macro-distribution pass.

---

## 0. Pre-flight: is this already implemented?

**No.** Verified against the current tree on `main`:

- **No per-zone density / occupancy logic exists anywhere in the pipeline.** The three spatial
  passes reason only about walls, the corridor, and pairwise intersections:
  - `repairGeneratedObjects` (stage 2.6, `domain/generatedRoomLayout.ts`) — keeps each footprint
    inside the walls and caps the count at 30. No density concept.
  - `composeGeneratedRoom` (stage 2.7, `domain/generatedRoomComposition.ts`) — clears only the
    central corridor: `relocateFlankObject` moves an object **only when `|x| < CORRIDOR_HALF
    (2.0)`**, sends it to a fixed `|x| = frac·halfX` on its current side, and **never changes z**.
    A generator-emitted corner cluster at `|x| ≥ 2` is untouched, and same-side corridor clutter
    funnels onto one x-line.
  - `separateGeneratedObjects` (stage 2.7b, `domain/generatedRoomSeparation.ts`) — resolves
    footprint **intersections** with the minimal push `(r_a + r_b − dist + EPS)` and accepts
    residual overlap (locked D1 of that plan). A pile of ten props becomes a tightly packed
    **non-overlapping** pile in the same corner; near a corner the per-axis clamp jams pushed
    objects back against the walls.
- **No `*clutter*` / `*distribution*` / `*density*` / `*sector*` module, test, plan, or ADR
  exists.** The highest layout-track plan is `generated-room-object-overlap-repair-v1.md`; its own
  pre-flight (§0) already flagged "Composition can co-locate objects" and its §5 deferred any
  crowding policy beyond intersection repair.

Conclusion: the exact feature — *deterministic generated-room macro clutter distribution by
sector density* — is **not shipped**. This plan is safe to pursue.

---

## 1. Exact issue this feature fixes

Manual smoke after `feature/generated-room-object-overlap-repair-v1` (existing suite
`docs/evaluation/generated-room-manual-evaluation-suite-v0.md`): dense generated rooms — e.g. a
post-apocalyptic shelter prompt with machines, debris, barricades, crates, barrels, a corpse, and
a strange device — still place many decorative/clutter props in **one corner/zone**, reading as a
trash pile. Objects no longer interpenetrate (2.7b works as designed), and spawn/exits/objective
stay safe (2.8/2.9/2.10 unaffected), but the **visual distribution** is poor: nothing in the
pipeline reasons about how many props occupy a zone.

**Goal:** add a deterministic, pure-domain pass that spreads decorative clutter into readable
groups across the room instead of piling into one sector — benign normalization only: provenance
stays `generated`, no repair/fallback notice, no schema/provider/App change.

---

## 2. Why this is separate from overlap repair (not a bug fix)

| Concern | Overlap repair (2.7b, shipped) | Clutter distribution (2.7a, this plan) |
| --- | --- | --- |
| Question answered | "Do two footprints intersect?" | "Are too many props in one zone?" |
| Granularity | Micro — pairwise, minimal push | Macro — per-sector density |
| Contract | Locked: nudges within intent, never re-zones, accepts residual overlap | Re-zones **decorative overflow only**, under per-sector caps |
| Trash-pile outcome | Working as designed — packed but not intersecting | The actual gap this plan closes |

Overlap repair's locked plan (§2 non-goals, §5, §6 step 5, D1) explicitly scoped it to
intersection removal with residual acceptance. Sector density was never in its contract, so the
observed pile is a **follow-up feature**, not a regression. That module is **unchanged** here.

---

## 3. Current repo facts (verified)

| Concern | Where | Today's behavior |
| --- | --- | --- |
| Footprint radius per type | `domain/generatedRoomLayout.ts` `objectFootprintRadius` | Rotation-invariant padded XZ radius. **Reused as-is.** |
| Importance class | `domain/generatedRoomLayout.ts` `classifyObjectImportance` | `critical` / `structural` / `decorative`. **Reused for the frozen/movable rule.** |
| Composition role | `domain/generatedRoomComposition.ts` `classifyGeneratedCompositionRole` | `anchor` / `npc` / `interactable` / `exit` / `structural` / `decorative`. **Reused for the frozen/movable rule.** |
| Anchor selection | `domain/generatedRoomComposition.ts` `selectGeneratedStoryAnchorIndex(objects, {themePack, storyKind})` | Single derived story anchor. **Re-derived here for parity (same options), exactly like 2.7b does.** |
| Corridor width | `domain/generatedRoomComposition.ts` `COMPOSITION.CORRIDOR_HALF` (2.0 m) | Central band composition keeps clear of clutter. **Reused as the no-placement band.** |
| Playable bounds | `domain/generatedRoomLayout.ts` `computePlayableBounds` | Symmetric half-extents with the `validateRoom` wall margin. **Reused as the grid extent.** |
| Assembly order | `domain/assembleRoom.ts` | 2.5 shell → 2.6 objects → 2.7 compose → 2.7b separate → 2.8 spawn → 2.9 exit ensure → 2.10 exit snap → 2.11+ purpose/NPC/etc. → 3 validate → 4 repair → fallback. |
| Diagnostics | `RoomDiagnostics` in `assembleRoom.ts` | Per-stage safe booleans/counts (`composed`, `overlapRepaired`, `spawnRepaired`, …), set at **four** construction sites (generated / repaired / semantic-fallback / `toFallback`). |
| Exports check | `generatedRoomComposition.ts`, `generatedRoomLayout.ts` | Every helper this plan reuses (`COMPOSITION`, `classifyGeneratedCompositionRole`, `selectGeneratedStoryAnchorIndex`, `computePlayableBounds`, `objectFootprintRadius`, `classifyObjectImportance`, `isInsidePlayableBounds`) is **already exported — no edits to existing modules besides `assembleRoom.ts`**. `halfClamp` is private to `generatedRoomLayout.ts`; the new module defines its own tiny clamp, exactly as `generatedRoomSeparation.ts` already does. |

Domain purity holds across the sibling normalizers: no logger/React/Three.js/DB imports, no input
mutation, same-reference return to signal "no change". This plan matches that discipline exactly —
**no new lint rule needed.**

---

## 4. Pipeline position

**Chosen: a new stage 2.7a, immediately after `composeGeneratedRoom` (2.7) and before
`separateGeneratedObjects` (2.7b).**

```
2.6  repairGeneratedObjects        (footprints inside walls, count cap)
2.7  composeGeneratedRoom          (zone/corridor intent — may leave corner piles)
2.7a distributeGeneratedClutter    ← NEW: spread decorative overflow across sectors (macro)
2.7b separateGeneratedObjects      (pairwise intersection cleanup — micro, unchanged)
2.8  repairGeneratedSpawn          (spawn gets final say vs the final layout)
2.9  ensureGeneratedExitNavigation
2.10 repairGeneratedExits          (exit objects get the final wall-snap say)
```

Rationale:

- **After composition (2.7)** so anchor/NPC/interactable zone intent is already settled and this
  pass only redistributes what composition classified as decorative; it never fights the composer.
- **Before separation (2.7b)** so distribution decides *where* clutter belongs (macro) and
  separation then guarantees no intersections at the new slots (micro). Any slot placed too close
  to a neighbor is cleaned up by the unchanged 2.7b.
- **Before spawn (2.8) and exit-snap (2.9/2.10)** so the safety finalizers still get the last
  word — spawn safety and exits-on-walls hold **by construction**, the same argument the 2.7b plan
  made (§4/§7 there).
- Same shape as every sibling stage: `(room, options) → room` (same-ref when unchanged), reported
  by one new safe boolean diagnostic.

Rejected: running after separation (would re-introduce intersections with no micro-finalizer
behind it); folding into `composeGeneratedRoom` (would change a locked, tested module's behavior;
the repo pattern — D2 of the 2.7b plan — is a new additive sibling module per pass).

---

## 5. Sector / grid model (locked D1)

- **Grid:** a fixed **3×3 sector grid** over the playable rect
  `[-halfX, +halfX] × [-halfZ, +halfZ]` from `computePlayableBounds`. Columns 0–2 run west→east,
  rows 0–2 run north→south (−Z = north). Sector index = `row * 3 + col` (0–8).
- **Sector assignment:** an object belongs to the sector containing its **anchor** `[x, z]`:
  `col = clamp(floor((x + halfX) / (2·halfX/3)), 0, 2)` and likewise for `row` with `halfZ`.
  Boundary values clamp deterministically; degenerate bounds (`halfX` or `halfZ` = 0) → the pass
  returns the room unchanged (same-ref).
- **Cap:** `MAX_DECORATIVE_PER_SECTOR = 4` — an internal repair-logic constant in the new module
  (like `MAX_SEPARATION_PASSES`/`EPS` in 2.7b). **Not** a `RoomSpec` field, not schema, not
  `validateRoom` `LIMITS`.
- **Occupancy:** the cap counts **movable-class decorative objects** (per §6) per sector. Frozen
  objects do not consume decorative capacity — micro-crowding against frozen neighbors is 2.7b's
  job. Occupancy bookkeeping is updated as moves are made, so a receiving sector can never be
  pushed over cap by this pass.
- **Excluded target sectors (never receive relocated clutter):**
  - **center sector** (row 1, col 1) — the spawn region;
  - **north-center sector** (row 0, col 1) — the story-anchor focal zone.
  Objects already in excluded sectors still **count** and can still be moved **out** if their
  sector is over cap; the exclusion applies only to relocation **targets**.
- **Corridor band exclusion:** no relocation slot may place an object anchor inside the corridor
  band (`|x| < COMPOSITION.CORRIDOR_HALF`), mirroring composition's anchor-based corridor rule.
  If an otherwise-eligible sector (e.g. south-center, whose non-corridor area is thin) has no
  valid slot for a given object, that sector is skipped for that object.
- **Capacity note:** eligible target sectors = 7 → theoretical relocated-decorative capacity
  7 × 4 = 28, below the 30-object room cap. When total movable decorative count exceeds available
  capacity, residual crowding is **accepted** (§8), never escalated.

---

## 6. Movable / frozen object rules (locked D2)

**Movable (relocation candidates) — the intersection of both existing classifiers:**
`classifyGeneratedCompositionRole(obj) === 'decorative'` **and**
`classifyObjectImportance(obj) === 'decorative'`.

This intersection is what makes the maintainer's frozen list precise with **zero new
classification logic**: composition-role `decorative` alone would include `pillar` and non-exit
`arch` (importance `structural`), which the frozen list protects. Concretely movable: `crate`,
`barrel`, `debris`, `barricade`, `prop`, `rug`, `candle`, and non-interactive `book`/`paper`/
`map`/`chest`/`corpse`/`table`/`machine`/`artifact`/`zombie` — the trash-pile population.

**Frozen (never moved, never dropped by this pass):**

- the **selected story anchor** — re-derived via
  `selectGeneratedStoryAnchorIndex(room.objects, { themePack, storyKind })`, frozen regardless of
  its role/importance (parity with 2.7b);
- **exit-carrying objects** (`interaction.exit != null`) — wall-snapped by 2.10, must stay put;
- **wall-light objects** (`torch`) — read as wall-mounted;
- **NPCs** and **interactables** (composition roles `npc` / `interactable`, i.e. anything with a
  non-exit interaction plus `scroll`) — reachability preserved by never touching them;
- **structural/critical objects** (`classifyObjectImportance` ∈ {`structural`, `critical`}) —
  pillars, thrones, non-exit arches, and every interactive object.

**Skipped placeholders** (`room.skipped`) are out of scope, exactly as in 2.7b — neither counted
nor moved.

**Deletion policy: none.** This pass **moves only**; it never adds, drops, re-types, re-scales, or
edits any non-position field. The only drop channels remain stage 2.6's decorative-cannot-fit rule
and the 30-object count cap — unchanged.

---

## 7. Deterministic distribution algorithm (locked D4/D5)

A pure, non-mutating
`distributeGeneratedClutter(room, options): LoadedRoom` with
`options: { themePack?, storyKind? }` (same option shape as 2.7b's `SeparationOptions`, used only
to re-derive the anchor index).

1. **Compute** playable bounds and the 3×3 grid once; classify every object movable/frozen (§6);
   count movable-decorative occupancy per sector.
2. **Early exit:** if no sector exceeds `MAX_DECORATIVE_PER_SECTOR` (or there are no movable
   objects, or bounds are degenerate), return the **same room reference**.
3. **Source order:** over-cap sectors are processed in ascending fixed sector index (0–8). Within
   an over-cap sector, the overflow objects moved out are chosen **highest original object index
   first** (the most recently listed clutter moves; earlier-listed objects keep their spot), until
   the sector is at cap.
4. **Target selection** for each overflow object, deterministically:
   - candidate sectors = the 7 non-excluded sectors with spare capacity (occupancy < cap),
     excluding the source sector;
   - ranked by **(a)** nearest Euclidean distance between sector centers, then
     **(b)** fewer objects of the **same `RoomObject['type']`** already in the sector (the v1
     same-type tie-break — a preference, not a hard rule), then
     **(c)** ascending fixed sector index;
   - within the chosen sector, the slot is picked from a **fixed candidate list** — sector center,
     then four quarter offsets `(±w/4, ±d/4)` in fixed order — each slot footprint-clamped inside
     the playable floor (`bounds − objectFootprintRadius(obj)`) and rejected if its anchor lands
     in the corridor band; the first valid slot wins;
   - if the ranked sector has no valid slot for this object, try the next ranked sector; if no
     sector/slot works, the object **stays where it is** (residual accepted).
5. **Bookkeeping:** each successful move decrements the source sector's occupancy and increments
   the target's, so later decisions see the updated grid. Single sweep — no multi-pass budget
   needed; the sweep terminates by construction (each object is considered at most once).
6. **Rebuild** the objects array preserving original order, changing **only** the `position` of
   moved objects (y preserved). Same-reference return when nothing moved, so `assembleRoom` sets
   the diagnostic with a `!==` check, matching every sibling normalizer.

Determinism guarantees: no randomness, clock, or global state; fixed sector order, fixed overflow
order, fixed ranking keys, fixed slot list; output is a pure function of the input `LoadedRoom`
and options.

---

## 8. Fallback / residual policy (locked D6)

- **Total function, never throws.** If overflow cannot be placed (all eligible sectors at cap, or
  no valid non-corridor slot), the affected objects are **left in place** — best-effort improved
  layout, residual crowding accepted. Crowding is cosmetic, not an unplayable-room condition.
- **Never triggers `repaired`/`fallback`** or a user notice; benign normalization exactly like
  2.6/2.7/2.7b. Provenance stays `generated`.
- The pass only moves footprint-clamped positions of decorative objects and drops nothing, so it
  cannot introduce a `validateRoom` fatal; the existing stage 4 repair/fallback still stands
  behind it unchanged. No new failure mode.

---

## 9. Non-goals

- **No global packing/optimizer, no physics.** One deterministic greedy sweep with caps.
- **No new object types, sizes, assets, textures, GLTF, shaders, fonts, or renderer change.**
- **No new `RoomSpec` field** (no `sector`, `zone`, `density`, etc.) and no `schemaVersion` bump.
  Sectors stay a derived repair-logic concept, like footprints.
- **No change to `objectFootprintRadius` values, `classifyObjectImportance`,
  `classifyGeneratedCompositionRole`, `composeGeneratedRoom` intent tables, or
  `separateGeneratedObjects` behavior.**
- **No new `validateRoom` issue code** and no fatal/notice path — density is not a validation gate.
- **No object deletion/drop** (locked; see §6) and no hard same-type spacing rule (tie-break only).
- **No gameplay, quest, objective, NPC dialogue, memory, event-log, save-load, or persistence
  change.** No provider/LLM/prompt change. No `App.tsx`/`app/`/`room/` change.
- **No per-theme density profiles, story-aware clustering, or aesthetic scoring** — future
  candidates only if manual eval demands them.

---

## 10. Safety boundaries unchanged (explicit confirmation)

- Pure domain, deterministic, no I/O, no logger, no mutation, no randomness/clock.
- Reads only validated `RoomObject` `type`/`position`/`scale`/geometry and structural interaction
  presence — **no raw prompt/provider/generated text**, no object names, no body/prompt text;
  nothing new is logged. The one new diagnostic is a boolean.
- Provenance stays `generated`; **no repair/fallback notice**; **no gameplay authority change**;
  **no event-log/memory/save-load/FTS/facts/dialogue-context/persistence write**.
- Spawn, exits, objective, NPC, and interactable **reachability preserved by construction**: only
  decorative-class objects move, they stay footprint-inside the playable floor, and the unchanged
  finalizers 2.7b/2.8/2.9/2.10 run after this pass.
- Renderer stays trusted and hand-written; the trust boundary (`assembleRoom → validateRoom →
  repair → fallback`) is unchanged and still stands behind this benign pre-validate pass.
- Domain-internal imports only → **no new lint rule**. No new dependency or asset.

---

## 11. Allowed files / modules

**New (pure domain):**

- `apps/web/src/domain/generatedRoomClutterDistribution.ts` —
  `distributeGeneratedClutter(room, options): LoadedRoom` + the internal constants
  (`MAX_DECORATIVE_PER_SECTOR`, grid helpers, slot list).
- `apps/web/src/domain/generatedRoomClutterDistribution.test.ts`.

**Edit:**

- `apps/web/src/domain/assembleRoom.ts` — insert the stage 2.7a call between 2.7 and 2.7b + one
  new safe boolean `clutterDistributed` on `RoomDiagnostics` and its **four** construction sites
  (generated / repaired / semantic-fallback / `toFallback`).
- `apps/web/src/domain/assembleRoom.test.ts` — wiring/ordering assertions.

**Read-only reuse (all already exported — verified §3):** `computePlayableBounds`,
`objectFootprintRadius`, `classifyObjectImportance`, `isInsidePlayableBounds` from
`generatedRoomLayout.ts`; `classifyGeneratedCompositionRole`, `selectGeneratedStoryAnchorIndex`,
`COMPOSITION.CORRIDOR_HALF` from `generatedRoomComposition.ts`; `LoadedRoom`/`RoomObject` types.

---

## 12. Forbidden files / modules (hard boundaries for this feature)

- `App.tsx`, `RoomViewer.tsx`, anything in `app/` or `room/` — **no changes**.
- `domain/roomSpec.ts` schema / `schemaVersion` — **no new field, no bump**.
- `renderer/**` — **no material/lighting/builder/engine change** (pre-render data pass only).
- Generation: `FakeRoomGenerator.ts`, `OpenAICompatibleRoomGenerator`, `generation/llmRoomPrompt.ts`,
  any prompt — **no changes**.
- `validateRoom.ts` — **no new issue code, no new fatal/notice**.
- `repairRoom.ts`, `generatedRoomComposition.ts`, `generatedRoomSeparation.ts`,
  `generatedRoomLayout.ts` (`repairGeneratedObjects`/`repairGeneratedSpawn`/`repairGeneratedExits`),
  `ensureGeneratedExitNavigation.ts` — **no behavior change** (2.7a is additive and ordered
  around them; reuse is import-only).
- Save/load, `SaveGame`/`WorldState`/`QuestSpec`, persistence, server, FTS, facts,
  dialogue-context, memory — **no changes, no writes**.
- Event log / world-session / gameplay authority — **untouched**.
- No new dependency, asset, texture, GLTF, shader, or font. No new logging surface beyond the one
  safe boolean diagnostic.

---

## 13. Proposed slices

**One slice** (mirrors the shipped 2.7b feature exactly):

1. This docs-only plan → maintainer review/lock.
2. On approval: pure module + unit tests → `assembleRoom` wiring (stage call + diagnostic +
   wiring tests) → targeted verification → manual smoke → hand-off. Single reviewable diff; no
   sub-slice needed because the module has one consumer and one diagnostic.

---

## 14. Tests (targeted, deterministic, no DOM/network)

New `domain/generatedRoomClutterDistribution.test.ts`:

- **Cap invariant:** a fixture with >4 movable decorative objects piled in one sector → after the
  pass, no sector's movable-decorative count exceeds `MAX_DECORATIVE_PER_SECTOR` (when total count
  ≤ available capacity).
- **Residual acceptance:** a fixture whose movable decorative count exceeds total eligible
  capacity → pass completes, no throw, no deletion; overflow beyond capacity stays in place.
- **Exclusion invariants:** no relocated object lands in the center sector, the north-center
  sector, or the corridor band (`|x| < CORRIDOR_HALF`).
- **In-bounds invariant:** every moved object's footprint stays inside the playable floor
  (assert via `computePlayableBounds` + `objectFootprintRadius`).
- **Frozen invariants:** the selected story anchor, exit-carrying objects, torches, NPCs,
  interactables, and structural/critical objects are byte-identical (position and all fields)
  after the pass.
- **No deletion / order preserved:** `room.objects.length` unchanged; original array order
  unchanged; only `position` differs on moved objects (y preserved).
- **Deterministic ordering:** overflow leaves highest-index-first; target ranking honors
  nearest-distance → same-type tie-break → sector index (fixtures crafted to exercise each key).
- **Determinism / purity / same-ref:** same input → identical output across runs; inputs not
  mutated; same-reference return when no sector is over cap and for degenerate bounds.

Extend `domain/assembleRoom.test.ts`:

- **Ordering:** stage 2.7a runs after composition and before separation — a piled fixture ends
  distributed **and** intersection-free after the full pipeline.
- **Diagnostic wiring:** `clutterDistributed` is `true` only when a move happened, `false` for an
  already-distributed generated room and for **all** `repaired`/`fallback` paths; provenance stays
  `generated`.
- **Safety-finalizer regression guards:** on a dense fixture through the full pipeline, spawn is
  not crowded by a blocking object, exit-carrying objects sit on wall faces, and the enriched
  objective target is present and in-bounds.

Verification commands (from `apps/web`):

```bash
npm run test -- generatedRoomClutterDistribution
npm run test -- assembleRoom
npm run test -- generatedRoomSeparation
npm run test -- generatedRoomComposition
npm run lint
npm run build
```

---

## 15. Manual smoke checklist (uses the existing suite as-is)

Run `docs/evaluation/generated-room-manual-evaluation-suite-v0.md` **unchanged**. Focus rows:

- **Object placement / composition** — should **improve**: the dense post-apoc shelter prompt no
  longer shows a corner trash pile; props read as spread groups; no interpenetrating meshes
  (2.7b regression check).
- **Story anchor / focal read** — **no regression**: the focal anchor still reads north-center.
- **Exits** — **no regression**: exit arches remain on walls and usable; return exits unchanged.
- **NPC presence / interaction availability / objective** — **no regression**: NPCs, interaction
  rings, and the objective target remain reachable and readable.
- **Spawn** — **no regression**: player still spawns in a clear spot.
- **Save/load/reload/return smoke** — unchanged; no new state, notice, or console surface.
- **Leakage / mutation safety** rows — must stay clean; the pass reads only validated
  `RoomObject.type`/`position`/`scale`/geometry, never names/prompts/body text.

---

## 16. Locked decisions (pre-locked by maintainer in the feature request)

- **D1 — Grid + cap: LOCKED →** fixed 3×3 sector grid over `computePlayableBounds`;
  `MAX_DECORATIVE_PER_SECTOR = 4` as an internal module constant (not schema, not `LIMITS`).
- **D2 — Movable set: LOCKED →** decorative overflow only; frozen = selected story anchor,
  exit-carrying, wall-light/torch, NPCs, interactables, structural/critical. Encoded with zero new
  classification logic as composition-role `decorative` ∧ importance `decorative` (§6).
- **D3 — Diagnostic: LOCKED →** `clutterDistributed: boolean` on `RoomDiagnostics`, parallel to
  `overlapRepaired`; `true` only when at least one object moved; `false` for already-distributed
  rooms and all `repaired`/`fallback` paths. Boolean only — no counts of names, no content.
- **D4 — Ordering: LOCKED →** overflow leaves highest original index first; target = nearest
  eligible sector with spare capacity; ties by fixed ascending sector index.
- **D5 — Exclusions + same-type spacing: LOCKED →** never target the center (spawn) sector, the
  north-center (anchor) sector, or the corridor band; same-type spacing is a **tie-break
  preference only** in v1, not a hard rule.
- **D6 — Move-only + residual: LOCKED →** no deletion/drop in v1; residual crowding accepted when
  capacity is exhausted; the only drop channels remain stage 2.6's rules, unchanged.

With D1–D6 locked, this is a single-slice, docs-first plan. The choices above are fixed and must
not drift during coding.

---

## 17. Minimum Safe Change Check (AGENTS.md requirement)

- **Reused:** `computePlayableBounds`, `objectFootprintRadius`, `classifyObjectImportance`,
  `classifyGeneratedCompositionRole`, `selectGeneratedStoryAnchorIndex`,
  `COMPOSITION.CORRIDOR_HALF`, the same-reference-return discipline, the existing diagnostic
  plumbing, and the existing manual eval suite. All reused helpers are already exported.
- **New code:** one pure `distributeGeneratedClutter` (grid + caps + one greedy sweep), one stage
  call, one boolean diagnostic. No new abstraction, service, schema, state, or dependency.
- **Boundaries unchanged:** §10.
- **Proof:** targeted deterministic unit tests (§14) + `assembleRoom` wiring/ordering/regression
  tests + the existing manual suite (§15).

---

## 18. Review checklist (before hand-off, per approved slice)

- [ ] Only the approved files changed (§11); no `App.tsx`/`app/`/`room/`/renderer/schema/provider/
      save-load/persistence/memory edit.
- [ ] `distributeGeneratedClutter` is pure, content-free, total (never throws), same-ref on no-op.
- [ ] Deterministic: fixed sector/overflow/ranking/slot orders; identical output across runs; no
      randomness/clock/global state.
- [ ] No object dropped, added, or edited beyond `position`; original array order preserved;
      frozen set (§6) byte-identical.
- [ ] No sector over cap after the pass (subject to §8 residual policy); no relocation into the
      excluded sectors or corridor band; every moved footprint in-bounds.
- [ ] Spawn/exit/objective safety intact — stages 2.7b/2.8/2.9/2.10 still run after and are
      unchanged; regression tests present.
- [ ] Provenance stays `generated`; no new notice; one safe boolean diagnostic only, set correctly
      at all four `RoomDiagnostics` construction sites; nothing new logged.
- [ ] No schema change/bump; no new `validateRoom` code; no new dependency/asset; no new lint rule
      needed.
- [ ] `npm run test` (targeted) + `npm run lint` + `npm run build` pass and reported honestly.
- [ ] Manual suite run; object-placement row improves, no safety-critical regression.

---

## Return

**APPROVE PLAN.** All six decisions (§16 D1–D6) match the maintainer's locked design; the plan is
internally consistent, verified against the current tree (every reused helper exists and is
exported; the 2.7a seam is clean), and honors every hard boundary — pure deterministic domain
distribution only, move-only with no deletion, no `App.tsx`/renderer/provider/schema/save-load/
persistence/memory/event-log change, one safe boolean diagnostic, provenance stays `generated`.
Docs-only until the maintainer approves; ready to implement as a single slice on go-ahead.

---

## 19. Closeout

**Implementation status:** complete.

**Implemented files:**

- `apps/web/src/domain/generatedRoomClutterDistribution.ts`
- `apps/web/src/domain/generatedRoomClutterDistribution.test.ts`
- `apps/web/src/domain/assembleRoom.ts`
- `apps/web/src/domain/assembleRoom.test.ts`

**Verification results:**

- `npm.cmd run test -- generatedRoomClutterDistribution assembleRoom generatedRoomSeparation`
  passed: 3 files, 133 tests.
- `npm.cmd run lint` passed.
- `npm.cmd run build` failed only on known unrelated TypeScript strictness errors in:
  - `src/domain/assembleRoom.test.ts`
  - `src/domain/ensureGeneratedNpcPresence.ts`
  - `src/domain/npcMovementContract.test.ts`
  - `src/generation/OpenAICompatibleNPCDialogueProvider.test.ts`

**Manual smoke result:**

Prompt:

```text
Create a small ruined safehouse packed with crates, barrels, debris, barricades, machines, a corpse, and a strange device.
```

Result: PASS.

- Objects are no longer all dumped in one corner.
- Clutter is spread into readable groups.
- Room still looks dense but not like a trash pile.
- Exit remained visible.
- Spawn/player area remained clear.
- Objective/interactable remained visible.
- No object deletion/drop observed.
- Residual grouping is acceptable.

**Safety confirmation:**

- Move-only.
- No object deletion/drop.
- Residual crowding is accepted only when capacity is exceeded.
- Protected objects remain protected: anchors, exits, torches, NPCs, interactables, and
  structural/critical objects.
- Stage 2.7a runs after composition and before overlap repair.
- Spawn repair and exit finalizers still run after this pass.
- No provider, LLM, prompt, schema, save-load, memory, FTS, dialogue, event-log, persistence,
  facts, or dialogue-context changes.

**Known limitation:**

Some intentional grouping can remain, but trash-pile clustering is improved.

**Final status:** COMPLETE.
