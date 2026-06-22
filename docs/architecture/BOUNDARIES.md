# Module Boundaries

> How the layers may and may not depend on each other.
> Companion to [ARCHITECTURE](./ARCHITECTURE.md). Rules here are mirrored in
> [/AGENTS.md](../../AGENTS.md) so coding agents follow them too.

These boundaries are enforced **mechanically** by TypeScript `strict` and ESLint
rules (see "Lint-enforced boundaries" below), backed by code review and these
docs. Boundaries lint can't express, and future layers that don't exist yet,
stay enforced by review until they can be encoded.

## The one rule

**Dependencies point inward, toward the domain.** Outer layers depend on inner
layers, never the reverse. The domain depends on nothing in this repo.

```
  Generation ───┐
  World session ┤
  Interactions ─┤
  Encounters ───┤
  Backend ──────┤
  Persistence ──┤──► (App / Composition root) ──► UI ─┐
                │                                       ├──► DOMAIN / CONTRACTS
                └────────────────────────► Renderer ────┘   (room/world contracts)
                              (everyone may use the Logger port)
```

## Layer definitions

| Layer | Folder (today) | What lives here |
| --- | --- | --- |
| **Domain / Contracts** | `apps/web/src/domain/` | RoomSpec plus versioned world/event/save schemas, pure loaders/validators/projection, and ports (`RoomSource`, `RoomGenerator`, `WorldStore`, `Clock`, `IdGenerator`, interaction). Pure. |
| **Renderer** | `apps/web/src/renderer/engine/` | Three.js engine, builders, controls, **camera controllers** (`camera/`: `CameraController` / `IsometricCameraController`), the **player object/marker**, disposal. |
| **UI** | `apps/web/src/renderer/ui/` | Presentational React components. |
| **App / Composition root** | `apps/web/src/App.tsx`, `RoomViewer.tsx`, `app/`, `room/` | Wires concrete implementations together (room sources, prompt bar, error boundary). |
| **Platform** | `apps/web/src/platform/` | Cross-cutting adapters: logger (`logger/`) and real clock/UUID implementations (`system/`); 🔜 config/env. |
| **Generation** | ✅ v0 (fake): `apps/web/src/generation/` | Prompt → RoomSpec **data** via a deterministic fake generator; 🔜 real LLM. |
| **World session** | ✅ v0 (headless): `apps/web/src/world-session/` | Application use-cases, in-memory `WorldStore`, and the SaveGame JSON boundary. No React/renderer wiring. |
| **Interactions** | ✅ v0 (headless): `apps/web/src/interactions/` | Plans validated interaction effects and executes their commands through `WorldSession`; composition wiring stays outside this folder. |
| **Encounters** | ✅ v0 (headless): `apps/web/src/encounters/` | Plans validated encounter outcomes and executes their commands through `WorldSession` (shared `world-session/applyCommands`); composition wiring stays outside this folder. |
| **Backend / Persistence** | ❌ not built (future `apps/api`) | HTTP, generation hosting, repositories. |

## Allowed dependency directions

| From ↓ → To → | Domain | Renderer | UI | Platform (Logger) | Generation | World session | Interactions | Encounters | Backend/DB |
| --- | :---: | :---: | :---: | :---: | :---: | :---: | :---: | :---: | :---: |
| **Domain** | — | ✗ | ✗ | ✗ | ✗ | ✗ | ✗ | ✗ | ✗ |
| **Renderer** | ✓ | — | ✗ | ✓ (port) | ✗ | ✗ | ✗ | ✗ | ✗ |
| **UI** | ✓ | ✗* | — | ✓ (port) | ✗ | ✗ | ✗ | ✗ | ✗ |
| **App / Composition root** | ✓ | ✓ | ✓ | ✓ | ✓ | ✓ | ✓ | ✓ | ✓ |
| **Generation** | ✓ | ✗ | ✗ | ✓ (port) | — | ✗ | ✗ | ✗ | ✗ |
| **World session** | ✓ | ✗ | ✗ | ✓ (port) | ✗ | — | ✗ | ✗ | ✗ |
| **Interactions** | ✓ | ✗ | ✗ | ✓ (port) | ✗ | ✓ | — | ✗ | ✗ |
| **Encounters** | ✓ | ✗ | ✗ | ✓ (port) | ✗ | ✓ | ✗ | — | ✗ |
| **Backend / Persistence** | ✓ | ✗ | ✗ | ✓ (port) | ✓ | ✓ | ✓ | ✓ | — |

