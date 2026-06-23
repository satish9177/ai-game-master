# ADR-0025: Living-World Room Memory v0 — scoped room memory store + the room-memory firewall

- **Status:** Accepted — **implemented** (Living-World Room Memory v0; bundles
  room-memory-firewall-v0)
- **Date:** 2026-06-23
- **Deciders:** Project owner

## Context

The `npc-memory-persistence-v0` slice ([ADR-0024](./ADR-0024-npc-memory-persistence-v0.md))
established the headless memory cadence: a pure domain firewall + contracts, a store
port, a headless service, an in-memory adapter, and a SQLite adapter — all with a
structural separation guaranteeing memory cannot become world truth. This slice applies
the same cadence to **rooms**.

The defining property is unchanged: **room memory is supporting context only and can
never become room truth.** `WorldState.roomStates[roomId]` (`.visited`, `.flags`) and
the append-only `WorldEvent[]` remain the sole authority over what is actually true
about a room. The room-memory layer is constructed with **no reference to
`WorldSession`/`WorldStore`/`WorldCommand`/`WorldEvent`/`WorldState`**, so it has no
code path to mutate state.

v0 adds **no API, no frontend/dialogue wiring, no room-generation injection, no
adjacent-room pregeneration wiring, and no LLM memory writer or prompt injection**.
The browser stays in-memory and unwired. Full design in the implementation plan
[`living-world-room-memory-v0`](../implementation-plans/living-world-room-memory-v0.md).

## Decision

Ship **Option B (trimmed)**: a pure domain firewall + contracts, a `RoomMemoryStore`
port, a headless `RoomMemoryService`, an `InMemoryRoomMemoryStore`, and a
`SqliteRoomMemoryStore` + migration `0003_room_memories` — **no API, no
frontend/dialogue wiring, no room-generation injection, no adjacent-room pregeneration
wiring, no LLM memory writer or prompt injection**. The browser stays in-memory and
unwired. It mirrors the cadence already accepted for NPC memory and reuses the
`domain/memory/` + `src/memory/` folders so **no ESLint change was needed**.

```
RoomMemoryService.remember(input)         src/memory/
  → validateRoomMemoryDraft(input)        src/domain/memory/roomFirewall.ts  (write firewall)
       reject? → { status:'rejected', reason }
       else stamp memoryId (IdGenerator) + createdAt (Clock)
  → store.record(insert)                  RoomMemoryStore port
       InMemoryRoomMemoryStore | SqliteRoomMemoryStore (assigns seq)
  → { status:'recorded', record } | { status:'failed', reason }

RoomMemoryService.recall(scope, options?)
  → store.listForRoom(scope, { limit })   scoped SQL: world_id+session_id+room_id, seq desc
  → filterRoomMemoriesForScope(raw, scope)  read firewall (defense in depth)
  → selectRecallRoomMemories(scoped, …)  seq desc, then memoryId; limit + maxChars cap
  → { status:'recalled', memories }
```

### Memory contracts (pure domain — `src/domain/memory/roomContracts.ts`)

Strict, versioned (`ROOM_MEMORY_SCHEMA_VERSION = 1`), every string bounded. Imports
only `zod`; exports **no** `WorldCommand`/`WorldEvent`-producing function — there is
no memory→truth mapping (the structural firewall).

- **Scope is strict `(worldId, sessionId, roomId)`.** Every read and write is
  filtered against the exact triple. **No cross-session and no cross-world memory in
  v0** — recall requires the full triple. `roomId` is a plain non-empty string
  (`z.string().min(1)`), decoupled from the world UUID schema and **not FK'd to the
  `rooms` table**.
- **Memory kinds** (`kind`): `player_claim` · `room_observation` · `room_note` ·
  `room_summary`. `room_note` is the home for generated/narrator room text (inert
  supporting context only); `room_summary` is a storable kind only (v0 builds no
  summarizer).
- **Source enum** (`provenance.source`): `player` · `npc` · `game` · `llm`. There is
  **no `system` source** — hidden system/developer/internal text must never be stored
  as memory. `game` means a memory originated by deterministic game rules/runtime
  activity, **not** any hidden prompt/developer text.
- **`confidence`** (`low`/`medium`/`high`) is **informational only** in v0: it does
  not update truth and does **not** drive recall ranking.
- **`text`** is opaque, inert recall content, **bounded to `MAX_ROOM_MEMORY_CHARS = 280`**;
  never parsed, never `eval`'d, never logged.
- **Provenance:** `{ source, npcId?, turnIndex? }` — the symmetric inverse of NPC
  memory's `{ source, roomId?, turnIndex? }`. A room memory may record which NPC
  formed/uttered it; `roomId` is omitted because it is already the scope.
- `memoryId`/`createdAt` are stamped by the service; `seq` is a gapless monotonic
  integer per `(sessionId, roomId)` assigned by the store and is the ordering key.

### Room-memory firewall (pure domain — `src/domain/memory/roomFirewall.ts`)

Pure, total, deterministic: no I/O, no `Date.now`/`Math.random`, no input mutation.
Standalone and parallel to the NPC firewall — it does not import or alter
`domain/memory/firewall.ts`.

