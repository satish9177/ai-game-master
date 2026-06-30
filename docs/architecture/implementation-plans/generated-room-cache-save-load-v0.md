# Implementation Plan: Generated Room Cache Save/Load v0

> Feature branch: `feature/generated-room-cache-save-load-v0`
> ADR: [ADR-0060](../decisions/ADR-0060-generated-room-cache-save-load-v0.md)
> Status: **pending implementation**

## Overview

Parks an optional `GeneratedRoomCacheSaveState` blob alongside the existing
`saveGameJson` and `generatedQuestJson` in the local save slot. On Continue/Load, if the
blob is present and re-validates, rehydrates a multi-room `SessionRoomCache`, builds a
generated `AdjacentRoomPregenerator` and `NavigationService` over it, and seeds the
objective memo for all restored rooms — with no LLM call, no cost increment, no schema
change, and no regression to ADR-0059 current-room restore. Older saves and authored
sessions degrade safely.

**Key architectural fact:** the existing `resolvedObjectIds` and `shouldStartPerRoomObjectiveAttach`
semantics are unchanged. Restoring the correct object IDs (from the parked `RoomSpec`) plus
seeding the objective memo for restored room IDs is sufficient to make backtracking stable
and cost-free.

## Minimum Safe Change Check

| Question | Answer |
|---|---|
| What existing code is reused? | `RoomSpecSchema` (domain schema); `loadRoomSpec` (boundary); `SessionRoomCache`, `AdjacentRoomPregenerator`, `NavigationService` (composition layer); `themeVocabulary`, `FakeRoomGenerator` (generation); `resolvedObjectIdsForGeneratedPlay`, `PerRoomObjectiveMemo` (App.helpers); `SlotWrapper` optional-string pattern (saveSlotStore); existing `generatedQuestJson` sidecar pattern (ADR-0059) |
| What new code is actually necessary? | One domain schema + two pure functions (~70 lines); one slot-store field addition (~15 lines); one composition restore helper (~50 lines); one read-only accessor on `AdjacentRoomPregenerator` (~8 lines); targeted additions to `handleSave` and `handleLoad` in `App.tsx` (~40 lines) |
| What safety boundaries remain unchanged? | `SaveGame` schema + integrity check; world-session authority; event-log append-only rule; all `schemaVersion` fields; `evaluateQuest` + `resolvedObjectIds` call sites; cost/usage guardrail; renderer trust boundary; log discipline; ADR-0059 quest blob path |
| What targeted tests prove the change? | Round-trip domain tests; slot backward-compat tests; restore-helper unit tests; App navigation/save/load integration tests; safety sentinel assertions; cost-meter regression; no-generator-call assertion; stale-UI regression |

---

## Files

### New files

| File | Created in slice |
|---|---|
| `apps/web/src/domain/quests/generatedRoomCacheSaveState.ts` | Slice 1 |
| `apps/web/src/domain/quests/generatedRoomCacheSaveState.test.ts` | Slice 1 |
| `apps/web/src/app/restoreGeneratedRoomCache.ts` | Slice 3 |
| `apps/web/src/app/restoreGeneratedRoomCache.test.ts` | Slice 3 |
| `docs/architecture/decisions/ADR-0060-generated-room-cache-save-load-v0.md` | Docs (done) |
| `docs/architecture/implementation-plans/generated-room-cache-save-load-v0.md` | Docs (done) |

### Modified files

| File | Modified in slice | Change summary |
|---|---|---|
| `apps/web/src/app/saveSlotStore.ts` | Slice 2 | Optional `generatedRoomCacheJson` on wrapper, `write`, read result, and guard |
| `apps/web/src/app/saveSlotStore.test.ts` | Slice 2 | New backward-compat and round-trip cases |
| `apps/web/src/app/AdjacentRoomPregenerator.ts` | Slice 3 | Add read-only `snapshotCachedRooms()` accessor |
| `apps/web/src/app/AdjacentRoomPregenerator.test.ts` | Slice 3 | Cover the new accessor |
| `apps/web/src/App.tsx` | Slices 4, 5 | Save wiring (Slice 4); load/navigation wiring (Slice 5) |
| `apps/web/src/App.test.tsx` | Slices 4, 5 | New save/load/navigation integration coverage |
| `docs/architecture/ARCHITECTURE.md` | Slice 6 | ✅ status entry for this feature |
| `docs/architecture/FAILURE-MODES.md` | Slice 6 | Degradation entry for cache blob |

### Files to avoid — do not touch

- `apps/web/src/domain/world/saveGame.ts` — authoritative `SaveGame` schema unchanged
- `apps/web/src/world-session/saveGame.ts` — `SaveGameService` unchanged
- `apps/web/src/world-session/saveGame.test.ts` — unchanged
- `apps/web/src/app/buildRestoredPlay.ts` — unchanged
- `apps/web/src/app/restoreGeneratedQuestPlay.ts` — ADR-0059 helper unchanged
- `apps/web/src/domain/world/worldState.ts` — `WorldState` schema unchanged
- `apps/web/src/domain/quests/questSpec.ts` — `QuestSpec` schema unchanged
- `apps/web/src/domain/quests/generatedQuestSaveState.ts` — ADR-0059 schema unchanged
- `apps/web/src/domain/quests/assembleObjective.ts` — unchanged
- `apps/web/src/domain/quests/evaluateQuest.ts` — unchanged
- `apps/web/src/domain/interactions/resolvedObjects.ts` — unchanged
- `apps/web/src/domain/journal/generatedConsequenceJournal.ts` — unchanged
- `apps/web/src/app/derivedViews.ts` — unchanged
- `apps/web/src/app/App.helpers.ts` — unchanged (no new helper needed here)
- `apps/web/src/domain/generatedStoryThread.ts` — unchanged
- `apps/web/src/room/SessionRoomCache.ts` — unchanged (no new methods needed)
- `apps/web/src/generation/**` — no generator changes
- `apps/web/src/world-session/**` (beyond read-only type use) — no session changes
- `apps/web/src/interactions/**`, `encounters/**`, `dialogue/**`, `memory/**`
- `apps/web/src/persistence/**`, `apps/web/src/server/**`
- `apps/web/src/renderer/**`
- `eslint.config.js`
- `package.json`

