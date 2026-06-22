# ADR-0013: World State & Event Log v0 — authoritative gameplay truth (headless)

- **Status:** Accepted — **implemented** (World State & Event Log v0)
- **Date:** 2026-06-22
- **Deciders:** Project owner

## Context

The render pipeline is stateless today: `RoomSource.getRoom() → loadRoomSpec →
validateRoom → Engine.setRoom`. Nothing records *who the player is*, *what they carry*,
or *what has happened*. A `RoomSpec` deliberately describes *what is in a room*, not
gameplay truth ([CONVENTIONS](../CONVENTIONS.md), [ADR-0001](./ADR-0001-data-only-room-spec-trusted-renderer.md)).

The next foundation is a minimal **authoritative gameplay truth layer**: world/session
identity, current room, player health/status, inventory, room state, and an
**append-only event log**, with a **save/load boundary**. The full backend/persistence
shape is already fixed by [ADR-0004](./ADR-0004-persistence-sqlite-to-postgres.md)
(repository interfaces in the domain; UUIDs; UTC; `schemaVersion`; validate at the
persistence boundary; transactions in a unit-of-work) but is "future shape only, nothing
built", and [ADR-0005](./ADR-0005-defer-shared-package-extraction.md) defers
`packages/contracts`/workspaces until a backend *and* a second consumer exist.

We therefore build this exactly like
[Generation Foundation v0 (ADR-0010)](./ADR-0010-generation-foundation-v0.md) and
[Semantic Room Validator v0 (ADR-0011)](./ADR-0011-semantic-room-validator-v0.md): prove
the **seam** end-to-end with a deterministic, pure core and an **in-memory** stand-in for
the real external dependency — here a database — so the whole path is testable now with
no DB, no HTTP, no LLM, and no cost. When persistence lands later, the SQLite/PostgreSQL
adapter implements the *same* domain ports with **no domain change**, and the same
schemas re-validate at the persistence boundary.

### Maintainer-approved exception

AGENTS.md forbids adding "a backend or a database" without explicit maintainer approval.
The maintainer has explicitly approved **this headless slice only**: domain contracts +
pure reducer + use-cases + an **in-memory** store + a JSON save/load boundary. It adds
**no real DB, no SQLite/Postgres, no HTTP server, no `apps/api`, and no
`packages/contracts`/workspace extraction** — those remain deferred
([ADR-0004](./ADR-0004-persistence-sqlite-to-postgres.md),
[ADR-0005](./ADR-0005-defer-shared-package-extraction.md)).

## Decision

Ship **World State & Event Log v0** as a headless truth layer using an **event-sourced**
model:

```
CanonSeed (World Bible)            ── initial seed ONLY; never mutated by play
        │
        ▼  embedded in the first event (session-started)
   WorldEvent[]   ── append-only ledger = THE AUTHORITATIVE TRUTH
        │
        ▼  projectWorldState(log) = log.reduce(applyEvent, null)   (pure, total)
   WorldState     ── current snapshot = a reconstructable PROJECTION / read cache
```

### Architectural rules (binding)

1. **The event log is authoritative.** Append-only, immutable, gapless monotonic `seq`.
2. **`WorldState` is a pure projection / snapshot cache** of `CanonSeed + WorldEvent[]`,
   never an independent source of truth. The persisted snapshot is a cache only.
3. **The snapshot must be reconstructable and integrity-tested:**
   `projectWorldState(log) deepEquals snapshot` is an invariant enforced in tests and
   re-checked on load.
4. **`CanonSeed` / World Bible is the initial seed only** and must never override live
   state once a session has started.
5. **Summaries / vector memory are future recall/compression only** and must never
   override these hard facts. (Out of scope here; recorded so the seam stays correct.)
6. **All state data is neutral JSON** — numbers, strings, enums, arrays, objects. **No
   `THREE.*` objects, no functions, never `eval`'d** ([ADR-0008](./ADR-0008-renderer-portability-strategy.md), [ADR-0001](./ADR-0001-data-only-room-spec-trusted-renderer.md)).
7. **Every persisted schema carries `schemaVersion` (currently `1`).**
8. **Ports + constructor injection; no new DI framework.** DI = constructor parameters
   (AGENTS.md rule 13).
