# Implementation Plan — `feature/sqlite-fts-memory-retrieval-v0`

> Status: **PROPOSED — awaiting maintainer review. No implementation until approved.**
>
> This is the docs-only planning slice for SQLite FTS memory retrieval. It proposes a
> low-risk, headless retrieval/indexing feature over the existing NPC and room memory
> stores. It intentionally avoids UI, provider/LLM behavior, gameplay authority,
> browser persistence wiring, and any raw memory-text logging.
>
> Companion docs: [ARCHITECTURE](../ARCHITECTURE.md) · [BOUNDARIES](../BOUNDARIES.md) ·
> [FAILURE-MODES](../FAILURE-MODES.md). Roadmap context:
> `npc-memory-persistence-v0` ([ADR-0024](../decisions/ADR-0024-npc-memory-persistence-v0.md)),
> `living-world-room-memory-v0` ([ADR-0025](../decisions/ADR-0025-living-world-room-memory-v0.md)),
> `memory-context-ranking-v0`, `memory-display-name-persistence-v0`, and
> `long-session-memory-evaluation-v0` ([ADR-0074](../decisions/ADR-0074-long-session-memory-evaluation-v0.md)).

## Goal

Add a safe, deterministic SQLite FTS5-backed memory retrieval path for existing NPC
and room memory records so long-session contexts can retrieve keyword-relevant
memories without expanding prompt size or scanning every record.

The feature is a **retrieval aid only**:

- SQLite/current state plus the append-only event log remain authoritative.
- Memory remains supporting context only, never truth.
- FTS is an internal index over already-accepted memory records; it does not create,
  mutate, validate, or promote memories.
- Existing `recall(...)` behavior remains unchanged unless a caller explicitly uses
  the new search path.

## 1. Current relevant state

- `NpcMemoryService.recall(scope)` and `RoomMemoryService.recall(scope)` currently:
  1. call the scoped store read (`listForNpc` / `listForRoom`),
  2. re-filter by exact scope in the read firewall, and
  3. call the existing bounded selectors (`selectRecallMemories` /
     `selectRecallRoomMemories`) that sort by `seq` desc, then `memoryId`, and cap
     cumulative text length.
- `SqliteNpcMemoryStore` and `SqliteRoomMemoryStore` persist immutable memory rows in
  base tables with indexed scope columns and a `memory_json` blob. Migration `0004`
  adds a nullable `dedupe_key` column and non-unique lookup indexes.
- `domain/memory/ranking.ts` already provides a pure additive ranker over
  already-recalled records. This slice does **not** need to change or wire that
  ranker.
- Long-session memory evaluation has already proven a retrieval plateau under the
  current deterministic seq-desc recall path. This feature targets that future
  retrieval gap without changing memory writes or authority.

## 2. In scope

### 2.1 Pure query and text-search utilities

Add a small pure module, tentatively:

- `apps/web/src/domain/memory/textSearch.ts`
- `apps/web/src/domain/memory/textSearch.test.ts`

Responsibilities:

- `normalizeMemorySearchQuery(raw)`:
  - accepts an untrusted raw search string,
  - replaces control characters with spaces,
  - extracts safe word tokens only,
  - lowercases / normalizes consistently,
  - de-duplicates while preserving first-seen order,
  - caps token count and token length,
  - returns `null` / empty result for blank or fully-disallowed input.
- `selectTextSearchMemories(records, tokens, { limit, maxChars })`:
  - deterministic, pure, no mutation,
  - scores only by lexical token matches over memory `text`,
  - tie-breaks by `seq` desc, then `memoryId` asc,
  - applies the same kind of `limit` + cumulative `text.length` cap as existing
    recall selectors,
  - exports no `WorldCommand` / `WorldEvent` producer and has no path to truth.

This module is deliberately independent of SQLite. SQLite FTS is candidate
retrieval; this pure selector is the final deterministic ordering/cap authority for
this feature.

### 2.2 Store-port search methods

Add explicit search methods instead of changing existing recall behavior:

- `NpcMemoryStore.searchForNpc(scope, { tokens, candidateLimit })`
- `RoomMemoryStore.searchForRoom(scope, { tokens, candidateLimit })`

The existing methods remain:

- `record(...)`
- `listForNpc(...)`
- `listForRoom(...)`

The new search methods must be scoped by the exact same triples:

