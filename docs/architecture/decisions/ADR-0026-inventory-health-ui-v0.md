# ADR-0026: Inventory & Health UI v0 — read-only player HUD projection

- **Status:** Accepted — **implemented** (Inventory & Health UI v0)
- **Date:** 2026-06-24
- **Deciders:** Project owner

## Context

`world-state-event-log-v0` ([ADR-0013](./ADR-0013-world-state-event-log-v0.md)) established
`WorldState` as the authoritative projection of the append-only `WorldEvent[]` log, carrying
`player.health` (`HealthSchema`, clamped `0..max`), `player.status: string[]`, and
`inventory: InventoryItem[]` as first-class validated schema fields.
`object-interactions-v0` ([ADR-0014](./ADR-0014-object-interactions-v0.md)) and
`encounter-system-v0` ([ADR-0015](./ADR-0015-encounter-system-v0.md)) are the only two paths
that mutate those fields; both already return the post-mutation `WorldState` in their
`applied`/`already-resolved` results, so no new read is needed to refresh the HUD.

Nothing about domain, events, reducers, schema, backend, or the renderer needed to change to
surface this state in the UI — the only gap was presentation. This slice closes that gap with a
**display-only player HUD**.

The defining property: **the HUD is a read-only projection of authoritative truth and can never
become truth.** The `WorldSession` event log + reducers remain the sole authority; the HUD has no
append path and invents no state. `isometric-camera-foundation` ([ADR-0012](./ADR-0012-isometric-camera-foundation.md))
and `npc-dialogue-foundation-v0` ([ADR-0017](./ADR-0017-npc-dialogue-foundation-v0.md)) are the
read-only/presentational-overlay precedents this slice follows.

v0 adds **no combat system, damage model, inventory economy, item actions (use/drop/equip),
equipment, status-effect engine, backend wiring, memory integration, LLM item generation, `RoomSpec`
changes, Three.js engine changes, or new dependencies**. Full design in the implementation plan
[`inventory-health-ui-v0`](../implementation-plans/inventory-health-ui-v0.md).

## Decision

Ship **Option A (display-only)**: a pure `projectPlayerHud` projection, a presentational `StatusHud`
React component, and minimal wiring in `App`/`RoomViewer` to seed, refresh, and render the HUD as
an App-level overlay — no domain/event/schema/renderer change of any kind.

```
session start (bootstrap OR prompt)
  └─ worldSession.startSession(...) → { ok:true, state }
       └─ App: setPlayerHud(projectPlayerHud(state))          ← seed

interaction / encounter resolve (inside RoomViewer)
  └─ result.status ∈ { applied, already-resolved } → result.state (fresh WorldState)
       └─ RoomViewer: onWorldStateChange(result.state)
            └─ App: setPlayerHud(projectPlayerHud(state))     ← refresh (no extra read)

navigation (moved-to-room)
  └─ does NOT change player fields → HUD persists unchanged (App-owned, no reset)

render
  └─ App: {playerHud && <StatusHud view={playerHud} />}       ← App-level overlay
```

### Projection (`renderer/ui/playerHud.ts`)

A pure, total, deterministic function — no I/O, no `Date.now`/`Math.random`, no input mutation.
Imports only `WorldState`/`InventoryItem` **types** from the domain; exports no
`WorldCommand`/`WorldEvent`-producing function.

- **`health.fraction`** = `max > 0 ? clamp01(current / max) : 0`. Used for bar width only; the
  exact `current` and `max` integers are always shown as text. The reducer already clamps
  `current` to `0..max`, so `0/max` (empty bar) and `current === max` (full bar) need no
  special cases.
- **`items`** maps `state.inventory` 1:1, preserving authoritative order, keyed by `itemId`.
- **`statuses`** is a fresh copy of `state.player.status`, order preserved.
- Returns fresh objects/arrays (no aliasing of the input `WorldState`); the input is never mutated.

### Component (`renderer/ui/StatusHud.tsx`)

Presentational React only — props in, DOM out. Imports the `PlayerHudView` type and React;
imports no `three`, engine internals, `world-session`, or services; holds no state beyond render.

- **Health:** `current / max` text plus a proportional bar (`width: fraction*100%`).
  `role="status"` + `aria-live="polite"` so changes are announced; `0/max` renders an empty bar
  gracefully without a special case.
- **Inventory:** a list keyed by `itemId` showing `name ×quantity`. Empty inventory → explicit
  **"No items"** empty state (never a missing or blank row).
- **Status:** small chips; the whole row is **omitted** when `statuses` is empty.
- **Placement:** top-left overlay, `pointer-events: none` (canvas drag/click passes through),
  reusing the existing dark translucent panel styling. Clear of the `PromptBar`/`notice` (top)
  and the interaction `.hud` (bottom-center).
- **Styles:** `.status-hud*` rules added to `index.css`, consistent with `.hud`/`.room-notice`.

### Wiring

