# Architecture Overview

> Entry point for the AI Game Master architecture docs.
> See also: [BOUNDARIES](./BOUNDARIES.md) · [CONVENTIONS](./CONVENTIONS.md) ·
> [FAILURE-MODES](./FAILURE-MODES.md) · [decisions/](./decisions/).
> Contributor & coding-agent rules live in [/AGENTS.md](../../AGENTS.md).

## Purpose

This document describes how the project is structured, why the structure is
what it is, and where future features (AI generation, a backend, a database)
will plug in **without** corrupting the boundaries that already exist.

The guiding idea: this is built to become a real long-term product, not a demo.
Every layer has a single responsibility, dependencies point in one direction,
and the highest-value safety property — *the renderer only ever runs trusted,
hand-written code* — is preserved as the system grows.

## Status legend

Throughout these docs:

- ✅ **Implemented** — exists today in `apps/web` (Renderer Foundation v0).
- 🔜 **Planned** — designed and approved, not yet built (next slices).
- ❌ **Not built** — future shape only; documented so we don't paint into a corner.

## Status today (Renderer Foundation v0)

A single Vite application at `apps/web`:

- **React 19 + TypeScript + Vite** — application shell and UI overlay.
- **Vanilla Three.js 0.184** (not react-three-fiber) — the rendering engine.
- **zod 4** — RoomSpec validation at the data boundary.
- No AI, no backend, no database, no persistence. ✅ by design for v0.

It proves one thing: a hardcoded **RoomSpec** (pure data) can be turned into a
walkable low-poly 3D room rendered entirely by **trusted Three.js code**, with
no arbitrary code execution anywhere in the pipeline.

## Layered architecture

Dependencies point **inward**, toward the domain. Outer layers may depend on
inner layers; inner layers never depend on outer layers.

```
        ┌────────────────────────────────────────────────────────┐
        │  DOMAIN / CONTRACTS  (pure data + types, zero I/O)       │
        │  RoomSpec schema · loadRoomSpec (validation) · version   │
        │  🔜 ports: RoomSource   ❌ ports: RoomGenerator, Repos    │
        └────────────────────────────────────────────────────────┘
              ▲              ▲                ▲              ▲
       imports│       imports│         impl   │       impl   │ (future)
     ┌────────┴─────┐ ┌──────┴───────┐ ┌──────┴──────┐ ┌─────┴──────────┐
     │  RENDERER    │ │  UI (React)  │ │  APP /       │ │  GENERATION /  │
     │  (Three.js)  │ │              │ │  COMPOSITION │ │  BACKEND / DB  │
     │  no React    │ │  no Three    │ │  ROOT        │ │  ❌ NOT BUILT  │
     └──────┬───────┘ └──────┬───────┘ └──────┬───────┘ └────────────────┘
            │                │                │
            └──── 🔜 both depend on ──► Logger (platform port) ◄──┘
```

| Layer | Responsibility | May depend on | Must NOT depend on |
| --- | --- | --- | --- |
| **Domain / Contracts** | The RoomSpec data contract, validation, types, ports (interfaces). Pure; no I/O. | Nothing (only zod) | React, Three.js, DOM, network, DB |
| **Renderer** (`renderer/engine`) | Turn a validated room into a Three.js scene; own the render loop, controls, disposal. | Domain | React, network, DB |
| **UI** (`renderer/ui`) | Presentational React overlay (HUD, dialogue panel). | Domain, approved host contract | Three.js internals, network, DB |
| **App / Composition root** | Wire concrete implementations together (logger, room source, engine host). | All of the above | — |
| 🔜 **Generation** | Prompt → **RoomSpec data** (never code). Validated by the same loader. | Domain | Renderer, React, DB |
| ❌ **Backend / Persistence** | Host generation; store rooms/sessions. | Domain | UI, Renderer |

The current code already honors the top three rows: `Engine` is pure Three.js
with no React import; the React host talks to it through methods and callbacks;
`loadRoomSpec` is pure and dependency-light. See [BOUNDARIES](./BOUNDARIES.md)
for the exact allowed/forbidden import rules.

