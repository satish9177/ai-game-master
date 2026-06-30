# Implementation Plan: Generated Room Consequence Journal v0

> Feature branch: `feature/generated-room-consequence-journal-v0`
> ADR: [ADR-0058](../decisions/ADR-0058-generated-room-consequence-journal-v0.md)
> Status: **implemented — slices 1–2 complete; docs/status closeout complete.**
> Implemented on 2026-06-30.

## Overview

Adds a player-visible consequence journal for prompt-generated sessions. The journal is a
read-only derived surface — a pure projector over existing `WorldState` + current room +
closed-enum quest/story state. No new LLM call, no schema change, no stored state, no new
persistence, no new component, no new lint rule.

## Minimum Safe Change Check

| Question | Answer |
|---|---|
| What existing code is reused? | `JournalView` / `JournalEntryView` types; `JournalPanel` component (unchanged); `computeDerivedViews` / `refreshDerivedViews` seam; `evaluateQuest` / `QuestView`; `resolvedObjectIds`; `deriveStoryThreadContext`; closed enums from `generatedStoryThread.ts` |
| What new code is actually necessary? | One pure projector function + two closed template tables (~60 lines domain); optional fourth param on `computeDerivedViews`; one optional `storyKind` field on generated `ActivePlay`; a few lines of `App` glue |
| What safety boundaries remain unchanged? | World-session authority; all schemas; objective/object-state semantics; cost guardrails; renderer trust boundary; log discipline; authored journal path |
| What targeted tests prove the change? | Pure projector Vitest tests with leak-guard assertions; one App render integration test |

---

## Files

### New files

| File | Created in slice |
|---|---|
| `apps/web/src/domain/journal/generatedConsequenceJournal.ts` | Slice 1 |
| `apps/web/src/domain/journal/generatedConsequenceJournal.test.ts` | Slice 1 |
| `docs/architecture/decisions/ADR-0058-generated-room-consequence-journal-v0.md` | Docs (done) |
| `docs/architecture/implementation-plans/generated-room-consequence-journal-v0.md` | Docs (done) |

### Modified files

| File | Modified in slice | Change |
|---|---|---|
| `apps/web/src/app/derivedViews.ts` | Slice 2 | Optional fourth param for generated journal input |
| `apps/web/src/App.tsx` | Slice 2 | `storyKind` on generated `ActivePlay`; build generated journal input; pass to `computeDerivedViews` |
| `docs/architecture/ARCHITECTURE.md` | Slice 3 | Short ✅ status entry for this feature |
| `docs/architecture/FAILURE-MODES.md` | Slice 3 | Short entry under generated-room section |

### Files to avoid / do not touch

- `apps/web/src/renderer/ui/JournalPanel.tsx` — reused unchanged
- `apps/web/src/domain/journal/journalSpec.ts` — authored schema unchanged
- `apps/web/src/domain/journal/projectJournal.ts` — authored projector unchanged
- `apps/web/src/domain/examples/demoJournal.ts` — authored literal unchanged
- `apps/web/src/domain/quests/**` — read-only reuse; no edits
- `apps/web/src/domain/interactions/resolvedObjects.ts` — read-only reuse; no edits
- `apps/web/src/domain/generatedStoryThread.ts` — read-only reuse; no edits
- `apps/web/src/world-session/**`
- `apps/web/src/interactions/**`
- `apps/web/src/encounters/**`
- `apps/web/src/dialogue/**`
- `apps/web/src/memory/**`
- `apps/web/src/persistence/**`
- `apps/web/src/server/**`
- `apps/web/src/renderer/engine/**`
- `apps/web/src/domain/roomSpec.ts`
- `apps/web/src/domain/quests/questSpec.ts`
- `apps/web/src/domain/world/saveGame.ts`
- `eslint.config.js`
- `package.json`

---

## Safety invariants (all slices)

These must hold throughout implementation and be asserted by tests:

1. **No authority change.** `WorldSession` + event log + reducers remain the sole truth source. The projector has no write path. It appends no events, emits no commands, and mutates nothing.
2. **No content leakage.** The projector must never read or output: `room.name`, any `object.name`, any `interaction.*` field, `QuestView.title`, `QuestView.objectives[].text`, raw `QuestSpec`/`GeneratedObjectiveSpec` JSON, any object id or objective id, any flag key or flag value string, any `WorldBibleSeed` free-text field, any raw user prompt text, any provider output, any generated room description. Enforced by leak-guard tests with sentinel strings.
3. **No schema change.** `RoomSpec`, `QuestSpec`, `JournalSpec`, `SaveGame` schema versions remain `1`. No new zod schema exported.
4. **No objective/object-state semantics change.** `evaluateQuest` and `resolvedObjectIds` are called as-is; no parameter or behavior modification.
5. **Authored journal unchanged.** `demoJournalSpec`, `projectJournal`, `JournalPanel`, authored bootstrap, and authored-world restore are byte-identical. All existing authored journal tests must remain green.
6. **Mutual exclusion.** Generated and authored journal are never both active in the same session. `computeDerivedViews` produces `journal` from exactly one source or neither.
7. **No cost impact.** Projector is synchronous and pure. No LLM/network/I-O call anywhere in the chain.
8. **Log-safe.** Projector is silent (domain layer; no logger). No new log lines in `App`/`derivedViews`. Counts and closed enums are not logged either.

---

## Slice 1 — Pure domain projector

**Status:** Complete.

**Goal:** ship `buildGeneratedConsequenceJournal` as a standalone, fully tested pure
function. Zero runtime behavior change. Zero UI change. Zero App change.

### Files

**Add:**
- `apps/web/src/domain/journal/generatedConsequenceJournal.ts`
- `apps/web/src/domain/journal/generatedConsequenceJournal.test.ts`

**Do not touch any other file.**

### Projector specification

```
buildGeneratedConsequenceJournal(input: GeneratedConsequenceJournalInput): JournalView

GeneratedConsequenceJournalInput = {
  state: WorldState
  room: LoadedRoom
  quest: QuestView | null
  storyContext?: GeneratedStoryRoomContext
}
```

Permitted imports (domain layer only):
- `../world/worldState` (types only)
- `../../loadRoomSpec` (types only — `LoadedRoom`)
- `../quests/evaluateQuest` (types only — `QuestView`)
- `../generatedStoryThread` (types only — `GeneratedStoryRoomContext`, `GeneratedStoryThreadKind`, `GeneratedStoryRoomRole`)
- `../interactions/resolvedObjects` (pure function `resolvedObjectIds`)
- `./projectJournal` (types only — `JournalView`, `JournalEntryView`)

**Must not import:** `zod`, `react`, `three`, `platform/**`, `world-session/**`,
`interactions/**` (the application layer), `encounters/**`, `dialogue/**`, `memory/**`,
`persistence/**`, `server/**`.

#### Closed template tables

```
STORY_JOURNAL_PHRASES: Readonly<Record<GeneratedStoryThreadKind, Record<GeneratedStoryRoomRole, string>>>
```

Maps `(kind, role)` → player-facing display copy. Must be distinct strings from
`SEED_PHRASES` in `generatedStoryThread.ts` (seed phrases are generation hints; these are
player-facing journal copy). Enumerated over all 5 kinds × 3 roles = 15 entries.

Example mappings (illustrative; exact wording to be set in implementation):

| kind | role | phrase |
|---|---|---|
| `escape` | `threshold` | `"You are looking for a way out."` |
| `escape` | `developing` | `"The path forward narrows."` |
| `escape` | `deeper` | `"Every exit matters now."` |
| `investigate` | `threshold` | `"Something here demands investigation."` |
| `investigate` | `developing` | `"The truth is becoming clearer."` |
| `investigate` | `deeper` | `"You are close to the answer."` |
| `survive` | `threshold` | `"Danger has found you."` |
| `survive` | `developing` | `"The threat is escalating."` |
| `survive` | `deeper` | `"Survival is all that matters."` |
| `rescue` | `threshold` | `"Someone needs you to find them."` |
| `rescue` | `developing` | `"You are closing in."` |
| `rescue` | `deeper` | `"Time is running out."` |
| `recover-item` | `threshold` | `"Something lost must be reclaimed."` |
| `recover-item` | `developing` | `"You are tracking it down."` |
| `recover-item` | `deeper` | `"It is almost within reach."` |

#### Entry construction logic