---

## Safety invariants (all slices)

These must hold throughout implementation and be asserted by tests:

1. **No authority change.** `WorldSession` + event log + reducers remain the sole truth
   source. `resolvedObjectIds` is always recomputed from `WorldState` flags and the
   parked room's object IDs. The blob never overrides `WorldState`.

2. **No content leakage in UI or logs.** Logs on save or load must not contain room name,
   object name, interaction text, flag key strings, or object ID strings. The blob stores
   them as internal data; none surface in UI or log output.

3. **No raw provider/prompt/WorldBible text in the parked blob.** The blob contains only
   already-validated `RoomSpec` data and closed enums. It never contains raw generated
   descriptions, provider output, seed strings, or `WorldBibleSeed` free-text fields.

4. **No schema change.** `SaveGame`, `WorldState`, `RoomSpec`, `QuestSpec`, and
   `GeneratedQuestSaveState` `schemaVersion` fields all remain `1`. No field is added to any
   of these schemas.

5. **No semantics change.** `evaluateQuest`, `resolvedObjectIds`, `computeDerivedViews`,
   `refreshDerivedViews`, `shouldStartPerRoomObjectiveAttach`, and `readPerRoomObjectiveMemo`
   signatures and behavior are unchanged.

6. **No generator/provider call on load or cached-backtrack.** `loadRoomSpec` (not
   `assembleRoom`, not any enrichment stage, not any `RoomGenerator` or `ObjectiveGenerator`)
   is the only room-reconstruction call. A test must assert no generator import is present
   in `restoreGeneratedRoomCache.ts`. The objective memo seeding must prevent
   `shouldStartPerRoomObjectiveAttach` from firing for all restored room IDs.

7. **No cost meter increment on load or cached-backtrack.** `recordAttempt` is not called
   in any load or backtrack path for cached rooms. A test must assert `usageCount` is
   unchanged after load and after backtracking.

8. **No stale current-room quest UI on restored previous rooms.** After load and navigation
   to a restored non-current room, `setQuestSpecForView` is called with `null` (the seeded
   memo value for non-current rooms), not with the current-room's quest spec. A test must
   assert this.

9. **ADR-0059 unaffected.** The `generatedQuestJson` path runs and degrades independently
   of the cache blob. A corrupt or absent cache blob never breaks current-room restore.

10. **Authored saves unchanged.** No authored session writes `generatedRoomCacheJson`. All
    existing authored-world tests pass without modification.

11. **Backward compatibility.** Slot wrappers without `generatedRoomCacheJson` read and
    load without error; the load path falls back to ADR-0059 behavior exactly.

12. **Log discipline.** New log lines on save/load use only: `sessionId`, `revision`,
    `roomCount`, `themePack` (closed enum), `generatedRoomCacheSaved: boolean`,
    `generatedRoomCacheRestored: boolean`, and fixed error codes. Never log blob content.

---

## Slice 1 — Pure generated room cache save-state model

**Goal:** ship `GeneratedRoomCacheSaveStateSchema`, `buildGeneratedRoomCacheSaveState`, and
`loadGeneratedRoomCacheSaveState` as a standalone, fully tested pure domain module. Zero
runtime behavior change. Zero App or slot change.

**Prerequisite:** none.

### Files

**Add:**
- `apps/web/src/domain/quests/generatedRoomCacheSaveState.ts`
- `apps/web/src/domain/quests/generatedRoomCacheSaveState.test.ts`

**Do not touch any other file.**

### Module specification

**Location:** `apps/web/src/domain/quests/generatedRoomCacheSaveState.ts`

**Permitted imports (domain layer only):**
- `zod` (schema definition)
- `../roomSpec` (types + `RoomSpecSchema`)
- `../loadRoomSpec` (types only — `LoadedRoom`)
- `../assembleRoom` (types only — `RoomProvenance`)

**Must not import:** `react`, `three`, `platform/**`, `world-session/**`,
`interactions/**`, `encounters/**`, `dialogue/**`, `memory/**`, `persistence/**`,
`server/**`, `renderer/**`, `app/**`, `generation/**`.

**Exports:**

```ts
export const GENERATED_ROOM_CACHE_MAX = 16

// Per-room entry in the blob
export const SavedGeneratedRoomEntrySchema: ZodObject<...>
export type SavedGeneratedRoomEntry = z.infer<typeof SavedGeneratedRoomEntrySchema>

// Top-level blob schema
export const GeneratedRoomCacheSaveStateSchema: ZodObject<...>
export type GeneratedRoomCacheSaveState = z.infer<typeof GeneratedRoomCacheSaveStateSchema>

// Version envelope for fast rejection
export const GeneratedRoomCacheSaveStateVersionEnvelopeSchema: ZodObject<...>

// Input type for the build function
export type GeneratedRoomCacheSaveInput = {
  rooms: Array<{ room: LoadedRoom; provenance: RoomProvenance }>
  themePack?: 'fantasy-keep' | 'post-apoc'
}

// Error codes
export type GeneratedRoomCacheSaveLoadCode =
  | 'invalid-json'
  | 'unsupported-version'
  | 'invalid-schema'

export type LoadGeneratedRoomCacheSaveStateResult =
  | { ok: true; state: GeneratedRoomCacheSaveState }
  | { ok: false; code: GeneratedRoomCacheSaveLoadCode }

// Build: pure, total, synchronous
export function buildGeneratedRoomCacheSaveState(
  input: GeneratedRoomCacheSaveInput,
): GeneratedRoomCacheSaveState | null

// Load: pure, total, synchronous, throw-free
export function loadGeneratedRoomCacheSaveState(
  json: string,
): LoadGeneratedRoomCacheSaveStateResult
```

**Schema shape:**

