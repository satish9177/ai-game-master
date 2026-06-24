# Implementation Plan — `feature/demo-quest-loop-v0`

> Status: **implemented — closed.** Source reviewed and merged on
> `feature/demo-quest-loop-v0`. ADR-0028 created; ARCHITECTURE, FAILURE-MODES, and AGENTS
> updated. Closed 2026-06-24.
>
> Companion docs: [ARCHITECTURE](../ARCHITECTURE.md) · [BOUNDARIES](../BOUNDARIES.md) ·
> [FAILURE-MODES](../FAILURE-MODES.md) · [CONVENTIONS](../CONVENTIONS.md). Direct
> precedent and dependencies:
> `world-state-event-log-v0` ([ADR-0013](../decisions/ADR-0013-world-state-event-log-v0.md))
> defines the authoritative `WorldState` this quest reads — `inventory`, and
> `roomStates[*].{ visited, flags }` — and the append-only event log that is the sole
> truth;
> `object-interactions-v0` ([ADR-0014](../decisions/ADR-0014-object-interactions-v0.md))
> is the path that already writes the one-shot flag `interaction:offering-coffer`;
> `encounter-system-v0` ([ADR-0015](../decisions/ADR-0015-encounter-system-v0.md))
> is the path that already writes the resolution flag `encounter:malik-encounter`;
> `multi-room-navigation-cache-v0` ([ADR-0016](../decisions/ADR-0016-multi-room-navigation-cache-v0.md))
> already sets `roomStates['ruined-safehouse'].visited` on `moved-to-room` **and returns
> the post-move `WorldState`** in its `navigated` result (Objective 3);
> `inventory-health-ui-v0` ([ADR-0026](../decisions/ADR-0026-inventory-health-ui-v0.md))
> is the App-level overlay + pure-projection precedent this UI mirrors one-for-one;
> `session-save-load-v0` ([ADR-0027](../decisions/ADR-0027-session-save-load-v0.md))
> establishes that **derived views are re-projected from the restored `WorldState`**, so
> quest progress is restored for free with no `SaveGame` change.

## Goal

Add a tiny, **authored, deterministic demo quest** to the example world, presented as a
**read-only quest tracker** that is a **pure projection of authoritative `WorldState`**.
The three objectives complete because existing object-interaction and
encounter resolutions, and existing navigation, already write the exact flags and
`visited` marks the projection reads. The tracker **reads truth and never writes it**.

The defining property: **the quest is a derived lens, not a system.** `WorldSession` +
the append-only `WorldEvent[]` + reducers stay the sole authority. The quest adds **no
event, no command, no reducer, no room flag, and no authored-room edit**. It cannot
complete an objective on its own, cannot block play, and has no append path. The first
demo sequence is fully authored and never depends on organic LLM prompt interactions.

The work is small and additive because every hook already exists and is authored: a
stable-id pickup that writes a permanent flag, a stable-id encounter that writes a
permanent resolution flag, and a navigation event that sets `visited`. The only gaps are
(a) authored quest data, (b) a pure evaluator, (c) a presentational overlay, and (d) a
few lines of App glue that re-project from state the app already holds.

---

## 1. Status

**Implemented — closed.** Source merged; docs closeout complete 2026-06-24. See
[ADR-0028](../decisions/ADR-0028-demo-quest-loop-v0.md).

## 2. Current repo facts (verified against source)

- **`offering-coffer` already writes `interaction:offering-coffer`.** In
  `domain/examples/throneRoom.ts` the coffer is a `take-item` interaction with stable
  `id: 'offering-coffer'`. `domain/interactions/planInteraction.ts` (`planTakeItem` →
  `oneShotFlag(undefined, ref)`) writes a permanent one-shot flag `interaction:<ref>`
  onto `state.currentRoomId`. ⇒ opening the coffer in the throne room sets
  `roomStates['throne-room'].flags['interaction:offering-coffer'] === true` and adds a
  `gold-coin`.