`✗*` UI may not import renderer **internals**. It interacts with the engine only
through the *approved host interface* (below). The composition root is the only
place allowed to depend on everything; it is where wiring happens.

## Forbidden imports (and why)

| Rule | Why |
| --- | --- |
| **Renderer must not import React** (`react`, `react-dom`). | The engine must be usable and testable independently of the UI framework. The React host adapts to it, not the other way around. ([ADR-0002](./decisions/ADR-0002-react-three-boundary.md)) |
| **UI must not import Three.js** (`three`) or engine internals. | UI is presentational. Mixing Three.js objects into React render logic couples the view to engine guts and breaks the lifecycle/disposal contract. |
| **Domain must not import React, Three.js, the renderer, UI, the platform logger, the DOM, the network, or a DB.** | The contract must be sharable by every consumer (renderer today, backend/generation later) without dragging in a runtime; it returns problems as data instead of logging. |
| **No layer may call `console.*`** except the browser logger adapter. | One logging seam; structured and swappable. ([ADR-0003](./decisions/ADR-0003-logging-abstraction.md)) |
| **Persistence/DB code must never appear in UI or renderer.** | Data access is server-side and lives behind repository interfaces. SQL/driver types never leak outward. ([ADR-0004](./decisions/ADR-0004-persistence-sqlite-to-postgres.md)) |
| **World session must not import React, Three.js, or renderer/UI internals.** | Authoritative gameplay truth is a headless application layer over neutral domain data and ports; renderer wiring is a separate future slice. ([ADR-0013](./decisions/ADR-0013-world-state-event-log-v0.md)) |
| **World state changes only by appending a validated event and projecting it.** | The event log is authoritative. Direct snapshot setters would create a second source of truth and break reconstruction/integrity. ([ADR-0013](./decisions/ADR-0013-world-state-event-log-v0.md)) |
| **Renderer interaction callbacks carry intent only.** | The engine may pass a neutral object id but must not import `world-session`/`interactions`/`encounters`, plan effects, or mutate `WorldState`; the composition root owns that wiring. ([ADR-0014](./decisions/ADR-0014-object-interactions-v0.md), [ADR-0015](./decisions/ADR-0015-encounter-system-v0.md)) |
| **Interaction effects are fixed-vocabulary data, never behavior/code.** | The pure domain planner maps validated descriptors to existing commands, and the application service can write only through `WorldSession.appendEvent`. ([ADR-0014](./decisions/ADR-0014-object-interactions-v0.md)) |
| **Encounters are fixed-vocabulary data, never behavior/code.** | An `EncounterSpec` rides the shared `Interaction`; the pure `planEncounter` maps the chosen choice to existing commands (no new event type, encounter wins over `effect`), and `EncounterService` writes only through `WorldSession.appendEvent` via the shared `applyCommands` helper. ([ADR-0015](./decisions/ADR-0015-encounter-system-v0.md)) |
| **Generation must never emit executable code** — only RoomSpec data. | The trust boundary. Model output is data validated at the boundary, never `eval`'d, never turned into JS/Three/React — and never Unity C#, Godot GDScript, or any scene script. ([ADR-0001](./decisions/ADR-0001-data-only-room-spec-trusted-renderer.md), [ADR-0008](./decisions/ADR-0008-renderer-portability-strategy.md)) |
| **No raw `RoomSpec` may reach the renderer unvalidated.** | All dynamic/external data is validated by `loadRoomSpec` at the boundary first. |
| **No engine objects in the domain or DB; keep `RoomSpec`/domain renderer-agnostic.** | The renderer is an *adapter* over the data contract — a Three.js adapter today, possibly Babylon/Unity/Godot later. Engine handles (`THREE.Mesh`, `Material`, `Vector3`, scene nodes) live only inside a renderer adapter; the domain and persisted rows hold neutral data only, so a second renderer is a new adapter, not a rewrite. ([ADR-0008](./decisions/ADR-0008-renderer-portability-strategy.md)) |
| **The camera and the player marker are renderer-internal presentation — never `RoomSpec`/domain data.** | Camera mode (isometric today, free-camera later), the `CameraController`/`OrthographicCamera`, and the player marker live only inside the renderer engine. A `RoomSpec` describes *what is in the room*, not *how it is filmed*; no camera/player fields exist in the schema, and the model never directs the camera. ([ADR-0012](./decisions/ADR-0012-isometric-camera-foundation.md)) |

