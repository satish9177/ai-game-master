# Implementation Plan — `feature/bidirectional-generated-room-links-v0`

> Status: **implemented.**
> Maintainer approved the design on 2026-06-29.
> Implemented on 2026-06-29.
> The ADR for this slice is
> [ADR-0052](../decisions/ADR-0052-generated-room-bidirectional-links-v0.md)
> (Accepted — implemented).
>
> **Depends on (all implemented and merged):**
> `feature/generated-room-exit-navigation-v0`
> ([ADR-0041](../decisions/ADR-0041-generated-room-exit-navigation-v0.md)),
> `feature/adjacent-room-pregeneration-v0`
> ([ADR-0021](../decisions/ADR-0021-adjacent-room-pregeneration-v0.md)),
> `feature/multi-room-navigation-cache-v0`
> ([ADR-0016](../decisions/ADR-0016-multi-room-navigation-cache-v0.md)),
> `feature/generated-objective-per-room-v0`
> ([ADR-0051](../decisions/ADR-0051-generated-objective-per-room-v0.md)).
>
> Companion docs: [ARCHITECTURE](../ARCHITECTURE.md) · [BOUNDARIES](../BOUNDARIES.md) ·
> [FAILURE-MODES](../FAILURE-MODES.md) · [CONVENTIONS](../CONVENTIONS.md).

---

## Goal

Give every generated adjacent room a deterministic, data-only **return exit** back to the
room it was entered from, so the player can walk A → B → A (and deeper). The return link
is baked into the cached room before caching; backtracking is cache-hit based and never
regenerates a prior room. No schema, navigation-contract, world-state, renderer, provider,
or objective change.

---

## 1. Current repo facts (verified)

- **`ensureGeneratedExitNavigation`** (`domain/ensureGeneratedExitNavigation.ts`): pure
  helper run inside `assembleRoom`. Builds the forward exit `toRoomId` inline as
  `` `${room.id}:exit:${side}` `` and the arch object id via `uniqueExitId` as
  `` `${roomId}:generated-exit:${side}` `` with a numeric collision suffix. Exposes
  internal `positionForSide` / `rotationForSide` (not yet exported).
- **`AdjacentRoomPregenerator`** (`app/AdjacentRoomPregenerator.ts`): `resolveGenerated`
  assembles a room, then `normalize(roomId, room)` does
  `withRoomId(room, roomId)` (so `room.id === roomId === the navigation toRoomId`),
  re-validates, and on failure substitutes `withRoomId(fallbackRoom, roomId)`. The room is
  cached via `this.cache.set(roomId, room)` **after** normalize. `provenanceMap` already
  records provenance per `roomId`. `warmAdjacent` skips ids already in the cache or
  in-flight; it is provider-free and depth-1.
- **`normalize` is the single pre-cache seam** where `room.id` already equals the
  navigation id. This is the correct and only place to derive the parent from the id and
  apply the return exit.
- **`NavigationService`** (`app/NavigationService.ts`): resolve-before-append mover; on
  success returns `{ status:'navigated', room, state, cacheHit, provenance? }`. Its
  contract is **not** changed by this plan.
- **`handlePrompt`** (`App.tsx` ~435–478): builds the **generated-play**
  `AdjacentRoomPregenerator` with a `GeneratedRoomSource` factory carrying
  `{ themePack, enrichObjectiveTarget: true }`; caches room #1 directly via
  `generatedCache.set(result.room.id, result.room)` (so room #1 never passes through
  `resolveGenerated`). The module-scope `adjacentPregenerator` (authored/example world,
  `App.tsx` ~112) is separate.
- **`buildExitLookup`** (`app/exits.ts`): iterates all objects with `interaction.exit`, so
  a room with two exit arches (forward + return) yields two navigable exits; the renderer
  already shows an interactable ring per exit object. No renderer change is needed to show
  or use a second valid exit.
- **Per-room objective memo** (`App.tsx`, ADR-0051): on `handleNavigate`, a revisited
  `roomId` restores its objective synchronously from the memo. Revisiting A via a return
  exit therefore triggers the **existing** restore path; no objective code changes.

