# Implementation Plan — `feature/inventory-health-ui-v0`

> Status: **implemented / closed.** All three slices are complete under
> `feature/inventory-health-ui-v0`. Source (slices 1–2: `renderer/ui/playerHud.ts`,
> `playerHud.test.ts`, `renderer/ui/StatusHud.tsx`, `index.css`, `App.tsx`,
> `RoomViewer.tsx`) and docs closeout (slice 3: **ADR-0026**, `ARCHITECTURE.md`,
> `FAILURE-MODES.md`, `AGENTS.md`) are merged. `BOUNDARIES.md` was not changed — no
> boundary rule changed. Commits are made manually by the maintainer; agents do not
> commit.
>
> Companion docs: [ARCHITECTURE](../ARCHITECTURE.md) · [BOUNDARIES](../BOUNDARIES.md) ·
> [FAILURE-MODES](../FAILURE-MODES.md) · [CONVENTIONS](../CONVENTIONS.md). Roadmap
> context and direct precedent:
> `world-state-event-log-v0` ([ADR-0013](../decisions/ADR-0013-world-state-event-log-v0.md))
> defines the authoritative health/inventory/status model this UI displays;
> `object-interactions-v0` ([ADR-0014](../decisions/ADR-0014-object-interactions-v0.md))
> and `encounter-system-v0` ([ADR-0015](../decisions/ADR-0015-encounter-system-v0.md))
> are the only paths that mutate player state and already return the post-mutation
> `WorldState`; `isometric-camera-foundation` ([ADR-0012](../decisions/ADR-0012-isometric-camera-foundation.md))
> and `npc-dialogue-foundation-v0` ([ADR-0017](../decisions/ADR-0017-npc-dialogue-foundation-v0.md))
> are the read-only / presentational-overlay precedents.

## Goal

Add a **read-only player HUD** that displays the player's **health, inventory, and
status** using the **existing authoritative `WorldState`**. Nothing about the domain,
events, reducers, schema, backend, persistence, or renderer changes — this slice is
**display only**.

The defining property: **the UI is a read-only projection of authoritative truth and
can never become truth.** The `WorldSession` current snapshot + append-only
`WorldEvent[]` + reducers stay the sole authority. The HUD invents no health,
inventory, or item state; it never writes back; it has no append path. LLM text,
generated rooms, memory, dialogue, and summaries are not truth and are not displayed by
this HUD.

This is the first time player state surfaces in the UI. The health/inventory/status
model, the mutating events, the reducers, the read path, and the service results that
already carry fresh `WorldState` **all exist today** — the only gap is presentation, so
the work is small, deterministic, and additive.

> **Naming note (wording risk, called out deliberately):** "inventory-health-**ui**"
> names a *display surface*, not a system. v0 adds **no** combat, **no** damage model,
> **no** inventory capacity/economy, **no** equipment, and **no** item actions
> (use/drop/equip). "HUD" here is non-interactive read-only chrome. See §5 (non-goals)
> and the wording-risk summary in the final report.

---

## 1. Current relevant flow

**Authoritative player state already exists** (`domain/world/worldState.ts`).
`WorldState` carries everything this HUD needs, all zod-validated and `.strict()`:

- `player.health: { current: number; max: number }` (`HealthSchema`; `current` clamped
  `0..max` by the reducer).
- `player.status: string[]` (de-duped set).
- top-level `inventory: InventoryItem[]` where `InventoryItem = { itemId: string; name:
  string; quantity: number }` (`itemId` unique, `quantity ≥ 1`).

**Reducers and events** (`domain/world/applyEvent.ts`, `domain/world/events.ts`). The
events that change displayed fields are `item-added` / `item-removed` (inventory),
`health-changed` (health, clamped), and `status-changed` (status add/clear).
`moved-to-room` and `room-state-changed` do **not** touch player health/inventory/
status. `session-started` seeds the initial values. **This slice adds no event and
changes no reducer.**

**Player-state mutations already return fresh `WorldState`.** The only two paths that
mutate displayed fields are:

- `InteractionService.resolve(...)` → `InteractionResult`; the `applied` and
  `already-resolved` variants **carry `state: WorldState`** (`interactions/InteractionService.ts`).
  v0 vocabulary affecting player state: `take-item` (→ `item-added`) and `use-item`
  (→ `item-removed` + optional `health-changed`).
