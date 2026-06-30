# Implementation Plan: Generated Quest Save/Load v0

> Feature branch: `feature/generated-quest-save-load-v0`
> ADR: [ADR-0059](../decisions/ADR-0059-generated-quest-save-load-v0.md)
> Status: **implemented — slices 1–5 complete; docs closeout complete**

## Overview

Parks an optional `GeneratedQuestSaveState` blob alongside the existing authoritative
`saveGameJson` in the local save slot. On Continue/Load, if the blob is present and
re-validates, restores the generated room, quest, story-kind, and resolved-object state
from it — with no LLM call, no objective regeneration, no cost increment, and no change to
the authoritative `SaveGame` schema or world-session boundary. Older saves and authored
sessions degrade safely.

**Key architectural fact:** `evaluateQuest`/`evaluateCondition` never read the room.
Objective completion is determined solely by `WorldState` flags, which already survive
faithfully in the event log. Therefore the only missing display data is: (1) the `QuestSpec`
itself, and (2) the parked room whose object ids let `resolvedObjectIds` match the surviving
flags again. Everything else (`JournalView`, HUD, resolved-ring visual state) falls out of
the existing projectors once these two are present.

## Minimum Safe Change Check

| Question | Answer |
|---|---|
| What existing code is reused? | `RoomSpecSchema`, `QuestSpecSchema` (domain schemas); `loadRoomSpec` (boundary); `evaluateQuest`, `resolvedObjectIds`, `resolvedObjectIdsForGeneratedPlay` (domain pure functions); `computeDerivedViews` / `refreshDerivedViews` seam; existing `SlotWrapper`/`saveSlotStore` envelope; `buildRestoredPlay` result shape; `questSpecRef` / `activePlayRef` ref pattern; `QuestSpec` sanitization from `assembleObjective` |
| What new code is actually necessary? | One domain schema + two pure functions (~80 lines); one slot-store field addition (~15 lines); one composition restore helper (~40 lines); targeted additions to `handleSave` and `handleLoad` in `App.tsx` (~30 lines); one new ref (`questHintsRef`) |
| What safety boundaries remain unchanged? | `SaveGame` schema + integrity check; world-session authority; event-log append-only rule; all `schemaVersion` fields; `evaluateQuest` + `resolvedObjectIds` call sites; `assembleObjective` sanitization pipeline; cost/usage guardrail; renderer trust boundary; log discipline |
| What targeted tests prove the change? | Round-trip domain tests; slot backward-compat tests; restore-helper unit tests; App integration tests; safety sentinel assertions; cost-meter regression; no-generator-call assertion |

---

## Files

### New files

| File | Created in slice |
|---|---|
| `apps/web/src/domain/quests/generatedQuestSaveState.ts` | Slice 1 |
| `apps/web/src/domain/quests/generatedQuestSaveState.test.ts` | Slice 1 |
| `apps/web/src/app/restoreGeneratedQuestPlay.ts` | Slice 3 |
| `apps/web/src/app/restoreGeneratedQuestPlay.test.ts` | Slice 3 |
| `docs/architecture/decisions/ADR-0059-generated-quest-save-load-v0.md` | Docs (done) |
| `docs/architecture/implementation-plans/generated-quest-save-load-v0.md` | Docs (done) |

### Modified files

| File | Modified in slice | Change summary |
|---|---|---|
| `apps/web/src/app/saveSlotStore.ts` | Slice 2 | Optional `generatedQuestJson` on wrapper, `write`, and read result |
| `apps/web/src/app/saveSlotStore.test.ts` | Slice 2 | New backward-compat and round-trip cases |
| `apps/web/src/App.tsx` | Slices 4, 5 | Save wiring (Slice 4); load wiring + `questHintsRef` (Slice 5) |
| `apps/web/src/App.test.tsx` | Slices 4, 5 | New save/load integration coverage |
| `docs/architecture/ARCHITECTURE.md` | Slice 6 | ✅ status entry for this feature |
| `docs/architecture/FAILURE-MODES.md` | Slice 6 | Degradation entry under §10 / new §29 update |

### Files to avoid — do not touch

- `apps/web/src/domain/world/saveGame.ts` — authoritative `SaveGame` schema unchanged
- `apps/web/src/world-session/saveGame.ts` — `SaveGameService` unchanged
- `apps/web/src/world-session/saveGame.test.ts` — unchanged
- `apps/web/src/app/buildRestoredPlay.ts` — unchanged (restore helper is a new file)
- `apps/web/src/domain/world/worldState.ts` — `WorldState` schema unchanged
- `apps/web/src/domain/quests/questSpec.ts` — `QuestSpec` schema unchanged
- `apps/web/src/domain/quests/assembleObjective.ts` — assembly pipeline unchanged
- `apps/web/src/domain/quests/evaluateQuest.ts` — unchanged
- `apps/web/src/domain/interactions/resolvedObjects.ts` — unchanged
- `apps/web/src/domain/journal/generatedConsequenceJournal.ts` — unchanged
- `apps/web/src/app/derivedViews.ts` — unchanged
- `apps/web/src/domain/generatedStoryThread.ts` — unchanged
- `apps/web/src/generation/**` — no generator changes
- `apps/web/src/world-session/**` (except via existing ports) — no session changes
- `apps/web/src/interactions/**`, `encounters/**`, `dialogue/**`, `memory/**`
- `apps/web/src/persistence/**`, `apps/web/src/server/**`
- `apps/web/src/renderer/**`
- `eslint.config.js`
- `package.json`

