# ADR-0059: Generated Quest Save/Load v0 — safe parked restore-model for generated quest and room state

- **Status:** Accepted — implemented
- **Implemented:** 2026-06-30
- **Date:** 2026-06-30
- **Deciders:** Project owner

## Context

`session-save-load-v0` ([ADR-0029](./ADR-0029-session-save-load-v0.md)) established the
save/load pipeline: an authoritative `SaveGame { schemaVersion, seed, log, snapshot }` is
integrity-checked, parked in a single `localStorage` slot, and re-validated on Continue. The
slot uses a `SlotWrapper { saveGameJson, label, savedAt, currentRoomId? }` envelope where
`saveGameJson` is the sole authoritative field and the rest are display-only metadata.

`generated-room-consequence-journal-v0` ([ADR-0058](./ADR-0058-generated-room-consequence-journal-v0.md))
recorded a known limitation: *"Restored generated sessions do not show a generated
consequence journal in v0. `RestoredPlay` does not persist or rehydrate generated-play
markers such as `objectivesPerRoom` / `storyKind`."*

The gap is wider than the journal. After a Save / Continue / Load cycle for a
prompt-generated session, the following are permanently lost:

| State | Currently saved | Currently restored |
|---|---|---|
| `WorldState.roomStates[id].flags` / `.visited` — interaction flags, visit marks | ✅ event log | ✅ projection from event log |
| `WorldState.player`, `inventory`, `currentRoomId` | ✅ event log | ✅ projection from event log |
| `ActivePlay.questSpec` (generated `QuestSpec`) | ❌ React ref only | ❌ not restored; no quest tracker |
| `ActivePlay.storyKind` (closed enum) | ❌ React ref only | ❌ not restored; no journal story line |
| `ActivePlay.objectivesPerRoom: true` | ❌ composition flag only | ❌ not restored; no generated journal path |
| `ActivePlay.room` (generated `LoadedRoom`) | ❌ not in `SaveGame` | ❌ replaced by authored registry room |
| Quest hints (NPC objective awareness strings) | ❌ React state only | ❌ not restored |

The critical dependency is subtle: **`evaluateCondition`/`evaluateQuest` never read the
room** (`evaluateQuest.ts:18-32`). Objective completion is determined solely by
`WorldState` flags and visit marks, which already survive faithfully. Therefore:

1. Objective **completion** is already correct in the event log — only the **display** (`QuestSpec`) is missing.
2. **Resolved-object visual state** (`resolvedObjectIds`, `entryResolvedObjectIds`) *does*
   require the current room, because `resolvedObjectIds` matches `room.objects[].id` against
   the room's flag keys. Today `handleLoad` re-resolves the room through the **authored**
   `adjacentPregenerator`, which returns a different room whose object ids do not correspond
   to the generated flags — so interaction rings reset even though the flags survived.
3. **Journal and NPC awareness** require `objectivesPerRoom: true` and `storyKind` to be
   present on the active `ActivePlay` when `refreshDerivedViews` runs; neither is restored today.

The fix must not touch the authoritative `SaveGame` schema, the integrity check, the
event log, or the world-session boundary. It must never call any generator or provider
on load. It must be safe to ignore for older saves and for authored sessions.

## Decision

Generated Quest Save/Load v0 parks a second, independent, re-validated blob —
`GeneratedQuestSaveState` — alongside `saveGameJson` in the existing save slot. The
authoritative `SaveGame` schema and its integrity check are **unchanged**. The parked blob
is a **local restore-model aid** only — it holds the minimum pre-validated data needed to
reconstruct the generated quest UI state from the already-restored authoritative
`WorldState`.

On Continue/Load: if a valid `generatedQuestJson` blob is present, the restore path uses
the parked room data and quest state to enter generated play with the correct object-ID
mapping, visible objective, correct completion display, and re-projected journal and NPC
awareness. If the blob is absent or fails re-validation, the path degrades to today's
authored-fallback behavior with no error.

