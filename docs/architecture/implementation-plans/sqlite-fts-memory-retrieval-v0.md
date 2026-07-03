# Implementation Plan — `feature/sqlite-fts-memory-retrieval-v0`

> Status: **COMPLETE for Slice 1 + Slice 2. Slice 3 remains GATED / deferred.**
>
> Headless, Node/SQLite-only, **additive full-text / keyword recall aid**. SQLite FTS5
> is a **lexical** index (token/keyword matching with a fixed tokenizer + BM25
> ranking) — it is **not** semantic/embedding retrieval and makes no similarity
> claims beyond shared tokens. Touches persistence + migrations + memory retrieval
> only. It does **not** change existing recall, does **not** wire into the
> browser/dialogue/UI, does **not** change authoritative state, and does **not**
> weaken the memory firewall or logging redaction.
>
> Companion docs: [ARCHITECTURE](../ARCHITECTURE.md) · [BOUNDARIES](../BOUNDARIES.md).
> Roadmap context: [ADR-0024 npc-memory-persistence-v0](../decisions/ADR-0024-npc-memory-persistence-v0.md),
> [ADR-0025 living-world-room-memory-v0](../decisions/ADR-0025-living-world-room-memory-v0.md),
> `memory-context-ranking-v0`,
> [ADR-0074 long-session-memory-evaluation-v0](../decisions/ADR-0074-long-session-memory-evaluation-v0.md)
> (Gate B / Risk 3 plateau this feature ultimately targets, via a later wiring slice).

## 0. Closeout status

- **Slice 1 complete:** migration `0005_memory_fts`, store-driven FTS indexing from
  validated `record.text`, SQLite search ports/adapters, base-table record reads, and
  persistence coverage for backfill, live indexing, scope isolation, deterministic
  ordering, tamper-skip, relevance-over-flood, unsafe-token robustness, and
  immutability.
- **Slice 2 complete:** optional `recallRelevant` support on NPC and room memory
  services, safe-token query construction via the branded FTS helper, unavailable
  result when no search store is injected, caller-owned fallback, scope re-filtering,
  and limit/maxChars caps while preserving FTS adapter order.
- **Slice 3 remains gated/deferred:** no UI, dialogue, browser, provider/LLM,
  gameplay, evaluation, `App.tsx`, `RoomViewer`, renderer, `WorldState`,
  `WorldEvent`, `SaveGame`, `RoomSpec`, or `QuestSpec` wiring has been added.
- Existing `recall()` behavior remains unchanged and continues to use the
  seq-desc recall selectors. `recallRelevant` is additive and optional.
- The Gate B plateau from ADR-0074 remains measured/unchanged until a later approved
  wiring/evaluation slice.
- Targeted verification during implementation/polish:
  `npm.cmd run test -- memoryFts`, `npm.cmd run test -- ftsQuery`,
  `npm.cmd run test -- memory`, `npm.cmd run test -- migrations`,
  and `npm.cmd run lint` passed in the relevant slices. Full feature-end
  verification remains a maintainer-controlled step.

## 1. Goal of the feature slice

Add a **deterministic, scope-hard-filtered, full-text (SQLite FTS5, lexical/keyword)
candidate retrieval** over already-persisted NPC and room memories, so a query can
surface the *keyword-relevant* memory that today's `seq`-desc + char-cap recall
cannot distinguish from same-kind/same-room flood (the documented **Gate B retrieval
plateau**, ADR-0074 §Risk 3). FTS5 matches **tokens**, not meaning; a later
semantic/embedding retrieval feature is explicitly out of scope.

FTS is a **recall aid only, never truth and never a record source**: it proposes an
*ordering over `memory_id`s that already exist in the authoritative base table*. The
record bytes returned to any caller still come from the existing base-table read +
firewall re-validation path. Existing `recall()` stays byte-identical and remains the
default.

This slice is **headless and test-only in v0**, exactly like the SQLite memory stores
it extends (ADR-0024/0025): no browser wiring, no dialogue integration, no UI.

