# Implementation Plan — `feature/npc-memory-persistence-v0`

> Status: **approved design — not yet implemented.** Commits are made manually by
> the maintainer; agents do not commit. **ADR-0024 is deliberately deferred** to
> docs closeout, written only after the implementation is reviewed.
>
> Companion docs: [ARCHITECTURE](../ARCHITECTURE.md) · [BOUNDARIES](../BOUNDARIES.md) ·
> [FAILURE-MODES](../FAILURE-MODES.md) · [CONVENTIONS](../CONVENTIONS.md). Roadmap
> context: `world-state-event-log-v0` ([ADR-0013](../decisions/ADR-0013-world-state-event-log-v0.md)),
> `npc-dialogue-foundation-v0` ([ADR-0017](../decisions/ADR-0017-npc-dialogue-foundation-v0.md)),
> `backend-sqlite-persistence-v0` ([ADR-0018](../decisions/ADR-0018-backend-sqlite-persistence-v0.md)),
> `backend-world-session-api-v0` ([ADR-0019](../decisions/ADR-0019-backend-world-session-api-v0.md)).
> Bundles the **`memory-firewall-v0`** invariants.

## Goal

Add the **first NPC memory layer** as a durable, **headless, Node/SQLite-only**
store of *scoped NPC memory records* — player claims, NPC beliefs, NPC
observations, and dialogue summaries — behind a new domain `NpcMemoryStore` port,
plus the pure **memory firewall** that governs how memories are written and read.

The defining property: **memory is supporting context only and can never become
world truth.** The `WorldSession` event log + reducers stay the sole authority;
the memory layer is constructed with **no reference to `WorldSession`/`WorldStore`/
`WorldCommand`/`WorldEvent`**, so it has no code path to mutate state.

This is the persistence/firewall seam **only**, proven end-to-end with deterministic
tests and an in-memory adapter, exactly as `world-state-event-log-v0` (in-memory) →
`backend-sqlite-persistence-v0` (SQLite) landed. v0 adds **no API, no
frontend/dialogue wiring, and no LLM prompt injection**; the browser stays
in-memory and unwired.

---

## 1. Current relevant flow

**NPC dialogue flow** (`renderer/RoomViewer.tsx` → `dialogue/`). The engine emits a
neutral `Interactable` id only. Composition maps the id to an `NPCDialogueSpec`
(`app/dialogue.ts:buildDialogueLookup`), applies precedence
**exit → encounter → dialogue → effect**, and calls `NPCDialogueService.reply(...)`.
The service is **read-only**: it injects only `Pick<WorldSession,'getWorldState'>`,
builds a pure `buildDialogueContext(state, npc, history)`, and delegates to the
`NPCDialogueProvider` port (deterministic `FakeNPCDialogueProvider`, no I/O). It
**appends no event, sets no flag, changes no state.** Conversation `history` lives
only in component state. **v0 does not touch this flow.**

**WorldSession / event-log flow** (`world-session/`, `domain/world/`).
`CanonSeed` → `session-started` (seq 1) → append-only `WorldEvent[]` = authoritative
truth. `WorldState = projectWorldState(log)` is a projection cache. The only write
path is `WorldSession.appendEvent(...)` → validate against current state →
`applyEvent` → `store.commit({event, snapshot})` under a `revision` CAS. There are
**no direct state setters**. Closed 7-event union. Logs carry ids/seq/revision/codes.