- NPC: `(worldId, sessionId, npcId)`
- Room: `(worldId, sessionId, roomId)`

They return candidate records only. Services still apply read-firewall filtering and
the pure search selector before returning results.

### 2.3 Service-level explicit search methods

Add explicit service APIs:

- `NpcMemoryService.search(scope, { query, limit?, maxChars?, candidateLimit? })`
- `RoomMemoryService.search(scope, { query, limit?, maxChars?, candidateLimit? })`

Rules:

- `recall(...)` remains byte-for-byte behaviorally unchanged.
- Empty/invalid normalized query returns an empty search result, not an implicit
  fallback to seq-desc recall. A future caller may choose fallback policy explicitly.
- Services log only safe counts/enums/codes: token count, candidate count, returned
  count, and empty-query/fallback status. They must never log raw query text or memory
  text.

### 2.4 SQLite FTS5 migration

Add a forward-only migration, tentatively:

- `apps/web/src/persistence/migrations/0005_memory_fts.ts`
- register as `{ version: 5, name: 'memory_fts', up: up0005 }`

Proposed FTS tables:

```sql
CREATE VIRTUAL TABLE npc_memory_fts USING fts5(
  memory_id UNINDEXED,
  world_id UNINDEXED,
  session_id UNINDEXED,
  npc_id UNINDEXED,
  text,
  tokenize = 'unicode61'
);

CREATE VIRTUAL TABLE room_memory_fts USING fts5(
  memory_id UNINDEXED,
  world_id UNINDEXED,
  session_id UNINDEXED,
  room_id UNINDEXED,
  text,
  tokenize = 'unicode61'
);
```

Migration behavior:

- Create FTS tables only. Do **not** alter existing base memory columns.
- Backfill existing rows by reading `memory_json`, parsing in TypeScript, extracting
  `text`, and inserting into the FTS tables.
- Invalid/corrupt `memory_json` rows are skipped during backfill, matching the existing
  read-boundary policy that corrupt stored memories are expected content failures and
  never block recall.
- No memory `schemaVersion` bump.
- No rewrite of `memory_json`.
- No `SaveGame`, `RoomSpec`, `WorldState`, or event schema change.

FTS5 availability gate:

- Implementation must begin with a targeted migration/SQLite test proving the current
  Node SQLite runtime supports `CREATE VIRTUAL TABLE ... USING fts5`.
- If FTS5 is unavailable in the supported runtime, stop and return for design review;
  do not silently replace this feature with broad `LIKE` scans.

### 2.5 SQLite adapter maintenance and search

Update:

- `SqliteNpcMemoryStore`
- `SqliteRoomMemoryStore`

Indexing rule:

- On a new successful non-deduplicated memory insert, add an FTS row for the same
  memory.
- A deduplicated write must not add a duplicate FTS row.
- FTS indexing is a retrieval index only. A failure to index should be logged as a
  safe diagnostic code with ids/counts only and must not create any world-state,
  event-log, or gameplay side effect. The implementation can either keep the index
  insert in the existing transaction or make it best-effort after the base insert;
  the final implementation must document and test the chosen behavior before review.

Search rule:

- Build an FTS `MATCH` expression only from sanitized tokens, using parameter binding.
- Filter by exact scope columns in SQL.
- Join back to the base memory table and parse `memory_json` through the same existing
  read-boundary schema path.
- Re-assert parsed JSON scope against the queried scope, as today.
- Missing/corrupt/mismatched rows are skipped and logged with ids/codes only.
- Return bounded candidates to the service; the service applies final deterministic
  ordering and char-cap through `selectTextSearchMemories`.

### 2.6 In-memory adapter parity

Update:

- `InMemoryNpcMemoryStore`
- `InMemoryRoomMemoryStore`

The in-memory adapters should implement the same port methods using the pure token
matching utilities. This keeps tests deterministic and avoids making SQLite the only
code path capable of exercising search behavior.

## 3. Explicit non-goals

This slice must **not**:

- Add UI, debug UI, or room-memory viewer behavior.
- Touch `App.tsx`, `RoomViewer`, renderer files, `NPCDialoguePanel`, PromptBar, quest
  UI, journal UI, or save/load UI.
- Add API endpoints, browser→Node persistence wiring, CORS/client code, or server-side
  provider routing.
