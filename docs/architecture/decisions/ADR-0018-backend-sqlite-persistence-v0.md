# ADR-0018: Backend SQLite Persistence v0 — headless, Node-only durable store behind the existing ports

- **Status:** Accepted — **implemented** (Backend SQLite Persistence v0)
- **Date:** 2026-06-22
- **Deciders:** Project owner

> This ADR began as the **binding implementation brief** for the
> `backend-sqlite-persistence-v0` slice and is now **implemented**: a headless,
> Node-only `src/persistence/**` build unit (a `node:sqlite` connection/migration
> runner, `SqliteWorldStore` over the unchanged `WorldStore` port, and a new
> `RoomStore` port with `SqliteRoomStore`) provably excluded from the browser
> bundle by tsconfig + Vite reachability + bidirectional ESLint walls. The
> `WorldStore` port and `domain/world/**` are unchanged, and no frontend is wired
> to SQLite. See [Implementation notes (as built)](#implementation-notes-as-built)
> for the two places the shipped code refines this brief.

## Context

Authoritative gameplay truth already exists as a **headless, in-memory** layer
([ADR-0013](./ADR-0013-world-state-event-log-v0.md)): an append-only
`WorldEvent[]` is the truth, `WorldState` is a pure reconstructable projection
cache, and the only write path is "append a validated event, then project". The
`WorldStore`, `Clock`, and `IdGenerator` **domain ports** were defined precisely
so that "a server-side SQLite/PostgreSQL adapter may implement the same
`WorldStore` port with **no domain change**". `InMemoryWorldStore` proves atomic
append + snapshot commit under an optimistic-revision check.

Rooms are still **content without durable storage**: `RoomRegistry.resolve(roomId)
→ LoadedRoom` ([ADR-0016](./ADR-0016-multi-room-navigation-cache-v0.md)) reads
from hardcoded example data through `loadRoomSpec`, and `SessionRoomCache` is an
in-memory `Map` for one play session.

The persistence principles are already fixed
([ADR-0004](./ADR-0004-persistence-sqlite-to-postgres.md)): repository interfaces
in the domain; **server-side only, never in-browser**; migrations from day one;
app-generated UUID primary keys (not autoincrement); UTC timestamps; store the
validated RoomSpec as a JSON document with a `schema_version` column;
transactions in a unit-of-work; **re-validate at the persistence boundary**.
[ADR-0005](./ADR-0005-defer-shared-package-extraction.md) defers
`packages/contracts`/workspaces until a backend **and** a genuine *cross-package*
second consumer of the contract both exist.

This slice builds the **first real durable persistence foundation** as a
**headless, Node-only** layer: a SQLite-backed `WorldStore` and a new
SQLite-backed `RoomStore`, with a versioned migration runner and a temp-DB test
harness — proven in isolation exactly the way every prior foundation was
(deterministic core + the real external dependency exercised behind the existing
ports). **The running browser app is not wired to SQLite in this slice.**

### The central architectural constraint

The whole repository is a **single browser-targeted Vite bundle** (`apps/web`,
`tsconfig.app.json` includes all of `src`, browser libs). SQLite is a **Node-only
server store** (AGENTS rule 6, [ADR-0004](./ADR-0004-persistence-sqlite-to-postgres.md));
in-browser/wasm SQLite is explicitly **rejected** as the system of record. So the
single most important rule of this slice is that persistence code is a
**physically separate Node build unit, provably excluded from the browser
bundle**, enforced mechanically by tsconfig + Vite reachability + ESLint walls —
not by convention.

## Maintainer-approved decisions (binding for this slice)

1. **Packaging — Option A2.** Keep persistence **inside `apps/web`** as a
   Node-only, browser-excluded, lint-walled build unit under
   `apps/web/src/persistence/**`. **Do not** create `apps/api`. **Do not** set up
   npm workspaces or `packages/contracts`. **Do not** perform any shared-package
   extraction or move existing files in this slice.
2. **Scope.** Implement **both** `SqliteWorldStore` (the existing `WorldStore`
   port) **and** a new `RoomStore` port with `SqliteRoomStore`. This slice is the
   headless persistence foundation for world sessions / events / snapshots and
   saved RoomSpecs. It **does not** wire the running frontend to SQLite.
3. **Driver — `node:sqlite` (built-in).** Use the smallest safe SQLite driver
   available in the runtime: Node's built-in **`node:sqlite`** (`DatabaseSync`),
   confirmed available on the dev runtime (Node v24.16.0). **Zero new runtime
   dependencies, no native build, Windows-friendly.** Parameterized SQL is
   allowed **only inside `src/persistence/**` adapter/migration files**; raw SQL
   must never appear elsewhere. **Do not** add Kysely/Drizzle/`better-sqlite3`
   unless direct `node:sqlite` usage proves unsafe or too painful — and if so,
   **STOP and ask** before substituting.
4. **Frontend untouched.** The browser keeps `InMemoryWorldStore`,
   `SessionRoomCache`, and `RoomRegistry` exactly as today. **No change** to
   `App.tsx`, `RoomViewer.tsx`, the renderer, or current browser gameplay wiring.
   No HTTP server, no `apps/api`, no browser fetch, no API client.

### Why `apps/api` / workspaces / `packages/contracts` are deferred

- **`apps/api` / HTTP is a separate, later slice** (`backend-world-session-api-v0`).
  Standing up a server now would pull in a web framework, request/response
  validation, network failure handling ([FAILURE-MODES](../FAILURE-MODES.md) case
  5), CORS/dev-proxy, and frontend rewiring — multiple new failure surfaces in
  one slice, conflicting with "smallest safe" and "don't break the frontend". The
  **ports are the contract**; HTTP layers on top behind them later.
- **Workspaces / `packages/contracts` extraction is deferred per
  [ADR-0005](./ADR-0005-defer-shared-package-extraction.md).** Its trigger is a
  backend **and** a genuine *cross-package* second consumer. Here the only
  consumer of the domain contracts is **in the same package** (`apps/web`,
  relative imports), so there is **no cross-package duplication/drift risk yet**.
  Extracting now would mechanically rewrite ~50 `../domain/...` imports across the
  working app — exactly the "massive refactor" risk to "do not break existing
  frontend behavior" — for no safety gain in this slice. The domain is already
  written "as if it were a separate package", so the extraction stays mechanical
  when HTTP genuinely lands.

## Decision

Add a headless, Node-only persistence layer that implements the existing
`WorldStore` port and a new `RoomStore` port over SQLite, with migrations and a
temp-DB test harness, wired to nothing in the browser.

```
 Browser build (apps/web/src, Vite)            Node-only build unit (apps/web/src/persistence)
   App.tsx / RoomViewer / renderer / ui          db.ts        open + PRAGMAs + runMigrations + withTransaction
   world-session / interactions / ...            migrations/  0001_init (DDL, indexes, append-only triggers)
        │ depends on                             SqliteWorldStore  implements domain WorldStore port
        ▼                                        SqliteRoomStore   implements domain RoomStore port (NEW)
   DOMAIN / CONTRACTS  ◄──── both consume ────── (domain/world/**, roomSpec, ports, loadRoomSpec; logger TYPES)
   (pure zod schemas, ports, loaders)
        ▲                                                │ excluded from tsconfig.app + Vite; lint-walled both ways
        └──────────── InMemoryWorldStore (unchanged; still the only store the browser uses) 
```

The store **never computes projections**: the `WorldSession` (unchanged) computes
`next = applyEvent(snapshot, event)` and hands the store `{ event, snapshot: next }`;
the store persists both **atomically**. This preserves ADR-0013's invariant that
the snapshot is a cache and the only write path is "append a validated event,
then project".

### Architectural rules (binding)

1. **Persistence is Node-only and physically excluded from the browser bundle.**
   It lives under `src/persistence/**`, is excluded from `tsconfig.app.json` and
   from Vite, and is type-checked by a dedicated Node `tsconfig.persistence.json`.
2. **Lint walls both directions.** Nothing in the browser/composition surface
   (`src/**` outside `src/persistence/**`) may import `node:sqlite` or
   `**/persistence/**`; persistence may import **only** pure domain contracts
   (`domain/world/**`, `domain/roomSpec`, `domain/loadRoomSpec`,
   `domain/ports/**`) and the **logger types** (`platform/logger/Logger`). It must
   not import React, Three.js, the renderer/UI, generation, world-session,
   interactions, encounters, dialogue, room, or app composition.
3. **No change to the `WorldStore` port** (`domain/ports/WorldStore.ts`) and **no
   change to `domain/world/**`** (event union, reducer, schemas, save-game). The
   SQLite adapter implements the port as-is. *If implementation proves this
   impossible, STOP and ask the maintainer.*
4. **The event log stays append-only**, enforced three ways: the adapter exposes
   no update/delete of events; a `UNIQUE(session_id, seq)` constraint blocks seq
   reuse; and DB triggers reject `UPDATE`/`DELETE` on `world_events`.
5. **`WorldState` snapshot stays a projection cache.** The store persists the
   session-computed snapshot alongside the event atomically and never derives or
   mutates it independently.
6. **Validate at the persistence boundary** (ADR-0004 rule 7). On read, stored
   JSON is re-validated with the same zod schemas; on write, inputs are
   serialized from already-validated domain objects (defensive re-validation
   allowed). No raw row ever reaches the renderer or the logger.
7. **All stored data is neutral JSON** — no `THREE.*` objects, no functions, never
   `eval`'d ([ADR-0008](./ADR-0008-renderer-portability-strategy.md),
   [ADR-0001](./ADR-0001-data-only-room-spec-trusted-renderer.md)). Store the
   **validated RoomSpec data document**, never `LoadedRoom`-derived renderer state.
