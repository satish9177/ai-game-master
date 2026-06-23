# ADR-0024: NPC Memory Persistence v0 — scoped memory store + the memory firewall

- **Status:** Accepted — **implemented** (NPC Memory Persistence v0; bundles
  memory-firewall-v0)
- **Date:** 2026-06-23
- **Deciders:** Project owner

## Context

Every gameplay slice so far keeps a single authority: the per-session append-only
`WorldEvent[]`, with `WorldState` as its reconstructable projection
([ADR-0013](./ADR-0013-world-state-event-log-v0.md)), persisted by `SqliteWorldStore`
([ADR-0018](./ADR-0018-backend-sqlite-persistence-v0.md)). NPC dialogue
([ADR-0017](./ADR-0017-npc-dialogue-foundation-v0.md)) is read-only and promised
that memory would later "layer as **recall** over the existing log and the
read-only context, never as a second write path."

This slice adds the **first NPC memory layer**: a durable, **headless,
Node/SQLite-only** store of scoped NPC memory records (player claims, NPC beliefs,
NPC observations, dialogue summaries) behind a new domain `NpcMemoryStore` port,
plus the pure **memory firewall** that governs how memories are written and read.

The defining property: **memory is supporting context only and can never become
world truth.** The `WorldSession` event log + reducers stay the sole authority. The
memory layer is constructed with **no reference to `WorldSession`/`WorldStore`/
`WorldCommand`/`WorldEvent`**, so it has no code path to mutate state.

It mirrors the trusted cadence of `world-state-event-log-v0` (in-memory) →
`backend-sqlite-persistence-v0` (SQLite, headless, browser stays in-memory and
unwired). v0 adds **no API, no frontend/dialogue wiring, and no LLM prompt
injection**. Full design and the rejected options are in the implementation plan
[`npc-memory-persistence-v0`](../implementation-plans/npc-memory-persistence-v0.md).

## Decision

Ship **Option B (trimmed)**: a pure domain firewall + contracts, an `NpcMemoryStore`
port, a headless `NpcMemoryService`, an `InMemoryNpcMemoryStore`, and a
`SqliteNpcMemoryStore` + migration `0002_npc_memories` — **no API, no
frontend/dialogue wiring, no LLM prompt injection**. The browser stays in-memory
and unwired.

```
NpcMemoryService.remember(input)         src/memory/
  → validateMemoryDraft(input)           src/domain/memory/firewall.ts  (write firewall)
       reject? → { status:'rejected', reason }
       else stamp memoryId (IdGenerator) + createdAt (Clock)
  → store.record(insert)                 NpcMemoryStore port
       InMemoryNpcMemoryStore | SqliteNpcMemoryStore (assigns seq)
  → { status:'recorded', record } | { status:'failed', reason }

NpcMemoryService.recall(scope, options?)
  → store.listForNpc(scope, { limit })   scoped SQL: world_id+session_id+npc_id, seq desc
  → filterMemoriesForScope(raw, scope)   read firewall (defense in depth)
  → selectRecallMemories(scoped, …)      seq desc, then memoryId; limit + maxChars cap
  → { status:'recalled', memories }
```

### Memory contracts (pure domain — `src/domain/memory/contracts.ts`)

Strict, versioned (`NPC_MEMORY_SCHEMA_VERSION = 1`), every string bounded. Imports
only `zod`; exports **no** `WorldCommand`/`WorldEvent`-producing function — there is
no memory→truth mapping (the structural firewall).

- **Scope is strict `(worldId, sessionId, npcId)`.** Every read and write is
  filtered against the exact triple. **No cross-session and no cross-world memory in
  v0** — recall requires the full triple.
- **Memory kinds** (`kind`): `player_claim` · `npc_belief` · `npc_observation` ·
  `dialogue_summary`. The kind carries the epistemic class.
- **Source enum** (`provenance.source`): `player` · `npc` · `game` · `llm`. There is
  **no `system` source** — hidden system/developer/internal text must never be
  stored as memory. `game` means a memory originated by deterministic game
  rules/engine activity, **not** any hidden prompt/developer text.
- **`confidence`** (`low`/`medium`/`high`) is **informational only** in v0: it does
  not update truth and does **not** drive recall ranking.
- **`text`** is opaque, inert recall content, **bounded to `MAX_MEMORY_CHARS = 280`**;
  never parsed, never `eval`'d, never logged.