```
entries = []

// Entry 1: story-context
if (storyContext != null) {
  phrase = STORY_JOURNAL_PHRASES[storyContext.kind][storyContext.role]
  entries.push({ id: 'story-context', text: phrase })
}

// Entry 2: rooms-explored
visitedCount = count of roomIds in state.roomStates where state.roomStates[id].visited === true
if (visitedCount > 0) {
  entries.push({ id: 'rooms-explored', text: `You have explored ${visitedCount} chamber(s).` })
}

// Entry 3: objective-resolved
if (quest?.status === 'complete') {
  entries.push({ id: 'objective-resolved', text: "You resolved this chamber's objective." })
}

// Entry 4: objects-disturbed
resolvedCount = resolvedObjectIds(room, state.roomStates[room.id]).size
if (resolvedCount > 0) {
  entries.push({ id: 'objects-disturbed', text: `You disturbed ${resolvedCount} feature(s) here.` })
}

return { journalId: 'generated-consequence-journal', title: 'Consequences', entries }
```

### Test plan — Slice 1

File: `apps/web/src/domain/journal/generatedConsequenceJournal.test.ts`

No DOM, no jsdom, no `@testing-library`. Pure Vitest only. Reuse existing world-state
builders / minimal inline state construction consistent with the existing test style in
`projectJournal.test.ts`.

**Required test cases:**

1. **Empty input → empty entries, no throw.** Fresh `WorldState` (no visited rooms, no
   flags, no status), no `quest`, no `storyContext`, minimal `LoadedRoom` (no objects with
   interaction effects) → `entries: []`, `title === 'Consequences'`,
   `journalId === 'generated-consequence-journal'`.

2. **Story-context entry: present.** Each of the 5 `GeneratedStoryThreadKind` values × each
   of the 3 `GeneratedStoryRoomRole` values → story-context entry present with non-empty text.
   (Can batch as one parameterised test over the 15 pairs.)

3. **Story-context entry: absent when storyContext undefined.** `storyContext: undefined` →
   no entry with id `'story-context'`.

4. **Exploration entry: 0 visited → absent.**

5. **Exploration entry: 1 visited → `"You have explored 1 chamber(s)."`**

6. **Exploration entry: 3 visited → `"You have explored 3 chamber(s)."`**

7. **Objective entry: `quest.status === 'active'` → absent.**

8. **Objective entry: `quest.status === 'complete'` → present with fixed text.**

9. **Objective entry: `quest === null` → absent.**

10. **Object-state entry: 0 resolved → absent.**

11. **Object-state entry: N > 0 resolved → `"You disturbed N feature(s) here."`**
    (Construct a minimal `LoadedRoom` + `roomState.flags` with one inspect flag set, so
    `resolvedObjectIds` returns a set of size 1.)

12. **Entry order is stable.** All four inputs present → entries appear in order:
    story-context, rooms-explored, objective-resolved, objects-disturbed.

13. **Purity/no-mutation.** Input `WorldState` and `LoadedRoom` references deep-equal
    before and after the call; returned entry array is a fresh array each call.

14. **Structural safety (import check).** Assert the module exports only
    `buildGeneratedConsequenceJournal`; assert it exports no function whose return type
    includes `WorldCommand` or `WorldEvent`.

15. **Leak-guard: room name must not appear in output.** Set `room.name` to a distinctive
    sentinel (e.g. `'ROOM_NAME_SENTINEL_XYZ'`). Call projector. Assert no entry `text`
    contains the sentinel.

16. **Leak-guard: object name must not appear in output.** Place an object in `room.objects`
    with `name: 'OBJECT_NAME_SENTINEL_XYZ'`. Assert no entry `text` contains the sentinel.

17. **Leak-guard: flag key must not appear in output.** Set a flag key
    `'interaction:OBJ_SENTINEL_XYZ'` in `roomState.flags`. Assert no entry `text` contains
    `'OBJ_SENTINEL_XYZ'` or `'interaction:'`.

18. **Leak-guard: QuestView title must not appear in output.** Set `quest.title` to
    `'QUEST_TITLE_SENTINEL_XYZ'` (with `status: 'complete'`). Assert no entry `text`
    contains the sentinel.

19. **Leak-guard: QuestView objective text must not appear in output.** Set
    `quest.objectives[0].text` to `'OBJ_TEXT_SENTINEL_XYZ'`. Assert no entry `text`
    contains the sentinel.

20. **Save/load implication.** Construct a `WorldState` equivalent to a restored state (rooms
    visited, flags set). Projector called twice with identical input → identical `JournalView`
    output (pure, deterministic).

### Verification commands — Slice 1

```bash
# Targeted test (primary gate)
npm run test -- generatedConsequenceJournal

# Type check (catches import violations mechanically)
npm run build

# Lint (catches no-console, no-restricted-imports)
npm run lint
```