- **`malik-encounter` already writes `encounter:malik-encounter`.** In `throneRoom.ts`
  the steward's interaction carries an `encounter` with `id: 'malik-encounter'`.
  `domain/encounters/planEncounter.ts` (`resolveKey` → `encounter:<id>`) writes a
  permanent resolution flag onto `state.currentRoomId` for **any** resolved choice
  (`distract` / `negotiate` / `fight`). ⇒ resolving the encounter sets
  `roomStates['throne-room'].flags['encounter:malik-encounter'] === true`.
- **`moved-to-room` already sets `visited`.** `domain/world/applyEvent.ts` marks the
  destination room `visited: true` on `moved-to-room`. Entering the safehouse via the
  throne room's north arch (`exit.toRoomId: 'ruined-safehouse'`) sets
  `roomStates['ruined-safehouse'].visited === true`.
- **App already owns state-derived overlays.** `App.tsx` owns `playerHud:
  PlayerHudView | null`, seeds it from session-start `WorldState`, refreshes it from the
  `WorldState` that interaction/encounter resolves return (via `onWorldStateChange`), and
  renders `<StatusHud>` as an **App-level overlay sibling** of `RoomViewer` (so it
  survives `RoomViewer`'s navigation remount). The quest tracker reuses this exact
  pattern.
- **Navigation already returns the post-move state.** `app/NavigationService.ts`'s
  `navigated` result is `{ status:'navigated'; room; state: WorldState; cacheHit }`, and
  `App.handleNavigate` already has that result in hand — so Objective 3 can be re-projected
  immediately on a move with an **App-only** change (no `RoomViewer`/`NavigationService`
  edit) (§9).
- **Save/load restores `WorldState` and re-derives views.** `world-session/saveGame.ts`
  round-trips the integrity-checked `SaveGame`; `app/buildRestoredPlay.ts` rebuilds
  `ActivePlay` and re-derives `playerHud` from the restored `WorldState`. Anything that
  is a pure function of `WorldState` is restored for free — including quest progress
  (§10).
- **Flags are permanent and per-room; inventory/visited are authoritative.** All four
  facts above live in `WorldState`, which the projection reads directly. None of this
  derivation requires a new event, command, reducer, or flag.
- **Test environment is node, no DOM** (no `jsdom`/`@testing-library`; `vite.config.ts`
  declares no test env). Pure Vitest only; no component tests today.

## 3. Locked decisions

1. **Option A — pure read-only quest tracker over existing state/events.** No
   authored-room edits unless implementation discovers an unavoidable reason (§16).
2. **Objective 1 — claim the tribute coin:** done by
   `roomStates['throne-room'].flags['interaction:offering-coffer'] === true`.
3. **Objective 2 — get past Steward Malik:** done by
   `roomStates['throne-room'].flags['encounter:malik-encounter'] === true`. **Any**
   encounter resolution counts (`distract` / `negotiate` / `fight`).
4. **Objective 3 — enter the safehouse:** done by
   `roomStates['ruined-safehouse'].visited === true`.
5. **Completion:** all three objectives done → quest `complete`.
6. **Gate the quest to the authored example world / throne-room path.** Do **not** render
   the demo quest for prompt-generated sessions (§6).
7. **Place the spec + evaluator under `domain/quests/`.**
8. **Quest UI/progress is a read-only projection from authoritative `WorldState`.** No
   write path, no logs (§8, §12).
9. **No quest engine.** No new `WorldEvent`/`WorldCommand`. No reducer changes.
10. **No LLM quest generation. No backend/memory/persistence wiring. No new dependencies.
    No DOM tests.**
11. **App re-projects quest progress from the navigation result state** so Objective 3
    completes immediately after moving (§9).

## 4. Authority model

- **Truth (authoritative):** the per-session append-only `WorldEvent[]`, with
  `WorldState` as its reconstructable projection — here specifically `inventory` and
  `roomStates[*].{ visited, flags }`. The only write path remains
  `WorldSession.appendEvent → applyEvent → store.commit`, exercised solely by the
  existing interaction / encounter / navigation services.
- **Authored lens (not state):** the `QuestSpec` — fixed, hand-authored data that
  *describes which authoritative conditions an objective watches*. It is never a
  `WorldEvent`, `WorldState`, `CanonSeed`, `SaveGame` field, or persisted row, and it is
  never executed as behavior (its conditions are a closed vocabulary interpreted by a
  trusted pure function, mirroring how `planInteraction`/`planEncounter` interpret
  authored effect data).
- **Derived UI (not truth):** the `QuestView` = `evaluateQuest(spec, worldState)`. A
  pure, total, deterministic read cache — like `PlayerHudView`. It never feeds back into
  an event, reducer, snapshot, flag, or store, and has no code path to do so.

A quest objective flipping to "done" is **only** the observation of an authoritative flag
or `visited` mark that an existing service already wrote. The quest cannot set it.

## 5. v0 quest spine — "The Steward's Toll"

Genre-neutral framing; anchored in the starting room (`throne-room`) with one crossing
into `ruined-safehouse`. Objectives 1–2 gate on permanent flags (not transient
inventory), so spending the coin later never un-completes an objective.

- **Start condition** — the example session starts in `throne-room` (existing bootstrap);
  the quest is seeded `active`.
- **Objective 1 — "Claim the tribute coin."** Open the offering coffer →
  `roomStates['throne-room'].flags['interaction:offering-coffer'] === true`. Adds a
  `gold-coin` (which in turn unlocks Malik's coin-gated options — emergent sequencing, no
  hard lock).
- **Objective 2 — "Get past Steward Malik."** Resolve the encounter by any branch →
  `roomStates['throne-room'].flags['encounter:malik-encounter'] === true`. `negotiate`
  spends the coin for a `royal-writ`; `distract` keeps the coin; `fight` costs health.
  All three resolve the objective.
- **Objective 3 — "Cross into the safehouse."** Take the north arch →
  `roomStates['ruined-safehouse'].visited === true`.
- **Completion** — all three done → quest `complete`.
- **No fail state.** Health may drop (Malik `fight`) and statuses may appear (the
  safehouse walker's `infected`); these surface in the HUD but never gate or fail the
  quest. If the player never acts, the quest simply stays `active`.

## 6. Gating

- **Show only for the authored example world / throne-room path.** The demo quest is
  bound to the authored rooms; its conditions reference `throne-room` /
  `ruined-safehouse`. It is meaningless in a prompt-generated single-room session.
- **Mechanism:** `App` attaches the `QuestSpec` to `ActivePlay` **only** on the example
  bootstrap and on a restore whose **anchor room id `throne-room` is present in
  `state.roomStates`**; the prompt-generated play leaves it unset. Quest derivation then
  runs only when a spec is attached:
  `quest = demoQuestSpec ? evaluateQuest(demoQuestSpec, state) : null`.
- **Result:** for prompt-generated sessions `quest === null` → the tracker is **not
  rendered** (mirrors `playerHud === null`). Because the projection is read-only and
  total, even a mis-gate could only mis-display, never corrupt — but the anchor-presence
  gate is deterministic and safe.

## 7. Data model

**`QuestSpec` — authored data, closed condition vocabulary** (new,
`domain/quests/questSpec.ts`; zod-validated, DATA ONLY — mirrors
`domain/interactions/effects.ts` / `domain/encounters/encounterSpec.ts`):

```ts
// Closed vocabulary; each kind is interpreted by a trusted pure fn against WorldState.
type ObjectiveCondition =
  | { kind: 'room-flag'; roomId: string; flag: string }   // roomStates[roomId]?.flags?.[flag] === true
  | { kind: 'has-item'; itemId: string; min?: number }    // inventory qty >= (min ?? 1)
  | { kind: 'room-visited'; roomId: string }              // roomStates[roomId]?.visited === true
  | { kind: 'has-status'; status: string }                // player.status.includes(status)

type QuestObjective = { id: string; text: string; condition: ObjectiveCondition }

type QuestSpec = {
  questId: string
  title: string
  anchorRoomId: string          // gate: render only when present in roomStates (§6)
  objectives: QuestObjective[]  // ordered for display only; no ordering is enforced
}
```

The v0 spine uses only `room-flag` (×2) and `room-visited` (×1); `has-item` / `has-status`
round out a small reusable vocabulary at trivial cost. The authored demo quest literal
(`domain/quests/demoQuest.ts`) wires the three objectives in §5 to the §3 conditions.

**`QuestView` — derived UI projection** (new, produced by
`domain/quests/evaluateQuest.ts`):

```ts
type QuestObjectiveView = { id: string; text: string; done: boolean }
type QuestView = {
  questId: string
  title: string
  status: 'active' | 'complete'   // 'complete' iff every objective.done
  objectives: QuestObjectiveView[]
}

export function evaluateQuest(spec: QuestSpec, state: WorldState): QuestView
```

`evaluateQuest` is pure/total/deterministic: no I/O, no `Date.now`/`Math.random`, no
input mutation, reads conditions defensively (optional chaining), imports only the
`WorldState` (and `QuestSpec`) **types**, and exports no `WorldCommand`/`WorldEvent`
-producing function.

## 8. UI

- **Component:** `renderer/ui/QuestTracker.tsx`, presentational React only (peer of
  `StatusHud`): props `{ view: QuestView }` in, DOM out. Imports the `QuestView` type and
  React; imports **no** `three`, engine internals, `world-session`, or services; holds no
  state beyond render.
- **Placement:** an **App-level overlay** sibling of `RoomViewer` / `StatusHud` /
  `notice`, so it survives `RoomViewer`'s navigation remount. `pointer-events: none`;
  `role="status"` + `aria-live="polite"` so objective completion is announced. Positioned
  clear of the HUD (top-left), the bottom-center interaction `.hud`, and the top
  `PromptBar`/`notice` — e.g. top-right. Styled with new `.quest-tracker*` rules in
  `index.css`, consistent with `.status-hud*` / `.room-notice`.
- **Render:** the quest `title`; each objective with a done marker (e.g. ☑ vs ▢) and its
  authored `text`; a "Complete" header state when `status === 'complete'`. No timers, no
  animation logic, no interactivity.
- **No write path:** the tracker receives only data; `App` gates rendering on
  `quest != null`. It has no service import and no append path (structural).
- **No logs:** the component is presentational and the projection is pure; **no new log
  line** is added anywhere (§12).

## 9. Navigation

Objective 3 watches `roomStates['ruined-safehouse'].visited`, which is set by
`moved-to-room`. Unlike interaction/encounter resolves, navigation does **not** flow
through `onWorldStateChange` today — but `App.handleNavigate` already receives the
post-move `WorldState` on the `navigated` result (`NavigationService` §2). So:

- In `handleNavigate`'s `navigated` branch, `App` **re-projects derived views from
  `result.state`** (the quest, and harmlessly the HUD), so Objective 3 flips to done the
  instant the player enters the safehouse.
- This is an **App-only** addition that consumes state already in hand — **no**
  `RoomViewer`, `NavigationService`, or engine change.
- **Safe fallback:** if this re-projection were ever omitted, Objective 3 would simply
  light up on the next interaction/encounter resolve instead of immediately — never
  wrong, only lagged.
- **Recommended shape:** a single small `App` helper (e.g. `refreshDerivedViews(state)`)
  that sets `playerHud` and (when a `QuestSpec` is attached) `quest`, called at every
  point `App` obtains a fresh `WorldState`: bootstrap seed, `onWorldStateChange`,
  `handleNavigate` (`navigated`), and load. This centralizes derivation and keeps the
  quest and HUD consistently fresh.

## 10. Save/load

- **Quest progress is re-derived from the restored `WorldState`.** Progress is a pure
  function of `inventory` + `roomStates`, both of which `SaveGameService` /
  `WorldStore.restoreSession` restore faithfully. On load, `App` evaluates the spec
  against the restored state (the same place `buildRestoredPlay` re-derives `playerHud`),
  so a save taken mid-quest resumes at exactly the right objectives.
- **No `SaveGame` changes.** No new persisted field; the `QuestSpec` is authored data, not
  state, and the `QuestView` is derived — neither is serialized.
- **Gate on restore:** attach the demo quest (and thus render the tracker) only when the
  restored state's `roomStates` contains the anchor `throne-room` (§6); a restored
  prompt-generated session shows no quest.

## 11. Failure behavior

| Situation | Detection | Handling / result | Logging |
| --- | --- | --- | --- |
| **No active session / not yet seeded** | `quest === null` in `App` | tracker not rendered; no crash | — |
| **Player lacks an item / hasn't acted** | condition reads `false` | objective stays incomplete; quest stays `active` | — |
| **Prompt-generated session** | no `QuestSpec` attached (anchor gate) | tracker not rendered | — |
| **Missing room / object / flag** | defensive optional-chaining in `evaluateQuest` | condition → `false`; never throws | — |
| **Loaded mid-quest** | re-project from restored `WorldState` | exact progress; no special handling | — |
| **Save/load restores old state** | projection mirrors restored state | progress correct by construction | — |
| **Navigation just occurred (Obj 3)** | `App` re-projects from `navigated` `result.state` | Objective 3 flips done immediately; if omitted, next resolve refreshes it | — |
| **Objective already done, re-triggered interaction** | existing `already-resolved` still carries `state` | re-project is idempotent; objective stays done | — |
| **Coin spent via `negotiate`** | Obj 1 gates on the permanent pickup flag, not held coin | Objective 1 stays done | — |

The tracker is read-only with no append path, so no displayed quest state can corrupt
truth.

## 12. Log safety

- **The evaluator and the component log nothing** (the projection is pure; `QuestTracker`
  is presentational). This slice adds **no new log line** to `App`/`RoomViewer`/services.
- **Never log:** quest/objective `title`/`text`, `questId`/objective ids, flag keys,
  item names/ids, `status` strings, room display names, or any narrative/PII — mirrors the
  ADR-0013/0014/0015/0026 content-free discipline. Any future diagnostic must be
  restricted to counts/codes/booleans.

## 13. Tests (Vitest; co-located; pure only; no DOM, no new deps)

- **Pure evaluator (`domain/quests/evaluateQuest.test.ts`):**
  - each objective flips `done: false → true` on the precise `WorldState`
    (`interaction:offering-coffer` flag; `encounter:malik-encounter` flag;
    `ruined-safehouse` `visited`);
  - `status` is `complete` iff **all** objectives done, else `active`;
  - each condition kind is covered (`room-flag`, `has-item` incl. `min`, `room-visited`,
    `has-status`);
  - **defensive:** absent room / absent `flags` / absent `visited` / unrelated
    (generated) state → all incomplete, no throw;
  - **purity / no-mutation:** input `WorldState` deep-equal before and after; returned
    view objects/arrays are fresh; **structural read-only** — the module imports no
    `world-session`/service and exports no `WorldCommand`/`WorldEvent`-producing function.
- **Save/load implication:** a projection test over a `WorldState` equivalent to a
  post-restore state (flags + `visited` set) asserts progress is reproduced. **No
  `SaveGame` code changes**, so no new save/load code test is required.
- **No DOM/component tests** (no `jsdom`/`@testing-library`; none added). The tracker is
  kept trivially presentational; the evaluator tests cover the logic; App wiring is
  exercised manually in the running app.
- **No reducer / interaction / encounter / navigation tests** — those sources are **not
  changed**, so none are added.

## 14. Proposed source slices

Each slice keeps `npm run build` / `npm run lint` / `npm run test` (in `apps/web`) green;
the maintainer commits each manually.

1. **`feat(domain): demo quest spec + evaluator`** — `domain/quests/questSpec.ts`
   (schema + closed condition vocabulary), `domain/quests/demoQuest.ts` (authored
   literal for the §5 spine), `domain/quests/evaluateQuest.ts` (+ `evaluateQuest.test.ts`).
   Pure + headless; **not yet wired**. No `eslint.config.js` change.
2. **`feat(ui): quest tracker overlay + wiring`** — `renderer/ui/QuestTracker.tsx`
   (presentational) + `.quest-tracker*` styles in `index.css`; `App.tsx` owns
   `quest: QuestView | null`, attaches the spec to `ActivePlay` on the example
   bootstrap and on anchor-gated restore, re-projects via a small
   `refreshDerivedViews(state)` helper at bootstrap / `onWorldStateChange` /
   `handleNavigate` (`navigated`) / load, and renders `<QuestTracker>` as an App-level
   overlay. No domain/service/`RoomViewer`/engine change.
3. **`docs(architecture): record demo-quest-loop-v0`** *(closeout — after source
   review)* — **create ADR-0028**; add a FAILURE-MODES case (quest tracker display); add
   an ARCHITECTURE section + a short AGENTS.md status note; touch BOUNDARIES only if a
   rule actually changed (not anticipated — §16); flip this plan and ADR-0028 to
   *implemented*.

## 15. Files likely to change

- **New (domain):** `domain/quests/questSpec.ts`, `domain/quests/demoQuest.ts`,
  `domain/quests/evaluateQuest.ts`, `domain/quests/evaluateQuest.test.ts`.
- **New (UI):** `renderer/ui/QuestTracker.tsx`.
- **Edited (composition root):** `App.tsx` (own/seed/gate `quest`, attach spec to
  `ActivePlay`, `refreshDerivedViews` at the four state points, render the overlay);
  `index.css` (`.quest-tracker*` styles).
- **Docs (slice 3, closeout):** new `ADR-0028`; `FAILURE-MODES.md` (new case);
  `ARCHITECTURE.md` + `AGENTS.md` (short status); `BOUNDARIES.md` only if needed; this
  plan flipped to *implemented*.
- **Deliberately NOT changed:** `domain/world/**` (no new event, command, reducer, or
  schema field — `events.ts` / `applyEvent.ts` / `worldState.ts` untouched),
  `domain/examples/throneRoom.ts` / `ruinedRoom.ts` (no authored-room edit — §16),
  `domain/interactions/**`, `domain/encounters/**`, `interactions/**`, `encounters/**`,
  `world-session/**`, `domain/world/saveGame.ts` / `world-session/saveGame.ts` (no
  `SaveGame` change), `app/NavigationService.ts`, `app/buildRestoredPlay.ts`,
  `renderer/RoomViewer.tsx`, `renderer/engine/**` (no Three.js change), `dialogue/**`,
  `memory/**`, `persistence/**`, `server/**`, `eslint.config.js` (no new rule expected —
  §16), `package.json` (no new dependency).

## 16. Wording risks (called out deliberately)

- **"quest" ≠ quest engine.** v0 is an **authored data lens + pure projection + a
  read-only overlay**. There is **no** state machine, scheduler, branching planner,
  reward system, objective-ordering enforcement, or quest log of multiple/chained quests.
  The objectives in §5 are display order only; nothing is gated by the quest.
- **"objective complete" ≠ the quest did something.** An objective flips to done **only**
  as the observation of an authoritative flag / `visited` mark that an **existing**
  service already wrote. The quest has no write path and cannot advance itself.
- **"Option A — no authored-room edits."** The plan relies on existing stable ids and
  flags (`offering-coffer`, `malik-encounter`, the north arch). If implementation
  surfaces an **unavoidable** reason to touch an authored room (e.g. a missing/renamed
  stable id), the **smallest** necessary edit is made and recorded in closeout — it is
  not expected, and the throne-room ids above are verified present today.
- **Gating must read as deterministic.** "Show only for the example world" is implemented
  as an **anchor-room-presence** check (`throne-room` in `roomStates`) plus spec
  attachment at the example bootstrap/restore — not a fuzzy heuristic. Prompt-generated
  sessions render no quest.
- **`domain/quests/` placement.** The spec/evaluator live in the domain because they
  interpret authored data against authoritative state (symmetric with
  `planInteraction`/`planEncounter`); the authored `demoQuest` literal is co-located
  there rather than in `domain/examples/` to keep the quest vocabulary together. UI →
  Domain (the `QuestView` type) and App → Domain (the evaluator) are allowed directions;
  **no new lint block** is anticipated.
- **Navigation re-projection is additive.** Re-projecting derived views in
  `handleNavigate` consumes state the App already holds; it is **not** a new
  `RoomViewer`/`NavigationService` seam and changes no navigation behavior.

## 17. ADR timing (explicit)

**ADR-0028 is NOT created now.** Per the established cadence (mirrored in
[ADR-0026](../decisions/ADR-0026-inventory-health-ui-v0.md)'s and
[ADR-0027](../decisions/ADR-0027-session-save-load-v0.md)'s plans), the ADR is written in
the **docs closeout, after the source implementation has been reviewed** — so it records
what was actually built, not a forecast. This plan is the pre-code artifact; ADR-0028 plus
the ARCHITECTURE / FAILURE-MODES / AGENTS updates land in slice 3.
