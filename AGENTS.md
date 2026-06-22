# AGENTS.md — Engineering standards for coding agents

Rules for any AI coding agent (Claude, Codex, etc.) and human contributors
working in this repo. **Read this before writing code.** These are
non-negotiable unless the maintainer explicitly approves an exception.

Deep context lives in [`docs/architecture/`](./docs/architecture/ARCHITECTURE.md):
[ARCHITECTURE](./docs/architecture/ARCHITECTURE.md) ·
[BOUNDARIES](./docs/architecture/BOUNDARIES.md) ·
[CONVENTIONS](./docs/architecture/CONVENTIONS.md) ·
[FAILURE-MODES](./docs/architecture/FAILURE-MODES.md) ·
[decisions/](./docs/architecture/decisions/).

## What this project is

An AI Game Master that renders a **walkable isometric 3D story scene** — a
browser-based controlled 3D / isometric solo RPG scene. A room is described by a
**RoomSpec** (pure data) and rendered by **trusted, hand-written Three.js**.
Today: a single Vite app at `apps/web` (React 19 + TypeScript + Three.js + zod).
**Renderer Foundation v0** renders one hardcoded room; **Generation Foundation
v0** adds a deterministic *fake* room generator behind a prompt bar, validated
through the same `loadRoomSpec` schema boundary and a pure semantic `validateRoom`
playability check (**Semantic Room Validator v0**,
[ADR-0011](./docs/architecture/decisions/ADR-0011-semantic-room-validator-v0.md)).
The **Isometric Camera Foundation** makes the default view a fixed orthographic
isometric camera following a player object — still Three.js, still real 3D, with
**RoomSpec unchanged** and the camera renderer-internal
([ADR-0012](./docs/architecture/decisions/ADR-0012-isometric-camera-foundation.md)).
"2.5D" means camera/presentation, **not** a new engine; full first-person /
free-camera 3D remains future/optional. No real LLM/API, backend, or database yet
— those are coming and the architecture is built so they slot in without breaking
boundaries.

## Engineering standards (non-negotiable)

1. **Follow SOLID principles where applicable.** Single responsibility per
   module; depend on abstractions (ports/interfaces) at seams; prefer extension
   (a new builder / a new adapter) over modifying trusted core code.
2. **Keep layer boundaries separate:** frontend, renderer, domain, generation,
   backend, and persistence are distinct responsibilities. Don't merge them.
3. **React UI must not import Three.js engine internals** except through the
   approved host interface (imperative methods + callbacks at the composition
   root). See [ADR-0002](./docs/architecture/decisions/ADR-0002-react-three-boundary.md).
4. **The renderer must not import React** (`react`/`react-dom`). The engine is
   pure Three.js and framework-independent.