**Do not run `npm run test` (all tests) unless the targeted run passes and you need
broader confirmation. Confirm all three pass before handing off.**

### Stop point — Slice 1

Hand off after targeted test + build + lint all pass. No App wiring. No UI change.
No other test suites touched.

---

## Slice 2 — App wiring and existing JournalPanel rendering

**Status:** Complete.

**Goal:** wire `buildGeneratedConsequenceJournal` into the `computeDerivedViews` /
`refreshDerivedViews` seam. Prompt-generated sessions render the existing `JournalPanel`
with generated entries. Authored sessions are unchanged.

**Prerequisite:** Slice 1 approved and merged.

### Files

**Modify:**
- `apps/web/src/app/derivedViews.ts`
- `apps/web/src/App.tsx`

**Do not touch:** `JournalPanel.tsx`, `journalSpec.ts`, `projectJournal.ts`,
`demoJournal.ts`, `renderer/**`, `world-session/**`, schemas, `eslint.config.js`,
`package.json`.

### `derivedViews.ts` change

Add an optional fourth parameter to `computeDerivedViews`:

```ts
generatedJournalInput?: GeneratedConsequenceJournalInput
```

Derive `journal`:
```ts
journal:
  generatedJournalInput != null
    ? buildGeneratedConsequenceJournal(generatedJournalInput)
    : journalSpec != null
      ? projectJournal(journalSpec, state)
      : null
```

The two paths are mutually exclusive. The authored path is byte-identical to today when
`generatedJournalInput` is absent.

### `App.tsx` changes

1. **`ActivePlay`** — add one optional field: `storyKind?: GeneratedStoryThreadKind`.
   Already derived in `handlePrompt` as
   `prepared.worldBible?.openingArc.pattern`; was used inline in the pregenerator closure
   only. Now also stored on the generated `ActivePlay`.

2. **`refreshDerivedViews`** — cannot remain a stable `useCallback` with no deps if it
   needs live `activePlay` to build the generated journal input, because `activePlay` is
   state. Use the `activePlayRef` (already exists in `App` for stable closure access)
   inside the callback:

   ```ts
   const refreshDerivedViews = useCallback((state: WorldState) => {
     const play = activePlayRef.current
     const generatedJournalInput =
       play?.objectivesPerRoom === true || play?.storyKind != null
         ? buildGeneratedJournalInput(play, state)
         : undefined
     const views = computeDerivedViews(
       state,
       questSpecRef.current,
       journalSpecRef.current,
       generatedJournalInput,
     )
     setPlayerHud(views.playerHud)
     setQuest(views.quest)
     setJournal(views.journal)
   }, [])
   ```

   `buildGeneratedJournalInput` is a local pure helper (inside `App.tsx`, not exported)
   that constructs the input from `play`, `state`, and the current quest view derived from
   `questSpecRef.current`:

   ```ts
   function buildGeneratedJournalInput(
     play: ActivePlay,
     state: WorldState,
   ): GeneratedConsequenceJournalInput {
     const questForJournal = questSpecRef.current
       ? evaluateQuest(questSpecRef.current, state)
       : null
     const storyContext = play.storyKind != null
       ? deriveStoryThreadContext(play.storyKind, play.room.id)
       : undefined
     return { state, room: play.room, quest: questForJournal, storyContext }
   }
   ```

   Note: `questSpecRef.current` is already used inside the stable `refreshDerivedViews`
   callback (existing pattern); this extends that existing pattern with no new closure
   captures.

3. **`handlePrompt`** — when building the generated `ActivePlay`, add:
   ```ts
   storyKind: prepared.worldBible?.openingArc.pattern,
   ```
   Authored/restored paths omit this field (remain `undefined`).

4. **Reset on prompt** — in the existing prompt reset block (where `journalSpecRef.current`
   is set to `null`), the `activePlayRef.current` is already set to `null`; no additional
   reset needed because `refreshDerivedViews` reads from `activePlayRef` which will be null
   until `enterActivePlay` sets it.

5. **Navigation (`handleNavigate`)** — when updating `activePlay` after navigation, include
   `storyKind: activePlay.storyKind` in the `nextPlay` object so it is preserved across
   room transitions.

6. **Render** — `{journal && <JournalPanel view={journal} />}` is **unchanged**.

### Test plan — Slice 2

File: `apps/web/src/App.test.tsx` (extend existing tests; do not add new test file).

**Required test cases:**

