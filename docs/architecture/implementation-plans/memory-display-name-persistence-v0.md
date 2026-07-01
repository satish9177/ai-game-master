# Implementation Plan — `feature/memory-display-name-persistence-v0`

> Status: **C1, C2 & C3 implemented & verified.** C1/C2 shipped optional additive fields
> end-to-end + `DisplayNameResolver`/named text/`entitySnapshots` (no DDL, `schemaVersion`
> kept `1`). **C3** adds migration `0004` (nullable `dedupe_key` column + non-unique index
> on both memory tables, `schemaVersion` still `1`) plus a pre-check SQLite/in-memory
> dedupe path: a repeated `dedupeKey` returns the original record with
> `deduplicated:true` instead of inserting a new row. The promotion mapper's `input` now
> carries `importance`/`dedupeKey` (not just the top-level `PromotedMemory` fields), so a
> promoted draft dedupes end-to-end when passed straight into `remember`/
> `validateRoomMemoryDraft`.
>
> **This is Slice C** of the reconciled adoption of the external *Memory & DB Design
> v1* doc: **DisplayNameResolver + named memory text + persisted importance/dedupe.**
> It is the first **gated, schema-touching** memory slice — it adds **one** small,
> additive, forward-only SQLite migration. It stays **headless and unwired** (no
> gameplay/dialogue wiring) and keeps SQLite truth + the memory firewall intact.
>
> Pre-demo, like Slices A/B: it does **not** replace the locked six-slice memory demo
> (design doc §28).
>
> Companion docs: [ARCHITECTURE](../ARCHITECTURE.md) · [BOUNDARIES](../BOUNDARIES.md) ·
> [FAILURE-MODES](../FAILURE-MODES.md) · [CONVENTIONS](../CONVENTIONS.md). Builds on:
> `npc-memory-persistence-v0` ([ADR-0024](../decisions/ADR-0024-npc-memory-persistence-v0.md)),
> `living-world-room-memory-v0` ([ADR-0025](../decisions/ADR-0025-living-world-room-memory-v0.md)),
> `memory-event-promotion-v0` (Slice A), `memory-context-ranking-v0` (Slice B).

## Goal

Make promoted memories **readable** and **deterministically de-duplicated**, and
let the Slice B ranker use **real** importance instead of the kind proxy:

1. **DisplayNameResolver** — a pure domain resolver mapping entity ids → display
   names over an injected neutral snapshot lookup (no `WorldSession`).