- `EncounterService.resolve(...)` → `EncounterResult`; `applied` / `already-resolved`
  **also carry `state: WorldState`** (`encounters/EncounterService.ts`). Effect atoms:
  `damage`/`heal` (→ `health-changed`), `add-status`/`clear-status` (→ `status-changed`),
  `add-item`/`remove-item`. Health may clamp to `0` with **no death/game-over** state.

Both resolvers are invoked **inside `RoomViewer`**, so RoomViewer already holds the
fresh post-mutation `WorldState` in hand — no extra read is required to refresh the HUD.

**Read path + session-start state.** `WorldSession.getWorldState(sessionId)` returns the
current snapshot, and `WorldSession.startSession(...)` returns the initial `WorldState`
in `result.state` (`world-session/WorldSession.ts`). `App` owns the singleton
`worldSession` and already has the start state at both session-start sites.

**App / RoomViewer / overlay flow** (`App.tsx`, `renderer/RoomViewer.tsx`,
`renderer/ui/`). `App` is the composition root: it owns `worldSession`, the services,
and `activePlay { roomSource, sessionId, roomCache, navigation, worldBible }`, and it
already renders **App-level overlays as siblings of `RoomViewer`** (the dismissable
`notice` and the `PromptBar`). `RoomViewer` is the React↔engine seam; it renders the
existing bottom-center `<Hud>` (the interaction prompt) and the panels, and it does
**not** currently read or display `WorldState`.

Facts this plan relies on:

- `InteractionResult` / `EncounterResult` `applied` and `already-resolved` variants
  carry `state: WorldState` (verified in the service sources), so a HUD refresh needs no
  new read on those paths.
- `WorldState` always carries a valid `player.health`/`player.status`/`inventory` for a
  loaded session (schema-enforced), so the HUD never has to invent or repair fields.
- `App` does **not** remount on navigation, but **`RoomViewer` does**: its main
  `useEffect` depends on `roomSource`, and `handleNavigate` builds a **new**
  `roomSource`, so the engine tears down/rebuilds and all `RoomViewer` local state
  resets. ⇒ **HUD state must live in `App`** to survive transitions.
- `moved-to-room` does not change player fields, so navigation needs no HUD refresh; the
  HUD persists across rooms unchanged.
- The existing overlays prove the App-level overlay pattern and the CSS conventions
  (`.room-notice` at `top: 4.2rem`; the interaction `.hud` at `bottom: 6%`; `PromptBar`
  pinned near the top), leaving the **top-left** corner free for the new HUD.

## 2. Current authority model

- **Truth (authoritative):** the per-session append-only `WorldEvent[]`, with
  `WorldState` only as its reconstructable projection — including
  `player.health`, `player.status`, and `inventory`. The single write path is
  `WorldSession.appendEvent(...)` → validate → `applyEvent` → `store.commit(...)`.
- **Read-only display (never truth):** the HUD and the `App`-held view it renders. It is
  a *projection of a projection* — a render cache of the authoritative snapshot. It
  never feeds back into an event, a reducer, the snapshot, or the store, and it has no
  code path to do so.

## 3. Meaning of `inventory-health-ui-v0`

A small presentational HUD plus the minimal wiring to feed it authoritative state:

- a **pure projection** `projectPlayerHud(state: WorldState) → PlayerHudView` (UI layer),
- a **presentational** `StatusHud` React component (UI layer, non-interactive),
- **`App`-owned HUD state**, seeded from the session-start `WorldState` and refreshed
  from the `WorldState` that interaction/encounter resolutions already return, rendered
  as an **App-level overlay** sibling of `RoomViewer`,
- a **single small `onWorldStateChange` callback** added to `RoomViewer`, fired after a
  player-state-mutating resolve.

The HUD displays **health** (`current / max` + a proportional bar), **inventory** (a
list of `name ×quantity`, or an empty state), and **status** (chips, shown only when
non-empty). It reads the **active in-memory `WorldSession` state only** (no backend, no
persistence). Its absence never blocks play, and it never alters truth.

## 4. Final decisions (locked)

1. **Scope = Option A, display-only.** Display existing authoritative `WorldState`
   fields. **No domain / event / reducer / schema (`RoomSpec` or world) changes.**
