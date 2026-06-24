# ADR-0029: Consequence Journal v0 — authored read-only journal projection

- **Status:** Accepted — **implemented** (Consequence Journal v0)
- **Date:** 2026-06-24
- **Deciders:** Project owner

## Context

`world-state-event-log-v0` ([ADR-0013](./ADR-0013-world-state-event-log-v0.md)) established
`WorldState` as the authoritative projection of the append-only `WorldEvent[]` log, carrying
`roomStates[*].{ visited, flags }`, `player.status`, and `inventory` as first-class validated
schema fields.

`object-interactions-v0` ([ADR-0014](./ADR-0014-object-interactions-v0.md)) already writes the
permanent one-shot flag `interaction:offering-coffer` onto `roomStates['throne-room'].flags`
when the offering coffer is opened (`planTakeItem` → `oneShotFlag`).

`encounter-system-v0` ([ADR-0015](./ADR-0015-encounter-system-v0.md)) already writes the
permanent resolution flag `encounter:malik-encounter` onto `roomStates['throne-room'].flags`
for **any** resolution of the Malik encounter; the permanent flag `encounter:walker-encounter`
onto `roomStates['ruined-safehouse'].flags` for any walker resolution; the `infected` status onto
`player.status` via the walker `fight` outcome; and the `royal-writ` item into `inventory` via
the Malik `negotiate` outcome.

`multi-room-navigation-cache-v0` ([ADR-0016](./ADR-0016-multi-room-navigation-cache-v0.md))
already sets `roomStates['ruined-safehouse'].visited === true` on `moved-to-room` and returns
the post-move `WorldState` in its `navigated` result.

`inventory-health-ui-v0` ([ADR-0026](./ADR-0026-inventory-health-ui-v0.md)) established the
App-level overlay pattern (`StatusHud` as sibling of `RoomViewer`) and the pure-projection
precedent this slice mirrors — including log-safety and no write path.

`session-save-load-v0` ([ADR-0027](./ADR-0027-session-save-load-v0.md)) established that
**derived views are re-projected from the restored `WorldState`**, so journal entries restore
for free with no `SaveGame` schema change.

`demo-quest-loop-v0` ([ADR-0028](./ADR-0028-demo-quest-loop-v0.md)) is the one-for-one
structural sibling — an authored spec + a pure `WorldState` projection + a read-only App-level
overlay. It introduced the `refreshDerivedViews(state)` helper (extended here for a third
derived view) and the closed `ObjectiveCondition` vocabulary that the journal reuses. Its
previously-private `evaluateCondition` pure helper is now exported as a one-line additive
change so the journal projector can share it without duplicating the switch.

All six journal facts were already written into `WorldState` by existing services. The only
gaps were (a) authored journal data, (b) a pure projector, (c) a collapsible presentational
overlay, and (d) a few lines of App glue extending the existing `refreshDerivedViews` call.

v0 adds **no new `WorldEvent` or `WorldCommand`, no reducer change, no authored-room edit,
no LLM summarization, no memory integration, no backend/API/persistence changes, no `SaveGame`
schema change, no new dependency, and no DOM/component tests**. Full design in the
implementation plan
[`consequence-journal-v0`](../implementation-plans/consequence-journal-v0.md).

## Decision

Ship **Option A — WorldState-only authored consequence projection**: a hand-authored
`JournalSpec` literal, a pure `projectJournal` projector, a collapsible presentational
`JournalPanel` overlay, and minimal App glue that extends `refreshDerivedViews` with the
journal at the four points the App already obtains a fresh state.

The defining property: **the journal is a derived lens, not a system.** `WorldSession` + the
append-only `WorldEvent[]` + reducers stay the sole authority. The journal adds no event, no
command, no reducer, no room flag, no authored-room edit, and no `SaveGame` field. It cannot
record an event on its own, cannot block play, and has no append path.

```
Journal refresh:
  bootstrap seed            → refreshDerivedViews(state)         ← seed
  onWorldStateChange        → refreshDerivedViews(state)         ← interaction/encounter resolve
  handleNavigate navigated  → refreshDerivedViews(result.state)  ← navigation
  handleLoad restored       → refreshDerivedViews(restoredState) ← save/load

refreshDerivedViews(state):
  setPlayerHud(projectPlayerHud(state))
  if (demoQuestSpec && 'throne-room' in state.roomStates)
    setQuest(evaluateQuest(demoQuestSpec, state))
  if (demoJournalSpec && 'throne-room' in state.roomStates)
    setJournal(projectJournal(demoJournalSpec, state))

render:
  {journal && <JournalPanel view={journal} />}    ← App-level overlay
```

