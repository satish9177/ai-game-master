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

- ✅ **Implemented** — exists today in `apps/web` (Renderer Foundation v0;
  Generation Foundation v0).
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

## Generation Foundation v0

✅ **Implemented.** The first generation seam now runs end-to-end **without a
real LLM**: a user prompt becomes a validated room through a deterministic,
*fake* generator.

```
User prompt
  → PromptBar              (app composition chrome — not renderer UI)
  → App composition root
  → FakeRoomGenerator      (behind the RoomGenerator port; seeded by the prompt)
  → raw, untrusted JSON text
  → GeneratedRoomSource    (owns JSON.parse + loadRoomSpec + validateRoom)
  → loadRoomSpec           ✅ schema boundary (well-formed?), unchanged
  → validateRoom           ✅ semantic boundary (playable?) — NEW, pure domain
  → RoomLoadResult         (typed ok / invalid-room / unavailable)
  → existing trusted Three.js renderer
```

What it proves — and what it deliberately is **not**:

- **Deterministic fake only.** `FakeRoomGenerator` is pure: prompt → seeded PRNG
  → RoomSpec data. The same prompt yields a byte-identical room. There is **no
  real LLM, no API key, no backend, no database, no memory** yet.
- **The generator returns raw, untrusted JSON *text*** — the exact shape a future
  LLM completion would have. It emits **data, never code** ([ADR-0001](./decisions/ADR-0001-data-only-room-spec-trusted-renderer.md)).
- **`GeneratedRoomSource` owns parse + validation.** It runs the text through
  `JSON.parse`, then the **same `loadRoomSpec`** every source uses (schema), then
  the new **`validateRoom`** semantic check, and maps the outcome to a typed
  `RoomLoadResult` (`invalid-room` on bad JSON/envelope **or a fatal semantic
  issue**, `unavailable` if the generator throws). The renderer still executes
  only **trusted, hand-written builders**.
- **Semantic validation (`validateRoom`) is the new playability boundary.** A pure
  domain function checks an already-loaded room for *playability* — sane
  dimensions, spawn inside the walkable bounds, object/light budgets, usable
  interactions. A **fatal** issue folds into the existing `invalid-room` outcome so
  an unplayable room never renders; **warnings** are logged as counts and the room
  still loads. `loadRoomSpec` answers *well-formed?*; `validateRoom` answers
  *playable?* ([ADR-0011](./decisions/ADR-0011-semantic-room-validator-v0.md)).
- **Logging is length-only.** The prompt *text* is never logged — only its length
  and safe result counts/codes ([ADR-0003](./decisions/ADR-0003-logging-abstraction.md)).
- **Tested.** Vitest covers the seeded PRNG, the fake generator (determinism,
  known-vocabulary-only, passes `loadRoomSpec`, data-only round-trip), and the
  `GeneratedRoomSource` failure paths (bad JSON, bad envelope, generator throws,
  lenient object-skip).

