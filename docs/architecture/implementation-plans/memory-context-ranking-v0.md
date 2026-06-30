# Implementation Plan — `feature/memory-context-ranking-v0`

> Status: **PROPOSED — awaiting maintainer approval. No code until approved.**
>
> **This is Slice B** of the reconciled adoption of the external *Memory & DB Design
> v1* doc — the **additive recall-ranking** core of ContextBuilder v0 (design doc
> §19, §22). It is **parallel-safe, headless, pure-domain**: one new pure module +
> its test, touching **no** schema, **no** event union, **no** authoritative state,
> and **no** gameplay/browser wiring. It does **not** weaken or replace the existing
> bounded recall selection — it ranks on top of it.
>
> Pre-demo, like Slice A: it prepares the context-builder seam only and does **not**
> replace the locked six-slice memory demo (design doc §28).
>
> Companion docs: [ARCHITECTURE](../ARCHITECTURE.md) · [BOUNDARIES](../BOUNDARIES.md) ·
> [CONVENTIONS](../CONVENTIONS.md). Roadmap context: `npc-memory-persistence-v0`
> ([ADR-0024](../decisions/ADR-0024-npc-memory-persistence-v0.md)),
> `living-world-room-memory-v0` ([ADR-0025](../decisions/ADR-0025-living-world-room-memory-v0.md)),
> `memory-event-promotion-v0` (Slice A).

## Goal

Add a **pure, deterministic relevance ranker** over already-recalled memory records:
given a set of records and a small neutral ranking query, return them ordered by a
configurable relevance score, with a stable, deterministic tie-break. This is the
scoring half of the design doc's ContextBuilder v0 (§19) — built so a future
context-builder can reorder recalled memories for a prompt — **without** changing
retrieval, truth, or browser behavior.

The ranker is **additive**: `NpcMemoryService.recall` / `RoomMemoryService.recall`
and their `selectRecall*` selectors (scope-filtered, `seq`-desc, char-capped) are
**unchanged** and remain the retrieval/cap authority. The ranker is a separate layer
a caller may apply to a recalled window.

## 1. Current relevant flow

- **Recall today** (`domain/memory/firewall.ts`, `roomFirewall.ts`;
  `src/memory/*Service.ts`). `recall(scope)` → store scoped query → pure
  `filterMemoriesForScope` (defense in depth) → `selectRecallMemories` (sort `seq`
  desc, tie-break `memoryId` asc; take `limit`; cap cumulative `text.length` at
  `maxChars`). The selectors explicitly do **no relevance scoring** — that is this
  slice's additive job, in a separate function.
- **Context building today** (`domain/dialogue/buildDialogueContext.ts`,
  `buildRoomDialogueContext.ts`). Pure domain builders assemble `NPCDialogueContext`
  from `WorldState`/room/quest — they **do not include memory**. Slice B does **not**
  modify them; memory→dialogue wiring is a later, separate slice.
- **Record fields available to rank on** (no new fields): `kind`, `confidence`
  (`low|medium|high`, informational-only today), `seq`, `provenance.source`,
  `provenance.roomId?` (on NPC records), `provenance.npcId?` (on room records),
  `provenance.turnIndex?`. **`importance` is not persisted** (Slice A computes it but
  stores nothing; persisting it is the gated Slice C).

## 2. Scope (locked for this slice)

In:

- `apps/web/src/domain/memory/ranking.ts` — pure ranker + weights + query/result
  types, generic over both NPC and room records.
- `apps/web/src/domain/memory/ranking.test.ts`.

Out (explicit non-goals):

- **No** schema/migration/`schemaVersion` change; **no** new column; **no** Chroma,
  FTS5, `event_visibility`, new `WorldEvent` type, or `DisplayNameResolver`.
- **No** change to `selectRecallMemories` / `selectRecallRoomMemories` / the firewalls
  / the services — the ranker does not weaken or replace recall selection.
