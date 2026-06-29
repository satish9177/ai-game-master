# ADR-0054: Generated Room Object State v0 — resolved-object presentation projection

- **Status:** Implemented
- **Date:** 2026-06-29
- **Deciders:** Project owner
- **Extends:**
  [ADR-0014](./ADR-0014-object-interactions-v0.md) (object interactions — `planInteraction`,
  `InteractionService`, `room-state-changed.flags` idempotency),
  [ADR-0036](./ADR-0036-generated-room-interaction-affordances-v0.md) (interaction affordances —
  `affordanceFor`, `AFFORDANCE_RING_COLOR`, `buildInteractableIndicator`),
  [ADR-0051](./ADR-0051-generated-objective-per-room-v0.md) (generated objective per room —
  objective targets carry `effect: { kind:'inspect' }` whose flag this projection reads).
- **Related:**
  [ADR-0037](./ADR-0037-generated-room-object-purpose-v0.md) (object purpose synthesis),
  [ADR-0048](./ADR-0048-generated-room-objective-target-enrichment-v0.md) (objective target
  enrichment),
  [ADR-0013](./ADR-0013-world-state-event-log-v0.md) (world-state / event-log authority)

> Full pre-code design in the implementation plan
> [`generated-room-object-state-v0`](../implementation-plans/generated-room-object-state-v0.md).

> Implemented in five slices: domain projection, `Interactable` view-model,
> renderer/HUD presentation, generated-play App/RoomViewer wiring, and docs
> closeout. The implementation remains a read-only presentation projection over
> existing `WorldState.roomStates[roomId].flags`; it adds no object-state store,
> schema field, event type, provider path, backend path, or persistence wiring.

---

## Context

Generated rooms can now be revisited via bidirectional return exits (ADR-0052). When a player
inspects or takes an object in generated room B, walks to room C, then returns to B, the object's
floor ring re-appears lit and the HUD verb re-appears active — as if the object were untouched.

This is a **presentation gap, not a persistence gap.** The authoritative session-local state
already persists correctly across A→B→C→B:

- `WorldState.roomStates[roomId].flags['interaction:<objectId>']` is set to `true` by
  `InteractionService` → `planInteraction` → `room-state-changed` event whenever a one-shot
  effect (`inspect`, `take-item`) resolves (ADR-0014, rule 2).
- A `move` event only sets `roomStates[roomId].visited`; it never clears `flags`.
- The single long-lived `worldSession` / `InMemoryWorldStore` spans the entire generated play,
  including every navigation between generated adjacent rooms.
- The existing authored throne-room coffer already demonstrates the pattern: after the player
  takes the coin, returning to the throne room shows the "coffer lies open and empty" body
  via `authoredPostUseInteractionBody` reading the flag.

What is missing is that `engine.setRoom(room)` rebuilds the scene from the validated `LoadedRoom`
alone. It does not receive the `WorldState` (engine ↔ world-session boundary — see BOUNDARIES.md).
The result: affordance rings always render at full brightness and the HUD always shows the active
verb on approach, even for objects whose interactions are already resolved.

This ADR closes the gap with a **pure, read-only projection** of existing `WorldState` flags into
room presentation, gated to generated rooms only.

---

## Decision

### Core rule

**Do not add a new object-state layer.** The flag store, key derivation, and write path are
unchanged from ADR-0014. v0 adds only a projection that reads them.

### Data flow (read-only, generation-gated)

```
WorldState.roomStates[roomId].flags       ← authoritative; already set by InteractionService
   │  (pure domain projection — no world-session reference in domain)
   ▼
resolvedObjectIds(room, roomState)        ← new pure function: ReadonlySet<string>
   │  (plain data; no engine/world-session object crosses the seam)
   ▼
App (composition root)                    ← computes at every generated room entry
   │  passes resolvedObjectIds to RoomViewer prop (generated play only)
   ▼
RoomViewer → engine.setRoom(room, { resolvedObjectIds })
   │  engine receives a Set<string> only; it never imports world-session
   ▼
buildObjects / buildInteractables         ← dims ring for resolved ids; marks Interactable resolved
   │
   ▼
HUD shows resolved verb chip on approach; DialoguePanel still opens (body still shown)
```

### Resolved detection rule

An object is resolved if:
- Its `id` is in `resolvedObjectIds`.
- `resolvedObjectIds` is derived by: for each object with a one-shot effect (`inspect` or
  `take-item`) that has a stable `id`, compute `interactionFlagKey(effect.flag, id)` and check
  whether that key is set in `roomState.flags`.
- `use-item` is **not** flag-gated (repeatable by design) and is never included.
- Objects with no `effect` (presentation-only interactions) are never included.
- `interactionFlagKey` is the existing private `oneShotFlag` from `planInteraction.ts`, exported
  under a stable name so the projection and the writer share the same derivation and cannot drift.