## 2. Current relevant memory / persistence flow

- **Write:** `*MemoryService.remember` → `validate*MemoryDraft` (firewall:
  single-lines control chars, bounds length, enum-checks) → `store.record(insert)` →
  `Sqlite*MemoryStore` inserts one immutable row: indexed scope columns +
  `memory_json` blob + gapless per-scope `seq`. Base tables have a `BEFORE UPDATE`
  immutability trigger; DELETE is intentionally left open for a future eviction slice.
- **Read/recall:** `*MemoryService.recall(scope)` → `store.listFor{Npc,Room}` (scoped
  SQL `WHERE world_id=? AND session_id=? AND {npc,room}_id=? ORDER BY seq DESC
  LIMIT ?`) → `parseStoredMemory` re-validates each row **and re-asserts the scope
  triple from the JSON** (defense in depth; corrupt/mismatched rows skipped, recall
  never blocked) → `filter*MemoriesForScope` (pure re-filter) → `selectRecall*Memories`
  (sort `seq` desc, tie-break `memoryId` asc; take `limit`; cap cumulative
  `text.length` at `maxChars`). **No relevance/keyword scoring anywhere** — that is
  this slice's job, in a separate path.
- **Ranking:** `domain/memory/ranking.ts` (`rankMemories`) is a pure, additive
  re-orderer over already-recalled records; it is not wired and does no retrieval. FTS
  complements it: FTS finds *candidates by keyword*; `rankMemories` can later re-order
  them.
- **Migrations:** forward-only numbered list in `migrations/index.ts`; each `up(db)` +
  its `schema_migrations` insert run in one transaction. Latest is
  `0004_memory_dedupe_key`. Raw SQL lives only in migration/adapter files.
- **Ports:** `NpcMemoryStore` / `RoomMemoryStore` expose `record` +
  `listFor{Npc,Room}` only. In-memory adapters back the wired browser path; SQLite
  adapters are test-only in v0.

## 3. Proposed design

**FTS as a candidate index, not a record store.** Add one standalone FTS5 table per
memory type holding the searchable `text` plus the scope columns; the base tables
remain the sole source of record bytes.

> **Hard rule — MATCH is built only from normalized safe tokens.** A raw player/query
> string is **never** concatenated into, bound as, or otherwise used as an FTS5
> `MATCH` expression. The *only* value ever passed as the `MATCH` parameter is the
> output of the pure `buildMemorySearchQuery`, which tokenizes to `[A-Za-z0-9]+`,
> drops empties, quotes each token, and `OR`-joins them (empty ⇒ `null` ⇒ no query
> issued). This neutralizes every FTS5 operator/syntax character and makes the
> expression injection-proof and deterministic. The raw query string is also never
> logged (§9).

### 3a. Schema and population (migration `0005_memory_fts`)

Two FTS5 virtual tables:

```sql
CREATE VIRTUAL TABLE npc_memories_fts USING fts5(
  text,
  memory_id  UNINDEXED,
  world_id   UNINDEXED,
  session_id UNINDEXED,
  npc_id     UNINDEXED,
  tokenize = 'unicode61 remove_diacritics 2'
);
-- room_memories_fts: same, with room_id instead of npc_id
```

**Population policy — store-driven from the parsed `record.text` (decided).** There is
**no** `AFTER INSERT` trigger on the live write path. Each SQLite adapter's `record()`
method, **inside the same `withTransaction` as the base-row insert**, also inserts one
FTS row built from the already-validated in-memory `record`:

```sql
INSERT INTO npc_memories_fts(text, memory_id, world_id, session_id, npc_id)
VALUES (?, ?, ?, ?, ?)
-- record.text, record.memoryId, record.worldId, record.sessionId, record.npcId
```

**Why store-driven over trigger + `json_extract` (documented safety tradeoff):**

