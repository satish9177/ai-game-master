# Implementation Plan — `feature/demo-quest-mechanical-reactivity-v0`

> Status: **design approved — not yet implemented.** Maintainer approved the mechanical
> exit-gate scope on 2026-06-28; no source written yet. The ADR for this slice is
> [ADR-0046](../decisions/ADR-0046-demo-quest-mechanical-reactivity-v0.md) (Proposed).
>
> Companion docs: [ARCHITECTURE](../ARCHITECTURE.md) · [BOUNDARIES](../BOUNDARIES.md) ·
> [FAILURE-MODES](../FAILURE-MODES.md) · [CONVENTIONS](../CONVENTIONS.md). Direct precedent and
> dependencies:
> `demo-quest-reactive-loop-v1` ([ADR-0045](../decisions/ADR-0045-demo-quest-reactive-loop-v1.md))
> made the quest *feel* reactive through read-only presentation and **deferred** the mechanical
> object/exit unlock — this slice picks up that deferred item;
> `demo-quest-loop-v0` ([ADR-0028](../decisions/ADR-0028-demo-quest-loop-v0.md)) establishes "the
> quest is a derived lens, not a system" and the anchor-room gate that keeps the demo quest
> attached only for the authored world;
> `encounter-system-v0` ([ADR-0015](../decisions/ADR-0015-encounter-system-v0.md)) defines the
> Malik encounter and the `encounter:malik-encounter` flag this gate reads;
> `multi-room-navigation-cache-v0` ([ADR-0016](../decisions/ADR-0016-multi-room-navigation-cache-v0.md))
> defines `NavigationService` (the generic resolve-then-move the gate must **not** make
> quest-aware);
> `world-state-event-log-v0` ([ADR-0013](../decisions/ADR-0013-world-state-event-log-v0.md))
> defines the authoritative `WorldState` (`roomStates[*].{ visited, flags }`) and the append-only
> event log that stays the sole truth.

## Goal

Make the authored demo world **mechanically** react to a player action, not just narrate it. The
single headline beat: **the throne-room north arch is refused until Steward Malik is resolved, then
becomes usable** — enforced at the composition root against the existing authoritative
`encounter:malik-encounter` flag, with `NavigationService` left generic and the quest projection
left non-authoritative.

The defining property is unchanged: **the quest is a derived lens, not a system.** `WorldSession` +
the append-only `WorldEvent[]` + reducers stay the sole authority. This slice adds **no event,
command, reducer, room flag, schema field, renderer change, or authored-room/quest-data edit.** The
gate is a pure predicate over `WorldState`; blocking appends nothing.

---

## 1. Status

**Design approved — not yet implemented.** Docs-only artifact (this plan + ADR-0046, plus a
reconciliation note in ADR-0045). Source slices below are pending maintainer go-ahead, one slice at
a time.

## 2. Current repo facts (verified against source)

- **The Malik flag is authoritative and already set today.** `domain/encounters/planEncounter.ts`
  appends a `room-state-changed` command with `flags: { 'encounter:malik-encounter': true }` after
  **any** resolved choice; `evaluateCondition` (`domain/quests/evaluateQuest.ts`) reads it via
  `state.roomStates[roomId]?.flags?.[flag] === true`.
- **Malik's `fight` choice has no `requires`** (`domain/examples/throneRoom.ts`,
  `steward-malik` → `encounter.choices`). `distract` and `negotiate` require `gold-coin ×1`;
  `distract`'s outcome has **no `remove-item`**, so it does not consume the coin. The coffer
  (`offering-coffer`) hands out the coin freely via `take-item`.
- **The exit path is composition-owned.** `domain/examples/throneRoom.ts` `north-door` is an `arch`
  with `interaction.exit.toRoomId === 'ruined-safehouse'`. `app/exits.ts` `buildExitLookup` maps
  object id → `{ toRoomId }`; `RoomViewer.onRequestOpenInteraction` (exit branch) calls
  `onNavigate(exitTarget.toRoomId)` → `App.handleNavigate`.
- **`RoomViewer` already surfaces non-`navigated` results.** It calls
  `navigationResultMessage(result)`; if a message is returned it calls
  `engine.setInteractionLock(false)` and `setNavigationMessage(message)`. So a `rejected`/`'blocked'`
  result is shown and the lock released with **no `RoomViewer` change required**.
- **`App.handleNavigate` (`App.tsx` ~509–538)** currently delegates straight to
  `activePlay.navigation.navigate({ sessionId, toRoomId })`. It has `activePlay` (incl.
  `questSpec`, `sessionId`) and can read authoritative state via the world session.