## The trust boundary: data-only RoomSpec → trusted renderer

This is the most important property in the system and the reason the future AI
slice can be safe. It is captured formally in
[ADR-0001](./decisions/ADR-0001-data-only-room-spec-trusted-renderer.md).

```
  author (hardcoded today, 🔜 an LLM later)
        │
        ▼
   RoomSpec  ── pure JSON-shaped data: numbers, strings, enums. ──┐
        │       No functions. No scripts. No code. Never eval'd.   │
        ▼                                                          │
   loadRoomSpec(raw)   ◄── THE BOUNDARY ──►  zod validation        │  TRUST
        │   envelope: strict (throws on bad required fields)       │  BOUNDARY
        │   objects:  lenient (bad object skipped, room survives)  │
        ▼                                                          │
   trusted, hand-written builders  (type string → fixed registry) ─┘
        │
        ▼
   Three.js scene
```

Two rules make this safe:

1. **A RoomSpec is data, never behavior.** It selects from a *fixed registry of
   known `type` strings* (`throne`, `pillar`, `rug`, `torch`, `arch`, `scroll`,
   `npc`, `prop`). It can never introduce new executable behavior. The mapping
   from `type` → 3D objects is hand-written, reviewed, trusted code.
2. **Validation happens at the boundary.** `loadRoomSpec` validates everything
   crossing into the renderer. Unknown or malformed objects degrade to a visible
   magenta placeholder; they never crash the renderer and never execute.

Because of this, a *hostile or garbage* generation (later) is just data that
either validates — and is rendered by trusted code — or fails validation and is
skipped. There is no code path from "model output" to "executed JavaScript".

## Current data flow (v0)

```
App.tsx
  └─ RoomViewer.tsx                     (React host — owns the engine lifecycle)
       ├─ loadRoomSpec(throneRoom)       ✅ validation boundary (today: static data)
       ├─ new Engine(container)          ✅ pure Three.js
       │    ├─ buildLighting(room)        ambient + optional hemisphere
       │    ├─ buildShell(room)           floor + walls (north exit split)
       │    ├─ buildObjects(room)         type→builder registry, placeholder fallback
       │    ├─ MovementControls           WASD, delta-time, AABB room clamp
       │    └─ LookControls               drag-look (no pointer lock)
       ├─ engine.onActiveInteractionChange → React state → <Hud/>
       └─ engine.onRequestOpenInteraction  → React state → <DialoguePanel/>
```

The React ↔ engine seam is **callbacks + imperative methods**, not shared
mutable state and not React reaching into Three.js objects. That seam is the
"approved host interface" referenced in [BOUNDARIES](./BOUNDARIES.md).

## Renderer Foundation v0 — module summary

| Module | Role |
| --- | --- |
| `domain/roomSpec.ts` | `RoomSpecSchema` (envelope) + `RoomObjectSchema` (discriminated union on `type`); inferred `RoomSpec` / `RoomObject` types. Schema/types only, no behavior. |
| `domain/loadRoomSpec.ts` | `loadRoomSpec` (strict envelope, lenient objects) + the `LoadedRoom` result type. |
| `domain/ports/interaction.ts` | The neutral interaction view-model shared by the engine and the UI. |
| `domain/examples/throneRoom.ts` | The single hardcoded demo room — pure data literal. |
| `renderer/engine/Engine.ts` | Owns renderer/scene/camera, render loop, proximity detection, interaction keys, and **total `dispose()`**. No React. |
| `renderer/engine/builders/` | `buildShell`, `buildLighting`, and the object `registry` + `buildObjects` with magenta-placeholder fallback. |
| `renderer/engine/controls/` | `MovementControls` (WASD, room-clamped), `LookControls` (drag-look). |
| `renderer/engine/disposables.ts` | `Disposables` + `disposeObject` — explicit GPU teardown (Three.js does not GC geometries/materials/textures). |
| `renderer/ui/` | `Hud` and `DialoguePanel` — presentational React only. |
| `renderer/RoomViewer.tsx` | The composition seam: constructs/disposes the engine, bridges engine callbacks to React state. StrictMode-safe (mount → dispose → mount leaks nothing). |