- **Single validated source.** The text indexed is the exact `record.text` the adapter
  is already serializing — the value produced by `validate*MemoryDraft` in the service,
  the *only* caller of `store.record`. No second text-extraction path
  (`json_extract($.text)`) is introduced on the live path, so there is one and only one
  place memory text is read for indexing.
- **Correct composition with existing dedupe/conflict.** On a dedupe hit no base row is
  inserted, so no FTS row is written (correct — the prior memory is already indexed).
  On a `conflict` rollback the FTS insert rolls back in the same transaction. A trigger
  would compose correctly too, but store-driven keeps this logic visible in the adapter
  next to the dedupe/conflict handling it already owns.
- **Tradeoff accepted.** This touches the two adapter `record()` methods (slightly more
  adapter code than a zero-touch trigger). That cost buys the "one firewall-validated
  source, no parallel JSON extraction" property, which is the safer story.

**One-time backfill (migration only).** Existing rows predate this change, so
`0005_memory_fts` performs a single controlled
`INSERT INTO …_fts SELECT json_extract(memory_json,'$.text'), memory_id, world_id,
session_id, {npc,room}_id FROM …` over **already-firewall-validated historical rows**.
`json_extract` appears **only** here, as a one-time backfill over trusted stored data —
never on the live write path.

Firewall guarantee this rests on: base-table inserts occur solely via the SQLite
adapter's `record()`, whose sole caller is `*MemoryService.remember` after
`validate*MemoryDraft`. Store-driven indexing inherits that guarantee directly (same
`record` object); it adds no new ingestion path that could bypass the firewall.

`schemaVersion` on memory records stays **1** (no record-shape change; `text` already
lives in `memory_json`). This migration adds only a derived index — the base
`npc_memories` / `room_memories` columns, `seq` semantics, dedupe index, and
immutability triggers are untouched.

### 3b. Retrieval path

1. A pure domain helper `buildMemorySearchQuery(rawTerms)` tokenizes the neutral input
   into `[A-Za-z0-9]+` terms, drops empties, quotes each, and joins with `OR` —
   producing a **safe, injection-proof, deterministic** FTS5 `MATCH` string. Empty /
   no-term input ⇒ `null` (⇒ empty result, no query run). The raw input string **never
   reaches SQL**; only this function's tokenized/escaped output is bound to `MATCH` (per
   the §3 hard rule). This neutralizes FTS5 operator characters
   (`" * ( ) AND OR NOT ^ :`).
2. A **new, SQLite-only search port + adapter method** runs:
   ```sql
   SELECT m.memory_id, m.memory_json
   FROM npc_memories_fts f
   JOIN npc_memories m ON m.memory_id = f.memory_id
   WHERE f.npc_memories_fts MATCH ?
     AND f.world_id=? AND f.session_id=? AND f.npc_id=?      -- scope hard-filter (index side)
     AND m.world_id=? AND m.session_id=? AND m.npc_id=?      -- scope hard-filter (base side)
   ORDER BY bm25(f) ASC, m.seq DESC, m.memory_id ASC         -- deterministic
   LIMIT ?
   ```
   then re-validates every `memory_json` through the **existing `parseStoredMemory`
   boundary** (schema re-parse **and** JSON-scope re-assertion). Result = authoritative
   base-table records in FTS-rank order. Record bytes come from the base table; FTS
   supplies only the candidate set + ordering.
3. A **new, additive service method** `recallRelevant(scope, query, options)` builds the
   safe query, calls the search adapter, applies the existing pure
   `filter*MemoriesForScope` (fourth-layer scope defense) and a bounded selection (reuse
   the `limit`/`maxChars` cap), and returns records. Existing `recall()` is unchanged.

### 3c. Scope isolation (four layers)

Every read is hard-filtered by the **exact** triple — NPC:
`worldId+sessionId+npcId`; Room: `worldId+sessionId+roomId` — at: (1) FTS UNINDEXED
columns, (2) base-table columns, (3) `parseStoredMemory` JSON re-assertion, (4)
`filter*MemoriesForScope`. No `MATCH`-only query is ever issued without all three scope
equalities. No cross-world/session/NPC/room path exists.