2. **No backend / API / persistence wiring.** Read the **active in-memory
   `WorldSession`** only. No new endpoint, no browser↔Node client, no SQLite.
3. **No memory integration, no LLM item generation, no combat / equipment / item
   economy.** The HUD shows only what the reducers already made authoritative.
4. **`App` owns the HUD state.** It is a read-only projection/cache of the authoritative
   snapshot — never a second source of truth, never written back.
5. **Render the HUD as an App-level overlay** (sibling of `RoomViewer`, like `notice`
   and `PromptBar`), so it survives `RoomViewer`'s navigation remount.
6. **`RoomViewer` gets only a small `onWorldStateChange?: (state: WorldState) => void`
   callback**, fired when an interaction/encounter resolve returns `applied` /
   `already-resolved` (both carry `state`). No other `RoomViewer` behavior changes.
7. **Display health, inventory, and status chips.** Status chips render only when the
   status set is non-empty.
8. **Skip DOM/component tests in v0; pure projection tests only; no new test
   dependencies.** The repo has no `jsdom` / `@testing-library/react` and `vite.config.ts`
   declares no test environment; this slice does not add any.
9. **The UI never invents or mutates state.** Empty/missing/loading states degrade
   visibly and safely (§11); the HUD has no append path (structural — it imports no
   `world-session`/services and receives only data + a one-way callback).

## 5. Non-goals

This slice must **not**:

- Add or change any **`WorldEvent` type, reducer (`applyEvent`), `CanonSeed`,
  `WorldState`/`RoomSpec` schema field**, or the world authority/save-load path.
- Add a **combat system, damage/death/game-over state, health regeneration/ticks**, or
  any **status-effect engine** (status chips are display of the existing `string[]`).
- Add an **inventory system**: capacity/weight limits, sorting/filtering, an item
  economy, item categories/metadata, equipment/slots, or any **item action**
  (use / drop / equip / combine) from the HUD. The HUD is **read-only**.
- Add **LLM item generation** or surface any LLM/generated/memory/dialogue/summary text
  as player state.
- Add **backend/API/persistence wiring**, a browser→Node client/CORS, or **browser
  SQLite** access; the browser stays on `InMemoryWorldStore`.
- Add **memory integration** (NPC or room memory) in any form.
- Touch the **renderer / engine / Three.js**, the camera/player marker, or `RoomSpec` —
  no renderer or layout-hook change is required (the HUD is a DOM overlay).
- Make the HUD **interactive** or give it any write/append path to `WorldState`, the
  event log, or the store.
- Add **save/load, session persistence, a minimap, or mobile/touch** changes.
- Add a **heavy UI framework, state library, or any new package** (runtime or dev,
  including test deps).
- **Log** item names/ids, `status` strings, health values/deltas, or any narrative/user
  content (§12).

## 6. Chosen option and placement

**Option A (display-only).** Health, inventory, status, the mutating events, the
reducers, the read path, and the service results that already return fresh `WorldState`
**all exist and are authoritative**; only display is missing. (Rejected: **B** adds
domain fields/events — nothing is missing, so it is unnecessary scope; **C**
backend/API-backed UI — violates the in-memory constraint and adds an endpoint AGENTS
defers; **D** full inventory/combat/equipment — against the hard constraints.)

| Piece | Location | Layer |
| --- | --- | --- |
| `projectPlayerHud(state)` + `PlayerHudView` type | `apps/web/src/renderer/ui/playerHud.ts` | UI (pure) |
| `StatusHud` (presentational) | `apps/web/src/renderer/ui/StatusHud.tsx` | UI |
| HUD state ownership + seeding + overlay render | `apps/web/src/App.tsx` | App / composition root |
| `onWorldStateChange` callback prop + two call sites | `apps/web/src/renderer/RoomViewer.tsx` | App seam |
| HUD styles | `apps/web/src/index.css` | — |

All new code lives in the **UI layer** (`renderer/ui/**`) and the **composition root**
(`App.tsx`/`RoomViewer.tsx`). Per [BOUNDARIES](../BOUNDARIES.md), UI → Domain is
allowed (the projection imports only `WorldState`/`InventoryItem` **types**), and the
composition root may import everything. **No `eslint.config.js` change** is anticipated
(§10).

## 7. Data flow & ownership