```ts
SavedGeneratedRoomEntrySchema = z.object({
  room: RoomSpecSchema,
  provenance: z.enum(['generated', 'repaired', 'fallback']),
}).strict()

GeneratedRoomCacheSaveStateSchema = z.object({
  schemaVersion: z.literal(1),
  themePack: z.enum(['fantasy-keep', 'post-apoc']).optional(),
  rooms: z.array(SavedGeneratedRoomEntrySchema).min(1).max(GENERATED_ROOM_CACHE_MAX),
}).strict()
```

**`buildGeneratedRoomCacheSaveState` logic:**

1. Deduplicate by `room.id` (first occurrence wins); order is caller-determined (current room
   first by convention in the save path).
2. Apply the hard cap: take at most `GENERATED_ROOM_CACHE_MAX` entries after deduplication.
3. For each entry, project `room: LoadedRoom` → `room: RoomSpec` by taking only the
   RoomSpec-shaped fields (`schemaVersion`, `id`, `name`, `shell`, `spawn`, `lighting`,
   `objects`). Drop `skipped`, `warnings`, `skippedObjectReasonCounts`.
4. Build the candidate object.
5. `safeParse` through `GeneratedRoomCacheSaveStateSchema`. Return `null` on failure; return
   `.data` on success.

**`loadGeneratedRoomCacheSaveState` logic** (mirrors `loadGeneratedQuestSaveState`):

1. `JSON.parse` → catch → `{ ok: false, code: 'invalid-json' }`.
2. `GeneratedRoomCacheSaveStateVersionEnvelopeSchema.safeParse` → failure → `'invalid-schema'`.
3. `schemaVersion !== 1` → `'unsupported-version'`.
4. `GeneratedRoomCacheSaveStateSchema.safeParse` → failure → `'invalid-schema'`.
5. `{ ok: true, state: parsed.data }`.

### Test plan — Slice 1

File: `apps/web/src/domain/quests/generatedRoomCacheSaveState.test.ts`

Pure Vitest only. No DOM, no jsdom. Inline minimal `RoomSpec` / `LoadedRoom` fixtures.

**Required test cases:**

1. **Round-trip: single room, no `themePack`.** Build with one visited room + no `themePack`
   → serialize → load → `{ ok: true }` → all fields equal the input.

2. **Round-trip: multiple rooms + `themePack`.** Build with 3 rooms + `'fantasy-keep'`
   → serialize → load → all entries round-trip; `themePack` preserved.

3. **Parked room has no load-time diagnostics.** Output `rooms[].room` must not have
   `skipped`, `warnings`, or `skippedObjectReasonCounts` keys.

4. **Provenance round-trips all three values.** `'generated'`, `'repaired'`, `'fallback'`
   each serialize and reload correctly.

5. **Deduplication by room.id.** Two entries with the same `room.id` → only the first is
   kept; output `rooms` length is 1.

6. **Cap enforced.** Input with 17 rooms → output `rooms` has exactly 16 entries; the first
   16 (in input order) are kept.

7. **Cap: current room first is preserved.** Input ordered with current room first, 17
   total → current room (index 0) is in output; 17th (index 16) is dropped.

8. **Min(1) enforced.** Build with empty `rooms` array → returns `null` (schema rejects).

9. **Unknown `provenance` rejected.** Build with `provenance: 'unknown'` → `safeParse`
   fails → returns `null`.

10. **`themePack` absent when not provided.** Build without `themePack` → loaded state has
    `themePack: undefined`.

11. **`themePack` closed-enum enforcement.** Build with `themePack: 'sci-fi'` → `safeParse`
    fails → returns `null`.

12. **`loadGeneratedRoomCacheSaveState` rejects non-JSON input.** Returns
    `{ ok: false, code: 'invalid-json' }`.

13. **`loadGeneratedRoomCacheSaveState` rejects wrong `schemaVersion`.** `schemaVersion: 2`
    → `{ ok: false, code: 'unsupported-version' }`.

14. **`loadGeneratedRoomCacheSaveState` rejects missing `schemaVersion`.** →
    `{ ok: false, code: 'invalid-schema' }`.

15. **`loadGeneratedRoomCacheSaveState` rejects missing `rooms` field.** →
    `{ ok: false, code: 'invalid-schema' }`.

16. **`loadGeneratedRoomCacheSaveState` rejects `rooms` over cap.** A manually crafted
    JSON with 17 entries → `{ ok: false, code: 'invalid-schema' }`.

17. **`loadGeneratedRoomCacheSaveState` rejects extra top-level keys** (strict schema). →
    `'invalid-schema'`.

18. **`buildGeneratedRoomCacheSaveState` returns `null` on invalid room.** Pass a
    `LoadedRoom` whose projected `RoomSpec` fails `RoomSpecSchema` (e.g., empty `id`) →
    returns `null`.

19. **Purity.** Input `LoadedRoom` references are deep-equal before and after the call
    (no mutation). Two calls with identical inputs produce structurally equal outputs.

20. **Module import constraint.** The module must not re-export any type from
    `world-session/**`, `generation/**`, `app/**`, or `renderer/**`. Verified by `npm run build`
    (TypeScript strict + no-restricted-imports).

### Verification commands — Slice 1

```bash
# Targeted test (primary gate)
npm run test -- generatedRoomCacheSaveState

# Type-check (catches domain import violations mechanically)
npm run build

# Lint (catches no-console, no-restricted-imports)
npm run lint
```

Confirm all three pass with no errors or warnings.

### Stop point — Slice 1

Hand off after targeted test + build + lint all pass. No App, slot, or accessor change.
Await approval before Slice 2.

---

## Slice 2 — Slot parking

**Goal:** extend `saveSlotStore` with an optional `generatedRoomCacheJson` string alongside
the existing `generatedQuestJson`. Older wrappers missing the field read as `undefined`.
Authored saves never write the field. No App wiring yet.

**Prerequisite:** Slice 1 approved.

### Files

**Modify:**
- `apps/web/src/app/saveSlotStore.ts`
- `apps/web/src/app/saveSlotStore.test.ts`