---

## 2. Scope

### Implemented by this plan

1. **Domain:** shared id-format helpers, geometry exports, and the pure
   `ensureGeneratedReturnExit` helper + tests.
2. **Pregenerator:** `ensureReturnExits` option + `normalize` wiring (parse → enrich →
   re-validate → degrade) + `returnExitEnsured` log boolean + tests.
3. **App composition:** enable `ensureReturnExits: true` on the generated-play
   pregenerator only + tests.
4. **Docs / status closeout.**

### Explicitly not implemented (deferred)

- Persistence of generated map links / return exits across save/load
  (`generated-quest-save-load-v0` family). Links are session-local in v0.
- Named or destination-aware return labels.
- Bidirectional links for authored/demo rooms.
- Door/exit animation; minimap; richer map topology.
- Any change to the objective pipeline, `NavigationService`/`RoomResolver` contracts,
  `RoomSpec` schema, `WorldState`/`WorldEvent`/`WorldCommand`/reducers, backend,
  persistence, save/load, or the renderer.

---

## 3. Minimum Safe Change Check

**Existing code reused:**
- `ensureGeneratedExitNavigation` arch/geometry pattern — `positionForSide` /
  `rotationForSide` exported and reused; the inline `toRoomId` format replaced by a shared
  builder (no behavior change).
- `AdjacentRoomPregenerator.normalize` / `withRoomId` / `cache.set` — the return exit lands
  in the existing pre-cache seam; cache, in-flight, and warming behavior unchanged.
- `validateRoom` — reused to re-validate the enriched room (degrade on failure).
- `buildExitLookup` / renderer ring / `RoomViewer` intent path — already handle a second
  exit object; unchanged.
- ADR-0051 per-room objective memo — the return move reuses the existing restore path; no
  objective code touched.

**New code (minimum):**
- `buildGeneratedExitTargetId(roomId, side)` + `parseGeneratedExitTargetId(id)` (shared
  format) and `opposite(side)`.
- Pure `ensureGeneratedReturnExit(room, parentRoomId, entrySide)` returning
  `{ room, returnExitEnsured }`.
- `ensureReturnExits?: boolean` constructor option on `AdjacentRoomPregenerator` (default
  `false`) and a ~6-line block inside `normalize`.
- One boolean (`returnExitEnsured`) on the existing resolve log.
- One-word change in `App.tsx` to enable the option on the generated-play pregenerator.

**Safety boundaries unchanged:**
- RoomSpec schema (no field added; existing exit/object shape reused).
- `NavigationService` / `RoomResolver` contracts.
- `WorldSession` event log / reducers / world state.
- Renderer trust boundary (no generated executable code; no new renderer import).
- Objective pipeline (untouched; memo restore is the existing path).
- Logging redaction (only a safe boolean + an already-logged structural id).
- Adjacent warming (provider-free, depth-1) and cache semantics.
- Authored/demo behavior (option off + structural gate).

**Targeted tests:**
- Domain: `ensureGeneratedReturnExit` placement/collision/idempotency/purity/validity;
  `parseGeneratedExitTargetId` cases; build∘parse round-trip.
- Pregenerator: enrichment on/off; cache-hit returns enriched room; parent not
  regenerated; degrade keeps base room; `returnExitEnsured` present in log context only.
- Navigation integration: A → B → A succeeds and B→A is a cache hit.

---

## 4. Implementation slices

Each slice is independently shippable and independently testable. Do not merge slices.

---

### Slice 1 — Domain helper, shared id format, geometry exports ✅ complete
`feat(domain): add ensureGeneratedReturnExit and shared generated-exit id format`

**Files changed:**
- `apps/web/src/domain/ensureGeneratedExitNavigation.ts`
  — extract/export `buildGeneratedExitTargetId(roomId, side)` and replace the inline
  `` `${room.id}:exit:${side}` ``; export `positionForSide` / `rotationForSide`. No
  behavior change to `ensureGeneratedExitNavigation` itself.
