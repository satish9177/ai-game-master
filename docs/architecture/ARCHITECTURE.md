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
  Generation Foundation v0; Semantic Room Validator v0; Room Generation Repair &
  Fallback v0; World Bible Seed v0 — browser-only; Isometric Camera Foundation;
  World State & Event Log v0; Object
  Interactions v0; Encounter System v0; Multi-Room Navigation & Cache v0; NPC
  Dialogue Foundation v0; Adjacent-Room Pre-generation v0 — browser/session-cache;
  Backend SQLite Persistence v0 — headless, Node-only;
  Backend World Session API v0 — headless, Node-only).
- 🔜 **Planned** — designed and approved, not yet built (next slices).
- ❌ **Not built** — future shape only; documented so we don't paint into a corner.

## Status today (Renderer Foundation v0)

A single Vite application at `apps/web`:

- **React 19 + TypeScript + Vite** — application shell and UI overlay.
- **Vanilla Three.js 0.184** (not react-three-fiber) — the rendering engine.
- **zod 4** — RoomSpec validation at the data boundary.
- **Node/TypeScript API + SQLite persistence** — headless, browser-excluded
  server build units under `src/server/**` and `src/persistence/**`.
- **No real LLM or browser API client.** Browser gameplay still uses the
  in-memory world/session and room/cache adapters.
- **World Bible Seed v0** deterministically derives validated, bounded initial
  canon for PromptBar-generated rooms; it has no backend persistence or UI.

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
  → FakeWorldBibleSeeder   (behind WorldBibleSeeder; deterministic, validated)
  → WorldBibleSeed         (bounded initial canon, not current truth)
  → worldBibleToGeneratorSeed (title-first compact seed, ≤160 chars)
  → FakeRoomGenerator      (behind RoomGenerator; seeded by the projection)
  → raw, untrusted JSON text
  → GeneratedRoomSource
  → assembleRoom           (parse → schema → semantic → repair → fallback)
  → RoomLoadResult         (valid generated/repaired/fallback room or unavailable)
  → existing trusted Three.js renderer