### 3d. Optional search dependency; browser/in-memory paths unaffected

- The SQLite-only search capability is a **separate port**
  (`Npc/RoomMemorySearchStore`, §15 Q1) implemented **only** by the SQLite adapters.
  The in-memory adapters do **not** implement it and are unchanged.
- `NpcMemoryService` / `RoomMemoryService` gain an **optional** constructor dependency
  `searchStore?: *MemorySearchStore`. Existing constructor params and `recall()` are
  unchanged; existing call sites that pass no search store compile and behave
  identically.
- `recallRelevant(scope, query, options)` behavior when **no** search store is injected:
  it returns a typed `{ status: 'unavailable', memories: [] }` — it **never throws,
  never falls back into `recall()`'s path, and never mutates anything.** The caller
  decides whether to call `recall()` instead.
- **Browser/in-memory path:** the wired browser composition constructs the services
  with **no** search store (as today), so `recallRelevant` is simply `unavailable`
  there and `recall()` is byte-identical to today. FTS is exercised only where the
  SQLite search store is injected — i.e., tests in v0.

## 4. Files likely to change

New:

- `apps/web/src/persistence/migrations/0005_memory_fts.ts` — FTS tables + one-time
  backfill.
- `apps/web/src/domain/memory/searchQuery.ts` (+ `.test.ts`) — pure
  `buildMemorySearchQuery` + FTS-term escaping.
- `apps/web/src/domain/ports/NpcMemorySearchStore.ts`,
  `RoomMemorySearchStore.ts` — new SQLite-only search ports (recommended; see §15 Q1).
- `apps/web/src/persistence/SqliteNpcMemorySearchStore.ts` /
  `SqliteRoomMemorySearchStore.ts` (or methods on the existing SQLite stores — §15 Q1)
  (+ tests).
- Tests: `apps/web/src/persistence/memoryFts.test.ts` (scope isolation, determinism,
  tamper-skip, injection-safety, relevance-over-flood).

Changed (additive only):

- `apps/web/src/persistence/migrations/index.ts` — append migration 5.
- `apps/web/src/persistence/SqliteNpcMemoryStore.ts`,
  `SqliteRoomMemoryStore.ts` — store-driven FTS insert inside the existing
  `record()` transaction (§3a).
- `apps/web/src/memory/NpcMemoryService.ts`, `RoomMemoryService.ts` — add
  `recallRelevant` (optional search dependency; `recall` untouched).
- Service tests — cover `recallRelevant` degradation and the `unavailable` case.

Deliberately **not** changed: base memory-table columns, `contracts.ts` /
`roomContracts.ts` record schemas, `firewall.ts` / `roomFirewall.ts` write path +
`selectRecall*`, `ranking.ts`, `App.tsx`, dialogue builders, renderer, `server/**`,
`eslint.config.js`, `package.json`, the long-session `evaluation/` suite (Gate B stays
measured this slice — §12).

## 5. Existing code to reuse

- `parseStoredMemory` (both SQLite stores) — the read-boundary schema re-parse + scope
  re-assertion. Reuse verbatim for FTS candidate re-validation (no weaker path).
- `filter*MemoriesForScope` + `selectRecall*Memories` (`roomFirewall.ts` /
  `firewall.ts`) — scope re-filter and bounded `limit`/`maxChars` cap, and the
  `seq`-desc → `memoryId`-asc tie-break convention (reused as the FTS tie-break).
- `withTransaction`, the migration runner, and the numbered-migration pattern
  (`db.ts`, `migrations/index.ts`).
- `json_extract` (SQLite built-in) for the **one-time backfill only** — no new
  dependency.
- The `MemoryScope` / `RoomMemoryScope` types and the store test harness /
  `createTestDb`.

## 6. Minimum new code needed