- `apps/web/src/domain/generatedReturnExit.ts` *(new)*
  — `parseGeneratedExitTargetId(id)`, `opposite(side)`, and the pure
  `ensureGeneratedReturnExit(room, parentRoomId, entrySide)`.
- `apps/web/src/domain/generatedReturnExit.test.ts` *(new)*
- `apps/web/src/domain/ensureGeneratedExitNavigation.test.ts`
  — only if needed to cover the exported builder (no behavior change expected).

**`ensureGeneratedReturnExit` contract:**
- Idempotent: if a usable exit to `parentRoomId` already exists, return the room unchanged
  with `returnExitEnsured: true`.
- Side: `opposite(entrySide)`; if occupied by an existing exit object, first free side from
  `['south','west','east','north']` minus occupied.
- Arch: existing `type:'arch'` shape; `interaction: { key:'E', prompt:'Return to previous
  room', exit: { toRoomId: parentRoomId } }`; geometry via shared `positionForSide` /
  `rotationForSide`; matching `shell.exits` entry added.
- Object id: `` `${room.id}:return-exit:${side}` `` with numeric collision suffix.
- Pure / non-mutating; returns a fresh room (never mutates inputs or the shared fallback).

**Verification:** `npm run test -- generatedReturnExit ensureGeneratedExitNavigation`,
`npm run lint`, `npm run build`

---

### Slice 2 — Pregenerator option and wiring ✅ complete
`feat(app): apply return-exit enrichment in AdjacentRoomPregenerator before caching`

**Files changed:**
- `apps/web/src/app/AdjacentRoomPregenerator.ts`
- `apps/web/src/app/AdjacentRoomPregenerator.test.ts`

**Changes:**
- Add `ensureReturnExits = false` constructor option (kept off by default).
- In `normalize` (after the existing base-room `validateRoom` success, before returning):
  ```text
  if (this.ensureReturnExits) {
    const parsed = parseGeneratedExitTargetId(roomId)
    if (parsed) {
      const enriched = ensureGeneratedReturnExit(base, parsed.parentId, parsed.side)
      if (enriched.returnExitEnsured && validateRoom(enriched.room).ok) {
        returnExitEnsured = true
        return enriched.room
      }
      // else keep base; returnExitEnsured stays false
    }
  }
  return base
  ```
- Thread `returnExitEnsured` into the existing `room resolved` log context (boolean only).
- The global-fallback path (base-room revalidation failure) is unchanged.

**Test additions:**
- Option on: `resolveGenerated('R1:exit:north')` caches a room containing a return exit
  with `toRoomId === 'R1'` on the side opposite the entry side; `returnExitEnsured: true`.
- Option off (default): no return exit added.
- Collision: forward exit on the would-be return side → return exit lands on a deterministic
  free side; no duplicate-side collision.
- Cache hit returns the enriched room (return exit still present).
- Degrade: forced enriched-room validation failure → base room cached, no return exit,
  `returnExitEnsured: false`.
- Repaired/fallback adjacent (mocked provenance): return exit added when validation passes;
  provenance unchanged.
- Structural gate: id without `:exit:<side>` suffix → no return exit even with option on.
- `returnExitEnsured` appears only in log context, never room/object names or text.

**Verification:** `npm run test -- AdjacentRoomPregenerator`, `npm run lint`, `npm run build`

---

### Slice 3 — App composition (enable for generated play only) ✅ complete
`feat(app): enable return exits on the generated-play pregenerator`

**Files changed:**
- `apps/web/src/App.tsx`
- `apps/web/src/App.test.tsx`

**Change:** pass `ensureReturnExits: true` to the `new AdjacentRoomPregenerator(...)`
constructed inside `handlePrompt` (the generated-play pregenerator). The module-scope
`adjacentPregenerator` (authored/example world) is **not** changed.

**Test additions:**
- Generated play: navigating A → B → A succeeds; B → A is a cache hit (no regeneration);
  on returning to A the per-room objective memo restores A's tracker (existing behavior).