- **`NavigationService` (`app/NavigationService.ts`)** is generic: resolve-before-append, then
  `session.move`. `NavigationResult` rejected reasons today are
  `'missing-exit' | 'unknown-room' | 'already-here'`.
- **Anchor-room gate exists.** `App` attaches `demoQuestSpec` to `ActivePlay` only for the authored
  example world; prompt-generated/restored-generated sessions have no quest.

## 3. Scope

### In

1. **Pure gate predicate** `evaluateExitGate({ fromRoomId, toRoomId, state }) →
   { gated: boolean; reason?: 'malik-unresolved' }` — `gated: true` only for
   `throne-room → ruined-safehouse` while `encounter:malik-encounter` is unset; `gated: false`
   otherwise. Pure/total/deterministic.
2. **`App.handleNavigate` consult** — read fresh authoritative `WorldState`, call the predicate,
   return a `{ status:'rejected', reason:'blocked' }` `NavigationResult` when gated (no
   `NavigationService.navigate` call, no event appended); otherwise delegate unchanged. Consulted
   only when the demo `questSpec` is attached.
3. **`NavigationResult` type** gains the `rejected` reason **`'blocked'`** (type-only; the service
   never emits it).
4. **`navigationResultMessage`** returns the barred copy for `'blocked'`.

### In (optional second beat — plan only, not this slice's headline)

5. **Coffer post-use body** — a pure authored map keyed on object id + its one-shot flag, applied in
   `RoomViewer` on an `already-resolved` result, so the panel body reads as emptied. No
   `throneRoom.ts`/schema edit. Sequenced after the headline gate; may be deferred entirely.

### Out

Generic/data-driven gate or quest engine · `RoomSpec`/`questSpec` schema fields · reactive 3D-HUD
prompt rewriting · `QuestTracker`/`QuestView` authority · new `WorldEvent`/`WorldCommand`/reducer ·
second/chained gates · rewards/loot/inventory grants · death/game-over handling · generated-room
behavior change · LLM/real-provider · backend/persistence/`SaveGame` change · memory wiring · new
dependency · new lint block.

## 4. Minimum Safe Change Check

- **Reused:** the authoritative `encounter:malik-encounter` flag and `WorldState` read path; the
  existing exit-lookup → `onNavigate` → `handleNavigate` seam; `RoomViewer`'s existing
  non-`navigated`-result handling (message + lock release); the anchor-room quest gate; the existing
  `navigation` log context.
- **New code (minimum):** one pure predicate; one `App.handleNavigate` consult; one passive
  `NavigationResult` union member; one `navigationResultMessage` branch. (Optional beat: one pure
  authored map + one `RoomViewer` body-swap on `already-resolved`.)
- **Safety boundaries unchanged:** authority stays `WorldSession` + event log + reducers; gate is
  read-only and appends nothing; `NavigationService` behavior/signature unchanged; renderer engine,
  schemas, persistence, generation untouched; no new lint block.
- **Targeted tests:** pure predicate; `navigationResultMessage('blocked')`; recommended
  `handleNavigate` no-append-when-blocked wiring; `NavigationService.test.ts` regression.

## 5. Files to touch (source — pending separate go-ahead)

- **`apps/web/src/app/exits.ts`** *(or new `apps/web/src/app/exitGate.ts`)* — add pure
  `evaluateExitGate`; handle `'blocked'` in `navigationResultMessage`.
- **`apps/web/src/app/NavigationService.ts`** — **type-only**: add `'blocked'` to the `rejected`
  reason union. No behavior change.
- **`apps/web/src/App.tsx`** — `handleNavigate` reads authoritative `WorldState`, consults
  `evaluateExitGate` (only when the demo `questSpec` is attached), returns `blocked` when gated.
- *(Optional second beat)* **`apps/web/src/app/interactionEffects.ts`** *(or new
  `app/authoredReactiveText.ts`)* — authored post-use body map + accessor.
- *(Optional second beat)* **`apps/web/src/renderer/RoomViewer.tsx`** — on `already-resolved`, swap
  the panel body from the map. Presentational; no engine import.

## 6. Files NOT to touch

`domain/world/**` · `domain/roomSpec.ts` · `domain/quests/questSpec.ts` ·
`domain/quests/evaluateQuest.ts` · `domain/examples/throneRoom.ts` / `ruinedRoom.ts` /
`demoQuest.ts` · `app/NavigationService.ts` **behavior** (type-only addition) · `world-session/**` ·
`interactions/**` · `encounters/**` · `dialogue/**` · `memory/**` · `persistence/**` · `server/**` ·
`renderer/engine/**` · `generation/**` · `domain/world/saveGame.ts` / `world-session/saveGame.ts` ·
`eslint.config.js` · `package.json`.

