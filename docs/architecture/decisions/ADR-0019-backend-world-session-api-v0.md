# ADR-0019: Backend World Session API v0 — a headless, Node-only HTTP edge over the existing SQLite stores

- **Status:** Implemented — Backend World Session API v0
- **Date:** 2026-06-23
- **Deciders:** Project owner

> Implemented under `apps/web/src/server/**` as a browser-excluded Node/TypeScript
> build unit. The browser remains on its in-memory adapters; this API is not wired
> into `App.tsx`, `RoomViewer.tsx`, or the renderer.

## Context

[ADR-0018](./ADR-0018-backend-sqlite-persistence-v0.md) landed the first durable
store as a **headless, Node-only** build unit (`apps/web/src/persistence/**`): a
`node:sqlite` connection + forward-only migration runner, `SqliteWorldStore`
(implementing the unchanged `WorldStore` port), and `SqliteRoomStore` (the new
`RoomStore` port). It is **provably excluded from the browser bundle** and
**wired to nothing in the browser** — the running app still uses
`InMemoryWorldStore`, `RoomRegistry`, and `SessionRoomCache`.

[ADR-0013](./ADR-0013-world-state-event-log-v0.md) defined the headless
application layer: `WorldSession` exposes typed use-cases (`startSession`,
`appendEvent` + `move`/`addItem`/…, `getWorldState`, `getEventLog`) over the
`WorldStore`/`Clock`/`IdGenerator`/`Logger` ports and returns typed results
(`not-found` / `already-exists` / `conflict` / `invalid-command` /
`invalid-canon`). The only write path is "append a validated event, then
project".

So a *durable* store and a *headless* session layer both exist, but **nothing
connects a running process to them over a wire.** ADR-0018 stopped exactly at the
port boundary and named this follow-up explicitly:

> "**`apps/api` / HTTP is a separate, later slice** (`backend-world-session-api-v0`).
> … The **ports are the contract**; HTTP layers on top behind them later."

This slice adds the **thinnest safe HTTP edge** over the existing stores. It
begins to make [FAILURE-MODES](../FAILURE-MODES.md) case 5 (backend / network)
real, while leaving the browser, the renderer, the domain, and the persistence
adapters untouched.

`AGENTS.md` lists "a hosted backend / HTTP server / `apps/api`" as out of scope
**without explicit maintainer approval**. The maintainer has explicitly approved
**this slice** (the decisions below); the final docs commit reflects that in
`AGENTS.md`.

### The central architectural constraint

The repository is a single browser-targeted Vite bundle (`apps/web`). The HTTP
edge is **Node-only server code** (it imports `node:http` and composes over the
Node-only persistence adapters). So the single most important rule of this slice
mirrors ADR-0018: the server is a **physically separate Node build unit, provably
excluded from the browser bundle**, enforced mechanically by tsconfig + Vite
reachability + ESLint walls — not by convention. The browser must reach the API
**only over HTTP (fetch)**, never by importing server code.

## Maintainer-approved decisions (binding for this slice)