**Do not touch any other file.**

### `saveSlotStore.ts` changes

**`SlotWrapper` (internal type):**

```ts
type SlotWrapper = SlotMeta & {
  saveGameJson: string
  generatedQuestJson?: string       // ADR-0059; unchanged
  generatedRoomCacheJson?: string   // new; never authoritative
}
```

**`isSlotWrapper`:** add
`('generatedRoomCacheJson' in v ? typeof v.generatedRoomCacheJson === 'string' : true)`
to the guard (allows absence; rejects a present non-string value).

**`SlotReadResult` (ok branch):**

```ts
| { ok: true; saveGameJson: string; meta: SlotMeta; generatedQuestJson?: string; generatedRoomCacheJson?: string }
```

**`read()` implementation:** when `isSlotWrapper` passes, additionally extract
`generatedRoomCacheJson` if it is a `string`; otherwise omit it. The field is only copied
through, never parsed or validated here.

**`SaveSlotStore` interface — `write` signature:**

```ts
write(
  saveGameJson: string,
  meta?: Partial<SlotMeta>,
  generatedQuestJson?: string,
  generatedRoomCacheJson?: string,
): SlotWriteResult
```

**`write()` implementation:** include `generatedRoomCacheJson` in the wrapper only when
provided and non-empty; otherwise omit the key.

No other change to `saveSlotStore.ts`. `has()` and `clear()` are unchanged.

### Test plan — Slice 2

File: `apps/web/src/app/saveSlotStore.test.ts` (extend existing tests; do not replace).

**Required new test cases:**

1. **Write with both blobs → read returns both strings.**
   `write(json, meta, questBlob, cacheBlob)` → `read()` → both strings equal the inputs.

2. **Write with `generatedRoomCacheJson` only (no quest blob) → read returns cache string,
   quest is `undefined`.**

3. **Write without `generatedRoomCacheJson` → read returns `generatedRoomCacheJson: undefined`.**

4. **Write with empty `generatedRoomCacheJson` → omitted (treated as absent).**
   `write(json, meta, questBlob, '')` → `read()` → `generatedRoomCacheJson` is `undefined`.

5. **Older wrapper (no `generatedRoomCacheJson` key in stored JSON) → reads without error.**
   Manually write a wrapper with only `saveGameJson` + `generatedQuestJson` to the KV store
   → `read()` → `{ ok: true, generatedRoomCacheJson: undefined }`.

6. **Non-string `generatedRoomCacheJson` in stored wrapper → reads as corrupt.**
   Manually write a wrapper with `generatedRoomCacheJson: 42` →
   `read()` → `{ ok: false, reason: 'corrupt' }`.

7. **Existing test suite passes unchanged.** All pre-existing `saveSlotStore.test.ts`
   cases remain green without modification (including the ADR-0059 `generatedQuestJson`
   cases).

### Verification commands — Slice 2

```bash
npm run test -- saveSlotStore
npm run build
npm run lint
```

### Stop point — Slice 2

Hand off after targeted test + build + lint all pass. No App wiring. Await approval before
Slice 3.

---

## Slice 3 — Restore helpers and cache accessor

**Goal:** ship `restoreGeneratedRoomCache` as a standalone tested composition helper, and
add the read-only `snapshotCachedRooms()` accessor to `AdjacentRoomPregenerator`. No App
wiring yet.

**Prerequisite:** Slices 1 and 2 approved.

### Files

**Add:**
- `apps/web/src/app/restoreGeneratedRoomCache.ts`
- `apps/web/src/app/restoreGeneratedRoomCache.test.ts`

**Modify:**
- `apps/web/src/app/AdjacentRoomPregenerator.ts`
- `apps/web/src/app/AdjacentRoomPregenerator.test.ts`

**Do not touch any other file.**

### `AdjacentRoomPregenerator.ts` — new accessor

Add a single read-only method at the end of the class:

```ts
/**
 * Returns all currently cached rooms in insertion order as a snapshot.
 * Used by the save path to capture visited rooms for the cache blob.
 * Never throws, never generates, never modifies state.
 */
snapshotCachedRooms(): Array<{ roomId: string; room: LoadedRoom; provenance?: RoomProvenance }> {
  const snapshot: Array<{ roomId: string; room: LoadedRoom; provenance?: RoomProvenance }> = []
  for (const [roomId, room] of this.cache['rooms']) {
    const provenance = this.provenanceMap.get(roomId)
    snapshot.push({ roomId, room, ...(provenance !== undefined ? { provenance } : {}) })
  }
  return snapshot
}
```

Note: `SessionRoomCache.rooms` is a private `Map`. To avoid exposing the Map directly,
either:
- Add a `entries()` method to `SessionRoomCache` that returns `IterableIterator<[string, LoadedRoom]>`,
  or
- Access the cache via the existing `has`/`get` API plus a new `keys()` method, or
- Make the `rooms` Map `readonly` and expose it as a package-internal accessor.

**Preferred approach for MSCR:** add `entries(): IterableIterator<[string, LoadedRoom]>` to
`SessionRoomCache` so the pregenerator can iterate without exposing the Map. This is a
two-line addition to `SessionRoomCache.ts` that does not change any existing method.

If `SessionRoomCache.entries()` is added, update `SessionRoomCache.ts` accordingly and add
a test case for it in the existing `SessionRoomCache` test file (if one exists; otherwise
cover it via the `AdjacentRoomPregenerator` snapshot test).

### `restoreGeneratedRoomCache.ts` specification

**Location:** `apps/web/src/app/restoreGeneratedRoomCache.ts`

**Permitted imports:**
- `../domain/quests/generatedRoomCacheSaveState` (types)
- `../domain/loadRoomSpec` (`loadRoomSpec` function + `LoadedRoom` type)
- `../domain/assembleRoom` (types only — `RoomProvenance`)
- `../room/SessionRoomCache`