### Data model

**`JournalSpec` / `JournalEntrySpec` / `JournalSpecSchema`** (`domain/journal/journalSpec.ts`):
a closed, zod-validated authored data descriptor. Reuses `ObjectiveCondition` from
`domain/quests/questSpec.ts` — the same closed vocabulary (`room-flag` · `room-visited` ·
`has-item` · `has-status`) interpreted by the shared `evaluateCondition`. Validates
`entries.min(1)` and unique entry ids (mirrors `QuestSpecSchema`'s objective-id refinement).
Imports only `zod` and domain types; exports no command/event-producing function.

**`demoJournalSpec`** (`domain/examples/demoJournal.ts`): the hand-authored literal — six
entries wired to existing conditions, shown only when their condition is currently true, in this
stable authored order:

| id | text | condition | source |
| --- | --- | --- | --- |
| `claimed-tribute-coin` | "You claimed the tribute coin." | `room-flag` `throne-room` / `interaction:offering-coffer` | ADR-0014 |
| `dealt-with-malik` | "You dealt with Steward Malik." | `room-flag` `throne-room` / `encounter:malik-encounter` | ADR-0015 |
| `entered-safehouse` | "You entered the ruined safehouse." | `room-visited` `ruined-safehouse` | ADR-0016 |
| `became-infected` | "You became infected." | `has-status` `infected` | ADR-0015 |
| `faced-the-walker` | "You faced a reanimated walker." | `room-flag` `ruined-safehouse` / `encounter:walker-encounter` | ADR-0015 |
| `secured-royal-writ` | "You secured a royal writ." | `has-item` `royal-writ` | ADR-0015 |

**Filter semantics:** `projectJournal` emits an entry **only when its condition is currently
true**; false entries are omitted (unlike the quest tracker, which always shows all objectives).
Display order is stable authored order — not event-time order (no event-log read).

**`JournalView`** (produced by `domain/journal/projectJournal.ts`):
`projectJournal(spec, state) → JournalView`. Pure, total, deterministic — no I/O, no
`Date.now`/`Math.random`, no input mutation. Reads conditions defensively via the shared
`evaluateCondition` (optional chaining); missing rooms/flags/visited/statuses/items evaluate
`false` and never throw. Imports only domain types and the shared evaluator; exports no
`WorldCommand`/`WorldEvent`-producing function.

**Shared condition evaluator.** `domain/quests/evaluateQuest.ts` now exports the existing pure
`evaluateCondition(condition: ObjectiveCondition, state: WorldState): boolean` (previously
private). The journal projector imports it; **no new shared engine, no behavior change to the
quest path** — the export is additive and the function is unchanged.

### Gating

`demoJournalSpec` is attached to `ActivePlay` **only** for the authored example bootstrap and
for restores whose `WorldState.roomStates` contains `'throne-room'`. Prompt-generated sessions
never attach the spec; `journal === null` → `<JournalPanel>` is not rendered. Because the
projection is read-only and total, even a mis-gate could only mis-display, never corrupt state.

### Component (`renderer/ui/JournalPanel.tsx`)

Presentational React only — props `{ view: JournalView }` in, DOM out. Collapsible, collapsed
by default; the only local state is a boolean `expanded` (default `false`). Collapsed shows a
compact toggle (`Journal (n)`, where `n = entries.length`, or `Journal (0)` for empty).
Expanded shows the title + the entry list; when `entries.length === 0` the expanded panel shows
**"Nothing of consequence yet."** `pointer-events: none` for the static text; the collapse
toggle is an interactive `<button>`. `role="status"` + `aria-live="polite"`. Imports the
`JournalView` type and React; imports no `three`, engine internals, `world-session`, or
services. Styled with `.journal-panel*` rules in `index.css`, consistent with `.status-hud*` /
`.quest-tracker*` / `.room-notice`. Collapse state is presentational-only — never persisted,
never part of `WorldState`.

### Save/load

Journal entries are a pure function of `WorldState` (`inventory`, `player.status`,
`roomStates`). The `refreshDerivedViews` call at load re-projects the exact set of true entries
from the restored state. No `SaveGame` schema change; `JournalSpec` is authored data (not
persisted state) and `JournalView` is derived. Collapse state is not restored — the panel
reopens collapsed, the intended default.

### Boundaries

`domain/journal/journalSpec.ts`, `domain/journal/projectJournal.ts`, and
`domain/examples/demoJournal.ts` sit under the existing `domain/**` lint block (imports only
`zod` and domain types; no React, Three.js, renderer, platform, or world-session).
`renderer/ui/JournalPanel.tsx` sits under the existing `renderer/ui/**` lint block (imports
React and domain types; no `three`, engine internals, or services). `App.tsx` is the
composition root. **No new lint block, no `eslint.config.js` change, and no new layer** was
introduced.

### Tests

Pure Vitest tests in `domain/journal/projectJournal.test.ts` (co-located, no new deps, no DOM):

- **Empty state:** fresh `WorldState` (no flags, no visited, no status, empty inventory) →
  `entries: []`.
- **Only-true filter:** a single satisfied condition → exactly that one entry.
- **Stable authored order:** multiple true conditions → entries in spec order.
- **All six true:** every entry present, in authored order.
- **Each condition kind exercised** via the six entries (`room-flag` ×3, `room-visited`,
  `has-status`, `has-item`).
- **Defensive:** absent room / absent `flags` / absent `visited` / unrelated state → no entries,
  no throw.
- **Purity/no-mutation:** input `WorldState` deep-equal before and after; returned objects/arrays
  are fresh.
- **Structural read-only:** module imports no `world-session`/service and exports no function
  returning a `WorldCommand`/`WorldEvent`.
- **Shared-evaluator guard:** assertion that `evaluateCondition` is exported and behaves as a
  pure helper; the export does not change quest behavior.
- **Save/load implication:** projection over a post-restore-equivalent `WorldState` → entries
  reproduced exactly.

No DOM/component tests — no `jsdom`/`@testing-library` added. No new reducer/interaction/
encounter/navigation/quest-logic tests — those sources were not changed (the only quest-file
edit is the one-line export of `evaluateCondition`).

### What was deliberately not changed

`domain/world/**` (no new event, command, reducer, or schema field) · `domain/quests/questSpec.ts`
(vocabulary reused, schema unchanged) · `domain/examples/throneRoom.ts` / `ruinedRoom.ts` (no
authored-room edit) · `domain/examples/demoQuest.ts` · `domain/interactions/**` ·
`domain/encounters/**` · `interactions/**` · `encounters/**` · `world-session/**` ·
`domain/world/saveGame.ts` / `world-session/saveGame.ts` (no `SaveGame` change) ·
`app/NavigationService.ts` · `app/buildRestoredPlay.ts` · `renderer/RoomViewer.tsx` ·
`renderer/engine/**` · `dialogue/**` · `memory/**` · `persistence/**` · `server/**` ·
`eslint.config.js` · `package.json`.

## Consequences

- **A six-entry authored consequence journal now exists.** Entries for the tribute coin, Steward
  Malik, the safehouse entry, infection, the walker, and the royal writ appear as authoritative
  `WorldState` conditions become true. No authored removal path exists in the demo world, so all
  six are effectively permanent once triggered.
- **Authority unchanged.** `WorldSession` event log + reducers remain the sole truth source. The
  journal panel is a read-only render cache with no write path; no entry can set the condition it
  observes.
- **No domain footprint.** Zero new events, commands, reducers, schema fields, or persisted state.
  No authored-room edits.
- **`evaluateCondition` is now a shared pure helper.** The one-line export from the quest
  evaluator is the only change to the quest path; quest behavior is unchanged.
- **`refreshDerivedViews` now sets three derived views.** The existing helper (introduced with
  ADR-0028) extends naturally; all four re-projection points remain consistent.
- **Save/load restores journal entries for free.** Re-projecting from the restored `WorldState`
  gives the exact in-progress entry set; no `SaveGame` change was required.
- **Journal hidden for prompt-generated sessions.** The anchor-room-presence gate is
  deterministic; prompt-generated sessions never see the journal panel.
- **Log-safe.** The projector is pure and silent; `JournalPanel` is presentational. No new log
  lines were added to `App`/`RoomViewer`. Journal title/entry text, ids, flag keys, item
  names/ids, status strings, room display names, and any narrative content are never logged —
  mirrors the ADR-0013/0014/0015/0026/0028 content-free log discipline.
- **Known limitations:** demo-world authored journal only; no generated-session journal; no event
  timestamps or ordering from the event log; no LLM summary; no memory integration; no generic
  journal engine. Collapsed/expanded UI state is presentation-only and not saved. The
  `secured-royal-writ` entry gates on held inventory (`has-item`), so a future authored path that
  consumes the writ would remove that entry — honest reflection of current truth, not an immutable
  history.
- **Not yet:** a generic journal engine, LLM-authored entries, generated-session journal,
  event-time ordering, memory integration, journal-gated progression, or backend/persistence
  wiring.
