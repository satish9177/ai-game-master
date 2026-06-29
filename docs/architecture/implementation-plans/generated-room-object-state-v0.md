# Implementation Plan — `feature/generated-room-object-state-v0`

> Status: **implemented.**
> Maintainer approved the design on 2026-06-29.
> Source slices 1-4 and docs closeout slice 5 are complete.
>
> **Depends on (implemented and merged):**
> - `feature/generated-room-bidirectional-links-v0`
>   ([ADR-0052](../decisions/ADR-0052-generated-room-bidirectional-links-v0.md)) — return exits
>   and A→B→C→B navigation must be stable before this feature is meaningful.
> - Object Interactions v0
>   ([ADR-0014](../decisions/ADR-0014-object-interactions-v0.md)) — `planInteraction`,
>   `InteractionService`, and `room-state-changed.flags` one-shot idempotency are the
>   persistence substrate this plan projects from.
>
> Companion docs: [ARCHITECTURE](../ARCHITECTURE.md) · [BOUNDARIES](../BOUNDARIES.md) ·
> [FAILURE-MODES](../FAILURE-MODES.md) · [CONVENTIONS](../CONVENTIONS.md) ·
> [ADR-0054](../decisions/ADR-0054-generated-room-object-state-v0.md).

---

## Goal

Make generated-room object interactions feel persistent when the player revisits a room: objects
already resolved (inspected/taken) should render with a dimmed floor ring and a resolved HUD verb
on re-entry, matching the state the player left them in.

The authoritative state already persists — `WorldState.roomStates[roomId].flags` survives
navigation across the entire generated play. The gap is presentation only: `engine.setRoom(room)`
currently has no knowledge of the WorldState. This plan adds a read-only projection from
existing flags into entry-time ring and HUD presentation, gated to generated rooms.

---

## Minimum Safe Change Check

**What existing code is reused:**
- `WorldState.roomStates[roomId].flags` — the authoritative one-shot flag store (ADR-0014).
  No new state store.
- The private `oneShotFlag` function in `planInteraction.ts` — exported under a stable name
  (`interactionFlagKey`) so the projection reuses the writer's key derivation.
- `buildInteractableIndicator` in `builders/index.ts` — already accepts a `color` param; dimming
  is a new opacity/emissive value path, not a new builder.
- `NavigationResult.state` — already in the `handleNavigate` closure; no extra `getWorldState`
  call needed.

**What new code is actually necessary:**
- `resolvedObjectIds(room, roomState)` — one pure function (~20 lines) in
  `domain/interactions/resolvedObjects.ts`.
- `resolvedObjectIdsForRoom(state, roomId)` — two-line composition helper in `App.tsx`
  (or a small file if it grows).
- Optional `resolved?: boolean` on `Interactable`; one-line change to `buildInteractables`.
- `engine.setRoom(room, opts?)` — an `opts?: { resolvedObjectIds?: ReadonlySet<string> }`
  parameter forwarded to `buildObjects`.
- A dimmed-ring branch in `buildObjects` for resolved ids.
- A resolved verb branch in `Hud.tsx` for the active interactable.
- App wiring: compute the set at generated entry, pass as `RoomViewer` prop.

**Safety boundaries unchanged:**
- `WorldState` / event log / reducers — no new event, no schema field.
- Engine import wall — engine receives `ReadonlySet<string>`, not a world-session reference.
- Generation / provider / assembleRoom / validateRoom / repairRoom — untouched.
- Authored/demo behavior — gate at App composition root; authored plays pass `undefined`.
- Logging — counts/booleans only; no flag keys, object names, or generated text.

**Targeted tests:**
- `resolvedObjects.test.ts` — pure domain; no DOM.
- `planInteraction.test.ts` additions — flag key export consistency.
- `interaction.test.ts` additions — `buildInteractables` resolved param.
- `App.test.ts` additions — `resolvedObjectIdsForRoom` helper.
- Headless A→B→C→B persistence test — `InMemoryWorldStore` + `WorldSession` + `InteractionService`
  + `NavigationService`; no DOM.

---

## 1. Current repo facts (verified)

- **`planInteraction.ts`** (`domain/interactions/planInteraction.ts`): the private helper
  `oneShotFlag(explicitFlag, ref)` returns `explicitFlag ?? (ref ? \`interaction:${ref}\` : undefined)`.
  This is the **sole source of truth** for flag key derivation. It must be exported, not
  duplicated. Export name: `interactionFlagKey`.
- **`WorldState.roomStates`** (`domain/world/worldState.ts`): `Record<string, { visited: boolean;
  flags?: Record<string, boolean> }>`. Already persists one-shot flags per roomId.