Read-only, deterministic, and complete — every event that can change a displayed field
flows through one of the two seed/refresh points below.

```
session start (bootstrap OR prompt)
  └─ worldSession.startSession(...) → { ok:true, state }     ← authoritative initial snapshot
       └─ App: setPlayerHud(projectPlayerHud(state))         ← seed (App-owned state)

interaction / encounter resolve (inside RoomViewer)
  └─ result.status ∈ { applied, already-resolved } → result.state (fresh WorldState)
       └─ RoomViewer: onWorldStateChange(result.state)
            └─ App: setPlayerHud(projectPlayerHud(state))    ← refresh

navigation (moved-to-room)
  └─ does NOT change player fields → App does NOT reset playerHud (HUD persists)

render
  └─ App: {playerHud && <StatusHud view={playerHud} />}      ← App-level overlay
```

- **Ownership.** `App` holds `playerHud: PlayerHudView | null`. The seed `WorldState`
  travels with the session-start result; the simplest threading is to carry the
  projected view on `ActivePlay` (e.g. `initialPlayer: PlayerHudView`) so both the
  bootstrap and prompt paths seed identically, and `App` calls `setPlayerHud` when it
  applies a freshly-started play. (Equivalently, `App` may call `setPlayerHud` directly
  at the two start sites.) On a brand-new prompt session, `App` resets `playerHud` to
  `null` alongside the existing `setActivePlay(null)` so no stale view flashes.
- **Refresh.** `App` passes `onWorldStateChange={(state) => setPlayerHud(projectPlayerHud(state))}`
  to `RoomViewer`. `RoomViewer` calls it in the existing `.then` of `interactionService.resolve`
  and `encounterService.resolve` **only** when `result.status` is `applied` or
  `already-resolved` (the variants that carry `state`). No new async read is introduced;
  `WorldSession.getWorldState(sessionId)` remains the canonical re-read if a defensive
  refresh is ever wanted later (not needed in v0).
- **Navigation persistence.** Because the HUD lives in `App` (which does not remount on
  navigation) and `moved-to-room` does not change player fields, the HUD value carries
  across rooms with no special handling.

## 8. HUD view model + projection (`renderer/ui/playerHud.ts`)

A pure, total, deterministic function — no I/O, no `Date.now`/`Math.random`, no input
mutation. It imports only the `WorldState` / `InventoryItem` **types** from the domain.

```ts
export type PlayerHudHealth = {
  current: number
  max: number
  /** current/max as a 0..1 fraction, 0 when max <= 0; for the bar width only. */
  fraction: number
}
export type PlayerHudItem = {
  itemId: string
  /** display label, e.g. "Health Potion" */
  name: string
  quantity: number
}
export type PlayerHudView = {
  health: PlayerHudHealth
  items: PlayerHudItem[]   // authoritative inventory order preserved
  statuses: string[]       // authoritative status order preserved
}

export function projectPlayerHud(state: WorldState): PlayerHudView
```

- `health.fraction = max > 0 ? clamp01(current / max) : 0`. The reducer already clamps
  `current` to `0..max`, so the bar handles `0/max` (empty) and `current === max` (full)
  without special cases.
- `items` maps `state.inventory` 1:1, **preserving authoritative order** (stable, keyed
  by `itemId` in the view).
- `statuses` is a fresh copy of `state.player.status`, order preserved.
- Returns **fresh** objects/arrays (no aliasing of `state`); the input `WorldState` is
  never mutated.
- The projection contains **no formatting that could misrepresent truth** (no rounding
  of `current`/`max` away from the authoritative integers; the fraction is presentation
  only, used for bar width, with the exact `current / max` always shown as text).

## 9. `StatusHud` component (`renderer/ui/StatusHud.tsx`)

Presentational React only (peer of `Hud`/`DialoguePanel`): props in, DOM out. It
imports the `PlayerHudView` type (and React); it imports **no** `three`, engine
internals, `world-session`, or services, and holds no state beyond render.

- **Props:** `{ view: PlayerHudView }` (the component renders nothing meaningful for an
  absent view; `App` gates rendering on `playerHud != null`).
- **Health:** the text `current / max` plus a proportional bar (`width: fraction*100%`).
  The numeric label is the accessible text equivalent of the bar (do not rely on color
  alone); `0/max` renders an empty bar gracefully.