9. **Expected failures are typed result objects, never thrown** for control flow
   ([ADR-0003](./ADR-0003-logging-abstraction.md); mirrors `RoomLoadResult`). Genuine
   bugs may still throw.
10. **Logs contain IDs / counts / codes only** — never narrative text, item names,
    `reason` strings, or other user/world content (mirrors the `promptLength` discipline,
    [ADR-0003](./ADR-0003-logging-abstraction.md), [FAILURE-MODES](../FAILURE-MODES.md) case 4).
11. **Determinism / purity.** The domain (schemas, reducer, projection, validators) does
    no I/O and never reads `Date.now`/`Math.random`/`crypto`. Time and ids enter only
    through injected `Clock` / `IdGenerator` ports, so use-cases are deterministic under
    fakes (mirrors the seeded PRNG discipline of [ADR-0010](./ADR-0010-generation-foundation-v0.md)).
12. **The only write path is "append a typed, validated event, then project."** There are
    **no direct state setters** — this is what guarantees the log and the snapshot can
    never diverge.

## Scope (v0)

**In scope (headless):**

- `domain/world/` zod schemas: `CanonSeed`, `WorldState`, `WorldEvent` (closed union),
  `WorldCommand` (caller intent), `SaveGame` — all `schemaVersion: 1`, neutral JSON.
- Pure domain functions: `applyEvent` (reducer), `projectWorldState` (fold),
  `validateEventLog` (pure log-shape checker, peer of `validateRoom`), and a pure
  `jsonDeepEqual` helper for integrity checks.
- Domain **ports**: `WorldStore` (append-only, atomic commit), `Clock`, `IdGenerator`.
- Application/use-case layer (`world-session/`): `startSession`, `appendEvent`
  (+ thin command builders), `getWorldState`, `getEventLog`.
- `InMemoryWorldStore` adapter + real `Clock`/`IdGenerator` adapters.
- **SaveGame JSON save/load boundary**: serialize seed + log + snapshot; on load
  validate, reject unknown `schemaVersion`, reject tampered/inconsistent snapshot.
- Full Vitest coverage. ADR + (in commit 4) architecture-doc & boundary updates.

**Out of scope / non-goals (must NOT be built in this slice):**