- **`InteractionService`** (`interactions/InteractionService.ts`): already sets
  `roomStates[currentRoomId].flags[interactionFlagKey]` via `planInteraction` + `appendEvent`.
  No change here.
- **`NavigationResult`** (`app/NavigationService.ts`): `{ status:'navigated', room, state, ... }`.
  The post-move `state` is already held in `handleNavigate`'s closure in `App.tsx`.
- **`buildInteractables(room)`** (`domain/ports/interaction.ts`): iterates `room.objects`,
  produces `Interactable[]`. Currently no `resolved` field.
- **`Interactable`** (`domain/ports/interaction.ts`): a neutral view-model. Adding
  `resolved?: boolean` does not change the renderer boundary.
- **`engine.setRoom(room)`** (`renderer/engine/Engine.ts:89`): calls `buildInteractables(room)`
  at line 106 and `buildObjects(room, logger)` via builders. Currently no opts param.
- **`buildObjects(room, logger)`** (`renderer/engine/builders/index.ts:30`): calls
  `buildInteractableIndicator(obj.position, ringColor)` for each object with an affordance.
  Already has the return-exit ring-color branch as a model for the resolved branch.
- **`buildInteractableIndicator`** (`renderer/engine/builders/index.ts:382`): accepts
  `(position, color)`. Dimming is done by passing different `opacity`/`emissiveIntensity` values
  to `buildGroundRing`.
- **`Hud.tsx`** (`renderer/ui/Hud.tsx`): receives `active: Interactable | null` and renders the
  affordance chip + prompt. No resolved treatment yet.
- **`App.tsx` `handleNavigate`**: already has `result.state` (the post-move WorldState) in scope
  after a successful navigation. The per-room objective memo uses a similar composition pattern.
- **`ActivePlay.objectivesPerRoom`**: the existing gate flag that restricts generated-objective
  logic to prompt-generated plays. The resolved-object gate will use the same
  `activePlay.objectivesPerRoom` flag (or an equivalent check on whether the play is generated).

---

## 2. Scope

### In scope (this plan)

1. **Domain export** — `interactionFlagKey` exported from `planInteraction.ts`.
2. **Domain projection** — `resolvedObjectIds(room, roomState)` in new
   `domain/interactions/resolvedObjects.ts` + tests.
3. **View-model extension** — optional `resolved?: boolean` on `Interactable`;
   `buildInteractables(room, resolvedIds?)` sets it + tests.
4. **Renderer** — `engine.setRoom(room, opts?)` and `buildObjects(..., resolvedIds?)` dim the
   ring for resolved objects; `Hud.tsx` resolved verb treatment.
5. **Composition** — `resolvedObjectIdsForRoom(state, roomId)` helper + App wiring for generated
   plays + `RoomViewer` prop + headless A→B→C→B test.
6. **Docs closeout** — ADR-0054 status flip, this plan status, ARCHITECTURE.md.

### Explicitly not in scope

See ADR-0054 "Out of scope" section.

---

## 3. Slices and commit plan

All commits leave `npm run build`, `npm run lint`, and `npm run test` (in `apps/web`) green.

### Slice 1 — Domain: export `interactionFlagKey` + pure projection — complete

**Files changed:**
- `apps/web/src/domain/interactions/planInteraction.ts` — rename `oneShotFlag` to
  `interactionFlagKey` (keep the private signature); export it.
- `apps/web/src/domain/interactions/resolvedObjects.ts` — new file (pure, ~25 lines).
- `apps/web/src/domain/interactions/resolvedObjects.test.ts` — new file.
- `apps/web/src/domain/interactions/planInteraction.test.ts` — add flag-key consistency test.

**No wiring change; no UI/renderer change.** Import cycle is safe: `resolvedObjects.ts` imports
`interactionFlagKey` from `planInteraction.ts` and `RoomState` from `domain/world/worldState.ts`
(domain→domain allowed; no renderer/React/platform import).

**Commit message:** `feat(domain): add resolvedObjectIds projection and export interactionFlagKey`

---

### Slice 2 — View-model: `Interactable.resolved` + `buildInteractables` resolvedIds param — complete

**Files changed:**
- `apps/web/src/domain/ports/interaction.ts` — add `resolved?: boolean` to `Interactable`;
  add `resolvedIds?: ReadonlySet<string>` param to `buildInteractables`; set
  `resolved: resolvedIds?.has(id)` for objects with a stable id.
- `apps/web/src/domain/ports/interaction.test.ts` (or co-located) — add tests for the new param.