**Backend persistence flow** (`persistence/`, Node-only). `db.ts` opens
`node:sqlite`, sets PRAGMAs (`foreign_keys=ON`, busy timeout, WAL), exposes
`withTransaction` (`BEGIN IMMEDIATE`) and a forward-only `runMigrations`.
`migrations/index.ts` → `0001_init.ts` creates `world_sessions`, `world_events`
(+ append-only `BEFORE UPDATE`/`BEFORE DELETE` triggers), `rooms`. `SqliteWorldStore`
implements `WorldStore`; `SqliteRoomStore` implements `RoomStore`. `node:sqlite` is
synchronous, wrapped in `async` methods. Read-boundary re-validation distinguishes a
**session/event fault → throw** from an **expected stored-content failure → typed
result** (`SqliteRoomStore`'s `invalid-stored-room`).

Facts this plan relies on:

- `world_sessions(session_id TEXT PRIMARY KEY, …)` already exists, so a new
  `npc_memories.session_id … REFERENCES world_sessions(session_id)` FK is valid.
- The seq/immutability/signal pattern (`AlreadyExistsSignal`/`ConflictSignal`/
  `NotFoundSignal` rolled back in `withTransaction`, mapped to typed results) is
  established in `SqliteWorldStore` and is reused here.
- Time and ids enter only through the injected `Clock` / `IdGenerator` ports
  (`domain/ports/`), so the service is deterministic under fakes.
- The browser composition root (`App.tsx`) uses `InMemoryWorldStore` and **does not
  import `persistence/**` or `server/**`** (reciprocal ESLint walls + tsconfig
  exclude + Vite reachability). v0 keeps it that way.

## 2. Current authority model

- **Truth:** the per-session append-only `WorldEvent[]`, with `WorldState` only as
  its reconstructable projection; in the backend, `SqliteWorldStore`/`SqliteRoomStore`.
  The single write path is "append a validated, typed event, then project."
- **Supporting context only (never truth):** `WorldBibleSeed` (initial canon),
  `NPCDialogueSpec` + provider replies, conversation history, generator prompts/seeds,
  any LLM/provider output. **NPC memory joins this set** — recall/claim context that
  can never override the hard facts.

## 3. Meaning of `npc-memory-persistence-v0`

A durable, headless, Node/SQLite-only store of typed NPC memory records, scoped by
the exact `(worldId, sessionId, npcId)` triple, with:

- a **pure domain firewall** (write validation, scope re-filtering, deterministic
  bounded recall selection),
- an `NpcMemoryStore` **port** (domain),
- a headless `NpcMemoryService` (`remember` / `recall`) that **does not depend on
  `WorldSession`**,
- an `InMemoryNpcMemoryStore` (for tests / a future browser path), and
- a `SqliteNpcMemoryStore` + migration `0002_npc_memories`.

Memory records are **opaque inert text + closed-enum metadata** (numbers/strings/
enums), produced and read deterministically. They feed **no** state change, **no**
event, **no** reducer. Their absence never blocks play.

## 4. Meaning of `memory-firewall-v0`

A small pure domain module **plus a structural separation** that guarantees the
seven invariants. The single most important mechanism: **the memory layer holds no
reference to `WorldSession`/`WorldStore`/`WorldCommand`/`WorldEvent`, and
`domain/memory` exports no function that produces those types** — lint-enforced by a
`src/memory/**` block that forbids importing `**/world-session/**` (see §13).

| Invariant | Mechanism |
| --- | --- |
| 1. Player claims are claims, not truth | `kind:'player_claim'` row; never an event. Service has no append path. |
| 2. NPC beliefs can be wrong | `kind:'npc_belief'` coexists with authoritative state; recall never reconciles against truth. |
| 3. Summaries cannot update truth | `kind:'dialogue_summary'`; same structural no-write-path. |
| 4. LLM proposes state changes only | `provenance.source:'llm'` memories are still just scoped memories; any *world* change must still go through `WorldSession.appendEvent` (unchanged), which the memory layer cannot reach. |
| 5. Reducers apply allowed changes | `applyEvent` unchanged; memory never touches it. |
| 6. Every memory has scope + provenance | Required `worldId`/`sessionId`/`npcId` + `provenance{source,…}`, enforced by schema + `validateMemoryDraft`. |
| 7. No cross-world/session/NPC leak | Reads filtered by the exact triple at SQL **and** re-asserted by pure `filterMemoriesForScope`; FK ties memory to a real session; dedicated leak tests. |

"Firewall" here means a **validation + scoping + structural-separation discipline**,
not a security/auth boundary.

## 5. Final decisions (locked)

1. **Scope = Option B trimmed:** pure firewall/types, `NpcMemoryStore` port,
   headless `NpcMemoryService`, `InMemoryNpcMemoryStore`, `SqliteNpcMemoryStore` +
   migration. **No API. No frontend/dialogue wiring. No LLM prompt injection.**
2. **Memory scope is strict `(worldId, sessionId, npcId)`.** No cross-session and no
   cross-world continuity in v0. Recall requires the full triple.
3. **Memory kinds:** `player_claim` · `npc_belief` · `npc_observation` ·
   `dialogue_summary`.
4. **Memory source enum:** `player` · `npc` · `game` · `llm`. **No `system`
   source** — hidden system/developer/internal text must never be stored as memory.
   `game` means a memory originated by **deterministic game rules/engine activity**
   (e.g. an observation the game records), **not** any hidden prompt/developer text.
5. **Keep `confidence`** (`low`/`medium`/`high`), **informational only** in v0: it
   does **not** update truth and **does not** drive recall ranking. Recall ordering
   is deterministic: **`seq` desc, then `memoryId` tie-break.**
6. **Persistence: SQLite backend only, headless only.** The browser remains
   in-memory and unwired.
7. **Immutability:** add a **no-update** trigger on `npc_memories`; **leave delete
   open** for a future forgetting/eviction slice (v0 never deletes).
8. **Bounds:** `MAX_MEMORY_CHARS = 280`; default recall `limit = 8`; recall
   `maxChars = 600`.
9. **Core invariants** (§4) are binding: player claims are claims; NPC beliefs can be
   wrong; summaries cannot update truth; LLM proposes only; reducers apply allowed
   changes; every memory has scope/provenance; no cross-world/session/NPC leak;
   `WorldSession`/event log/reducers remain authoritative; memory is supporting
   context only.

## 6. Non-goals

This slice must **not**:

- Add **API endpoints**, browser→Node client/CORS, or any HTTP surface for memory.
- Wire memory into the **renderer / `RoomViewer` / engine / `dialogue/` /
  `NPCDialoguePanel` / `App.tsx`**, or inject memory into any **LLM/provider prompt**
  or `buildDialogueContext`.
- Wire memory to the **browser** in any form (browser stays `InMemoryWorldStore` and
  imports no persistence).
- Add a **vector DB, embeddings, semantic search, or relevance scoring**.
- Add a **global/cross-world player profile**, **cross-session** memory, or
  **living-world room memory**.
- Add an **automatic summarizer** (`dialogue_summary` is a kind you may store; v0
  builds no summarizer) or a **multi-NPC social graph**.
- Add **memory eviction/forgetting/decay**, a `delete` path, or any memory mutation.
- Give the memory layer any **`WorldSession`/`WorldStore`/`WorldCommand`/
  `WorldEvent`** dependency, or any path that mutates `WorldState` or the event log.
- Change **`world-session` authority**, the closed 7-event union, `applyEvent`,
  `CanonSeed`, or save/load.
- Store **raw provider prompts/responses, request/response bodies, API keys, hidden
  system/developer text, or PII** as memory.
- **Log** memory `text`, NPC/room display names, `playerLine`, provider bodies, keys,
  or any narrative/user content.

## 7. Chosen option and placement

**Option B (trimmed): domain firewall + types + port, headless service + in-memory
adapter, SQLite adapter + migration — no API, no frontend.** (Rejected: **A**
domain-only under-delivers the *persistence* feature; **C** adds API + dialogue
wiring — too large and forces browser↔backend wiring AGENTS defers; **D** full
retrieval/summaries/LLM injection — against the hard constraints.) It mirrors the
trusted cadence: `world-state-event-log-v0` proved the seam in-memory, then
`backend-sqlite-persistence-v0` added SQLite headless while the browser stayed
in-memory and unwired. ADR-0017 already promised memory would "layer as **recall**
over the existing log and the read-only context, never as a second write path."

| Piece | Location |
| --- | --- |
| `NpcMemoryRecordSchema` + enums + `MemoryScope` + bounds | `apps/web/src/domain/memory/contracts.ts` |
| `validateMemoryDraft` / `filterMemoriesForScope` / `selectRecallMemories` | `apps/web/src/domain/memory/firewall.ts` |
| `NpcMemoryStore` port | `apps/web/src/domain/ports/NpcMemoryStore.ts` |
| `NpcMemoryService` (`remember`/`recall`; **no `WorldSession`**) | `apps/web/src/memory/NpcMemoryService.ts` |
| `InMemoryNpcMemoryStore` | `apps/web/src/memory/InMemoryNpcMemoryStore.ts` |
| `SqliteNpcMemoryStore` | `apps/web/src/persistence/SqliteNpcMemoryStore.ts` |
| Migration `0002_npc_memories` | `apps/web/src/persistence/migrations/0002_npc_memories.ts` (+ register in `index.ts`) |

A new headless `src/memory/**` application layer (a **folder**, not a package —
consistent with `dialogue/`/`encounters/`) gets its own ESLint block (§13). New
files under `src/domain/**` and `src/persistence/**` reuse the existing boundary
blocks (with two small additions, §13).

## 8. Memory model

`apps/web/src/domain/memory/contracts.ts` (zod 4; strict objects; every string
bounded). Ids are app-generated UUID strings (`IdGenerator`); `createdAt` is UTC
ISO-8601 (`Clock`); `seq` is a gapless monotonic integer per `(sessionId, npcId)`
assigned by the store.

```ts
export const NPC_MEMORY_SCHEMA_VERSION = 1 as const
export const MAX_MEMORY_CHARS = 280

export const MemoryKindSchema = z.enum([
  'player_claim', 'npc_belief', 'npc_observation', 'dialogue_summary',
])
export const MemorySourceSchema = z.enum(['player', 'npc', 'game', 'llm'])  // no 'system'
export const MemoryConfidenceSchema = z.enum(['low', 'medium', 'high'])

export const MemoryScopeSchema = z.object({
  worldId: z.string().min(1),
  sessionId: z.string().min(1),
  npcId: z.string().min(1),
}).strict()

export const MemoryProvenanceSchema = z.object({
  source: MemorySourceSchema,
  roomId: z.string().min(1).optional(),     // where it was formed
  turnIndex: z.number().int().min(0).optional(),  // dialogue turn that produced it
}).strict()

export const NpcMemoryRecordSchema = z.object({
  schemaVersion: z.literal(NPC_MEMORY_SCHEMA_VERSION),
  memoryId: z.string().min(1),
  worldId: z.string().min(1),               // SCOPE
  sessionId: z.string().min(1),             // SCOPE
  npcId: z.string().min(1),                 // SCOPE
  kind: MemoryKindSchema,
  text: z.string().min(1).max(MAX_MEMORY_CHARS),  // inert recall content — NEVER logged, never code
  provenance: MemoryProvenanceSchema,
  confidence: MemoryConfidenceSchema,       // informational only
  seq: z.number().int().min(1),             // per (sessionId, npcId); ordering key
  createdAt: z.string().min(1),             // UTC ISO-8601 via Clock
}).strict()

export type NpcMemoryRecord = z.infer<typeof NpcMemoryRecordSchema>
export type MemoryScope = z.infer<typeof MemoryScopeSchema>
export type NpcMemoryInsert = Omit<NpcMemoryRecord, 'seq'>  // service stamps id/createdAt; store assigns seq
```

- `text` is opaque, inert, ≤ 280 chars; never parsed or `eval`'d, never logged.
- `kind` carries the epistemic class; `confidence` is metadata only.
- `provenance.source ∈ {player, npc, game, llm}` records where the assertion came
  from. There is no `system` source.

## 9. Memory firewall (`domain/memory/firewall.ts`)

Pure, total, deterministic; no I/O, no `Date.now`/`Math.random`, no input mutation.

```ts
export const DEFAULT_RECALL_LIMIT = 8
export const DEFAULT_RECALL_MAX_CHARS = 600

export type MemoryDraftInput = {
  worldId: string; sessionId: string; npcId: string
  kind: MemoryKind; source: MemorySource; text: string
  confidence?: MemoryConfidence            // default 'medium'
  roomId?: string; turnIndex?: number
}
export type MemoryDraft = {
  scope: MemoryScope; kind: MemoryKind; text: string
  provenance: MemoryProvenance; confidence: MemoryConfidence
}
export type MemoryRejectReason =
  | 'invalid-scope' | 'invalid-kind' | 'invalid-source'
  | 'empty-text' | 'text-too-long' | 'invalid-confidence' | 'invalid-provenance'

export type ValidateMemoryDraftResult =
  | { ok: true; draft: MemoryDraft }
  | { ok: false; reason: MemoryRejectReason }

// Write firewall: validate + normalize (trim text, default confidence). Returns a
// draft WITHOUT memoryId/seq/createdAt — the service/store stamp those.
export function validateMemoryDraft(input: MemoryDraftInput): ValidateMemoryDraftResult

// Read firewall (defense in depth behind the scoped SQL query): drop any record
// whose (worldId, sessionId, npcId) does not match exactly.
export function filterMemoriesForScope(
  records: readonly NpcMemoryRecord[], scope: MemoryScope,
): NpcMemoryRecord[]

// Bounded deterministic selection: sort by seq desc, then memoryId tie-break; take
// up to `limit`; cap cumulative text length at `maxChars`. No scoring, no clock.
export function selectRecallMemories(
  records: readonly NpcMemoryRecord[], options: { limit: number; maxChars: number },
): NpcMemoryRecord[]
```

- `validateMemoryDraft` checks scope non-empty (`invalid-scope`); `kind`/`source`/
  `confidence` in their closed enums (`invalid-kind`/`invalid-source`/
  `invalid-confidence`); `text` non-empty after trim (`empty-text`) and ≤
  `MAX_MEMORY_CHARS` (`text-too-long`); optional `roomId`/`turnIndex` well-formed
  (`invalid-provenance`). It stamps nothing authoritative.
- `selectRecallMemories` is the only ordering authority and uses **`seq` desc, then
  `memoryId`** — never `confidence`, never recency-by-clock, never relevance.

**Structural truth/proposal separation:** `domain/memory` imports only `zod` and
`domain/world/worldState` types are **not** needed; it exports **no**
`WorldCommand`/`WorldEvent`-producing function. There is no memory→truth mapping.

## 10. `NpcMemoryStore` port (`domain/ports/NpcMemoryStore.ts`)

Mirrors `WorldStore`/`RoomStore`: expected failures are typed results, not thrown.

```ts
export type NpcMemoryStoreErrorCode = 'session-not-found' | 'conflict'

export type NpcMemoryWriteResult =
  | { ok: true; record: NpcMemoryRecord }                 // includes the assigned seq
  | { ok: false; error: { code: NpcMemoryStoreErrorCode } }

export interface NpcMemoryStore {
  /** Persist one memory (insert-only). Assigns the next seq for (sessionId, npcId). */
  record(input: NpcMemoryInsert): Promise<NpcMemoryWriteResult>
  /** Scoped read: exact (worldId, sessionId, npcId), seq desc, bounded by limit. */
  listForNpc(scope: MemoryScope, options?: { limit?: number }): Promise<NpcMemoryRecord[]>
}
```

## 11. Headless application (`src/memory/`)

`NpcMemoryService` — constructor-injected `NpcMemoryStore`, `Clock`, `IdGenerator`,
`Logger`. **No `WorldSession`/`WorldStore` parameter** (the structural firewall).

```ts
export type RememberResult =
  | { status: 'recorded'; record: NpcMemoryRecord }
  | { status: 'rejected'; reason: MemoryRejectReason }      // firewall
  | { status: 'failed'; reason: NpcMemoryStoreErrorCode }   // store
export type RecallResult = { status: 'recalled'; memories: NpcMemoryRecord[] }
```

- `remember(input: MemoryDraftInput)`: `validateMemoryDraft` → on reject, log code +
  return `rejected`; else stamp `memoryId = idGen.newId()`, `createdAt = clock.now()`,
  call `store.record(insert)`; map store failure → `failed`; else log + return
  `recorded`.
- `recall(scope, options?)`: `limit = options?.limit ?? DEFAULT_RECALL_LIMIT`;
  `raw = store.listForNpc(scope, { limit })`; `scoped = filterMemoriesForScope(raw,
  scope)`; `selected = selectRecallMemories(scoped, { limit, maxChars: options?.maxChars
  ?? DEFAULT_RECALL_MAX_CHARS })`; log count; return `recalled`. An unknown scope
  yields `[]` (not a failure).

`InMemoryNpcMemoryStore` — pure in-memory adapter mirroring `InMemoryWorldStore`:
assigns `seq = max(seq for (sessionId,npcId)) + 1`, stores immutable copies, and
`listForNpc` returns freshly-copied, scope-filtered, seq-desc, limited records (no
aliasing). Enables full service testing without SQLite. (It does not enforce the FK;
`session-not-found` is exercised against the SQLite adapter.)

**Logging:** `memoryId`, `worldId`, `sessionId`, `npcId`, `kind`, `source`,
`confidence`, `seq`, `count`, result `code`/`reason` only — **never** `text`, names,
or `playerLine`. The firewall is silent; the service is the only logger.

## 12. Storage design (`persistence/`)

**Migration `migrations/0002_npc_memories.ts`** (append to the `migrations` array in
`migrations/index.ts` as `{ version: 2, name: 'npc_memories', up }`). Follows the
`world_events`/`rooms` precedent: a JSON blob + indexed scope columns.

```sql
CREATE TABLE npc_memories (
  memory_id      TEXT PRIMARY KEY,
  world_id       TEXT NOT NULL,
  session_id     TEXT NOT NULL REFERENCES world_sessions(session_id),
  npc_id         TEXT NOT NULL,
  kind           TEXT NOT NULL,
  seq            INTEGER NOT NULL,
  schema_version INTEGER NOT NULL,
  memory_json    TEXT NOT NULL,
  created_at     TEXT NOT NULL,
  UNIQUE(session_id, npc_id, seq)
);
CREATE INDEX idx_npc_memories_scope
  ON npc_memories(world_id, session_id, npc_id, seq);
-- Memories are immutable claims (insert-only in v0). DELETE is intentionally left
-- open for a future forgetting/eviction slice, so no no-delete trigger is added.
CREATE TRIGGER npc_memories_no_update
  BEFORE UPDATE ON npc_memories
  BEGIN SELECT RAISE(ABORT, 'npc_memories rows are immutable'); END;
```

- The **FK to `world_sessions`** (with `foreign_keys=ON`) makes "write memory for a
  non-existent session" fail at the DB; `record` pre-checks existence and maps to
  `session-not-found`.
- The **scope index** serves both the exact-triple filter and seq-desc recall.
- Raw SQL lives only in persistence migration/adapter files (AGENTS rule).

**`SqliteNpcMemoryStore implements NpcMemoryStore`** (Node-only; mirrors
`SqliteWorldStore` patterns):

- `record(input)`: inside `withTransaction` — if the session row is absent throw
  `NotFoundSignal` → `session-not-found`; compute
  `seq = (SELECT COALESCE(MAX(seq),0)+1 FROM npc_memories WHERE session_id=? AND npc_id=?)`;
  build `record = { ...input, seq }`; `INSERT` columns + `memory_json =
  JSON.stringify(record)`. A `UNIQUE(session_id,npc_id,seq)` violation (true
  concurrent writer) → `ConflictSignal` → `conflict`. Returns `{ ok:true, record }`.
- `listForNpc(scope, {limit})`:
  `SELECT memory_json FROM npc_memories WHERE world_id=? AND session_id=? AND npc_id=?
  ORDER BY seq DESC LIMIT ?`, re-validating each row through `NpcMemoryRecordSchema`
  at the read boundary. A **corrupt memory row is an expected content failure →
  skipped** (logged `invalid-stored-memory`, `memoryId`/code only), never thrown,
  never blocking — contrast session/event corruption, which remains a fault. Returns
  the valid rows.
- Logs carry `memoryId`/`sessionId`/`npcId`/`seq`/`code` only — never `memory_json`
  or `text`.

**No browser SQLite access:** `SqliteNpcMemoryStore` lives in `src/persistence/**`,
covered by the existing tsconfig exclude + Vite reachability + reciprocal ESLint
walls. No browser code imports it; v0 adds no `server/` route and no `bootstrap`
wiring (the store is exercised by tests over a temp DB).

## 13. Boundaries / lint (encoded with the shipped code)

- **`domain/memory/**`** and `domain/ports/NpcMemoryStore.ts` are covered by the
  existing `src/domain/**` block (zod only; no React/Three/renderer/UI/platform/
  persistence/server). No domain lint change.
- **New `src/memory/**` block** in `eslint.config.js`, mirroring `src/dialogue/**`
  but **stricter — it also forbids `**/world-session/**`** (the lint-level
  enforcement of "memory has no path to truth"): it may import domain contracts/
  ports and the `Logger` interface, and must **not** import `react`, `react-dom`,
  `three`, `three/*`, `**/renderer/**`, `**/world-session/**`, `**/interactions/**`,
  `**/encounters/**`, `**/dialogue/**`, plus the shared `noSqliteImport`/
  `noHttpImport`/`noPersistenceImport`/`noServerImport` bans. `no-console` stays
  enforced.
- **Engine block:** add `{ group: ['**/memory/**'], … }` to
  `src/renderer/engine/**`'s forbidden patterns (peer of the existing
  `**/dialogue/**` forbid) so the renderer can never import the memory layer.
