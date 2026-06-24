# ADR-0028: Demo Quest Loop v0 — authored read-only quest tracker

- **Status:** Accepted — **implemented** (Demo Quest Loop v0)
- **Date:** 2026-06-24
- **Deciders:** Project owner

## Context

`world-state-event-log-v0` ([ADR-0013](./ADR-0013-world-state-event-log-v0.md)) established
`WorldState` as the authoritative projection of the append-only `WorldEvent[]` log, carrying
`roomStates[*].{ visited, flags }` and `inventory` as first-class validated schema fields.

`object-interactions-v0` ([ADR-0014](./ADR-0014-object-interactions-v0.md)) already writes the
permanent one-shot flag `interaction:offering-coffer` onto `roomStates['throne-room'].flags`
when the offering coffer is opened (`planTakeItem` → `oneShotFlag`).

`encounter-system-v0` ([ADR-0015](./ADR-0015-encounter-system-v0.md)) already writes the
permanent resolution flag `encounter:malik-encounter` onto `roomStates['throne-room'].flags` for
**any** resolution of the Malik encounter (`distract` / `negotiate` / `fight`).

`multi-room-navigation-cache-v0` ([ADR-0016](./ADR-0016-multi-room-navigation-cache-v0.md))
already sets `roomStates['ruined-safehouse'].visited === true` on `moved-to-room` and returns
the post-move `WorldState` in its `navigated` result (`NavigationResult.state`).

`inventory-health-ui-v0` ([ADR-0026](./ADR-0026-inventory-health-ui-v0.md)) established the
App-level overlay pattern (`StatusHud` as sibling of `RoomViewer`) and the pure-projection
precedent this slice mirrors exactly — including the `refreshDerivedViews` helper pattern for
keeping all derived views consistently fresh.

`session-save-load-v0` ([ADR-0027](./ADR-0027-session-save-load-v0.md)) established that
**derived views are re-projected from the restored `WorldState`**, so quest progress restores for
free with no `SaveGame` schema change.

Every hook already existed: the three conditions the quest watches are permanent flags and a
visited mark already written by existing services. The only gaps were (a) authored quest data,
(b) a pure evaluator, (c) a presentational overlay, and (d) App glue to re-project from state
the app already holds.

v0 adds **no quest engine, no new `WorldEvent` or `WorldCommand`, no reducer change, no
authored-room edit, no LLM quest generation, no backend/memory/persistence wiring, no new
dependencies, and no DOM/component tests**. Full design in the implementation plan
[`demo-quest-loop-v0`](../implementation-plans/demo-quest-loop-v0.md).

## Decision

Ship **Option A — pure read-only quest tracker over existing state/events**: a hand-authored
`QuestSpec` literal, a pure `evaluateQuest` evaluator, a presentational `QuestTracker` overlay,
and minimal App glue that re-projects from `WorldState` at the four points the App already
obtains a fresh state.

The defining property: **the quest is a derived lens, not a system.** `WorldSession` + the
append-only `WorldEvent[]` + reducers stay the sole authority. The quest adds no event, no
command, no reducer, no room flag, and no authored-room edit. It cannot complete an objective on
its own, cannot block play, and has no append path.

```
Quest progress refresh:
  bootstrap seed          → refreshDerivedViews(state)      ← seed
  onWorldStateChange      → refreshDerivedViews(state)      ← interaction/encounter resolve
  handleNavigate navigated → refreshDerivedViews(result.state) ← navigation (Objective 3)
  handleLoad restored     → refreshDerivedViews(restoredState) ← save/load

refreshDerivedViews(state):
  setPlayerHud(projectPlayerHud(state))
  if (demoQuestSpec && 'throne-room' in state.roomStates)
    setQuest(evaluateQuest(demoQuestSpec, state))

render:
  {quest && <QuestTracker view={quest} />}    ← App-level overlay
```

### Data model

**`QuestSpec` / `QuestSpecSchema`** (`domain/quests/questSpec.ts`): a closed, zod-validated
authored data descriptor. Mirrors the shape of `InteractionEffect` / `EncounterSpec` — it is
data interpreted by a trusted pure function, never behavior. Condition kinds: `room-flag` ·
`room-visited` · `has-item` · `has-status`. The v0 quest uses `room-flag` (×2) and
`room-visited` (×1); `has-item` and `has-status` round out a reusable vocabulary at trivial cost.

**`demoQuestSpec`** (`domain/examples/demoQuest.ts`): the hand-authored literal for
"The Steward's Toll" — three objectives wired to existing conditions:

| Objective | Condition |
| --- | --- |
| 1 — Claim the tribute coin | `{ kind:'room-flag', roomId:'throne-room', flag:'interaction:offering-coffer' }` |
| 2 — Get past Steward Malik | `{ kind:'room-flag', roomId:'throne-room', flag:'encounter:malik-encounter' }` |
| 3 — Cross into the safehouse | `{ kind:'room-visited', roomId:'ruined-safehouse' }` |

Objective 1 gates on the permanent pickup flag, not the held coin — spending the coin via
`negotiate` never un-completes it. Any of the three Malik resolution branches (`distract` /
`negotiate` / `fight`) satisfies Objective 2.

**`QuestView`** (produced by `domain/quests/evaluateQuest.ts`): `evaluateQuest(spec, state) →
QuestView`. Pure, total, deterministic — no I/O, no `Date.now`/`Math.random`, no input mutation.
Reads conditions defensively (optional chaining); missing rooms/flags/visited evaluate `false`
and never throw. Imports only domain types; exports no `WorldCommand`/`WorldEvent`-producing
function.