---

## Safety invariants (all slices)

These must hold throughout implementation and be asserted by tests:

1. **No authority change.** `WorldSession` + event log + reducers remain the sole truth
   source. Objective completion is always `evaluateQuest(restoredQuestSpec, restoredWorldState)`.
   The parked blob never overrides `WorldState`.

2. **No content leakage in UI or logs.** Logs on save or load must not contain room name,
   object name, interaction text, quest title, objective text, hint text, flag key strings,
   object id strings, or structural room id strings. The parked blob stores them as internal
   data only; none surface in the UI or log output.

3. **No raw provider/prompt/WorldBible text in the parked blob.** The blob contains only
   already-validated `RoomSpec` data and already-sanitized `QuestSpec`/hints (both passed
   through `assembleObjective` + `sanitizeObjectiveText` before reaching `ActivePlay`).
   It never contains the raw `GeneratedObjectiveSpec` JSON or any WorldBible free-text field.

4. **No schema change.** `SaveGame`, `WorldState`, `RoomSpec`, `QuestSpec`
   `schemaVersion` fields all remain `1`. No new field is added to any of these schemas.

5. **No semantics change.** `evaluateQuest`, `resolvedObjectIds`, `computeDerivedViews`,
   and `refreshDerivedViews` signatures and behavior are unchanged. Their call sites are
   not modified except to pass the same data from a restored source instead of live state.

6. **No generator / provider call on load.** `loadRoomSpec` (not `assembleRoom`, not any
   enrichment stage, not any `RoomGenerator` or `ObjectiveGenerator`) is the only room-build
   call during restore. A test must assert no generator import is present in `restoreGeneratedQuestPlay.ts`.

7. **No cost meter increment on load.** `recordAttempt` is not called in any load path. A
   test must assert `usageCount` is unchanged before and after load.

8. **Authored saves unchanged.** No authored session writes `generatedQuestJson`. All
   existing `saveGame.test.ts`, `saveSlotStore.test.ts`, and authored `App.test.tsx`
   tests pass without modification.

9. **Backward compatibility.** A save slot without `generatedQuestJson` reads and loads
   without error; the load falls back to the existing authored-world gate exactly.

10. **Log discipline.** New log lines on save/load use only safe counts and fixed codes:
    `generatedQuestSaved: boolean`, `generatedQuestRestored: boolean`, `code` (fixed enum).
    Never log the parked JSON itself or any of its content fields.

---

## Slice 1 — Pure generated quest save-state model

**Goal:** ship `GeneratedQuestSaveStateSchema`, `buildGeneratedQuestSaveState`, and
`loadGeneratedQuestSaveState` as a standalone, fully tested pure domain module.
Zero runtime behavior change. Zero App or slot change.

**Prerequisite:** none.

### Files

**Add:**
- `apps/web/src/domain/quests/generatedQuestSaveState.ts`
- `apps/web/src/domain/quests/generatedQuestSaveState.test.ts`

**Do not touch any other file.**

### Module specification

**Location:** `apps/web/src/domain/quests/generatedQuestSaveState.ts`

**Permitted imports (domain layer only):**
- `zod` (schema definition)
- `../roomSpec` (types + `RoomSpecSchema`)
- `./questSpec` (types + `QuestSpecSchema`)
- `../loadRoomSpec` (types only — `LoadedRoom`)
- `./generatedObjectiveSpec` (constants only — `GENERATED_OBJECTIVE_TEXT_MAX_LENGTH`)

**Must not import:** `react`, `three`, `platform/**`, `world-session/**`,
`interactions/**`, `encounters/**`, `dialogue/**`, `memory/**`, `persistence/**`,
`server/**`, `renderer/**`, `app/**`, `generation/**`.

**Exports:**