- **`App`** holds `playerHud: PlayerHudView | null`. Seeds it from `result.state` at both
  session-start sites (authored bootstrap + prompt-generated). Resets to `null` alongside
  `setActivePlay(null)` when a new prompt starts (prevents stale state from flashing).
  Passes `onWorldStateChange={(state) => setPlayerHud(projectPlayerHud(state))}` to `RoomViewer`.
  Renders `<StatusHud view={playerHud} />` as an App-level overlay sibling of `RoomViewer`,
  so it survives `RoomViewer`'s navigation remount.
- **`RoomViewer`** gains a single optional `onWorldStateChange?: (state: WorldState) => void` prop,
  called only when an interaction or encounter resolve returns `applied` or `already-resolved`
  (the two variants that carry `state`). No other `RoomViewer` behavior changes.

### Boundaries

`renderer/ui/playerHud.ts` and `renderer/ui/StatusHud.tsx` sit under the existing
`renderer/ui/**` lint block: they may import `react` and domain **types**, and must not import
`three`/engine internals or `world-session`/services. Importing `WorldState`/`InventoryItem`
**types** from `domain/world/` is an allowed UI → Domain dependency — consistent with existing
UI components that already import `domain/ports/interaction` and `domain/dialogue/contracts`.
`App.tsx` and `RoomViewer.tsx` are the composition root and already import UI, services, and
domain; the new wiring uses only allowed directions. **No new lint block, no `eslint.config.js`
change, and no new layer** is introduced. No engine object ever enters the projection, the view,
or the component.

### Tests

Pure projection tests in `renderer/ui/playerHud.test.ts` (Vitest; co-located; no new deps):
- Health fraction math: `0/max`, partial (`75/100 → 0.75`), `max/max → 1`, `max ≤ 0 → 0`.
- `current`/`max` pass through as unrounded integers.
- Inventory mapping: empty → `items: []`; multiple items map 1:1 with authoritative order and
  correct quantities.
- Status copy: empty → `[]`; non-empty → order preserved, fresh array.
- Purity/no-mutation: input `WorldState` deep-equal before and after; returned arrays/objects
  are fresh (not the same references as the input).
- Structural read-only: `playerHud.ts` imports no `world-session`/service module and exports no
  function that returns a `WorldCommand`/`WorldEvent`.

No DOM/component tests and no App-wiring tests — the repo has no `jsdom`/`@testing-library/react`
and none were added. The component is kept trivially presentational so the projection tests cover
all logic; wiring is exercised manually via the running app.

### What was deliberately not changed

`domain/world/**` (no new event, reducer, or schema field) · `domain/roomSpec.ts` (no `RoomSpec`
change) · `world-session/**` · `interactions/**` · `encounters/**` (the HUD only consumes the
`WorldState` they already return) · `dialogue/**` · `memory/**` · `persistence/**` · `server/**`
· `renderer/engine/**` (no Three.js, camera, or layout-hook change; the HUD is a DOM overlay) ·
`eslint.config.js` (no new rule) · `package.json` (no new runtime or test dependency).

## Review nuance — health schema guarantee vs. defensive hiding

The implementation plan said missing health should be "hidden defensively if ever absent (no
throw)". The code relies on `WorldState` schema-guaranteeing `player.health` for any loaded
session (`HealthSchema` is a non-optional zod field validated at session start), so no defensive
hide was added. This is acceptable: `StatusHud` only renders after `App` has seeded `playerHud`
from a `WorldState` that has already passed schema validation — there is no code path where a
rendered HUD would encounter absent health. The "never throw" qualifier still holds structurally
because the HUD simply does not render until `playerHud !== null`.

## Consequences

- **Player state is now visible.** Health (bar + `current/max` label), inventory (item list),
  and status (chips) surface in the UI as a read-only HUD for the first time.
- **Authority unchanged.** `WorldSession` event log + reducers remain the sole truth source;
  the HUD is a render cache, never a second source of truth, and has no write path.
- **No domain footprint.** Zero new events, reducers, schema fields, or persisted state.
- **Survives navigation.** App-owned HUD state persists across `RoomViewer` remounts on room
  transitions; `moved-to-room` does not touch player fields, so no reset is needed.
- **Log-safe.** The projection is pure and silent; `StatusHud` is presentational. No new log
  lines were added to `App`/`RoomViewer`. Item names/ids, health values/deltas, and status
  strings are never logged — mirrors the ADR-0013/ADR-0014/ADR-0015 content-free log discipline.
- **Future-safe.** When real inventory economy, combat, or item actions are added, they write
  through the existing event/reducer path and the HUD auto-updates from the returned `WorldState`
  — no HUD change is required unless the view model needs to grow.
- **Not yet:** interactive inventory actions, item tooltips, health regeneration ticks, combat UI,
  a status-effect engine, a minimap, mobile/touch layout, save/load display, persistent memory
  integration, or LLM-sourced item/status display.