- Authored/example play: no return exits added; navigation behavior unchanged.

**Verification:** `npm run test -- App NavigationService`, `npm run lint`, `npm run build`

---

### Slice 4 — Docs / status closeout ✅ complete
`docs: record generated room bidirectional links v0`

**Files changed:**
- `docs/architecture/decisions/ADR-0052-generated-room-bidirectional-links-v0.md`
  — flip status to `Accepted — implemented`; add implemented date.
- `docs/architecture/decisions/ADR-0041-generated-room-exit-navigation-v0.md`
  — cross-reference already added during the docs-only slice (non-goal superseded).
- `docs/architecture/ARCHITECTURE.md`
  — move this feature from 🔜 Planned to ✅ Implemented; add the implemented-list entry
  and a short ✅ section body.
- `AGENTS.md` (current implemented feature map)
  — add `generated-room bidirectional links v0`.
- `docs/architecture/FAILURE-MODES.md`
  — extend case 7 (adjacent pre-generation) with the return-exit degrade row (parse-miss or
  enriched-room revalidation failure ⇒ no return exit; room still playable; cache-hit
  backtracking).
- This implementation plan — flipped status to `implemented`.

**Verification:** `git diff --check` only.

---

## 5. Files touched

**Modified / new files:**

| File | Slice | Change summary |
|---|---|---|
| `apps/web/src/domain/ensureGeneratedExitNavigation.ts` | 1 | Export shared id builder + `positionForSide`/`rotationForSide`; use builder |
| `apps/web/src/domain/generatedReturnExit.ts` *(new)* | 1 | `parseGeneratedExitTargetId`, `opposite`, `ensureGeneratedReturnExit` |
| `apps/web/src/domain/generatedReturnExit.test.ts` *(new)* | 1 | Helper + parse + round-trip tests |
| `apps/web/src/domain/ensureGeneratedExitNavigation.test.ts` | 1 | Cover exported builder if needed |
| `apps/web/src/app/AdjacentRoomPregenerator.ts` | 2 | `ensureReturnExits` option; `normalize` wiring; log boolean |
| `apps/web/src/app/AdjacentRoomPregenerator.test.ts` | 2 | Enrichment / collision / cache-hit / degrade / gate tests |
| `apps/web/src/App.tsx` | 3 | Enable `ensureReturnExits: true` on the generated-play pregenerator |
| `apps/web/src/App.test.tsx` | 3 | A → B → A navigation + cache-hit + memo-restore tests |
| `docs/architecture/decisions/ADR-0052-*.md` | 4 | Status flip to implemented |
| `docs/architecture/decisions/ADR-0041-*.md` | (docs slice) | Non-goal cross-reference |
| `docs/architecture/ARCHITECTURE.md` | 4 | Status legend + new ✅ section |
| `AGENTS.md` | 4 | Feature map update |
| `docs/architecture/FAILURE-MODES.md` | 4 | Case 7 return-exit degrade row |
| `docs/architecture/implementation-plans/generated-room-bidirectional-links-v0.md` | 4 | Status flip |

---

## 6. Files NOT to touch

`domain/roomSpec.ts` (no schema field) · `domain/assembleRoom.ts` · `domain/validateRoom.ts`
(consumed unchanged) · `domain/repairRoom.ts` · `domain/generatedRoomComposition.ts` ·
the **core logic** of `ensureGeneratedExitNavigation` (export-only refactor) ·
`app/NavigationService.ts` · `app/exits.ts` · `app/exitGate.ts` · `app/gatedNavigation.ts` ·
`app/buildPromptGeneratedRoomSource.ts` · `room/GeneratedRoomSource.ts` ·
`room/SessionRoomCache.ts` · `room/RoomRegistry.ts` ·
all objective code (`domain/quests/**`, `domain/ports/ObjectiveGenerator.ts`,
`app/generatedObjective.ts`, `app/selectObjectiveGenerator.ts`,
`generation/FakeObjectiveGenerator.ts`, `generation/OpenAICompatibleObjectiveGenerator.ts`) ·
`generation/FakeRoomGenerator.ts` · `generation/OpenAICompatibleRoomGenerator.ts` ·
provider prompts · `world-session/**` · `interactions/**` · `encounters/**` ·
`dialogue/**` · `memory/**` · `persistence/**` · `server/**` ·
`renderer/engine/**` · `renderer/ui/**` · `eslint.config.js` · `package.json`.