```ts
// The parked snapshot schema (schemaVersion = 1)
export const GeneratedQuestSaveStateSchema: ZodObject<...>
export type GeneratedQuestSaveState = z.infer<typeof GeneratedQuestSaveStateSchema>

// The version envelope schema for fast rejection without full parse
export const GeneratedQuestSaveStateVersionEnvelopeSchema: ZodObject<...>

// Input type for the build function (takes domain types only, not ActivePlay)
export type GeneratedQuestSaveInput = {
  room: LoadedRoom
  objectivesPerRoom: true
  questSpec?: QuestSpec
  storyKind?: GeneratedStoryThreadKind
  hints?: { hint: string; completionHint: string }
}

// Error codes for the load function
export type GeneratedQuestSaveLoadCode =
  | 'invalid-json'
  | 'unsupported-version'
  | 'invalid-schema'

export type LoadGeneratedQuestSaveStateResult =
  | { ok: true; state: GeneratedQuestSaveState }
  | { ok: false; code: GeneratedQuestSaveLoadCode }

// Build: pure, total, synchronous
// Returns null only if the final schema safeParse fails (schema guard)
export function buildGeneratedQuestSaveState(
  input: GeneratedQuestSaveInput,
): GeneratedQuestSaveState | null

// Load: pure, total, synchronous, throw-free
export function loadGeneratedQuestSaveState(
  json: string,
): LoadGeneratedQuestSaveStateResult
```

**Schema shape:**

```ts
GeneratedQuestSaveStateSchema = z.object({
  schemaVersion: z.literal(1),
  room: RoomSpecSchema,
  objectivesPerRoom: z.literal(true),
  questSpec: QuestSpecSchema.optional(),
  storyKind: z.enum(['escape', 'investigate', 'survive', 'rescue', 'recover-item']).optional(),
  hints: z.object({
    hint: z.string().min(1).max(GENERATED_OBJECTIVE_TEXT_MAX_LENGTH),
    completionHint: z.string().min(1).max(GENERATED_OBJECTIVE_TEXT_MAX_LENGTH),
  }).strict().optional(),
}).strict()
```

**`buildGeneratedQuestSaveState` logic:**

1. Project `room: LoadedRoom` → `room: RoomSpec` by taking only the RoomSpec-shaped fields
   (`schemaVersion`, `id`, `name`, `floor`, `spawn`, `lighting`, `objects`). Drop `skipped`,
   `warnings`, `skippedObjectReasonCounts` — these are load-time diagnostics, not spec data.
2. Build candidate object with all optional fields present only when provided.
3. `safeParse` through `GeneratedQuestSaveStateSchema`. Return `null` on failure; return
   `.data` on success.

**`loadGeneratedQuestSaveState` logic:**

1. `JSON.parse` → catch → `{ok: false, code: 'invalid-json'}`.
2. `GeneratedQuestSaveStateVersionEnvelopeSchema.safeParse` → failure → `'invalid-schema'`.
3. `schemaVersion !== 1` → `'unsupported-version'`.
4. `GeneratedQuestSaveStateSchema.safeParse` → failure → `'invalid-schema'`.
5. `{ok: true, state: parsed.data}`.

### Test plan — Slice 1

File: `apps/web/src/domain/quests/generatedQuestSaveState.test.ts`

Pure Vitest only. No DOM, no jsdom, no `@testing-library`. Reuse or inline minimal
`RoomSpec` / `QuestSpec` fixtures consistent with the existing test style in
`assembleObjective.test.ts` and `generatedObjectiveSpec.test.ts`.

**Required test cases:**

1. **Round-trip: full input.** `buildGeneratedQuestSaveState` with all optional fields
   → JSON.stringify → `loadGeneratedQuestSaveState` → `{ok: true}` → all fields equal the
   input.

2. **Round-trip: minimal input (room + objectivesPerRoom only).** No `questSpec`,
   `storyKind`, or `hints` → load succeeds; optional fields absent in result.

3. **Parked room has no load-time diagnostics.** Output `room` must not have
   `skipped`, `warnings`, or `skippedObjectReasonCounts` keys.

4. **`objectivesPerRoom` must be literal `true`.** Schema rejects `objectivesPerRoom: false`
   with `invalid-schema`.

5. **`storyKind` closed enum enforcement.** Schema rejects `storyKind: 'unknown-kind'`
   with `invalid-schema`. Accepts each of the five valid values.

6. **`loadGeneratedQuestSaveState` rejects non-JSON input.** Returns `{ok: false, code: 'invalid-json'}`.

7. **`loadGeneratedQuestSaveState` rejects wrong `schemaVersion`.** `schemaVersion: 2`
   → `{ok: false, code: 'unsupported-version'}`.

8. **`loadGeneratedQuestSaveState` rejects missing `schemaVersion`.** → `{ok: false, code: 'invalid-schema'}`.

9. **`loadGeneratedQuestSaveState` rejects missing `room` field.** → `{ok: false, code: 'invalid-schema'}`.

10. **`loadGeneratedQuestSaveState` rejects extra top-level keys** (strict schema). → `'invalid-schema'`.

11. **`buildGeneratedQuestSaveState` returns `null` on invalid room.** Pass a `LoadedRoom`
    whose projected `RoomSpec` fails `RoomSpecSchema` (e.g., empty `id`) → returns `null`.