- **No** wiring into `recall`, dialogue, `buildDialogueContext`, `App.tsx`, the
  renderer, or the browser. **No** authoritative-state or gameplay change.
- **No** new dependency; **no** logger (pure domain returns data).

## 3. The ranker

A single generic pure function over a minimal structural shape both record types
already satisfy (so one ranker serves NPC and room memories — mirroring how the two
firewalls stay parallel but share conventions):

```ts
export type RankConfidence = 'low' | 'medium' | 'high'

export interface RankableMemory {
  memoryId: string
  kind: string
  confidence: RankConfidence
  seq: number
  importance?: number  // forward-compat: undefined today (proxy from kind); Slice C persists it
  provenance: {
    source: string
    roomId?: string     // present on NPC records
    npcId?: string      // present on room records
    turnIndex?: number
  }
}

export type MemoryRankingQuery = {
  currentRoomId?: string      // same-room bonus (NPC records carry provenance.roomId)
  activeNpcId?: string        // same-NPC bonus (room records carry provenance.npcId)
  currentTurnIndex?: number   // recency-by-turn when turnIndex is present
  allowedKinds?: readonly string[]  // optional HARD filter (memory_type allow-list)
}

export type RankedMemory<T extends RankableMemory> = { record: T; score: number }

export const DEFAULT_MEMORY_RANKING_WEIGHTS = {
  importance: 10,   // × importance (0–5)
  confidence: 5,    // × confidence rank (low0/med1/high2)
  sameRoom: 10,
  sameNpc: 20,
  recency: 10,      // × recency factor (0–1)
} as const

export function rankMemories<T extends RankableMemory>(
  records: readonly T[],
  query?: MemoryRankingQuery,
  weights?: Partial<typeof DEFAULT_MEMORY_RANKING_WEIGHTS>,
): RankedMemory<T>[]
```

Behavior:

1. **Hard filter first (where fields allow).** If `query.allowedKinds` is given, drop
   records whose `kind` is not in it (design doc §19 "memory_type allowed"). Scope is
   **already** enforced by `recall`, so the ranker does not re-do scope filtering.
   Other §19 hard filters (expired, instruction-like, visibility, current-state
   invalidation) have **no backing fields yet** and are explicitly deferred.
2. **Score (deterministic, configurable).** For each surviving record:
   ```
   score = W.importance × importance
         + W.confidence × confidenceRank(confidence)   // low0 / med1 / high2
         + (sameRoom ? W.sameRoom : 0)                  // provenance.roomId === query.currentRoomId
         + (sameNpc  ? W.sameNpc  : 0)                  // provenance.npcId  === query.activeNpcId
         + W.recency × recencyFactor                    // from |currentTurnIndex − turnIndex|, else 0
   ```
   - **importance** uses `record.importance` when present, else a documented
     `kind → weight` proxy (forward-compatible: when Slice C persists importance, the
     proxy is simply bypassed — no ranker change).
   - **recencyFactor** is bounded `[0,1]`: `clamp(1 − Δturn / RECENCY_WINDOW)` when
     both `currentTurnIndex` and `provenance.turnIndex` exist; otherwise `0` (so
     `seq` influences order only via the tie-break, never as a clock).
   - Missing query fields simply contribute `0` — the ranker is total.
3. **Sort.** Score **descending**, then the existing tie-break: `seq` **descending**,
   then `memoryId` **ascending**. Fully deterministic and stable.
4. **No cap.** Returns the full ranked array; the char/limit cap stays
   `selectRecall*`'s job. A future ContextBuilder slices the top N.

Purity: copies before sorting; no input mutation; no `Date.now`/`Math.random`.

## 4. How it composes (intended, NOT wired here)

```
recall(scope)            // unchanged: scope filter + seq-desc + char cap
  → recalled records
  → rankMemories(recalled, query)   // NEW, additive: relevance order for the prompt
  → (future ContextBuilder) take top N, label non-authoritative
```

Slice B ships only `rankMemories`. No service, dialogue, or app calls it yet.

## 5. Boundaries / lint