- `memoryId`/`createdAt` are stamped by the service; `seq` is a gapless monotonic
  integer per `(sessionId, npcId)` assigned by the store and is the ordering key.

### Memory firewall (pure domain — `src/domain/memory/firewall.ts`)

Pure, total, deterministic: no I/O, no `Date.now`/`Math.random`, no input mutation.

- `validateMemoryDraft` — the **write firewall**: validates scope non-empty
  (`invalid-scope`), `kind`/`source`/`confidence` in their closed enums, `text`
  non-empty after trim (`empty-text`) and ≤ 280 (`text-too-long`), optional
  `roomId`/`turnIndex` well-formed (`invalid-provenance`); trims `text` and defaults
  `confidence` to `'medium'`. Returns a draft without `memoryId`/`seq`/`createdAt`.
- `filterMemoriesForScope` — the **read firewall** (defense in depth behind the
  scoped SQL query): drops any record whose `(worldId, sessionId, npcId)` does not
  match exactly.
- `selectRecallMemories` — the **only ordering authority**: sorts **`seq` desc, then
  `memoryId`** ascending as a stable tie-break, takes up to `limit`, and caps
  cumulative `text.length` at `maxChars`. Never `confidence`, never recency-by-clock,
  never relevance scoring. **Recall defaults: `limit = 8`, `maxChars = 600`.**

### `NpcMemoryStore` port (`src/domain/ports/NpcMemoryStore.ts`)

Mirrors `WorldStore`/`RoomStore`: expected failures are typed results, not thrown.
`record(insert)` is insert-only and assigns the next `seq` for `(sessionId, npcId)`;
`listForNpc(scope, { limit })` is a scoped, seq-desc read. Error codes:
`session-not-found` · `conflict`. There is **no update or delete** on the port.

### Headless application (`src/memory/`)

- `NpcMemoryService` — constructor-injected `NpcMemoryStore`, `Clock`,
  `IdGenerator`, `Logger`. It takes **no `WorldSession`/`WorldStore` parameter** and
  has no append path: that is the structural firewall — a recorded memory can never
  become world truth. It is the only logger in this layer.
- `InMemoryNpcMemoryStore` — a pure in-memory adapter (mirrors `InMemoryWorldStore`):
  assigns `seq = max(seq for (sessionId,npcId)) + 1`, stores immutable copies, and
  returns freshly-copied, scope-filtered, seq-desc, limited records (no aliasing). It
  does **not** enforce the FK; `session-not-found` is exercised against SQLite.

### Storage (`src/persistence/`, Node-only)

Migration `0002_npc_memories` follows the `world_events`/`rooms` precedent — indexed
scope columns alongside a JSON blob:

- `npc_memories` with `memory_id PRIMARY KEY`, scope columns, `kind`, `seq`,
  `schema_version`, `memory_json`, `created_at`, and **`UNIQUE(session_id, npc_id,
  seq)`**.
- **An FK `session_id REFERENCES world_sessions(session_id)`** (with
  `foreign_keys=ON`) makes "write a memory for a non-existent session" fail at the
  DB; the adapter pre-checks and maps it to `session-not-found`.
- A **scope index** `(world_id, session_id, npc_id, seq)` serves both the
  exact-triple filter and seq-desc recall.
- A **`BEFORE UPDATE` no-update trigger** makes immutability provable at the DB.
  **`DELETE` is intentionally left open** for a future forgetting/eviction slice (v0
  never deletes); no no-delete trigger is added.

`SqliteNpcMemoryStore` implements the port (mirrors `SqliteWorldStore`): `record`
runs inside `withTransaction`, pre-checks the session (`NotFoundSignal` →
`session-not-found`), computes the next `seq`, inserts the row + `memory_json`, and
maps a `UNIQUE` violation from a true concurrent writer (`ConflictSignal` →
`conflict`). `listForNpc` runs the scoped seq-desc query and **re-validates each row
through `NpcMemoryRecordSchema` at the read boundary**, then **re-asserts the parsed
JSON scope against the queried SQL scope**. A corrupt or scope-divergent stored row
is an **expected content failure → that row is skipped** (logged
`invalid-stored-memory`, memoryId/code only), never thrown, never blocking — contrast
session/event corruption in `SqliteWorldStore`, which remains a fault → throw.

### Authority model — memory is supporting context only, never truth

These invariants are binding and are the reason for the structural separation:

| Invariant | Mechanism |
| --- | --- |
| **Player claims are claims, not world facts** | `kind:'player_claim'` row; the service has no append path. |
| **NPC beliefs/observations can be wrong** | `npc_belief`/`npc_observation` coexist with authoritative state; recall never reconciles against truth. |
| **Dialogue summaries cannot update truth** | `kind:'dialogue_summary'`; same structural no-write-path (v0 builds no summarizer). |
| **LLM / `source:'llm'` memories cannot apply state changes** | An `llm`-sourced memory is still just a scoped memory; any world change must still go through `WorldSession.appendEvent`, which the memory layer cannot reach. |
| **Reducers / event log remain the only truth mutation path** | `applyEvent` is unchanged; memory never touches it. |
| **No cross-world/session/NPC leak** | Reads filtered by the exact triple at SQL **and** re-asserted by `filterMemoriesForScope` and the adapter's JSON-scope re-assertion; the FK ties memory to a real session; dedicated leak tests. |

"Firewall" here means a **validation + scoping + structural-separation discipline**,
not a security/auth boundary.

### Boundaries / lint

A new headless `src/memory/**` layer (a folder, consistent with `dialogue/`) gets
its own ESLint block, mirroring `src/dialogue/**` but **stricter — it also forbids
importing `**/world-session/**`** (and `interactions`/`encounters`/`dialogue`), the
lint-level enforcement of "memory has no path to truth". It may import pure domain
contracts/ports (incl. `domain/memory`) and the `Logger` interface, but never React,
Three.js, the renderer, persistence, the server, or any write-path layer. In
addition: the engine block forbids `**/memory/**`; the persistence-self wall forbids
the headless `src/memory` app layer while still allowing `domain/memory` (a negated
pattern); and `src/memory/**` is added to the broad browser catch-all `ignores` so
the richer block is not clobbered (flat-config last-match-wins).
`domain/memory/**` and `domain/ports/NpcMemoryStore.ts` are covered by the existing
`src/domain/**` block (no domain lint change). No engine objects ever enter memory
contracts, the store, or results ([ADR-0008](./ADR-0008-renderer-portability-strategy.md)).

### Log safety

The firewall and the in-memory store are **silent**; the service and the SQLite
store are the only loggers and log **no content**. **May log:** `memoryId`,
`worldId`, `sessionId`, `npcId`, `kind`, `source`, `confidence`, `seq`, `count`,
result `code`/`reason`. **Never log:** memory `text`, player lines, NPC/room display
names, provider prompts/responses, generated JSON, API keys, or PII (mirrors ADR-0013
rule 10, ADR-0017 rule 7).

## Consequences

- NPC memory is durable and recallable per the exact `(worldId, sessionId, npcId)`
  triple, while the event log + reducers remain the sole authority — the trust model
  is unchanged and provably so (the layer cannot reference `WorldSession`).
- Memory cannot leak across world/session/NPC: it is enforced in SQL, re-asserted in
  the adapter, re-filtered in the firewall, and covered by leak tests.
- A corrupt stored memory degrades to a skipped row and never blocks recall or play;
  memory's absence never blocks gameplay.
- The browser is byte-identical to before: no API, no dialogue/LLM wiring, no
  renderer/RoomSpec/Three.js change. The SQLite store is exercised by tests over a
  temp/`:memory:` DB.
- Immutability is provable (no update path + DB trigger), while a future
  forgetting/eviction slice has a clean opening (DELETE left open).

## Non-goals / follow-ups (explicit, out of v0 scope)

- **API endpoints** for memory, a browser→Node client/CORS, or any HTTP surface.
- **Dialogue integration** / wiring memory into the renderer, `RoomViewer`, engine,
  `dialogue/`, `NPCDialoguePanel`, or `App.tsx`.
- **LLM memory writer** and **memory injection into NPC prompts** / `buildDialogueContext`.
- An **automatic summarizer** (`dialogue_summary` is a storable kind only).
- **Vector DB / embeddings / semantic search / relevance scoring.**
- **Cross-session / cross-world / global** memory, or living-world room memory.
- **Forgetting / eviction / decay**, a `delete` path, or any memory mutation.
- A **memory UI**.

## Alternatives considered

- **A (domain-only)** — rejected: under-delivers the *persistence* feature.
- **C (API + dialogue wiring)** — rejected: too large; forces browser↔backend wiring
  that AGENTS defers.
- **D (full retrieval/summaries/LLM injection)** — rejected: against the hard
  constraints (no LLM injection, no vector search, supporting-context-only).