12. **Hints truncation safety.** Build with hint string exactly at `GENERATED_OBJECTIVE_TEXT_MAX_LENGTH`
    → round-trips unchanged. Build with hint string over the limit → schema rejects (the
    limit is enforced by the schema; `assembleObjective` guarantees already-truncated strings
    on the live path).

13. **Safety sentinel — no structural id leakage from hints field.** If a hint string
    contains `'interaction:some-id'` (a structural id that `sanitizeObjectiveText` would
    normally strip), the schema still parses it (length-valid); assert that the *test*
    confirms this would only be reachable if `sanitizeObjectiveText` was bypassed. The
    actual test: build a hint string that was already sanitized (no structural id pattern)
    → round-trips cleanly. **Document** that the safety guarantee depends on the live path
    always passing hints through `assembleObjective` first.

14. **Purity.** Input `LoadedRoom` and `QuestSpec` references are deep-equal before and
    after `buildGeneratedQuestSaveState` (no mutation). Two calls with identical inputs
    produce equal outputs.

15. **Module import constraint.** Assert the module does not re-export any type from
    `world-session/**`, `generation/**`, `app/**`, or `renderer/**`. (Can be a static
    import-boundary assertion or a compile-time check via the build step.)

### Verification commands — Slice 1

```bash
# Targeted test (primary gate)
npm run test -- generatedQuestSaveState

# Type-check (catches domain import violations mechanically)
npm run build

# Lint (catches no-console, no-restricted-imports)
npm run lint
```

Confirm all three pass. Do not run the full test suite yet — only the targeted file.

### Stop point — Slice 1

Hand off after targeted test + build + lint all pass with no errors. No App or slot
wiring. No UI change. No other test suite touched. Await approval before Slice 2.

---

## Slice 2 — Slot parking

**Goal:** extend `saveSlotStore` with an optional `generatedQuestJson` string. Older
wrappers missing the field read as `undefined`. Authored saves never write the field.
No App wiring yet; no generation or restoration logic yet.

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
  generatedQuestJson?: string
}
```

**`isSlotWrapper`:** add `'generatedQuestJson' in value ? typeof value.generatedQuestJson === 'string' : true`
to the type guard (allows absence; rejects a present non-string value).

**`SlotReadResult` (ok branch):**
```ts
| { ok: true; saveGameJson: string; meta: SlotMeta; generatedQuestJson?: string }
```

**`read()` implementation:** when `isSlotWrapper(parsed)` passes, additionally extract
`generatedQuestJson` if it is a `string`; otherwise omit it. The field is only copied
through, never parsed or validated here.

**`SaveSlotStore` interface — `write` signature:**
```ts
write(
  saveGameJson: string,
  meta?: Partial<SlotMeta>,
  generatedQuestJson?: string,
): SlotWriteResult
```

**`write()` implementation:** include `generatedQuestJson` in the wrapper only when
provided and non-empty; otherwise omit the key so older-format wrappers are produced for
authored sessions.

No other change to `saveSlotStore.ts`. `has()` and `clear()` are unchanged.

### Test plan — Slice 2

File: `apps/web/src/app/saveSlotStore.test.ts` (extend existing tests; do not replace).

**Required new test cases:**

1. **Write with `generatedQuestJson` → read returns the same string.**
   `write(json, meta, blobStr)` → `read()` → `{ok: true, generatedQuestJson: blobStr}`.

2. **Write without `generatedQuestJson` → read returns `undefined`.**
   `write(json, meta)` → `read()` → `generatedQuestJson` is `undefined`.

3. **Write with empty string → omitted (treated as absent).**
   `write(json, meta, '')` → `read()` → `generatedQuestJson` is `undefined`.

4. **Older wrapper (no `generatedQuestJson` key in stored JSON) → reads without error.**
   Manually write a wrapper without the field to the KV store →
   `read()` → `{ok: true, generatedQuestJson: undefined}`.

5. **Non-string `generatedQuestJson` in stored wrapper → reads as corrupt.**
   Manually write a wrapper with `generatedQuestJson: 42` → `read()` → `{ok: false, reason: 'corrupt'}`.

6. **Existing test suite passes unchanged.** All pre-existing `saveSlotStore.test.ts`
   cases must remain green without modification.

### Verification commands — Slice 2

```bash
# Targeted test
npm run test -- saveSlotStore

