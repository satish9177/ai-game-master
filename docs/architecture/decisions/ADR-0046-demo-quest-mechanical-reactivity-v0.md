# ADR-0046: Demo Quest Mechanical Reactivity v0 — composition-root exit gate on the Malik flag

- **Status:** Accepted / Implemented - shipped 2026-06-28
- **Date:** 2026-06-28
- **Deciders:** Project owner
- **Extends:** [ADR-0045](./ADR-0045-demo-quest-reactive-loop-v1.md) (Demo Quest Reactive Loop v1),
  [ADR-0028](./ADR-0028-demo-quest-loop-v0.md) (Demo Quest Loop v0)
- **Related:** [ADR-0016](./ADR-0016-multi-room-navigation-cache-v0.md) (navigation/cache),
  [ADR-0015](./ADR-0015-encounter-system-v0.md) (Malik encounter),
  [ADR-0014](./ADR-0014-object-interactions-v0.md) (coffer take-item),
  [ADR-0013](./ADR-0013-world-state-event-log-v0.md) (authoritative `WorldState`)

> Implemented from the pre-code design in the implementation plan
> [`demo-quest-mechanical-reactivity-v0`](../implementation-plans/demo-quest-mechanical-reactivity-v0.md).

## Context

`demo-quest-reactive-loop-v1` ([ADR-0045](./ADR-0045-demo-quest-reactive-loop-v1.md)) made the
authored demo quest *feel* reactive through **read-only presentation**: a quest-aware NPC clue,
a reactive HUD, and a derived "barred vs clear" exit **notice**. It explicitly left the world
**mechanically passive** — its §4 states the north arch's navigation is "unchanged and always
usable… zero softlock surface," and its §5 / Deferred list call out "the optional non-blocking
soft exit gate" and "a mechanical object/exit unlock" as future work.

The remaining gap: actions change the HUD and dialogue, but **object/exit behavior does not
mechanically change**. The player is told the arch is barred, then walks through it anyway. This
slice closes that gap with the **smallest safe mechanical beat**: the north arch is actually
refused until Steward Malik is resolved, then becomes usable — enforced against the existing
authoritative flag, at the composition root, with no quest engine.

Every hook needed already exists:

- The Malik flag `encounter:malik-encounter` is a real `room-state-changed` flag set by
  `planEncounter` ([ADR-0015](./ADR-0015-encounter-system-v0.md)) and projected into
  `WorldState.roomStates['throne-room'].flags`.
- **Malik's `fight` choice has no `requires`** (`domain/examples/throneRoom.ts`), so the flag is
  **always settable** regardless of inventory — the gate is therefore **always clearable**.
- The exit path already routes `RoomViewer.onRequestOpenInteraction → onNavigate →
  App.handleNavigate`, and `RoomViewer` already renders any non-`navigated` `NavigationResult`
  via `navigationResultMessage(result)` and releases `engine.setInteractionLock(false)`. A
  composition-root gate needs **no** renderer or `NavigationService` logic change.

## Decision

Ship **a single authored, composition-root exit gate** keyed on the existing
`encounter:malik-encounter` flag, plus an authored coffer post-use body beat. The v0
defining property of the quest is preserved: **the quest stays a derived lens, not a system.**
`WorldSession` + the append-only `WorldEvent[]` + reducers remain the sole authority; the gate
**reads** an authoritative flag and **appends nothing**.

Implemented slices:

1. A pure `evaluateExitGate` predicate and `blocked` navigation message support.
2. App/composition-root north-arch gate wiring before `NavigationService.navigate`.
3. A pure authored post-use body helper for the tribute coffer, used only on the
   `already-resolved` interaction path.

```
RoomViewer.onRequestOpenInteraction (exit branch, unchanged)
  └─ onNavigate('ruined-safehouse')
       └─ App.handleNavigate                                   ← gate lives here (composition root)
            ├─ read authoritative WorldState (getWorldState)
            ├─ evaluateExitGate({ fromRoomId, toRoomId, state })   ← pure; reads encounter:malik-encounter
            │     • gated   → return { status:'rejected', reason:'blocked' }   (NO move appended)
            │     • not gated → delegate to NavigationService.navigate(...)    (unchanged today)
            └─ RoomViewer shows navigationResultMessage('blocked') + releases interaction lock
```

### 1. The exit gate (mechanical, headline)

A pure predicate `evaluateExitGate({ fromRoomId, toRoomId, state }) →
{ gated: boolean; reason?: 'malik-unresolved' }` returns `gated: true` **only** for the authored
pair `fromRoomId === 'throne-room' && toRoomId === 'ruined-safehouse'` while
`state.roomStates['throne-room']?.flags?.['encounter:malik-encounter'] !== true`. For every other
room pair, and once the flag is set, it returns `gated: false`. Pure, total, deterministic; no
I/O, no `Date.now`/`Math.random`, no input mutation.

