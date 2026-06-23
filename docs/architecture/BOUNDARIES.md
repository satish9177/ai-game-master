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
  Dialogue ─────┤
  Backend ──────┤
  Persistence ──┤──► (App / Composition root) ──► UI ─┐
                │                                       ├──► DOMAIN / CONTRACTS
                └────────────────────────► Renderer ────┘   (room/world contracts)
                              (everyone may use the Logger port)
```

## Layer definitions

| Layer | Folder (today) | What lives here |
| --- | --- | --- |
| **Domain / Contracts** | `apps/web/src/domain/` | RoomSpec, versioned world/event/save schemas, bounded initial-canon `WorldBibleSeed`, pure loaders/validators/projections, and ports including `WorldBibleSeeder`. Pure. |
| **Renderer** | `apps/web/src/renderer/engine/` | Three.js engine, builders, controls, **camera controllers** (`camera/`: `CameraController` / `IsometricCameraController`), the **player object/marker**, disposal. |
| **UI** | `apps/web/src/renderer/ui/` | Presentational React components. |
| **App / Composition root** | `apps/web/src/App.tsx`, `RoomViewer.tsx`, `app/`, `room/` | Wires concrete implementations, including prompt-only world-bible seeding/degradation, room sources, play-session/cache ownership, adjacent-room resolution, navigation, and UI hosts. |
| **Platform** | `apps/web/src/platform/` | Cross-cutting adapters: logger (`logger/`) and real clock/UUID implementations (`system/`); 🔜 config/env. |
| **Generation** | ✅ v0 (fake): `apps/web/src/generation/` | Prompt → validated WorldBibleSeed **data** and compact seed → RoomSpec **data** via deterministic silent fakes; 🔜 real LLM adapters. |
| **World session** | ✅ v0 (headless): `apps/web/src/world-session/` | Application use-cases, in-memory `WorldStore`, and the SaveGame JSON boundary. No React/renderer wiring. |
| **Interactions** | ✅ v0 (headless): `apps/web/src/interactions/` | Plans validated interaction effects and executes their commands through `WorldSession`; composition wiring stays outside this folder. |
| **Encounters** | ✅ v0 (headless): `apps/web/src/encounters/` | Plans validated encounter outcomes and executes their commands through `WorldSession` (shared `world-session/applyCommands`); composition wiring stays outside this folder. |
| **Dialogue** | ✅ v0 (headless): `apps/web/src/dialogue/` | Builds pure dialogue context and coordinates read-only provider replies through `WorldSession.getWorldState`; composition/UI wiring stays outside this folder. |
| **Persistence** | ✅ v0 (headless, Node-only): `apps/web/src/persistence/` | `node:sqlite` connection + forward-only migration runner, `SqliteWorldStore` (existing `WorldStore` port), and `SqliteRoomStore` (new `RoomStore` port). Consumed by the Node API; never browser-reachable. |
| **Backend / HTTP API** | ✅ v0 (Node-only): `apps/web/src/server/` | Native `node:http` edge for health, world-session commands/queries, and room save/load. Validates HTTP input and composes world-session plus SQLite adapters; no frontend imports. |

## Allowed dependency directions

| From ↓ → To → | Domain | Renderer | UI | Platform (Logger) | Generation | World session | Interactions | Encounters | Dialogue | Persistence |
| --- | :---: | :---: | :---: | :---: | :---: | :---: | :---: | :---: | :---: | :---: |
| **Domain** | — | ✗ | ✗ | ✗ | ✗ | ✗ | ✗ | ✗ | ✗ | ✗ |
| **Renderer** | ✓ | — | ✗ | ✓ (port) | ✗ | ✗ | ✗ | ✗ | ✗ | ✗ |
| **UI** | ✓ | ✗* | — | ✓ (port) | ✗ | ✗ | ✗ | ✗ | ✗ | ✗ |
| **App / Composition root** | ✓ | ✓ | ✓ | ✓ | ✓ | ✓ | ✓ | ✓ | ✓ | ✗† |
| **Generation** | ✓ | ✗ | ✗ | ✓ (port) | — | ✗ | ✗ | ✗ | ✗ | ✗ |
| **World session** | ✓ | ✗ | ✗ | ✓ (port) | ✗ | — | ✗ | ✗ | ✗ | ✗ |
| **Interactions** | ✓ | ✗ | ✗ | ✓ (port) | ✗ | ✓ | — | ✗ | ✗ | ✗ |
| **Encounters** | ✓ | ✗ | ✗ | ✓ (port) | ✗ | ✓ | ✗ | — | ✗ | ✗ |
| **Dialogue** | ✓ | ✗ | ✗ | ✓ (port) | ✗ | ✓ | ✗ | ✗ | — | ✗ |
| **Persistence (v0, headless)** | ✓ | ✗ | ✗ | ✓ (types) | ✗ | ✗ | ✗ | ✗ | ✗ | — |
| **Backend / HTTP (v0)** | ✓ | ✗ | ✗ | ✓ (port) | ✗ | ✓ | ✗ | ✗ | ✗ | ✓ |

`✗*` UI may not import renderer **internals**. It interacts with the engine only
through the *approved host interface* (below). The composition root is where
wiring happens.

`✗†` The browser composition root does **not** import persistence. The separate
Node-only server composition root owns SQLite wiring, while reciprocal lint
walls keep both `node:sqlite` / `**/persistence/**` and `**/server/**` out of the
browser bundle. Browser gameplay continues to use the in-memory adapters
([ADR-0018](./decisions/ADR-0018-backend-sqlite-persistence-v0.md),
[ADR-0019](./decisions/ADR-0019-backend-world-session-api-v0.md)). The
`Persistence (v0)` row imports the Logger **types** only — never the logger
adapter or any other `platform/**`.

## Forbidden imports (and why)

| Rule | Why |
| --- | --- |
| **Renderer must not import React** (`react`, `react-dom`). | The engine must be usable and testable independently of the UI framework. The React host adapts to it, not the other way around. ([ADR-0002](./decisions/ADR-0002-react-three-boundary.md)) |
| **UI must not import Three.js** (`three`) or engine internals. | UI is presentational. Mixing Three.js objects into React render logic couples the view to engine guts and breaks the lifecycle/disposal contract. |
| **Domain must not import React, Three.js, the renderer, UI, the platform logger, the DOM, the network, or a DB.** | The contract must be sharable by every consumer (renderer today, backend/generation later) without dragging in a runtime; it returns problems as data instead of logging. |
| **No layer may call `console.*`** except the browser logger adapter. | One logging seam; structured and swappable. ([ADR-0003](./decisions/ADR-0003-logging-abstraction.md)) |
| **Persistence/DB code must never appear in UI, renderer, or any browser-reachable layer.** | Data access is Node-only, behind repository ports. Only persistence itself and the server composition root may import it; the browser bundle is provably free of DB code (tsconfig excludes + Vite reachability + reciprocal lint walls). ([ADR-0004](./decisions/ADR-0004-persistence-sqlite-to-postgres.md), [ADR-0018](./decisions/ADR-0018-backend-sqlite-persistence-v0.md), [ADR-0019](./decisions/ADR-0019-backend-world-session-api-v0.md)) |
| **Persistence may import only pure domain contracts and the Logger types.** | The headless SQLite adapters hold neutral JSON and implement the domain ports; they must not import React, Three.js, the renderer/UI, or any application layer (generation, world-session, interactions, encounters, dialogue, room, app). It stores the validated RoomSpec **data document**, never `THREE.*`/renderer objects. ([ADR-0008](./decisions/ADR-0008-renderer-portability-strategy.md), [ADR-0018](./decisions/ADR-0018-backend-sqlite-persistence-v0.md)) |
| **The server may import only Node/backend-safe layers.** | `server/**` is a Node composition root over domain contracts, world-session, persistence, and platform abstractions. It must not import React, Three.js, renderer/UI, or browser composition modules. HTTP payloads are validated before use, and API errors/log context stay safe. ([ADR-0019](./decisions/ADR-0019-backend-world-session-api-v0.md)) |
| **The event log stays append-only and the snapshot stays a projection cache in SQLite.** | `SqliteWorldStore` exposes no event update/delete; `UNIQUE(session_id, seq)` plus `BEFORE UPDATE`/`BEFORE DELETE` triggers enforce append-only at the DB; the session-computed snapshot is persisted atomically with its event under a `revision` compare-and-set. ([ADR-0013](./decisions/ADR-0013-world-state-event-log-v0.md), [ADR-0018](./decisions/ADR-0018-backend-sqlite-persistence-v0.md)) |
| **World session must not import React, Three.js, or renderer/UI internals.** | Authoritative gameplay truth is a headless application layer over neutral domain data and ports; renderer wiring is a separate future slice. ([ADR-0013](./decisions/ADR-0013-world-state-event-log-v0.md)) |
| **World state changes only by appending a validated event and projecting it.** | The event log is authoritative. Direct snapshot setters would create a second source of truth and break reconstruction/integrity. ([ADR-0013](./decisions/ADR-0013-world-state-event-log-v0.md)) |
| **Renderer interaction callbacks carry intent only.** | The engine may pass a neutral object id but must not import `world-session`/`interactions`/`encounters`/`dialogue` or navigation/cache modules, plan effects, resolve exits/dialogue, or mutate `WorldState`; the composition root owns that wiring. ([ADR-0014](./decisions/ADR-0014-object-interactions-v0.md), [ADR-0015](./decisions/ADR-0015-encounter-system-v0.md), [ADR-0016](./decisions/ADR-0016-multi-room-navigation-cache-v0.md), [ADR-0017](./decisions/ADR-0017-npc-dialogue-foundation-v0.md)) |
| **Interaction effects are fixed-vocabulary data, never behavior/code.** | The pure domain planner maps validated descriptors to existing commands, and the application service can write only through `WorldSession.appendEvent`. ([ADR-0014](./decisions/ADR-0014-object-interactions-v0.md)) |
| **Encounters are fixed-vocabulary data, never behavior/code.** | An `EncounterSpec` rides the shared `Interaction`; the pure `planEncounter` maps the chosen choice to existing commands (no new event type, encounter wins over `effect`), and `EncounterService` writes only through `WorldSession.appendEvent` via the shared `applyCommands` helper. ([ADR-0015](./decisions/ADR-0015-encounter-system-v0.md)) |
| **NPC dialogue is read-only display data.** | `NPCDialogueSpec` and provider replies are neutral data; `NPCDialogueService` may only read `WorldState`, never append events, and dialogue/history/text remain outside authoritative state and logs. ([ADR-0017](./decisions/ADR-0017-npc-dialogue-foundation-v0.md)) |
| **WorldBibleSeed is initial canon, never authoritative current state.** | It may live in generated-play composition memory and seed generation, but must not become a `WorldEvent`, `WorldState`, `CanonSeed`, SaveGame, API/SQLite row, renderer input, quest engine, or branching planner. `WorldSession` and its event-log projection remain authoritative. ([ADR-0022](./decisions/ADR-0022-world-bible-seed-v0.md)) |
| **Generation must never emit executable code** — only WorldBibleSeed/RoomSpec-shaped data. | The trust boundary. Provider output remains data until its schema/assembly boundary validates it; it is never `eval`'d or turned into JS/Three/React/scene scripts. ([ADR-0001](./decisions/ADR-0001-data-only-room-spec-trusted-renderer.md), [ADR-0008](./decisions/ADR-0008-renderer-portability-strategy.md), [ADR-0022](./decisions/ADR-0022-world-bible-seed-v0.md)) |
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

Multi-room navigation remains composition-layer code: `RoomRegistry` and
`SessionRoomCache` live in `room/`, `NavigationService` and exit lookup helpers
live in `app/`, and `App` owns the persistent session/cache. `RoomViewer` maps a
neutral object id to an exit and routes intent upward. The engine imports none of
these modules, and this slice adds no ESLint platform rule.

Adjacent-room pre-generation stays in the same composition layer
([ADR-0021](./decisions/ADR-0021-adjacent-room-pregeneration-v0.md)).
`AdjacentRoomPregenerator` lives in `app/` and is the one room-acquisition seam:
it composes `SessionRoomCache`, `RoomRegistry`, the `GeneratedRoomSource`
factory, the domain `assembleRoom`/`validateRoom` pipeline, and the Logger — all
imports the composition root is already allowed to make, so **no new lint block is
needed**. `NavigationService` no longer owns the cache/registry; it depends only
on the narrow `RoomResolver` interface (DIP) the pregenerator implements.
`RoomViewer` and the engine stay **presentation- and intent-only** — they import
neither the pregenerator nor the resolver, and warming/door resolution are driven
entirely from `App`. There is **no domain, schema, server, or persistence change**:
generated adjacents reuse the existing `assembleRoom` trust boundary so only
valid, zero-fatal rooms reach the cache, and no engine object ever enters the
cache or the resolver result.

NPC dialogue follows the same intent boundary: `RoomViewer` maps a neutral id to
validated dialogue data and calls the headless read-only service;
`NPCDialoguePanel` receives only neutral turns/prompts/callbacks. The engine does
not import dialogue, and conversation history stays in component state.

## Lint-enforced boundaries

These are enforced mechanically; a violation fails `npm run build` or
`npm run lint`:

- **TypeScript `strict`** and **`noUncheckedIndexedAccess`** in
  `tsconfig.app.json`, `tsconfig.node.json`, `tsconfig.persistence.json`, and
  `tsconfig.server.json`. The app config **excludes `src/persistence` and
  `src/server`**; the Node-only configs use no DOM lib and `types: ['node']`.
  Both are included in the root `tsc -b` references, so persistence or server
  type errors fail `npm run build`.
- **`no-console`** everywhere except the browser logger adapter
  (`src/platform/logger/consoleLogger.ts`).
- **`no-restricted-imports`** encoding the forbidden-import table:
  - `renderer/engine/**` may not import `react` / `react-dom`.
  - `renderer/ui/**` may not import `three` or `renderer/engine/**` internals.
  - `domain/**` may not import `react`, `three`, `renderer/**`, or `platform/**`.
  - `generation/**` may not import `react`, `three`, `renderer/**`, or
    `platform/**` — both fakes emit validated/data-only contracts and stay silent;
    prompt-path composition owns safe logging ([ADR-0001](./decisions/ADR-0001-data-only-room-spec-trusted-renderer.md),
    [ADR-0003](./decisions/ADR-0003-logging-abstraction.md), [ADR-0022](./decisions/ADR-0022-world-bible-seed-v0.md)).
  - `world-session/**` may import domain contracts/ports and the Logger
    interface, but may not import `react`, `react-dom`, `three`, or
    `renderer/**` ([ADR-0013](./decisions/ADR-0013-world-state-event-log-v0.md)).
  - `interactions/**` may import domain, `world-session`, and the Logger
    interface, but may not import `react`, `react-dom`, `three`, or
    `renderer/**` ([ADR-0014](./decisions/ADR-0014-object-interactions-v0.md)).
  - `encounters/**` may import domain, `world-session`, and the Logger
    interface, but may not import `react`, `react-dom`, `three`, or
    `renderer/**` ([ADR-0015](./decisions/ADR-0015-encounter-system-v0.md)).
  - `dialogue/**` may import domain, the `world-session` read path, and the
    Logger interface, but may not import `react`, `react-dom`, `three`, or
    `renderer/**` ([ADR-0017](./decisions/ADR-0017-npc-dialogue-foundation-v0.md)).
  - `renderer/engine/**` may not import `world-session/**`, `interactions/**`,
    `encounters/**`, or `dialogue/**`; it emits interaction intent only
    ([ADR-0014](./decisions/ADR-0014-object-interactions-v0.md),
    [ADR-0015](./decisions/ADR-0015-encounter-system-v0.md),
    [ADR-0017](./decisions/ADR-0017-npc-dialogue-foundation-v0.md)).
  - Every browser-reachable `src/**` file may not import `node:sqlite`,
    `**/persistence/**`, `node:http`, or `**/server/**`. These reciprocal bans
    are folded into the per-folder rules plus a broad browser block because
    ESLint flat config is last-match-wins per rule
    ([ADR-0018](./decisions/ADR-0018-backend-sqlite-persistence-v0.md),
    [ADR-0019](./decisions/ADR-0019-backend-world-session-api-v0.md)).
  - `persistence/**` may import the domain (`domain/world/**`, `roomSpec`,
    `loadRoomSpec`, `domain/ports/**`), the Logger **types**, and `node:sqlite`,
    but may not import `react`, `react-dom`, `three`/`three/*`, `renderer/**`, or
    any application layer (`generation/**`, `world-session/**`, `interactions/**`,
    `encounters/**`, `dialogue/**`, `room/**`, `app/**`, or `server/**`)
    ([ADR-0018](./decisions/ADR-0018-backend-sqlite-persistence-v0.md)).
  - `server/**` may import domain, `world-session/**`, `persistence/**`, the
    platform logger/system abstractions, and Node built-ins. It may not import
    React, Three.js, renderer/UI, generation, interactions, encounters, dialogue,
    or browser composition modules
    ([ADR-0019](./decisions/ADR-0019-backend-world-session-api-v0.md)).
- Boundaries that lint cannot easily express stay enforced by review + these
  docs +
  [/AGENTS.md](../../AGENTS.md).

**Treat this document as the contract**: a change that violates a rule above
should be rejected in review even if it slips past tooling.
