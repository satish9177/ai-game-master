# ADR-0060: Generated Room Cache Save/Load v0 — safe parked visited-room cache for stable backtracking after load

- **Status:** Accepted — implemented
- **Date:** 2026-06-30
- **Implemented:** 2026-06-30
- **Deciders:** Project owner

## Context

`generated-quest-save-load-v0` ([ADR-0059](./ADR-0059-generated-quest-save-load-v0.md)) restored
the current generated room, quest UI state, and resolved-object visual state across a
Save/Continue/Load cycle. Its known limitations section explicitly deferred the next gap:

> *"Only the current room is restored. Generated adjacent room cache, worldBible-seeded
> `AdjacentRoomPregenerator`, and full generated-world navigation are not restored. After a
> generated load, onward navigation uses the authored `adjacentPregenerator` —  a documented
> known limitation."*

The practical consequence: after a Save → Refresh → Continue cycle, the player can interact
with the restored current room correctly, but backtracking to a previously visited generated
room produces a **different room**. This happens because:

1. The entire `SessionRoomCache` is in-memory only and is not persisted.
2. On load, `handleLoad` wires `navigation: exampleNavigation` and `adjacentPregenerator:
   adjacentPregenerator` — the **authored** singletons whose cache holds only the current room.
3. Backtracking to a non-current room resolves through the authored factory, which uses the
   example `FakeRoomGenerator` with no theme seed, no story phrase, and no `ensureReturnExits`
   — yielding a structurally different room with different object IDs.
4. Different object IDs break `resolvedObjectIds`: even though the interaction flags survived
   faithfully in the event log, the rings reset because no object ID matches them.
5. The consequence journal and NPC objective awareness, while correctly re-projecting for
   the current room, may also be incoherent for adjacent rooms if they reference different
   object layouts.

Additionally: after a generated session load, the `perRoomObjectiveMemoRef` is reset to an
empty `Map`. When the player navigates to a cached restored room, `shouldStartPerRoomObjectiveAttach`
sees `objectivesPerRoom === true`, `provenance === 'generated'`, and `!memo.has(roomId)` — all
three true — and would trigger a new LLM/objective provider call and cost increment for every
cached room backtracked into.

The fix must be bounded in scope and must not touch the authoritative `SaveGame` schema,
world-session, event-log, or any `schemaVersion` field. It must never call any generator or
provider on load or on backtracking to cached rooms.

## Decision

Generated Room Cache Save/Load v0 parks a third, independent, re-validated blob —
`GeneratedRoomCacheSaveState` — alongside `saveGameJson` and `generatedQuestJson` in the
existing save slot. It extends the sidecar pattern proved by ADR-0059 to cover visited
generated rooms beyond the current one.

### Scope

This feature is **not** full generated-world persistence. Specifically:

- Only **visited** generated rooms (rooms the player has navigated into) are persisted.
  Warmed-but-unvisited adjacent rooms (speculative background pregeneration) are **not**
  persisted in v0.
- The `WorldBibleSeed` free-text fields (`hook`, `firstObjective`, `pressure`, `premise`,
  `title`, `majorConflict`, `canonNotes`, `openingContext`) are **not** persisted.
- The `adjacentThemeSeed` (a compact string derived from the World Bible) is **not**
  persisted; the `themePack` closed enum is sufficient for restoring vocabulary after load.
- Full generated-navigation graph (exit IDs, bidirectional link structure) is **not**
  re-derived from the blob; the original validated room data in the parked `RoomSpec` already
  contains the post-assembly exits, so the restored cache immediately serves backtracking.
- Per-room generated **objective text** is **not** restored for non-current rooms. The
  current room's objective remains owned by the `generatedQuestJson` blob (ADR-0059).
- Rooms beyond the hard cap may regenerate on deep backtracking (documented v0 limitation).
- Forward generation after load is theme-consistent (via the persisted `themePack` closed
  enum driving `themeVocabulary` and `FakeRoomGenerator`) but not byte-identical to the
  pre-save speculative rooms that were warmed but not yet visited.

### Authority invariants — hard constraints

The parked blob and all restore logic **must not** and **do not**:

- Append `WorldEvent`s or `WorldCommand`s.
- Mutate `WorldState`, `roomStates`, `player.status`, or `inventory`.
- Change objective-completion semantics. `evaluateQuest(questSpec, worldState)` remains the
  sole completion evaluation path, driven entirely by the already-restored `WorldState`.
- Change object-state persistence semantics. `resolvedObjectIds(room, roomState)` is
  unchanged; the parked rooms only make each room's object IDs match the already-correct
  flags again.
- Write NPC memory, room memory, or any memory layer.
- Make any LLM, network, generator, or objective-provider call on load **or** on
  backtracking to a restored cached room. The `perRoomObjectiveMemoRef` is seeded for all
  restored room IDs to prevent `shouldStartPerRoomObjectiveAttach` from firing.
