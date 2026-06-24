# Implementation Plan — `feature/consequence-journal-v0`

> Status: **implemented — closed.** Source implemented and reviewed; ADR-0029 written;
> docs closeout complete.
>
> Companion docs: [ARCHITECTURE](../ARCHITECTURE.md) · [BOUNDARIES](../BOUNDARIES.md) ·
> [FAILURE-MODES](../FAILURE-MODES.md) · [CONVENTIONS](../CONVENTIONS.md). Direct
> precedent and dependencies:
> `world-state-event-log-v0` ([ADR-0013](../decisions/ADR-0013-world-state-event-log-v0.md))
> defines the authoritative `WorldState` this journal reads — `inventory`,
> `player.status`, and `roomStates[*].{ visited, flags }` — and the append-only event log
> that is the sole truth;
> `object-interactions-v0` ([ADR-0014](../decisions/ADR-0014-object-interactions-v0.md))
> writes the one-shot flag `interaction:offering-coffer`;
> `encounter-system-v0` ([ADR-0015](../decisions/ADR-0015-encounter-system-v0.md))
> writes the resolution flags `encounter:malik-encounter` / `encounter:walker-encounter`,
> the `infected` status, and the `royal-writ` item;
> `multi-room-navigation-cache-v0` ([ADR-0016](../decisions/ADR-0016-multi-room-navigation-cache-v0.md))
> sets `roomStates['ruined-safehouse'].visited` on `moved-to-room` and returns the
> post-move `WorldState`;
> `inventory-health-ui-v0` ([ADR-0026](../decisions/ADR-0026-inventory-health-ui-v0.md))
> is the App-level overlay + pure-projection precedent;
> `session-save-load-v0` ([ADR-0027](../decisions/ADR-0027-session-save-load-v0.md))
> establishes that **derived views are re-projected from the restored `WorldState`**;
> `demo-quest-loop-v0` ([ADR-0028](../decisions/ADR-0028-demo-quest-loop-v0.md)) is the
> one-for-one structural sibling — an authored spec + a pure `WorldState` projection + a
> read-only App-level overlay — whose closed condition vocabulary this journal reuses.

## Goal

Add a small, player-facing **Consequence Journal**: a collapsible read-only overlay that
summarizes important things that **have already happened** in the authored example world.
It is a **pure projection of authoritative `WorldState`** — it evaluates a list of
authored consequence predicates and shows **only the ones currently true**, in stable
authored order. It reads truth and never writes it.

The defining property: **the journal is a derived lens, not a system.** `WorldSession` +
the append-only `WorldEvent[]` + reducers stay the sole authority. The journal adds **no
event, no command, no reducer, no room flag, no authored-room edit, and no `SaveGame`
field**. It cannot record an event on its own, cannot block play, and has no append path.

The work is small and additive because every fact it surfaces is already written into
`WorldState` by existing interaction / encounter / navigation services. The only gaps are
(a) authored journal data, (b) a pure projector, (c) a presentational collapsible overlay,
and (d) a few lines of App glue that re-project from state the app already holds.

---

## 1. Status

**Implemented — closed.** ADR-0029 written; ARCHITECTURE, FAILURE-MODES, and AGENTS updated
in the docs closeout (slice 3, §13).

## 2. Current repo facts (verified against source)

- **App already derives `playerHud` and `quest` from `WorldState`.** `App.tsx` owns
  `playerHud: PlayerHudView | null` and `quest: QuestView | null`, seeds them from
  session-start `WorldState`, and re-derives them wherever it obtains a fresh `WorldState`.
- **Those re-projections are currently inlined, not centralized.** `App.tsx` calls
  `projectPlayerHud(...)` and `evaluateQuest(...)` **separately at four points** —
  bootstrap (`bootstrapExamplePlay` / the `useEffect`), `handleWorldStateChange`
  (interaction/encounter resolve), `handleNavigate`'s `navigated` branch, and
  `handleLoad`. There is **no `refreshDerivedViews` helper yet**; adding a third derived
  view (journal) is the trigger to introduce one (§8, locked decision 16).
- **Save/load restores derived views from `WorldState`.** `app/buildRestoredPlay.ts`
  re-derives `initialPlayer` from the restored state, and `handleLoad` re-evaluates the
  quest against it. Anything that is a pure function of `WorldState` is restored for free.
- **The `WorldEvent` log exists but App does not need it for v0.** `WorldSession`
  exposes `getEventLog(sessionId, { sinceSeq })`, but `App` only ever calls
  `getWorldState`. The journal derives purely from the projected snapshot App already
  holds — **no event-log read is introduced** (locked decision: no event-log dependency).