- **Persistence-self wall:** add `**/memory/**` to the forbidden application-layer
  group in the `src/persistence/**` block (peer of `**/dialogue/**`) so persistence
  may still import only pure domain contracts + Logger types.
- **Broad browser catch-all:** add `src/memory/**` to its `ignores` list so the new
  richer block is not clobbered (flat-config last-match-wins), mirroring
  `src/dialogue/**`.
- No engine objects ever enter memory contracts, the store, or results
  ([ADR-0008](../decisions/ADR-0008-renderer-portability-strategy.md)).

## 14. Failure / degrade behavior

| Situation | Detection | Handling / result | Logging |
| --- | --- | --- | --- |
| DB unavailable / unmigrated | `open` / `runMigrations` (tests) | fail fast before use, like the existing stores | code only |
| Invalid memory write | `validateMemoryDraft` | `rejected: <reason>`; nothing stored | reason code only |
| Missing session (FK) | `record` existence pre-check | `failed: session-not-found`; nothing stored | sessionId/code only |
| Concurrent seq collision | `UNIQUE(session_id,npc_id,seq)` | `failed: conflict`; rolled back | sessionId/code only |
| Unknown/empty scope on recall | scoped query returns nothing | `recalled` with `memories: []` — **not** an error | count (0) only |
| Corrupt stored memory row | read-boundary `safeParse` | **skip** that row; return the valid rest | memoryId/`invalid-stored-memory` |
| Graceful degradation | — | recall failure/empty → empty list → callers (when wired later) still work; memory never blocks play and never alters truth | counts/codes only |