8. **Every persisted schema carries `schema_version`** (currently `1`).
9. **Transactions own atomicity** (ADR-0004 rule 6). Each mutating operation runs
   in one transaction; append + snapshot commit is both-or-neither.
10. **Optimistic concurrency** mirrors the in-memory adapter: a compare-and-set on
    `revision` is the whole mechanism, with `UNIQUE(session_id, seq)` as backstop.
11. **Expected failures are typed results, never thrown** (mirrors ADR-0013 rule
    9). Infrastructure faults (DB cannot open, migration failure, corrupted stored
    session JSON) **fail fast / throw** — they are genuine faults, not control
    flow, and a future API edge maps them to a safe error.
12. **Logs carry ids / counts / codes only** — `sessionId`, `roomId`, `revision`,
    `eventCount`, error `code`, migration `version`. **Never** event payloads,
    item names, `reason` strings, room `name`, dialogue, or any story content
    (ADR-0013 rule 10, [ADR-0003](./ADR-0003-logging-abstraction.md)).
13. **Ports + constructor injection; no new framework** (AGENTS rule 13). DI =
    constructor parameters.

## Scope (v0)

**In scope (headless, Node-only):**

- A Node-only build unit `apps/web/src/persistence/**`.
- `db.ts`: open a `DatabaseSync` (file path or `:memory:`), set PRAGMAs, expose a
  `withTransaction` helper and a forward-only `runMigrations`.