1. **Scope — Option B, single slice.** Build the API server **plus** integration
   tests over temp SQLite databases. **No frontend wiring** (the browser keeps
   its in-memory adapters). Ship as one feature slice in small commits (see
   [Commit plan](#commit-plan)).
2. **Packaging — keep it inside `apps/web`.** The server lives under
   `apps/web/src/server/**` as a Node-only, browser-excluded, lint-walled build
   unit (the same Option A2 packaging ADR-0018 used for persistence). **Do not**
   create `apps/api`. **Do not** set up npm workspaces or `packages/contracts`,
   and **do not** move existing files. The only consumer of the domain contracts
   is still in-package (relative imports), so the
   [ADR-0005](./ADR-0005-defer-shared-package-extraction.md) extraction trigger
   (a backend **and** a genuine *cross-package* consumer) is still not met.
3. **Framework — native `node:http`.** Use Node's built-in HTTP server with a
   tiny hand-written router. **Zero new runtime dependencies** — this mirrors the
   `node:sqlite` decision and AGENTS rule 13 ("smallest seam; no heavy
   frameworks"). zod (an existing dependency) does all validation. **Do not** add
   Hono / Fastify / Express; if a framework later proves necessary, **STOP and
   ask**.
4. **Local run path — `tsx` devDependency.** Add `tsx` as a **devDependency**
   (no runtime dependency) and an `npm run dev:api` script
   (`tsx src/server/main.ts`) so the server runs locally with the codebase's
   extensionless relative imports. **DB path resolution:** use `AIGM_DB_PATH` if
   set; otherwise default to a local **file** DB (`.data/aigm-dev.sqlite`) so a
   manual `npm run dev:api` preserves sessions/rooms across restarts. **Tests**
   keep using `:memory:` / temp-file SQLite DBs — never the dev file. The dev DB
   directory is created on demand and `.data/` is git-ignored. Tests run under
   Vitest regardless.
5. **Include `POST /sessions/:sessionId/move`.** It is the one write-command endpoint in
   v0 — a thin pass-through to `WorldSession.move` that proves the full
   HTTP → session → SQLite compare-and-set / conflict write path. It does **not**
   check that the target room exists (deferred). No other command endpoints
   (item / health / status / room-state) are exposed in v0.
6. **No domain / persistence / frontend change.** The `WorldStore` / `RoomStore`
   ports, `domain/world/**`, the persistence adapters, `App.tsx`,
   `RoomViewer.tsx`, and the renderer are all consumed/left as-is. No HTTP client,
   no CORS, no dev proxy, no fetch in the browser in this slice. *If
   implementation proves any of these must change, STOP and ask the maintainer.*

### Why no `apps/api` / workspaces / `packages/contracts`

Standing up a separate app/package now would pull in workspace tooling and
mechanically rewrite ~50 `../domain/...` imports across the working app for no v0
safety gain — exactly the cost [ADR-0005](./ADR-0005-defer-shared-package-extraction.md)
and ADR-0018 deferred. Keeping the server in `apps/web/src/server/**` with
relative imports keeps the slice small and the boundaries lint-enforced. The
extraction stays mechanical when a genuine cross-package consumer (e.g. a shared
client) actually appears.

## Decision (implemented)

The implemented headless, Node-only HTTP edge under `apps/web/src/server/**` opens
SQLite through the existing persistence layer, runs migrations at startup, and
exposes a small set of validated endpoints by composing the existing
`SqliteWorldStore`, `SqliteRoomStore`, and `WorldSession`.

```
 Browser build (apps/web/src, Vite)        Node-only server build unit (apps/web/src/server)
   App.tsx / RoomViewer / renderer / ui       main.ts        entry: bootstrap → start http server
   world-session / interactions / ...         bootstrap.ts   open() + runMigrations + construct stores/session
        │ depends on                          createServer   node:http binding (read body → router → response)
        ▼                                      router.ts      route table → handler(ctx, deps) → ApiResult
   DOMAIN / CONTRACTS ◄── both consume ──      http.ts        JSON read/parse, sendJson, ApiError → status
   (zod schemas, ports, loaders)              contracts.ts   zod request schemas
        ▲                                      routes/        health.ts, sessions.ts, rooms.ts
        │ implements ports                          │ composes over
        └──── persistence (SqliteWorldStore / SqliteRoomStore) ◄──── server ────┘
                                              (server may import domain, persistence, world-session, platform;
                                               excluded from tsconfig.app + Vite; lint-walled both ways)
```

The server is a **composition layer** for the backend: it wires concrete
adapters together and translates HTTP ⇄ typed application results. It contains
**no SQL** (that stays in `persistence/**`) and **no gameplay logic** (that stays
in `world-session/**` and the domain).

### Architectural rules (binding)

1. **The server is Node-only and physically excluded from the browser bundle.**
   It lives under `src/server/**`, is excluded from `tsconfig.app.json` and from
   Vite (unreachable from `main.tsx`), and is type-checked by a dedicated Node
   `tsconfig.server.json`.
2. **Lint walls both directions.** Nothing in the browser/composition surface
   (`src/**` outside `src/server/**` and `src/persistence/**`) may import
   `**/server/**` (or `node:http` / `node:sqlite`). The server may import the
   domain, the persistence adapters, `world-session`, and `platform`, but **must
   not** import React, Three.js, the renderer, or the UI.
3. **No change to the ports or the domain.** `WorldStore`, `RoomStore`,
   `domain/world/**`, `roomSpec`, and `loadRoomSpec` are consumed unchanged. The
   persistence adapters are consumed unchanged.
4. **Validate at the HTTP trust boundary** (the project's
   "validate at every trust boundary" rule). Every request body / path param /
   query param is validated with a zod schema **before** the application layer is
   touched. Responses serialize already-validated domain objects to known fields
   only.
5. **All state changes go through `WorldSession`.** The server never appends
   events or writes SQL directly; the only write paths are
   `WorldSession.startSession` / `WorldSession.move` and
   `SqliteRoomStore.saveRoom`.
6. **Expected outcomes are typed → 4xx; genuine faults → 5xx / fail fast.**
   Typed application results map to HTTP status codes; a thrown error (corrupt
   session JSON, a DB fault) is caught at the top level and mapped to a safe 5xx.
   DB-open / migration failure at startup **fails fast** — the process exits and
   never listens.
7. **Never expose internals.** SQL errors, stack traces, stored row text, and raw
   zod values are never returned in a response body.
8. **Logs carry ids / counts / codes only** — method, route template, status,
   latency, and where relevant `sessionId` / `roomId` / error `code` /
   `eventCount`. **Never** request/response bodies, RoomSpec text, event
   payloads, item names, `reason`, room `name`, or dialogue
   ([ADR-0003](./ADR-0003-logging-abstraction.md), ADR-0013 rule 10, ADR-0018
   rule 12).
9. **Ports + constructor injection; no new framework** (AGENTS rule 13). DI =
   constructor parameters / a plain `AppDeps` object.

## Scope (v0)

**In scope (headless, Node-only):**

- A Node-only build unit `apps/web/src/server/**` (entry, bootstrap, `node:http`
  binding, router, HTTP/error helpers, request contracts, route handlers, a test
  harness).
- The endpoints in [Endpoints](#endpoints).
- Request/response validation, the typed [error envelope](#error-envelope), and
  log-safety.
- Integration tests over temp SQLite databases (handler-level + one real-socket
  test).
- tsconfig / Vite / ESLint exclusion + wall changes (config only).
- A `tsx` devDependency + a `dev:api` script.
- This ADR (other docs are updated in the final commit).

**Out of scope / non-goals:** see [Non-goals](#non-goals).

## Endpoints

| Method + path | Behavior | Success | Errors |
| --- | --- | --- | --- |
| `GET /health` | Lightweight liveness: confirm the connection answers (`SELECT 1` / migration version). | `200 { status: 'ok', persistenceSchemaVersion: 1 }` | probe throws → `503 unavailable` |
| `POST /sessions` | Validate body → compose a `CanonSeed` (server stamps `worldId` + `schemaVersion`) → `WorldSession.startSession`. | `201 { sessionId, state }` | bad body → `400 invalid-request`; `invalid-canon` → `400` |
| `GET /sessions/:sessionId/state` | `WorldSession.getWorldState`. | `200 { state }` | `not-found` → `404` |
| `GET /sessions/:sessionId/events` | Parse `?sinceSeq=` (non-negative int) → `WorldSession.getEventLog`. | `200 { events }` | bad `sinceSeq` → `400`; `not-found` → `404` |
| `POST /sessions/:sessionId/move` | Validate body → `WorldSession.move(sessionId, toRoomId, expectedRevision, fromRoomId?)`. Thin pass-through; **no** target-room existence check (deferred). | `200 { state, event }` | bad body → `400`; `not-found` → `404`; `conflict` → `409`; `invalid-command` → `400` |
| `PUT /rooms/:roomId` | Validate body with `RoomSpecSchema` and require `body.id === roomId` → `SqliteRoomStore.saveRoom`. | `200 { ok: true, roomId }` | invalid spec → `400 invalid-room`; id mismatch → `400 room-id-mismatch` |
| `GET /rooms/:roomId` | `SqliteRoomStore.getRoom`. | `200 { room, warnings: <count> }` | `not-found` → `404`; `invalid-stored-room` → safe `500 internal` |
| _unmatched_ | — | — | unknown path → `404 not-found`; known path, wrong verb → `405 method-not-allowed` |

`GET /rooms/:roomId` returns the validated RoomSpec **data** derived from the
`LoadedRoom`; the loader's `skipped` / `warnings` are reduced to a **count**
(`warnings`) and the raw skipped content is never echoed.

## Request / response contracts

Validation reuses domain schemas where they exist and adds only a few API-shaped
request schemas (in `server/contracts.ts`). Exact zod calls are the implementer's
choice; the shapes below are binding.

- **`POST /sessions` body** (server stamps `worldId` / `schemaVersion` so clients
  do not invent UUIDs):
  ```
  CreateSessionRequest = {
    name: string (min 1),
    startingRoomId: string (min 1),
    initialPlayer: {
      health: { current: int >= 0, max: int > 0, refine current <= max },
      status?: string[],
      inventory?: InventoryItem[]   // reuse InventoryItemSchema
    }
  }
  ```
  The handler composes a full `CanonSeed` and calls `WorldSession.startSession`,
  which re-validates with `CanonSeedSchema` (defense in depth).
- **`POST /sessions/:sessionId/move` body:**
  `{ toRoomId: string (min 1), expectedRevision: int >= 1, fromRoomId?: string }`.
- **`GET /sessions/:sessionId/events` query:** `sinceSeq` parsed as a non-negative
  integer; non-numeric → `400`.
- **`PUT /rooms/:roomId` body:** validated by `RoomSpecSchema`; additionally
  require `body.id === roomId` (else `room-id-mismatch`).

**Responses** serialize already-validated domain objects (`WorldState`,
`WorldEvent[]`, RoomSpec data) to known fields only. Defensive re-validation on
the way out is allowed but not required.

## Error envelope

One envelope, a stable code enum, generic safe messages:

```ts
type ApiError = { error: { code: ApiErrorCode; message: string } }

type ApiErrorCode =
  | 'invalid-request'     // 400 — body/param/query failed schema validation
  | 'room-id-mismatch'    // 400 — PUT /rooms/:roomId body.id !== roomId
  | 'invalid-room'        // 400 — RoomSpec failed validation on save
  | 'not-found'           // 404 — session/room/route not found
  | 'method-not-allowed'  // 405 — known path, wrong verb
  | 'conflict'            // 409 — stale expectedRevision (CAS)
  | 'unavailable'         // 503 — health probe failed
  | 'internal'            // 500 — uncaught fault (incl. corrupt session JSON, SQL fault)
```

A `400 invalid-request` body may carry safe zod issue **paths / codes** but
**never** echoes the offending values, stored text, or a stack trace. `500` and
`503` bodies carry a generic message only.

## Store / session integration

**Construction (`server/bootstrap.ts` → `AppDeps`):**

```
const db = open(dbPath)                 // dbPath = AIGM_DB_PATH if set, else .data/aigm-dev.sqlite (file, persists across restarts)
runMigrations(db)                       // fail-fast: throws -> process exits non-zero BEFORE listening
const logger = createConsoleLogger()    // reused as-is; Node console is fine, and it is the only no-console-exempt file
const worldStore = new SqliteWorldStore(db, logger)
const roomStore  = new SqliteRoomStore(db, logger)
const idGenerator = new UuidGenerator()
const session = new WorldSession(worldStore, new SystemClock(), idGenerator, logger)
return { db, session, roomStore, idGenerator, logger }
```

**Lifecycle.** One process, **one synchronous `DatabaseSync` connection**, one
long-lived `WorldSession` / `SqliteRoomStore`. `node:sqlite` is synchronous and
single-threaded, so requests serialize naturally on the connection — **no pool**
and no extra locking at v0 scale. Transactions stay **inside** the persistence
adapters (`withTransaction`); the server issues no SQL. On `SIGINT` / `SIGTERM`:
stop accepting connections, `db.close()`, exit.

**Migration startup behavior.** `runMigrations` runs once at boot **before** the
server listens. If it throws (unopenable / half-migrated DB), the process fails
fast and never serves traffic ([FAILURE-MODES](../FAILURE-MODES.md) case 6). By
the time `/health` can answer, the DB is migrated.

**Logger reuse.** The server reuses the existing `createConsoleLogger()`
adapter — `console` exists in Node, and `consoleLogger.ts` is already the single
`no-console`-exempt file, so no new logger adapter and no new lint exemption are
introduced. `SystemClock` and `UuidGenerator` are reused as-is.

**Seed / demo rooms.** Boot does **not** auto-persist demo rooms (it stays
side-effect-free; the DB starts empty). Rooms are exercised **only via the API**
in tests (`PUT` then `GET`). The hardcoded example rooms remain browser-side
`RoomRegistry` data. A future seed script is additive.

## Log-safety

Routes, application services, and stores log only through the injected `Logger`.
Context is limited to safe ids, revisions, counts, fixed event/error codes, and
route templates where relevant. Router/socket fault catches return a generic
`internal` envelope and log no raw error, stack, SQL, stored row, request body,
RoomSpec text, event payload, item name, or dialogue. Capturing-logger integration
tests guard these exclusions.

## Failure modes (to fold into [FAILURE-MODES.md](../FAILURE-MODES.md) in the docs commit)

| Failure | Detection → handling → logging |
| --- | --- |
| DB unavailable | `open` / `runMigrations` throws at boot → **fail fast**, exit, never listen. Runtime query fault → top-level catch → `500 internal` / `503`. Code only. |
| Migration failure | per-migration `withTransaction` rolls back, `runMigrations` rethrows → boot aborts; DB stays at prior version. Migration `version` only. |
| Invalid request | zod `safeParse` at the edge fails → `400 invalid-request` (safe issue paths/codes, no values). Code + route template. |
| Invalid RoomSpec (`PUT`) | `RoomSpecSchema` / `saveRoom` rejects → `400 invalid-room`. `roomId` + code. |
| Session not found | typed `not-found` → `404`. `sessionId` + code. |
| Stale revision / conflict (`move`) | `WorldSession.move` → `conflict` (CAS) → `409`. `sessionId` + revision + code. |
| Room not found (`GET`) | typed `not-found` → `404`. `roomId` + code. |
| Malformed persisted JSON | session snapshot/event corruption **throws** in the store → top-level catch → `500 internal` (never the row). Stored-room corruption → typed `invalid-stored-room` → `500`. Code (+ `roomId`). |
| Unknown route / method | router returns safe `404 not-found` / `405 method-not-allowed` envelopes. |
| Malformed / oversized body | body reader rejects non-JSON / over a size cap → safe `400 invalid-request`. |
| Unsafe logs | capturing-logger tests assert that only safe ids/counts/codes/templates are recorded. |

## Lint / tsconfig / Vite exclusion rules

**tsconfig:**

- New `tsconfig.server.json`: Node target — `"types": ["node"]`,
  `"lib": ["ES2023"]` (**no DOM**), `"include": ["src/server"]`, `"noEmit": true`,
  matching the repo's strictness (`strict`, `noUncheckedIndexedAccess`,
  `verbatimModuleSyntax`, `erasableSyntaxOnly`, bundler resolution) — i.e. a clone
  of `tsconfig.persistence.json` pointed at `src/server`.
- `tsconfig.app.json`: add `src/server` to `"exclude"` (alongside
  `src/persistence`) so the browser build never type-checks server code.
- `tsconfig.json`: add `{ "path": "./tsconfig.server.json" }` to `references` so
  `tsc -b` (and thus `npm run build`) type-checks the server and fails on errors.

**Vite:** no config change — the server is unreachable from `main.tsx`, so Vite
never bundles it; the reciprocal lint wall keeps it that way.

**ESLint (`eslint.config.js`):**

- **Reciprocal browser → server ban.** Add a `noServerImport`
  (`group: ['**/server/**']`) restriction next to the existing `noSqliteImport` /
  `noPersistenceImport`, and **fold it into every existing per-folder block plus
  the reciprocal block** — the same anti-clobber technique ADR-0018 documented
  (flat config is last-match-wins per rule, so a single broad block would silently
  drop the per-folder boundaries). Net: no non-server, non-persistence source file
  may import `**/server/**`, `node:http`, or `node:sqlite`.
- **Server-self wall** (new block, `src/server/**`): **allow** `node:http`,
  `node:sqlite`, `**/persistence/**`, `**/world-session/**`, `domain/**`,
  `platform/**`; **forbid** `react` / `react-dom`, `three` / `three/*`, and
  `**/renderer/**`. This encodes the BOUNDARIES "Backend / HTTP → may import
  Domain, Persistence, World-session; must NOT import UI / Renderer" row.

`no-console` stays globally enforced; the server logs through the reused
`Logger` adapter, never `console.*` directly.

## Tests (Vitest, Node environment, co-located; no DOM / e2e)

The router is built independently of the socket: tests drive
`router(ctx, deps)` with a constructed request descriptor over a temp DB, and a
single test exercises the real `node:http` binding.

- **Health:** migrated DB → `200 { status: 'ok' }`.
- **Sessions flow:** `POST /sessions` (valid) → `201` with `state.revision === 1`;
  `GET …/state` echoes it; `GET …/events` returns the `session-started` event;
  `sinceSeq` filtering; bad body → `400`.
- **Move:** happy path bumps revision and returns the event; **`409` on stale
  `expectedRevision`**; **`404` on unknown session**; `invalid-command` (e.g.
  `fromRoomId` ≠ current) → `400`.
- **Rooms:** `PUT` valid spec → `200`; `GET` round-trips to a
  `loadRoomSpec`-equal room; **id mismatch → `400`**; invalid spec →
  `400 invalid-room`; unknown id → `404`; an injected corrupt `spec_json` →
  `500` (`invalid-stored-room`) with no row text in the body.
- **Routing:** unknown path → `404`; wrong method → `405`.
- **Safe errors:** a forced corrupt-session read returns `500` whose body
  contains no SQL / stack / row text; a `400` body contains no echoed input
  values.
- **Log-safety:** drive create / move / room-save through a capturing logger and
  assert no payloads / names / spec / dialogue text appear.
- **Real-socket smoke (1 test):** `createServer` listens on port 0; a real
  `fetch` hits `/health` and `POST /sessions` — proves the `node:http` glue and
  JSON I/O.
- **No browser-leakage:** rely on the `tsconfig.app` exclude + ESLint walls;
  optionally assert `src/server` is unreachable from `main.tsx`.

The harness reuses `persistence/testing/createTestDb.ts`
(`createMemoryDb` / `createTempFileDb` / `createCapturingLogger` /
`silentLogger`); `server/testing/createTestApp.ts` builds the router + `AppDeps`
over that DB.

## Non-goals

This slice must **not** implement: FastAPI; Python; auth / users; billing;
hosted / cloud deploy; CORS / a dev proxy; a browser fetch client or **any
frontend wiring** (the browser keeps its in-memory adapters; `App.tsx` /
`RoomViewer.tsx` / the renderer are untouched); WebSocket / streaming; a
save/load-over-HTTP endpoint or a full session-save-load UI; generic command
endpoints (item / health / status / room-state); listing endpoints; a
target-room existence check on `move`; a real LLM; NPC memory persistence;
living-world room memory; adjacent-room pre-generation; room-generation repair /
fallback; Postgres; a vector / graph DB; another SQLite driver or an ORM;
`apps/api`; `packages/contracts` / npm workspaces / any shared-package extraction
or file moves; a web framework (Hono / Fastify / Express); raw SQL outside
`src/persistence/**`; changes to the `WorldStore` / `RoomStore` ports,
`domain/world/**`, the persistence adapters, or `InMemoryWorldStore`.

## Commit plan

Implemented as small, independently buildable / testable commits (AGENTS rule
12). Each implementation commit left `npm run build`, `npm run lint`, and
`npm run test` (in `apps/web`) passing; the maintainer committed each step
manually.

1. **`chore(server): scaffold node-only http build unit and health endpoint`** —
   `tsconfig.server.json` + root reference + `tsconfig.app.json` exclude; the
   ESLint server-self wall + the reciprocal browser → server ban folded
   per-block; `bootstrap.ts`, `http.ts`, `router.ts`, `createServer.ts`,
   `main.ts`, `routes/health.ts`, `testing/createTestApp.ts`; `tsx`
   devDependency + `dev:api` script; health + real-socket tests. No session/room
   routes yet.
2. **`feat(server): add session endpoints (create/state/events)`** —
   `routes/sessions.ts` + `contracts.ts` (`CreateSessionRequest`, `sinceSeq`) +
   tests.
3. **`feat(server): add move command endpoint`** — `MoveRequest` + handler +
   conflict / not-found / invalid-command tests.
4. **`feat(server): add room save/get endpoints`** — `routes/rooms.ts` + the
   id-match contract + save / get / invalid / not-found / corrupt tests.
5. **`docs(architecture): record world-session HTTP API v0`** — flip this ADR to
   *implemented*; update [ARCHITECTURE.md](../ARCHITECTURE.md) (Backend / API
   plug-in point `❌→✅`), [BOUNDARIES.md](../BOUNDARIES.md) (server layer row +
   the new walls), [FAILURE-MODES.md](../FAILURE-MODES.md) (case 5 now ✅ v0), and
   [AGENTS.md](../../../AGENTS.md) (module table / status paragraph / out-of-scope
   note).

(If an even smaller split is preferred, ship commits 1–2 as
`backend-api-scaffold-v0` and commits 3–4 as `backend-room-api-v0`.)

## Files added / changed

- **New (server):** `apps/web/src/server/main.ts`, `bootstrap.ts`,
  `createServer.ts`, `router.ts`, `http.ts`, `contracts.ts`,
  `routes/{health,sessions,rooms}.ts`, `testing/createTestApp.ts`, and co-located
  `*.test.ts`.
- **New (config):** `apps/web/tsconfig.server.json`.
- **Edited (config only):** `apps/web/tsconfig.json` (add reference),
  `apps/web/tsconfig.app.json` (exclude `src/server`),
  `apps/web/eslint.config.js` (server-self wall + folded reciprocal ban),
  `apps/web/package.json` (`tsx` devDependency + `dev:api` script).
- **Docs (commit 5):** `ARCHITECTURE.md`, `BOUNDARIES.md`,
  `FAILURE-MODES.md`, `AGENTS.md`, and this ADR's status closeout.
- **Deliberately NOT changed:** `App.tsx`, `RoomViewer.tsx`, `renderer/**`,
  `persistence/**`, `world-session/**`, `domain/ports/**`, `domain/world/**`,
  `InMemoryWorldStore.ts`, `RoomRegistry.ts`, `vite.config.ts`.

## Consequences

- A runnable, regression-tested **HTTP edge** exists over the durable stores —
  Node-only, behind the existing ports, with **no domain / persistence / frontend
  change**. ADR-0018's promise ("HTTP layers on top behind the ports later") is
  realized.
- The browser bundle stays provably free of server / DB code: physical exclusion
  (tsconfig + Vite reachability) plus bidirectional lint walls.
- The seam for a later `frontend-api-client-v0` is clean: the browser will talk to
  the API over HTTP only, and shared request/response types can be extracted then
  if a genuine cross-package consumer justifies it
  ([ADR-0005](./ADR-0005-defer-shared-package-extraction.md)).
- Zero new runtime dependencies; one devDependency (`tsx`). The discipline paid
  for persistence (typed results, fail-fast faults, boundary re-validation, temp-DB
  tests) is reused, not re-litigated.

## Alternatives considered

- **`apps/api` + workspaces now** — rejected for this slice
  ([ADR-0005](./ADR-0005-defer-shared-package-extraction.md), ADR-0018): the only
  consumer is in-package, so extraction would rewrite ~50 imports for no v0 safety
  gain. Revisited when a real cross-package consumer appears.
- **A web framework (Hono / Fastify / Express)** — deferred: ~7 endpoints do not
  justify a dependency; native `node:http` matches the `node:sqlite` "use the
  built-in" decision and AGENTS rule 13. Revisited only if middleware / many
  routes are genuinely needed (STOP and ask).
- **Frontend wiring in this slice (Option C)** — rejected: adds CORS, a dev
  proxy, fetch loading/error states, and renderer rewiring — multiple new failure
  surfaces at once. Deferred to `frontend-api-client-v0`.
- **Generic command endpoints / save-load over HTTP now** — deferred: `move`
  alone proves the write path; broader commands and save/load are additive behind
  the same edge later.
- **A connection pool / multiple connections** — rejected: `node:sqlite` is
  synchronous and single-threaded; one connection serializes requests safely at
  v0 scale.
- **Run the server via Node native type-stripping instead of `tsx`** — deferred:
  the codebase's extensionless relative imports make the native path fiddly; a
  single `tsx` devDependency is the smallest reliable dev runner and adds no
  runtime dependency.