**Must not import:** `generation/**`, `world-session/**`, `renderer/engine/**`,
`persistence/**`, `server/**`, any `RoomGenerator` or `ObjectiveGenerator` port.

**Exported types:**

```ts
export type RestoreGeneratedRoomCacheResult = {
  cache: SessionRoomCache
  provenance: Map<string, RoomProvenance>
  restoredRoomIds: string[]
}
```

**Exported function:**

```ts
export function restoreGeneratedRoomCache(
  state: GeneratedRoomCacheSaveState,
  currentRoom: LoadedRoom,
): RestoreGeneratedRoomCacheResult
```

**Logic:**

1. Build a fresh `SessionRoomCache` and a fresh `Map<string, RoomProvenance>`.
2. For each entry in `state.rooms`:
   a. Call `loadRoomSpec(entry.room)`. If this throws (envelope invalid), **skip** the entry
      and continue — the function is **total**; one bad parked room never fails the restore.
   b. `cache.set(room.id, room)`.
   c. `provenance.set(room.id, entry.provenance)`.
3. `cache.set(currentRoom.id, currentRoom)` and
   `provenance.set(currentRoom.id, provenanceMap.get(currentRoom.id) ?? 'generated')` —
   idempotent guard ensuring the current room (which is the ADR-0059 restore source) is
   always present even if it somehow diverges from the blob entries.
4. Return `{ cache, provenance, restoredRoomIds: [...cache.keys()] }`.

No `assembleRoom`, no enrichment stages, no generator, no provider call.

### Test plan — Slice 3

#### `restoreGeneratedRoomCache.test.ts`

Pure Vitest. No DOM. Inline minimal fixtures for `GeneratedRoomCacheSaveState` and `LoadedRoom`.

**Required test cases:**

1. **Two parked rooms → cache has both.** State with rooms A and B; restored cache contains
   both ids. `restoredRoomIds` includes both.

2. **Restored room objects match parked spec.** `cache.get(roomId).objects[].id` equals the
   parked `state.rooms[i].room.objects[].id`.

3. **One bad entry skipped; rest restored.** State with three rooms where the second entry
   has an invalid `RoomSpec` (e.g., no `id`) that causes `loadRoomSpec` to throw. Assert
   only two rooms are in cache; `restoredRoomIds` has two entries; no throw from the helper.

4. **Current room always in cache.** Supply a `currentRoom` with a different ID from all
   blob entries → cache contains the current room's ID plus blob entries.

5. **Current room from blob + current room from arg → idempotent.** If `currentRoom.id`
   matches a blob entry, it appears exactly once in cache; no duplication.

6. **Provenance map populated from blob.** Entry with `provenance: 'repaired'` →
   `provenance.get(roomId) === 'repaired'`.

7. **No generator import.** `restoreGeneratedRoomCache.ts` must not import any symbol from
   `generation/**`. Verified by `npm run build`.

8. **`loadRoomSpec` is the only room-reconstruction call.** No call to `assembleRoom`,
   `repairRoom`, `validateRoom`, or any `RoomGenerator`. (Static import check via build.)

9. **Purity.** Input `GeneratedRoomCacheSaveState` and `currentRoom` are deep-equal before
   and after the call (no mutation).

#### `AdjacentRoomPregenerator.test.ts` additions

10. **`snapshotCachedRooms` returns all cached entries.** Populate cache with two rooms via
    `resolveRoom` on a mock source → `snapshotCachedRooms()` returns two entries with
    correct `roomId`, `room`, and `provenance`.

11. **`snapshotCachedRooms` returns empty array when cache is empty.** No rooms resolved
    → returns `[]`.

12. **`snapshotCachedRooms` does not trigger generation.** Calling it on a pregenerator
    with an empty cache does not call `createSource`. (Assert via spy or call count.)

13. **Insertion order preserved.** Resolve A then B → snapshot returns [A, B] in that order.

### Verification commands — Slice 3

```bash
npm run test -- restoreGeneratedRoomCache
npm run test -- AdjacentRoomPregenerator
npm run build
npm run lint
```

### Stop point — Slice 3

Hand off after all targeted tests + build + lint pass. No App wiring. Await approval before
Slice 4.

---

## Slice 4 — App save wiring

**Goal:** `handleSave` builds and parks the `generatedRoomCacheJson` blob for generated play
(visited rooms only, current room first, cap applied). No behavior change for authored saves.
No load wiring yet.

**Prerequisite:** Slices 1–3 approved.

### Files

**Modify:**
- `apps/web/src/App.tsx`
- `apps/web/src/App.test.tsx`

**Do not touch** `saveSlotStore.ts`, `restoreGeneratedRoomCache.ts`, domain files, or
world-session files.

### `App.tsx` changes

Inside the existing `handleSave` async IIFE, after `saveGameService.saveSession` succeeds
and the existing `generatedQuestJson` is built:

```ts
// Generated play only: park the room cache blob alongside saveGameJson and generatedQuestJson.
let generatedRoomCacheJson: string | undefined
if (activePlay.objectivesPerRoom === true && activePlay.adjacentPregenerator != null) {
  // Fetch WorldState to filter cached rooms to visited-only.
  const stateForCache = await worldSession.getWorldState(activePlay.sessionId)
  if (stateForCache.ok) {
    const allCached = activePlay.adjacentPregenerator.snapshotCachedRooms()
    // Filter: visited rooms (have roomState entry) + always include current room.
    const visited = allCached.filter(
      (entry) =>
        stateForCache.state.roomStates[entry.roomId] != null ||
        entry.roomId === activePlay.room.id,
    )
    // Reorder: current room first; remaining in snapshot insertion order.
    const currentFirst = [
      ...visited.filter((e) => e.roomId === activePlay.room.id),
      ...visited.filter((e) => e.roomId !== activePlay.room.id),
    ]
    const saveState = buildGeneratedRoomCacheSaveState({
      rooms: currentFirst.map((e) => ({
        room: e.room,
        provenance: e.provenance ?? 'generated',
      })),
      themePack: activePlay.worldBible?.themePack,
    })
    if (saveState != null) {
      generatedRoomCacheJson = JSON.stringify(saveState)
      logger.info('generated room cache saved', {
        roomCount: saveState.rooms.length,
        themePack: saveState.themePack ?? 'none',
        generatedRoomCacheSaved: true,
      })
    }
    // If null (schema guard), omit silently — main save already succeeded.
  }
  // If getWorldState fails, omit cache blob silently.
}

const writeResult = saveSlotStore.write(
  saveResult.json,
  { savedAt: new Date().toISOString(), label: 'Save' },
  generatedQuestJson,       // from ADR-0059 (existing)
  generatedRoomCacheJson,   // new; undefined for authored sessions
)
```