- ❌ Real DB, SQLite, PostgreSQL, migration engine — **in-memory only**.
- ❌ HTTP backend / `apps/api`.
- ❌ `packages/contracts` / npm workspaces ([ADR-0005](./ADR-0005-defer-shared-package-extraction.md)).
- ❌ Renderer wiring, `App.tsx` bootstrap, any UI/HUD — **this slice is headless**.
- ❌ Real LLM, NPC dialogue, memory / vector retrieval / summarization.
- ❌ Combat, multiplayer, auth / payments.
- ❌ `npcStates` and `npc-state-changed` events — **deferred to the NPC/encounter
  feature** (see [State breadth](#state-breadth-v0)).
- ❌ Renderer/RoomSpec changes; no executable Three.js from any author; no camera/player
  schema fields ([ADR-0012](./ADR-0012-isometric-camera-foundation.md)).
- ❌ Deep `currentRoomId` existence checking (no room store exists yet), quest /
  reachability state.

## State breadth (v0)

Authoritative `WorldState` includes, and only includes:

- **World / session identity** — `worldId`, `sessionId`.
- **`currentRoomId`** — string id of the room the player is in.
- **Player `health` and `status`** — `health: { current, max }`, `status: string[]`.
- **`inventory`** — list of `{ itemId, name, quantity }`, unique by `itemId`.
- **Minimal `roomStates`** — keyed by `roomId`: `{ visited: boolean, flags?: Record<string, boolean> }`.

**Excluded:** player *render position/yaw* (renderer-internal presentation,
[ADR-0012](./ADR-0012-isometric-camera-foundation.md)); `npcStates` (deferred).

## Data model

All entities are zod schemas with inferred TypeScript types. Ids are **app-generated
UUID strings** (via `IdGenerator`); timestamps are **UTC ISO-8601 strings** (via `Clock`).
Health/quantity/seq are non-negative integers. (Exact zod 4 calls are Codex's choice;
the constraints below are binding.)

### `CanonSeed` (World Bible v0 — seed only, immutable after session start)

| Field | Type / rule |
| --- | --- |
| `schemaVersion` | literal `1` |
| `worldId` | UUID string |
| `name` | non-empty string |
| `startingRoomId` | non-empty string |
| `initialPlayer.health` | `{ current: int ≥ 0, max: int > 0 }`, refine `current ≤ max` |
| `initialPlayer.status` | `string[]` (treated as a set; default `[]`) |
| `initialPlayer.inventory` | `InventoryItem[]` (unique `itemId`; default `[]`) |

### `InventoryItem`

`{ itemId: non-empty string, name: non-empty string, quantity: int ≥ 1 }`.

### `WorldState` (current snapshot / projection)

| Field | Type / rule |
| --- | --- |
| `schemaVersion` | literal `1` |
| `worldId`, `sessionId` | UUID strings |
| `currentRoomId` | non-empty string |
| `player.health` | `{ current: int ≥ 0, max: int > 0 }`, `current ≤ max` |
| `player.status` | `string[]` (set semantics: no duplicates) |
| `inventory` | `InventoryItem[]` (unique `itemId`) |
| `roomStates` | `Record<roomId, { visited: boolean, flags?: Record<string, boolean> }>` |
| `revision` | int ≥ 1 — equals the last applied `seq` and `log.length`; optimistic-concurrency token |
| `updatedAt` | UTC ISO-8601 — derived from the last applied event's `occurredAt` (keeps the reducer pure) |

### `WorldEvent` (append-only ledger entry)

Envelope (every event): `{ schemaVersion: 1, eventId: UUID, sessionId: UUID, seq: int ≥ 1,
occurredAt: UTC ISO-8601 }` + a discriminated `type` and its payload.

`seq` is **gapless and strictly increasing** per session (1, 2, 3, …). Events are
**immutable** once appended.

### `WorldCommand` (caller intent → produces an event)

A `WorldCommand` is the `{ type, …payload }` *intent* for the six non-`session-started`
events. The use-case stamps the envelope (`eventId`, `sessionId`, `seq`, `occurredAt`,
`schemaVersion`) to turn a command into a `WorldEvent`. `session-started` is produced only
by `startSession`, never by a caller.

## Events (v0) and reducer semantics

Closed union of **seven** event types. `applyEvent(state: WorldState | null, event:
WorldEvent): WorldState` is **pure, total, deterministic, exhaustive** (TypeScript `never`
check on `type`) and **never mutates its input**. Every event sets
`revision = event.seq` and `updatedAt = event.occurredAt`.

| `type` | Payload | Transition |
| --- | --- | --- |
| `session-started` | `{ seed: CanonSeed }` | Requires `state === null`. Builds the initial `WorldState` from `seed` + `event.sessionId`: `currentRoomId = seed.startingRoomId`; player from `seed.initialPlayer`; `inventory` from seed; `roomStates = { [startingRoomId]: { visited: true } }`; `revision = seq (=1)`. |
| `moved-to-room` | `{ fromRoomId?: string, toRoomId: string }` | `currentRoomId = toRoomId`; mark `roomStates[toRoomId].visited = true` (merge, preserving existing flags). |
| `item-added` | `{ item: InventoryItem }` | Merge by `itemId`: if present, sum quantities; else append. |
| `item-removed` | `{ itemId: string, quantity: int ≥ 1 }` | Subtract; drop the entry at 0. **Defensive clamp — never negative** (the illegal "remove more than held" case is rejected upstream as `invalid-command`, so this clamp guards against bugs only). |
| `health-changed` | `{ delta: int, reason?: string }` | `current = clamp(current + delta, 0, max)`. `reason` is never logged. |
| `status-changed` | `{ status: string, op: 'add' \| 'clear' }` | `add` → set-union; `clear` → remove. |
| `room-state-changed` | `{ roomId: string, visited?: boolean, flags?: Record<string, boolean> }` | Merge into `roomStates[roomId]` (set `visited` and/or merge `flags`). |

**Inconsistent-log guard:** `state === null` with a non-`session-started` event, or
`state !== null` with a `session-started` event, is a malformed log. `applyEvent` may
treat this as a programmer error; the **load path validates log shape first** (see
`validateEventLog`) and returns a typed result rather than throwing.

### Projection & log validation (pure domain)

- `projectWorldState(log: WorldEvent[]): WorldState` = `log.reduce(applyEvent, null)`,
  asserting a non-null result. Precondition: a well-formed log.
- `validateEventLog(log): { ok: boolean; issues: { code }[] }` (peer of `validateRoom`):
  codes `empty-log`, `missing-session-started`, `multiple-session-started`,
  `non-monotonic-seq`, `seq-gap`. Used by the save/load boundary before projecting.

## Ports (domain — interfaces only)

Placed in `domain/ports/` so the future SQLite/PostgreSQL adapter implements the same
contract with no domain change ([ADR-0004](./ADR-0004-persistence-sqlite-to-postgres.md)).
**Append-only is structurally enforced: there is no `updateEvent` / `deleteEvent` /
`replaceEvent`.** All methods return typed results, not throws.

### `WorldStore`

| Method | Contract |
| --- | --- |
| `createSession({ sessionId, worldId, firstEvent, snapshot })` | Create a new ledger seeded with the `session-started` event (seq 1) + initial snapshot. Fails `already-exists` if the session id is taken (duplicate-session guard / idempotency). |
| `commit({ sessionId, expectedRevision, event, snapshot })` | **Atomic** unit-of-work: append `event` only if `expectedRevision === currentRevision` (assigning `seq = expectedRevision + 1`) **and** replace the cached snapshot — both or neither. Returns `not-found` (no session) or `conflict` (stale `expectedRevision`). The in-memory adapter is trivially atomic; a future DB adapter wraps both in one transaction ([ADR-0004](./ADR-0004-persistence-sqlite-to-postgres.md) rule 6). |
| `restoreSession({ sessionId, log, snapshot })` | Bulk-load a session from a validated `SaveGame`. Fails `already-exists` if present. |
| `getSnapshot(sessionId)` | Returns the cached `WorldState` or `null`. |
| `listEvents(sessionId, { sinceSeq? })` | Returns events ordered by `seq` (append-only; read path). |

### `Clock` / `IdGenerator`

- `Clock.now(): string` — UTC ISO-8601.
- `IdGenerator.newId(): string` — UUID.

Real adapters live in `platform/`; deterministic fakes are used in tests. The domain and
use-cases depend on the **ports**, never on the adapters directly.

## Use-cases (`world-session/`)

A `WorldSession` application service, wired by **constructor injection** with `WorldStore`,
`Clock`, `IdGenerator`, and `Logger`. Results mirror `RoomLoadResult`:
`{ ok: true, … } | { ok: false, error: { code, message } }`, with codes
`not-found | already-exists | conflict | invalid-command | invalid-canon`.

- `startSession(canon): Result<WorldState>` — validate `canon`; `sessionId = idGen.newId()`;
  build `session-started` (seq 1, `occurredAt = clock.now()`); `snapshot = applyEvent(null,
  event)`; `store.createSession(...)`. `already-exists` → typed error.
- `appendEvent(sessionId, command, expectedRevision): Result<{ state, event }>` — read
  current snapshot; **validate the command against current state** (e.g. reject
  `item-removed` quantity > held → `invalid-command`); build the event (`seq =
  expectedRevision + 1`, `eventId`, `occurredAt`); `next = applyEvent(snapshot, event)`;
  `store.commit({ expectedRevision, event, snapshot: next })`. Stale `expectedRevision` →
  `conflict`.
- Thin command builders funnel through `appendEvent` (single write path): `move`,
  `addItem`, `removeItem`, `changeHealth`, `setStatus`, `clearStatus`, `setRoomState`.
- `getWorldState(sessionId): Result<WorldState>`; `getEventLog(sessionId, { sinceSeq? }):
  WorldEvent[]` — reads.

**Logging** (via the `Logger` port): ids, `seq`, `revision`, counts, and error codes only.
Never event payloads, `name`, or `reason` (rule 10).

## Save / load boundary (`world-session/saveGame.ts`)

`SaveGame` document: `{ schemaVersion: 1, seed: CanonSeed, log: WorldEvent[], snapshot:
WorldState }`. The `seed` is stored top-level for readability and is also embedded in
`log[0].payload.seed`; the load-time check ties them together.

- `saveSession(sessionId): Result<string>` — read `log` + `snapshot` (seed from
  `log[0].payload.seed`), build + validate the `SaveGame`, return `JSON.stringify`.
- `loadSaveGame(json): Result<SaveGame>` with codes `invalid-json` → `invalid-schema` →
  `unsupported-version` → `integrity-mismatch`:
  1. `JSON.parse` (never `eval`); failure → `invalid-json`.
  2. Schema-validate; failure → `invalid-schema`.
  3. `schemaVersion !== 1` → `unsupported-version` (**reject; never silently migrate**,
     [FAILURE-MODES](../FAILURE-MODES.md) case 6).
  4. **Integrity:** `validateEventLog(log).ok` **and** `jsonDeepEqual(log[0].payload.seed,
     seed)` **and** `jsonDeepEqual(projectWorldState(log), snapshot)`; else
     `integrity-mismatch` (rejects a **tampered / inconsistent snapshot where
     `reduce(seed, log) ≠ snapshot`**).
- `loadSession(json): Result<sessionId>` — `loadSaveGame` then `store.restoreSession`.

This re-asserts "validate at the persistence boundary"
([ADR-0004](./ADR-0004-persistence-sqlite-to-postgres.md) rule 7) using the same domain
schemas. `jsonDeepEqual` is a small pure recursive structural comparison over JSON values
(not string compare — key order must not matter).

## Implemented file layout

Domain contracts under `apps/web/src/domain/world/`; the application layer under
`apps/web/src/world-session/` (preferred; `apps/web/src/state/` is the acceptable
fallback if it fits repo style better). Tests are co-located `*.test.ts` (Vitest).

```
apps/web/src/domain/world/worldState.ts        CanonSeed, InventoryItem, WorldState schemas + types
apps/web/src/domain/world/events.ts            WorldEvent union, WorldCommand union, payloads
apps/web/src/domain/world/applyEvent.ts        applyEvent reducer + projectWorldState
apps/web/src/domain/world/validateEventLog.ts  pure log-shape validator (peer of validateRoom)
apps/web/src/domain/world/jsonDeepEqual.ts      pure structural equality for integrity checks
apps/web/src/domain/world/saveGame.ts          SaveGame schema + type
apps/web/src/domain/ports/WorldStore.ts        append-only store / unit-of-work port
apps/web/src/domain/ports/Clock.ts             Clock port
apps/web/src/domain/ports/IdGenerator.ts       IdGenerator port
apps/web/src/world-session/WorldSession.ts     use-cases + command builders
apps/web/src/world-session/InMemoryWorldStore.ts  in-memory WorldStore adapter
apps/web/src/world-session/saveGame.ts         SaveGame save/load boundary
apps/web/src/platform/system/clock.ts          real Clock (Date → UTC ISO)
apps/web/src/platform/system/idGenerator.ts    real IdGenerator (crypto.randomUUID)
```

## Tests (Vitest; co-located; no browser/e2e, no DB tests)

- **Domain:** each schema parses valid / rejects bad payloads (incl. `current ≤ max`,
  `quantity ≥ 1`, UUID/ISO shape); `applyEvent` per event type; invariants (inventory
  merge & non-negative, health clamp `[0, max]`, status set semantics, `revision = seq`,
  `updatedAt = occurredAt`); exhaustiveness; determinism + **no input mutation**;
  `projectWorldState` round-trip; `validateEventLog` codes; `jsonDeepEqual` (order
  independence, nesting).
- **Use-cases (fake `Clock`/`IdGenerator`/store):** `startSession` (writes
  `session-started`; snapshot equals the seeded projection); duplicate session →
  `already-exists`; append happy path (state + event + `revision` increments);
  **append-only** (store exposes no mutate/delete); **optimistic concurrency** (stale
  `expectedRevision` → `conflict`); `not-found`; **projection consistency**
  (`projectWorldState(log) deepEquals snapshot` after N appends); invalid command rejected
  **before** append (`item-removed` > held → `invalid-command`, nothing appended); reads;
  **log safety** (asserts payload text / `name` / `reason` never reach logs — mirrors the
  prompt-safety test).
- **Save/load:** round-trip equality; reject `invalid-json`, `invalid-schema`;
  `unsupported-version` on `schemaVersion ≠ 1`; `integrity-mismatch` on a tampered snapshot
  (`projectWorldState(log) ≠ snapshot`) and on a seed/log mismatch.

## Boundaries (encoded with the shipped code)

- `domain/world/**` and the new `domain/ports/**` files obey the existing **domain** lint
  block (zod only; no React/Three/renderer/UI/platform). No lint change needed — the
  `src/domain/**` rule already covers them.
- `world-session/**` is an application/composition layer (like `room/`): it may import the
  domain and the `Logger` interface, and **must not** import React, `react-dom`, `three`,
  or `renderer/**`. A matching `no-restricted-imports` block for
  `src/world-session/**` in `eslint.config.js` mirrors the generation block while
  **allowing** the platform logger.
- `platform/system/**` adapters are cross-cutting platform code (like the logger adapter).
- No engine objects ever enter these types or the `SaveGame` document
  ([ADR-0008](./ADR-0008-renderer-portability-strategy.md)).

## Commit plan

Small, independently buildable/testable commits (AGENTS.md rule 12). Codex implements;
the maintainer commits manually.

1. `feat(domain): add world-state event-log contracts` — `domain/world/` schemas, reducer,
   projection, `validateEventLog`, `jsonDeepEqual`, and the `WorldStore`/`Clock`/
   `IdGenerator` ports + unit tests. Pure, no wiring.
2. `feat(world-session): add use cases and in-memory store` — `WorldSession` use-cases,
   `InMemoryWorldStore`, real `Clock`/`IdGenerator` adapters, the `world-session/**` lint
   block + tests.
3. `feat(world-session): add save-game boundary` — `SaveGame` schema + `saveSession`/
   `loadSession`/`loadSaveGame` + tests.
4. `docs(architecture): record world-state event-log foundation` — flip this ADR's status
   to *implemented*; add the world-state/event-log layer to
   [ARCHITECTURE](../ARCHITECTURE.md) (new ❌→✅ plug-in point), [BOUNDARIES](../BOUNDARIES.md)
   (layer rows + lint note), [FAILURE-MODES](../FAILURE-MODES.md) (append-conflict,
   integrity-mismatch, unsupported-version), and the AGENTS.md module table.

## Consequences

- A complete, deterministic, regression-tested authoritative-truth seam exists **without a
  DB, server, or LLM**. The current state can always be rebuilt from the log, and the
  snapshot is provably a cache, not a second source of truth.
- When persistence lands, the SQLite/PostgreSQL adapter implements `WorldStore` with no
  domain change, and `loadSaveGame`/`validateEventLog`/`applyEvent` re-validate at the
  persistence boundary unchanged ([ADR-0004](./ADR-0004-persistence-sqlite-to-postgres.md)).
- Summaries / vector memory, when added, are layered as *recall* over this log and can
  never override it — the write path is "append a typed event", and nothing else mutates
  state (rule 5, rule 12).
- Discipline cost now (injected clock/ids, event-sourced reducer, integrity checks) is
  paid back the first time the store moves to a real DB or the schema evolves.

## Alternatives considered

- **State-as-primary with the log as an audit trail** — rejected: lets the snapshot and
  the log drift, and contradicts "the event log is authoritative" (rule 1). Event-sourced
  projection makes consistency a testable invariant.
- **Stand up SQLite (or `apps/api`) now** — rejected for this slice: couples the first
  truth-layer slice to a driver/migrations/credentials and conflicts with the AGENTS.md
  guardrail and [ADR-0004](./ADR-0004-persistence-sqlite-to-postgres.md)/[ADR-0005](./ADR-0005-defer-shared-package-extraction.md);
  the in-memory store proves the seam and the DB adapter drops in behind the same ports.
- **Put the reducer/validators in `world-session/` instead of the domain** — rejected
  (same reasoning as [ADR-0011](./ADR-0011-semantic-room-validator-v0.md)): they are
  reusable, renderer-agnostic invariants the future backend HTTP/persistence edge reuses;
  the domain is the shared contract layer.
- **Wire world-state into the renderer/HUD now** — rejected: needs multi-room and UI work
  that is out of scope; keeping the slice headless mirrors how Generation Foundation v0
  left the engine untouched.
- **Read `Date.now`/`crypto` directly in use-cases** — rejected: breaks determinism and
  testability; time and ids enter only through injected ports (rule 11).
- **Extract `packages/contracts` now that there will be a second consumer** — deferred:
  the in-memory store is in `apps/web`, so the genuine second-consumer condition of
  [ADR-0005](./ADR-0005-defer-shared-package-extraction.md) is not yet met.