- 1 migration (2 FTS tables + one-time backfill).
- 1 pure query-builder module + test.
- 2 search ports + 2 SQLite adapter methods/classes + 1 persistence test file.
- Store-driven FTS insert in the 2 existing SQLite `record()` methods.
- 2 additive service methods + tests.

No new runtime dependency (FTS5 is in the bundled SQLite; `json_extract` is built-in).

## 7. Safety boundaries that remain unchanged

- **Firewall / no path to truth.** Search returns inert memory records only; the new
  modules export no `WorldCommand`/`WorldEvent`-producing function, take no
  `WorldSession`, and cannot touch `WorldState`/`roomStates`/the event log. Memory
  stays supporting context only.
- **Single validated ingestion source.** FTS text is indexed only from the
  firewall-validated `record.text` (live path) or the one-time backfill over already
  firewall-validated historical rows — no new unvalidated ingestion path (§3a).
- **MATCH from safe tokens only.** The §3 hard rule: raw query text never reaches SQL;
  only `buildMemorySearchQuery` output is bound to `MATCH`.
- **Existing recall.** `recall()`, `selectRecall*`, the write firewall, record schemas,
  and `schemaVersion=1` are byte-identical. `recallRelevant` is optional and separate.
- **Persistence Node-only / no browser SQLite.** New code lives under `persistence/**`
  + `domain/memory/**` + `memory/**`; the reciprocal lint walls keep `node:sqlite` /
  `**/persistence/**` out of the browser bundle. Nothing is wired into
  `App`/renderer/UI.
- **No provider / network / LLM.** FTS is local deterministic search; no hidden
  provider calls, no clock, no `Math.random`.
- **Persistence import rules.** Adapters import only `domain/memory` contracts +
  `node:sqlite` + Logger types — unchanged.

## 8. Failure / degradation behavior

| Situation | Handling |
| --- | --- |
| Empty / whitespace / all-punctuation query | `buildMemorySearchQuery` → `null` ⇒ no MATCH issued, returns `[]` |
| FTS5 special chars in query | escaped/quoted per-token; treated as literal tokens; never an injection or syntax error |
| No keyword match | returns `[]` (never throws) |
| Corrupt / scope-mismatched stored row among candidates | skipped by `parseStoredMemory` (logged `invalid-stored-memory`, id/code only); retrieval continues |
| FTS table missing/unavailable (e.g., pre-migration DB) | search adapter catches, logs a safe code, returns `[]`; caller falls back to existing `recall()` (retrieval is strictly additive — never worse than today) |
| `recallRelevant` called with **no** search store injected (browser/in-memory) | returns `{ status: 'unavailable', memories: [] }`; never throws, never touches `recall()` |
| Concurrency / immutability | base tables insert-only; FTS insert rides the same `record()` transaction; no update/delete path in v0 |

Recall is **never blocked** by FTS; the deterministic `seq`-desc recall remains the
always-available safety net.

## 9. Logging / redaction impact

No new content logging. The query text, matched text, memory `text`, terms, room/NPC
names, and player lines are **never** logged. The raw query string never reaches SQL
except as the tokenized/escaped `buildMemorySearchQuery` output bound to `MATCH`. New
log lines (service + adapter) carry only: scope ids
(`worldId`/`sessionId`/`npcId`|`roomId`), integer `matchCount`, and fixed diagnostic
codes (e.g., `fts-unavailable`, `invalid-stored-memory`). Redaction rules are
unchanged. (The `text` stored inside the FTS table is not a logging surface — it is the
same text already in `memory_json`, held inside Node-only SQLite.)

## 10. Schema / migration impact

- One additive, forward-only migration (`0005_memory_fts`): 2 FTS5 virtual tables + a
  one-time backfill of existing rows, all in the migration's single transaction. **No**
  live-path trigger (population is store-driven, §3a).
- Base `npc_memories` / `room_memories` columns, indexes, `seq`, dedupe index, and
  immutability triggers are unchanged.
- Memory record `schemaVersion` stays **1** (no record-shape change).
  `SaveGame`/`WorldState`/`RoomSpec`/`QuestSpec` untouched.