- **Demo quest + authored room flags already provide enough truth.** All six journal
  facts live in `WorldState` today, written by existing services:
  - `roomStates['throne-room'].flags['interaction:offering-coffer']` — `take-item` on the
    coffer (`domain/examples/throneRoom.ts`; ADR-0014).
  - `roomStates['throne-room'].flags['encounter:malik-encounter']` — any Malik encounter
    resolution (ADR-0015).
  - `roomStates['ruined-safehouse'].visited` — entering via the north arch (ADR-0016).
  - `player.status` includes `infected` — the safehouse walker `fight` outcome
    (`domain/examples/ruinedRoom.ts`; ADR-0015). No authored `clear-status` path exists,
    so `infected` is permanent in-world.
  - `roomStates['ruined-safehouse'].flags['encounter:walker-encounter']` — any walker
    encounter resolution (ADR-0015).
  - `inventory` contains `royal-writ` — Malik `negotiate` outcome (ADR-0015). (Note: this
    is held inventory, not a permanent flag — see §15 wording risk.)
- **The authored `demoQuestSpec` literal lives in `domain/examples/demoQuest.ts`** (not
  `domain/quests/`). The journal follows the same convention: schema + projector under a
  new `domain/journal/`, the authored literal under `domain/examples/demoJournal.ts`.
- **The closed condition vocabulary already exists.** `domain/quests/questSpec.ts` defines
  `ObjectiveCondition` (`room-flag` / `has-item` / `room-visited` / `has-status`) and
  `domain/quests/evaluateQuest.ts` interprets it against `WorldState` via a private
  `evaluateCondition`. All six journal entries map cleanly onto this vocabulary, so the
  journal **reuses** it; `evaluateCondition` is exported (a one-line additive change) so
  the journal does not duplicate the switch.
- **Test environment is node, no DOM** (no `jsdom`/`@testing-library`; `vite.config.ts`
  declares no test env). Pure Vitest only; no component tests today.

## 3. Locked decisions

1. **Option A — WorldState-only authored consequence projection.** No event-log
   dependency in App.
2. **No LLM summarization. No memory integration. No backend/API/persistence changes.**
3. **No new `WorldEvent`/`WorldCommand`. No reducer changes. No `SaveGame` schema change.
   No new dependencies. No DOM tests.**
4. **Demo-world only; hidden for prompt-generated sessions** (anchor-room gate, §6).
5. **Drop "You saved the game."** Save is a browser `localStorage` action (ADR-0027),
   never a `WorldEvent` or `WorldState` field — it is not authoritative journal truth (§4).
6. **UI: a collapsible journal panel, collapsed by default** (§8).
7. **Empty state: show "Nothing of consequence yet."** (rendered when gated to the demo
   world but no entry is yet true).
8. **Ship all six entries** as enumerated in §5.
9. **Reuse the existing condition vocabulary** (`ObjectiveCondition`) **only because it
   stays small and clean** for all six entries; **export a pure `evaluateCondition`** from
   the quest evaluator to share it. **Do not** build a big shared condition engine.
10. **Add a small App `refreshDerivedViews(state)` helper** to collapse the now-three
    repeated `playerHud` / `quest` / `journal` projections at the four state points.

## 4. Authority model

- **Truth (authoritative):** the per-session append-only `WorldEvent[]`, with `WorldState`
  as its reconstructable projection — here specifically `inventory`, `player.status`, and
  `roomStates[*].{ visited, flags }`. The only write path remains
  `WorldSession.appendEvent → applyEvent → store.commit`, exercised solely by the existing
  interaction / encounter / navigation services.
- **Authored lens (not state):** the `JournalSpec` — fixed, hand-authored data describing
  *which authoritative conditions each entry watches*. It is never a `WorldEvent`,
  `WorldState`, `CanonSeed`, `SaveGame` field, or persisted row, and it is never executed
  as behavior (its conditions are the closed `ObjectiveCondition` vocabulary interpreted by
  a trusted pure function, mirroring how `planInteraction`/`planEncounter`/`evaluateQuest`
  interpret authored data).
- **Derived UI (not truth):** the `JournalView` = `projectJournal(spec, worldState)`. A
  pure, total, deterministic read cache — like `PlayerHudView` / `QuestView`. It never
  feeds back into an event, reducer, snapshot, flag, or store, and has no code path to do
  so.