2. **Named memory text + entity snapshots** — the promotion mapper, when given a
   resolver, emits human-readable text (e.g. *"The Old Library changed in a lasting
   way."*) and stores `entitySnapshots` so old memories stay readable if names
   change. Generic id-free text remains the fallback when no resolver is supplied.
3. **Persisted importance + dedupe key** — `importance` and `dedupeKey` (already
   computed in Slice A) are persisted, so the ranker reads true importance and the
   store rejects re-promotion of the same committed event (true cross-restart
   idempotency).

## 1. Current state (what this builds on)

- **Records** (`domain/memory/contracts.ts`, `roomContracts.ts`): strict zod objects
  with `schemaVersion: z.literal(1)`, scope, `kind`, `text` (≤280, inert),
  `provenance`, `confidence`, `seq`, `createdAt`. `NpcMemoryInsert = Omit<…,'seq'>`.
- **Storage** (`SqliteNpcMemoryStore`, `SqliteRoomMemoryStore`): indexed scope columns
  **plus a `memory_json` blob** that is `JSON.stringify(record)`. The read boundary
  `JSON.parse` → `*MemoryRecordSchema.safeParse` and **skips** any row that fails as
  `invalid-stored-memory`. A BEFORE UPDATE trigger makes rows immutable.
- **Migrations** (`persistence/migrations/`): forward-only, numbered `0001`–`0003`,
  registered in `index.ts`; `runMigrations` applies each `up` + its
  `schema_migrations` insert in one transaction (rolls back on failure).
- **Promotion** (Slice A, `domain/memory/promotion.ts`): computes `importance` +
  `dedupeKey` (event-identity idempotency key) and emits a `RoomMemoryDraftInput`,
  but neither importance nor dedupeKey is persisted yet.
- **Ranking** (Slice B, `domain/memory/ranking.ts`): uses `record.importance` when
  present, else a kind proxy. **Already forward-compatible** — persisting importance
  needs no ranker change.

## 2. The migration-safety decision (key call)

**Keep the record `schemaVersion` at `1`; add only OPTIONAL additive fields.** The
read boundary parses every stored row against `z.literal(1)`. Bumping to `2` would
make **every existing v1 row fail `safeParse` and be silently skipped — data loss** —
unless a migration rewrites every `memory_json` blob (large, risky, touches all
rows). Additive optional fields avoid that entirely: old rows (lacking the fields)
still parse; new rows carry them. This is strictly smaller and safer than a version
bump, and supersedes the loose "schemaVersion v2" wording in earlier slice notes.

Consequence: **only one DDL change is needed** — a nullable `dedupe_key` column +
index for the dedupe existence check. `importance` and `entitySnapshots` ride inside
the existing `memory_json` blob and need **no DDL**.

## 3. In scope

| Area | Change (all additive) |
| --- | --- |
| `domain/memory/contracts.ts` · `roomContracts.ts` | Add optional `importance?` (int 0–5), `dedupeKey?` (bounded string), `entitySnapshots?` (bounded `Record<string,{id,displayName}>`). `schemaVersion` stays `1`; objects stay `.strict()`. |
| `domain/memory/firewall.ts` · `roomFirewall.ts` | Extend `*DraftInput`/`*Draft` + `validate*Draft` to bound + pass through the three fields; new reject reasons `invalid-importance` / `invalid-dedupe-key` / `invalid-entity-snapshots`. Still pure; still exports no event/command producer. |
| `domain/memory/displayNames.ts` (**new**) | Pure `DisplayNameResolver` (interface + map-backed impl) + a helper to resolve a name (safe generic fallback for unknown ids — never leaks a raw id into text) and build `entitySnapshots`. No `WorldSession`. |
| `domain/memory/promotion.ts` | Set `importance` + `dedupeKey` on the emitted draft; when `ctx.displayNames` is supplied, emit named text + `entitySnapshots` (room name for the current durable room-state event); else keep the Slice A generic text. |
| `src/memory/NpcMemoryService.ts` · `RoomMemoryService.ts` | Carry the three fields from draft → insert; add a `{ status:'deduplicated'; record }` result. |
| `domain/ports/NpcMemoryStore.ts` · `RoomMemoryStore.ts` | Add optional `deduplicated?: boolean` to the `ok:true` write result (additive). |
| `src/memory/InMemoryNpcMemoryStore.ts` · `InMemoryRoomMemoryStore.ts` | Dedupe pre-check by `(scope, dedupeKey)`; additive fields already flow via `structuredClone`. |
| `persistence/SqliteNpcMemoryStore.ts` · `SqliteRoomMemoryStore.ts` | Write `dedupe_key` column; pre-check existence by `(session_id, npc_id/room_id, dedupe_key)` inside the txn → idempotent return. `memory_json` carries importance/snapshots automatically. Read boundary unchanged. |
| `persistence/migrations/0004_memory_dedupe_key.ts` (**new**) + `index.ts` | `ALTER TABLE … ADD COLUMN dedupe_key TEXT` + `CREATE INDEX …(session_id, npc_id/room_id, dedupe_key)` for both memory tables. Register as `{version:4,name:'memory_dedupe_key'}`. |

## 4. Out of scope (explicit)

- **No `schemaVersion` bump** (kept `1`); no rewrite/backfill of existing rows.
- **No** Chroma, FTS5, `event_visibility`, new `WorldEvent` type, or any
  dialogue/gameplay/browser wiring (the resolver is **not** fed real names yet —
  that is a later wiring slice).
- **No** DB-level `UNIQUE` dedupe constraint (a pre-check is used; a partial unique
  index is noted only as optional defense-in-depth).
- **No** delete/forgetting, **no** semantic/similarity dedupe beyond the exact
  `dedupeKey`, **no** ranker change (Slice B auto-uses persisted importance).
- **No** new dependency.

## 5. Design details

### 5.1 Dedupe (the only behavioural change at the store)

- `dedupeKey` is the Slice A event-identity key, persisted in a **nullable** column.
  On `record(input)`, if `input.dedupeKey` is set, the store first does
  `SELECT memory_json FROM … WHERE session_id=? AND npc_id=? AND dedupe_key=?`
  (inside the existing transaction). A hit → return the existing parsed record with
  `deduplicated:true` and insert nothing (idempotent). A miss → insert as today, also
  writing `dedupe_key`. Inputs without a `dedupeKey` behave exactly as today.
- **Pre-check, not `UNIQUE`.** This mirrors the established `sessionExists` pre-check
  and avoids conflating a dedupe hit with the existing `conflict` (concurrent-seq)
  mapping in `isUniqueViolation`. A partial unique index
  (`… WHERE dedupe_key IS NOT NULL`) is an optional later hardening, but would require
  distinguishing the two unique violations — deferred.

### 5.2 DisplayNameResolver

```ts
export interface DisplayNameResolver {
  // returns a display name for an entity id within a kind namespace (room/npc/item/quest),
  // or a safe generic fallback label — never the raw id.
  resolve(kind: string, id: string): { id: string; displayName: string }
}
```
A pure map-backed implementation over an injected `Record<kind, Record<id, name>>`.
It lives in `domain/memory`, imports no `world-session`/platform, and is fed snapshot
data by a future composition root (out of scope here). `entitySnapshots` is built
from the resolved entities so a memory stays readable even if names later change.

### 5.3 Named text (Slice A's promotable event)

The only event Slice A promotes is a durable `room-state-changed`, whose sole entity
is the room. With a resolver, text becomes e.g. *"The {Room Name} changed in a lasting
way."* and `entitySnapshots = { room: { id, displayName } }`. Richer named text
(items/NPCs) arrives with richer events in a later slice. Without a resolver, the
generic Slice A text is unchanged.

## 6. Recommended sub-slices (isolate the migration)

1. **C1 — additive fields end-to-end, no DDL.** Contracts + firewall + services +
   in-memory dedupe + promotion sets `importance`/`dedupeKey` (generic text). SQLite
   stores persist importance/snapshots **in `memory_json`** (no column yet). Ships
   value (persisted importance → ranker) with zero migration risk.
2. **C2 — DisplayNameResolver + named text + entitySnapshots.** Pure domain + promotion
   uses the resolver optionally; generic fallback preserved. No DDL.
3. **C3 — migration `0004` + SQLite dedupe pre-check (gated DDL).** The isolated,
   reviewable schema change that turns on cross-restart dedupe at the SQLite store.

Each sub-slice leaves `build`/`lint`/`test` green and is committed manually.

## 7. Tests

- **Contracts:** new optional fields parse and round-trip; bounds enforced (importance
  0–5 int, dedupeKey length, snapshot count/length); `.strict()` still rejects unknown
  keys; **a v1 row WITHOUT the new fields still parses** (back-compat).
- **Firewall:** validates/bounds the three fields and passes them through; each new
  reject reason fires; absent fields are accepted; purity/no-mutation.
- **DisplayNameResolver:** resolves known ids; unknown id → safe generic fallback
  (asserts the raw id never appears in the output name); pure.
- **Promotion:** with a resolver → named text + `entitySnapshots`, importance +
  dedupeKey set; without a resolver → generic text but still importance/dedupeKey;
  text stays ≤280 and free of raw ids.
- **In-memory + SQLite stores:** same `dedupeKey` re-recorded → one row, second call
  returns `deduplicated:true` with the original record; different dedupeKeys → two
  rows; `null`/absent dedupeKey → today's behaviour; importance/snapshots survive a
  write→read round-trip.
- **Migration (`migrations.test.ts`):** `0004` adds `dedupe_key` + index to both
  tables; re-running migrations is a no-op; a pre-`0004` row (NULL dedupe_key,
  fieldless JSON) still recalls after migration (**no data loss**).
- **Ranking integration:** a record with persisted `importance` ranks by it (proxy
  bypassed) — reuses the existing Slice B suite, no ranker change.
- **Log-safety:** display names / memory text / snapshots are never logged (only
  ids/seq/codes), consistent with ADR-0024/0025.

## 8. Failure, rollback & migration behavior

- **Migration failure:** `runMigrations` applies `0004` + its `schema_migrations`
  insert in one transaction → a mid-failure rolls back wholly, records nothing, leaves
  the DB at v3, and rethrows (fail-fast, FAILURE-MODES case 6).
- **Old rows after `0004`:** `dedupe_key` is `NULL` and their JSON lacks the new
  fields → they still parse and recall; they simply don't dedupe and rank via the kind
  proxy. **No data loss; no backfill** (the immutability trigger forbids UPDATE and a
  backfill is unnecessary).
- **Additive nullable column** is backward-compatible with prior app code (its INSERT
  omits `dedupe_key`; SQLite fills `NULL`).
- **App-downgrade caveat (honest):** because records are `.strict()`, if the
  application is rolled back **after** new rows are written, the old strict schema
  would reject the new `memory_json` keys and **skip** those new rows on read (recall
  degrades, truth is untouched). The DB migration itself is safe; only an app
  downgrade past new writes has this effect. Mitigation if needed: land the additive
  contract fields (C1) before writing any, or relax `.strict()` to passthrough on read
  (not proposed here).
- **Firewall/truth intact:** memory still has no write path to truth; the new fields
  are inert metadata; `confidence` stays informational.

## 9. Minimum Safe Change Check

- **Reused:** the `memory_json` blob pattern (importance/snapshots need no DDL); the
  `sessionExists` pre-check pattern (reused for dedupe); the `seq`/immutability/
  read-boundary patterns; Slice A's `importance`/`dedupeKey`; Slice B's
  importance-aware ranker (unchanged).
- **Minimum new code:** one pure resolver module + one migration; the rest are small
  additive edits to existing files.
- **Boundaries unchanged:** memory firewall (no `world-session` import; no truth
  path), SQLite-as-truth, logging redaction, append-only world event log (untouched),
  renderer/browser bundle (untouched).
- **Tests prove it:** §7.

## 10. Verification (from `apps/web`)

```bash
npm run test -- memory        # contracts, firewall, promotion, ranking, stores
npm run test -- migrations    # 0004 + no-data-loss + idempotent re-run
npm run lint                  # firewall import boundary intact
npm run build                 # tsc + browser bundle (persistence stays Node-only)
```

## 11. Files added / changed

- **New:** `domain/memory/displayNames.ts` (+ test);
  `persistence/migrations/0004_memory_dedupe_key.ts`.
- **Edited (additive):** `domain/memory/{contracts,roomContracts,firewall,roomFirewall,
  promotion}.ts`; `domain/ports/{NpcMemoryStore,RoomMemoryStore}.ts`;
  `src/memory/{NpcMemoryService,RoomMemoryService,InMemoryNpcMemoryStore,
  InMemoryRoomMemoryStore}.ts`; `persistence/{SqliteNpcMemoryStore,SqliteRoomMemoryStore}.ts`;
  `persistence/migrations/index.ts` (register `0004`); co-located tests.
- **Deliberately NOT changed:** `domain/world/**`, `world-session/**`,
  `domain/memory/ranking.ts` (Slice B), `domain/dialogue/**`, `server/**`,
  `renderer/**`, `App.tsx`, `eslint.config.js`, `package.json`.

## 12. Open questions for approval

1. **entitySnapshots now or later?** Recommended **now** (cheap additive JSON field,
   future-proofs readability per design doc §13.2). Can be deferred to keep C smaller.
2. **Dedupe enforcement:** pre-check (recommended, smallest) vs. add a partial
   `UNIQUE` index as defense-in-depth (needs unique-violation disambiguation).
3. **Sub-slice cadence:** ship C1→C2→C3 as three commits (recommended), or fold into
   fewer.
