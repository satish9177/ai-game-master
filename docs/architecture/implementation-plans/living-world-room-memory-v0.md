# Implementation Plan — `feature/living-world-room-memory-v0`

> Status: **implemented — closed (ADR-0025).** Design locked by the maintainer; this
> document is the task-specific source of truth (AGENTS.md). Implementation lands in
> slices 1–3 under `feature/living-world-room-memory-v0`; the docs closeout (slice 4)
> will create **ADR-0025** and update `ARCHITECTURE.md` / `BOUNDARIES.md` /
> `FAILURE-MODES.md` / `AGENTS.md`. Each slice must leave `npm run build` /
> `npm run lint` / `npm run test` (in `apps/web`) green. Commits are made manually by
> the maintainer; agents do not commit.
>
> Companion docs: [ARCHITECTURE](../ARCHITECTURE.md) · [BOUNDARIES](../BOUNDARIES.md) ·
> [FAILURE-MODES](../FAILURE-MODES.md) · [CONVENTIONS](../CONVENTIONS.md). Roadmap
> context and direct precedent: `npc-memory-persistence-v0`
> ([ADR-0024](../decisions/ADR-0024-npc-memory-persistence-v0.md),
> [plan](./npc-memory-persistence-v0.md)),
> `world-state-event-log-v0` ([ADR-0013](../decisions/ADR-0013-world-state-event-log-v0.md)),
> `backend-sqlite-persistence-v0` ([ADR-0018](../decisions/ADR-0018-backend-sqlite-persistence-v0.md)),
> `multi-room-navigation-cache-v0` ([ADR-0016](../decisions/ADR-0016-multi-room-navigation-cache-v0.md)).
> Bundles the **`room-memory-firewall-v0`** invariants.

## Goal

Add the **first living-world room memory layer** as a durable, **headless,
Node/SQLite-only** store of *scoped room memory records* — player claims about a
room, scoped room observations, narrator/generated room notes, and room visit/event
summaries — behind a new domain `RoomMemoryStore` port, plus the pure **room-memory
firewall** that governs how room memories are written and read.

The defining property: **room memory is supporting context only and can never become
room truth.** The `WorldSession` event log + reducers stay the sole authority —
including the authoritative per-room state already held in
`WorldState.roomStates[roomId]` (`visited`, `flags`). The room-memory layer is
constructed with **no reference to `WorldSession`/`WorldStore`/`WorldCommand`/
`WorldEvent`/`WorldState`**, so it has no code path to mutate state.

This is the room-side sibling of `npc-memory-persistence-v0`: the same
`world-state-event-log-v0` (in-memory) → `backend-sqlite-persistence-v0` (SQLite,
headless, browser stays in-memory and unwired) cadence, applied to rooms. It is the
persistence/firewall seam **only**, proven end-to-end with deterministic tests and an
in-memory adapter. v0 adds **no API, no frontend/dialogue wiring, no room-generation
injection, no adjacent-room pregeneration wiring, and no LLM memory writer or prompt
injection**; the browser stays in-memory and unwired.

> **Naming note (wording risk, called out deliberately):** "living-world" names the
> *foundation*, not a cross-session living world. v0 has **no** cross-session or
> cross-world continuity, **no** retrieval/relevance, and **no** LLM. Memory is
> per-session, scoped, inert supporting context.

---

## 1. Current relevant flow

**RoomSpec / room generation flow** (`domain/roomSpec.ts`, `room/GeneratedRoomSource.ts`,
`domain/assembleRoom.ts`). `RoomSpec` is data-only; the envelope carries `id: string`,
`name`, `shell`, `spawn`, `lighting`, `objects[]`. A prompt → world-bible seed →
compact seed → `RoomGenerator` (fake default; opt-in `OpenAICompatibleRoomGenerator`)
→ raw untrusted text → `GeneratedRoomSource` → pure `assembleRoom` (`JSON.parse →
loadRoomSpec → validateRoom → repairRoom → re-validate → fallback`) → always a
zero-fatal `LoadedRoom` + `provenance`. Generated room *text* is untrusted until the
`loadRoomSpec`/`assembleRoom` boundary and is never executed. **v0 does not touch this
flow** (no room-generation injection).

**RoomRegistry / SessionRoomCache / adjacent-room flow** (`room/RoomRegistry.ts`,
`room/SessionRoomCache.ts`, `app/AdjacentRoomPregenerator.ts`, `app/NavigationService.ts`).
`RoomRegistry` maps authored ids to validated rooms; `SessionRoomCache` is a
per-session `Map<roomId, LoadedRoom>`; `AdjacentRoomPregenerator.resolveRoom(id)` is
cache-first/in-flight-aware/total; `warmAdjacent(room)` is bounded, deduped, depth-1.
**v0 does not touch these** (no adjacent-room pregeneration wiring).

**WorldSession / event-log flow** (`world-session/`, `domain/world/`). `CanonSeed` →
`session-started` (seq 1) → append-only `WorldEvent[]` = authoritative truth.
`WorldState = projectWorldState(log)` is a projection cache. The only write path is
`WorldSession.appendEvent(...)` → validate against current state → `applyEvent` →
`store.commit({event, snapshot})` under a `revision` CAS; there are **no direct state
setters**. **`WorldState` already holds authoritative per-room state**:
`currentRoomId` plus `roomStates: Record<roomId, { visited: boolean; flags?:
Record<string, boolean> }>` (`domain/world/worldState.ts`). `worldId`/`sessionId` are
UUIDs on `WorldState`. **Room memory is distinct from and never reconciles against
`roomStates`.**

