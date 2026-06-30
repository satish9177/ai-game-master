# ADR-0058: Generated Room Consequence Journal v0 — derived read-only consequence surface for generated play

- **Status:** Accepted — **pending implementation**
- **Date:** 2026-06-30
- **Deciders:** Project owner

## Context

`consequence-journal-v0` ([ADR-0029](./ADR-0029-consequence-journal-v0.md)) shipped a
read-only authored consequence journal for the example demo world. It established the
pattern: a `JournalSpec` literal + a pure `projectJournal` projector + the existing
`JournalPanel` overlay + a few lines of `App` glue at the `refreshDerivedViews` seam.
Generated sessions explicitly null the journal spec, so `<JournalPanel>` is never rendered
for prompt-generated play.

The following systems now provide safe, closed-enum or count-only facts that can serve as
a consequence surface for generated sessions, without any new LLM call, schema change, or
stored state:

- `WorldState.roomStates[roomId].{visited, flags}` — authoritative record of rooms visited
  and interaction/encounter one-shot flags set.
- `domain/interactions/resolvedObjects.ts` (`resolvedObjectIds`) — derives a
  `ReadonlySet<string>` of object ids whose interaction flag is set in the current room's
  `WorldState`. Already projected in generated play via `resolvedObjectIdsForGeneratedPlay`
  and held on `ActivePlay.entryResolvedObjectIds`.
- `domain/quests/evaluateQuest.ts` (`evaluateQuest`) — produces `QuestView` with a
  closed `status: 'active' | 'complete'` field and no objective text read.
- `domain/generatedStoryThread.ts` (`deriveStoryThreadContext`) — derives a
  `GeneratedStoryRoomContext { kind, role, pressure }` entirely from closed enums + structural
  room depth. `kind` is the `WorldBibleSeed.openingArc.pattern` enum; already used in the
  pregenerator closure of `handlePrompt`. Not yet held on `ActivePlay`.

The gap: the generated play path has no consumer-visible proof that prior choices persisted,
that adjacent rooms are part of one narrative arc, or that returning to a room does not reset
it. The journal surface fills this without adding any new authoritative state system.

ADR-0029's "Known limitations" explicitly noted: *"demo-world authored journal only; no
generated-session journal"* as a future item.

## Decision

Ship **Generated Room Consequence Journal v0** — a pure domain projector
`buildGeneratedConsequenceJournal` that derives a safe `JournalView` from existing
closed-enum and count-only facts, wired into the existing `refreshDerivedViews` /
`computeDerivedViews` seam, rendered by the unchanged `JournalPanel`.

The defining property mirrors ADR-0029: **the generated consequence journal is a derived
read-model, not a system.** It produces no events, no commands, no mutations, no flags,
and no new authoritative state. `WorldSession` + append-only `WorldEvent[]` + reducers
remain the sole source of truth.

### Authority invariants — hard constraints

The projector **must not** and **does not**:

- Append `WorldEvent`s or `WorldCommand`s.
- Mutate `WorldState`, `roomStates`, `player.status`, or `inventory`.
- Mutate quest state or objective completion semantics.
- Write NPC memory, room memory, or any memory layer.
- Write to persistence, backend, or `localStorage`.
- Change `RoomSpec`, `QuestSpec`, `JournalSpec`, or `SaveGame` schemas.
- Change object-state persistence semantics (`resolvedObjectIds` reads exactly as today).
- Change objective-completion semantics (`evaluateQuest` reads exactly as today).
- Trigger or count toward cost/usage guardrails.
- Make any LLM/network/I/O call.

### Content safety constraints — hard constraints

The projector **must not** read or output:

- Raw user prompt text.
- Generated room descriptions, display names, or `room.name`.
- Provider output (raw JSON, generated text, interaction body/title/prompt).
- Object names (`object.name`).
- Interaction text (`interaction.title`, `interaction.body`, `interaction.prompt`).
- `QuestView.title` or `QuestView.objectives[].text`.
- Raw `QuestSpec` or `GeneratedObjectiveSpec` JSON.
- Object IDs or objective IDs (surfaced only as anonymous counts).
- Flag keys or flag values (surfaced only as anonymous counts).
- `WorldBibleSeed` free-text fields (`hook`, `firstObjective`, `pressure`, `premise`,
  `title`, `majorConflict`, `canonNotes`, `openingContext`).