- Call `recordAttempt` or increment the cost/usage meter on load or backtracking.
- Change the authoritative `SaveGame` schema (`domain/world/saveGame.ts`) or its `SaveGameSchema`.
- Change `WorldStateSchema`, `RoomSpecSchema`, `QuestSpecSchema`, or any `schemaVersion` field.
- Change any world-session, event-log, interaction, encounter, or reducer behavior.
- Restore `WorldBibleSeed` free-text fields, `adjacentThemeSeed`, or other prompt-bearing
  data from the original generated session.

### Content safety constraints — hard constraints

The parked blob **must not** contain or expose:

- Raw user prompt text or generated room prompt text.
- Provider output, raw LLM response body, or generated JSON as a string.
- `WorldBibleSeed` free-text fields.
- Raw generated room description text in any log line.
- Interaction `title`, `body`, or `prompt` text from generated objects in any log line
  (these travel inside the validated `RoomSpec` as stored data only).
- NPC names or dialogue text.
- `GeneratedObjectiveSpec` raw JSON.
- Structural room IDs, flag key strings, or object ID strings in UI display or logs.

**Permitted in the parked blob (as stored data only, not surfaced in UI or logs):**

| Field | Why permitted | Safety condition |
|---|---|---|
| `rooms[].room: RoomSpec` (validated objects, IDs included) | Object IDs needed for `resolvedObjectIds` to match surviving flags | IDs are internal stored data; never logged, never displayed |
| `rooms[].provenance: 'generated' \| 'repaired' \| 'fallback'` | Needed to restore provenance map for accurate diagnostic logging | Closed enum; already logged elsewhere as a safe value |
| `themePack: 'fantasy-keep' \| 'post-apoc'` | Needed to restore `FakeRoomGenerator` vocabulary for forward generation | Closed enum with 2 values; already a safe log value |

**What must not appear in logs on save or load:**
Room names, object names, interaction text, flag keys, object IDs, structural room IDs,
provider content, `SaveGame` JSON body, or any narrative content. Log lines may contain only:
`sessionId`, `revision`, `eventCount`, `roomCount`, safe boolean flags
(`generatedRoomCacheSaved`, `generatedRoomCacheRestored`), `themePack` (closed enum),
fixed error codes, and counts.

### Data model

**`SavedGeneratedRoomEntrySchema`** (per-room entry in the blob):

```ts
SavedGeneratedRoomEntrySchema = z.object({
  room: RoomSpecSchema,
  provenance: z.enum(['generated', 'repaired', 'fallback']),
}).strict()
```

**`GeneratedRoomCacheSaveStateSchema`**:

```ts
const GENERATED_ROOM_CACHE_MAX = 16

GeneratedRoomCacheSaveStateSchema = z.object({
  schemaVersion: z.literal(1),
  themePack: z.enum(['fantasy-keep', 'post-apoc']).optional(),
  rooms: z.array(SavedGeneratedRoomEntrySchema).min(1).max(GENERATED_ROOM_CACHE_MAX),
}).strict()

type GeneratedRoomCacheSaveState = z.infer<typeof GeneratedRoomCacheSaveStateSchema>
```

**`buildGeneratedRoomCacheSaveState(input)`** — pure, total, synchronous, side-effect-free.
Projects each `LoadedRoom` into a `RoomSpec` (drops `skipped`, `warnings`,
`skippedObjectReasonCounts`). Deduplicates by `room.id` (first occurrence wins). Applies the
hard cap of 16 (callers pre-order the list with the current room first so the cap always
retains it). Returns `null` only when the final `safeParse` fails (schema guard).

**`loadGeneratedRoomCacheSaveState(json: string)`** — pure, total, synchronous, throw-free.
Mirrors `loadGeneratedQuestSaveState`: JSON-parse → version envelope check → full schema
validation. Returns `{ ok: true; state }` or `{ ok: false; code }`.

**`SlotWrapper` extension** (in `saveSlotStore.ts`):

```ts
type SlotWrapper = SlotMeta & {
  saveGameJson: string
  generatedQuestJson?: string      // from ADR-0059
  generatedRoomCacheJson?: string  // new; never authoritative
}
```

`SaveSlotStore.write` gains an optional `generatedRoomCacheJson?: string` parameter (fourth
positional). `SlotReadResult` (ok branch) gains an optional `generatedRoomCacheJson?: string`
field. Both changes are backward-compatible: older wrappers missing the field read as
`undefined`; authored saves never write the field.

### Save path

In `handleSave` (App.tsx):

1. Existing `saveGameService.saveSession` + `saveSlotStore.write` with `generatedQuestJson`
   wiring are **unchanged** in behavior.