- `migrations/0001_init`: `world_sessions`, `world_events`, `rooms`,
  `schema_migrations` tables, indexes/constraints, and the append-only triggers.
- `SqliteWorldStore` implementing the existing `WorldStore` port.
- A new domain port `RoomStore` (+ types) and `SqliteRoomStore`.
- `testing/createTestDb.ts`: in-memory and temp-file DB helpers + cleanup.
- Co-located Vitest coverage (Node): migrations, world-store contract,
  append-only/concurrency, projection consistency, room save/load, cross-session
  /room isolation, durability, and (optional) `SaveGameService`-over-SQLite.
- tsconfig/Vite/ESLint exclusion + wall changes (config only).
- This ADR. (Other docs are updated in a later docs commit, not in this slice's
  brief — see Commit plan.)

**Out of scope / non-goals (must NOT be built):** see [Non-goals](#non-goals).

## SQLite data model

Exact column ordering and zod calls are the implementer's choice; the structure,
keys, constraints, and validation rules below are **binding**. Ids are
app-generated UUID strings (via the existing `IdGenerator`, already stamped on
events/sessions by `WorldSession`); timestamps are UTC ISO-8601 strings (already
stamped via `Clock`). `schema_version` columns hold the **persistence document
version** (`1`), independent of any field inside the stored JSON.

### `world_sessions`

| Column | Type / rule |
| --- | --- |
| `session_id` | `TEXT PRIMARY KEY` (UUID) |
| `world_id` | `TEXT NOT NULL` |
| `schema_version` | `INTEGER NOT NULL` |
| `revision` | `INTEGER NOT NULL` — current snapshot revision = last event `seq`; the optimistic-concurrency (CAS) token |
| `snapshot_json` | `TEXT NOT NULL` — the `WorldState` projection cache |
| `created_at` | `TEXT NOT NULL` (UTC ISO-8601) |
| `updated_at` | `TEXT NOT NULL` (UTC ISO-8601) |

### `world_events` (append-only ledger)

| Column | Type / rule |
| --- | --- |
| `event_id` | `TEXT PRIMARY KEY` (UUID) |
| `session_id` | `TEXT NOT NULL REFERENCES world_sessions(session_id)` |
| `seq` | `INTEGER NOT NULL` |
| `type` | `TEXT NOT NULL` (broken out for filtering/debugging; the JSON is the truth) |
| `occurred_at` | `TEXT NOT NULL` (UTC ISO-8601) |
| `schema_version` | `INTEGER NOT NULL` |
| `event_json` | `TEXT NOT NULL` — the full validated `WorldEvent` |
| — | **`UNIQUE(session_id, seq)`** — gapless ordering + double-append guard; also the ordered-read / `sinceSeq` index |

### `rooms` (saved RoomSpec documents)

| Column | Type / rule |
| --- | --- |
| `room_id` | `TEXT PRIMARY KEY` — the RoomSpec's own stable id (`room.id`) |
| `schema_version` | `INTEGER NOT NULL` |
| `name` | `TEXT NOT NULL` — denormalized from the spec (`room.name`) for listing/debug |
| `spec_json` | `TEXT NOT NULL` — the validated RoomSpec **data document** |
| `created_at` | `TEXT NOT NULL` (UTC ISO-8601) |
| `updated_at` | `TEXT NOT NULL` (UTC ISO-8601) |

> **Room PK note (ADR-0004 nuance).** ADR-0004's "app-generated UUID PKs, not
> autoincrement" rule exists to avoid DB autoincrement and keep keys portable. A
> room's natural access pattern is **lookup by its own stable string `room_id`**,
> and a stable app-provided string is equally portable, so `room_id` is the PK. No
> surrogate UUID is added in v0.

### `schema_migrations`

| Column | Type / rule |
| --- | --- |
| `version` | `INTEGER PRIMARY KEY` |
| `name` | `TEXT NOT NULL` |
| `applied_at` | `TEXT NOT NULL` (UTC ISO-8601) |

### Indexes

`UNIQUE(world_events.session_id, seq)` serves ordered reads and `sinceSeq`
filtering; the three primary keys cover session/room/event lookup. No other index
is needed at v0 scale.

### Append-only triggers (defense in depth)

```sql
CREATE TRIGGER world_events_no_update
BEFORE UPDATE ON world_events
BEGIN SELECT RAISE(ABORT, 'world_events is append-only'); END;

CREATE TRIGGER world_events_no_delete
BEFORE DELETE ON world_events
BEGIN SELECT RAISE(ABORT, 'world_events is append-only'); END;
```

## Migration strategy

- **Driver/open.** `db.ts` exposes `open(path)` → `new DatabaseSync(path)` where
  `path` is a file path or `':memory:'`. Immediately set per-connection PRAGMAs
  **outside any transaction**: `PRAGMA foreign_keys = ON`, `PRAGMA busy_timeout =
  <ms>`, and `PRAGMA journal_mode = WAL` (meaningful for file DBs; a no-op for
  `:memory:`).
- **Forward-only numbered migrations.** `migrations/index.ts` exports an ordered
  list of `{ version, name, up(db) }`; `0001_init` creates all tables, the unique
  constraint, and the append-only triggers. SQL lives **only** in these files.
- **`runMigrations(db)`.** `CREATE TABLE IF NOT EXISTS schema_migrations` (idempotent),
  read applied `version`s, then for each not-yet-applied migration in order run
  **`up(db)` and the `schema_migrations` insert inside one `withTransaction`**.
  SQLite DDL is transactional, so a migration that fails midway **rolls back
  entirely**, records nothing, and leaves the DB at the prior version.
- **Fail fast.** Any migration error rolls back and **throws** (refuse to operate
  on a half-migrated DB — [FAILURE-MODES](../FAILURE-MODES.md) case 6). Re-running
  `runMigrations` on an up-to-date DB is a **no-op**.
- **Versioning on read.** Reject unknown `schema_version` rather than silently
  mutating; tolerate the current version.

## `SqliteWorldStore`

Implements the existing `domain/ports/WorldStore.ts` **unchanged**. Constructor:
`(db: DatabaseSync, logger: Logger)` (DI = constructor params). `node:sqlite` is
**synchronous**; the port methods return `Promise`, so adapter methods are
`async` and return resolved values (the sync work runs inside). Use prepared
statements with positional `?` parameters; `.run()` returns `{ changes }` for the
CAS.

- **`createSession(input)`** — one transaction: `INSERT` the session row
  (`revision = 1`, `snapshot_json`, timestamps) and `INSERT` the first event
  (`seq = 1`). A `session_id` PK conflict → typed `already-exists` (rollback).
  Preserve the in-memory adapter's consistency assertions (first event is
  `session-started`, seq 1, ids/world align).