### Gating rule

`resolvedObjectIds` is computed and passed **only** for generated rooms in a generated play.
Authored/demo/restored paths pass `undefined` → `buildInteractables(room)` call is unchanged →
authored ring/HUD behavior is byte-identical to today.

### Presentation rules

1. **Affordance ring:** resolved objects get a **dimmed** version of their existing ring (lower
   opacity and emissive intensity — exact values TBD in implementation). The ring is not removed
   or hidden, so the object remains spatially discoverable.
2. **HUD verb chip:** the HUD shows a "resolved" treatment (e.g. greyed or struck-through verb)
   for the nearest resolved interactable. The full HUD prompt is still visible.
3. **DialoguePanel:** still opens on E/F; `InteractionService` still returns `already-resolved`;
   the existing "Already searched." result message still appears. No change to the panel.
4. **No live in-room ring update in v0.** The ring dims on room entry (at `setRoom` time) from
   the entry-time WorldState snapshot. If the player resolves an object and leaves/returns, the
   ring dims on the next entry. This is acceptable for v0.
5. **No mesh removal or hiding.** Taken objects remain visible as 3D objects. The ring dimming
   is the sole visual signal in v0.

### Authority rule

The projection is strictly read-only. It does not write to `WorldState`, `roomStates`, or any
flag. It does not create events or commands. It is never authoritative.

---

## Architectural rules (binding)

1. **Projection only.** `resolvedObjectIds` is a pure function: `(room, roomState) →
   ReadonlySet<string>`. No I/O, no logger, no React, no DB.
2. **Engine stays import-clean.** `engine.setRoom(room, opts?)` accepts `opts.resolvedObjectIds:
   ReadonlySet<string> | undefined`. The engine never imports `world-session`, `interactions`,
   or any application layer.
3. **No new event type, no new schema field, no new state store.** The authoritative substrate
   is unchanged.
4. **Gated to generated play.** Authored/demo behavior is byte-identical to today. The gate is
   checked at the App composition root, not in the domain or renderer.
5. **Safe diagnostics only.** Any new log line carries only counts, booleans, or stable codes —
   never object ids, flag keys, room names, object names, or generated text.
6. **`interactionFlagKey` is exported, not duplicated.** The projection calls the same function
   the planner uses; there is one key-derivation site.

---

## Scope (v0)

**In scope:**

- Export `interactionFlagKey` from `domain/interactions/planInteraction.ts`.
- New pure domain function `resolvedObjectIds(room, roomState)` + unit tests.
- Optional `resolved?: boolean` on `Interactable`; `buildInteractables(room, resolvedIds?)`
  + tests.
- `engine.setRoom(room, opts?)` and `buildObjects(..., resolvedIds?)` dim the ring for resolved
  objects.
- HUD resolved treatment for the active interactable.
- App computes `resolvedObjectIds` at every generated room entry (prompt, navigate, restore of
  generated play); passes it to `RoomViewer` only for generated plays.
- Small pure helper `resolvedObjectIdsForRoom(state, roomId)` (unit-testable) in the composition
  layer.

**Out of scope / non-goals (must NOT be built in this slice):**

- ❌ New `WorldState` event type, schema field, or store.
- ❌ Universal authored/demo projection (byte-identical to today is the goal).
- ❌ Rich per-object state enum (resolved/open/taken/etc.) — boolean is sufficient.
- ❌ Mesh removal or hiding of taken objects.
- ❌ Live in-room ring update when an object is resolved (entry-time snapshot is enough).
- ❌ Tracking no-effect generated inspects (presentation-only interactions have no flag).
- ❌ Provider, prompt, objective, or schema changes.
- ❌ Save/load wiring changes (flags already survive in `WorldState` snapshot).
- ❌ Inventory expansion.
- ❌ New ESLint/lint block (the projection is domain-pure; the engine receives a plain `Set`).

---

## Data model

No new schema. The only new types are:

**`resolvedObjectIds` (new — `domain/interactions/resolvedObjects.ts`)**

```ts
import type { LoadedRoom } from '../loadRoomSpec'
import type { RoomState } from '../world/worldState'
import { interactionFlagKey } from './planInteraction'

// Returns the set of object ids whose one-shot interaction is already resolved
// in the given room state. Pure, side-effect-free, no logger.
export function resolvedObjectIds(
  room: LoadedRoom,
  roomState: RoomState | undefined,
): ReadonlySet<string> { ... }
```

**`Interactable.resolved` (existing port — `domain/ports/interaction.ts`)**

Optional boolean added to the view-model. `buildInteractables(room, resolvedIds?)` sets it.

**`resolvedObjectIdsForRoom` (composition helper — `app/` or `App.tsx`)**

```ts
// Pure composition helper. Reads flags from the post-entry WorldState.
function resolvedObjectIdsForRoom(
  state: WorldState,
  roomId: string,
): ReadonlySet<string> { ... }
```