## 15. Log-safety rules

- **May log:** `memoryId`, `worldId`, `sessionId`, `npcId`, `kind`, `source`,
  `confidence`, `seq`, `count`, result `code`/`reason`.
- **Never log:** memory `text`, NPC/room display names, `playerLine`, provider
  prompt/response bodies, API keys, or PII. The firewall and in-memory store are
  silent; the service and the SQLite store are the only loggers, and log no content
  (mirrors ADR-0013 rule 10, ADR-0017 rule 7).

## 16. Test plan (Vitest; co-located; no DOM/e2e)

- **Domain firewall (`firewall.test.ts`):** `validateMemoryDraft` accepts a valid
  draft and rejects each reason (empty/whitespace text → `empty-text`; > 280 →
  `text-too-long`; bad kind/source/confidence; empty scope; bad
  `roomId`/`turnIndex`); trims text and defaults `confidence:'medium'`;
  `filterMemoriesForScope` drops every cross-`world`/`session`/`npc` record;
  `selectRecallMemories` is deterministic (`seq` desc, `memoryId` tie-break), honors
  `limit`, and caps cumulative `text.length` at `maxChars`; purity / no input
  mutation; **assert no exported function returns a `WorldCommand`/`WorldEvent`**
  (structural).
- **Contracts (`contracts.test.ts`):** `NpcMemoryRecordSchema` parses a valid record
  and round-trips; `.strict()` rejects extra keys; enforces enums, `text` 1–280,
  `seq ≥ 1`, `turnIndex ≥ 0`; `source` rejects `'system'`.