5. **LLM/generation may only produce RoomSpec JSON data — never executable
   JS/Three.js/React code** (nor Unity C#, Godot GDScript, or any scene script).
   Generated output is data, validated at the boundary, never `eval`'d. This is
   the core trust boundary
   ([ADR-0001](./docs/architecture/decisions/ADR-0001-data-only-room-spec-trusted-renderer.md)).
   Keep `RoomSpec`/domain **renderer-agnostic**: no engine objects (`THREE.Mesh`,
   materials, vectors, scene nodes) in the domain or the DB. A renderer is an
   adapter over the data contract — Three.js today, possibly Babylon/Unity/Godot
   later
   ([ADR-0008](./docs/architecture/decisions/ADR-0008-renderer-portability-strategy.md)).
6. **Persistence/database logic must never enter UI or renderer.** Data access is
   server-side, behind repository interfaces. No SQL or DB driver types in the
   browser ([ADR-0004](./docs/architecture/decisions/ADR-0004-persistence-sqlite-to-postgres.md)).
7. **Use the logger abstraction — not scattered `console.log`/`print`.** Log
   through the `Logger` interface with structured context.
8. **The browser logger adapter may be the only place that calls `console.*`.**
   Everywhere else, inject and use the logger
   ([ADR-0003](./docs/architecture/decisions/ADR-0003-logging-abstraction.md)).
   *(Implemented in `src/platform/logger/`: the console adapter is the only place
   `console.*` is allowed, enforced by the `no-console` lint rule.)*
9. **Validate all external/dynamic data at boundaries.** Anything entering a
   layer from outside (a RoomSpec, an HTTP payload, a stored row, model output)
   is validated with the shared schema first. Raw data never reaches the renderer.
10. **Keep RoomSpec data-only and the renderer hand-written.** No code, functions,
    or scripts inside a RoomSpec. New renderable content = a new schema variant +
    a new trusted builder, reviewed by a human.
11. **Add/update high-level docs** in `docs/architecture/` when you make an
    architecture decision or introduce/handle a failure mode. Record decisions as
    a new ADR; don't bury them in code comments.
12. **Keep commits small and independently reviewable.** One logical change per
    commit; each commit should build and leave the app working.
13. **Do not over-engineer with heavy frameworks** (DI containers, Redux, Nest,
    heavy ORMs, etc.) unless the maintainer explicitly approves. DI = constructor
    parameters. Prefer the smallest seam that satisfies the boundary.
14. **Build entities compositionally — don't add a builder per type.** For future
    object/character rendering, don't write a bespoke builder per entity
    (`soldier`, `zombie`, `giant`, `merchant`, …). Compose from a trusted part
    library: base body + appearance + outfit + equipment + scale + palette +
    role/preset + interaction/behavior metadata. RoomSpec selects safe
    presets/parts/params (data only); the renderer owns and assembles the parts;
    the LLM never emits geometry. v0 primitive builders are fine — this governs
    how the object system grows. See
    [ADR-0006](./docs/architecture/decisions/ADR-0006-compositional-entity-builders.md).

## Module boundaries (quick reference)

Dependencies point **inward**, toward the domain. Full rules in
[BOUNDARIES](./docs/architecture/BOUNDARIES.md).

| Layer | Location (today) | May import | Must NOT import |
| --- | --- | --- | --- |
| **Domain / Contracts** | `apps/web/src/domain/` | zod only | React, Three.js, renderer, UI, platform, DOM, network, DB |
| **Renderer** | `apps/web/src/renderer/engine/` | domain, logger port | React, network, DB |
| **UI** (React) | `apps/web/src/renderer/ui/` | domain, host contract, logger port | Three.js, engine internals |
| **Composition root** | `apps/web/src/App.tsx`, `RoomViewer.tsx`, `app/`, `room/` | everything (this is where wiring lives) | — |
| **Generation** | `apps/web/src/generation/` (v0, fake) | domain, logger port | UI, renderer, React, Three.js |
| **World session** | `apps/web/src/world-session/` (v0, headless) | domain, logger port | UI, renderer, React, Three.js, DB |
| **Backend / Persistence** | not built yet | domain | UI, renderer |

## Logging rules

- Log through the `Logger` interface (`debug`/`info`/`warn`/`error`) with a
  structured context object, not string concatenation.
- `console.*` only inside the browser logger adapter.
- Pure code (e.g. the loader) returns problems as data; the caller logs.
- Never log secrets, API keys, full prompts, or PII.

## Conventions

Y-up · meters · −Z is north · `rotationY`/`yaw` in degrees
(`forward = (sin yaw, cos yaw)`) · object `position` is the base/floor anchor for
ground objects. Full details in [CONVENTIONS](./docs/architecture/CONVENTIONS.md).

## Out of scope / current guardrails

Unless the maintainer explicitly asks, do **not**:

- add **real** LLM/API generation, a backend, or a database — the deterministic
  *fake* generator plus the deterministic semantic `validateRoom` (Generation
  Foundation v0 + Semantic Room Validator v0) are the only generation-pipeline
  code; do not extend them into a real model, a multi-stage pipeline, a **deeper**
  code validator (reachability / object↔object collision / quest consistency), an
  LLM reviewer, a repair loop, memory, or adjacent-room pre-generation without
  explicit approval;
- add npm workspaces or extract `packages/contracts`
  ([ADR-0005](./docs/architecture/decisions/ADR-0005-defer-shared-package-extraction.md));
- introduce a state-management library, a DI framework, or a heavy ORM;
- rewrite the working renderer beyond what a boundary fix requires;
- add new gameplay/renderer features (collision, pointer lock, dialogue trees,
  multi-room, GLTF) as part of an architecture change;
- extend the camera beyond the wired isometric mode — no **zoom**, **camera-mode
  toggle UI**, **free-camera / first-person mode**, mobile/touch controls, or
  minimap. `LookControls` is **retained but not instantiated**; a free-camera mode
  goes behind the existing `CameraController` seam, not by re-wiring first-person
  ([ADR-0012](./docs/architecture/decisions/ADR-0012-isometric-camera-foundation.md)).
  Camera/player are renderer-internal — never add camera fields to RoomSpec.

When unsure whether something fits a boundary, **check the docs and ask** rather
than guessing.

## Build & verify

```bash
cd apps/web
npm install        # first time
npm run dev        # Vite dev server
npm run build      # tsc -b + vite build  (use this to prove a change type-checks)
npm run lint       # eslint
npm run test       # vitest (PRNG, fake generator, validateRoom, GeneratedRoomSource paths)
```

For a docs-only or non-`src` change, `npm run build --prefix apps/web` from the
repo root is the quick "did I break anything" check.