No new `VITE_*` environment variable. No new lint block. No new dependency.

---

## 7. Test plan

### Mandatory new tests

**`generatedReturnExit.test.ts` (new):**
- Adds a return arch on `opposite(entrySide)` whose `interaction.exit.toRoomId === parentRoomId`.
- Avoids a side already used by an existing exit object (deterministic free-side fallback).
- Deterministic, collision-safe return-arch object id (`return-exit` namespace; suffix on collision).
- Idempotent: a usable exit to `parentRoomId` already present → room unchanged,
  `returnExitEnsured: true`.
- Pure / non-mutating: input room object identity unchanged; output is a fresh object.
- Enriched room passes `validateRoom`.
- `parseGeneratedExitTargetId`: all four sides; nested id → immediate parent; `null` for
  non-suffixed / garbage ids.
- Round-trip: `parse(build(roomId, side)) === { parentId: roomId, side }` for all sides and
  a nested id (format drift guard).

**`AdjacentRoomPregenerator.test.ts` additions:**
- Option on → generated adjacent cached with a return exit to the parent; `returnExitEnsured: true`.
- Option off → no return exit.
- Collision case → return exit on a deterministic free side.
- Cache hit → enriched room returned (return exit still present).
- Degrade (forced enriched revalidation failure) → base room cached; `returnExitEnsured: false`.
- Repaired/fallback adjacent → return exit added when valid; provenance unchanged.
- Structural gate (non-`:exit:` id) → no return exit even with option on.
- Parent not regenerated: warming/resolving the parent id is a cache-hit skip.
- `returnExitEnsured` only in log context; no names/text/JSON in logs.

**`App.test.tsx` additions:**
- Generated play: A → B → A navigation succeeds; B → A is a cache hit; A's objective memo
  restores on return (existing behavior preserved).
- Authored/example play: no return exits; navigation unchanged.

### Regression (must stay green, no change required)
- `ensureGeneratedExitNavigation.test.ts` — all cases (export-only refactor).
- `AdjacentRoomPregenerator.test.ts` — existing cases (option defaults off).
- `NavigationService.test.ts` — existing cases (contract unchanged).
- `exits.test.ts`, `exitGate.test.ts`, `gatedNavigation.test.ts` — unchanged.

### Log safety (all suites)
No test may assert the presence of room names, object names, generated JSON, interaction
text, provider bodies, or API keys in log output.

---

## 8. Manual smoke checklist

1. Prompt-generate room A. Walk to its forward exit, enter B.
2. In B, confirm a **second** interactable arch (cyan ring) on the wall opposite the
   forward arch.
3. Press `E` on the return arch → arrive back in A instantly (no regeneration flicker).
4. Confirm A's per-room objective tracker / NPC hint restores from the memo (existing behavior).
5. A → B → C → back to B → back to A all work; each backtrack is a cache hit.
6. Authored/demo world (no prompt): unchanged — no spurious return arches.
7. Logs: no room names, object names, interaction text, generated JSON, or API keys appear.

---

## 9. Known limitations (document, do not fix in this slice)

- **Session-local only.** Return exits / generated map links are not persisted across
  save/load in v0.
- **No named or destination-aware labels.** The return arch reads `Return to previous room`.
- **Generated forward-exit edges only.** A return exit is added only when the room id
  structurally encodes a parent (`parentId:exit:side`); other arrival paths get none.
- **Authored/demo rooms get no return exits** (by design).
- **No door animation, no minimap, no richer map topology.**
- **No objective, navigation-contract, world-state, renderer, or provider change** —
  out of scope for this slice.