- **Inventory:** a list keyed by `itemId`, each row `name ×quantity`. Empty inventory →
  an explicit **"No items"** empty state.
- **Status:** small chips; the whole row is **omitted when `statuses` is empty**.
- **Placement / UX:** top-left overlay (clear of the top `PromptBar`/`notice` and the
  bottom-center interaction `.hud`). Container `pointer-events: none` so canvas
  drag/click passes through. `role="status"` + `aria-live="polite"` so health/inventory
  changes are announced. Reuse the existing dark translucent panel styling for contrast.
- **Styling:** new `.status-hud*` rules in `index.css`, consistent with `.hud` /
  `.room-notice`.

## 10. Boundaries / lint (no `eslint.config.js` change expected)

- **`renderer/ui/playerHud.ts` and `renderer/ui/StatusHud.tsx`** sit under the existing
  `renderer/ui/**` block: they may import `react` and **domain** types, and must not
  import `three`/`three/*` or engine internals (and must not import `world-session`/
  services). Importing the `WorldState`/`InventoryItem` **types** from `domain/world/`
  is an allowed UI → Domain dependency, consistent with the existing UI components that
  import `domain/ports/interaction` and `domain/dialogue/contracts`.
- **`App.tsx` / `RoomViewer.tsx`** are the composition root and already import UI,
  services, and domain; adding the HUD render, the `App` state, and the one callback
  uses only allowed directions.
- **No new layer, port, or lint block** is introduced. No engine object ever enters the
  projection, the view, or the component
  ([ADR-0008](../decisions/ADR-0008-renderer-portability-strategy.md)).
- If, and only if, implementation surfaces a concrete rule gap, the smallest necessary
  `eslint.config.js` edit is made and recorded in the closeout; otherwise the config is
  untouched.

## 11. Failure / empty-state behavior

| Situation | Detection | Handling / result | Logging |
| --- | --- | --- | --- |
| No active session / pre-load | `playerHud === null` in `App` | HUD not rendered; no crash | — |
| Empty inventory | `view.items.length === 0` | explicit "No items" state | — |
| Empty status | `view.statuses.length === 0` | status row omitted | — |
| Missing health | n/a — schema guarantees `player.health` for a loaded session | hidden defensively if ever absent (no throw) | — |
| Player state changed (item/health/status) | interaction/encounter `applied`/`already-resolved` → `onWorldStateChange` | HUD re-projects and updates from the returned `WorldState` | — |
| Navigation | `moved-to-room` does not touch player fields | HUD persists unchanged (App-owned) | — |
| Health clamped to 0 (lethal encounter) | reducer clamp (existing) | bar empty, label `0 / max`; **no death/game-over** (out of scope) | — |
| Invalid/stale display | UI never validates/repairs | HUD shows only already-validated authoritative `WorldState`; last known view persists if no refresh fires; no write-back possible | — |

The HUD is read-only and has no append path, so no UI action can corrupt truth.

## 12. Log-safety rules

- **The HUD and projection log nothing** (the projection is pure; `StatusHud` is
  presentational). This slice adds **no new log lines** to `App`/`RoomViewer`.