- **Service over `InMemoryNpcMemoryStore` (`NpcMemoryService.test.ts`):** `remember`
  happy path returns `recorded` with a stamped `memoryId`/`createdAt` and assigned
  `seq`; `seq` is monotonic per `(session,npc)`; firewall reject → `rejected`,
  nothing stored; `recall` returns scoped, seq-desc, bounded records; unknown scope →
  `[]`; **the service constructor takes no `WorldSession`** and there is no append
  path (read-only-vs-truth: build a `WorldSession` + `InMemoryWorldStore`, record
  memories, assert the event log length and snapshot are unchanged).
- **No cross-world/session/NPC leak (headline):** write memories for
  `(worldA,sessionA,npc1)`, `(worldB,sessionB,npc1)`, `(sessionA,npc2)`;
  `recall(worldA,sessionA,npc1)` returns only its own rows — for both stores.
- **Player-claim-not-truth:** record `player_claim` "I killed the king"; assert no
  event/state change.
- **NPC-belief-can-be-wrong:** record `npc_belief` "player stole medicine" with no
  matching inventory event; the belief recalls; `WorldState` unaffected.
- **Summary-cannot-update-truth:** record `dialogue_summary`; assert no event
  appended, snapshot unchanged.
- **LLM-proposal-not-applied:** record `source:'llm'`; it is stored only as a scoped
  memory and produces no command/event (structural — no append path).