## 7. Final implementation slices (one at a time, each independently testable)

1. **`feat(app): pure exit-gate predicate + blocked message`** — `evaluateExitGate`,
   `NavigationResult` `'blocked'` union member, `navigationResultMessage('blocked')`. Unit tests for
   the predicate and the message. Inert (not yet wired).
2. **`feat(app): enforce north-arch gate at composition root`** — `App.handleNavigate` reads
   authoritative `WorldState`, consults the predicate (scoped to the attached demo quest), returns
   `blocked` when the Malik flag is unset. Wiring test: blocked before the flag asserts **no event
   appended / revision unchanged**; navigates after the flag.
3. **`feat(ui): coffer post-use body`** *(optional / may defer)* — authored map + `RoomViewer`
   `already-resolved` body swap; lookup unit test.
4. **`docs`** — flip ADR-0046 status to Accepted/Implemented and update the ARCHITECTURE feature map
   after merge.

## 8. Test plan

- **`evaluateExitGate` (mandatory):** gated for `throne-room → ruined-safehouse` when the flag is
  unset; not gated once set; not gated for any other room pair; not gated with no quest/empty state;
  pure, total, no-throw, no input mutation.
- **`exits.test.ts` (mandatory):** `navigationResultMessage('blocked')` → barred copy; existing
  cases byte-identical.
- **`handleNavigate` wiring (recommended):** with the Malik flag unset, navigate returns `blocked`
  and **the world session appended no event (revision unchanged)**; with the flag set, returns
  `navigated`.
- **Coffer body lookup (mandatory iff the second beat ships):** post-use body only when the flag is
  set; `undefined` for other ids / unset flag; pure.
- **Regression (mandatory):** `NavigationService.test.ts` stays green (service untouched); prompt
  path has no quest → predicate not-gated.

Verification commands: `npm run test -- exits`, `npm run test -- NavigationService`,
then `npm run lint` and `npm run build` (run from `apps/web`).

## 9. Manual smoke checklist

1. Load the authored world. In the throne room, **before** Malik: press E on the north arch →
   **refused**, message "barred until you deal with Steward Malik," player does **not** move.
2. Confront Malik, pick **Fight** (the no-coin path) → flag set.
3. Press E on the north arch again → **navigates** to the safehouse. (Repeat run: claim the coffer
   coin → **Distract** with the coin to confirm the damage-free path also opens it.)
4. Coffer (when the optional beat ships): press E → "You take: Gold Coin ×1"; re-press → panel reads
   **empty** ("the coin is gone"), not "a single gold coin remains."
5. Prompt-generate a room → arches navigate freely (no gate), no coffer override, no quest tracker —
   confirms authored-only scoping.

## 10. Failure modes / safety

- **Softlock:** none. Malik's `fight` has no requirement → flag always settable → gate always
  clearable; the coffer hands out a coin freely and `distract` does not consume it. The gate appends
  nothing on block and is one-directional (never traps the player in the safehouse). The UI lock is
  always released on a message-bearing result.
- **No-append-on-block:** the gate must short-circuit **before** `NavigationService.navigate`;
  asserted by the wiring test so the event log never records a non-move.
- **Scoping leak:** the predicate returns not-gated for every non-authored room pair and the consult
  runs only when the demo quest is attached → generated-room navigation is provably unaffected.
- **Double `getWorldState` read** (handleNavigate + inside the service): harmless — the Malik flag is
  monotonic, so no race can slip a blocked move through or re-block a cleared gate.
- **Health floor:** gating makes Malik mandatory; the only no-coin path is `fight` (−15 HP). Safe in
  the authored demo (full-health start, free coin, non-consuming distract). Flag if a future change
  lets the player arrive low on HP with no coin.
- **Logging:** no new log line; the gate path reuses the existing content-free `navigation` log
  context.
- **Save/load:** the gate is a pure function of restored `WorldState`; no `SaveGame` change.

## 11. Reconciliation with ADR-0045

ADR-0045 §4 calls the arch "always usable… narrative only"; its Deferred list names this exact gate
as future work. This slice supersedes that stance (the arch is now mechanically gated, still no
softlock). If ADR-0045's narrative exit-notice overlay is built, its copy must read the **same**
`encounter:malik-encounter` flag so notice and mechanics agree; otherwise this gate's `blocked`
message is the visible feedback. A pointer note has been added to ADR-0045 §4.