- Requires FTS5 in the SQLite build — **verified present** (`node:sqlite`, Node 24.16,
  SQLite 3.53.0). A migration-time guard can assert FTS5 availability and fail fast with
  a safe code if a future runtime lacks it.

## 11. Whether any authoritative state can change

**No.** FTS is a derived read-index over inert memory text. No `WorldEvent`,
`WorldCommand`, `WorldState`, `roomStates`, `SaveGame`, quest, inventory, or cost state
is created, read-for-mutation, or changed. Memory remains non-authoritative supporting
context. `source:'llm'` records still cannot apply state changes — nothing in this path
can.

## 12. Tests to add / update

Persistence (`memoryFts.test.ts`, over a temp DB, both memory types):

- **Scope isolation / no leak:** identical text planted in two worlds / two sessions /
  two NPCs / two rooms; querying one scope returns only that scope's records.
  Cross-world/session/NPC/room never appears.
- **Determinism:** same rows + same query ⇒ deep-equal ordered result across repeated
  calls and input-insert permutations that must tie identically.
- **Relevance-over-flood (new lexical path proof):** a keyword-distinct planted memory
  is retrieved above a same-kind/same-room/same-confidence flood that lacks the query
  tokens. This proves the **new lexical retrieval path** works; it asserts nothing about
  the wired browser ranker.
- **Tie-break:** equal `bm25` ⇒ `seq` desc → `memoryId` asc.
- **Injection / robustness:** queries containing `"`, `*`, `AND`, `NOT`, `(`, `:`,
  emoji, and pure punctuation never throw and never syntax-error; empty/whitespace ⇒
  `[]`. The value bound to `MATCH` is always `buildMemorySearchQuery` output.
- **Tamper-skip:** a corrupted `memory_json` or scope-mismatched candidate row is
  skipped, not leaked; retrieval still returns the valid rest.
- **Backfill:** rows inserted before the migration are searchable after it.
- **Immutability preserved:** base-table update still aborts.

Query builder (`searchQuery.test.ts`): tokenization, escaping, `null` on empty,
determinism, no mutation.

Service: `recallRelevant` returns scoped bounded records; returns
`{ status: 'unavailable', memories: [] }` when no search store is injected; degrades to
`[]` on empty/no-match/FTS-unavailable; `recall()` behavior unchanged (regression
guard).

**Existing long-session Gate B is NOT touched.** `relevance.eval.test.ts` / the
`evaluation/` suite and the documented `seq`-desc → `memoryId`-asc plateau (ADR-0074
Risk 3) **remain measured and unchanged** in this slice. The plateau is a property of
the *wired browser recall+ranker path*, which this headless slice does not alter.
Flipping it red-to-green is a later wiring/evaluation slice (Slice 3), because it
requires wiring FTS retrieval into that path and re-baselining the eval — out of scope
here.

## 13. Verification commands (from `apps/web`)

```bash
npm run test -- memoryFts        # new FTS persistence suite
npm run test -- searchQuery      # pure query builder
npm run test -- migrations       # migration runner incl. 0005 + backfill
npm run test -- memory           # existing memory + service suites (regression)
npm run lint                     # boundary/firewall/no-console walls
npm run build                    # typecheck + browser bundle stays SQLite-free
```

Report results honestly. The maintainer commits manually (agents do not commit).

## 14. Recommended implementation slices

1. **Slice 1 — index + search adapter (headless).** Migration `0005` (tables +
   backfill), store-driven FTS insert in the two SQLite `record()` methods, search
   port(s), SQLite adapter method(s) reusing `parseStoredMemory`, `memoryFts.test.ts`.
   No service/browser change beyond the store insert.
2. **Slice 2 — safe query + service method (headless).** `buildMemorySearchQuery`
   (+ test), `recallRelevant` on both services (+ tests, degradation, `unavailable`
   case). Still not wired.