- **`commit(input)`** — one transaction implementing optimistic concurrency:
  1. `UPDATE world_sessions SET snapshot_json=?, revision=?, updated_at=? WHERE
     session_id=? AND revision=?` with the new revision and
     `WHERE revision = expectedRevision` as the CAS.
  2. If `changes === 0`: probe existence of `session_id` → `not-found` (no row)
     vs `conflict` (stale revision); rollback; return the typed result.
  3. `INSERT` the event with `seq = expectedRevision + 1`. A `UNIQUE(session_id,
     seq)` violation here (only possible under a true concurrent writer) maps to
     `conflict`; any other constraint error is a genuine fault → throw.
  4. Commit. Append + snapshot are atomic both-or-neither.
- **`restoreSession(input)`** — one transaction: `INSERT` the session +
  bulk-`INSERT` the validated log. Present → `already-exists`. Keep the in-memory
  adapter's precondition (non-empty log; `snapshot.sessionId === sessionId`).
- **`getSnapshot(sessionId)`** — `SELECT snapshot_json`; `null` if absent;
  else `JSON.parse` → `WorldStateSchema.safeParse` → return on success, **throw**
  on parse failure (corruption is a fault, not `null`).
- **`listEvents(sessionId, { sinceSeq })`** — `SELECT event_json ... WHERE
  session_id=? AND seq > ? ORDER BY seq`; `JSON.parse` + `WorldEventSchema.safeParse`
  each; **throw** on corruption.

**Logging:** `sessionId`, `code`, `seq`/`revision`, `eventCount` only.

## `RoomStore` / `SqliteRoomStore`

**New domain port** `domain/ports/RoomStore.ts` (pure; zod-only neighbors;
covered by the existing `src/domain/**` lint block — no lint change). Shape
deliberately mirrors `RoomRegistry.resolve` so it is a future drop-in
([ADR-0016](./ADR-0016-multi-room-navigation-cache-v0.md)):