- Lives under `domain/memory/**`, governed by the existing `src/domain/**` ESLint
  block (no React/Three/renderer/platform/persistence/server). The module is
  **standalone** (no imports from `world/**` or the services); the record types are
  imported only by the **test** to prove `NpcMemoryRecord`/`RoomMemoryRecord` satisfy
  `RankableMemory` structurally.
- **Firewall preserved.** `ranking.ts` consumes inert memory data and returns ranked
  data; it exports **no** `WorldCommand`/`WorldEvent`-producing function and has no
  path to truth. `confidence` stays informational — the ranker reading it for
  ordering does not make it authoritative.

## 6. Failure / degrade behavior

| Situation | Handling |
| --- | --- |
| Empty input | returns `[]` |
| No query / missing query fields | total — those terms contribute `0` |
| `allowedKinds` filters everything out | returns `[]` |
| Unknown `kind` (no proxy weight) | uses a neutral default importance weight |
| Equal scores | deterministic tie-break (`seq` desc, `memoryId` asc) |

Never throws; never mutates; memory remains supporting context only.

## 7. Test plan (Vitest, co-located, deterministic)

- **Ranking by each signal (all else equal):** higher `importance`/proxy, higher
  `confidence` (high > medium > low), same-room match, same-NPC match, and more-recent
  `turnIndex` each rank higher.
- **Hard filter:** `allowedKinds` drops disallowed kinds before scoring.
- **Tie-breaking:** equal scores → `seq` desc, then `memoryId` asc.
- **Determinism:** same input → deep-equal output; stable order across repeated calls
  and across input permutations that should sort identically.
- **No mutation:** frozen input array/records → no throw; original order/refs intact.
- **Works for both record shapes:** rank a `NpcMemoryRecord[]` (uses
  `provenance.roomId`) and a `RoomMemoryRecord[]` (uses `provenance.npcId`) —
  structural compatibility with `RankableMemory`.
- **Importance forward-compat:** a record with explicit `importance` uses it; a record
  without falls back to the `kind` proxy.
- **Additivity guard:** importing `selectRecallMemories`/`selectRecallRoomMemories` is
  not required and they are untouched (the ranker is independent).

## 8. Minimum Safe Change Check

- **Reused:** the `seq`-desc + `memoryId`-asc tie-break convention from the existing
  selectors; the `confidence` enum values and `provenance` shape already shipped; the
  weights pattern from design doc §19.
- **Minimum new code:** one pure module + its test. No edits elsewhere.
- **Safety boundaries unchanged:** recall selectors, firewalls, services, event union,
  all schemas/migrations, the memory firewall, logging rules, and the browser bundle.
  No authoritative state changes; no schema impact; no logging surface added.
- **Tests prove it:** §7.

## 9. Verification (from `apps/web`)

```bash
npm run test -- ranking     # the new pure ranker spec
npm run test -- memory      # confirm existing memory + promotion suites still pass
npm run lint                # confirms no boundary/firewall import was added
npm run build               # confirms typecheck + browser bundle unaffected
```

Report results honestly. The maintainer commits manually (agents do not commit).

## 10. Files added / changed

- **New:** `apps/web/src/domain/memory/ranking.ts`,
  `apps/web/src/domain/memory/ranking.test.ts`.
- **Deliberately NOT changed:** `domain/memory/{firewall,roomFirewall,contracts,
  roomContracts,promotion}.ts`, `src/memory/**`, `domain/dialogue/**`,
  `domain/world/**`, `world-session/**`, `persistence/**`, `server/**`, `renderer/**`,
  `App.tsx`, `eslint.config.js`, `package.json`.

## 11. Open question for approval

- **Importance proxy:** today there is no persisted `importance`, so the ranker either
  (a) derives a `kind → weight` proxy now (recommended; forward-compatible — auto-uses
  real `importance` once Slice C persists it), or (b) omits the importance term until
  Slice C. The plan above takes **(a)**. Confirm or switch to (b).