A first slice of the **deterministic code validator** now ships too — semantic
playability ([ADR-0011](./decisions/ADR-0011-semantic-room-validator-v0.md)). The
rest of the generation **pipeline** (real LLM, the validator's deeper
reachability/collision checks, an LLM reviewer, bounded repair/regenerate,
adjacent-room pre-generation) and the **backend/persistence** that will host it
remain **planned / not built** — see
[Generation pipeline](#generation-pipeline-planned),
[ADR-0010](./decisions/ADR-0010-generation-foundation-v0.md), and
[ADR-0011](./decisions/ADR-0011-semantic-room-validator-v0.md).

## Layered architecture

Dependencies point **inward**, toward the domain. Outer layers may depend on
inner layers; inner layers never depend on outer layers.

```
        ┌────────────────────────────────────────────────────────┐
        │  DOMAIN / CONTRACTS  (pure data + types, zero I/O)       │
        │  RoomSpec schema · loadRoomSpec (validation) · version   │
        │  ✅ ports: RoomSource, RoomGenerator   ❌ ports: Repos    │
        └────────────────────────────────────────────────────────┘
              ▲              ▲                ▲              ▲
       imports│       imports│         impl   │       impl   │ (future)
     ┌────────┴─────┐ ┌──────┴───────┐ ┌──────┴──────┐ ┌─────┴──────────┐
     │  RENDERER    │ │  UI (React)  │ │  APP /       │ │  GENERATION    │
     │  (Three.js)  │ │              │ │  COMPOSITION │ │  v0: fake gen  │
     │  no React    │ │  no Three    │ │  ROOT        │ │  BE/DB future  │
     └──────┬───────┘ └──────┬───────┘ └──────┬───────┘ └────────────────┘
            │                │                │
            └──── both may use ──► Logger (platform port) ◄──┘
```

| Layer | Responsibility | May depend on | Must NOT depend on |
| --- | --- | --- | --- |
| **Domain / Contracts** | The RoomSpec data contract, validation, types, ports (interfaces). Pure; no I/O. | Nothing (only zod) | React, Three.js, DOM, network, DB |
| **Renderer** (`renderer/engine`) | Turn a validated room into a Three.js scene; own the render loop, controls, disposal. | Domain | React, network, DB |
| **UI** (`renderer/ui`) | Presentational React overlay (HUD, dialogue panel). | Domain, approved host contract | Three.js internals, network, DB |
| **App / Composition root** | Wire concrete implementations together (logger, room source, engine host). | All of the above | — |
| ✅ **Generation (v0, fake)** | Prompt → **RoomSpec data** (never code) via a deterministic fake generator. Validated by the same loader. 🔜 real LLM. | Domain | Renderer, React, DB |
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

### Generated-room data flow (Generation Foundation v0)

Submitting a prompt swaps the room source; the host path is otherwise identical:

```
PromptBar.onSubmit(prompt)              (app chrome — not renderer UI)
  └─ App: setRoomSource(new GeneratedRoomSource(FakeRoomGenerator, prompt, logger))
       └─ RoomViewer (unchanged — sees only a RoomSource; new identity → reload)
            └─ GeneratedRoomSource.getRoom()
                 ├─ FakeRoomGenerator.generate(prompt) → raw untrusted JSON text
                 ├─ JSON.parse                          (never eval)
                 ├─ loadRoomSpec(parsed)                ✅ schema boundary (shape)
                 ├─ validateRoom(room)                  ✅ semantic boundary (playable)
                 └─ RoomLoadResult  (ok | invalid-room | unavailable)
                      └─ engine.setRoom(room)           ✅ trusted builders only
```

`RoomViewer` and the engine are **unchanged**: they still consume a `RoomSource`
and a validated `LoadedRoom`. Only the composition root knows a prompt or a fake
generator exists, and the prompt *text* is never logged — only its length.

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

## Generation Foundation v0 — module summary

| Module | Role |
| --- | --- |
| `domain/ports/RoomGenerator.ts` | The `RoomGenerator` port: `generate(prompt) → Promise<string>` of **raw, untrusted JSON text**. Domain-pure contract; the trust-boundary rules live in its doc comment. |
| `generation/prng.ts` | Deterministic seeded PRNG (`xmur3` + `mulberry32`) and a small `Rng` helper. Pure — no I/O, no `Math.random`/`Date.now`. |
| `generation/FakeRoomGenerator.ts` | A deterministic `RoomGenerator`: prompt → seeded PRNG → RoomSpec **data**, serialized with `JSON.stringify`. Emits only the published vocabulary; same prompt → byte-identical output. No real model. |
| `domain/validateRoom.ts` | Pure semantic validator: `validateRoom(room) → RoomValidationResult` of severity-tagged issues. Checks *playability* (dimensions, spawn-in-bounds, object/light budgets, usable interactions) over a loaded room — a domain peer of `loadRoomSpec`. No I/O, no logger, no React/Three ([ADR-0011](./decisions/ADR-0011-semantic-room-validator-v0.md)). |
| `room/GeneratedRoomSource.ts` | A `RoomSource` adapter (composition layer) that runs the generator's text through `JSON.parse` → `loadRoomSpec` (schema) → `validateRoom` (semantic), and maps the outcome to a typed `RoomLoadResult` (a fatal semantic issue → `invalid-room`). Owns parse + validation; logs length/counts/codes only. |
| `app/PromptBar.tsx` | Presentational prompt input + Generate button — app composition chrome, **not** renderer UI. Trims/validates; emits `onSubmit(prompt)`. |
| `App.tsx` | Composition root: holds the active `RoomSource` in state; on submit, swaps to `GeneratedRoomSource(FakeRoomGenerator, prompt, logger)`. The only place a generator is named. |

Tested with **Vitest**: the PRNG (determinism/divergence/ranges), the fake
generator (determinism, known-vocabulary-only, passes `loadRoomSpec`, data-only
round-trip), `validateRoom` (one fixture per rule, false-positive guards,
determinism + no input mutation, stable ordering), and the `GeneratedRoomSource`
paths (bad JSON, bad envelope, generator throws, lenient object-skip, semantic
fatal → `invalid-room`, semantic warnings → `ok:true`, and a regression guard that
every `FakeRoomGenerator` output has zero fatal semantic issues) — with prompt
text never logged.

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

### ✅ Generation Foundation v0  ·  🔜 real LLM

- ✅ A `RoomSource` **port** in the domain answers "give me a room". Two
  implementations exist: `StaticRoomSource` (the hardcoded `throneRoom`) and
  `GeneratedRoomSource` (prompt-driven).
- ✅ A `RoomGenerator` **port** in the domain turns a prompt into **raw, untrusted
  JSON text**. Its v0 implementation is the deterministic `FakeRoomGenerator`;
  `GeneratedRoomSource` runs that text through the *same* `loadRoomSpec`. The
  generator emits **data, never code**
  ([ADR-0001](./decisions/ADR-0001-data-only-room-spec-trusted-renderer.md),
  [ADR-0010](./decisions/ADR-0010-generation-foundation-v0.md)).
- 🔜 Swapping the fake for a **real LLM client** is a one-line change at the
  composition root — the port, the parse/validate boundary, and the renderer do
  not move. The model will return **RoomSpec JSON only**, never renderer code.
- ✅ Because `RoomSource.getRoom()` is async by contract, loading/error states and
  the React error boundary (see [FAILURE-MODES](./FAILURE-MODES.md)) are the same
  whether the room is static, generated, or fetched.
- 🔜 Generation is more than one model call: a prompt becomes a *validated,
  playable* room through a multi-stage pipeline with bounded repair and a safe
  fallback. v0 now implements stage 1 (generate) + schema validation **plus a
  first slice of stage 2** (a deterministic semantic validator,
  [ADR-0011](./decisions/ADR-0011-semantic-room-validator-v0.md)); the LLM reviewer
  and bounded repair remain future. See
  **[Generation pipeline](#generation-pipeline-planned)** below and
  [ADR-0007](./decisions/ADR-0007-generated-room-validation-and-repair.md).
- 🔜 Rooms are pre-generated ahead of the player so transitions feel instant. See
  **[Adjacent-room pre-generation](#adjacent-room-pre-generation-planned)** below
  and [ADR-0009](./decisions/ADR-0009-adjacent-room-pre-generation.md).

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

## Generation pipeline (planned)

🔜 **Designed, not built** — except the **deterministic code validator**, whose
first slice now ships ([ADR-0011](./decisions/ADR-0011-semantic-room-validator-v0.md)).
Full rationale and the retry/repair policy live in
[ADR-0007](./decisions/ADR-0007-generated-room-validation-and-repair.md);
per-case failure handling is in [FAILURE-MODES](./FAILURE-MODES.md).

A user prompt does not become a room in a single model call. It flows through a
pipeline whose job is to produce a room that is **both safe and good**, with
bounded cost and a guaranteed safe outcome:

```
  user prompt
      │
      ▼
  fast LLM  ──►  RoomSpec JSON            cheap, quick first draft
      │
      ▼
  schema validation     ── JSON shape/types (zod = the loadRoomSpec boundary)
      │
      ▼
  code validator        ── DETERMINISTIC code (not an LLM): reachable exit?
      │                    NPCs/objects not in walls? quest items placed?
      │                    object/light budget? spawn inside room?
      ▼
  LLM reviewer (optional)── creative/story quality: coherent, on-prompt, fun
      │
      ▼
  repair / regenerate   ── bounded loop (max 3 attempts, ~60s hard cap)
      │
      ▼
  trusted renderer      ── only ever sees a validated, accepted spec
      │
      ▼
  safe fallback room    ── if no acceptable room can be produced
```

**Four distinct checks — keep them separate:**

- **Schema validation** checks **JSON/shape** (the existing trust boundary).
- **Code validator** is **deterministic code, not an LLM** — it checks semantic
  playability. ✅ A v0 slice ships now (sane dimensions, spawn inside the walkable
  bounds, anchors within the footprint, object/light budgets, usable interactions;
  [ADR-0011](./decisions/ADR-0011-semantic-room-validator-v0.md)); 🔜 deeper
  reachability, object↔object collision, and quest consistency remain future.
- **LLM reviewer** checks **creative/story quality** — taste, not shape; it
  returns a verdict that feeds the repair loop, it does not edit the spec.
- **Valid JSON does not mean the room is playable or good.** Schema validation is
  necessary but not sufficient; the code validator and reviewer cover the gap.

**Retry/repair policy (v1):** fast model first → one fast repair attempt →
slow/better model fallback only if needed; **no infinite retries, max 3
attempts**; target **10–30s** for the first room, **~60s** hard cap; after a hard
failure, a **safe error with a retry button or a fallback demo room** — never an
unvalidated or known-bad room. The renderer's contract is unchanged: generation
adds checks *before* the `loadRoomSpec` boundary, it never weakens it.

## Adjacent-room pre-generation (planned)

🔜 **Designed, not built.** Full rationale in
[ADR-0009](./decisions/ADR-0009-adjacent-room-pre-generation.md).

The first room may cost up to ~60s once. To avoid that wait on every transition —
and because the world is effectively infinite, so it can't be generated up
front — the backend **pre-generates adjacent rooms in parallel while the player
explores the current room**. After the first room, the player should rarely wait.

**Generate the frontier, not the world.** Pre-generate only nearby reachable
rooms, by priority:

1. visible exits,
2. player-facing / nearest exit,
3. quest-critical path,
4. optional / secret exits — only after discovery.

**Limit parallel jobs** (e.g. **1–3 rooms** at a time) to bound cost and load.

**Room status lifecycle** — each room carries an explicit status:
`not_started → generating → validating → repairing → ready`, or `failed` if the
pipeline exhausts its attempts.

**At a door, behavior depends on status:**

| Status | Behavior |
| --- | --- |
| `ready` | instant transition |
| `generating` / `validating` / `repairing` | short "Opening the way…" wait |
| `failed` | retry / fallback room |
| `not_started` | generate on demand (the un-prefetched case) |

## Renderer portability (engine strategy)

🔜 **Direction.** Three.js is the v1 renderer and does not change. Full rationale
in [ADR-0008](./decisions/ADR-0008-renderer-portability-strategy.md).

The valuable core of this product is the **`RoomSpec`/`WorldSpec` contract,
validation, the generation pipeline, memory, persistence, and the renderer
adapter boundary — not the specific renderer.** To keep that core portable:

- **Three.js remains the correct renderer for browser-first v1.**
- **`RoomSpec`/domain stay renderer-agnostic.** Neutral data (positions, types,
  parameters), never one engine's API.
- **Never store Three.js objects in the domain or the DB** — no `Mesh`,
  `Material`, `Vector3`, or scene-graph node in domain types or stored rows.
  Persist the validated data spec only (see
  [ADR-0004](./decisions/ADR-0004-persistence-sqlite-to-postgres.md)).
- **Renderers are adapters over the same data contract.** A Three.js adapter
  today; **Babylon.js** possible later for richer web-engine features;
  **Unity/Godot** possible much later for native/desktop/mobile clients.
- **A non-web engine fits only by consuming the spec through trusted engine
  code.** A Unity client would have **trusted C#** load `RoomSpec` JSON and
  instantiate prefabs; a Godot client would have **trusted GDScript/C#** load it
  and instantiate nodes/resources — the same data-only → trusted-renderer rule as
  the Three.js builder registry.
- **The LLM must never generate** Three.js code, Unity C#, Godot GDScript, or any
  executable scene script. It emits `RoomSpec`/`WorldSpec` **data** only — same
  rule on every engine ([ADR-0001](./decisions/ADR-0001-data-only-room-spec-trusted-renderer.md)).

## Packaging decision

The domain/renderer/UI boundaries are real **today**, enforced by folder
structure, these docs, and lint rules — not by separate npm packages. A shared `packages/contracts` package is extracted only when a second
consumer of the RoomSpec contract exists (i.e. when the backend lands). See
[ADR-0005](./decisions/ADR-0005-defer-shared-package-extraction.md).