**Backend persistence flow** (`persistence/`, Node-only). `db.ts` opens `node:sqlite`,
sets PRAGMAs (`foreign_keys=ON`, busy timeout, WAL), exposes `withTransaction`
(`BEGIN IMMEDIATE`) and forward-only `runMigrations`. `migrations/index.ts` →
`0001_init.ts` (creates `world_sessions`, `world_events` + append-only triggers,
`rooms`) → `0002_npc_memories.ts`. `SqliteWorldStore`/`SqliteRoomStore`/
`SqliteNpcMemoryStore` implement their ports. Read-boundary re-validation distinguishes
a **session/event fault → throw** from an **expected stored-content failure → typed
result / skipped row** (`SqliteRoomStore`'s `invalid-stored-room`,
`SqliteNpcMemoryStore`'s skipped `invalid-stored-memory`).

**NPC memory persistence flow (v0, the direct precedent).** `domain/memory/contracts.ts`
+ `domain/memory/firewall.ts` (pure); `domain/ports/NpcMemoryStore.ts` (insert-only;
`session-not-found`/`conflict`); headless `memory/NpcMemoryService.ts` (no
`WorldSession`) + `memory/InMemoryNpcMemoryStore.ts`; `persistence/SqliteNpcMemoryStore.ts`
+ `0002_npc_memories` (FK → `world_sessions`, scope index, `UNIQUE(session_id, npc_id,
seq)`, `BEFORE UPDATE` no-update trigger, DELETE left open; read boundary re-validates
each row + re-asserts JSON scope, corrupt/scope-divergent rows skipped). The strict
`src/memory/**` ESLint block forbids `world-session`/`interactions`/`encounters`/
`dialogue`.

Facts this plan relies on:

- `world_sessions(session_id TEXT PRIMARY KEY, …)` exists, so a new
  `room_memories.session_id … REFERENCES world_sessions(session_id)` FK is valid.
- The seq/immutability/signal pattern (`ConflictSignal`/`NotFoundSignal` rolled back in
  `withTransaction`, mapped to typed results) is established in `SqliteNpcMemoryStore`
  and is reused verbatim with `npc_id`→`room_id`.
- Time and ids enter only through the injected `Clock`/`IdGenerator` ports
  (`domain/ports/`), so the service is deterministic under fakes.
- The browser composition root (`App.tsx`) uses `InMemoryWorldStore` and does **not**
  import `persistence/**` or `server/**` (reciprocal ESLint walls + tsconfig exclude +
  Vite unreachability). v0 keeps it that way.
- **Reusing `domain/memory/` and `src/memory/` means zero `eslint.config.js` change**:
  `domain/memory/**` is covered by the `src/domain/**` block; `src/memory/**` is
  covered by the existing strict memory block; the engine block already forbids
  `**/memory/**`; the persistence-self wall already allows `domain/memory` via the
  `!**/domain/memory/**` negation while forbidding the `src/memory` app layer.

## 2. Current authority model

- **Truth (authoritative):** the per-session append-only `WorldEvent[]`, with
  `WorldState` only as its reconstructable projection — **including
  `WorldState.roomStates[roomId].visited` and `.flags`**, which are the real "what is
  true about this room" (visited, one-shot/encounter resolution flags). In the
  backend, `SqliteWorldStore`/`SqliteRoomStore`. Single write path: append a validated,
  typed event, then project.
- **Supporting context only (never truth):** `WorldBibleSeed` (initial canon),
  `RoomSpec`/generated room text + `provenance`, `NPCDialogueSpec` + provider replies,
  conversation history, generator prompts/seeds, **NPC memory**, and any LLM/provider
  output. **Room memory joins this set** — claim/observation/note/summary context that
  can never override the hard facts and, in particular, **never touches `roomStates`**.

## 3. Meaning of `living-world-room-memory-v0`

A durable, headless, Node/SQLite-only store of typed room memory records, scoped by the
exact `(worldId, sessionId, roomId)` triple, with:

- a **pure domain firewall** (write validation, scope re-filtering, deterministic
  bounded recall selection),
- a `RoomMemoryStore` **port** (domain),
- a headless `RoomMemoryService` (`remember`/`recall`) that **does not depend on
  `WorldSession`**,
- an `InMemoryRoomMemoryStore` (for tests / a future browser path), and
- a `SqliteRoomMemoryStore` + migration `0003_room_memories`.

Room memory records are **opaque inert text + closed-enum metadata** (numbers/strings/
enums), produced and read deterministically. They feed **no** `RoomSpec`, **no**
`WorldState`/`roomStates`, **no** event, **no** reducer, **no** generation. Their
absence never blocks play.

## 4. Meaning of `room-memory-firewall-v0`

A small pure domain module **plus a structural separation** guaranteeing the
invariants. The single most important mechanism is identical to the NPC firewall: **the
room-memory layer holds no reference to `WorldSession`/`WorldStore`/`WorldCommand`/
`WorldEvent`/`WorldState`, and the room-memory contracts/firewall export no function
that produces those types** — lint-enforced by the existing strict `src/memory/**`
block that forbids importing `**/world-session/**`.

| Invariant | Mechanism |
| --- | --- |
| 1. Room memory is not room truth | Inert rows; the service has no append path and no `roomStates` access. `roomStates.visited`/`flags` stay the only per-room truth. |
| 2. Generated room text is not truth | Generated `name`/story may be stored only as a `room_note`/`room_summary` memory; it never becomes `RoomSpec`, `WorldState`, an event, or a generation input in v0. |
| 3. Player claims about a room are claims | `kind:'player_claim'` row; never an event; never reconciled against `roomStates`. Service has no append path. |
| 4. Summaries cannot update room/world state | `kind:'room_summary'`; same structural no-write-path (v0 builds no summarizer). |
| 5. LLM proposes room/world changes only | `provenance.source:'llm'` rows are still just scoped memories; any world change must still go through `WorldSession.appendEvent` (unchanged), which the memory layer cannot reach. |
| 6. Reducers apply allowed changes | `applyEvent` unchanged; room memory never touches it. |
| 7. Every memory has scope + provenance | Required `worldId`/`sessionId`/`roomId` + `provenance{source,…}`, enforced by schema + `validateRoomMemoryDraft`. |
| 8. No cross-world/session/room leak | Reads filtered by the exact triple at SQL **and** re-asserted by `filterRoomMemoriesForScope` **and** by the adapter's JSON-scope re-assertion; the FK ties memory to a real session; dedicated leak tests. |
| 9. Corrupt/scope-divergent row must not crash recall | Read-boundary `safeParse` + JSON-scope re-assert → skip the row (`invalid-stored-memory`), never throw, never block. |

"Firewall" here means a **validation + scoping + structural-separation discipline**,
not a security/auth boundary.

## 5. Final decisions (locked)

1. **Scope = Option B trimmed:** pure firewall/contracts, `RoomMemoryStore` port,
   headless `RoomMemoryService`, `InMemoryRoomMemoryStore`, `SqliteRoomMemoryStore` +
   migration `0003`. **No API. No frontend/dialogue wiring. No room-generation
   injection. No adjacent-room pregeneration wiring. No LLM memory writer or prompt
   injection.** Browser stays in-memory and unwired.
2. **Reuse existing folders:** room contracts/firewall live in `domain/memory/`; the
   headless service + in-memory adapter live in `src/memory/`. **Do not change
   `eslint.config.js` in v0** unless implementation proves a rule is required.
3. **Scope is strict `(worldId, sessionId, roomId)`.** No cross-session and no
   cross-world continuity in v0. Recall requires the full triple. `roomId` is a plain
   non-empty string (`z.string().min(1)`), decoupled from the world UUID schema.
4. **Room memory kinds:** `player_claim` · `room_observation` · `room_note` ·
   `room_summary`. `room_note` is the home for generated/narrator room text (inert
   supporting context only); `room_summary` is a storable kind only (v0 builds no
   summarizer).
5. **Source enum:** `player` · `npc` · `game` · `llm`. **No `system` source** — hidden
   system/developer/internal text must never be stored. `game` means a memory
   originated by deterministic game rules/runtime activity, **not** any hidden
   prompt/developer text.
6. **Provenance:** `{ source, npcId?, turnIndex? }` — the symmetric inverse of NPC
   memory's `{ source, roomId?, turnIndex? }`. A room memory may record which NPC
   formed/uttered it; `roomId` is omitted because it is the scope.
7. **Confidence** (`low`/`medium`/`high`) is **informational only**: it does not update
   truth and does not drive recall ranking.
8. **Persistence: SQLite backend only, headless only.** FK only `session_id ->
   world_sessions(session_id)`. **No FK to the `rooms` table** (room memory must not
   require a persisted room row; mirrors `npc_id` being FK'd to nothing).
9. **Immutability:** add a **no-update** trigger on `room_memories`; **leave DELETE
   open** for a future forgetting/eviction slice (v0 never deletes).
10. **Bounds:** `MAX_ROOM_MEMORY_CHARS = 280`; default recall `limit = 8`; recall
    `maxChars = 600`. **Recall ordering is deterministic: `seq` desc, then `memoryId`
    tie-break** — never confidence, never recency-by-clock, never relevance.
11. **Do not refactor the NPC memory firewall/contracts.** The room firewall is a
    standalone, parallel module. The shipped NPC memory layer stays byte-identical.
    (A future shared-recall-helper dedup is noted as a follow-up only.)
12. **Core invariants (§4) are binding:** room memory is not room truth; generated room
    text is not truth; player claims are claims; summaries cannot update truth; LLM
    proposes only; reducers apply allowed changes; every memory has scope/provenance;
    no cross-world/session/room leak; corrupt/scope-divergent rows are skipped;
    `WorldSession`/event log/reducers (incl. `roomStates`) remain authoritative; room
    memory must not mutate `WorldState`, `roomStates`, `RoomSpec`, the event log,
    generated rooms, or renderer state.

## 6. Non-goals

This slice must **not**:

- Add **API endpoints**, a browser→Node client/CORS, or any HTTP surface for room
  memory.
- Wire room memory into the **renderer / `RoomViewer` / engine / `App.tsx` / `room/**`
  / `app/**`**, or into **room generation** (`assembleRoom`, the generator,
  `WorldBibleSeed`, `GeneratedRoomSource`).
- Wire room memory into **adjacent-room pregeneration** (`AdjacentRoomPregenerator`,
  `SessionRoomCache`, `RoomRegistry`, `NavigationService`) or **dialogue**
  (`dialogue/`, `NPCDialoguePanel`, `buildDialogueContext`), or inject memory into any
  **LLM/provider prompt**.
- Wire room memory to the **browser** in any form (browser stays `InMemoryWorldStore`
  and imports no persistence).
- Add a **vector DB, embeddings, semantic search, or relevance scoring**.
- Add a **global/cross-world** room profile, **cross-session** room memory, or any
  cross-room/world leak.
- Add an **automatic summarizer** (`room_summary` is a kind you may store; v0 builds no
  summarizer), an **LLM memory writer**, or a multi-room social/spatial graph.
- Add **memory eviction/forgetting/decay**, a `delete` path, or any memory mutation.
- Give the room-memory layer any **`WorldSession`/`WorldStore`/`WorldCommand`/
  `WorldEvent`/`WorldState`/`roomStates`** dependency, or any path that mutates truth,
  `RoomSpec`, generated rooms, or renderer state.
- Change **`world-session` authority**, the closed 7-event union, `applyEvent`,
  `CanonSeed`, save/load, or the `RoomSpec` schema / renderer / Three.js.
- **Refactor or change** the NPC memory firewall, contracts, port, service, store, or
  `0002_npc_memories`.
- Store **raw provider prompts/responses, request/response bodies, API keys, hidden
  system/developer text, or PII** as memory.
- **Log** memory `text`, room/NPC display names, player lines, provider bodies, keys,
  generated JSON, or any narrative/user content.

## 7. Chosen option and placement

**Option B (trimmed): domain firewall + contracts + port, headless service + in-memory
adapter, SQLite adapter + migration — no API, no frontend, no generation/adjacent
wiring.** (Rejected: **A** domain-only under-delivers the *persistence* feature; **C**
adds an API route or a generation/adjacent recall seam — forbidden by the v0 hard
constraints and forces browser↔backend wiring AGENTS defers; **D** full
retrieval/summaries/LLM injection — against the hard constraints.) It mirrors the
trusted cadence already accepted for NPC memory and reuses the `domain/memory/` +
`src/memory/` folders so **no ESLint change is needed**.

| Piece | Location |
| --- | --- |
| `RoomMemoryRecordSchema` + enums + `RoomMemoryScope` + bounds | `apps/web/src/domain/memory/roomContracts.ts` |
| `validateRoomMemoryDraft` / `filterRoomMemoriesForScope` / `selectRecallRoomMemories` | `apps/web/src/domain/memory/roomFirewall.ts` |
| `RoomMemoryStore` port | `apps/web/src/domain/ports/RoomMemoryStore.ts` |
| `RoomMemoryService` (`remember`/`recall`; **no `WorldSession`**) | `apps/web/src/memory/RoomMemoryService.ts` |
| `InMemoryRoomMemoryStore` | `apps/web/src/memory/InMemoryRoomMemoryStore.ts` |
| `SqliteRoomMemoryStore` | `apps/web/src/persistence/SqliteRoomMemoryStore.ts` |
| Migration `0003_room_memories` | `apps/web/src/persistence/migrations/0003_room_memories.ts` (+ register in `index.ts`) |

New files reuse the existing boundary blocks: `domain/memory/**` + `domain/ports/**`
under the `src/domain/**` block; `src/memory/**` under the strict memory block;
`src/persistence/**` under the persistence-self wall (which already re-includes
`domain/memory` via negation). **No `eslint.config.js` change in v0** (decision 2).

## 8. Room memory model

`apps/web/src/domain/memory/roomContracts.ts` (zod 4; `.strict()` objects; every string
bounded). Ids are app-generated UUID strings (`IdGenerator`); `createdAt` is UTC
ISO-8601 (`Clock`); `seq` is a gapless monotonic integer per `(sessionId, roomId)`
assigned by the store. Mirrors `NpcMemoryRecordSchema` with `npcId`→`roomId` and the
provenance inversion (`roomId?`→`npcId?`).

```ts
export const ROOM_MEMORY_SCHEMA_VERSION = 1 as const
export const MAX_ROOM_MEMORY_CHARS = 280

export const RoomMemoryKindSchema = z.enum([
  'player_claim', 'room_observation', 'room_note', 'room_summary',
])
export const RoomMemorySourceSchema = z.enum(['player', 'npc', 'game', 'llm'])  // no 'system'
export const RoomMemoryConfidenceSchema = z.enum(['low', 'medium', 'high'])

export const RoomMemoryScopeSchema = z.object({
  worldId: z.string().min(1),
  sessionId: z.string().min(1),
  roomId: z.string().min(1),         // authored / generated / fallback id; NOT a UUID, NOT FK'd to `rooms`
}).strict()

export const RoomMemoryProvenanceSchema = z.object({
  source: RoomMemorySourceSchema,
  npcId: z.string().min(1).optional(),            // which NPC formed/uttered it
  turnIndex: z.number().int().min(0).optional(),  // dialogue turn that produced it
}).strict()

export const RoomMemoryRecordSchema = z.object({
  schemaVersion: z.literal(ROOM_MEMORY_SCHEMA_VERSION),
  memoryId: z.string().min(1),
  worldId: z.string().min(1),               // SCOPE
  sessionId: z.string().min(1),             // SCOPE
  roomId: z.string().min(1),                // SCOPE
  kind: RoomMemoryKindSchema,
  text: z.string().min(1).max(MAX_ROOM_MEMORY_CHARS),  // inert recall content — NEVER logged, never code
  provenance: RoomMemoryProvenanceSchema,
  confidence: RoomMemoryConfidenceSchema,   // informational only
  seq: z.number().int().min(1),             // per (sessionId, roomId); ordering key
  createdAt: z.string().min(1),             // UTC ISO-8601 via Clock
}).strict()

export type RoomMemoryRecord = z.infer<typeof RoomMemoryRecordSchema>
export type RoomMemoryScope = z.infer<typeof RoomMemoryScopeSchema>
export type RoomMemoryInsert = Omit<RoomMemoryRecord, 'seq'>  // service stamps id/createdAt; store assigns seq
```

- `text` is opaque, inert, ≤ 280 chars; never parsed or `eval`'d, never logged.
- `kind` carries the epistemic class; `confidence` is metadata only.
- `provenance.source ∈ {player, npc, game, llm}` records where the assertion came from.
  There is no `system` source.
- **`roomId` is a plain non-empty string** — never reconciled against `WorldState`,
  `roomStates`, or the `rooms` table.

## 9. Room memory firewall (`domain/memory/roomFirewall.ts`)

Pure, total, deterministic; no I/O, no `Date.now`/`Math.random`, no input mutation.
Standalone and parallel to the NPC firewall (decision 11) — it does not import or alter
`domain/memory/firewall.ts`.

```ts
export const DEFAULT_ROOM_RECALL_LIMIT = 8
export const DEFAULT_ROOM_RECALL_MAX_CHARS = 600

export type RoomMemoryDraftInput = {
  worldId: string; sessionId: string; roomId: string
  kind: RoomMemoryKind; source: RoomMemorySource; text: string
  confidence?: RoomMemoryConfidence        // default 'medium'
  npcId?: string; turnIndex?: number
}
export type RoomMemoryDraft = {
  scope: RoomMemoryScope; kind: RoomMemoryKind; text: string
  provenance: RoomMemoryProvenance; confidence: RoomMemoryConfidence
}
export type RoomMemoryRejectReason =
  | 'invalid-scope' | 'invalid-kind' | 'invalid-source'
  | 'empty-text' | 'text-too-long' | 'invalid-confidence' | 'invalid-provenance'

export type ValidateRoomMemoryDraftResult =
  | { ok: true; draft: RoomMemoryDraft }
  | { ok: false; reason: RoomMemoryRejectReason }

// Write firewall: validate + normalize (trim text, default confidence). Returns a
// draft WITHOUT memoryId/seq/createdAt — the service/store stamp those.
export function validateRoomMemoryDraft(input: RoomMemoryDraftInput): ValidateRoomMemoryDraftResult

// Read firewall (defense in depth behind the scoped SQL query): drop any record whose
// (worldId, sessionId, roomId) does not match exactly.
export function filterRoomMemoriesForScope(
  records: readonly RoomMemoryRecord[], scope: RoomMemoryScope,
): RoomMemoryRecord[]

// Bounded deterministic selection: sort by seq desc, then memoryId tie-break; take up
// to `limit`; cap cumulative text length at `maxChars`. No scoring, no clock.
export function selectRecallRoomMemories(
  records: readonly RoomMemoryRecord[], options: { limit: number; maxChars: number },
): RoomMemoryRecord[]
```

- `validateRoomMemoryDraft` checks scope non-empty after trim (`invalid-scope`);
  `kind`/`source`/`confidence` in their closed enums
  (`invalid-kind`/`invalid-source`/`invalid-confidence`); `text` non-empty after trim
  (`empty-text`) and ≤ `MAX_ROOM_MEMORY_CHARS` (`text-too-long`); optional
  `npcId`/`turnIndex` well-formed (`invalid-provenance`); trims `text`, defaults
  `confidence` to `'medium'`. It stamps nothing authoritative.
- `selectRecallRoomMemories` is the only ordering authority and uses **`seq` desc, then
  `memoryId`** — never `confidence`, never recency-by-clock, never relevance.

**Structural truth/proposal separation:** `domain/memory/roomContracts.ts` and
`roomFirewall.ts` import only `zod`/their own contracts; they export **no**
`WorldCommand`/`WorldEvent`-producing function and reference **no** `WorldState`/
`roomStates`. There is no room-memory→truth mapping.

## 10. `RoomMemoryStore` port (`domain/ports/RoomMemoryStore.ts`)

Mirrors `NpcMemoryStore`/`WorldStore`/`RoomStore`: expected failures are typed results,
not thrown.

```ts
export type RoomMemoryStoreErrorCode = 'session-not-found' | 'conflict'

export type RoomMemoryWriteResult =
  | { ok: true; record: RoomMemoryRecord }                 // includes the assigned seq
  | { ok: false; error: { code: RoomMemoryStoreErrorCode } }

export interface RoomMemoryStore {
  /** Persist one memory (insert-only). Assigns the next seq for (sessionId, roomId). */
  record(input: RoomMemoryInsert): Promise<RoomMemoryWriteResult>
  /** Scoped read: exact (worldId, sessionId, roomId), seq desc, bounded by limit. */
  listForRoom(scope: RoomMemoryScope, options?: { limit?: number }): Promise<RoomMemoryRecord[]>
}
```

There is **no update or delete** on the port (insert-only; immutable claims in v0).

## 11. Headless application (`src/memory/`)

`RoomMemoryService` — constructor-injected `RoomMemoryStore`, `Clock`, `IdGenerator`,
`Logger`. **No `WorldSession`/`WorldStore` parameter** (the structural firewall).

```ts
export type RememberRoomMemoryResult =
  | { status: 'recorded'; record: RoomMemoryRecord }
  | { status: 'rejected'; reason: RoomMemoryRejectReason }      // firewall
  | { status: 'failed'; reason: RoomMemoryStoreErrorCode }      // store
export type RecallRoomMemoryResult = { status: 'recalled'; memories: RoomMemoryRecord[] }
```

- `remember(input)`: `validateRoomMemoryDraft` → on reject, log code + return
  `rejected`; else stamp `memoryId = idGen.newId()`, `createdAt = clock.now()`, call
  `store.record(insert)`; map store failure → `failed`; else log + return `recorded`.
- `recall(scope, options?)`: `limit = options?.limit ?? DEFAULT_ROOM_RECALL_LIMIT`;
  `raw = store.listForRoom(scope, { limit })`; `scoped =
  filterRoomMemoriesForScope(raw, scope)`; `selected = selectRecallRoomMemories(scoped,
  { limit, maxChars: options?.maxChars ?? DEFAULT_ROOM_RECALL_MAX_CHARS })`; log count;
  return `recalled`. An unknown scope yields `[]` (not a failure).

`InMemoryRoomMemoryStore` — pure in-memory adapter mirroring `InMemoryNpcMemoryStore`:
assigns `seq = max(seq for (sessionId, roomId)) + 1`, stores immutable copies, and
`listForRoom` returns freshly-copied, scope-filtered, seq-desc, limited records (no
aliasing). Enables full service testing without SQLite. It does **not** enforce the FK;
`session-not-found` is exercised against the SQLite adapter. Silent (never logs).

**Logging:** `memoryId`, `worldId`, `sessionId`, `roomId`, `kind`, `source`,
`confidence`, `seq`, `count`, result `code`/`reason` only — **never** `text`, room/NPC
names, or player lines. The firewall and in-memory store are silent; the service is the
only logger in this layer.

## 12. Storage design (`persistence/`)

**Migration `migrations/0003_room_memories.ts`** (append to the `migrations` array in
`migrations/index.ts` as `{ version: 3, name: 'room_memories', up }`). Follows the
`npc_memories` precedent exactly: a JSON blob + indexed scope columns.

```sql
CREATE TABLE room_memories (
  memory_id      TEXT PRIMARY KEY,
  world_id       TEXT NOT NULL,
  session_id     TEXT NOT NULL REFERENCES world_sessions(session_id),
  room_id        TEXT NOT NULL,
  kind           TEXT NOT NULL,
  seq            INTEGER NOT NULL,
  schema_version INTEGER NOT NULL,
  memory_json    TEXT NOT NULL,
  created_at     TEXT NOT NULL,
  UNIQUE(session_id, room_id, seq)
);
CREATE INDEX idx_room_memories_scope
  ON room_memories(world_id, session_id, room_id, seq);
-- Memories are immutable claims (insert-only in v0). DELETE is intentionally left open
-- for a future forgetting/eviction slice, so no no-delete trigger is added.
CREATE TRIGGER room_memories_no_update
  BEFORE UPDATE ON room_memories
  BEGIN SELECT RAISE(ABORT, 'room_memories rows are immutable'); END;
```

- The **FK to `world_sessions`** (with `foreign_keys=ON`) makes "write a memory for a
  non-existent session" fail at the DB; `record` pre-checks existence and maps it to
  `session-not-found`.
- **No FK to the `rooms` table** (decision 8): `room_id` is a scope string; room memory
  must not require a persisted room row (mirrors `npc_id` being FK'd to nothing). An
  unknown room id is allowed on write and simply recalls `[]`.
- The **scope index** serves both the exact-triple filter and seq-desc recall.
- Raw SQL lives only in persistence migration/adapter files (AGENTS rule).

**`SqliteRoomMemoryStore implements RoomMemoryStore`** (Node-only; mirrors
`SqliteNpcMemoryStore` patterns):

- `record(input)`: inside `withTransaction` — if the session row is absent throw
  `NotFoundSignal` → `session-not-found`; compute
  `seq = (SELECT COALESCE(MAX(seq),0)+1 FROM room_memories WHERE session_id=? AND room_id=?)`;
  build `record = { ...input, seq }`; `INSERT` columns + `memory_json =
  JSON.stringify(record)`. A `UNIQUE(session_id, room_id, seq)` violation (true
  concurrent writer) → `ConflictSignal` → `conflict`. Returns `{ ok:true, record }`.
- `listForRoom(scope, {limit})`:
  `SELECT memory_id, memory_json FROM room_memories WHERE world_id=? AND session_id=?
  AND room_id=? ORDER BY seq DESC LIMIT ?`, re-validating each row through
  `RoomMemoryRecordSchema` at the read boundary **and re-asserting the parsed JSON scope
  against the queried SQL triple**. A **corrupt or scope-divergent memory row is an
  expected content failure → skipped** (logged `invalid-stored-memory`,
  `memoryId`/code only), never thrown, never blocking — contrast session/event
  corruption, which remains a fault. Returns the valid rows.
- Logs carry `memoryId`/`sessionId`/`roomId`/`seq`/`code` only — never `memory_json` or
  `text`.

**No browser SQLite access:** `SqliteRoomMemoryStore` lives in `src/persistence/**`,
covered by the existing tsconfig exclude + Vite unreachability + reciprocal ESLint
walls. No browser code imports it; v0 adds no `server/` route and no `bootstrap` wiring
(the store is exercised by tests over a temp/`:memory:` DB).

## 13. Boundaries / lint (decision: no `eslint.config.js` change in v0)

- **`domain/memory/roomContracts.ts`, `domain/memory/roomFirewall.ts`, and
  `domain/ports/RoomMemoryStore.ts`** are covered by the existing `src/domain/**` block
  (zod only; no React/Three/renderer/UI/platform/persistence/server). No domain lint
  change.
- **`src/memory/RoomMemoryService.ts` and `InMemoryRoomMemoryStore.ts`** are covered by
  the existing strict `src/memory/**` block (forbids React/Three/renderer/persistence/
  server **and** `world-session`/`interactions`/`encounters`/`dialogue`). No memory
  lint change.
- **Engine block** already forbids `**/memory/**`, so the renderer can never import the
  room-memory layer. No change.
- **Persistence-self wall** already allows `domain/memory` (via the
  `!**/domain/memory/**` negation) while forbidding the `src/memory` app layer, so
  `SqliteRoomMemoryStore` may import `domain/memory/roomContracts.ts` but not the
  service. No change.
- **Broad browser catch-all** already `ignores` `src/memory/**`. No change.
- If, and only if, implementation surfaces a concrete rule gap (e.g. a new import a
  block does not cover), the smallest necessary `eslint.config.js` edit is made and
  recorded in the closeout; otherwise the config is untouched.
- No engine objects ever enter room-memory contracts, the store, or results
  ([ADR-0008](../decisions/ADR-0008-renderer-portability-strategy.md)).

## 14. Failure / degrade behavior

| Situation | Detection | Handling / result | Logging |
| --- | --- | --- | --- |
| DB unavailable / unmigrated | `open` / `runMigrations` (tests) | fail fast before use, like the existing stores | code only |
| Invalid memory write | `validateRoomMemoryDraft` | `rejected: <reason>`; nothing stored | reason code only |
| Missing session/world (FK) | `record` existence pre-check | `failed: session-not-found`; nothing stored | sessionId/code only |
| Missing room | n/a (`room_id` is a scope string, not FK'd) | write succeeds for any non-empty `room_id`; recall for an unknown room → `[]` | ids only |
| Concurrent seq collision | `UNIQUE(session_id, room_id, seq)` | `failed: conflict`; rolled back | sessionId/roomId/code only |
| Unknown/empty scope on recall | scoped query returns nothing | `recalled` with `memories: []` — **not** an error | count (0) only |
| Corrupt or scope-divergent stored row | read-boundary `safeParse` + JSON-scope re-assert | **skip** that row; return the valid rest | memoryId/`invalid-stored-memory` |
| Recall failure / graceful degradation | — | empty/partial recall → callers (when wired later) still work; memory never blocks play and never alters truth | counts/codes only |

## 15. Log-safety rules

- **May log:** `memoryId`, `worldId`, `sessionId`, `roomId`, `kind`, `source`,
  `confidence`, `seq`, `count`, result `code`/`reason`.
- **Never log:** memory `text`, room/NPC display names, player lines, provider
  prompt/response bodies, generated JSON, API keys, or PII. The firewall and the
  in-memory store are silent; the service and the SQLite store are the only loggers,
  and log no content (mirrors ADR-0013 rule 10, ADR-0024 log-safety).

## 16. Test plan (Vitest; co-located; no DOM/e2e)

- **Domain firewall (`roomFirewall.test.ts`):** `validateRoomMemoryDraft` accepts a
  valid draft and rejects each reason (empty/whitespace text → `empty-text`; > 280 →
  `text-too-long`; bad kind/source/confidence; empty scope; bad `npcId`/`turnIndex` →
  `invalid-provenance`); trims text and defaults `confidence:'medium'`;
  `filterRoomMemoriesForScope` drops every cross-`world`/`session`/`room` record;
  `selectRecallRoomMemories` is deterministic (`seq` desc, `memoryId` tie-break), honors
  `limit`, and caps cumulative `text.length` at `maxChars`; purity / no input mutation;
  **assert no exported function returns a `WorldCommand`/`WorldEvent`** (structural).
- **Contracts (`roomContracts.test.ts`):** `RoomMemoryRecordSchema` parses a valid
  record and round-trips; `.strict()` rejects extra keys; enforces enums, `text` 1–280,
  `seq ≥ 1`, `turnIndex ≥ 0`; `source` rejects `'system'`.
- **Service over `InMemoryRoomMemoryStore` (`RoomMemoryService.test.ts`):** `remember`
  happy path returns `recorded` with a stamped `memoryId`/`createdAt` and assigned
  `seq`; `seq` is monotonic per `(session, room)`; firewall reject → `rejected`, nothing
  stored; `recall` returns scoped, seq-desc, bounded records; unknown scope → `[]`;
  **the service constructor takes no `WorldSession`** and there is no append path.
- **No cross-world/session/room leak (headline):** write memories for
  `(worldA, sessionA, roomX)`, `(worldB, sessionB, roomX)`, `(sessionA, roomY)`;
  `recall(worldA, sessionA, roomX)` returns only its own rows — for both stores.
- **Room-memory-not-truth (build a `WorldSession` + `InMemoryWorldStore`, record
  memories, assert the event-log length, snapshot, and `roomStates` are unchanged):**
  - **Player-claim-not-truth:** record `player_claim` "the east door is locked"; assert
    no event/state/`roomStates` change.
  - **Generated-room-text-not-truth:** store a `room_note`/`room_summary` carrying a
    generated room name/story; assert it is stored/recalled only — no `RoomSpec`, no
    `WorldState`/`roomStates`, no event, no generation input.
  - **Summary-cannot-update-truth:** record `room_summary`; assert no event appended,
    snapshot/`roomStates` unchanged.
  - **LLM-proposal-not-applied:** record `source:'llm'`; stored only as a scoped memory;
    produces no command/event (structural — no append path).
- **Repository (`SqliteRoomMemoryStore.test.ts`, temp/`:memory:` DB):** record→list
  round-trip; `seq` monotonic per `(session, room)`; FK rejects unknown session
  (`session-not-found`); `UNIQUE` collision → `conflict`; corrupt `memory_json` row
  skipped; **scope-divergent JSON row skipped**; no-update trigger aborts an UPDATE;
  scope isolation.
- **Migration (`migrations.test.ts` extension):** `0003` creates `room_memories`, the
  index, and the no-update trigger; re-running migrations is a no-op; `0002`
  (npc_memories) remains intact and unaltered.
- **Log-safety:** drive `remember`/`recall`/a store failure through a capturing logger;
  assert `text`/room names/NPC names/player lines never appear — only
  enums/ids/counts/codes.
- **No API / dialogue / generation / adjacent tests** (none wired in v0).

## 17. Proposed implementation slices

Each slice builds and leaves `npm run build` / `npm run lint` / `npm run test` (in
`apps/web`) passing; the maintainer commits each manually.

1. **`feat(domain): add room memory contracts, firewall, and store port`** —
   `domain/memory/roomContracts.ts`, `domain/memory/roomFirewall.ts`,
   `domain/ports/RoomMemoryStore.ts` + co-located tests. Pure; no wiring; no eslint
   change.
2. **`feat(memory): add headless room memory service and in-memory store`** —
   `src/memory/RoomMemoryService.ts`, `src/memory/InMemoryRoomMemoryStore.ts` + tests
   (firewall integration, leak, not-truth, log-safety). Headless; no eslint change
   (reuses the `src/memory/**` block).
3. **`feat(persistence): add sqlite room memory store + migration`** —
   `persistence/migrations/0003_room_memories.ts` (+ register in `index.ts`),
   `persistence/SqliteRoomMemoryStore.ts` + tests (round-trip, seq, FK, conflict,
   corrupt-row, scope-divergent, no-update trigger, scope isolation). Node-only.
4. **`docs(architecture): record living-world-room-memory-v0`** *(closeout)* — create
   **ADR-0025**; update `ARCHITECTURE.md` (new "Living-World Room Memory v0" section +
   plug-in point + layer-table note), `BOUNDARIES.md` (memory-layer row gains the room
   store; persistence row gains `SqliteRoomMemoryStore`/`0003`), `FAILURE-MODES.md`
   (new case 17 + summary row), and `AGENTS.md` (extend the memory section); flip this
   plan and ADR-0025 to *implemented*.

## 18. Files added / changed

- **New (domain):** `domain/memory/roomContracts.ts`, `domain/memory/roomFirewall.ts`,
  `domain/ports/RoomMemoryStore.ts` (+ co-located `*.test.ts`).
- **New (memory app, headless):** `src/memory/RoomMemoryService.ts`,
  `src/memory/InMemoryRoomMemoryStore.ts` (+ tests).
- **New (persistence, Node-only):** `persistence/migrations/0003_room_memories.ts`,
  `persistence/SqliteRoomMemoryStore.ts` (+ test).
- **Edited:** `persistence/migrations/index.ts` (register migration 3);
  `persistence/migrations/migrations.test.ts` (extend for `0003`).
- **Docs (slice 4, closeout):** `ARCHITECTURE.md`, `BOUNDARIES.md`, `FAILURE-MODES.md`,
  `AGENTS.md`; new `ADR-0025`; this plan flipped to *implemented*.
- **Deliberately NOT changed:** `eslint.config.js` (decision 2; unless implementation
  proves a rule is required); `domain/memory/contracts.ts` / `domain/memory/firewall.ts`
  / `domain/ports/NpcMemoryStore.ts` / `src/memory/NpcMemoryService.ts` /
  `src/memory/InMemoryNpcMemoryStore.ts` / `persistence/SqliteNpcMemoryStore.ts` /
  `migrations/0002_npc_memories.ts` (no NPC-memory refactor, decision 11);
  `domain/world/**` (no new event type), `world-session/**`, `domain/roomSpec.ts` /
  `loadRoomSpec` / `assembleRoom` / `repairRoom` / `validateRoom`, `room/**`
  (`RoomRegistry`/`SessionRoomCache`/`GeneratedRoomSource`), `app/**`
  (`AdjacentRoomPregenerator`/`NavigationService`), `dialogue/**`, `renderer/**`,
  `RoomViewer.tsx`, `App.tsx`, `server/**` (no route, no `bootstrap` wiring),
  `migrations/0001_init.ts`, `package.json` (no new dependency).

## 19. Approval answers (binding for this slice)

1. **Scope:** Option B trimmed — firewall/contracts, port, headless service, in-memory
   store, SQLite store + migration. **No API, no frontend/dialogue wiring, no
   room-generation injection, no adjacent-room pregeneration wiring, no LLM memory
   writer or prompt injection.**
2. **Folders:** reuse `domain/memory/` and `src/memory/`; **no `eslint.config.js`
   change** in v0 unless implementation proves it is required.
3. **Scope key:** strict `(worldId, sessionId, roomId)`; `roomId` is a plain non-empty
   string; no cross-session/cross-world continuity in v0.
4. **Kinds:** `player_claim`, `room_observation`, `room_note`, `room_summary`.
5. **Source enum:** `player`, `npc`, `game`, `llm` — **no `system`**.
6. **Provenance:** `{ source, npcId?, turnIndex? }`.
7. **Confidence:** kept, informational only; does not update truth and does not drive
   recall. Recall order is `seq` desc, then `memoryId`.
8. **Persistence:** SQLite backend only, headless; FK only `session_id ->
   world_sessions`; **no FK to `rooms`**; browser stays in-memory and unwired.
9. **Immutability:** no-update trigger added; DELETE left open for future forgetting.
10. **Bounds:** `MAX_ROOM_MEMORY_CHARS = 280`; recall `limit = 8`; `maxChars = 600`.
11. **NPC memory untouched:** the room firewall is standalone and parallel; the shipped
    NPC memory layer is not refactored.
12. **Invariants:** room memory is not room truth; generated room text is not truth;
    player claims are claims; summaries cannot update truth; LLM proposes only; reducers
    apply allowed changes; every memory has scope/provenance; no cross-world/session/room
    leak; corrupt/scope-divergent rows are skipped; `WorldSession`/event log/reducers
    (incl. `roomStates`) remain authoritative; room memory must not mutate `WorldState`,
    `roomStates`, `RoomSpec`, the event log, generated rooms, or renderer state.