2. Additionally, for generated play (`objectivesPerRoom === true`):
   a. Call `worldSession.getWorldState(activePlay.sessionId)` to obtain current `WorldState`.
      If this fails, omit the cache blob silently — the main save proceeds.
   b. Call `activePlay.adjacentPregenerator.snapshotCachedRooms()` — a new read-only accessor
      that returns all currently cached rooms in insertion order as
      `Array<{ roomId: string; room: LoadedRoom; provenance?: RoomProvenance }>`.
   c. Filter to entries where `roomId === activePlay.room.id` (ensures the current room is
      always included) or where `worldState.roomStates[roomId]?.visited === true` (visited
      generated rooms only).
   d. Reorder: current room first, remaining in snapshot insertion order.
   e. Call `buildGeneratedRoomCacheSaveState({ rooms: filtered, themePack: activePlay.worldBible?.themePack })`.
   f. If non-null, serialize and pass as `generatedRoomCacheJson` to `saveSlotStore.write`.
      If null (schema guard), omit the field — the save succeeds without the cache blob.
3. For authored sessions (`objectivesPerRoom` not `true`): do not pass `generatedRoomCacheJson`
   → `SlotWrapper` omits both generated fields, byte-identical to today's authored format.

### Load path

In `handleLoad` (App.tsx), after the existing `WorldState` restore and the
`restoreGeneratedPlayFromSlot` (ADR-0059) both succeed:

1. Read `slotResult.generatedRoomCacheJson` (optional string).
2. If present: call `loadGeneratedRoomCacheSaveState(json)`.
3. If `{ ok: true; state }`: call `restoreGeneratedRoomCache(state, restoredGeneratedPlay.room)`
   (composition helper in `app/restoreGeneratedRoomCache.ts`) to obtain a rehydrated
   `SessionRoomCache`, provenance map, and the list of restored room IDs.
4. Build a **generated** `AdjacentRoomPregenerator` over the rehydrated cache — using
   `themeVocabulary(state.themePack)` for the `FakeRoomGenerator`, and the `storyKind` from
   the quest restore blob to seed the story-phrase factory. Use `{ ensureReturnExits: true }`.
5. Build a `NavigationService` over the generated pregenerator.
6. Seed `perRoomObjectiveMemoRef.current` for all restored room IDs:
   - For the **current room**: seed with the restored `questSpec` when present, even if hints
     are absent. Missing hints become empty strings in the memo attachment. If there is no
     quest spec, seed `null`. This allows re-entering the current room after navigating away
     and back to show the restored objective when ADR-0059 restored one.
   - For **all other restored rooms**: seed `null`. This blocks
     `shouldStartPerRoomObjectiveAttach` (no LLM call, no cost increment) and clears any
     stale current-room quest spec from the UI on navigation to those rooms.
7. Call `enterActivePlay` with the rehydrated `roomCache`, generated `adjacentPregenerator`,
   and generated `navigation`.
8. If `loadGeneratedRoomCacheSaveState` fails or the blob is absent: continue with the
   `restoredGeneratedPlay`'s single-room cache and the authored fallback wiring (today's
   ADR-0059 behavior). No error is surfaced.
9. If `restoreGeneratedPlayFromSlot` (ADR-0059) itself fails (no quest blob or corrupt quest
   blob): continue with today's authored-world fallback exactly. The cache blob is never
   processed when the quest blob fails.

**`restoreGeneratedRoomCache`** (composition helper in `app/restoreGeneratedRoomCache.ts`):

Takes `(state: GeneratedRoomCacheSaveState, currentRoom: LoadedRoom)`. Returns:
`{ cache: SessionRoomCache; provenance: Map<string, RoomProvenance>; restoredRoomIds: string[]; skippedRoomCount: number }`.

Steps:
1. Build a fresh `SessionRoomCache`.
2. For each entry in `state.rooms`:
   a. Call `loadRoomSpec(entry.room)`. If this throws (envelope invalid), skip the entry and
      continue. The function is **total** — one bad entry never fails the whole restore.
   b. `cache.set(room.id, room)`.
   c. `provenance.set(room.id, entry.provenance)`.
3. Additionally `cache.set(currentRoom.id, currentRoom)` (idempotent; the current room is
   already in `state.rooms` by save-time ordering, but this guards against schema drift).
4. Return the cache, provenance map, deterministic restored-room id list, and skipped-entry
   count. The current room is always present even when the cache blob is missing it.

No `assembleRoom`, no enrichment stages, no generator, no provider call. The parked objects
are already the post-assembly output; `loadRoomSpec` is the correct and sufficient boundary.

### Degradation table