---

## Files likely to change

- **New:** `apps/web/src/domain/interactions/resolvedObjects.ts`,
  `apps/web/src/domain/interactions/resolvedObjects.test.ts`
- **Edited (domain):** `apps/web/src/domain/interactions/planInteraction.ts` (export
  `interactionFlagKey`), `apps/web/src/domain/ports/interaction.ts` (`resolved?` on `Interactable`;
  `buildInteractables` resolvedIds param)
- **Edited (renderer):** `apps/web/src/renderer/engine/Engine.ts` (`setRoom` opts),
  `apps/web/src/renderer/engine/builders/index.ts` (dim ring),
  `apps/web/src/renderer/ui/Hud.tsx` (resolved verb treatment)
- **Edited (composition):** `apps/web/src/App.tsx` (compute + pass `resolvedObjectIds`),
  `apps/web/src/renderer/RoomViewer.tsx` (new prop, forward to engine)
- **Docs:** `ARCHITECTURE.md` (planned → implemented note), this ADR.

## Files NOT to change

`domain/roomSpec.ts` · `domain/assembleRoom.ts` · `domain/validateRoom.ts` ·
`domain/repairRoom.ts` · `domain/generatedRoom*.ts` · `generation/**` · `interactions/**` ·
`encounters/**` · `dialogue/**` · `memory/**` · `persistence/**` · `server/**` ·
`world-session/**` · `eslint.config.js` · `package.json`

---

## Tests (Vitest, co-located, headless)

- **`resolvedObjects.test.ts`:** one-shot inspect with flag set → in the returned set; flag not
  set → not in set; take-item with flag set → in the set; use-item → never; no-effect object →
  never; flag key matches `interactionFlagKey` for `interaction:<id>` and explicit `effect.flag`;
  `undefined` roomState → empty set.
- **`interaction.test.ts` additions:** `buildInteractables(room, resolvedIds)` sets `resolved`
  correctly; omitted resolvedIds → all `resolved` absent (today's behavior).
- **`resolvedObjectIdsForRoom` (composition unit):** reads the right roomState flags; missing
  roomId → empty set; multiple rooms do not cross-contaminate.
- **Persistence across A→B→C→B (the headline test):** `InMemoryWorldStore` + `WorldSession` +
  `InteractionService` + `NavigationService`; resolve an inspect in B; `move` B→C→B;
  `getWorldState`; project → B's object still resolved; an unresolved object in B is not; no DOM.
- **Log-safety:** new log lines carry only counts/booleans — no flag keys, object names, or
  generated text.

---

## Failure modes

| Situation | Detection | Handling | Logging |
| --- | --- | --- | --- |
| `resolvedObjectIds` called with `undefined` roomState | missing `roomStates[roomId]` | return empty set; object renders as normal | none |
| Object has effect but no stable id | `id` absent | excluded from resolved set; renders normally | none |
| `use-item` object re-opened | effect.kind check | not in resolved set; repeatable as designed | none |
| Flag key derivation changes | shared `interactionFlagKey` export | impossible — one derivation site | n/a |
| Stale entry-time snapshot | only affects ring state at entry | player resolves object and sees dim ring only on next room entry | none |

---

## Consequences

- Resolved generated-room objects render with a dimmed ring and resolved HUD verb on re-entry,
  matching the state the player left them in.
- Objective-target objects resolved via the generated quest path show the same resolved treatment
  on return, consistent with the completed quest state.
- The existing authored/demo coffer behavior, interact-already-resolved panel message, and every
  other interaction path are byte-identical to today.
- The authoritative `WorldState` / event log / reducers are untouched.
- The renderer's import boundary is preserved; the engine receives a plain `ReadonlySet<string>`.
- No second source of truth is introduced; the projection diverges from reality only in the live
  in-room window (deferred live update — acceptable for v0).

## Alternatives considered

- **Add a new `GeneratedObjectStateStore`** — rejected: creates a second source of truth parallel
  to `WorldState.roomStates.flags`; violates BOUNDARIES.md and the "no new state store" rule.
- **Read `WorldState` inside the renderer** — rejected: the engine must not import
  `world-session`. The composition root already holds the post-move state and is the right
  projection site.
- **Add a new `RoomSpec` field or event type** — rejected: the existing flag substrate already
  encodes the information; a new field or event would expand the schema for no benefit.
- **Dim ring live when resolved in the same room** — deferred: requires the engine to receive
  an update message during the room session, which is a new imperative seam. Entry-time dimming
  meets the stated v0 goal (cross-room persistence) with no new seam.
- **Universal projection (authored + generated)** — rejected for v0: visibly changes authored
  demo behavior; the gate keeps authored paths byte-identical, consistent with every previous
  generated-room feature.