Imports to add in `App.tsx`:
- `buildGeneratedRoomCacheSaveState` from `domain/quests/generatedRoomCacheSaveState`
- `loadGeneratedRoomCacheSaveState` from `domain/quests/generatedRoomCacheSaveState`
  (needed for Slice 5; can be added here early to keep the import section tidy)

**No other `App.tsx` change in this slice.** The load path is Slice 5.

### Test plan — Slice 4

File: `apps/web/src/App.test.tsx` (extend; do not replace existing tests).

**Required new test cases:**

1. **Generated session save → `generatedRoomCacheJson` present in slot.**
   After `handlePrompt` resolves and `handleSave` completes, `saveSlotStore.read()` returns
   a non-empty `generatedRoomCacheJson` string.

2. **`generatedRoomCacheJson` is valid `GeneratedRoomCacheSaveState`.** Parse it through
   `loadGeneratedRoomCacheSaveState` → `{ ok: true }`. The state contains at least one room.

3. **Current room is included in cache blob.** The parsed state's `rooms[0].room.id` equals
   `activePlay.room.id` (current room first by convention).

4. **Authored session save → `generatedRoomCacheJson` absent in slot.**
   Bootstrap example world → call save → `saveSlotStore.read().generatedRoomCacheJson` is
   `undefined`.

5. **Visited rooms only — warmed-but-not-navigated rooms excluded.** Mock
   `snapshotCachedRooms` to return three rooms; mock `WorldState.roomStates` to have entries
   for only two of them (the current room plus one other) → assert the saved state contains
   exactly 2 rooms (not the unvisited warmed room).

6. **`getWorldState` failure → cache blob omitted, main save still succeeds.**
   Mock `worldSession.getWorldState` to return `{ ok: false }` → save completes;
   `saveSlotStore.read()` has no `generatedRoomCacheJson` but has `saveGameJson`.

7. **`buildGeneratedRoomCacheSaveState` returning `null` (mocked schema guard) → save
   still completes without cache blob.** Main save unaffected.

8. **Log line on save contains `roomCount` and `themePack` (closed enum) only — no room
   name, object name, or IDs.** Assert log output for the save path.

9. **Existing save tests pass unchanged.** All pre-existing save-related `App.test.tsx`
   and `generatedQuestSaveState` cases remain green.

### Verification commands — Slice 4

```bash
npm run test -- App
npm run test -- saveGame
npm run build
npm run lint
```

### Stop point — Slice 4

Hand off after targeted tests + build + lint all pass. Await approval before Slice 5.

---

## Slice 5 — App load/navigation wiring

**Goal:** `handleLoad` rehydrates the `SessionRoomCache`, builds a generated
`AdjacentRoomPregenerator` and `NavigationService` over it, seeds the objective memo for
all restored rooms, and enters active play with generated wiring. Backtracking to cached
rooms is stable (same room, no LLM call, no cost increment, no stale quest UI).

**Prerequisite:** Slices 1–4 approved.

### Files

**Modify:**
- `apps/web/src/App.tsx`
- `apps/web/src/App.test.tsx`

### `App.tsx` changes

In `handleLoad`, immediately after `restoredGeneratedPlay` is obtained (the existing
`restoreGeneratedPlayFromSlot` result) and confirmed non-null, before calling `enterActivePlay`:

```ts
// Attempt to rehydrate the multi-room cache from the cache blob (ADR-0060).
let roomCache = restoredGeneratedPlay.roomCache      // ADR-0059 single-room cache (fallback)
let resolvedAdjacent: AdjacentRoomPregenerator = adjacentPregenerator  // authored fallback
let resolvedNavigation: NavigationService = exampleNavigation

const cacheJson = slotResult.generatedRoomCacheJson
if (cacheJson != null) {
  const cacheLoaded = loadGeneratedRoomCacheSaveState(cacheJson)
  if (cacheLoaded.ok) {
    const { cache, provenance, restoredRoomIds } = restoreGeneratedRoomCache(
      cacheLoaded.state,
      restoredGeneratedPlay.room,
    )
    roomCache = cache

    // Build a generated pregenerator over the rehydrated cache with the saved vocabulary.
    const restoredThemePack = cacheLoaded.state.themePack
    const restoredVocabulary = themeVocabulary(restoredThemePack)
    const restoredAdjacentGenerator = new FakeRoomGenerator(restoredVocabulary)
    const restoredStoryKind = restoredGeneratedPlay.storyKind

    resolvedAdjacent = new AdjacentRoomPregenerator(
      cache,
      roomRegistry,
      (roomId) => {
        const storyContext = restoredStoryKind
          ? deriveStoryThreadContext(restoredStoryKind, roomId)
          : undefined
        const storyPhrase = storyContext ? storyThreadToSeedPhrase(storyContext) : undefined
        return new GeneratedRoomSource(
          restoredAdjacentGenerator,
          buildAdjacentRoomSeed(roomId, undefined, storyPhrase),
          logger,
          fallbackRoom,
          {
            themePack: restoredThemePack,
            enrichObjectiveTarget: true,
            storyKind: storyContext?.kind,
          },
        )
      },
      fallbackRoom,
      logger,
      3,
      { ensureReturnExits: true },
    )
    // Restore provenance map entries into the new pregenerator's internal map.
    // (Requires adding a constructor option or a method; see note below.)
    resolvedAdjacent.restoreProvenance(provenance)

    resolvedNavigation = new NavigationService(worldSession, resolvedAdjacent, logger)

    // Seed the objective memo for ALL restored rooms to prevent LLM calls on backtrack.
    // Current room: seed with restored quest attachment if available (enables re-showing
    //   the objective when navigating away from and back to the current room).
    // Other rooms: seed null (no objective text restored for non-current rooms in v0;
    //   prevents stale current-room quest UI showing on those rooms).
    const currentRoomId = restoredGeneratedPlay.room.id
    const currentRoomAttachment =
      restoredGeneratedPlay.questSpec != null && restoredGeneratedPlay.hints != null
        ? {
            questSpec: restoredGeneratedPlay.questSpec,
            hint: restoredGeneratedPlay.hints.hint,
            completionHint: restoredGeneratedPlay.hints.completionHint,
          }
        : null
    for (const roomId of restoredRoomIds) {
      perRoomObjectiveMemoRef.current.set(
        roomId,
        roomId === currentRoomId ? currentRoomAttachment : null,
      )
    }

    logger.info('generated room cache restored', {
      roomCount: restoredRoomIds.length,
      generatedRoomCacheRestored: true,
    })
  } else {
    logger.info('generated room cache restore failed', { code: cacheLoaded.code, generatedRoomCacheRestored: false })
    // Fall through: use the ADR-0059 single-room cache + authored wiring.
  }
}

// Enter active play — generated path with (possibly enhanced) wiring.
const { hints, ...generatedPlayFields } = restoredGeneratedPlay
setQuestSpecForView(generatedPlayFields.questSpec ?? null)
setQuestHintsForView(hints ?? null)
journalSpecRef.current = null
enterActivePlay({
  ...generatedPlayFields,
  roomCache,
  sessionId: play.sessionId,
  navigation: resolvedNavigation,
  adjacentPregenerator: resolvedAdjacent,
})
```