The defining constraint: **the parked blob is never truth**. `WorldSession`, the event
log, and the projected `WorldState` remain the sole source of all authoritative facts. The
blob only provides the re-display context that pure in-memory React state cannot survive
across a page reload.

### Authority invariants — hard constraints

The parked blob and all restore logic **must not** and **do not**:

- Append `WorldEvent`s or `WorldCommand`s.
- Mutate `WorldState`, `roomStates`, `player.status`, or `inventory`.
- Change objective-completion semantics. `evaluateQuest(questSpec, worldState)` remains
  the sole completion evaluation path, driven entirely by restored `WorldState`.
- Change object-state persistence semantics. `resolvedObjectIds(room, roomState)` is
  unchanged; the parked room only makes the room's object ids match the already-correct
  flags again.
- Write NPC memory, room memory, or any memory layer.
- Make any LLM, network, generator, or objective-provider call.
- Call `recordAttempt` or increment the cost/usage meter.
- Change the authoritative `SaveGame` schema (`domain/world/saveGame.ts`) or its `SaveGameSchema`.
- Change `WorldStateSchema`, `RoomSpecSchema`, `QuestSpecSchema`, or any
  `schemaVersion` field.
- Change any world-session, event-log, interaction, encounter, or reducer behavior.
- Restore generated adjacent room cache, worldBible-seeded pregeneration, or
  `NavigationService`. Onward navigation after a generated load uses today's authored
  wiring — this is a documented known limitation.

### Content safety constraints — hard constraints

The parked blob **must not** contain or expose:

- Raw user prompt text or generated room prompt text.
- Provider output, raw LLM response body, or generated JSON as a string.
- `WorldBibleSeed` free-text fields (`hook`, `firstObjective`, `pressure`, `premise`,
  `title`, `majorConflict`, `canonNotes`, `openingContext`).
- Raw generated room description text or `room.name` in any log line.
- Interaction `title`, `body`, or `prompt` text from generated objects (these are part of
  `RoomSpec.objects[].interaction` and are parked as data fields inside the validated
  `RoomSpec`, not surfaced in UI or logs).
- NPC names or dialogue text.
- `GeneratedObjectiveSpec` raw JSON (the unassembled provider output).
- Structural room ids, flag key strings, or object id strings in UI display or logs.

**Permitted in the parked blob (as stored data only, not surfaced in UI or logs):**

| Field | Why permitted | Safety condition |
|---|---|---|
| `room: RoomSpec` (validated objects, ids included) | Object ids are needed so `resolvedObjectIds` can match them to the surviving flags | Ids are internal stored data; never logged, never displayed to the player |
| `questSpec: QuestSpec` | Already-sanitized display strings (title, objective text) + closed condition (room-flag / room-visited / has-item / has-status) | Passed through `assembleObjective` + `sanitizeObjectiveText`; structural ids already removed |
| `storyKind: GeneratedStoryThreadKind` | Closed enum; 5 values | Logged only as a safe enum (or not at all) |
| `objectivesPerRoom: true` | Literal boolean flag | Non-content |
| `hints: { hint, completionHint }` | Already-sanitized display strings from `assembleObjective` | Subject to the same `sanitizeObjectiveText` pass; must be safety-tested |

**What must not appear in logs on save or load:**
Room name, object names, interaction text, quest title, objective text, flag keys, object
ids, structural room ids, hint text, provider content, `SaveGame` JSON body, or any
narrative content. Log lines may contain only: `sessionId`, `revision`, `eventCount`,
safe boolean flags (`generatedQuestSaved`, `generatedQuestRestored`), fixed error codes,
and counts.

### Data model

**`GeneratedQuestSaveStateSchema`** (in `domain/quests/generatedQuestSaveState.ts`):

```ts
GeneratedQuestSaveStateSchema = z.object({
  schemaVersion: z.literal(1),
  room: RoomSpecSchema,
  objectivesPerRoom: z.literal(true),
  questSpec: QuestSpecSchema.optional(),
  storyKind: GeneratedStoryThreadKindSchema.optional(),
  hints: z.object({
    hint: z.string().min(1).max(GENERATED_OBJECTIVE_TEXT_MAX_LENGTH),
    completionHint: z.string().min(1).max(GENERATED_OBJECTIVE_TEXT_MAX_LENGTH),
  }).strict().optional(),
}).strict()
```