- **Repository (`SqliteNpcMemoryStore.test.ts`, temp/`:memory:` DB):** record→list
  round-trip; `seq` monotonic per `(session,npc)`; FK rejects unknown session
  (`session-not-found`); `UNIQUE` collision → `conflict`; corrupt `memory_json` row
  skipped; no-update trigger aborts an UPDATE; scope isolation.
- **Migration (`migrations.test.ts` extension):** `0002` creates `npc_memories`,
  the index, and the no-update trigger; re-running migrations is a no-op.
- **Log-safety:** drive `remember`/`recall`/a store failure through a capturing
  logger; assert `text`/names/`playerLine` never appear — only enums/ids/counts/codes
  (mirrors ADR-0013/0017 prompt-safety tests).
- **No API / dialogue tests** (none wired in v0).

## 17. Proposed implementation slices

Each slice builds and leaves `npm run build` / `npm run lint` / `npm run test`
(in `apps/web`) passing; the maintainer commits each manually.

1. **`feat(domain): add npc memory contracts, firewall, and store port`** —
   `domain/memory/contracts.ts`, `domain/memory/firewall.ts`,
   `domain/ports/NpcMemoryStore.ts` + co-located tests. Pure; no wiring.
2. **`feat(memory): add headless npc memory service and in-memory store`** —
   `src/memory/NpcMemoryService.ts`, `src/memory/InMemoryNpcMemoryStore.ts`, the new
   `src/memory/**` ESLint block (+ engine `**/memory/**` forbid + persistence-self
   wall + catch-all `ignores`) + tests (firewall integration, leak, read-only-vs-
   truth, log-safety). Headless.