- `validateRoomMemoryDraft` — the **write firewall**: validates scope non-empty
  (`invalid-scope`), `kind`/`source`/`confidence` in their closed enums
  (`invalid-kind`/`invalid-source`/`invalid-confidence`), `text` non-empty after trim
  (`empty-text`) and ≤ 280 (`text-too-long`), optional `npcId`/`turnIndex` well-formed
  (`invalid-provenance`); trims `text` and defaults `confidence` to `'medium'`. Returns
  a draft without `memoryId`/`seq`/`createdAt`.
- `filterRoomMemoriesForScope` — the **read firewall** (defense in depth behind the
  scoped SQL query): drops any record whose `(worldId, sessionId, roomId)` does not
  match exactly.
- `selectRecallRoomMemories` — the **only ordering authority**: sorts **`seq` desc,
  then `memoryId`** ascending as a stable tie-break, takes up to `limit`, and caps
  cumulative `text.length` at `maxChars`. Never `confidence`, never recency-by-clock,
  never relevance scoring. **Recall defaults: `limit = 8`, `maxChars = 600`.**

### `RoomMemoryStore` port (`src/domain/ports/RoomMemoryStore.ts`)

Mirrors `NpcMemoryStore`/`WorldStore`/`RoomStore`: expected failures are typed results,
not thrown. `record(insert)` is insert-only and assigns the next `seq` for
`(sessionId, roomId)`; `listForRoom(scope, { limit })` is a scoped, seq-desc read.
Error codes: `session-not-found` · `conflict`. There is **no update or delete** on the
port.

### Headless application (`src/memory/`)

- `RoomMemoryService` — constructor-injected `RoomMemoryStore`, `Clock`,
  `IdGenerator`, `Logger`. It takes **no `WorldSession`/`WorldStore` parameter** and
  has no append path: that is the structural firewall — a recorded memory can never
  become room truth. It is the only logger in this layer.
- `InMemoryRoomMemoryStore` — a pure in-memory adapter (mirrors
  `InMemoryNpcMemoryStore`): assigns `seq = max(seq for (sessionId, roomId)) + 1`,
  stores immutable copies, and returns freshly-copied, scope-filtered, seq-desc,
  limited records (no aliasing). It does **not** enforce the FK; `session-not-found`
  is exercised against SQLite.

### Storage (`src/persistence/`, Node-only)

Migration `0003_room_memories` follows the `npc_memories` precedent — indexed scope
columns alongside a JSON blob:

- `room_memories` with `memory_id PRIMARY KEY`, scope columns (`world_id`,
  `session_id`, `room_id`), `kind`, `seq`, `schema_version`, `memory_json`,
  `created_at`, and **`UNIQUE(session_id, room_id, seq)`**.
- **An FK `session_id REFERENCES world_sessions(session_id)`** (with
  `foreign_keys=ON`) makes "write a memory for a non-existent session" fail at the
  DB; the adapter pre-checks and maps it to `session-not-found`.