**Engine not yet updated; this is data-only.** Existing callers of `buildInteractables(room)`
without the param see `resolved: undefined` everywhere — behavior unchanged.

**Commit message:** `feat(domain): add resolved field to Interactable view-model`

---

### Slice 3 — Renderer: dim ring + HUD resolved treatment — complete

**Files changed:**
- `apps/web/src/renderer/engine/Engine.ts` — `setRoom(room, opts?: { resolvedObjectIds?:
  ReadonlySet<string> })`. Forward to `buildInteractables(room, opts?.resolvedObjectIds)` and
  `buildObjects(room, logger, opts?.resolvedObjectIds)`.
- `apps/web/src/renderer/engine/builders/index.ts` — `buildObjects` gets `resolvedIds?` param;
  when `resolvedIds?.has(id)` is true for an object, call `buildInteractableIndicator` with a
  dimmed ring color/opacity (e.g. `RESOLVED_RING_OPACITY = 0.25`, `RESOLVED_RING_EMISSIVE = 0.1`)
  instead of the default affordance color.
- `apps/web/src/renderer/ui/Hud.tsx` — when `active.resolved === true`, render the affordance
  chip with a resolved style (e.g. `aria-label="Already resolved"`, dimmed chip).

**Note on dim ring values:** `buildInteractableIndicator` currently wraps `buildGroundRing` with
fixed opacity/emissive defaults. The resolved path passes lower values; the existing color
(from `AFFORDANCE_RING_COLOR`) is preserved so the type of object is still readable.

**Note on engine boundary:** `engine.setRoom` already accepts `LoadedRoom`; the new `opts`
param is additive. Existing callers (the authored play, `NavigationService` resolution in
`handleNavigate`) call `engine.setRoom(room)` with no opts → behavior unchanged.

Wait — the engine does **not** directly call `setRoom` from app code. Looking at `RoomViewer.tsx`,
the engine is used inside a `useEffect`, and `roomSource.getRoom()` provides the room. The
RoomViewer calls `engine.setRoom(result.room)` at line 264. The `resolvedObjectIds` therefore
needs to flow into `RoomViewer` as a prop so it can forward `{ resolvedObjectIds }` to
`engine.setRoom`.

**Commit message:** `feat(renderer): dim interactable ring and HUD verb for resolved objects`

---

### Slice 4 — Composition: App wiring + RoomViewer prop + integration test — complete

**Files changed:**
- `apps/web/src/renderer/RoomViewer.tsx` — add optional `resolvedObjectIds?: ReadonlySet<string>`
  prop; forward to `engine.setRoom(result.room, { resolvedObjectIds })` inside the
  `roomSource.getRoom()` callback.
- `apps/web/src/App.tsx` — add pure helper `resolvedObjectIdsForRoom(state, roomId)` (reads
  `state.roomStates[roomId]`, calls `resolvedObjectIds` from domain); compute and pass it to
  `RoomViewer` only when `activePlay.objectivesPerRoom === true` (i.e. generated play) at the
  three entry points:
  1. Prompt-generated first room (`startRoomSession` result).
  2. Navigation result (`handleNavigate` — uses `result.state`).
  3. Restore-of-generated-play (`handleLoad` — authored worlds pass `undefined`).
- `apps/web/src/App.test.ts` (or co-located) — unit test `resolvedObjectIdsForRoom` helper;
  headless A→B→C→B persistence test.

**Gate decision:** `activePlay.objectivesPerRoom === true` is already the per-room-objective gate
for generated plays. Reusing it keeps the generated-play detection in one place and avoids a new
flag. If a future plan needs a finer gate, that can be added then.

**RoomViewer prop propagation:** the `resolvedObjectIds` value is re-computed at each room entry
(because `roomSource` changes each time `setActivePlay` is called). React will re-render
`RoomViewer` with the new prop; the `useEffect` re-runs (it depends on `roomSource`), which
calls `engine.setRoom` with the fresh resolved ids for the new room.

**No stale-state risk:** the resolved set is derived from `result.state` (post-move or post-start
snapshot) before `setActivePlay` is called. There is no async gap between state read and ring
render.

**Commit message:** `feat(app): wire resolved object presentation for generated play rooms`

---

### Slice 5 — Docs closeout — complete

**Files changed:**
- `docs/architecture/decisions/ADR-0054-generated-room-object-state-v0.md` — status: implemented.
- `docs/architecture/implementation-plans/generated-room-object-state-v0.md` — status: implemented.
- `docs/architecture/ARCHITECTURE.md` — add to ✅ implemented list in status legend; add section
  body in the right doc position.

**Commit message:** `docs(architecture): record generated-room-object-state-v0`

---

## 4. Tests