- Change provider selection, LLM prompts, real/fake room generation, NPC dialogue
  provider behavior, or call a hidden provider.
- Add vector DB, embeddings, graph DB, reranker service, background summarizer, or
  external dependency.
- Change `WorldEvent`, `WorldState`, `WorldSession`, reducers, event-log authority, or
  gameplay outcome rules.
- Add memory writes, memory mutation, update/delete/forgetting, decay, or event
  promotion.
- Weaken the memory firewall, scoping, provenance, confidence, authority, or
  cross-world/session/NPC/room leak protections.
- Log raw memory text, raw query text, player lines, NPC/room display names, generated
  content, provider request/response bodies, API keys, or PII.

## 4. Safety and authority boundaries

| Boundary | Required behavior |
| --- | --- |
| Authority | SQLite/current state + append-only event log remain truth. FTS results are recall candidates only. |
| Memory firewall | Existing write/read firewalls remain in place; new search results are still re-filtered by exact scope. |
| Scope | NPC search is exact `(worldId, sessionId, npcId)`; room search is exact `(worldId, sessionId, roomId)`. |
| Prompt/provider | No prompt construction, prompt injection, provider call, provider fallback, or LLM behavior change. |
| Logging | Only token counts, candidate counts, result counts, ids, and stable codes. No raw query or memory text. |
| Browser | Browser remains free of `persistence/**`, `server/**`, and SQLite access. |
| Determinism | Query normalization, candidate cap, final ranking, and tie-breaks are deterministic and test-covered. |

## 5. Failure and degradation behavior

| Situation | Handling |
| --- | --- |
| Empty / invalid query | Return empty search result; do not call FTS. |
| Query contains FTS operators, quotes, punctuation, or control chars | Normalize to safe tokens only; operators do not survive. |
| No matching FTS candidates | Return `[]`; caller may decide whether to fall back to existing recall. |
| Corrupt base `memory_json` after FTS hit | Skip that row; log id + `invalid-stored-memory` code only. |
| Cross-scope FTS row exists due to corruption | SQL scope filter plus JSON scope re-assertion prevents leak; row is skipped if mismatch. |
| FTS table missing/corrupt at runtime | Search degrades to empty/typed failure per implementation decision; base memory writes and existing recall must remain safe. |
| FTS indexing failure on write | Does not mutate truth; logs code/counts only. Implementation must decide transactional vs best-effort and test it. |
| Migration failure | `runMigrations` transaction rolls back and fails fast, matching existing migration behavior. |

## 6. Recommended implementation slices after approval

1. **Slice A — pure text-search domain utilities.**
   Add `textSearch.ts` + tests only. No store/service/persistence changes.
2. **Slice B — port/service/in-memory search path.**
   Add explicit `search(...)` APIs and in-memory parity. Existing `recall(...)` stays
   unchanged.
3. **Slice C — SQLite FTS migration and backfill.**
   Add `0005_memory_fts.ts`, register it, and add migration tests including FTS5
   availability and old-row backfill.
4. **Slice D — SQLite adapter indexing/search.**
   Wire `Sqlite*MemoryStore.search*` and new-row FTS maintenance. Keep read-boundary
   validation and scope re-assertion.
5. **Slice E — evaluation/docs closeout.**
   Add/extend long-session retrieval tests for keyword search, document the ADR, and
   update architecture status only after implementation is accepted.

Every slice should keep `npm run build`, `npm run lint`, and targeted tests green from
`apps/web`.

## 7. Tests to add/update

- **Pure query normalization:** strips control chars/operators; caps token count and
  length; dedupes; empty/invalid input returns empty; no mutation.
- **Pure text-search selection:** lexical matches rank above non-matches; more matched
  tokens rank higher; tie-break is `seq` desc then `memoryId` asc; limit and char cap
  hold; deterministic across repeated calls and input permutations.
- **Store-port parity:** in-memory NPC and room stores return only same-scope
  candidates and never cross world/session/NPC/room.
- **Services:** `recall(...)` behavior unchanged; `search(...)` handles empty query,
  candidate cap, char cap, and safe logging.
- **Migration:** `0005` creates both FTS tables; rerunning migrations is a no-op;
  existing pre-FTS memory rows are backfilled; corrupt memory JSON is skipped without
  leaking text.
- **SQLite search:** search returns only scoped records; malformed/stale FTS rows cannot
  leak across scope; missing/corrupt joined base rows are skipped; no raw memory text
  appears in logs.