- **No FK to the `rooms` table** — `room_id` is a scope string; room memory must not
  require a persisted room row (mirrors `npc_id` being FK'd to nothing). An unknown
  room id is allowed on write and simply recalls `[]`.
- A **scope index** `(world_id, session_id, room_id, seq)` serves both the
  exact-triple filter and seq-desc recall.
- A **`BEFORE UPDATE` no-update trigger** makes immutability provable at the DB.
  **`DELETE` is intentionally left open** for a future forgetting/eviction slice (v0
  never deletes); no no-delete trigger is added.

`SqliteRoomMemoryStore` implements the port (mirrors `SqliteNpcMemoryStore`): `record`
runs inside `withTransaction`, pre-checks the session (`NotFoundSignal` →
`session-not-found`), computes the next `seq`, inserts the row + `memory_json`, and
maps a `UNIQUE` violation from a true concurrent writer (`ConflictSignal` →
`conflict`). `listForRoom` runs the scoped seq-desc query and **re-validates each row
through `RoomMemoryRecordSchema` at the read boundary**, then **re-asserts the parsed
JSON scope against the queried SQL scope**. A corrupt or scope-divergent stored row is
an **expected content failure → that row is skipped** (logged `invalid-stored-memory`,
memoryId/code only), never thrown, never blocking — contrast session/event corruption
in `SqliteWorldStore`, which remains a fault → throw.

### Authority model — room memory is supporting context only, never truth

These invariants are binding and are the reason for the structural separation:

| Invariant | Mechanism |
| --- | --- |
| **Room memory is not room truth** | Inert rows; the service has no append path. `roomStates.visited`/`.flags` stay the only per-room truth. |
| **Generated room text is not truth** | Generated name/story may be stored only as `room_note`/`room_summary`; it never becomes `RoomSpec`, `WorldState`, an event, or a generation input in v0. |
| **Player claims about rooms are claims** | `kind:'player_claim'` row; never an event; never reconciled against `roomStates`. The service has no append path. |
| **Summaries cannot update room/world state** | `kind:'room_summary'`; same structural no-write-path (v0 builds no summarizer). |
| **LLM / `source:'llm'` memories cannot apply state changes** | A `source:'llm'` memory is still just a scoped memory; any world change must still go through `WorldSession.appendEvent`, which the memory layer cannot reach. |
| **Reducers / event log remain the only truth mutation path** | `applyEvent` is unchanged; room memory never touches it. |
| **No cross-world/session/room leak** | Reads filtered by the exact triple at SQL **and** re-asserted by `filterRoomMemoriesForScope` and the adapter's JSON-scope re-assertion; the FK ties memory to a real session; dedicated leak tests. |

"Firewall" here means a **validation + scoping + structural-separation discipline**,
not a security/auth boundary.

### Review nuance: "not truth" tests

The room-memory-not-truth tests use **structural proof plus the existing
`src/memory/**` lint wall** instead of importing a live `WorldSession`, because memory
code is intentionally forbidden from importing `world-session`. The tests build a
`WorldSession` + `InMemoryWorldStore` to hold the authoritative record, then record
memories through `RoomMemoryService`, and assert that the event-log length, snapshot,
and `roomStates` are unchanged — without the memory module ever depending on the
session import path.

### Boundaries / lint (no `eslint.config.js` change in v0)

- `domain/memory/roomContracts.ts`, `domain/memory/roomFirewall.ts`, and
  `domain/ports/RoomMemoryStore.ts` are covered by the existing `src/domain/**` block
  (zod only; no React/Three/renderer/UI/platform/persistence/server).
- `src/memory/RoomMemoryService.ts` and `InMemoryRoomMemoryStore.ts` are covered by
  the existing strict `src/memory/**` block (forbids React/Three/renderer/persistence/
  server **and** `world-session`/`interactions`/`encounters`/`dialogue`).
- The engine block already forbids `**/memory/**`, so the renderer can never import
  the room-memory layer.
- The persistence-self wall already allows `domain/memory` (via the
  `!**/domain/memory/**` negation) while forbidding the `src/memory` app layer, so
  `SqliteRoomMemoryStore` may import `domain/memory/roomContracts.ts` but not the
  service.
- **No `eslint.config.js` change was needed** — implementation confirmed the existing
  blocks cover all new files.

### Log safety

The firewall and the in-memory store are **silent**; the service and the SQLite store
are the only loggers and log **no content**. **May log:** `memoryId`, `worldId`,
`sessionId`, `roomId`, `kind`, `source`, `confidence`, `seq`, `count`, result
`code`/`reason`. **Never log:** memory `text`, room/NPC display names, player lines,
provider prompts/responses, generated JSON, API keys, or PII (mirrors ADR-0013 rule 10,
ADR-0024 log-safety).

## Consequences

- Room memory is durable and recallable per the exact `(worldId, sessionId, roomId)`
  triple, while the event log + reducers remain the sole authority — the trust model
  is unchanged and provably so (the layer cannot reference `WorldSession`).
  `WorldState.roomStates` remains the authoritative per-room state.
- Memory cannot leak across world/session/room: it is enforced in SQL, re-asserted in
  the adapter, re-filtered in the firewall, and covered by leak tests.
- A corrupt stored memory degrades to a skipped row and never blocks recall or play;
  memory's absence never blocks gameplay.
- The browser is byte-identical to before: no API, no generation/adjacent wiring, no
  dialogue/LLM wiring, no renderer/RoomSpec/Three.js change. The SQLite store is
  exercised by tests over a temp/`:memory:` DB.
- Immutability is provable (no update path + DB trigger), while a future
  forgetting/eviction slice has a clean opening (DELETE left open).
- No `eslint.config.js` change was required — existing blocks covered all new files.

## Non-goals / follow-ups (explicit, out of v0 scope)

- **API endpoints** for room memory, a browser→Node client/CORS, or any HTTP surface.
- **Dialogue integration** / wiring room memory into the renderer, `RoomViewer`,
  engine, `dialogue/`, `NPCDialoguePanel`, or `App.tsx`.
- **Room-generation injection** (`assembleRoom`, the generator, `WorldBibleSeed`,
  `GeneratedRoomSource`) — room memory does not feed generation in v0.
- **Adjacent-room pregeneration wiring** (`AdjacentRoomPregenerator`, `SessionRoomCache`,
  `RoomRegistry`, `NavigationService`).
- **LLM memory writer** and **memory injection into prompts**.
- An **automatic summarizer** (`room_summary` is a storable kind only).
- **Vector DB / embeddings / semantic search / relevance scoring.**
- **Cross-session / cross-world / global** room memory.
- **Forgetting / eviction / decay**, a `delete` path, or any memory mutation.
- A **memory UI**.

## Alternatives considered

- **A (domain-only)** — rejected: under-delivers the *persistence* feature.
- **C (API + generation/adjacent wiring)** — rejected: too large; forces
  browser↔backend wiring and violates the v0 hard constraints.
- **D (full retrieval/summaries/LLM injection)** — rejected: against the hard
  constraints (no LLM injection, no vector search, supporting-context-only).