3. **`feat(persistence): add sqlite npc memory store + migration`** —
   `persistence/migrations/0002_npc_memories.ts` (+ register in `index.ts`),
   `persistence/SqliteNpcMemoryStore.ts` + tests (round-trip, seq, FK, conflict,
   corrupt-row, no-update trigger, scope isolation). Node-only.
4. **`docs(architecture): record npc-memory-persistence-v0`** *(closeout, after
   review)* — create **ADR-0024**; update `ARCHITECTURE.md` (new "NPC Memory
   Persistence v0" section + a ✅ plug-in point), `BOUNDARIES.md` (new `memory/`
   layer row + lint block + dependency-table row), `FAILURE-MODES.md` (new memory
   case + summary row), and `AGENTS.md` (status paragraph + module table); flip this
   plan and ADR-0024 to *implemented*.

## 18. Files added / changed

- **New (domain):** `domain/memory/contracts.ts`, `domain/memory/firewall.ts`,
  `domain/ports/NpcMemoryStore.ts` (+ co-located `*.test.ts`).
- **New (memory app, headless):** `src/memory/NpcMemoryService.ts`,
  `src/memory/InMemoryNpcMemoryStore.ts` (+ tests).
- **New (persistence, Node-only):** `persistence/migrations/0002_npc_memories.ts`,
  `persistence/SqliteNpcMemoryStore.ts` (+ test).