```ts
export type RoomStoreSaveResult =
  | { ok: true }
  | { ok: false; error: { code: 'invalid-room' } }

export type RoomStoreGetResult =
  | { ok: true; room: LoadedRoom }
  | { ok: false; reason: 'not-found' | 'invalid-stored-room' }

export interface RoomStore {
  /** Persist a validated RoomSpec data document (create-or-replace). */
  saveRoom(spec: RoomSpec): Promise<RoomStoreSaveResult>
  /** Look up a saved room by its id and re-validate it at the boundary. */
  getRoom(roomId: string): Promise<RoomStoreGetResult>
}
```

`SqliteRoomStore` constructor: `(db: DatabaseSync, logger: Logger)`.

- **`saveRoom(spec)`** — re-validate with `RoomSpecSchema.safeParse` at the
  boundary (never persist garbage); on failure → `invalid-room`. Derive
  `room_id = spec.id`, `name = spec.name`, store the serialized validated data as
  `spec_json` with `schema_version = 1`. **Upsert** (`INSERT ... ON CONFLICT(room_id)
  DO UPDATE SET spec_json=?, name=?, updated_at=?`) — last-writer-wins; rooms are
  content, not event-sourced truth.
- **`getRoom(roomId)`** — `SELECT spec_json`; absent → `not-found`; else
  `JSON.parse` → **`loadRoomSpec`** (the same boundary every room crosses) →
  `{ ok: true, room }`; a parse/envelope failure → `invalid-stored-room`
  ([FAILURE-MODES](../FAILURE-MODES.md): malformed persisted JSON).

**Logging:** `roomId`, `code` only — never `name` or `spec_json` content.

> `listRooms()` and world-scoped room keys are deliberately **deferred** (v0 has a
> single example world / single-room generated sessions). They are additive later.

## Transaction boundaries

| Operation | Transaction |
| --- | --- |
| `runMigrations` (per migration) | one `BEGIN IMMEDIATE` … `COMMIT`/`ROLLBACK` around `up(db)` + the `schema_migrations` insert |
| `createSession` | one tx: session insert + first-event insert |
| `commit` | one tx: CAS snapshot update + event insert (atomic both-or-neither) |
| `restoreSession` | one tx: session insert + bulk event insert |
| `saveRoom` | one tx: upsert |
| reads (`getSnapshot`, `listEvents`, `getRoom`) | no explicit transaction |

`withTransaction(db, fn)` (in `db.ts`): `db.exec('BEGIN IMMEDIATE')`, run `fn`,
`db.exec('COMMIT')`; on throw `db.exec('ROLLBACK')` and rethrow. Contained to the
persistence layer.

## Append-only enforcement

1. **Structural** — `SqliteWorldStore` exposes no event update/delete (mirrors
   `InMemoryWorldStore`; the port has no such method).
2. **Schema** — `UNIQUE(world_events.session_id, seq)` blocks seq reuse / double
   append.
3. **DB triggers** — `BEFORE UPDATE`/`BEFORE DELETE` on `world_events` `RAISE(ABORT)`,
   making append-only **provable at the DB level** in a test.

## JSON validation at the persistence boundary

- **Write:** inputs reaching the store are already typed/validated by the domain
  (`WorldSession` validated commands/events; `saveRoom` re-validates the spec).
  Serialize with `JSON.stringify`. Defensive re-validation is allowed.
- **Read:** always `JSON.parse` then zod `safeParse` with the same domain schema
  (`WorldStateSchema` / `WorldEventSchema` / via `loadRoomSpec` for rooms).
  - Room corruption is an **expected content failure** → typed `invalid-stored-room`.
  - Session snapshot/event corruption is a **fault** → **throw** (never mask as
    `not-found`/`null`).
- No raw row, payload, or spec text is ever logged or returned to the renderer.

## Temp DB test strategy

`testing/createTestDb.ts` provides:

- **`createMemoryDb()`** → `open(':memory:')` + `runMigrations`; auto-isolated per
  test, discarded on `close()`. Default for contract/behavioral tests.
- **`createTempFileDb()`** → path `join(os.tmpdir(), 'aigm-test-' + randomUUID()
  + '.sqlite')`, `open` + `runMigrations`; returns `{ db, store(s), path, cleanup }`.
  Used for **durability/reopen** and **migration** tests. `cleanup()` closes the
  db and `rm`s the file; call in `afterEach`.

Tests run under Vitest's **default Node environment** (no jsdom) and import
`node:sqlite` directly. A reusable `worldStoreContract.ts` describe lives in
`persistence/testing/` and is run against `SqliteWorldStore`; it **mirrors** the
existing `InMemoryWorldStore` behaviors (it does **not** import `world-session/`,
to respect the import wall — parity is maintained by intent, not by cross-layer
import).

**Tests to add (Vitest, co-located, Node):**