| Situation | Behavior |
|---|---|
| No `generatedRoomCacheJson` in slot (older save, authored save) | Slot reads fine; field is `undefined`; ADR-0059 current-room restore only; no error |
| `loadGeneratedRoomCacheSaveState` fails (corrupt, schema mismatch, `schemaVersion !== 1`) | Falls back to ADR-0059 single-room behavior; no error surfaced; unsafe input is never echoed |
| `restoreGeneratedRoomCache` skips one bad entry | Remaining entries restored; that room regenerates on backtrack; logged as count |
| `worldSession.getWorldState` fails during save | Cache blob omitted silently; main save succeeds |
| Rooms beyond cap visited before save | Only first 16 rooms (current room first) persisted; deeper backtracking regenerates |
| No `themePack` in blob (older generated save) | `themeVocabulary(undefined)` → default fantasy vocabulary; forward generation slightly less consistent but safe |
| `storyKind` unavailable (quest blob absent or `storyKind` not saved) | Story-phrase seeding omitted; forward generation uses theme seed only; degradation matches ADR-0059 |
| `generatedQuestJson` (ADR-0059) fails but `generatedRoomCacheJson` present | Falls back to authored-world gate; cache blob is not processed; no regression |

### snapshotCachedRooms accessor

`AdjacentRoomPregenerator` gains a read-only accessor:

```ts
snapshotCachedRooms(): Array<{ roomId: string; room: LoadedRoom; provenance?: RoomProvenance }>
```

Returns all entries in the internal cache `Map` in insertion order. It never throws, never
modifies cache state, and never triggers generation. Callers perform visited-filtering
against `WorldState` externally.

### Ordering and cap policy

The cap policy (user-approved) is **current-room-first, then remaining rooms in cache
insertion order** (approximately generation/resolution order), bounded at 16. This is not
true most-recently-used ordering — cache insertion order is used as a deterministic
approximation. Visit-order tracking (a separate sequential counter) is **not** added in v0;
do not describe the snapshot as MRU. Rooms beyond the cap regenerate on deep backtracking.

### Boundaries

`domain/quests/generatedRoomCacheSaveState.ts` sits under the `domain/**` lint block. It may
import `domain/roomSpec.ts` (schema + `RoomSpecSchema`) and `domain/loadRoomSpec.ts` (types
only for `LoadedRoom`). It must not import `react`, `three`, `platform/**`,
`world-session/**`, `interactions/**`, `encounters/**`, `dialogue/**`, `memory/**`,
`persistence/**`, or `server/**`.

`app/restoreGeneratedRoomCache.ts` sits under the `app/**` composition layer. It may import
domain types/functions and `room/SessionRoomCache`. It must not import `renderer/engine/**`
internals, `persistence/**`, or any `RoomGenerator`/`ObjectiveGenerator` port.

`saveSlotStore.ts` gains one optional string field; its existing boundary is unchanged.

`App.tsx` owns all wiring seams. No new lint rule, no `eslint.config.js` change.

## Consequences

- **Backtracking to visited generated rooms is stable after load.** The same room data
  (same object IDs, same exits) is served from the rehydrated cache, so interaction rings
  correctly reflect pre-save flags and the layout is identical to before the save.
- **No LLM/provider call or cost increment on load or backtracking.** The rehydrated cache
  short-circuits `AdjacentRoomPregenerator.resolveRoom`; `shouldStartPerRoomObjectiveAttach`
  is blocked by the seeded memo.
- **Stale current-room objective UI cleared on backtracking to other rooms.** Navigating
  from current room B to restored room A shows A's objective context (null for v0 — non-current
  per-room objective text is not restored) rather than B's quest spec.
- **Current-room objective survives re-entry.** The memo for the current room B is seeded
  with the restored quest attachment; navigating away from B and back shows B's objective again.
- **ADR-0059 quest restore unchanged.** The `generatedQuestJson` path runs independently and
  degrades independently. The cache blob is a non-blocking addition.
- **Authored saves unchanged.** No authored session writes or reads the cache blob.
  All existing authored-world save/load tests remain byte-identical.
- **Safe degradation.** Missing or invalid blob → ADR-0059 single-room restore →
  today's authored-wiring behavior. No error is surfaced.
- **No cost impact.** Load path and backtracking make no LLM/network/generator call
  and do not touch the usage meter.
- **Known limitations:**
  - Warmed-but-unvisited adjacent rooms are not persisted.
  - `WorldBibleSeed` free-text fields and `adjacentThemeSeed` are not restored; forward
    generation after load is theme-consistent (via `themePack`) but not fully identical to
    pre-save speculative rooms.
  - Non-current per-room generated objective text is not restored; navigating to a
    restored cached room shows no quest objective (objective-generation is blocked by memo,
    so no cost is spent, but the text is also gone).
  - Rooms beyond the hard cap (16) regenerate on deep backtracking; they may differ from
    the pre-save version.
  - Full generated-world navigation graph, worldBible, and adjacentThemeSeed restore remain
    future features.
  - Cache insertion order (not true MRU) is used for cap pruning; the deepest room in a
    long linear session may be kept while an earlier branch room is dropped.