- Any generated, user-authored, or NPC-authored narrative text.

Permitted inputs (read-only, structured only):

| Input | What is read | Surface in entry |
|---|---|---|
| `WorldState.roomStates` | count of visited rooms (`visited === true`) | safe integer count |
| `resolvedObjectIds(room, roomState)` | set size only | safe integer count |
| `QuestView.status` | closed `'active' \| 'complete'` enum | drives entry presence (no text from it) |
| `GeneratedStoryRoomContext` | closed `kind` + `role` enums | key into hand-written phrase table |

**Entry text source:** every entry's display text comes exclusively from hand-written closed
template tables keyed on safe enums and counts. No runtime string interpolation of generated
content. The journal title is the fixed string `"Consequences"`.

### Data model

**`GeneratedConsequenceJournalInput`** (parameter type, not exported as a domain schema):

```ts
type GeneratedConsequenceJournalInput = {
  state: WorldState
  room: LoadedRoom
  quest: QuestView | null         // read .status only
  storyContext?: GeneratedStoryRoomContext  // closed enums only
}
```

**`buildGeneratedConsequenceJournal(input): JournalView`**

Pure, total, synchronous, side-effect-free. Returns the existing `JournalView` type
(reusing `JournalEntryView = { id: string; text: string }`), so `JournalPanel` and
`computeDerivedViews` absorb it with no type changes.

Produces up to four fixed-id entries, each present or absent based on safe conditions:

| Entry id | Condition for presence | Text source |
|---|---|---|
| `'story-context'` | `storyContext` present | closed `STORY_JOURNAL_PHRASES[kind][role]` table |
| `'rooms-explored'` | visited room count > 0 | `"You have explored N chamber(s)."` — N is count |
| `'objective-resolved'` | `quest?.status === 'complete'` | fixed string `"You resolved this chamber's objective."` |
| `'objects-disturbed'` | resolved object count > 0 | `"You disturbed N feature(s) here."` — N is count |

The `STORY_JOURNAL_PHRASES` table is a `Readonly<Record<GeneratedStoryThreadKind, Record<GeneratedStoryRoomRole, string>>>` — a different closed table from the generation seed-phrase table in `generatedStoryThread.ts`. The two are distinct: seed phrases are generation inputs; journal phrases are player-facing display copy that must not leak seed intent.

**`JournalView`** output: `{ journalId: 'generated-consequence-journal', title: 'Consequences', entries: [...] }`. Entry order is: story-context → rooms-explored → objective-resolved → objects-disturbed.

### Projector location

`apps/web/src/domain/journal/generatedConsequenceJournal.ts` — under the `domain/**` lint
block. Imports only `WorldState`, `LoadedRoom`, `JournalView`/`JournalEntryView` (domain
types), `QuestView` (domain type), and `GeneratedStoryRoomContext`/`GeneratedStoryThreadKind`/
`GeneratedStoryRoomRole` (domain types). Does not import `zod`, React, Three.js, platform
logger, `world-session/**`, `interactions/**`, `encounters/**`, `dialogue/**`, or
`memory/**`. **No new lint rule needed.**

`resolvedObjectIds` is called inside the projector (it is a pure domain function) to derive the
count. The projector reads `.size` only; no id string ever enters the output.

### App wiring

`ActivePlay` gains one optional field: `storyKind?: GeneratedStoryThreadKind`. Set once when
`handlePrompt` builds the generated `ActivePlay` (already derives it as `storyKind =
prepared.worldBible?.openingArc.pattern`); absent for authored/restored sessions.

`computeDerivedViews` gains an optional fourth parameter:
`generatedJournalInput?: GeneratedConsequenceJournalInput`. When present, the `journal` output
comes from `buildGeneratedConsequenceJournal`; when absent and `journalSpec` is provided, it
comes from the existing `projectJournal`. The two paths are **mutually exclusive** — a session
is either authored-world or generated-play, never both.

`refreshDerivedViews` in `App` builds the `generatedJournalInput` when `activePlay` indicates
generated play (`activePlay.objectivesPerRoom === true` or `storyKind` present), deriving
`storyContext` from `(storyKind, room.id)` via the existing `deriveStoryThreadContext`.