# Type-check and lint
npm run build
npm run lint
```

### Stop point — Slice 2

Hand off after targeted test + build + lint all pass. No App or generation wiring. Await
approval before Slice 3.

---

## Slice 3 — Restore helper

**Goal:** ship `restoreGeneratedQuestPlay` as a standalone, tested composition helper
that converts a validated `GeneratedQuestSaveState` + restored `WorldState` into the
`ActivePlay` fields needed to enter generated play after load.

**Prerequisite:** Slices 1 and 2 approved.

### Files

**Add:**
- `apps/web/src/app/restoreGeneratedQuestPlay.ts`
- `apps/web/src/app/restoreGeneratedQuestPlay.test.ts`

**Do not touch any other file.**

### `restoreGeneratedQuestPlay.ts` specification

**Location:** `apps/web/src/app/` (composition layer).

**Permitted imports:**
- `../domain/quests/generatedQuestSaveState` (types)
- `../domain/loadRoomSpec` (`loadRoomSpec` function + `LoadedRoom` type)
- `../domain/world/worldState` (types)
- `../renderer/ui/playerHud` (`projectPlayerHud`)
- `../domain/ports/RoomSource` (type for `preloadedRoomSource` helper)
- `./App.helpers` (`resolvedObjectIdsForGeneratedPlay`)
- `../room/SessionRoomCache`

**Must not import:** `generation/**`, `world-session/**` (beyond type-only use of
`WorldState`), `renderer/engine/**`, `persistence/**`, `server/**`, any `ObjectiveGenerator`
or `RoomGenerator` port.

**Exported types:**

```ts
export type RestoredGeneratedQuestPlay = {
  room: LoadedRoom
  roomSource: RoomSource
  roomCache: SessionRoomCache
  initialPlayer: PlayerHudView
  questSpec?: QuestSpec
  storyKind?: GeneratedStoryThreadKind
  objectivesPerRoom: true
  entryResolvedObjectIds?: ReadonlySet<string>
}

export type RestoreGeneratedQuestPlayResult =
  | { ok: true; play: RestoredGeneratedQuestPlay }
  | { ok: false; code: 'room-load-failed' }
```

**Exported function:**

```ts
export function restoreGeneratedQuestPlay(
  state: GeneratedQuestSaveState,
  worldState: WorldState,
): RestoreGeneratedQuestPlayResult
```

**Logic:**

1. Call `loadRoomSpec(state.room)`. This is a synchronous call (no generator, no network,
   no `assembleRoom` enrichment). The parked objects are already post-assembly output; the
   strict `loadRoomSpec` boundary is the correct and sufficient re-validation step.
   - If `loadRoomSpec` returns a room with warnings or skipped objects, **proceed** —
     warnings are non-fatal, and skipped objects in a parked room are rare but safe.
   - There is no error path from `loadRoomSpec` itself (it is total); a room with envelope
     failures would have been caught at save time by `buildGeneratedQuestSaveState`.
2. Build a `SessionRoomCache` seeded with the restored room at its id.
3. Build a `preloadedRoomSource` for the restored room (same pattern as `buildRestoredPlay`).
4. Call `resolvedObjectIdsForGeneratedPlay({ objectivesPerRoom: true, state: worldState, room })`.
5. Return `{ ok: true, play: { room, roomSource, roomCache, initialPlayer, questSpec, storyKind, objectivesPerRoom: true, entryResolvedObjectIds } }`.
   Include `questSpec`, `storyKind`, `hints` only when present in `state`.

Note: `navigation`, `adjacentPregenerator`, and `worldBible` are **not** set here. The
caller (`handleLoad` in `App.tsx`) supplies the authored fallback wiring for these. This is
the documented v0 known limitation (onward generated navigation not restored).

### Test plan — Slice 3

File: `apps/web/src/app/restoreGeneratedQuestPlay.test.ts`

Pure Vitest. No DOM. Minimal fixture helpers; reuse or inline world-state builders
consistent with `buildRestoredPlay.test.ts`.

**Required test cases:**

1. **Valid state + WorldState → ok result with LoadedRoom.** Parked room has known object
   ids; restored `LoadedRoom.objects` has same ids. `ok: true`.

2. **Object ids in restored room match parked spec.** Assert
   `restoredRoom.objects.map(o => o.id)` equals the parked `state.room.objects.map(o => o.id)`.

3. **`resolvedObjectIdsForGeneratedPlay` called with correct args.** Set a flag
   `'interaction:case-file': true` in `worldState.roomStates[room.id]`. Assert
   `play.entryResolvedObjectIds` contains `'case-file'`.

4. **`questSpec` present when state includes it.** `state.questSpec` set → `play.questSpec`
   equals it.

5. **`questSpec` absent when state omits it.** `state.questSpec = undefined` →
   `play.questSpec` is `undefined`.

6. **`storyKind` round-trips.** Each of the five valid values → restored play carries it.

7. **`storyKind` absent when omitted.** `state.storyKind = undefined` → `play.storyKind`
   is `undefined`.

8. **`objectivesPerRoom` is always `true`.** Assert `play.objectivesPerRoom === true`.

9. **`navigation` and `adjacentPregenerator` are not set on the return value.** Assert
   both are absent / `undefined` on `RestoredGeneratedQuestPlay`.

10. **No generator import.** Assert `restoreGeneratedQuestPlay.ts` does not import any
    symbol from `generation/**` (static import assertion or build check).

11. **`loadRoomSpec` is the only room-reconstruction call.** Assert no call to
    `assembleRoom`, `repairRoom`, `validateRoom`, or any `RoomGenerator` port occurs.
    (Use a spy or import-graph assertion.)

12. **Purity / no mutation.** Input `GeneratedQuestSaveState` and `WorldState` are
    deep-equal before and after the call.

### Verification commands — Slice 3

```bash
# Targeted tests
npm run test -- restoreGeneratedQuestPlay

# Type-check and lint
npm run build
npm run lint
```

### Stop point — Slice 3

Hand off after targeted test + build + lint all pass. No App wiring yet. Await approval
before Slice 4.

---

## Slice 4 — App save wiring

**Goal:** `handleSave` builds and parks the `generatedQuestJson` blob for generated play.
No behavior change for authored saves. The existing save/load path is unchanged.

**Prerequisite:** Slices 1–3 approved.

### Files

**Modify:**
- `apps/web/src/App.tsx`
- `apps/web/src/App.test.tsx`

**Do not touch** `saveSlotStore.ts`, `buildRestoredPlay.ts`, `restoreGeneratedQuestPlay.ts`,
domain files, or world-session files.

### `App.tsx` changes

**Add `questHintsRef`:**

```ts
const questHintsRef = useRef<QuestHintState | null>(null)
```

Alongside the existing `questSpecRef`. Update it every place `setQuestHints` is currently
called (same synchronous update pattern as `questSpecRef`). This makes hints accessible
inside the stable `handleSave` closure without stale state.

**`handleSave` addition** (inside the existing async IIFE, after the successful
`saveSlotStore.write` call — only write the generated blob when the main save succeeded):

```ts
// Generated play only: park the restore-model blob alongside the authoritative save.
let generatedQuestJson: string | undefined
if (activePlay.objectivesPerRoom === true) {
  const saveState = buildGeneratedQuestSaveState({
    room: activePlay.room,
    objectivesPerRoom: true,
    questSpec: activePlay.questSpec,
    storyKind: activePlay.storyKind,
    hints: questHintsRef.current ?? undefined,
  })
  if (saveState != null) {
    generatedQuestJson = JSON.stringify(saveState)
  }
  // If null (schema guard), omit the blob silently — the main save already succeeded.
}
const writeResult = saveSlotStore.write(saveResult.json, { ... }, generatedQuestJson)
```

Note: `buildGeneratedQuestSaveState` is imported from `domain/quests/generatedQuestSaveState`.
The `generatedQuestJson` argument to `saveSlotStore.write` is `undefined` for authored
sessions, so their `SlotWrapper` is byte-identical to today.

**No other `App.tsx` change in this slice.** The load path is Slice 5.

### Test plan — Slice 4

File: `apps/web/src/App.test.tsx` (extend; do not replace).

**Required new test cases:**

1. **Generated session save → `generatedQuestJson` present in slot.**
   After `handlePrompt` resolves and `handleSave` is called, `saveSlotStore.read()` returns
   a non-empty `generatedQuestJson` string.

2. **`generatedQuestJson` is valid `GeneratedQuestSaveState`.** Parse it through
   `loadGeneratedQuestSaveState` → `{ok: true}`.

3. **Authored session save → `generatedQuestJson` absent in slot.**
   Bootstrap example world, call save → `saveSlotStore.read().generatedQuestJson` is
   `undefined`.

4. **`questHintsRef` is updated when hints are set.** After a generated session with
   an attached objective, `questHintsRef.current` equals the hints passed to `setQuestHints`.
   (May be an implementation-internal assertion; can be tested via the saved blob containing
   the hints field.)

5. **`buildGeneratedQuestSaveState` returning `null` (mocked) does not break the save.**
   Mock `buildGeneratedQuestSaveState` to return `null` → save still completes successfully;
   slot has no `generatedQuestJson` but `saveGameJson` is present.

6. **Existing save tests pass unchanged.** All pre-existing save-related `App.test.tsx`
   cases remain green.

### Verification commands — Slice 4

```bash
# Targeted tests
npm run test -- saveGame
npm run test -- App

# Type-check and lint
npm run build
npm run lint
```

### Stop point — Slice 4

Hand off after targeted test + build + lint all pass. Do not proceed to load wiring
without approval.

---

## Slice 5 — App load wiring

**Goal:** `handleLoad` reads, re-validates, and restores the `generatedQuestJson` blob.
Generated sessions enter play with the correct room, objective, story markers, and
resolved-object state. Authored sessions and older saves degrade to existing behavior.
No provider or generator call.

**Prerequisite:** Slices 1–4 approved.

### Files

**Modify:**
- `apps/web/src/App.tsx`
- `apps/web/src/App.test.tsx`

### `App.tsx` changes

**`handleLoad` — after the existing WorldState restore (after `stateResult.state` is
obtained and `buildRestoredPlay` is called):**

```ts
// Attempt generated-play restore from the parked blob.
const generatedQuestJson = slotResult.generatedQuestJson
let restoredGeneratedPlay: RestoredGeneratedQuestPlay | null = null
if (generatedQuestJson != null) {
  const loadResult = loadGeneratedQuestSaveState(generatedQuestJson)
  if (loadResult.ok) {
    const restoreResult = restoreGeneratedQuestPlay(loadResult.state, stateResult.state)
    if (restoreResult.ok) {
      restoredGeneratedPlay = restoreResult.play
    }
    // If restoreResult.ok is false, fall through to authored path.
  }
  // If loadResult.ok is false, fall through to authored path.
  // Log only a fixed code; never log the blob content.
}

if (restoredGeneratedPlay != null) {
  // Generated play restore path.
  setQuestSpecForView(restoredGeneratedPlay.questSpec ?? null)
  setQuestHints(restoredGeneratedPlay.hints ?? null)
  journalSpecRef.current = null
  enterActivePlay({
    ...restoredGeneratedPlay,
    sessionId: play.sessionId,
    navigation: exampleNavigation,
    adjacentPregenerator,
  })
} else {
  // Authored / fallback path — unchanged.
  const isAuthoredWorld = stateResult.state.roomStates['throne-room'] != null
  const restoredQuestSpec = isAuthoredWorld ? demoQuestSpec : undefined
  const restoredJournalSpec = isAuthoredWorld ? demoJournalSpec : undefined
  setQuestSpecForView(restoredQuestSpec ?? null)
  setQuestHints(null)
  journalSpecRef.current = restoredJournalSpec ?? null
  enterActivePlay({
    ...play,
    navigation: exampleNavigation,
    adjacentPregenerator,
    questSpec: restoredQuestSpec,
    journalSpec: restoredJournalSpec,
  })
}
```

The rest of `handleLoad` (`refreshDerivedViews`, `setSaveLoadStatus`, log line) is
**unchanged** in call order.

**`questHintsRef` updates (from Slice 4):** already in place; `setQuestHints` calls in
the generated restore path above update both the state and the ref.

**No other `App.tsx` change in this slice.**

### Test plan — Slice 5

File: `apps/web/src/App.test.tsx` (extend).

**Required new test cases:**

1. **Generated session load (valid blob) → quest tracker visible.**
   Save a generated session with `questSpec` → load → `quest` state is non-null;
   `QuestTracker` renders.

2. **Generated session load → objective completion correct from `WorldState`.**
   Set a flag `'interaction:generated-objective-target': true` in the `WorldState` event log
   before save. After load, `evaluateQuest(restoredQuestSpec, restoredWorldState)` returns
   `status: 'complete'`.

3. **Generated session load → resolved object ids match pre-save ids.**
   Before save: interact with the objective-target object (flag set in `WorldState`).
   After load: `play.entryResolvedObjectIds` contains the target object id.

4. **Generated session load → generated journal re-projects.**
   After load, `journal` state is non-null (when `objectivesPerRoom: true`).
   Journal contains the expected entries from `buildGeneratedConsequenceJournal`.

5. **Generated session load → `storyKind` present on restored `ActivePlay`.**
   If `storyKind` was saved, `activePlay.storyKind` equals it after load. Journal
   story-context entry present.

6. **Generated session load (missing blob) → authored-world fallback, no crash.**
   Save without a generated blob (authored session) → load → no error; authored demo
   quest tracker is present (or absent for a non-authored session).

7. **Generated session load (corrupt blob) → authored-world fallback, no crash.**
   Write a corrupt `generatedQuestJson` to the slot → load → no error; `degraded` notice
   shown.

8. **Generated session load (schema-invalid blob) → authored-world fallback, no crash.**
   Write a blob with `schemaVersion: 9` → `loadGeneratedQuestSaveState` returns
   `{ok: false}` → fallback path; no crash.

9. **Cost meter unchanged after load.** `usageCount` is the same before and after
   `handleLoad`. No `recordAttempt` called.

10. **No generator / objective provider called on load.** Spy on `ObjectiveGenerator.generate`
    and any `RoomGenerator.generate`. Assert zero calls after `handleLoad`.

11. **`loadRoomSpec` called (not `assembleRoom`) on generated load.** Spy confirms
    `loadRoomSpec` is called once; `assembleRoom` is not called.

12. **Authored session save/load (regression).** Bootstrap example world → save → load →
    demo quest tracker, demo journal, and authored-world behavior are byte-identical to
    before this feature. All pre-existing load tests pass.

13. **`handleLoad` log lines contain no unsafe content.** Assert log output contains no
    room name, object id, flag key, quest title, objective text, or hint text. Only safe
    codes/booleans.

### Verification commands — Slice 5

```bash
# Targeted tests
npm run test -- saveGame
npm run test -- App
npm run test -- restoreGeneratedQuestPlay
npm run test -- generatedQuestSaveState
npm run test -- saveSlotStore

# Full regression suite (confirms no cross-cutting regressions)
npm run test

# Type-check and lint
npm run build
npm run lint
```

All must pass with no failures or skips.

### Stop point — Slice 5

Hand off after full test suite + build + lint all pass. Perform the manual smoke
checklist below before requesting docs closeout. Await approval before Slice 6.

---

## Slice 6 — Docs closeout

**Goal:** update architecture status docs. No runtime file changes.

**Prerequisite:** Slice 5 approved, smoke checklist completed.

### Files

**Modify (docs only):**
- `docs/architecture/ARCHITECTURE.md` — add short ✅ status entry for "Generated Quest
  Save/Load v0" in the status section, consistent with the style of existing shipped
  entries. Cross-reference ADR-0059.
- `docs/architecture/FAILURE-MODES.md` — update §29 (or add a new entry near §10 /
  §10a) describing: generated session load with valid blob → restore; generated session
  load with missing/invalid blob → safe authored-world fallback with `degraded` notice;
  no error surfaced in either case.
- `docs/architecture/decisions/ADR-0059-generated-quest-save-load-v0.md` — update
  status from `pending implementation` to `Accepted — implemented`; add `Implemented: YYYY-MM-DD`.
- `docs/architecture/implementation-plans/generated-quest-save-load-v0.md` — update
  status from `pending implementation` to `implemented — slices 1–5 complete; docs closeout complete`.

**Do not touch any runtime file in this slice.**

### Verification commands — Slice 6

```bash
# Docs-only: confirm no runtime files changed
git diff --name-only

# Confirm build and lint still pass after docs edits (no accidental stray edit)
npm run build
npm run lint
```

`git diff --name-only` must show only docs files. Any runtime file appearing in the diff
is a slice-6 error.

### Stop point — Slice 6

Confirm `git diff --name-only` shows only docs files. Hand off for final review.

---

## Manual smoke checklist

Perform in the browser after Slice 5 is complete (`npm run dev`):

1. Submit a generated-room prompt (default fake provider config).
2. On room entry, verify the **Quest Tracker** appears with the generated objective text.
3. Verify the **Journal** panel is present with the "Consequences" title.
4. Interact with the objective-target object (press E). Confirm:
   - The object's interaction ring disappears (resolved state set).
   - Quest Tracker shows the objective marked **complete**.
   - Journal shows `"You resolved this chamber's objective."` and `"You disturbed 1 feature(s) here."`.
5. Press **Save**. Confirm the save bar shows "Saved".
6. Hard-reload the page (`Ctrl+Shift+R` / `Cmd+Shift+R`).
7. Press **Continue**. Confirm:
   - The same room renders (visually recognizable).
   - Quest Tracker is visible and shows the objective as **complete**.
   - The resolved object does **not** show an interaction ring (ring state preserved).
   - Journal is present and shows `"You resolved this chamber's objective."` and `"You disturbed 1 feature(s) here."`.
   - Room-entry story-context line in journal is the same hand-written phrase as before save.
8. Open DevTools → Network tab. Confirm **no network request** was made during load.
9. Open DevTools → Console. Confirm **no error logs** and no logged content containing
   room name, object names, flag keys, or objective/hint text.
10. Check browser localStorage: `aigm.save.slot` → the slot wrapper should contain
    `generatedQuestJson` (a non-empty string). It should **not** contain any prompt text,
    seed string, or raw provider output.
11. Hard-reload again without pressing Continue. Submit a **new generated prompt** (different
    room). Confirm the old objective is gone and a new objective appears. This confirms the
    per-session isolation.
12. Hard-reload. Press **Continue** again. Confirm the last-saved generated session
    restores correctly a second time.
13. Hard-reload. Bootstrap the **authored demo world** (wait for the authored room to load
    without submitting a prompt). Press Save → reload → Continue. Confirm the authored demo
    quest tracker and journal appear exactly as before (no regression).
14. `npm run build` — confirm build passes.

---

## Regression checklist

After Slice 5, confirm these existing test files pass without modification:

- `world-session/saveGame.test.ts` — authoritative `SaveGame` integrity unchanged
- `app/saveSlotStore.test.ts` — existing slot tests unchanged
- `app/buildRestoredPlay.test.ts` — restore helper unchanged
- `domain/quests/evaluateQuest.test.ts` — quest evaluation unchanged
- `domain/quests/assembleObjective.test.ts` — objective assembly unchanged
- `domain/interactions/resolvedObjects.test.ts` — object-state persistence unchanged
- `domain/journal/generatedConsequenceJournal.test.ts` — journal projector unchanged
- `domain/generatedStoryThread.test.ts` — story threading unchanged
- `app/derivedViews.test.ts` — derived-views projection unchanged
- `renderer/ui/QuestTracker.test.tsx` — quest tracker component unchanged
- `renderer/ui/JournalPanel.test.tsx` — journal panel component unchanged (if exists)
- `App.test.tsx` — all pre-existing authored-world tests pass unchanged

None of these files should be modified during implementation. If a regression test fails,
investigate the root cause rather than adjusting the test.