- **`localStorage` / save actions are not journal truth.** A save writes bytes to a slot
  (ADR-0027); it produces no event and changes no `WorldState`, so it can never appear as
  a journal entry. This is why "You saved the game" is dropped (locked decision 5).

A journal entry appearing is **only** the observation of an authoritative flag / `visited`
mark / status / item that an existing service already wrote. The journal cannot set it.

## 5. Exact journal entries and conditions

Authored literal (`demoJournalSpec`, `domain/examples/demoJournal.ts`), shown only when its
condition is currently true, in this stable authored order (≤ 8; all six ship):

| id | text | condition (`ObjectiveCondition`) | source of truth |
| --- | --- | --- | --- |
| `claimed-tribute-coin` | "You claimed the tribute coin." | `{ kind: 'room-flag', roomId: 'throne-room', flag: 'interaction:offering-coffer' }` | take-item (ADR-0014) |
| `dealt-with-malik` | "You dealt with Steward Malik." | `{ kind: 'room-flag', roomId: 'throne-room', flag: 'encounter:malik-encounter' }` | encounter (ADR-0015) |
| `entered-safehouse` | "You entered the ruined safehouse." | `{ kind: 'room-visited', roomId: 'ruined-safehouse' }` | navigation (ADR-0016) |
| `became-infected` | "You became infected." | `{ kind: 'has-status', status: 'infected' }` | walker fight (ADR-0015) |
| `faced-the-walker` | "You faced a reanimated walker." | `{ kind: 'room-flag', roomId: 'ruined-safehouse', flag: 'encounter:walker-encounter' }` | encounter (ADR-0015) |
| `secured-royal-writ` | "You secured a royal writ." | `{ kind: 'has-item', itemId: 'royal-writ' }` | Malik negotiate (ADR-0015) |

- **Filter semantics:** `projectJournal` emits an entry **only when its condition is
  true**; entries whose condition is false are omitted (unlike the quest tracker, which
  shows incomplete objectives). The result preserves authored order.
- **Display order is authored**, not event-time ordered (no event-log read).

## 6. Gating

- **Show only for the authored example world / throne-room path.** The entries reference
  `throne-room` / `ruined-safehouse`; they are meaningless in a prompt-generated
  single-room session.
- **Mechanism (mirrors the quest gate exactly):** `App` attaches the `JournalSpec` to
  `ActivePlay` **only** on the example bootstrap and on a restore whose anchor room id
  `throne-room` is present in `state.roomStates`; the prompt-generated play leaves it unset.
  Journal derivation runs only when a spec is attached:
  `journal = demoJournalSpec ? projectJournal(demoJournalSpec, state) : null`.
- **Result:** for prompt-generated sessions `journal === null` → the panel is **not
  rendered** (mirrors `playerHud === null` / `quest === null`). Because the projection is
  read-only and total, even a mis-gate could only mis-display, never corrupt.

## 7. Data model

**`JournalSpec` / `JournalEntrySpec` — authored data** (new, `domain/journal/journalSpec.ts`;
zod-validated, DATA ONLY; reuses `ObjectiveCondition` from `domain/quests/questSpec.ts`):

```ts
import { ObjectiveConditionSchema, type ObjectiveCondition } from '../quests/questSpec'

type JournalEntrySpec = {
  id: string                    // stable, unique within the spec
  text: string                  // authored player-facing line
  condition: ObjectiveCondition // closed vocabulary, interpreted by a trusted pure fn
}

type JournalSpec = {
  journalId: string
  title: string                 // e.g. "Consequence Journal"
  anchorRoomId: string          // gate: render only when present in roomStates (§6)
  entries: JournalEntrySpec[]   // authored display order; entry ids must be unique
}
```

The schema validates `entries.min(1)` and unique entry ids (mirroring `QuestSpecSchema`'s
objective-id refinement). No new condition kind is added.

**`JournalView` — derived UI projection** (new, produced by
`domain/journal/projectJournal.ts`):

```ts
type JournalEntryView = { id: string; text: string }   // only true entries appear
type JournalView = {
  journalId: string
  title: string
  entries: JournalEntryView[]                           // [] ⇒ empty state (§8)
}

export function projectJournal(spec: JournalSpec, state: WorldState): JournalView
```

`projectJournal` is pure/total/deterministic: no I/O, no `Date.now`/`Math.random`, no input
mutation, reads conditions defensively (via the shared `evaluateCondition`), imports only
the `WorldState` / `JournalSpec` **types** (and the exported `evaluateCondition`), and
exports no `WorldCommand`/`WorldEvent`-producing function.