The existing `{journal && <JournalPanel view={journal} />}` render line is **unchanged**.

### Authored journal behavior

Unchanged. The `demoJournalSpec`, `demoJournal.ts`, authored bootstrap, and authored-world
restore paths are not edited. The anchor-room gate (`'throne-room' in state.roomStates`) and
the authored journal projection remain byte-identical.

### Degradation / no-spec path

- No `WorldBibleSeed` / no `storyKind` → `storyContext` is `undefined` → story-context entry
  absent; remaining entries still appear when their conditions are met.
- No generated objective (`quest === null`) → objective entry absent.
- No resolved objects → object-state entry absent.
- No visited rooms → exploration entry absent.
- All absent → `entries: []` → panel shows "Nothing of consequence yet." (unchanged panel
  behavior). Correct for a freshly entered generated room.
- Restored generated session with no attached `storyKind` (save/load) → same degradation.
  Journal re-projects from `WorldState`; entries missing story-context phrase still include
  exploration/object-state counts, which are authoritative from restored `WorldState`.

### Save/load

Journal entries are a pure function of `WorldState` + `LoadedRoom` + closed-enum context.
`refreshDerivedViews` at load re-projects exactly. No `SaveGame` schema change; no new
persisted field.

### Boundaries

`domain/journal/generatedConsequenceJournal.ts` sits under the existing `domain/**` lint
block. `renderer/ui/JournalPanel.tsx` is unchanged. `App.tsx` is the composition root.
`app/derivedViews.ts` is the projection seam. **No new lint block, no `eslint.config.js`
change, and no new layer.**

### Tests

Pure Vitest tests in `domain/journal/generatedConsequenceJournal.test.ts`:

- Fresh state + no context → `entries: []` → no throw.
- Story phrase appears for each `(kind, role)` pair; absent when `storyContext` undefined.
- Exploration count entry: 0 visited rooms → absent; 1 visited → `"1 chamber(s)"`; 3 visited → `"3 chamber(s)"`.
- Objective entry: `quest.status === 'active'` → absent; `quest.status === 'complete'` → present; `quest === null` → absent.
- Object-state entry: 0 resolved → absent; N resolved → `"N feature(s)"`.
- Entry order is stable: story-context → rooms-explored → objective-resolved → objects-disturbed.
- Purity/no-mutation: input `WorldState` and `LoadedRoom` deep-equal before and after; returned arrays are fresh.
- Structural safety: module imports no `world-session`/service; exports no function returning `WorldCommand`/`WorldEvent`.
- **Leak-guard assertions**: output text must not contain the room's `name` value, any object's id or name, any flag key string, the `QuestView.title` string, any `objectives[].text` string, the `storyContext.kind` raw enum string as-is (only mapped to the phrase), any WorldBible free-text sentinel. Drive each with sentinel strings on the input and assert their absence from every entry's `text`.

App/integration test: prompt-generated session → `JournalPanel` rendered; authored session → authored journal entries; both never co-rendered.

## Consequences

- **A generated consequence journal surface now exists.** Players see up to four short safe entries reflecting story arc, rooms explored, objective completion, and object-state persistence — without any generated/provider/prompt text in the display.
- **Authority unchanged.** `WorldSession` + event log + reducers are the sole truth source. The journal has no write path.
- **No domain footprint.** Zero new events, commands, reducers, schema fields, or persisted state.
- **Reuses `JournalView`/`JournalPanel`/`computeDerivedViews` exactly.** No component or type change for the authored path.
- **Safe degradation.** Every entry is optional. A session without a world bible, quest, or prior interaction gets an empty journal — displayed correctly as "Nothing of consequence yet."
- **Authored journal unchanged.** All existing authored behavior and tests remain byte-identical.
- **Known limitations:** journal is room-entry-projected (reflects current room's resolved count, not a cross-room history). No event-time ordering. No per-room history across rooms. No LLM-authored narrative. No journal-gated progression. Restored generated sessions without `storyKind` lose the story-context entry (acceptable: exploration/object-state counts still restore correctly from `WorldState`). A generic journal engine, multi-step objective journal, and richer cross-session memory integration are not part of this ADR.