Where `GeneratedStoryThreadKindSchema` is a closed `z.enum(['escape', 'investigate', 'survive', 'rescue', 'recover-item'])` defined locally (same values as the domain type; avoids importing the full `generatedStoryThread` module into the schema file purely for the enum values — or imports just the type and defines the enum locally).

**`GeneratedQuestSaveInput`** (pure function input type, defined alongside the schema):

```ts
type GeneratedQuestSaveInput = {
  room: LoadedRoom
  objectivesPerRoom: true
  questSpec?: QuestSpec
  storyKind?: GeneratedStoryThreadKind
  hints?: { hint: string; completionHint: string }
}
```

**`buildGeneratedQuestSaveState(input: GeneratedQuestSaveInput): GeneratedQuestSaveState | null`**

Pure, total, synchronous, side-effect-free. Projects the validated `LoadedRoom` into a
`RoomSpec` for parking (takes only the validated `objects` array, stripping `skipped`,
`warnings`, and `skippedObjectReasonCounts`). Returns `null` only if `QuestSpecSchema` or
final `GeneratedQuestSaveStateSchema` parse fails (should not occur for well-formed input;
guards against implementation bugs).

**`loadGeneratedQuestSaveState(json: string): LoadGeneratedQuestSaveStateResult`**

Pure, total, synchronous. Mirrors `loadSaveGame`: JSON-parse → version envelope check →
full schema validation. Returns `{ ok: true; state }` or `{ ok: false; code }`. Rejects
unknown versions (`unsupported-version`), malformed JSON (`invalid-json`), and
schema-invalid blobs (`invalid-schema`). Never throws.

**`SlotWrapper` extension** (in `saveSlotStore.ts`):

```ts
type SlotWrapper = SlotMeta & {
  saveGameJson: string
  generatedQuestJson?: string  // optional parked blob; never authoritative
}
```

`SaveSlotStore.write` gains an optional `generatedQuestJson?: string` parameter.
`SlotReadResult` (ok branch) gains an optional `generatedQuestJson?: string` field.
Both changes are backward-compatible: older wrappers missing the field read as `undefined`;
authored saves never write the field.

### Save path

In `handleSave` (App.tsx):

1. Existing `saveGameService.saveSession` + `saveSlotStore.write` are unchanged in behavior.
2. Additionally: if `activePlay.objectivesPerRoom === true`, call
   `buildGeneratedQuestSaveState({ room, questSpec, storyKind, objectivesPerRoom: true, hints })`.
   Pass the result (serialized) as `generatedQuestJson` to `saveSlotStore.write`.
   If `buildGeneratedQuestSaveState` returns `null` (schema guard), log a fixed safe code
   and omit the field — the save succeeds without the generated blob.
3. For authored sessions (`objectivesPerRoom` not `true`): do not pass `generatedQuestJson`
   → `SlotWrapper` is byte-identical to today.

`hints` access: requires a `questHintsRef` (mirroring the existing `questSpecRef` pattern)
so the stable `handleSave` closure can read them without stale state. Add
`questHintsRef = useRef<QuestHintState | null>(null)` alongside existing refs; update it
wherever `setQuestHints` is called.

### Load path

In `handleLoad` (App.tsx), after the existing WorldState restore succeeds:

1. Read `slotResult.generatedQuestJson` (optional string from `saveSlotStore.read`).
2. If present: call `loadGeneratedQuestSaveState(json)`.
3. If `{ok: true; state}`: call `restoreGeneratedQuestPlay(state, restoredWorldState)`
   (composition helper in `app/restoreGeneratedQuestPlay.ts`) to obtain the generated-play
   `ActivePlay` fields.
4. If `{ok: false}` or blob absent: fall back to today's authored-world path exactly
   (`isAuthoredWorld` gate, `demoQuestSpec`, `demoJournalSpec`). No error is surfaced.
