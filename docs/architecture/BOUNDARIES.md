# Module Boundaries

> How the layers may and may not depend on each other.
> Companion to [ARCHITECTURE](./ARCHITECTURE.md). Rules here are mirrored in
> [/AGENTS.md](../../AGENTS.md) so coding agents follow them too.

These boundaries are currently enforced by **folder structure + code review +
these docs**. A later commit will make the most important ones **mechanical**
via TypeScript `strict` and ESLint rules (see "Lint enforcement (planned)").

## The one rule

**Dependencies point inward, toward the domain.** Outer layers depend on inner
layers, never the reverse. The domain depends on nothing in this repo.

```
  Generation ─┐
  Backend ────┤
  Persistence ┤──► (App / Composition root) ──► UI ─┐
              │                                       ├──► DOMAIN / CONTRACTS
              └────────────────────────► Renderer ────┘   (RoomSpec, validation)
                              (everyone may use the Logger port)
```

## Layer definitions

| Layer | Folder (today) | What lives here |
| --- | --- | --- |
| **Domain / Contracts** | `apps/web/src/domain/` | RoomSpec schema (`roomSpec.ts`), `loadRoomSpec.ts`, the interaction view-model (`ports/interaction.ts`), schema version; 🔜 more ports (`RoomSource`, …). Pure. |
| **Renderer** | `apps/web/src/renderer/engine/` | Three.js engine, builders, controls, disposal. |
| **UI** | `apps/web/src/renderer/ui/` | Presentational React components. |
| **App / Composition root** | `apps/web/src/App.tsx`, `RoomViewer.tsx` (🔜 `app/`) | Wires concrete implementations together. |
| **Platform** | 🔜 `apps/web/src/platform/` | Cross-cutting adapters: logger, config/env. |
| **Generation** | ❌ not built | Prompt → RoomSpec data. |
| **Backend / Persistence** | ❌ not built (future `apps/api`) | HTTP, generation hosting, repositories. |

## Allowed dependency directions

| From ↓ → To → | Domain | Renderer | UI | Platform (Logger) | Generation | Backend/DB |
| --- | :---: | :---: | :---: | :---: | :---: | :---: |
| **Domain** | — | ✗ | ✗ | ✗ | ✗ | ✗ |
| **Renderer** | ✓ | — | ✗ | ✓ (port) | ✗ | ✗ |
| **UI** | ✓ | ✗* | — | ✓ (port) | ✗ | ✗ |
| **App / Composition root** | ✓ | ✓ | ✓ | ✓ | ✓ | ✓ |
| **Generation** | ✓ | ✗ | ✗ | ✓ (port) | — | ✗ |
| **Backend / Persistence** | ✓ | ✗ | ✗ | ✓ (port) | ✓ | — |

`✗*` UI may not import renderer **internals**. It interacts with the engine only
through the *approved host interface* (below). The composition root is the only
place allowed to depend on everything; it is where wiring happens.

## Forbidden imports (and why)

| Rule | Why |
| --- | --- |
| **Renderer must not import React** (`react`, `react-dom`). | The engine must be usable and testable independently of the UI framework. The React host adapts to it, not the other way around. ([ADR-0002](./decisions/ADR-0002-react-three-boundary.md)) |
| **UI must not import Three.js** (`three`) or engine internals. | UI is presentational. Mixing Three.js objects into React render logic couples the view to engine guts and breaks the lifecycle/disposal contract. |
| **Domain must not import React, Three.js, the renderer, UI, the platform logger, the DOM, the network, or a DB.** | The contract must be sharable by every consumer (renderer today, backend/generation later) without dragging in a runtime; it returns problems as data instead of logging. |
| **No layer may call `console.*`** except the browser logger adapter. | One logging seam; structured, level-controlled, swappable. ([ADR-0003](./decisions/ADR-0003-logging-abstraction.md)) 🔜 |
| **Persistence/DB code must never appear in UI or renderer.** | Data access is server-side and lives behind repository interfaces. SQL/driver types never leak outward. ([ADR-0004](./decisions/ADR-0004-persistence-sqlite-to-postgres.md)) |
| **Generation must never emit executable code** — only RoomSpec data. | The trust boundary. Model output is data validated at the boundary, never `eval`'d, never turned into JS/Three/React. ([ADR-0001](./decisions/ADR-0001-data-only-room-spec-trusted-renderer.md)) |
| **No raw `RoomSpec` may reach the renderer unvalidated.** | All dynamic/external data is validated by `loadRoomSpec` at the boundary first. |

## The approved host interface (React ↔ engine seam)

The UI and the engine are wired together **only** at the composition root
(`RoomViewer.tsx` today) and communicate through a deliberately small surface:

- **React → engine: imperative methods.** e.g. `engine.setRoom(room)`,
  `engine.setInteractionLock(locked)`. React calls these; it does not reach into
  scene graph, camera, or meshes.
- **engine → React: callbacks.** e.g. `engine.onActiveInteractionChange`,
  `engine.onRequestOpenInteraction`. The engine pushes plain, serializable view
  data out; React turns it into UI.
- **Shared view-model types** (e.g. the interaction descriptor) are part of this
  contract. They live in the neutral `domain/ports/` module (e.g.
  `domain/ports/interaction.ts`), imported by both the engine and the UI, so
  neither side imports the other's internals.

Anything beyond this surface (React touching `THREE.*`, the engine importing a
component) is a boundary violation.

## What will be lint-enforced later (planned, not in this commit)

The following will be turned on in a dedicated tooling commit. Documented here
so the intent is unambiguous:

- **TypeScript `strict`** (and likely `noUncheckedIndexedAccess`) in both
  `tsconfig.app.json` and `tsconfig.node.json`. Currently **off**.
- **`no-console`** everywhere except the single browser logger adapter file.
- **`no-restricted-imports`** to encode the forbidden-import table:
  - `renderer/**` may not import `react` / `react-dom`.
  - `renderer/ui/**` may not import `three` or `renderer/engine/**` internals.
  - `domain/**` may not import `react`, `three`, `renderer/**`, or `platform/**`.
- Boundaries that lint cannot easily express stay enforced by review + these
  docs + [/AGENTS.md](../../AGENTS.md).

Until those land, **treat this document as the contract**: a change that would
violate a rule above should be rejected in review even though the build still
passes.