### `resolvedObjects.test.ts`

```
resolvedObjectIds
  ✓ one-shot inspect, flag set → object id in returned set
  ✓ one-shot inspect, flag not set → not in set
  ✓ one-shot take-item, flag set → in set
  ✓ use-item → never in set (repeatable by design)
  ✓ object with no effect → never in set
  ✓ object with explicit effect.flag → uses that key not interaction:<id>
  ✓ undefined roomState → empty set returned
  ✓ object with no stable id → excluded (no flag key derivable)
  ✓ flag key matches interactionFlagKey('interaction:' + id) exactly
```

### `interaction.test.ts` additions

```
buildInteractables
  ✓ resolvedIds set with matching id → resolved: true
  ✓ resolvedIds set without matching id → resolved: false / undefined
  ✓ resolvedIds not passed → resolved absent (backward compat)
```

### `planInteraction.test.ts` additions

```
interactionFlagKey (exported)
  ✓ same result as the previously-private oneShotFlag for both explicit and derived forms
```

### `App.test.ts` / composition helpers

```
resolvedObjectIdsForRoom
  ✓ reads roomStates[roomId].flags correctly
  ✓ roomId missing from roomStates → empty set
  ✓ does not cross-contaminate flags from other roomIds
```

### Headless A→B→C→B persistence test

```
  Setup: InMemoryWorldStore + WorldSession + InteractionService + NavigationService
         with three rooms (B has an inspect-effect object with stable id)
  
  1. start session; current room = A
  2. navigate A → B; resolve inspect on object 'obj-1'
  3. navigate B → C
  4. navigate C → B
  5. getWorldState; project via resolvedObjectIdsForRoom(state, roomId_B)
  
  ✓ 'obj-1' is in the resolved set
  ✓ a different object 'obj-2' (no effect, or effect not triggered) is not in the set
  ✓ no DOM, no React, no WebGL
```

---

## 5. Verification commands

```bash
# from apps/web
npm run test -- resolvedObjects
npm run test -- planInteraction
npm run test -- interaction
npm run test -- App
npm run lint
npm run build
```

Final verification performed during slice implementation:

- Slice 1: `cmd /c npm run test -- resolvedObjects`; `cmd /c npm run test -- planInteraction`;
  `cmd /c npm run build`.
- Slice 2: `cmd /c npm run test -- objectIndicators`; `cmd /c npm run test -- interaction`;
  `cmd /c npm run test -- Engine`; `cmd /c npm run build`.
- Slice 3: `cmd /c npm run test -- Engine`; `cmd /c npm run test -- objectIndicators`;
  `cmd /c npm run test -- Hud`; `cmd /c npm run build`.
- Slice 4: `cmd /c npm run test -- RoomViewer`; `cmd /c npm run test -- App`;
  `cmd /c npm run test -- resolvedObjects`; `cmd /c npm run build`.
- Slice 5 docs closeout: `cmd /c npm run build`; `cmd /c git diff --check`.

---

## 6. Manual smoke expectations

These are expected behaviors for manual QA; they are not a claim that the smoke pass was run during
docs closeout.

- Generate a room via the PromptBar; inspect an object (E) → ring visible and lit, panel opens.
- Walk to an adjacent generated room, then return → the inspected object ring is dimmed; HUD verb
  shows resolved state on approach.
- Press E on the dimmed object → `DialoguePanel` opens; panel shows the existing already-resolved
  result message.
- A `take-item` object: take it → leave and return → ring is dimmed on re-entry.
- A `use-item` object (repeatable): use it; leave; return → ring is not dimmed by this feature.
- Authored throne-room demo: ring colors and HUD behavior remain visually unchanged.
- Deep A→B→C→D→C→B→A in a generated play: previously resolved one-shot objects in revisited rooms
  show resolved on each re-entry.
- Not included in v0: DB persistence changes, rich object-state enum, mesh removal/hiding, live
  in-room refresh, no-effect inspect tracking, or authored/demo resolved presentation.

---

## 7. Risks

| Risk | Mitigation |
| --- | --- |
| Flag-key drift (projection and writer diverge) | Single exported `interactionFlagKey`; one derivation site |
| Stale entry-time snapshot (object resolved live, ring stays lit until next entry) | Acceptable for v0; deferred live update |
| `resolvedIds` passed to authored rooms | Gate at App: `objectivesPerRoom === true` only; authored play passes `undefined` → no change |
| Engine import boundary violation | Engine receives `ReadonlySet<string>` only; no world-session reference |
| React prop propagation timing | `resolvedObjectIds` computed from `result.state` before `setActivePlay`; no async gap |