5. `enterActivePlay`, `refreshDerivedViews`, `setSaveLoadStatus('idle')` — unchanged call
   order.

**`restoreGeneratedQuestPlay`** (composition helper in `app/restoreGeneratedQuestPlay.ts`):

Takes `(state: GeneratedQuestSaveState, worldState: WorldState)`. Returns a subset of
`ActivePlay` fields: `{ room: LoadedRoom, roomSource, roomCache, initialPlayer, questSpec?, storyKind?, objectivesPerRoom: true, entryResolvedObjectIds? }`.

Steps:
1. Call `loadRoomSpec(state.room)` — re-validates the parked spec through the existing
   strict boundary. If `loadRoomSpec` returns warnings, proceed (warnings are non-fatal).
   Skipped objects in the parked room are rare (the room was already assembled) but safe.
2. Call `resolvedObjectIdsForGeneratedPlay({ objectivesPerRoom: true, state: worldState, room })`.
3. Return the field set. `navigation` and `adjacentPregenerator` remain the authored
   fallback (known limitation; documented in Known Limitations below).

No `assembleRoom`, no enrichment stages, no generator, no provider call. The parked objects
are already the post-assembly output; `loadRoomSpec` is the correct and sufficient boundary.

### Degradation

| Situation | Behavior |
|---|---|
| Older save: no `generatedQuestJson` field | Slot reads fine; `generatedQuestJson` is `undefined`; falls back to authored-world gate; no error |
| Authored save: never wrote `generatedQuestJson` | Byte-identical to today; no change |
| Generated save: `loadGeneratedQuestSaveState` fails (schema changed, corrupt) | Falls back to authored-world gate with `degraded: true` notice; no error surfaced |
| Generated save: `loadRoomSpec(state.room)` fails (envelope invalid) | Falls back to authored-world gate; room from authored pregenerator used; `degraded: true` notice |
| Generated save: no `questSpec` in blob (older generated save) | Restores `objectivesPerRoom: true` + `storyKind`; no quest tracker; journal still re-projects |
| Generated save: no `storyKind` in blob | Restores room + `questSpec`; journal omits story-context entry |

### Boundaries

`domain/quests/generatedQuestSaveState.ts` sits under the `domain/**` lint block. It may
import `domain/roomSpec.ts` (schema), `domain/quests/questSpec.ts` (schema), and
`domain/loadRoomSpec.ts` (types only + function for the build helper). It must not import
`react`, `three`, `platform/**`, `world-session/**`, `interactions/**`, `encounters/**`,
`dialogue/**`, `memory/**`, `persistence/**`, or `server/**`.

`app/restoreGeneratedQuestPlay.ts` sits under the `app/**` composition layer. It may
import domain types/functions, `world-session` (read-only `WorldState` type), platform
logger port, and other `app/**` helpers. It must not import `renderer/engine/**` internals
or `persistence/**`.

`saveSlotStore.ts` gains only a string field addition; its existing boundary (no imports
from renderer, world-session, or domain schema modules) is unchanged.

`App.tsx` owns all wiring seams. No new layer, no new lint rule, no `eslint.config.js`
change.

### Tests

**Domain (`generatedQuestSaveState.test.ts`):**

- Round-trip: `buildGeneratedQuestSaveState(input)` → `JSON.stringify` → `loadGeneratedQuestSaveState` → `{ok: true; state}` with equal fields.
- Returns `null` when `objectivesPerRoom` is not `true`.
- Parked `room` has no `skipped`/`warnings`/`skippedObjectReasonCounts` fields.
- `loadGeneratedQuestSaveState` rejects malformed JSON (`invalid-json`).
- `loadGeneratedQuestSaveState` rejects wrong `schemaVersion` (`unsupported-version`).
- `loadGeneratedQuestSaveState` rejects schema-invalid body (`invalid-schema`).
- `loadGeneratedQuestSaveState` rejects `objectivesPerRoom` not equal to `true`.
- `loadGeneratedQuestSaveState` rejects unknown `storyKind` values.
- Parked hint strings must have structural ids removed (sentinel test).
- `buildGeneratedQuestSaveState` with no `questSpec` → `questSpec` absent from output.
- `buildGeneratedQuestSaveState` with no `storyKind` → `storyKind` absent from output.