- **Never log:** item `name`/`itemId`, `status` strings, `health` `current`/`max`/delta
  values, or any narrative/user content (mirrors ADR-0013 rule 10, ADR-0014/0015's "no
  item names / health deltas" discipline). If any diagnostic were ever added, restrict
  it to counts/codes/booleans.

## 13. Test plan (Vitest; co-located; pure only; no DOM, no new deps)

- **Projection (`renderer/ui/playerHud.test.ts`):**
  - health fraction: `0/max` → `0`; partial (e.g. `75/100`) → `0.75`; `max/max` → `1`;
    `max <= 0` guarded → `0`; `current`/`max` pass through unrounded.
  - inventory: empty → `items: []`; multiple items map 1:1 with **authoritative order
    preserved** and correct `quantity`.
  - status: empty → `[]`; non-empty → order preserved (fresh copy).
  - **purity / no-mutation:** the input `WorldState` is deep-equal before and after
    (snapshot compare), and returned arrays/objects are fresh (not the same references
    as the input).
  - **structural read-only:** `playerHud.ts` imports no `world-session`/service module
    and exports no function that returns a `WorldCommand`/`WorldEvent` (it only produces
    a view).
- **No DOM/component tests** and **no App-wiring tests** in v0 (the repo has no
  `jsdom`/`@testing-library/react` and adds none). The component is kept trivially
  presentational so the projection tests cover the logic; the wiring is exercised
  manually via the running app.

## 14. Proposed implementation slices

Each slice builds and leaves `npm run build` / `npm run lint` / `npm run test` (in
`apps/web`) passing; the maintainer commits each manually.

1. **`feat(ui): add player HUD projection and StatusHud component`** —
   `renderer/ui/playerHud.ts` (+ `playerHud.test.ts`), `renderer/ui/StatusHud.tsx`, and
   `.status-hud*` rules in `index.css`. Pure + presentational; **not yet wired** (renders
   only when given a view). No `eslint.config.js` change.
2. **`feat(app): display player health/inventory/status HUD`** — `App.tsx` owns
   `playerHud`, seeds it at both session-start sites (bootstrap + prompt) and resets it
   on a new prompt, passes `onWorldStateChange` to `RoomViewer`, and renders
   `<StatusHud>` as an App-level overlay; `RoomViewer.tsx` gains the
   `onWorldStateChange` prop and fires it after interaction/encounter
   `applied`/`already-resolved` resolves. No domain/service/renderer changes.
3. **`docs(architecture): record inventory-health-ui-v0`** *(closeout — after source
   review)* — create **ADR-0026**; update `ARCHITECTURE.md` (new "Inventory & Health UI
   v0" section + the current-data-flow note that the HUD reads returned/seed `WorldState`),
   `FAILURE-MODES.md` (a player-HUD display row), and `AGENTS.md` (short status note);
   touch `BOUNDARIES.md` only if a rule actually changed (not anticipated); flip this
   plan and ADR-0026 to *implemented*.

## 15. Files added / changed

- **New (UI):** `renderer/ui/playerHud.ts`, `renderer/ui/playerHud.test.ts`,
  `renderer/ui/StatusHud.tsx`.
- **Edited (composition root):** `renderer/RoomViewer.tsx` (add `onWorldStateChange`
  prop + fire it at the two resolve call sites), `App.tsx` (own/seed/reset `playerHud`,
  pass the callback, render the overlay), `index.css` (`.status-hud*` styles).
- **Docs (slice 3, closeout):** `ARCHITECTURE.md`, `FAILURE-MODES.md`, `AGENTS.md`
  (and `BOUNDARIES.md` only if needed); new `ADR-0026`; this plan flipped to
  *implemented*.
- **Deliberately NOT changed:** `domain/world/**` (no new event, reducer, or schema
  field), `domain/roomSpec.ts` / `loadRoomSpec` (no `RoomSpec` change),
  `world-session/**`, `interactions/**`, `encounters/**` (logic — the HUD only *consumes*
  the `WorldState` they already return), `dialogue/**`, `memory/**`, `persistence/**`,
  `server/**`, `renderer/engine/**` (no Three.js/camera/layout-hook change),
  `eslint.config.js` (no new rule expected), `package.json` (no new runtime or test
  dependency).

## 16. Approval answers (binding for this slice)

1. **Scope:** Option A, display-only. **No domain / event / reducer / schema changes.**
2. **No backend / API / persistence wiring;** read the active in-memory `WorldSession`
   only. **No browser SQLite.**
3. **No memory integration, no LLM item generation, no combat / equipment / item
   economy.**
4. **`App` owns the HUD state** (a read-only projection/cache, never truth, never
   written back).
5. **Render the HUD as an App-level overlay** (sibling of `RoomViewer`).
6. **`RoomViewer` gets only a small `onWorldStateChange` callback,** fired after
   player-state-mutating resolves (`applied` / `already-resolved`, which carry `state`).
7. **Display health, inventory, and status chips** (status chips shown only when
   non-empty).
8. **Skip DOM/component tests; pure projection tests only; no new test dependencies.**
9. **Invariants:** the UI reads existing authoritative `WorldState` only; it invents and
   mutates nothing; it has no append/write path to truth; empty/missing/loading states
   degrade visibly and safely; `WorldSession`/event log/reducers remain authoritative.
10. **Process:** this plan doc is created **before** any code; **ADR-0026 is created in
    the docs closeout, after the source implementation is reviewed** — not now.