**Shared condition evaluator.** `domain/quests/evaluateQuest.ts` exports its existing pure
`evaluateCondition(condition, state): boolean` (currently private). The journal imports it;
**no new shared engine, no behavior change to the quest path** (locked decision 9).

## 8. UI

- **Component:** `renderer/ui/JournalPanel.tsx`, presentational React only (peer of
  `StatusHud` / `QuestTracker`): props `{ view: JournalView }` in, DOM out. Imports the
  `JournalView` type and React; imports **no** `three`, engine internals, `world-session`,
  or services.
- **Collapsible, collapsed by default.** The only local state is a boolean
  `expanded` (default `false`). Collapsed shows a compact toggle (e.g. `Journal (n)` where
  `n = entries.length`); expanded shows the title + the list. Collapse state is
  presentational only — never persisted, never part of `WorldState`.
- **Empty state.** When `entries.length === 0`, the expanded panel shows
  **"Nothing of consequence yet."** (mirrors `StatusHud`'s explicit "No items"). The
  collapsed toggle still renders (e.g. `Journal (0)`), so the player can find it.
- **Placement:** an **App-level overlay** sibling of `RoomViewer` / `StatusHud` /
  `QuestTracker` / `notice` / `SaveLoadBar`, so it survives `RoomViewer`'s navigation
  remount. Positioned clear of the existing overlays (HUD top-left, quest top-right,
  PromptBar/notice top-center, SaveLoadBar) — a distinct corner chosen during
  implementation. `role="status"` + `aria-live="polite"`; the static text is
  `pointer-events: none`, while the collapse toggle is an interactive `<button>` (so it
  must sit in its own pointer-events-enabled element, like the `room-notice-close`
  button). Styled with new `.journal-panel*` rules in `index.css`, consistent with
  `.status-hud*` / `.quest-tracker*` / `.room-notice`.
- **No write path:** the panel receives only data; `App` gates rendering on
  `journal != null`. It has no service import and no append path (structural).
- **No logs:** the component is presentational and the projection is pure; **no new log
  line** is added anywhere (§11).

## 9. Save/load

- **The journal is re-derived from the restored `WorldState`.** Entries are a pure function
  of `inventory` + `player.status` + `roomStates`, all of which `SaveGameService` /
  `WorldStore.restoreSession` restore faithfully. On load, `App` evaluates the spec against
  the restored state (the same place it re-derives `playerHud` and the quest), so a save
  taken mid-play resumes with exactly the right entries shown.
- **No `SaveGame` changes.** No new persisted field; `JournalSpec` is authored data, not
  state, and `JournalView` is derived — neither is serialized.
- **Gate on restore:** attach the journal (and thus render the panel) only when the
  restored state's `roomStates` contains the anchor `throne-room` (§6); a restored
  prompt-generated session shows no journal.
- **Collapse state is not restored** because it is not state — the panel reopens collapsed,
  which is the intended default.

## 10. Failure behavior

Mirrors FAILURE-MODES #18 (HUD) / #20 (quest tracker). The docs closeout adds a new case
(**#21 Consequence journal display**).

| Situation | Detection | Handling / result | Logging |
| --- | --- | --- | --- |
| **No active session / spec not yet attached** | `journal === null` in `App` | panel not rendered; no crash | — |
| **Prompt-generated session** | no `JournalSpec` attached (anchor gate, §6) | panel not rendered | — |
| **Nothing has happened yet** | all conditions read `false` → `entries: []` | panel renders empty state "Nothing of consequence yet." | — |
| **Missing room / flag / visited / status / item** | defensive reads in `evaluateCondition` (optional chaining) | condition → `false`; entry omitted; never throws | — |
| **Loaded mid-play** | re-project from restored `WorldState` | exact entries; no special handling | — |
| **Save/load restores old state** | projection mirrors restored state | entries correct by construction | — |
| **Navigation just occurred (`entered-safehouse`)** | `App` re-projects from `navigated` `result.state` | entry appears immediately; if omitted, next resolve refreshes it — never wrong, only lagged | — |
| **Status/item later removed** (e.g. a future `clear-status`) | condition re-reads `false` | entry disappears — honest reflection of current truth; no authored removal path exists in the demo world, so deterministic in practice (§15) | — |
| **Entry already shown, re-triggered resolve** | re-project is idempotent; `already-resolved` carries `state` | entry stays shown; no state change | — |

The panel is read-only with no append path, so no displayed journal state can corrupt
truth.

## 11. Log safety

- **The projector and the component log nothing** (the projection is pure; `JournalPanel`
  is presentational). This slice adds **no new log line** to `App`/`RoomViewer`/services.
- **Never log:** journal `title`/entry `text`, `journalId`/entry ids, flag keys, item
  names/ids, `status` strings, room display names, or any narrative/PII — mirrors the
  ADR-0013/0014/0015/0026/0028 content-free discipline. Any future diagnostic must be
  restricted to counts/codes/booleans.

## 12. Tests (Vitest; co-located; pure only; no DOM, no new deps)

- **Pure projector (`domain/journal/projectJournal.test.ts`):**
  - **empty state:** a fresh `WorldState` (no flags, no visited, no status, empty
    inventory) → `entries: []`;
  - **only-true filter:** a single satisfied condition → exactly that one entry;
  - **stable authored order:** with several conditions true, entries appear in spec order;
  - **all six true:** every entry present, in order;
  - **each condition kind exercised** via the six entries (`room-flag` ×3, `room-visited`,
    `has-status`, `has-item`);
  - **defensive:** absent room / absent `flags` / absent `visited` / unrelated (generated)
    state → no entries, no throw;
  - **purity / no-mutation:** input `WorldState` deep-equal before and after; returned
    view objects/arrays are fresh; **structural read-only** — the module imports no
    `world-session`/service and exports no `WorldCommand`/`WorldEvent`-producing function.
- **Shared-evaluator guard:** a small assertion (in the journal test or the existing quest
  test) that the exported `evaluateCondition` is the same pure helper, so the export does
  not change quest behavior.
- **Save/load implication:** a projection test over a `WorldState` equivalent to a
  post-restore state asserts entries are reproduced. **No `SaveGame` code changes**, so no
  new save/load test is required.
- **No DOM/component tests** (no `jsdom`/`@testing-library`; none added). The panel is kept
  trivially presentational; the projector tests cover the logic; App wiring and the
  collapse toggle are exercised manually in the running app.
- **No reducer / interaction / encounter / navigation / quest-logic tests** — those
  sources are **not changed** (the only quest-file edit is exporting an existing pure
  function), so none are added beyond the guard above.

## 13. Proposed source slices

Each slice keeps `npm run build` / `npm run lint` / `npm run test` (in `apps/web`) green;
the maintainer commits each manually.

1. **`feat(domain): consequence journal spec + projection`** —
   `domain/journal/journalSpec.ts` (schema reusing `ObjectiveCondition`),
   `domain/examples/demoJournal.ts` (the §5 authored literal),
   `domain/journal/projectJournal.ts` (+ `projectJournal.test.ts`); export
   `evaluateCondition` from `domain/quests/evaluateQuest.ts`. Pure + headless; **not yet
   wired**. No `eslint.config.js` change.
2. **`feat(ui): consequence journal overlay + wiring`** — `renderer/ui/JournalPanel.tsx`
   (presentational, collapsible) + `.journal-panel*` styles in `index.css`; `App.tsx` owns
   `journal: JournalView | null`, attaches the spec to `ActivePlay` on the example
   bootstrap and on anchor-gated restore, introduces `refreshDerivedViews(state)` (sets
   `playerHud` + `quest` + `journal`) and calls it at bootstrap / `handleWorldStateChange`
   / `handleNavigate` (`navigated`) / `handleLoad`, and renders `<JournalPanel>` as an
   App-level overlay. No domain/service/`RoomViewer`/engine change.
3. **`docs(architecture): record consequence-journal-v0`** *(closeout — after source
   review)* — **create ADR-0029**; add FAILURE-MODES case #21 (consequence journal
   display); add an ARCHITECTURE section + a short AGENTS.md status note; touch BOUNDARIES
   only if a rule actually changed (not anticipated — §15); flip this plan and ADR-0029 to
   *implemented*.

## 14. Files likely to change

- **New (domain):** `domain/journal/journalSpec.ts`, `domain/journal/projectJournal.ts`,
  `domain/journal/projectJournal.test.ts`, `domain/examples/demoJournal.ts`.
- **New (UI):** `renderer/ui/JournalPanel.tsx`.
- **Edited (domain):** `domain/quests/evaluateQuest.ts` — **export** the existing pure
  `evaluateCondition` (one line; no behavior change).
- **Edited (composition root):** `App.tsx` (own/seed/gate `journal`, attach spec to
  `ActivePlay`, add `refreshDerivedViews` and call it at the four state points, render the
  overlay); `index.css` (`.journal-panel*` styles).
- **Docs (slice 3, closeout):** new `ADR-0029`; `FAILURE-MODES.md` (new case #21);
  `ARCHITECTURE.md` + `AGENTS.md` (short status); `BOUNDARIES.md` only if needed; this plan
  flipped to *implemented*.
- **Deliberately NOT changed:** `domain/world/**` (no new event, command, reducer, or
  schema field — `events.ts` / `applyEvent.ts` / `worldState.ts` untouched),
  `domain/quests/questSpec.ts` (vocabulary reused, not changed),
  `domain/examples/throneRoom.ts` / `ruinedRoom.ts` (no authored-room edit),
  `domain/examples/demoQuest.ts`, `domain/interactions/**`, `domain/encounters/**`,
  `interactions/**`, `encounters/**`, `world-session/**`, `domain/world/saveGame.ts` /
  `world-session/saveGame.ts` (no `SaveGame` change), `app/NavigationService.ts`,
  `app/buildRestoredPlay.ts`, `renderer/RoomViewer.tsx`, `renderer/engine/**` (no Three.js
  change), `dialogue/**`, `memory/**`, `persistence/**`, `server/**`, `eslint.config.js`
  (no new rule expected), `package.json` (no new dependency).

## 15. Wording risks (called out deliberately)

- **"journal" ≠ memory, quest engine, or dev event log.** v0 is an **authored data lens +
  pure projection + a read-only overlay**. There is **no** persistence, no `src/memory`
  integration, no LLM summarization, no event-log read, no state machine, and no record of
  anything beyond the six authored predicates. It is not the dev/event log and shows no
  raw events or payloads.
- **"things that happened" is really "current authoritative truth."** The journal observes
  present `WorldState`, not a history. For the demo world this reads as past events because
  the relevant flags/visited/status are **permanent** (one-shot flags never clear, `visited`
  never unsets, and no authored `clear-status` removes `infected`). The one entry on
  *held* state is **`secured-royal-writ`** (`has-item royal-writ`): a writ is only obtained
  and never consumed in the authored world, so it is stable today — but if a future room
  consumed it, that entry would disappear. This is honest ("you no longer have it") and is
  accepted for v0; it is recorded here so the wording is not mistaken for an immutable
  history. (Contrast `claimed-tribute-coin`, which gates on the **permanent pickup flag**,
  not the spendable coin, so spending the coin via `negotiate` never removes it.)
- **"entry appears" ≠ the journal did something.** An entry appears **only** as the
  observation of an authoritative flag / `visited` / status / item an **existing** service
  already wrote. The journal has no write path and cannot record anything itself.
- **"reuse the condition vocabulary" ≠ build a condition engine.** The journal imports the
  existing `ObjectiveCondition` type and the existing pure `evaluateCondition`; it adds **no
  new kind** and **no shared engine** (locked decision 9). If a future entry needed a kind
  the vocabulary lacks, that is a separate, explicitly-scoped change — not done here.
- **Gating must read as deterministic.** "Show only for the example world" is an
  **anchor-room-presence** check (`throne-room` in `roomStates`) plus spec attachment at
  the example bootstrap/restore — not a fuzzy heuristic. Prompt-generated sessions render
  no journal.
- **Collapse state is UI-only.** The collapsible panel adds the slice's only piece of local
  component state (`expanded`); it is never persisted and never touches `WorldState` or
  `SaveGame`.
- **`domain/journal/` placement + the one quest-file edit.** The spec/projector live in the
  domain because they interpret authored data against authoritative state (symmetric with
  `evaluateQuest`); the authored `demoJournal` literal sits in `domain/examples/` to match
  `demoQuest.ts`. Exporting `evaluateCondition` is the **only** edit to the quest path and
  changes no behavior. UI → Domain (the `JournalView` type) and App → Domain (the projector)
  are allowed directions; **no new lint block** is anticipated.

## 16. ADR timing (explicit)

**ADR-0029 is NOT created now.** Per the established cadence (mirrored in the
[ADR-0027](../decisions/ADR-0027-session-save-load-v0.md) and
[ADR-0028](../decisions/ADR-0028-demo-quest-loop-v0.md) plans), the ADR is written in the
**docs closeout, after the source implementation has been reviewed** — so it records what
was actually built, not a forecast. This plan is the pre-code artifact; ADR-0029 plus the
ARCHITECTURE / FAILURE-MODES / AGENTS updates land in slice 3 (§13).