**Save-slot (`saveSlotStore.test.ts`):**

- Write with `generatedQuestJson` → read returns same string unchanged.
- Write without `generatedQuestJson` → read returns `generatedQuestJson: undefined`.
- Older wrapper (no `generatedQuestJson` key) reads as `undefined` (back-compat).
- Authored save (no generated blob written) → wrapper byte-identical to today.

**Restore helper (`restoreGeneratedQuestPlay.test.ts`):**

- Valid `GeneratedQuestSaveState` + valid `WorldState` → returns `LoadedRoom` with correct objects (ids match parked spec).
- `resolvedObjectIdsForGeneratedPlay` called with restored room + world state → correct set.
- `loadRoomSpec` is the only room-build call (no generator import).
- Missing optional fields (`questSpec`, `storyKind`, `hints`) → corresponding `ActivePlay` fields absent or undefined.

**App/integration (`App.test.tsx` or `saveGame.test.ts`):**

- Generated session save → slot contains non-empty `generatedQuestJson`.
- Authored session save → slot does not contain `generatedQuestJson`.
- Generated session load (valid blob) → quest tracker visible, correct completion.
- Generated session load (valid blob) → `resolvedObjectIds` for restored room matches pre-save flags.
- Generated session load (missing blob) → authored-world fallback, no crash.
- Generated session load (corrupt blob) → authored-world fallback, no crash.
- Cost meter: load does not call `recordAttempt`; meter count unchanged.
- No generator / objective provider called on load.

**Safety regression:**

- Logged lines on save contain no room name, object name, interaction text, quest title, objective text, hint text, flag keys, or object ids.
- Logged lines on load contain no above content.
- Parked JSON does not contain raw prompt, seed, or WorldBible free-text field values (sentinel assertions).
- `loadRoomSpec` called on restore; `assembleRoom` not called (spy or import assertion).

## Consequences

- **Generated quest state survives Save/Continue/Load.** Quest tracker is visible and
  correctly evaluated after load. Resolved objects retain their visual state. The generated
  consequence journal re-projects. NPC objective awareness re-activates when hints are
  restored.
- **World-session authority unchanged.** The authoritative `SaveGame`, event log, and
  `WorldState` projection are byte-identical to before. The integrity check is not weakened.
- **Object-state and completion semantics unchanged.** `evaluateQuest` and `resolvedObjectIds`
  are called with no parameter or behavior change; their outputs are correct because the
  restored `WorldState` supplies the correct flags and the parked room supplies the correct
  object ids.
- **Authored saves unchanged.** No authored session writes or reads the generated blob.
  All existing authored-world save/load tests remain byte-identical.
- **Safe degradation.** Missing or invalid blob → authored-world fallback → today's behavior.
  No error is surfaced; the `degraded` notice is shown (same as today for non-authored loads).
- **No cost impact.** Load path makes no LLM/network/generator call and does not touch the usage meter.
- **Known limitations:**
  - Generated adjacent room pregeneration is not restored. After a generated load, onward
    navigation uses the authored `adjacentPregenerator` and `exampleNavigation`. This means
    generated adjacent rooms beyond the restored room are not available; the player can
    navigate to authored exits only. Full generated navigation restore requires restoring the
    worldBible-seeded `AdjacentRoomPregenerator` and adjacents cache, which is out of scope
    for v0.
  - Only the current room is restored. Generated rooms visited before the save are not
    recovered as `LoadedRoom` objects; their flags survive (via `WorldState`), but their
    geometry is gone.
  - Journal in restored generated play reflects current-room resolved count only (same as
    live play).
  - `storyKind` is a closed-enum snapshot; if the generated adjacent seed-phrase behavior
    were to change in a future version, restored sessions would use the old kind — acceptable
    because it drives display copy only.
  - This ADR does not solve full generated-world save/load, multi-room generated cache
    persistence, or generated-session navigation restoration. Those remain future features.