- **Insert maintenance:** new non-deduplicated records become searchable; deduplicated
  records do not duplicate FTS rows.
- **Long-session retrieval evaluation:** planted keyword memories are found within the
  bounded candidate/result window after many irrelevant memories; prompt/retrieval cap
  stays fixed.
- **Boundary checks:** no imports from browser/UI/renderer/app/provider paths; no
  changes to `WorldEvent`, `WorldState`, `SaveGame`, `RoomSpec`, provider selection, or
  LLM prompt builders.

## 8. Verification commands

From `apps/web`:

```bash
npm run test -- textSearch
npm run test -- memory
npm run test -- fts
npm run test -- evaluation
npm run lint
npm run build
```

Report actual results honestly. Do not claim broad manual gameplay verification unless
it is actually run.

## 9. Files likely to change after approval

Expected implementation files:

- `apps/web/src/domain/memory/textSearch.ts` — new pure query/search selector module.
- `apps/web/src/domain/memory/textSearch.test.ts` — new deterministic tests.
- `apps/web/src/domain/ports/NpcMemoryStore.ts` — additive search method.
- `apps/web/src/domain/ports/RoomMemoryStore.ts` — additive search method.
- `apps/web/src/memory/NpcMemoryService.ts` — explicit `search(...)`, existing
  `recall(...)` unchanged.
- `apps/web/src/memory/RoomMemoryService.ts` — explicit `search(...)`, existing
  `recall(...)` unchanged.
- `apps/web/src/memory/InMemoryNpcMemoryStore.ts` — in-memory search parity.
- `apps/web/src/memory/InMemoryRoomMemoryStore.ts` — in-memory search parity.
- `apps/web/src/persistence/migrations/0005_memory_fts.ts` — new FTS table migration.
- `apps/web/src/persistence/migrations/index.ts` — register migration 5.
- `apps/web/src/persistence/SqliteNpcMemoryStore.ts` — FTS maintenance/search.
- `apps/web/src/persistence/SqliteRoomMemoryStore.ts` — FTS maintenance/search.
- Focused tests beside the existing memory/persistence/evaluation tests.
- After implementation review only: ADR and `ARCHITECTURE.md` status closeout.

Deliberately not expected:

- `apps/web/src/App.tsx`
- `apps/web/src/RoomViewer.tsx`
- `apps/web/src/renderer/**`
- `apps/web/src/renderer/ui/**`
- `apps/web/src/dialogue/**`
- `apps/web/src/generation/**`
- `apps/web/src/server/**`
- `apps/web/src/domain/world/**`
- save/load schema files
- provider config / env files
- `package.json`

## 10. Minimum Safe Change Check

- **Existing code reused:** current NPC/room memory scopes, read firewalls,
  `memory_json` read-boundary parsing, logger redaction rules, migration runner,
  SQLite stores, in-memory stores, and deterministic selector conventions.
- **Minimum new code needed:** one pure text-search module, additive port/service
  methods, one forward-only FTS migration, SQLite/in-memory adapter search support,
  and focused tests.
- **Safety boundaries unchanged:** no memory→truth path, no event-log mutation, no
  `WorldState` mutation, no UI/API/provider/browser wiring, no raw memory/query logs,
  no schemaVersion bump, no external vector/graph dependency.
- **Tests prove it:** query normalization, deterministic ranking/caps, scoped search,
  migration/backfill, SQLite read-boundary safety, no duplicate FTS rows for
  deduped memories, and long-session retrieval improvement.

## 11. Review questions before implementation

1. **Index maintenance policy:** should SQLite FTS insertion be inside the same
   transaction as the base memory insert, or best-effort after the base insert so FTS
   failures never reject a memory write? Recommended default: best-effort, because FTS
   is a recall aid and base memory remains authoritative for memory records.
2. **Service shape:** approve the explicit `search(...)` methods, leaving existing
   `recall(...)` unchanged, or prefer extending `recall(...)` with an optional query?
   Recommended default: explicit `search(...)` for lowest behavior risk.
3. **Backfill:** approve migration-time TypeScript JSON parsing/backfill of existing
   memory rows into FTS, or defer old-row indexing to an explicit rebuild helper?
   Recommended default: migration-time backfill, skipping invalid stored memory rows.