- **Migrations:** `0001_init` applies; re-run is a no-op; `schema_migrations`
  records version/name/applied_at; a deliberately broken migration rolls back and
  leaves the prior version; reopening a temp-file DB sees the schema.
- **`SqliteWorldStore` contract:** `createSession` happy + `already-exists`;
  `commit` happy + revision bump; **`conflict`** on stale `expectedRevision`;
  `not-found`; `restoreSession` + `already-exists`; `getSnapshot`/`listEvents`
  ordering + `sinceSeq`.
- **Append-only / concurrency:** the DB triggers reject `UPDATE`/`DELETE`; two
  commits from the same `expectedRevision` → exactly one succeeds, the other
  `conflict`, event count increments by exactly one, `UNIQUE(seq)` holds.
- **Projection consistency:** drive `WorldSession` backed by `SqliteWorldStore`
  through N commands; assert `projectWorldState(listEvents) deepEquals getSnapshot`.
  *(Composition-style test only — it lives in `persistence/` and uses
  `WorldSession`, which is permitted in test files; production persistence code
  still does not import `world-session/`. If the lint wall flags the test import,
  STOP and ask before relaxing it.)*
- **JSON boundary:** corrupt `snapshot_json`/`event_json` → throws; corrupt
  `spec_json` → `invalid-stored-room`.
- **Room save/load:** `saveRoom` → `getRoom` returns a `loadRoomSpec(spec)`-equal
  `LoadedRoom`; unknown id → `not-found`; corrupt → `invalid-stored-room`;
  re-save replaces (upsert).
- **Cross-session / room isolation + durability:** two sessions in one DB never
  see each other's events/snapshots; rooms are isolated; reopening a temp-file DB
  returns persisted sessions/events/rooms.
- **(Optional) Save/load over SQLite:** `SaveGameService` backed by
  `SqliteWorldStore` round-trips and re-validates integrity.
- **Log safety:** assert event payloads, item names, `reason`, and room `name`
  never reach the logger (mirrors ADR-0013/0014/0015/0016/0017 log-safety tests).
- **No browser/e2e/DOM tests.**

## Lint / tsconfig / Vite exclusion rules

**tsconfig:**

- `tsconfig.app.json`: add `"exclude": ["src/persistence"]` (currently
  `"include": ["src"]`) so the browser build never type-checks Node-only code.
- New `tsconfig.persistence.json`: Node target — `"types": ["node"]`,
  `"lib": ["ES2023"]` (**no DOM**), `"include": ["src/persistence"]`,
  `"noEmit": true`, matching the repo's strictness (`strict`,
  `noUncheckedIndexedAccess`, `verbatimModuleSyntax`, `erasableSyntaxOnly`,
  bundler resolution). `@types/node` is already a devDependency; if `node:sqlite`
  types are missing under the pinned `@types/node`, bump it (no runtime dep).
- `tsconfig.json`: add `{ "path": "./tsconfig.persistence.json" }` to `references`
  so `tsc -b` (and thus `npm run build`) type-checks persistence and fails on
  errors.

**Vite:** no config change is required — persistence is **unreachable** from the
browser entry (`main.tsx`), so Vite never bundles it; the reciprocal lint wall
below guarantees it stays unreachable.

**ESLint (`eslint.config.js`):** add two flat blocks, mirroring the existing
boundary blocks.

- **Reciprocal browser→persistence ban** (the new physical guarantee):
  ```js
  {
    files: ['src/**/*.{ts,tsx}'],
    ignores: ['src/persistence/**'],
    rules: { 'no-restricted-imports': ['error', {
      paths: [{ name: 'node:sqlite', message: 'SQLite is server-side only; the browser bundle must never import it (AGENTS rule 6, ADR-0004).' }],
      patterns: [{ group: ['**/persistence/**'], message: 'UI/renderer/app/domain code must not import persistence; data access is server-side behind ports (ADR-0004, ADR-0018).' }],
    }]},
  }
  ```
- **Persistence-self wall** (what persistence may not reach):
  ```js
  {
    files: ['src/persistence/**/*.{ts,tsx}'],
    rules: { 'no-restricted-imports': ['error', {
      paths: [
        { name: 'react', message: 'persistence is headless Node code and must not import React (ADR-0018).' },
        { name: 'react-dom', message: 'persistence is headless Node code and must not import React (ADR-0018).' },
        { name: 'three', message: 'persistence holds neutral JSON and must not import Three.js (ADR-0008, ADR-0018).' },
      ],
      patterns: [
        { group: ['three/*'], message: 'persistence must not import Three.js (ADR-0018).' },
        { group: ['**/renderer/**'], message: 'persistence must not import the renderer or UI (ADR-0018).' },
        { group: ['**/generation/**', '**/world-session/**', '**/interactions/**', '**/encounters/**', '**/dialogue/**', '**/room/**', '**/app/**'], message: 'persistence may import only pure domain contracts and logger types (ADR-0004, ADR-0018).' },
      ],
    }]},
  }
  ```
  Persistence is allowed to import `domain/**` and `platform/logger/Logger`
  (logger **types**); review confirms no other `platform/**` usage.