`App.handleNavigate` reads fresh authoritative `WorldState`, consults the predicate, and when
gated returns a **`rejected`** `NavigationResult` with the new reason **`'blocked'`** — **without
calling `NavigationService.navigate` and without appending any event**. When not gated it delegates
exactly as today. The gate is consulted **only when the authored demo `questSpec` is attached** to
`ActivePlay` (the existing anchor-room gate from ADR-0028), so prompt-generated sessions never reach
it.

### 2. NavigationService stays generic

`NavigationService` behavior and signature are **unchanged**. The only edit to its file is a
**type-only** addition of `'blocked'` to the `NavigationResult` rejected-reason union; the service
itself never produces `'blocked'` — only `App.handleNavigate` does. The service remains a pure
resolve-then-move with no knowledge of quests, flags, Malik, or authored room ids.

### 3. Authority unchanged — QuestTracker/QuestView are not consulted

The gate reads the **authoritative `WorldState` flag directly**, never `QuestView`/`QuestTracker`.
That keeps the read-only quest projection non-authoritative (AGENTS "UI projection rules"): no
reaction can flip an objective or write a flag, and the gate cannot be driven by a mis-projected
view. The gate **appends no event**, so the append-only log never records a move the player did not
make, and there is no state to corrupt.

### 4. Coffer post-use body (object beat)