- **Edited:** `persistence/migrations/index.ts` (register migration 2);
  `apps/web/eslint.config.js` (new `src/memory/**` block; add `**/memory/**` to the
  engine forbid and the persistence-self wall; add `src/memory/**` to the catch-all
  `ignores`).
- **Docs (slice 4, closeout):** `ARCHITECTURE.md`, `BOUNDARIES.md`,
  `FAILURE-MODES.md`, `AGENTS.md`; new `ADR-0024`; this plan flipped to *implemented*.
- **Deliberately NOT changed:** `domain/world/**` (no new event type),
  `world-session/**`, `dialogue/**`, `NPCDialogueProvider`/`buildDialogueContext`,
  `renderer/**`, `RoomViewer.tsx`, `App.tsx`, `server/**` (no route, no `bootstrap`
  wiring), `migrations/0001_init.ts`, `package.json` (no new dependency).

## 19. Approval answers (binding for this slice)

1. **Scope:** Option B trimmed — firewall/types, port, headless service,
   in-memory store, SQLite store + migration. **No API, no frontend/dialogue
   wiring, no LLM prompt injection.**
2. **Scope key:** strict `(worldId, sessionId, npcId)`; no cross-session/cross-world
   continuity in v0.
3. **Kinds:** `player_claim`, `npc_belief`, `npc_observation`, `dialogue_summary`.
4. **Source enum:** `player`, `npc`, `game`, `llm` — **no `system`**.
5. **Confidence:** kept, informational only; does not update truth and does not drive
   recall. Recall order is `seq` desc, then `memoryId`.
6. **Persistence:** SQLite backend only, headless; browser stays in-memory and
   unwired.
7. **Immutability:** no-update trigger added; delete left open for future forgetting.
8. **Bounds:** `MAX_MEMORY_CHARS = 280`; recall `limit = 8`; `maxChars = 600`.
9. **Invariants:** player claims are claims; NPC beliefs can be wrong; summaries
   cannot update truth; LLM proposes only; reducers apply allowed changes; every
   memory has scope/provenance; no cross-world/session/NPC leak;
   `WorldSession`/event log/reducers remain authoritative; memory is supporting
   context only.