`no-console` stays globally enforced; persistence logs through the injected
`Logger`, never `console.*`.

## Failure modes (to fold into [FAILURE-MODES.md](../FAILURE-MODES.md) in the docs commit)

| Failure | Detection → handling → logging |
| --- | --- |
| DB cannot open / unavailable | `open`/`runMigrations` throws → **fail fast** (genuine fault); future API edge maps to a safe error. Code only. |
| Malformed persisted JSON | read-boundary `safeParse`: rooms → `invalid-stored-room`; session snapshot/event → **throw**. Never log the row. |
| Concurrent append conflict | CAS `WHERE revision=expected` → 0 rows → existence probe → `conflict`; `UNIQUE(session_id, seq)` backstop. |
| Event / snapshot mismatch | prevented by atomic `commit`; detected by the projection-consistency test and by `loadSaveGame` integrity re-projection. |
| Room not found | `getRoom → not-found`. |
| Duplicate room id | `saveRoom` upsert = create-or-replace (last-writer-wins). |
| Migration failure | per-migration transaction rolls back, records nothing, throws; DB stays at prior version. |
| Cross-session / world leakage | every query scoped by `session_id` / `room_id`; SQLite returns freshly parsed objects (no aliasing). Isolation tests. |
| Unsafe logs | ids / counts / codes only; never payloads, names, dialogue, or story content. |

## Non-goals

This slice must **not** implement: auth; billing; hosted/cloud deploy; Postgres;
vector DB; graph DB; real LLM; NPC memory persistence; living-world room memory;
adjacent-room pre-generation; room-generation repair; a full session-save-load
UI; **any frontend wiring** (the browser keeps the in-memory adapters); an HTTP
server / `apps/api` / browser fetch / API client; `packages/contracts` /
workspaces / any shared-package extraction or file moves; Kysely/Drizzle/another
SQLite driver; changes to `App.tsx`, `RoomViewer.tsx`, the renderer, the
`WorldStore` port, `domain/world/**` (event union/reducer/schemas), or
`InMemoryWorldStore`; raw SQL outside `src/persistence/**`; storing `THREE.*` /
renderer objects (store validated RoomSpec JSON only); in-browser/wasm SQLite.

## Commit plan

Small, independently buildable/testable commits (AGENTS rule 12). Each commit
must leave `npm run build`, `npm run lint`, and `npm run test` (in `apps/web`)
passing. Codex (or a separate Claude pass) implements; the maintainer commits
manually. This ADR is created **first** (now), as accepted design / not yet
implemented.

1. **`chore(persistence): scaffold node-only sqlite build unit and migration runner`**
   — `src/persistence/db.ts`, `migrations/0001_init` + `migrations/index.ts`,
   `testing/createTestDb.ts`; `tsconfig.persistence.json` + root reference +
   `tsconfig.app.json` exclude; the two ESLint blocks; migration tests. No
   adapters yet.
2. **`feat(persistence): add SqliteWorldStore implementing the WorldStore port`**
   — adapter + the reusable world-store contract describe (run against SQLite) +
   append-only/concurrency/projection-consistency/isolation/durability tests.
3. **`feat(domain): add RoomStore port`** — `domain/ports/RoomStore.ts` + types +
   a small port-shape test (covered by the existing domain lint block).
4. **`feat(persistence): add SqliteRoomStore`** — adapter + save/load/get/
   corrupt/duplicate/isolation tests; optional `SaveGameService`-over-SQLite
   round-trip test.
5. **`docs(architecture): record backend sqlite persistence v0`** — flip this ADR
   to *implemented*; update [ARCHITECTURE.md](../ARCHITECTURE.md) (`❌→✅`
   persistence plug-in point), [BOUNDARIES.md](../BOUNDARIES.md) (persistence
   layer row + the new lint walls), [FAILURE-MODES.md](../FAILURE-MODES.md) (DB
   failure now ✅-headless + room-store cases), and [AGENTS.md](../../../AGENTS.md)
   (module table / status paragraph).

(Commits 3 + 4 may merge if small. If an even smaller split is preferred, ship
1 + 2 as `backend-sqlite-world-store-v0` and 3 + 4 as `backend-room-store-v0`.)

## Files likely to change / add

- **New (persistence):** `apps/web/src/persistence/db.ts`,
  `migrations/0001_init.ts`, `migrations/index.ts`, `SqliteWorldStore.ts`,
  `SqliteRoomStore.ts`, `testing/createTestDb.ts`,
  `testing/worldStoreContract.ts`, co-located `*.test.ts`.
- **New (domain):** `apps/web/src/domain/ports/RoomStore.ts` (+ test).
- **New (config):** `apps/web/tsconfig.persistence.json`.
- **Edited (config only):** `apps/web/tsconfig.json` (add reference),
  `apps/web/tsconfig.app.json` (exclude `src/persistence`),
  `apps/web/eslint.config.js` (two new blocks); possibly
  `apps/web/package.json` (bump `@types/node` only if `node:sqlite` types are
  missing — no runtime dependency).