1. **Prompt-generated session → JournalPanel rendered.** After `handlePrompt` resolves and
   a generated `ActivePlay` is set, the App renders a `JournalPanel` element. Confirm it is
   present in the output (component render check, not DOM).

2. **Authored session → authored JournalPanel (unchanged).** Bootstrap example world →
   `JournalPanel` is rendered using the authored `demoJournalSpec`-projected view (existing
   authored test coverage, confirmed still green).

3. **No double journal.** A generated session never renders two `JournalPanel` components
   simultaneously.

4. **Story-context entry visible for generated session.** If `worldBible.openingArc.pattern`
   is set on the prepared seed, the `journal` state includes a `'story-context'` entry.

5. **Navigation preserves storyKind.** After `handleNavigate`, `activePlay.storyKind`
   remains unchanged (same enum value).

6. **Authored journal regression.** All pre-existing `App.test.tsx` tests pass unchanged.

### Verification commands — Slice 2

```bash
# Targeted tests
npm run test -- generatedConsequenceJournal
npm run test -- App

# Full type-check and lint
npm run build
npm run lint

# Run full test suite to catch regressions
npm run test
```

**Confirm all pass before handing off.**

### Stop point — Slice 2

Hand off after full test + build + lint pass. Do not proceed to Slice 3 without approval.

---

## Slice 3 — Docs / status closeout

**Status:** Complete.

**Goal:** update architecture status docs. No runtime file changes.

**Prerequisite:** Slice 2 approved and merged.

### Files

**Modify:**
- `docs/architecture/ARCHITECTURE.md` — add short ✅ status entry for "Generated Room
  Consequence Journal v0" in the status section, consistent with existing shipped entries.
- `docs/architecture/FAILURE-MODES.md` — add a short entry in the generated-room section
  (under `4j` or as `4k`) describing safe degradation of the generated journal.
- `docs/architecture/decisions/ADR-0058-generated-room-consequence-journal-v0.md` — update
  status from `pending implementation` to `implemented`.
- `docs/architecture/implementation-plans/generated-room-consequence-journal-v0.md` —
  update status to `complete`.

**Do not touch any runtime file in this slice.**

### Verification commands — Slice 3

```bash
# Docs-only change: confirm no runtime files changed and lint/build still pass
git diff --name-only

npm run build
npm run lint
```

### Stop point — Slice 3

Confirm `git diff --name-only` shows only docs files. Hand off for final review.

---

## Manual smoke checklist

Performed in the browser after Slice 2 is complete:

1. `npm run dev` — start dev server.
2. Submit a generated-room prompt (fake provider, default config).
3. On room entry, verify the **Journal** panel appears in the overlay (collapsed by default,
   shows `Journal (N)` where N ≥ 0).
4. Expand the journal → confirm title is `"Consequences"` (or chosen fixed string, not a
   generated room name, not an objective title).
5. Confirm story-context entry text is one of the hand-written phrases (e.g. "You are
   looking for a way out.") — **not** a generated room/object name or seed phrase.
6. Inspect a generated object (press E on a book/chest/artifact etc.). Confirm
   `"You disturbed 1 feature(s) here."` appears in the journal.
7. Complete the generated objective (inspect the objective-target object until `QuestTracker`
   shows complete). Confirm `"You resolved this chamber's objective."` appears.
8. Navigate to an adjacent generated room — confirm exploration count increments
   (e.g. `"You have explored 2 chamber(s)."`).
9. **Return** to the prior room. Confirm the object-state count for that room is unchanged
   (e.g. still `"1 feature(s)"`) — proves persistence across re-entry.
10. Inspect all journal entries for any leaked id, flag key, room name, object name, or
    generated text. There must be none.
11. Switch to the authored demo world (hard-refresh without a prompt) → confirm the original
    6-entry authored journal appears and the generated journal does not.
12. Close browser, `npm run build` — confirm build passes.

---

## Regression checklist

After Slice 2, confirm these existing test files pass without modification:

- `domain/journal/projectJournal.test.ts` — authored journal unchanged
- `domain/quests/evaluateQuest.test.ts` — quest evaluation unchanged
- `domain/interactions/resolvedObjects.test.ts` — object state unchanged
- `domain/generatedStoryThread.test.ts` — story threading unchanged
- `renderer/ui/QuestTracker.test.tsx` — quest tracker unchanged
- `app/derivedViews.test.ts` — existing derived-views tests still pass
- `App.test.tsx` — authored journal + cost-guardrail + at-cap tests unchanged

None of these files should be modified during implementation.