## Object & entity system (compositional builders)

🔜 **Direction for future object/character work.** v0's per-type primitive
builders are fine as-is; this section governs how the object system *grows*. Full
rationale in
[ADR-0006](./decisions/ADR-0006-compositional-entity-builders.md).

**Anti-pattern (avoid):** a separate one-off builder per entity type —
`buildSoldier`, `buildWoman`, `buildMan`, `buildZombie`, `buildGiant`,
`buildKing`, `buildMerchant`, … This explodes combinatorially, duplicates limb
and posture logic, and is unmaintainable. It violates SRP / OCP / DRY.

**Preferred: compositional builders.** The renderer assembles an entity from a
trusted **part library** along fixed dimensions:

```
entity = base body type (e.g. humanoid)
       + appearance parts
       + clothing / outfit
       + equipment
       + size / scale modifiers
       + material / color palette
       + role / preset      (a named bundle of the above)
       + interaction / behavior metadata
```

| Entity | Composition |
| --- | --- |
| soldier | humanoid + armor + helmet + weapon |
| zombie | humanoid + damaged posture + pale skin + torn clothes |
| giant | humanoid + large scale + heavy limbs + monster traits |
| merchant | humanoid + robe + bag/wares |

**The trust boundary still holds.** RoomSpec stays **data-only**: it selects a
preset and/or lists parts + parameters. The LLM may choose *safe presets and
parts* from the published vocabulary, but **never generates geometry or builder
code**. The renderer owns the trusted part library and assembles the final
object safely — the data-only → trusted-renderer rule of
[ADR-0001](./decisions/ADR-0001-data-only-room-spec-trusted-renderer.md) applied
at part granularity. A new entity is usually a new *data combination*;
occasionally a new *part* is added (and reviewed); almost never a new bespoke
builder. Unknown parts/presets degrade to a placeholder, like unknown object
types today (see [FAILURE-MODES](./FAILURE-MODES.md)).

## Future plug-in points

These are **designed, not built**. The point of documenting them now is to keep
today's seams in the right place.

### 🔜 Generation (AI-authored rooms)

- A `RoomSource` **port** (interface) in the domain answers "give me a room".
  Today the only implementation is a `StaticRoomSource` returning `throneRoom`.
- A future `GeneratedRoomSource` calls an LLM that returns **RoomSpec JSON only**
  and runs it through the *same* `loadRoomSpec`. The model never emits renderer
  code. See the trust boundary above and
  [ADR-0001](./decisions/ADR-0001-data-only-room-spec-trusted-renderer.md).
- Because `RoomSource.getRoom()` is async by contract, loading/error states and
  the React error boundary (see [FAILURE-MODES](./FAILURE-MODES.md)) are the
  same whether the room is static, generated, or fetched.

### ❌ Backend / API

- Hosts generation (keeps model credentials **server-side only** — never in the
  browser bundle) and persistence. Exposes HTTP.
- Validates incoming/outgoing RoomSpecs with the **same** domain schema at its
  own boundary (validate at every trust boundary, not just the browser).

### ❌ Persistence (SQLite now → PostgreSQL later)

- Repository interfaces live in the domain; adapters live in the backend.
  UI and renderer **never** touch SQL or a DB driver.
- SQLite is a *server-side* store, not an in-browser database. See
  [ADR-0004](./decisions/ADR-0004-persistence-sqlite-to-postgres.md).

## Packaging decision

The domain/renderer/UI boundaries are real **today**, enforced by folder
structure, these docs, and (in a later commit) lint rules — not by separate npm
packages. A shared `packages/contracts` package is extracted only when a second
consumer of the RoomSpec contract exists (i.e. when the backend lands). See
[ADR-0005](./decisions/ADR-0005-defer-shared-package-extraction.md).