The coffer's mechanical state already changes today (first E appends `item-added` + sets
`interaction:offering-coffer`; re-press is idempotent `already-resolved`). v0 adds a small
refinement: when that flag is set, the interaction panel body reads as emptied ("The coffer lies
open and empty - the coin is gone.") instead of the static "a single gold coin remains." This is a
pure authored helper keyed on object id + the existing one-shot flag, applied in `RoomViewer` only
on an `already-resolved` result. It is read-only, authored-object-scoped, and requires no
`throneRoom.ts` or schema edit.

### 5. Softlock argument (why the gate is safe)

- **Malik is always resolvable.** The `fight` choice carries no `requires`, so a player with no
  coin can always set `encounter:malik-encounter` and clear the gate. The intended damage-free path
  (claim the freely-available coffer coin → `distract`, which does **not** consume the coin) also
  clears it; `fight` (−15 HP) is the fallback.
- **The gate appends nothing on block**, so a refused attempt leaves authoritative state untouched.
- **The gate is one-directional and scoped:** it only blocks `throne-room → ruined-safehouse`. It
  never blocks re-entry, never traps the player in the safehouse, and the flag is monotonic (never
  unset).
- **The UI never freezes:** `RoomViewer` releases the interaction lock on any message-bearing
  result, including `'blocked'`.

### 6. Explicitly excluded from v0

- No generic/data-driven quest or gate engine; no `RoomSpec`/`questSpec` schema field for exit
  conditions.
- No reactive 3D-HUD prompt rewriting (no renderer/engine change).
- No `QuestTracker`/`QuestView` authority; no new `WorldEvent`/`WorldCommand`/reducer.
- No second or chained gate; no rewards/loot/inventory grant; no death/game-over handling.
- No generated-room behavior change; no LLM/real-provider involvement; no backend/persistence/
  `SaveGame` change; no memory wiring; no new dependency; no new lint block.

### Gating

Unchanged from v0/v1: the demo `QuestSpec` is attached to `ActivePlay` only for the authored
example world (anchor `throne-room`). Prompt-generated sessions have `quest === null`, never reach
the gate consult, and `evaluateExitGate` returns `gated: false` for any non-authored room pair
regardless — so generated-room navigation is provably unaffected.

### Save/load

Free, exactly as v0/v1: the gate is a pure function of the restored authoritative `WorldState`
(the same Malik flag). A reloaded session reproduces the exact gate state. **No `SaveGame` change.**

### Boundaries

Every touched file sits inside an existing lint block and every dependency direction is already
allowed: `app/exits.ts`, `app/exitGate.ts`, `app/gatedNavigation.ts`, and `App.tsx` are the
composition root; `NavigationService.ts` gains a passive union member only and stays generic.
`app/authoredInteractionBody.ts` is a pure authored UI helper consumed by `RoomViewer` on an
existing result path. The renderer engine, `world-session`, `interactions`, `encounters`,
`dialogue`, `memory`, `persistence`, `server`, `generation`, the `RoomSpec`/world schemas,
`eslint.config.js`, and `package.json` are untouched. **No new lint block.**

### Tests

Pure Vitest, co-located, no new deps, no DOM framework:

- `evaluateExitGate` — gated before the flag for the authored pair; not gated once set; not gated
  for any non-authored room pair; not gated when no quest attached; pure/total/no-throw.
- `exits.test.ts` — `navigationResultMessage('blocked')` returns the barred copy; existing cases
  unchanged.
- `handleNavigate` wiring (recommended) — blocked before the flag **asserts no event appended /
  revision unchanged**; navigates after the flag is set.
- Coffer post-use body lookup — returns the post-use body only when the authored flag is set;
  `undefined` otherwise; pure. `RoomViewer` uses that body only on `already-resolved`.
- Regression — existing `NavigationService.test.ts` stays green (service behavior untouched);
  prompt path has no quest → predicate returns not-gated.

### Log safety

No new log line. `evaluateExitGate` is silent (returns data); the gate path reuses the existing
`navigation` log context. Quest/objective text, NPC text, flag keys, item names/ids, room display
names, and PII are never logged — mirrors the ADR-0013/0014/0015/0028/0029/0045 content-free
discipline.

### What is deliberately not changed

`domain/world/**` (no event/command/reducer/schema field) · `domain/roomSpec.ts` (no schema) ·
`domain/quests/questSpec.ts` (no condition vocab) · `domain/quests/evaluateQuest.ts` ·
`domain/examples/throneRoom.ts` / `ruinedRoom.ts` / `demoQuest.ts` ·
`app/NavigationService.ts` **behavior** (type-only union addition) · `world-session/**` ·
`interactions/**` · `encounters/**` · `dialogue/**` · `memory/**` · `persistence/**` ·
`server/**` · `renderer/engine/**` · `generation/**` · `domain/world/saveGame.ts` /
`world-session/saveGame.ts` · `eslint.config.js` · `package.json`.

## Consequences

- **The world now mechanically reacts.** The north arch refuses passage until Malik is resolved,
  then opens — a real "your action changed the world" beat, one step past ADR-0045's narrative
  notice.
- **Authority unchanged.** `WorldSession` + event log + reducers remain the sole truth. The gate is
  read-only with no append path; it reads the authoritative flag, never `QuestView`.
- **NavigationService stays generic.** No quest knowledge enters the service; the gate lives wholly
  at the composition root.
- **No domain footprint.** Zero new events, commands, reducers, schema fields, or persisted state;
  one pure predicate plus a passive result-type union member.
- **Coffer repeated-use copy now reflects state.** The authored tribute coffer still grants the
  coin exactly once through existing interaction idempotency; repeated use only swaps the displayed
  body after the existing `interaction:offering-coffer` flag is present.
- **No softlock.** Malik is always resolvable (fight has no requirement); the gate appends nothing
  and is one-directional; the UI lock always releases.
- **Hidden for prompt-generated sessions.** The v0 anchor-room gate is reused and the predicate is
  not-gated for any non-authored pair.
- **Save/load restores gate state for free.** No `SaveGame` change.
- **Known limitations:** single authored demo gate only; the "unlock" is binary (barred → open),
  not a graded/affordance change; gating makes Malik
  mandatory, so a future low-HP-arrival path would force the −15 HP fight (safe in the authored
  demo, which starts at full health with a free coin and a non-consuming distract).
- **Deferred (future):** a reactive 3D-HUD prompt or new affordance for the arch; a generic
  data-driven gate vocabulary; multiple/chained gates; quest rewards; generated-quest/generated-room
  gating; LLM/real-provider quest dialogue.

## Implementation Notes

The shipped implementation deliberately kept the mechanical reactivity local:

- `NavigationService` behavior stayed unchanged and generic. It resolves rooms and moves sessions
  exactly as before; it does not know about quests, Malik, authored room ids, or coffer state.
- No `RoomSpec` schema, `WorldEvent`, `WorldCommand`, reducer, backend, persistence, save-game,
  generated-room, or quest-authority change was introduced.
- The coffer body change is presentation-only on an existing `already-resolved` result; it grants no
  item and appends no event.

## Reconciliation with ADR-0045

ADR-0045 §4 describes the north arch as "always usable… narrative only… zero softlock surface,"
and its Deferred list names "the optional non-blocking soft exit gate" and "a mechanical object/
exit unlock" as future work. **This ADR supersedes that specific stance:** the arch is now
mechanically gated (still no softlock, because Malik is always resolvable). If ADR-0045's narrative
exit-notice overlay is built, its "barred/open" copy must read from the **same**
`encounter:malik-encounter` flag so the notice and the mechanics never disagree; if that overlay is
not built, this gate's `blocked` message is the visible feedback and the overlay can be dropped to
avoid duplicate messaging. See the note added to ADR-0045 §4.