- **Docs (commit 5, later):** `ARCHITECTURE.md`, `BOUNDARIES.md`,
  `FAILURE-MODES.md`, `AGENTS.md`, and this ADR's status flip.
- **Deliberately NOT changed:** `App.tsx`, `RoomViewer.tsx`, `renderer/**`,
  `world-session/InMemoryWorldStore.ts`, `world-session/WorldSession.ts`,
  `domain/ports/WorldStore.ts`, `domain/world/**`, `room/RoomRegistry.ts`,
  `vite.config.ts`.

## Implementation notes (as built)

Two places where the shipped code refines the brief's literal text while
preserving its architecture exactly:

1. **ESLint reciprocal wall — composed, not a single clobbering block.** The
   brief's reciprocal block (`files: ['src/**'], ignores: ['src/persistence/**']`)
   was verified to **clobber** every per-folder `no-restricted-imports` rule:
   ESLint flat config is **last-match-wins per rule** (no option merging), so a
   broad `src/**` block placed last silently disables the renderer/engine,
   domain, world-session, etc. boundary bans for those folders. The same intent
   is implemented without weakening anything by (a) adding the shared
   `node:sqlite` + `**/persistence/**` restriction **into each existing
   per-folder block**, and (b) keeping one reciprocal block scoped (via
   `ignores`) to the **un-foldered** composition/platform files (`App.tsx`,
   `RoomViewer.tsx`, `app/**`, `room/**`, `platform/**`, `main.tsx`). The
   persistence-self wall is the single block specified. Net effect: both walls
   enforced, **no existing rule weakened**, and the persistence ban now covers
   every non-persistence folder (stronger than a clobbering single block).
2. **Projection-consistency test — driven through domain primitives, not
   `WorldSession`.** The persistence-self wall forbids importing
   `**/world-session/**` (the brief flagged that a `WorldSession`-driven test
   would trip it). The shipped projection-consistency test drives
   `SqliteWorldStore` directly with domain-reduced events (`applyEvent` + the
   event schema) and asserts `projectWorldState(listEvents) deepEquals
   getSnapshot`, proving the same invariant **without** importing `world-session/`
   and **without** any lint carve-out. A `WorldSession`-driven composition test
   would require weakening the wall (a test-file carve-out) and is **deferred
   pending maintainer approval**, per the brief's standing instruction to stop
   and ask before relaxing the boundary.

## Consequences

- A complete, deterministic, regression-tested **durable** persistence foundation
  exists for world sessions/events/snapshots and saved RoomSpecs — Node-only,
  behind the existing ports, with **no domain change** and **no frontend change**.
  ADR-0013's promise ("the SQLite adapter implements `WorldStore` with no domain
  change") is realized.
- The browser bundle is provably free of DB code: physical exclusion (tsconfig +
  Vite reachability) plus bidirectional lint walls.
- The `RoomStore` shape matches `RoomRegistry.resolve`, so a future room-backed
  source slots in behind the same contract; the `WorldStore` adapter is the seam
  an `apps/api`/HTTP slice and, later, a Postgres adapter (ADR-0004) layer onto
  without touching the domain.
- Discipline paid now (migrations, CAS, append-only triggers, boundary
  re-validation, temp-DB tests) is repaid the first time HTTP lands or the dialect
  moves to Postgres.

## Alternatives considered

- **`apps/api` + HTTP now (Option B)** — rejected for this slice: multiple new
  failure surfaces (framework, network, CORS, frontend rewiring) at once; HTTP is
  a separate later slice behind the same ports.
- **Workspaces + `packages/contracts` extraction first (Option C)** — deferred
  ([ADR-0005](./ADR-0005-defer-shared-package-extraction.md)): the only consumer
  is in-package (no cross-package drift), and extraction would rewrite ~50 imports
  across the working app for no v0 safety gain.
- **In-browser / wasm SQLite (Option D)** — rejected
  ([ADR-0004](./ADR-0004-persistence-sqlite-to-postgres.md)): persistence is the
  server-side system of record; it must not enter the browser bundle.
- **`better-sqlite3` / Kysely / Drizzle** — deferred: `node:sqlite` is built into
  the runtime (zero dependencies, no native build, Windows-friendly) and
  sufficient for a SQLite-only v0. ADR-0004's dual-dialect query tool is revisited
  when the Postgres migration actually approaches; substituting earlier requires
  maintainer approval.
- **Store computes the projection** — rejected: would make the snapshot a second
  source of truth. The session computes `applyEvent`; the store persists event +
  snapshot atomically (ADR-0013 rule 12 preserved).
- **Literal shared contract suite imported across `world-session/` and
  `persistence/`** — rejected: it would force a cross-layer import that violates
  the persistence wall. The contract describe lives in `persistence/testing/` and
  mirrors the in-memory behaviors instead.