**Note on `restoreProvenance`:** `AdjacentRoomPregenerator` needs a way to pre-populate its
internal `provenanceMap` for rooms already in the rehydrated cache. Add a method:

```ts
restoreProvenance(entries: Map<string, RoomProvenance>): void {
  for (const [roomId, provenance] of entries) {
    this.provenanceMap.set(roomId, provenance)
  }
}
```

This is a minimal addition — only called from `handleLoad` (restore path) and untested
except via the integration test. It never generates or modifies cache state. Cover it in
Slice 3's `AdjacentRoomPregenerator.test.ts` with a simple test.

**The rest of `handleLoad`** (`refreshDerivedViews`, `setSaveLoadStatus`, log lines) is
**unchanged** in call order.

### Test plan — Slice 5

File: `apps/web/src/App.test.tsx` (extend).

**Required new test cases:**

1. **Generated session: navigate A → B → save → load → backtrack to A → A is the same
   room (object IDs identical).**
   Save with two rooms in cache; load; navigate to the non-current restored room;
   assert `result.room.objects.map(o => o.id)` equals the pre-save IDs.

2. **Backtracking uses cache (no generation call).** After load, spy on
   `AdjacentRoomPregenerator.resolveRoom` for the restored room; navigate to it; assert
   the spy returns `source: 'cache'` (no `resolveGenerated` call).

3. **No LLM/objective generator call on backtrack.** After load, spy on
   `ObjectiveGenerator.generate` and any `RoomGenerator.generate`. Navigate to a restored
   cached room. Assert zero calls.

4. **No cost meter increment on backtrack.** `usageCount` unchanged after load and after
   navigating to a restored cached room.