```

What it proves — and what it deliberately is **not**:

- **Deterministic fake only.** `FakeRoomGenerator` is pure: seed string → seeded
  PRNG → RoomSpec data. The same seed yields a byte-identical room. This generation
  path uses **no real LLM, API key, network call, database, or memory**.
- **Deterministic initial canon.** `FakeWorldBibleSeeder` implements the
  `WorldBibleSeeder` port, validates through `WorldBibleSeedSchema`, and projects
  title/theme/tone/opening context/premise/keywords to a stable ≤160-character
  generator seed. The bible is held only on generated `ActivePlay`; event-sourced
  `WorldState` remains authoritative ([ADR-0022](./decisions/ADR-0022-world-bible-seed-v0.md)).
- **The generator returns raw, untrusted JSON *text*** — the exact shape a future
  LLM completion would have. It emits **data, never code** ([ADR-0001](./decisions/ADR-0001-data-only-room-spec-trusted-renderer.md)).
- **`GeneratedRoomSource` owns safe assembly.** It routes raw text through
  `assembleRoom` (`JSON.parse` → `loadRoomSpec` → `validateRoom` → deterministic
  repair → fallback). Bad content still yields a valid room; only a generator
  throw/reject is `unavailable`. The renderer executes only trusted, hand-written
  builders.
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

The deterministic validator, one-pass repair/fallback, adjacent-room browser
warming, and World Bible seed now ship. The **real LLM**, deeper
reachability/collision checks, LLM reviewer, and bounded multi-attempt
repair/re-prompt loop remain **planned / not built** — see
[Generation pipeline](#generation-pipeline-planned),
[ADR-0010](./decisions/ADR-0010-generation-foundation-v0.md), and
[ADR-0022](./decisions/ADR-0022-world-bible-seed-v0.md).

## World Bible Seed v0

✅ **Implemented, deterministic and browser-local.** The PromptBar-generated-room
path now derives a compact, validated `WorldBibleSeed` before calling the existing
room generator ([ADR-0022](./decisions/ADR-0022-world-bible-seed-v0.md)).

- **Pure domain contract.** `domain/worldBible/` owns the strict bounded schema
  and the pure `worldBibleToGeneratorSeed` projection; `WorldBibleSeeder` is a
  domain port.
- **Deterministic fake.** `FakeWorldBibleSeeder` uses the seeded PRNG, maps only
  `fantasy-keep` / `post-apoc`, validates internally, and performs no network,
  database, clock, global-randomness, or logger work. No real LLM is present.
- **Prompt path only.** `App.handlePrompt` stores the bible on the fresh generated
  play and sends its ≤160-character title-first projection to `FakeRoomGenerator`.
  Authored bootstrap and `AdjacentRoomPregenerator` do not use the bible.
- **Initial canon, not current truth.** The bible is not an event, `WorldState`,
  `CanonSeed`, save-game field, API payload, or SQLite row. `WorldSession` and its
  event-log projection remain authoritative; no UI displays the bible.
- **Non-blocking.** Seeding failure restores the previous raw-prompt generator
  seed and stores no bible. Logs contain only safe enums/counts/lengths or a fixed
  failure code—never prompt, bible, seed, generated JSON, or error text.

## Room Generation Repair & Fallback v0

✅ **Implemented.** The **deterministic** remainder of the
[ADR-0007](./decisions/ADR-0007-generated-room-validation-and-repair.md) pipeline
now ships: a bad generated room is no longer just rejected to an error screen — it
is **repaired** when salvageable or replaced by a **trusted fallback room**, so the
renderer always receives a valid, playable room
([ADR-0020](./decisions/ADR-0020-room-generation-repair-fallback-v0.md)).

- **A pure domain pipeline `assembleRoom(rawText, fallbackRoom)`** composes the
  existing boundaries in order — `JSON.parse` → `loadRoomSpec` → `validateRoom` →
  `repairRoom` → re-`validateRoom` → fallback — and **always returns a valid,
  zero-fatal `LoadedRoom`** plus safe diagnostics. It is synchronous, does no I/O,
  imports no logger/React/Three.js/DB, and never logs (problems are returned as
  data, like `loadRoomSpec`/`validateRoom`).
- **Deterministic repair only (`repairRoom`).** A pure, non-mutating function that
  only *removes or clamps*, never invents content: clamp `spawn` into the walkable
  AABB (the same margin `validateRoom` uses), truncate objects to the hard object
  budget, and drop torches beyond the hard light budget. It **does not resize
  rooms** — `room-too-small` / `room-too-large` stay unrepairable and route to the
  fallback. Repair is **one pass**, then re-validate; no loop, no attempt budget.
- **An authored fallback room (`domain/examples/fallbackRoom.ts`).** A trusted,
  data-only literal — a small stone antechamber with a centered in-bounds spawn —
  authored to raise zero fatal and zero warning semantic issues, with no prompt or
  story text. The host validates it once and injects it.
- **Provenance + a static notice.** `GeneratedRoomSource` runs the generator, then
  `assembleRoom`, and returns `provenance` (`generated` | `repaired` | `fallback`)
  on an **`ok:true`** result — all three are valid rooms. Only a generator
  **throw/reject** stays `ok:false` `unavailable` (the retry path); bad *content*
  never becomes `unavailable`. `App` injects the fallback and shows a small
  **dismissable, static, prompt-free** notice for `repaired`/`fallback`, nothing
  for `generated`.
- **Safe diagnostics/logging only** — provenance, the failed stage, fixed
  `RoomIssueCode` values, counts, and booleans; never prompt text, raw JSON, story
  text, object names, or free-form parse/schema errors.
- **Unchanged:** the renderer/engine/builders, the schema and semantic boundaries,
  the `RoomSource` port (gains only an optional success-result `provenance`), the
  deterministic fake (every `FakeRoomGenerator` room is still `generated`), and the
  Node API. A **real** LLM repair/re-prompt, an LLM reviewer, a bounded
  multi-attempt loop, adjacent-room pre-generation, and a backend generation
  endpoint remain **future**.

## Isometric Camera Foundation

✅ **Implemented.** The default view is now a **controlled 3D / isometric
2.5D-style** presentation: a fixed orthographic true-isometric camera that
**follows a player object**, replacing Renderer Foundation v0's first-person
camera. This is a **presentation** change — still vanilla Three.js, still real 3D
objects and rooms, **RoomSpec JSON unchanged**, generation still **data only**,
and the trusted renderer still owns the camera, movement, and builders. Full
rationale in [ADR-0012](./decisions/ADR-0012-isometric-camera-foundation.md).

- **Player ↔ camera decoupling (the key change).** The engine owns a `player`
  (`THREE.Object3D`) that input drives; a `CameraController` derives the camera
  transform **from** the player each frame. Input never moves the camera directly.
  On room load the player is placed at the spawn point and the camera snaps to it.
- **`IsometricCameraController`** owns an `OrthographicCamera` at the fixed
  true-isometric angle (azimuth 45°, elevation `atan(1/√2) ≈ 35.264°`); a pure,
  WebGL-free `camera/isometric.ts` module holds the offset/pose/movement/frustum
  math (unit-tested), and the controller and movement are thin adapters over it.
- **Screen-relative movement.** `MovementControls` moves the player on the ground
  plane: **W/↑ up-screen (into the scene), S/↓ toward the camera, A/← and D/→
  strafe**; diagonals normalized, delta-time scaled, clamped to the room AABB.
- **Proximity reads the player**, not the camera, so HUD prompts and E/F dialogue
  behave as before but anchor to where the player actually stands.
- **A minimal player marker** (a renderer-internal `buildPlayerMarker()` capsule
  with a facing nose) is **not RoomSpec data**; it lives in the scene graph and is
  freed by the engine's normal disposal.
- **Isometric cutaway shell.** `buildShell` lowers the camera-facing **south/east**
  near walls to a low **curb** so they can't hide the player; the **north/west far
  walls stay full height** to preserve room shape (a dollhouse, not a closed box).
  The near sides are derived from the camera's offset direction; RoomSpec is
  untouched.
- **`LookControls` is retained but not instantiated** — kept for a future
  free-camera / first-person mode behind the same `CameraController` seam.

**V1's default visual direction is controlled 3D / isometric; full first-person /
free-camera 3D remains future and optional.** Camera mode is **renderer-internal
presentation**, never room data — a RoomSpec describes *what is in the room*, not
*how it is filmed*.

## World State & Event Log v0

✅ **Implemented, headless.** Authoritative gameplay truth now lives in an
append-only `WorldEvent[]`; `WorldState` is a pure, reconstructable projection
and its stored snapshot is only a cache. `CanonSeed` initializes the first
`session-started` event and never overrides subsequent play.

`WorldSession` exposes typed use-cases over `WorldStore`, `Clock`, and
`IdGenerator` ports. `InMemoryWorldStore` proves atomic append + snapshot commit
and optimistic concurrency without adding a database. The SaveGame boundary
serializes seed + log + snapshot, rejects unsupported versions, and rejects any
document whose seed or projected snapshot fails integrity. There is no renderer,
React, `App.tsx`, HTTP, database, LLM, dialogue, or memory wiring in this slice.
See [ADR-0013](./decisions/ADR-0013-world-state-event-log-v0.md).

## Object Interactions v0

✅ **Implemented.** E/F interactions can now produce authoritative world-state
effects without moving gameplay logic into the renderer. The engine still emits
only a neutral `Interactable` intent with an optional stable object id. At the
composition root, that id selects a validated, data-only `InteractionEffect`;
the pure `planInteraction` domain function maps it to existing `WorldCommand`s,
and `InteractionService` executes them only through `WorldSession.appendEvent`.

The v0 vocabulary is `inspect`, one-shot `take-item`, and inventory-gated
`use-item` with an optional health change. One-shot idempotency reuses
`room-state-changed.flags`; ADR-0013's seven-event union is unchanged. Missing
effects/ids, insufficient inventory, conflicts, and partial multi-command
failure are typed outcomes. The renderer imports neither `world-session` nor
`interactions` and never mutates `WorldState`. See
[ADR-0014](./decisions/ADR-0014-object-interactions-v0.md).

## Encounter System v0

✅ **Implemented.** A genre-neutral **encounter** layer sits parallel to Object
Interactions v0: a *threat* with a *description*, a set of *choices* (`fight`,
`hide`, `run`, `distract`, `negotiate`), and a deterministic *authored outcome*
per choice. It differs from an interaction in exactly one way — it is
**two-phase**: present the threat and its choices, then resolve the one the
player picks. Everything else reuses the ADR-0014 blueprint.

Encounters **ride the existing `Interaction`** (`interaction.encounter?`), so no
engine or `Interactable` change was needed; pressing E/F on an object whose
interaction carries an encounter triggers it, and an encounter **takes
precedence over an `effect`** when both are present. The pure `planEncounter`
maps the chosen choice to existing `WorldCommand`s (six effect atoms — `damage`,
`heal`, `add-status`, `clear-status`, `remove-item`, `add-item` — each 1:1 with
an existing command, no new event type), gated by an optional `requires`
possession check and a stable one-shot resolution flag in
`room-state-changed.flags`. `EncounterService` executes the plan through a shared
`world-session/applyCommands` helper (extracted from `InteractionService`, which
now reuses it) and returns a typed result; health may clamp to `0` with **no
death/game-over state**. Authored text (`description`, `title`, choice `label`,
`resultText`, status strings, item names) is display-only and never logged. See
[ADR-0015](./decisions/ADR-0015-encounter-system-v0.md).

## Multi-Room Navigation & Cache v0

✅ **Implemented.** Authored objects may carry the data-only
`interaction.exit: { toRoomId }`; the two example rooms connect through stable
interactable north arches. `RoomViewer` maps the renderer's neutral object id to
exit metadata and applies composition precedence **exit → encounter → dialogue → effect**.
The engine still emits intent only and was not changed.

`RoomRegistry` validates registered example rooms through `loadRoomSpec`,
`SessionRoomCache` reuses each loaded room verbatim for one play session, and
`NavigationService` resolves the target before calling the existing
`WorldSession.move`. A failed resolve appends nothing. A successful move appends
only `moved-to-room`; the existing reducer marks the destination visited.

`App` owns the persistent example-world session and cache across transitions.
Changing the active preloaded room disposes and rebuilds the engine, while the
session's visited and interaction/encounter flags survive and returning reuses
the cached room. Prompt-generated rooms remain fresh single-room sessions with
fresh caches. See
[ADR-0016](./decisions/ADR-0016-multi-room-navigation-cache-v0.md).

## NPC Dialogue Foundation v0

✅ **Implemented.** A validated `interaction.dialogue` marker opts an NPC into a
read-only conversation path. The pure `buildDialogueContext` projection selects
current room/player facts without inventory names; `NPCDialogueService` reads
through `WorldSession.getWorldState` and delegates to the domain
`NPCDialogueProvider` port. Its deterministic fake provider performs no network
I/O and returns display text data only.

The composition root resolves the renderer's neutral object id with precedence
**exit → encounter → dialogue → effect**. Dialogue-bearing NPCs open the
presentational `NPCDialoguePanel`, which offers authored canned prompts or
Continue—never free text. Conversation history stays in component state and
resets on close or room change. Dialogue appends no event, sets no room flag,
and changes no world state. See
[ADR-0017](./decisions/ADR-0017-npc-dialogue-foundation-v0.md).

## Adjacent-Room Pre-generation v0

✅ **Implemented (browser / session-cache).** The deterministic browser subset of
[ADR-0009](./decisions/ADR-0009-adjacent-room-pre-generation.md) now ships: while
the player explores, the rooms behind the current room's exits are **warmed in the
background**, and a room is **resolved safely on demand at the door** — including
generating a non-authored target instead of blocking
([ADR-0021](./decisions/ADR-0021-adjacent-room-pregeneration-v0.md)).

- **One room-acquisition seam (`app/AdjacentRoomPregenerator.ts`).** A single
  composition-layer object serves **both** background warming and on-demand door
  resolution over **one** `SessionRoomCache` and **one** in-flight promise map, so
  a door request and a background warm for the same id collapse into a single job.
  Constructed once in `App` for the play session.
- **`resolveRoom(roomId)` is total, cache-first, in-flight-aware.** Cache hit →
  return; else join an in-flight job; else run one job (cleared in `finally`).
  Authored ids resolve through `RoomRegistry` (`registry.has` picks the branch and
  authored rooms are **never** fake-generated); non-authored/unknown ids generate
  through `GeneratedRoomSource → assembleRoom → repairRoom → fallbackRoom`. It
  **never throws** — an unexpected fault maps to a typed `unavailable` and caches
  nothing.
- **The trust boundary holds.** Every generated adjacent room passes through
  `assembleRoom` before it can enter the cache, so only valid, zero-fatal rooms
  are cached. A generated room is **id-normalized** (`withRoomId`, a fresh spread)
  so the cache key and `room.id` agree; `id` is not a `validateRoom` input, so
  this is semantics-preserving, with a defensive re-validate as a guard.
- **`warmAdjacent(room)` is bounded and fire-and-forget.** It warms the current
  room's exits in declaration order, deduped, skipping cached/in-flight ids,
  capped at **`maxJobs` (default 3)**. **Depth = 1, never recursive:** it is
  called only from the composition root (after bootstrap and after each
  navigation), never from inside `resolveRoom`, so pre-generation cannot fan out
  through the world.
- **`NavigationService` depends only on the narrow `RoomResolver` (DIP).** Room
  acquisition moved out of the service; it resolves the target (now possibly by
  generating it) before appending `moved-to-room`. A non-authored target now
  navigates via on-demand generation instead of "the way is blocked".
- **Safe logging only** — ids, codes, counts, booleans, provenance; the seed is
  the **structural room id** (`adjacent:${roomId}`), never a user prompt, and
  neither seed text, raw JSON, story text, nor object names are logged.
- **Unchanged:** the renderer/engine (still intent-only), the domain/schema, the
  `RoomSource` port, the Node API, and the PromptBar generated single-room path (a
  fresh session + cache, no navigation, no warming). In the authored two-room loop
  both rooms warm through the registry, so transitions stay instant and the
  user-visible behavior is unchanged; the generation branch is covered by unit
  tests, not the example world. A backend generation endpoint, a real LLM, the
  per-room status lifecycle / "Opening the way…" UI, a parallel-job system, and
  recursive pre-generation remain **future**.

## Backend SQLite Persistence v0

✅ **Implemented, headless and Node-only.** The first durable store lands as a
physically separate, browser-excluded build unit under
`apps/web/src/persistence/**` — proving ADR-0013's promise that "a server-side
SQLite adapter implements the same `WorldStore` port with **no domain change**".
The Node API composes these stores for durable session/room endpoints. The
running browser app is **not** wired to that API or SQLite; it keeps its
in-memory adapters.

- **Driver.** Node v24's built-in `node:sqlite` (`DatabaseSync`) — zero new
  runtime dependencies, no native build. `db.ts` opens a connection (file path or
  `:memory:`), sets per-connection PRAGMAs (`foreign_keys`, `busy_timeout`, WAL),
  and exposes a `withTransaction` (`BEGIN IMMEDIATE`) helper and a forward-only
  `runMigrations`. Parameterized SQL lives **only** in the adapter/migration files.
- **Migrations.** Numbered, forward-only; `0001_init` creates `world_sessions`,
  `world_events`, `rooms`, and the append-only `world_events` triggers, while
  `runMigrations` owns the idempotent `schema_migrations` bookkeeping. Each
  migration runs in one transaction and rolls back wholesale on failure.
- **`SqliteWorldStore`** implements the unchanged `WorldStore` port: append-only
  events (`UNIQUE(session_id, seq)` + DB triggers), the session-computed
  `WorldState` snapshot persisted **atomically** alongside its event, and
  optimistic concurrency as a `revision` compare-and-set. The store never computes
  projections — the `WorldSession` hands it `{ event, snapshot }`.
- **`RoomStore` + `SqliteRoomStore`** (new port) persist the validated RoomSpec
  **data document** (never renderer objects), upsert by stable `roomId`
  (last-writer-wins), and load back through the same `loadRoomSpec` boundary.
- **Provably excluded from the browser bundle:** `tsconfig.app.json` excludes
  `src/persistence`, a Node `tsconfig.persistence.json` type-checks it via
  `tsc -b`, Vite never reaches it from `main.tsx`, and bidirectional ESLint walls
  forbid the browser surface from importing `node:sqlite`/persistence and forbid
  persistence from importing React/Three/renderer/app layers. Validation happens
  at the read/write boundary; logs carry ids/counts/codes only. See
  [ADR-0018](./decisions/ADR-0018-backend-sqlite-persistence-v0.md).

## Backend World Session API v0

✅ **Implemented, headless and Node-only.** A native `node:http` edge under
`apps/web/src/server/**` composes `WorldSession`, `SqliteWorldStore`, and
`SqliteRoomStore` without changing their ports or importing frontend/renderer
code ([ADR-0019](./decisions/ADR-0019-backend-world-session-api-v0.md)).

- **Endpoints.** `GET /health`; create/read/event-list/move session routes; and
  save/get room routes. Requests are zod-validated and expected application
  outcomes map to safe 4xx envelopes; unexpected faults map to generic 5xx.
- **Startup and local run.** `npm run dev:api` uses the `tsx` devDependency.
  `AIGM_DB_PATH` overrides the default persistent
  `.data/aigm-dev.sqlite`; migrations run before the server listens and fail
  fast.
- **Physical separation.** `tsconfig.server.json` type-checks the server with
  Node types/no DOM, `tsconfig.app.json` excludes it, Vite cannot reach it from
  `main.tsx`, and reciprocal ESLint walls keep server/DB imports out of browser
  code.
- **No frontend wiring.** `App.tsx`, `RoomViewer.tsx`, navigation, and the
  renderer still use in-memory adapters. No CORS/proxy/browser fetch client,
  hosted deployment, FastAPI, or Python backend is part of this MVP path.

## Layered architecture

Dependencies point **inward**, toward the domain. Outer layers may depend on
inner layers; inner layers never depend on outer layers.

```
        ┌────────────────────────────────────────────────────────┐
        │  DOMAIN / CONTRACTS  (pure data + types, zero I/O)       │
        │  RoomSpec + World schemas · pure validators/projections  │
        │  ✅ ports: RoomSource, RoomGenerator, WorldStore, time/id │
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
| **Domain / Contracts** | Room, authoritative world, and initial-canon `WorldBibleSeed` contracts; pure validation/projection, types, and ports. | Nothing (only zod) | React, Three.js, DOM, network, DB |
| **Renderer** (`renderer/engine`) | Turn a validated room into a Three.js scene; own the render loop, controls, disposal. | Domain | React, network, DB |
| **UI** (`renderer/ui`) | Presentational React overlay (HUD, dialogue panel). | Domain, approved host contract | Three.js internals, network, DB |
| **App / Composition root** | Wire concrete implementations, including prompt-only bible seeding/degradation and generated-session ownership. | All of the above | — |
| ✅ **Generation (v0, fake)** | Prompt → validated **WorldBibleSeed data** and compact seed → **RoomSpec data** via deterministic silent fakes. Never code. 🔜 real LLM adapters. | Domain | Logger/platform, Renderer, React, DB |
| ✅ **World session (v0, headless)** | Commands → validated append-only events → pure `WorldState` projection; in-memory store and SaveGame boundary. | Domain, Logger port | React, Three.js, Renderer, DB |
| ✅ **Interactions (v0, headless)** | Pure effect plans executed through `WorldSession.appendEvent`; typed outcomes for composition. | Domain, World session, Logger port | React, Three.js, Renderer, DB |
| ✅ **Encounters (v0, headless)** | Pure encounter plans executed through `WorldSession.appendEvent` (shared `applyCommands`); typed two-phase outcomes for composition. | Domain, World session, Logger port | React, Three.js, Renderer, DB |
| ✅ **Dialogue (v0, headless)** | Pure dialogue context plus a read-only service over `WorldSession.getWorldState` and an injected provider port. | Domain, World session, Logger port | React, Three.js, Renderer, DB |
| ✅ **Persistence (v0, headless, Node-only)** | `node:sqlite` migrations + `SqliteWorldStore` + `SqliteRoomStore`. Consumed by the Node API; never by the browser. | Domain contracts/ports, Logger **types**, `node:sqlite` | React, Three.js, Renderer, UI, Generation, World session, Interactions, Encounters, Dialogue, App, Server |
| ✅ **Backend / HTTP API v0** | Native `node:http` session/room edge over `WorldSession` and SQLite stores. Browser-excluded; no generation hosting or frontend client yet. | Domain, World session, Persistence, Platform | React, Three.js, UI, Renderer |

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
       │    ├─ buildShell(room)           floor + walls (north exit split; iso cutaway curbs)
       │    ├─ buildObjects(room)         type→builder registry, placeholder fallback
       │    ├─ buildPlayerMarker()        renderer-internal player object (not RoomSpec data)
       │    ├─ IsometricCameraController  orthographic iso camera; follows the player
       │    └─ MovementControls           screen-relative WASD/arrows → player (AABB clamp)
       │       (LookControls retained but NOT instantiated — future free-camera mode)
       ├─ engine.onActiveInteractionChange → React state → <Hud/>
       └─ engine.onRequestOpenInteraction  → RoomViewer id lookup
            ├─ exit? → NavigationService → existing moved-to-room
            ├─ encounter? → present choices → EncounterService (on choose)
            ├─ dialogue? → NPCDialogueService.getWorldState → fake provider
            │    → component-only history → <NPCDialoguePanel/>
            └─ else effect? → InteractionService
                 → WorldSession.appendEvent (shared applyCommands)
                 → typed result message → <DialoguePanel/>
```

The React ↔ engine seam is **callbacks + imperative methods**, not shared
mutable state and not React reaching into Three.js objects. That seam is the
"approved host interface" referenced in [BOUNDARIES](./BOUNDARIES.md).

### Generated-room data flow (Generation Foundation v0)

Submitting a prompt swaps the room source; the host path is otherwise identical:

```
PromptBar.onSubmit(prompt)                    (app chrome — not renderer UI)
  └─ App.handlePrompt
       ├─ FakeWorldBibleSeeder.seed(prompt)   → validated WorldBibleSeed
       │    └─ failure → raw prompt seed + no worldBible
       ├─ worldBibleToGeneratorSeed(bible)    → compact title-first generatorSeed
       └─ GeneratedRoomSource(FakeRoomGenerator, generatorSeed, logger, fallbackRoom)
            ├─ FakeRoomGenerator.generate(generatorSeed) → raw untrusted JSON text
            │     └─ throw/reject → RoomLoadResult unavailable (retry path)
            ├─ assembleRoom(rawText, fallbackRoom) ✅ pure domain pipeline
            │     JSON.parse → loadRoomSpec → validateRoom → repairRoom → re-validate → fallback
            │     └─ ALWAYS { room (zero-fatal), diagnostics }
            └─ RoomLoadResult { ok:true, room, provenance } (generated | repaired | fallback)
                 ├─ start unchanged WorldSession; keep optional bible in ActivePlay
                 ├─ static notice if repaired | fallback
                 └─ RoomViewer/engine receive only the validated room
```

`RoomViewer` and the engine are **unchanged**: they still consume a `RoomSource`
and a validated `LoadedRoom`. Only composition knows the prompt, world bible,
generator seed, fakes, or fallback exists. Logs contain safe enums/counts/codes/
lengths only—never prompt/bible/seed/generated JSON/error text. Bad room content
yields a repaired or fallback room (`ok:true`); world-bible failure degrades to
the raw-prompt seed, and only a room-generator throw/reject is `unavailable`.

## Renderer Foundation v0 — module summary

| Module | Role |
| --- | --- |
| `domain/roomSpec.ts` | `RoomSpecSchema` (envelope) + `RoomObjectSchema` (discriminated union on `type`); inferred `RoomSpec` / `RoomObject` types. Schema/types only, no behavior. |
| `domain/loadRoomSpec.ts` | `loadRoomSpec` (strict envelope, lenient objects) + the `LoadedRoom` result type. |
| `domain/ports/interaction.ts` | The neutral interaction view-model shared by the engine and UI, including an optional passive object id for composition lookup. |
| `domain/examples/throneRoom.ts` | The single hardcoded demo room — pure data literal. |
| `renderer/engine/Engine.ts` | Owns renderer/scene, the **player object** + a `CameraController` (isometric), render loop, **player-position** proximity, interaction keys, and **total `dispose()`**. No React. |
| `renderer/engine/camera/` | `CameraController` interface + `IsometricCameraController` (orthographic true-isometric, follows the player) over a pure, WebGL-free `isometric.ts` math module (offset / pose / screen-relative move / clamp / frustum). |
| `renderer/engine/playerMarker.ts` | `buildPlayerMarker` — the minimal **renderer-internal** player marker (capsule + facing nose). Presentation, **not** RoomSpec data. |
| `renderer/engine/builders/` | `buildShell` (floor + walls, with isometric **cutaway curbs** on the camera-facing walls), `buildLighting`, and the object `registry` + `buildObjects` with magenta-placeholder fallback. |
| `renderer/engine/controls/` | `MovementControls` (screen-relative WASD/arrows driving the **player**, room-clamped); `LookControls` (drag-look) **retained but not instantiated** in isometric mode. |
| `renderer/engine/disposables.ts` | `Disposables` + `disposeObject` — explicit GPU teardown (Three.js does not GC geometries/materials/textures). |
| `renderer/ui/` | `Hud` and `DialoguePanel` — presentational React only; the panel accepts a plain optional interaction-result message. |
| `renderer/RoomViewer.tsx` | The composition seam: constructs/disposes the engine, bridges engine callbacks to React state. StrictMode-safe (mount → dispose → mount leaks nothing). |

## Generation Foundation v0 — module summary

| Module | Role |
| --- | --- |
| `domain/ports/RoomGenerator.ts` | The `RoomGenerator` port: `generate(prompt) → Promise<string>` of **raw, untrusted JSON text**. Domain-pure contract; the trust-boundary rules live in its doc comment. |
| `domain/ports/WorldBibleSeeder.ts` | Domain-safe `WorldBibleSeeder` port: prompt → validated `WorldBibleSeed`. |
| `domain/worldBible/worldBibleSeed.ts` | Strict, versioned, bounded initial-canon schema/types, including the bounded opening arc. Not event/current-state data. |
| `domain/worldBible/worldBibleToSeed.ts` | Pure deterministic title-first projection to a generator seed capped at 160 characters. |
| `generation/FakeWorldBibleSeeder.ts` | Browser-local deterministic seeder over the shared PRNG and two theme packs; validates internally, has no real model/I/O/logger. |
| `generation/prng.ts` | Deterministic seeded PRNG (`xmur3` + `mulberry32`) and a small `Rng` helper. Pure — no I/O, no `Math.random`/`Date.now`. |
| `generation/FakeRoomGenerator.ts` | A deterministic `RoomGenerator`: prompt → seeded PRNG → RoomSpec **data**, serialized with `JSON.stringify`. Emits only the published vocabulary; same prompt → byte-identical output. No real model. |
| `domain/validateRoom.ts` | Pure semantic validator: `validateRoom(room) → RoomValidationResult` of severity-tagged issues. Checks *playability* (dimensions, spawn-in-bounds, object/light budgets, usable interactions) over a loaded room — a domain peer of `loadRoomSpec`. No I/O, no logger, no React/Three ([ADR-0011](./decisions/ADR-0011-semantic-room-validator-v0.md)). |
| `domain/repairRoom.ts` | Pure deterministic repair: `repairRoom(room) → LoadedRoom`. Non-mutating; only clamps spawn into the walkable AABB and truncates over-hard-budget objects/torches — never resizes rooms or invents content. Code peer of `validateRoom` ([ADR-0020](./decisions/ADR-0020-room-generation-repair-fallback-v0.md)). |
| `domain/assembleRoom.ts` | Pure assembly pipeline: `assembleRoom(rawText, fallbackRoom) → { room, diagnostics }`. Composes `JSON.parse` → `loadRoomSpec` → `validateRoom` → `repairRoom` → re-validate → fallback; **always** returns a zero-fatal room plus safe diagnostics (provenance/stage/codes/counts/booleans). Synchronous, no I/O, never logs ([ADR-0020](./decisions/ADR-0020-room-generation-repair-fallback-v0.md)). |
| `domain/examples/fallbackRoom.ts` | The trusted, data-only fallback room (the `throneRoom` authoring pattern): a small in-bounds stone antechamber, zero fatal/zero warning, no prompt or story text. Injected by the host as `assembleRoom`'s last resort. |
| `room/GeneratedRoomSource.ts` | A `RoomSource` adapter (composition layer) that runs the generator, then `assembleRoom`. A generator throw/reject → `unavailable`; otherwise **always** `ok:true` with `provenance` (`generated`/`repaired`/`fallback`). Logs one safe line (provenance/stage/codes/counts) — never prompt/raw JSON/story text/object names. |
| `app/AdjacentRoomPregenerator.ts` | Composition-layer room-acquisition seam ([ADR-0021](./decisions/ADR-0021-adjacent-room-pregeneration-v0.md)). `resolveRoom(id)` is cache-first, in-flight-aware, and total (authored → `RoomRegistry`; non-authored → `GeneratedRoomSource → assembleRoom`, id-normalized; never throws). `warmAdjacent(room)` warms the current room's exits in the background, capped at `maxJobs` (default 3), depth-1. Implements the narrow `RoomResolver` that `NavigationService` depends on. |
| `app/PromptBar.tsx` | Presentational prompt input + Generate button — app composition chrome, **not** renderer UI. Trims/validates; emits `onSubmit(prompt)`. |
| `app/worldBible.ts` | Prompt-path composition helper: seed + project + safe enum/count/length logging; on failure return the raw prompt and no bible. |
| `app/fallbackNotice.ts` | The static, prompt-free notice copy + the pure `shouldShowFallbackNotice(provenance)` decision (show for `repaired`/`fallback`). |
| `App.tsx` | Composition root: constructs both fakes once; PromptBar submit seeds/projects a bible, passes the compact seed to unchanged `GeneratedRoomSource`, and stores the optional bible on generated `ActivePlay`. Authored bootstrap/pregeneration remain bible-free. |

Tested with **Vitest**: the PRNG (determinism/divergence/ranges), the fake
room generator, `WorldBibleSeed` schema/projection, `FakeWorldBibleSeeder`
(determinism, two-way theme mapping, bounds, data-only/no side effects), the
non-blocking app helper and its leakage guard, `validateRoom`, repair/fallback,
and all `GeneratedRoomSource` paths. Log-safety tests cover raw prompts, derived
seeds, bible/story/opening-arc text, keywords, generated JSON, and error details.

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

These seams include both implemented foundations and future adapters. The point
is to keep each replacement local to its port.

### ✅ Generation Foundation v0  ·  🔜 real LLM

- ✅ A `RoomSource` **port** in the domain answers "give me a room". Two
  implementations exist: `StaticRoomSource` (the hardcoded `throneRoom`) and
  `GeneratedRoomSource` (prompt-driven).
- ✅ A `RoomGenerator` **port** in the domain turns a seed string into **raw,
  untrusted JSON text**. Its v0 implementation is deterministic
  `FakeRoomGenerator`; `GeneratedRoomSource` runs the text through `assembleRoom`.
  The generator emits **data, never code**
  ([ADR-0001](./decisions/ADR-0001-data-only-room-spec-trusted-renderer.md),
  [ADR-0010](./decisions/ADR-0010-generation-foundation-v0.md)).
- ✅ A `WorldBibleSeeder` **port** turns the PromptBar prompt into validated,
  bounded initial canon. `FakeWorldBibleSeeder` + `WorldBibleSeedSchema` +
  `worldBibleToGeneratorSeed` provide the deterministic local implementation;
  authored bootstrap and adjacent pre-generation remain bible-free
  ([ADR-0022](./decisions/ADR-0022-world-bible-seed-v0.md)).
- 🔜 Real LLM adapters may replace either fake behind the existing ports; the
  schema/assembly boundaries, authority model, and renderer do not move. Model
  output remains validated data only, never renderer code.
- ✅ Because `RoomSource.getRoom()` is async by contract, loading/error states and
  the React error boundary (see [FAILURE-MODES](./FAILURE-MODES.md)) are the same
  whether the room is static, generated, or fetched.
- ✅ Generation is more than one model call: a prompt becomes a *validated,
  playable* room through a multi-stage pipeline with bounded repair and a safe
  fallback. v0 now implements stage 1 (generate) + schema validation, the
  **deterministic semantic validator**
  ([ADR-0011](./decisions/ADR-0011-semantic-room-validator-v0.md)), and the
  **deterministic repair + trusted fallback room**
  ([ADR-0020](./decisions/ADR-0020-room-generation-repair-fallback-v0.md)) — so the
  renderer always gets a valid room. 🔜 The LLM reviewer and the bounded
  multi-attempt repair/re-prompt loop remain future. See
  **[Generation pipeline](#generation-pipeline-planned)** below and
  [ADR-0007](./decisions/ADR-0007-generated-room-validation-and-repair.md).
- ✅ Rooms are pre-generated ahead of the player so transitions feel instant — the
  **browser/session-cache subset** now ships (background frontier warming +
  safe on-demand door resolution through the shared `assembleRoom` pipeline;
  [ADR-0021](./decisions/ADR-0021-adjacent-room-pregeneration-v0.md)). 🔜 the
  backend, real-LLM, per-room status lifecycle, and parallel-job shape remain
  future. See **[Adjacent-room pre-generation](#adjacent-room-pre-generation-browser-subset-shipped)**
  below and [ADR-0009](./decisions/ADR-0009-adjacent-room-pre-generation.md).

### ✅ World State & Event Log v0  ·  ✅ SQLite + Node HTTP API  ·  🔜 PostgreSQL

- ✅ `CanonSeed`, `WorldEvent`, `WorldCommand`, `WorldState`, and `SaveGame` are
  versioned neutral-JSON domain schemas. The event log is authoritative; the
  snapshot must equal `projectWorldState(log)`.
- ✅ `WorldStore`, `Clock`, and `IdGenerator` are domain ports. `WorldSession`
  depends on them by constructor injection and returns typed expected failures.
- ✅ `InMemoryWorldStore` atomically appends an event and replaces its projected
  snapshot under an optimistic revision check. It exposes no event mutation or
  deletion path.
- ✅ Save/load revalidates schemas, log shape, seed identity, and snapshot
  integrity. Unknown versions and tampering are rejected, never silently fixed.
- ✅ A server-side **SQLite** adapter now implements the same `WorldStore` port
  with **no domain change** (`SqliteWorldStore`, headless and Node-only,
  [ADR-0018](./decisions/ADR-0018-backend-sqlite-persistence-v0.md)): append-only
  events behind `UNIQUE(session_id, seq)` + DB triggers, atomic snapshot commit,
  and `revision` compare-and-set concurrency.
- ✅ The native Node HTTP edge exposes session create/state/events/move over
  `WorldSession` + `SqliteWorldStore` with typed safe errors ([ADR-0019](./decisions/ADR-0019-backend-world-session-api-v0.md)).
- 🔜 A **PostgreSQL** dialect, hosted deployment, browser API client, and memory
  system remain future. Browser gameplay still uses the in-memory adapters.

### ✅ Object Interactions v0  ·  🔜 richer gameplay effects

- ✅ `InteractionEffect` is a closed, data-only domain union. RoomSpec may attach
  an optional effect to an interaction; presentation-only interactions remain
  valid.
- ✅ `planInteraction` deterministically produces existing `WorldCommand`s or a
  typed no-op/rejection. One-shot effects require a stable idempotency key and
  record it in the current room's flags.
- ✅ `InteractionService` threads revisions through `WorldSession.appendEvent`.
  The composition root uses the persistent example-world session across room
  navigation and sends a plain result message to the existing dialogue panel;
  prompt-generated rooms still start fresh single-room sessions.
- ✅ The renderer remains intent-only: it passes a passive object id through the
  neutral host callback and never imports the interaction service or world state.
- 🔜 Cooldowns, random loot, quest gates, combat, dialogue trees, persistence,
  and cross-event transactional commits remain future work.

### ✅ Encounter System v0  ·  🔜 richer threat outcomes

- ✅ `EncounterSpec` is a closed, data-only domain descriptor (genre-neutral
  `action` enum + six generic effect atoms). RoomSpec may attach an optional
  `encounter` to the shared `Interaction`; an encounter takes precedence over an
  `effect` when both are present.
- ✅ `planEncounter` deterministically maps the chosen choice to existing
  `WorldCommand`s (no new event type) behind an optional `requires` gate and a
  stable one-shot resolution flag; `EncounterService` executes them through the
  shared `world-session/applyCommands` helper, which `InteractionService` also
  uses.
- ✅ The composition root routes an E/F open to a two-phase encounter panel
  (description + choice buttons) when the object has an encounter; the renderer
  still only emits intent.
- 🔜 Randomness/dice via a seeded `Rng` port, death/downed state, richer cross-room
  consequences, cooldowns/escalation, and LLM-authored encounter data remain
  future work.

### ✅ Multi-Room Navigation & Cache v0  ·  ✅ durable room API  ·  🔜 browser wiring

- ✅ `RoomRegistry` resolves the two authored rooms through `loadRoomSpec`, while
  `SessionRoomCache` holds identical `LoadedRoom` references for one session.
- ✅ `NavigationService` is cache-first and resolves before appending the existing
  `moved-to-room`; unknown/invalid targets and self-navigation append nothing.
- ✅ `App` keeps the session/cache alive while `RoomViewer` rebuilds the unchanged
  engine for each active room. Return visits preserve visited and resolution
  flags, with exit → encounter → dialogue → effect precedence at composition.
- ✅ A headless **`RoomStore` port + `SqliteRoomStore`** persist validated
  RoomSpec data documents by stable `roomId` (upsert, last-writer-wins), loaded
  back through `loadRoomSpec` — the durable analog of `RoomRegistry.resolve`
  ([ADR-0018](./decisions/ADR-0018-backend-sqlite-persistence-v0.md)). The Node
  API exposes validated `PUT/GET /rooms/:roomId` routes ([ADR-0019](./decisions/ADR-0019-backend-world-session-api-v0.md)).
- ✅ Browser navigation resolves rooms through `AdjacentRoomPregenerator` — one
  seam shared by background frontier warming and on-demand door resolution over
  `RoomRegistry`/`SessionRoomCache`; `NavigationService` depends only on the narrow
  `RoomResolver` ([ADR-0021](./decisions/ADR-0021-adjacent-room-pregeneration-v0.md)).
- 🔜 Wiring it to durable rooms, more than two rooms, entry-aligned spawn,
  transition animation, a minimap, and the backend/real-LLM/status-lifecycle
  shape of pre-generation remain future work.

### ✅ NPC Dialogue Foundation v0  ·  🔜 real provider

- ✅ `NPCDialogueSpec` is validated display/seed data on the shared Interaction;
  `buildDialogueContext` is a pure projection of current authoritative facts.
- ✅ `NPCDialogueProvider` is the external-provider seam. The v0 fake is
  deterministic, static, and performs no network I/O.
- ✅ `NPCDialogueService` injects only the `getWorldState` read path and returns
  typed replies/failures. Repeated turns leave the event log unchanged.
- ✅ `NPCDialoguePanel` is presentational; canned prompts/Continue and conversation
  history live only in component state. The renderer still emits intent only.
- 🔜 A real validated LLM adapter, free-text input, persistent memory, relationship
  state, summaries/vector recall, speech, and quests remain future work.

### ✅ Backend / API v0  ·  🔜 generation hosting and browser client

- ✅ A browser-excluded native `node:http` server exposes health, durable world
  session, move, and room endpoints over SQLite.
- ✅ Requests are validated at the HTTP boundary; RoomSpecs reuse the domain
  schema/loader and responses expose safe typed envelopes.
- ✅ The MVP backend path is Node/TypeScript (`tsx` for local development), not
  FastAPI/Python.
- 🔜 Real generation hosting, credentials, CORS/proxy configuration, a browser
  fetch client, auth, and hosted deployment remain future.

### ✅ Persistence (SQLite, headless v0)  ·  🔜 PostgreSQL later

- ✅ Repository **ports** live in the domain (`WorldStore`, the new `RoomStore`);
  the SQLite adapters live in the Node-only `src/persistence/**` build unit. UI
  and renderer **never** touch SQL or a DB driver — enforced by tsconfig
  exclusion, Vite reachability, and the reciprocal ESLint wall.
- ✅ SQLite is a *server-side*, Node-only store (`node:sqlite`), **not** an
  in-browser database. The Node API consumes it; browser gameplay remains on
  in-memory adapters.
- 🔜 The dual-dialect query layer and the PostgreSQL migration remain future shape
  only. See [ADR-0004](./decisions/ADR-0004-persistence-sqlite-to-postgres.md),
  [ADR-0018](./decisions/ADR-0018-backend-sqlite-persistence-v0.md).

## Generation pipeline (planned)

🔜 **Designed, not built** — except the deterministic stages, which now ship: the
**World Bible seed/projection**
([ADR-0022](./decisions/ADR-0022-world-bible-seed-v0.md)), the **code validator**
([ADR-0011](./decisions/ADR-0011-semantic-room-validator-v0.md)), and the
**deterministic repair + safe fallback room**
([ADR-0020](./decisions/ADR-0020-room-generation-repair-fallback-v0.md)). The
**real LLM**, the **LLM reviewer**, and the **bounded multi-attempt repair/regenerate
loop** remain future. Full rationale and the retry/repair policy live in
[ADR-0007](./decisions/ADR-0007-generated-room-validation-and-repair.md);
per-case failure handling is in [FAILURE-MODES](./FAILURE-MODES.md).

A user prompt does not become a room in a single model call. It flows through a
pipeline whose job is to produce a room that is **both safe and good**, with
bounded cost and a guaranteed safe outcome:

```
  user prompt
      │
      ▼
  WorldBibleSeeder ──► validated initial canon  ✅ deterministic fake today
      │
      ▼
  compact seed projection                       ✅ bounded/title-first today
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

✅ The **deterministic** subset of "repair → fallback" now ships
([ADR-0020](./decisions/ADR-0020-room-generation-repair-fallback-v0.md)): a pure
`assembleRoom` runs a **single** deterministic `repairRoom` pass (clamp spawn,
truncate over-budget objects/lights — no resizing) and re-validates, then returns
a trusted **fallback room** if any JSON/schema/semantic/repair failure remains, so
the renderer always gets a valid room. The multi-attempt loop, the corrective
re-prompt, the slow-model fallback, and the LLM reviewer remain future — they need
a real, non-deterministic model.

## Adjacent-room pre-generation (browser subset shipped)

✅ **Browser/session-cache subset shipped**
([ADR-0021](./decisions/ADR-0021-adjacent-room-pregeneration-v0.md), summarized in
[Adjacent-Room Pre-generation v0](#adjacent-room-pre-generation-v0) above) ·
🔜 **the backend/real-LLM shape below is still future**
([ADR-0009](./decisions/ADR-0009-adjacent-room-pre-generation.md)). v0 ships the
deterministic browser core — one `AdjacentRoomPregenerator` seam that warms the
current room's exits in the background (capped, depth-1) and resolves rooms safely
on demand at the door through the shared `assembleRoom` pipeline. The parallel-job
system, the per-room status lifecycle, the "Opening the way…" wait, priority
ordering, and a backend remain the future shape described here.

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

The domain/renderer/UI/server boundaries are real **today**, enforced by folder
structure, these docs, and lint rules — not by separate npm packages. A shared `packages/contracts` package is extracted only when a second
genuine cross-package consumer exists. The in-package `src/server/**` consumer
does not trigger extraction. See
[ADR-0005](./decisions/ADR-0005-defer-shared-package-extraction.md).