3. **Slice 3 — GATED / separate approval.** Any wiring (dialogue context, flipping the
   existing Gate B plateau case to green, `rankMemories` composition, eval
   re-baselining). Explicitly out of this slice; requires its own plan/approval so
   existing recall and the eval suite stay stable here.

## 15. Open questions before implementation

- **Q1 — port shape (recommend A):** (A) new SQLite-only `*MemorySearchStore` ports so
  the base ports and in-memory browser adapters stay untouched; the service takes an
  optional `searchStore?`. (B) add a `search*` method to the existing store ports
  (forces in-memory stores to implement a non-FTS fallback). **A** is the smaller,
  cleaner change and keeps FTS strictly Node/SQLite-side (see §3d).
- **Q2 — RESOLVED (not open):** population is **store-driven from `record.text`**, with
  a one-time migration backfill via `json_extract` over historical firewall-validated
  rows. Tradeoff documented in §3a.
- **Q3 — tokenizer (recommend `unicode61 remove_diacritics 2`):** simple, deterministic,
  no stemming surprises. Alternative `porter` broadens recall but changes match
  semantics; confirm preference.
- **Q4 — degradation policy (recommend):** `recallRelevant` returns `[]` on
  empty/no-match and `{ status: 'unavailable', memories: [] }` when no search store is
  injected; on FTS error it logs a safe code and returns `[]`, and the **caller**
  decides to fall back to `recall()`. Do not silently blend FTS + `seq`-desc inside
  `recallRelevant`. Confirm.
- **Q5 — v0 stays headless/test-only (recommend yes):** mirror the SQLite memory stores
  — no browser/dialogue wiring in this slice, so existing recall is provably unchanged.
  Confirm.
- **Q6 — query source (deferred):** when eventually wired, is the query the player
  utterance, room/quest keywords, or NPC context? Deferred to the Slice 3 wiring plan.
- **Q7 — Gate B flip (recommend defer):** keep `long-session-memory-evaluation-v0`
  unchanged this slice; turning the documented plateau case green is a Slice 3
  deliverable. This slice adds FTS relevance proof only in the new persistence suite.
  Confirm.
- **Q8 — DELETE/eviction forward-compat:** v0 base tables are insert-only, so no FTS
  delete path is needed. Documented limitation: a future forgetting/eviction slice that
  adds DELETE **must** also remove the corresponding FTS row (or rebuild the index).
  Lean: defer + document (Minimum Safe Change); confirm rather than pre-build an AFTER
  DELETE path now.

## Minimum Safe Change Check

- **Reused:** `parseStoredMemory` re-validation + scope re-assertion,
  `filter*MemoriesForScope`, `selectRecall*` cap + tie-break, the migration/transaction
  pattern, `json_extract` (backfill only), existing scope types/test harness.
- **New code actually necessary:** 1 migration, 1 pure query builder, 2 search ports +
  adapters, store-driven FTS insert in 2 existing `record()` methods, 2 additive service
  methods, tests.
- **Safety boundaries unchanged:** firewall (no truth path), single firewall-validated
  ingestion source, MATCH-from-safe-tokens-only, existing recall/write path, record
  schemas + `schemaVersion=1`, Node-only persistence + browser SQLite exclusion, logging
  redaction, no provider/network.
- **Tests that prove it:** §12 (scope isolation/no-leak, determinism,
  relevance-over-flood, injection-safety, tamper-skip, backfill, immutability, recall
  regression, `unavailable` case).

## Review notes / risks

The boundary-shaping decisions are Q1 (separate search port), Q3 (tokenizer), Q4
(degradation returns `[]` / `unavailable`, caller owns fallback), Q5 (headless/test-only
v0), and Q7 (existing Gate B stays measured). The population decision (Q2) is resolved
to store-driven from the firewall-validated `record.text`, keeping a single validated
ingestion source. The one latent-bug watch item is Q8 (FTS staleness if a future DELETE
lands) — harmless in v0 (insert-only) but must be documented so the future eviction
slice does not forget it.