## The approved host interface (React ↔ engine seam)

The UI and the engine are wired together **only** at the composition root
(`RoomViewer.tsx` today) and communicate through a deliberately small surface:

- **React → engine: imperative methods.** e.g. `engine.setRoom(room)`,
  `engine.setInteractionLock(locked)`. React calls these; it does not reach into
  scene graph, camera, or meshes.
- **engine → React: callbacks.** e.g. `engine.onActiveInteractionChange`,
  `engine.onRequestOpenInteraction`. The engine pushes plain, serializable view
  data out (including an optional passive object id); React/composition turns it
  into UI and may resolve the id through application services.
- **Shared view-model types** (e.g. the interaction descriptor) are part of this
  contract. They live in the neutral `domain/ports/` module (e.g.
  `domain/ports/interaction.ts`), imported by both the engine and the UI, so
  neither side imports the other's internals.

Anything beyond this surface (React touching `THREE.*`, the engine importing a
component) is a boundary violation.

## Lint-enforced boundaries

These are enforced mechanically; a violation fails `npm run build` or
`npm run lint`:

- **TypeScript `strict`** and **`noUncheckedIndexedAccess`** in both
  `tsconfig.app.json` and `tsconfig.node.json`.
- **`no-console`** everywhere except the browser logger adapter
  (`src/platform/logger/consoleLogger.ts`).
- **`no-restricted-imports`** encoding the forbidden-import table:
  - `renderer/engine/**` may not import `react` / `react-dom`.
  - `renderer/ui/**` may not import `three` or `renderer/engine/**` internals.
  - `domain/**` may not import `react`, `three`, `renderer/**`, or `platform/**`.
  - `generation/**` may not import `react`, `three`, `renderer/**`, or
    `platform/**` — it emits data and the caller logs ([ADR-0001](./decisions/ADR-0001-data-only-room-spec-trusted-renderer.md), [ADR-0003](./decisions/ADR-0003-logging-abstraction.md)).
  - `world-session/**` may import domain contracts/ports and the Logger
    interface, but may not import `react`, `react-dom`, `three`, or
    `renderer/**` ([ADR-0013](./decisions/ADR-0013-world-state-event-log-v0.md)).
  - `interactions/**` may import domain, `world-session`, and the Logger
    interface, but may not import `react`, `react-dom`, `three`, or
    `renderer/**` ([ADR-0014](./decisions/ADR-0014-object-interactions-v0.md)).
  - `encounters/**` may import domain, `world-session`, and the Logger
    interface, but may not import `react`, `react-dom`, `three`, or
    `renderer/**` ([ADR-0015](./decisions/ADR-0015-encounter-system-v0.md)).
  - `renderer/engine/**` may not import `world-session/**`, `interactions/**`,
    or `encounters/**`; it emits interaction intent only
    ([ADR-0014](./decisions/ADR-0014-object-interactions-v0.md),
    [ADR-0015](./decisions/ADR-0015-encounter-system-v0.md)).
- Boundaries lint cannot easily express — and future backend/DB rules, until
  those folders exist — stay enforced by review + these docs +
  [/AGENTS.md](../../AGENTS.md).

**Treat this document as the contract**: a change that violates a rule above
should be rejected in review even if it slips past tooling.