### Gating

The `demoQuestSpec` is attached to `ActivePlay` **only** for the authored example bootstrap and
for restores whose `WorldState.roomStates` contains `'throne-room'`. Prompt-generated sessions
never attach the spec; `quest === null` → `<QuestTracker>` is not rendered. Because the
projection is read-only and total, even a mis-gate could only mis-display, never corrupt state.

### Navigation re-projection

`App.handleNavigate` already has the post-move `WorldState` in the `navigated` result. The same
`refreshDerivedViews` helper is called there, so Objective 3 flips `done` the instant the player
enters the safehouse — no `RoomViewer` / `NavigationService` change. If this re-projection were
ever omitted, Objective 3 would simply light up on the next interaction/encounter resolve instead
of immediately — never wrong, only lagged.

### Component (`renderer/ui/QuestTracker.tsx`)

Presentational React only — props `{ view: QuestView }` in, DOM out. Renders the quest `title`;
each objective with a done marker and its authored `text`; a "Complete" state when
`status === 'complete'`. `pointer-events: none`; `role="status"` + `aria-live="polite"`. Imports
the `QuestView` type and React; imports no `three`, engine internals, `world-session`, or
services; holds no state beyond render. Styled with `.quest-tracker*` rules in `index.css`.

### Save/load

Quest progress is a pure function of `WorldState`. The `refreshDerivedViews` call at load
re-projects exact mid-quest progress from the restored state. No `SaveGame` schema change; the
`QuestSpec` is authored data, not persisted state, and the `QuestView` is derived.

### Boundaries

`domain/quests/questSpec.ts` and `domain/quests/evaluateQuest.ts` sit under the existing
`domain/**` lint block (imports only `zod` and domain types; no React, Three.js, renderer,
platform, or world-session). `domain/examples/demoQuest.ts` sits under the same block.
`renderer/ui/QuestTracker.tsx` sits under the existing `renderer/ui/**` lint block (imports React
and domain types; no `three`, engine internals, or services). `App.tsx` is the composition root.
**No new lint block, no `eslint.config.js` change, and no new layer** was introduced.

### Tests

Pure Vitest tests in `domain/quests/evaluateQuest.test.ts` (co-located, no new deps, no DOM):

- Each objective flips `done: false → true` on the precise `WorldState` flag/visited condition.
- `status` is `complete` iff all objectives done, else `active`.
- All four condition kinds covered (`room-flag`, `has-item` incl. `min`, `room-visited`,
  `has-status`).
- Defensive: absent room / absent `flags` / absent `visited` / unrelated state → all incomplete,
  no throw.
- Purity/no-mutation: input `WorldState` deep-equal before and after; returned objects/arrays are
  fresh.
- Structural read-only: module imports no `world-session`/service and exports no function
  returning a `WorldCommand`/`WorldEvent`.
- Schema pin: `QuestSpecSchema.parse(demoQuestSpec)` succeeds (pins the shipped literal).

No DOM/component tests — no `jsdom`/`@testing-library` added. No new reducer/interaction/
encounter/navigation tests — those sources were not changed.

### What was deliberately not changed

`domain/world/**` (no new event, command, reducer, or schema field) · `domain/examples/throneRoom.ts`
/ `ruinedRoom.ts` (no authored-room edit) · `domain/interactions/**` · `domain/encounters/**` ·
`interactions/**` · `encounters/**` · `world-session/**` · `domain/world/saveGame.ts` /
`world-session/saveGame.ts` (no `SaveGame` change) · `app/NavigationService.ts` ·
`app/buildRestoredPlay.ts` · `renderer/RoomViewer.tsx` · `renderer/engine/**` · `dialogue/**` ·
`memory/**` · `persistence/**` · `server/**` · `eslint.config.js` · `package.json`.

## Consequences

- **A playable authored quest loop now exists.** The "Steward's Toll" three-objective quest tracks
  progress deterministically over existing authoritative state, with a visible overlay.
- **Authority unchanged.** `WorldSession` event log + reducers remain the sole truth source. The
  quest tracker is a read-only render cache with no write path; no objective can flip itself.
- **No domain footprint.** Zero new events, commands, reducers, schema fields, or persisted state.
  No authored-room edits.
- **Save/load restores quest progress for free.** Re-projecting from the restored `WorldState`
  gives the exact mid-quest state; no `SaveGame` change was required.
- **Navigation immediately reflects Objective 3.** `refreshDerivedViews` called in
  `handleNavigate` means the tracker updates the tick the player enters the safehouse.
- **Quest hidden for prompt-generated sessions.** The anchor-room-presence gate is deterministic;
  prompt-generated sessions never see the quest tracker.
- **Log-safe.** The evaluator is pure and silent; `QuestTracker` is presentational. No new log
  lines were added to `App`/`RoomViewer`. Quest/objective text, ids, flag keys, item names/ids,
  status strings, room display names, and any narrative content are never logged — mirrors the
  ADR-0013/0014/0015/0026 content-free log discipline.
- **Known limitations:** single authored demo quest only; no generic quest engine; no generated
  quest support; no quest rewards; no multiple quests / quest chains; no DOM/component tests.
- **Not yet:** a generic quest engine, quest rewards, multiple/chained quests, LLM-generated
  quests, backend/server quest persistence, a quest log UI, fail states, time-limited objectives,
  or quest-gated progression.