5. **Stale current-room quest UI not shown on restored previous room.** After load, current
   room B has a restored `questSpec`. Navigate to restored room A. Assert
   `setQuestSpecForView` was called with `null` (A's memo is `null`) — not with B's quest
   spec.

6. **Current-room quest survives re-entry.** After load (current room B, memo seeded with
   quest attachment), navigate away to A, then back to B. Assert quest spec is restored
   for B (read from memo).

7. **`resolvedObjectIds` for restored room matches pre-save flags.** Set a flag for an
   object in room A before save. After load, navigate to A; assert
   `entryResolvedObjectIds` (or the equivalent from `resolvedObjectIdsForGeneratedPlay`)
   contains the object ID.

8. **Generated navigation restored (not authored).** After load, `activePlay.adjacentPregenerator`
   is the generated one (not the authored `adjacentPregenerator` singleton). Assert via
   object identity or by checking that the cache is the rehydrated one (not the example cache).

9. **Generated session load (missing cache blob) → single-room ADR-0059 restore, no crash.**
   Remove `generatedRoomCacheJson` from slot; load → no error; only current room in cache.

10. **Generated session load (corrupt cache blob) → single-room ADR-0059 restore, no crash.**
    Write `generatedRoomCacheJson: 'not-json'` to slot; load → fixed code logged;
    single-room cache; no error surfaced.

11. **Generated session load (schema-invalid cache blob) → graceful fallback.**
    Write blob with `schemaVersion: 9` → `loadGeneratedRoomCacheSaveState` fails →
    ADR-0059 single-room restore; no crash.

12. **ADR-0059 quest restore still works with cache blob present.**
    Full round-trip (generate → navigate → save → load) with both blobs present →
    quest tracker visible, `resolvedObjectIds` correct for current room, journal re-projects.

13. **ADR-0059 quest restore still works when cache blob absent.**
    Full round-trip with only `generatedQuestJson` present → quest tracker visible,
    journal re-projects, no crash (regression: ADR-0059 behavior unchanged).

14. **Cost meter unchanged after load.** `usageCount` before and after `handleLoad` are equal.

15. **Log lines on load contain no room names, object IDs, flag keys, or narrative content.**
    Assert log output for the load path contains only safe codes, booleans, and counts.

16. **Authored session load (regression).** Bootstrap example world → save → load →
    demo quest tracker, demo journal, authored-world behavior byte-identical to pre-feature.
    All pre-existing load tests pass.

17. **`loadRoomSpec` called on restore; `assembleRoom` not called.** Spy on `loadRoomSpec`
    (≥ 1 call for each restored room); assert `assembleRoom` is not called during load.

### Verification commands — Slice 5

```bash
# Targeted tests
npm run test -- App
npm run test -- generatedRoomCacheSaveState
npm run test -- restoreGeneratedRoomCache
npm run test -- AdjacentRoomPregenerator
npm run test -- saveSlotStore

# Full regression suite
npm run test

# Type-check and lint
npm run build
npm run lint
```

All must pass with no failures or skips.

### Stop point — Slice 5

Hand off after full test suite + build + lint pass. Perform the manual smoke checklist
below before requesting docs closeout. Await approval before Slice 6.

---

## Slice 6 — Docs closeout

**Goal:** update architecture status docs. No runtime file changes.

**Prerequisite:** Slice 5 approved, smoke checklist completed.

### Files

**Modify (docs only):**
- `docs/architecture/ARCHITECTURE.md` — add short ✅ status entry for "Generated Room
  Cache Save/Load v0" in the status section, consistent with existing shipped entries.
  Cross-reference ADR-0060.
- `docs/architecture/FAILURE-MODES.md` — add an entry describing: generated session load
  with valid cache blob → multi-room cache rehydrated; invalid/missing blob → ADR-0059
  single-room restore (no error); rooms beyond cap regenerate on deep backtrack.
- `docs/architecture/decisions/ADR-0060-generated-room-cache-save-load-v0.md` — update
  status from `Accepted — pending implementation` to `Accepted — implemented`; add
  `Implemented: YYYY-MM-DD`.
- `docs/architecture/implementation-plans/generated-room-cache-save-load-v0.md` — update
  status from `pending implementation` to `implemented — slices 1–5 complete; docs
  closeout complete`.

**Do not touch any runtime file in this slice.**

### Verification commands — Slice 6

```bash
# Docs-only: confirm no runtime files changed
git diff --name-only

# Confirm build and lint still pass after docs edits
npm run build
npm run lint
npm run test
```

`git diff --name-only` must show only docs files. Any runtime file in the diff is a
slice-6 error.

### Stop point — Slice 6

Confirm `git diff --name-only` shows only docs files. Hand off for final review.

---

## Manual smoke checklist

Perform in the browser after Slice 5 is complete (`npm run dev`):

1. Submit a generated-room prompt (default fake provider config). Note the room layout.
2. Press **E** at one of the exits to navigate to an adjacent room (room B). Note room B's layout.
3. Wait for the quest tracker to appear with room B's generated objective.
4. Interact with the objective-target object. Confirm quest shows **complete**.
5. Press **E** at another exit to navigate to a third room (room C). Note C's layout.
6. Press **Save**. Confirm save bar shows "Saved".
7. Hard-reload the page (`Ctrl+Shift+R` / `Cmd+Shift+R`).
8. Press **Continue**. Confirm:
   - Room C (the saved current room) restores correctly.
   - Quest tracker shows the room C objective (if any) or no tracker for rooms with no
     restored objective (documented v0 behavior).
9. Navigate **back** to room B. Confirm:
   - Room B has **the same layout** as before the save (same arches, same object positions).
   - Interaction rings on B's objects reflect the pre-save flag state (the completed
     objective-target object should not have a ring if it was already resolved).
   - The quest tracker shows **null** — B's objective text is not restored for non-current
     rooms in v0 (expected; documented).
10. Navigate back to room C. Confirm:
    - Room C shows C's quest objective again (current-room memo restored).
11. Navigate to room A (the first room). Confirm:
    - Room A has the same layout as before the save.
12. Navigate forward/back several more times. Confirm no random room replacement for rooms
    that were in the cache.
13. Open DevTools → Network tab. Confirm **no network request** was made during load or
    during any cached-room navigation.
14. Open DevTools → Console. Confirm **no error logs** and no logged content containing
    room name, object names, object IDs, or flag keys.
15. Check localStorage: `aigm.save.slot` wrapper contains both `generatedQuestJson` and
    `generatedRoomCacheJson`. Inspect `generatedRoomCacheJson` — it should be a valid JSON
    blob containing rooms and (optionally) `themePack`. No prompt text, seed strings, or raw
    provider output visible.
16. **Cost regression.** Navigate away from a cached room and back. Confirm `usageCount`
    in the Usage Meter does not increment.
17. Hard-reload again. Press **Continue**. Confirm the session restores correctly a second
    time (idempotent restore).
18. Bootstrap the **authored demo world** (no prompt). Save → reload → Continue. Confirm
    authored demo quest tracker and journal work exactly as before (no regression).

---

## Regression checklist

After Slice 5, confirm these existing test files pass without modification:

- `world-session/saveGame.test.ts` — authoritative `SaveGame` integrity unchanged
- `app/saveSlotStore.test.ts` — existing slot tests unchanged (ADR-0059 cases pass)
- `app/buildRestoredPlay.ts` / `buildRestoredPlay.test.ts` — unchanged
- `app/restoreGeneratedQuestPlay.test.ts` — ADR-0059 restore helper unchanged
- `domain/quests/generatedQuestSaveState.test.ts` — ADR-0059 schema unchanged
- `domain/quests/evaluateQuest.test.ts` — quest evaluation unchanged
- `domain/quests/assembleObjective.test.ts` — objective assembly unchanged
- `domain/interactions/resolvedObjects.test.ts` — object-state persistence unchanged
- `domain/journal/generatedConsequenceJournal.test.ts` — journal projector unchanged
- `domain/generatedStoryThread.test.ts` — story threading unchanged
- `app/derivedViews.test.ts` — derived-views projection unchanged
- `renderer/ui/QuestTracker.test.tsx` — quest tracker component unchanged
- `App.test.tsx` — all pre-existing authored-world and ADR-0059 tests pass unchanged

None of these files should be modified during implementation. If a regression test fails,
investigate the root cause rather than adjusting the test.
