# Implementation Plan — `feature/demo-quest-reactive-loop-v1`

> Status: **design approved — not yet implemented.** Maintainer approved the read-only
> reactive scope on 2026-06-28; no source written yet. The ADR for this slice is
> [ADR-0045](../decisions/ADR-0045-demo-quest-reactive-loop-v1.md) (Proposed).
>
> Companion docs: [ARCHITECTURE](../ARCHITECTURE.md) · [BOUNDARIES](../BOUNDARIES.md) ·
> [FAILURE-MODES](../FAILURE-MODES.md) · [CONVENTIONS](../CONVENTIONS.md). Direct
> precedent and dependencies:
> `demo-quest-loop-v0` ([ADR-0028](../decisions/ADR-0028-demo-quest-loop-v0.md)) is the
> read-only `evaluateQuest(spec, state) → QuestView` lens this slice extends — it already
> establishes "the quest is a derived lens, not a system," the `refreshDerivedViews`
> helper, and the anchor-room gate;
> `npc-dialogue-foundation-v0` ([ADR-0017](../decisions/ADR-0017-npc-dialogue-foundation-v0.md))
> is the read-only dialogue path (`NPCDialogueService` holds only
> `Pick<WorldSession,'getWorldState'>`, no append capability) this slice feeds the derived
> stage into;
> `npc-dialogue-room-context-v0` ([ADR-0039](../decisions/ADR-0039-npc-dialogue-room-context-v0.md))
> is the precedent for threading an **optional, read-only context object** (room features)
> through `buildNPCDialogueReplyInput → NPCDialogueService → buildDialogueContext →
> FakeNPCDialogueProvider` — the new `quest` context follows the exact same seam;
> `consequence-journal-v0` ([ADR-0029](../decisions/ADR-0029-consequence-journal-v0.md))
> is the second flag-driven read-only overlay precedent (`projectJournal` reacts to the
> same `interaction:offering-coffer` / `encounter:malik-encounter` / `ruined-safehouse`
> signals);
> `world-state-event-log-v0` ([ADR-0013](../decisions/ADR-0013-world-state-event-log-v0.md))
> defines the authoritative `WorldState` (`inventory`, `roomStates[*].{ visited, flags }`,
> `player.status`) and the append-only event log that stays the sole truth.

## Goal

The v0 quest **observes** progress but the world does not visibly **react**: the NPC says
the same persona-cycled lines regardless of quest state, and completion is a bare
"Complete" label. v1 makes the existing authored demo quest *feel reactive* by feeding one
new **derived** datum — the current objective — to three existing consumers, with **zero**
new authority:

1. **NPC quest-awareness** — the demo aide (Asha) returns an authored, stage-appropriate
   clue that **changes after progress**, produced by deterministic fake-provider logic.
2. **Quest HUD acknowledgment** — `QuestTracker` emphasizes the active objective, flashes
   the objective that just flipped done, and shows an authored completion acknowledgment.
3. **Reactive exit notice** — a read-only, derived line that narrates the throne-room
   north arch as *barred* vs *clear*, reading the same authoritative Malik flag.

The defining property is unchanged from v0: **the quest is a derived lens, not a system.**
`WorldSession` + the append-only `WorldEvent[]` + reducers stay the sole authority. v1 adds
**no event, command, reducer, room flag, schema field, navigation gate, renderer change, or
authored-room/quest-data edit.** Every reaction is a pure function of `WorldState` the App
already refreshes at the four canonical `refreshDerivedViews` points.

---

## 1. Status

**Design approved — not yet implemented.** Docs-only artifact (this plan + ADR-0045).
Source slices below are pending maintainer go-ahead, one slice at a time.

## 2. Current repo facts (verified against source)

- **The quest is already a pure read-only lens.** `domain/quests/evaluateQuest.ts`:
  `evaluateQuest(spec, state) → QuestView { questId, title, status:'active'|'complete',
  objectives: { id, text, done }[] }`. Pure/total, defensive optional-chaining, imports
  only domain types, exports no `WorldCommand`/`WorldEvent`-producing function.
- **The three objectives gate on existing authoritative facts** (`domain/examples/demoQuest.ts`):
  O1 `room-flag throne-room interaction:offering-coffer` · O2 `room-flag throne-room
  encounter:malik-encounter` · O3 `room-visited ruined-safehouse`. All three are written
  today by existing interaction / encounter / navigation services (ADR-0028 §2).
- **The App already owns the current `QuestView`.** `App.tsx` holds `quest` via
  `computeDerivedViews(state, questSpecRef.current, journalSpecRef.current)` in
  `app/derivedViews.ts`, refreshed by `refreshDerivedViews(state)` at **four** points:
  bootstrap seed, `onWorldStateChange` (interaction/encounter resolve), `handleNavigate`
  (`navigated` `result.state`), and `handleLoad` (restored state). The spec is attached to
  `ActivePlay.questSpec` only for the authored example world (gate by `questSpec == null`).
- **The dialogue path is read-only and already threads an optional context object.**
  `renderer/RoomViewer.tsx` builds the reply via
  `buildNPCDialogueReplyInput({ sessionId, target, history, playerLine, roomContext })`
  (`app/npcDialogueReplyInput.ts`) and calls `npcDialogueService.reply(...)`.
  `NPCDialogueService.reply` calls `getWorldState(sessionId)` then
  `buildDialogueContext(state, npc, history, roomContext)` and passes the context to the
  provider. `roomContext` (room features, ADR-0039) is **the exact pattern** the new
  `quest` context follows — an optional object copied through `buildDialogueContext` into
  `NPCDialogueContext`.
- **`buildDialogueContext` already projects authoritative facts** (`player.health`,
  `player.status`, `inventoryItemIds`) into provider-safe context; it does **not** yet
  carry quest stage. `RoomDialogueContext` is stored in `roomDialogueContextRef` and read
  at talk time — the new quest stage uses an analogous ref so it is always current.
- **`FakeNPCDialogueProvider` selects lines deterministically** by `persona`/`playerLine`
  (`PROMPT_LINES`/`PERSONA_LINES`), then room focus (`ROOM_FOCUS_LINES`), then
  `FALLBACK_LINES`. It performs no logging or network I/O. Asha is persona
  `friendly-aide`; Malik is encounter-first (no dialogue spec).
- **`QuestTracker.tsx` is presentational** (`{ view: QuestView }` in, DOM out;
  `pointer-events:none`; `role="status"`/`aria-live="polite"`). It already renders a
  "Complete" state; it has no `activeObjectiveId` concept and no flash.
- **The App already renders App-level overlays** as siblings of `RoomViewer`
  (`StatusHud`, `QuestTracker`, `JournalPanel`, `AppRoomEntryOverlay`). A new read-only
  reactive-exit overlay slots into the same place with no remount risk.
- **Save/load restores quest progress for free** — `QuestView` (and the new derived
  `activeObjectiveId`) is a pure function of restored `WorldState`; no `SaveGame` change
  (ADR-0027/0028).
- **Test environment is node, no DOM** (no `jsdom`/`@testing-library`). Pure Vitest only;
  the existing `RoomViewer.test.ts` exercises reply-input shape without a DOM framework.

## 3. Locked decisions (maintainer-approved 2026-06-28)

1. **Keep v1 read-only / reactive.** No new authority of any kind.
2. **Add the active-objective derivation** as a pure addition to `QuestView`.
3. **`QuestTracker` active emphasis + completion feedback** (presentational only).
4. **NPC quest-aware *fake* dialogue for the demo NPC** (authored clue table; not LLM,
   not an authored-room projection).
5. **Non-blocking reactive exit notice** (read-only derived overlay).
6. **Do NOT include the optional soft exit gate** in v1.
7. **Do NOT change navigation authority** (`app/NavigationService.ts` /
   `App.handleNavigate` navigation behavior unchanged).
8. **Do NOT change the `RoomSpec` schema.**
9. **Do NOT add new `WorldEvent`/`WorldCommand`/reducers.**
10. **Do NOT modify authored room or authored quest data**
    (`domain/examples/throneRoom.ts`, `ruinedRoom.ts`, `demoQuest.ts`, `demoJournal.ts`).
11. **No LLM / real-provider dialogue, no memory, no backend/persistence, no inventory
    or loot rewards, no combat/health change, no new dependencies, no new lint block.**

## 4. Authority model

- **Truth (authoritative, unchanged):** the per-session append-only `WorldEvent[]`, with
  `WorldState` as its reconstructable projection. The only write path remains
  `WorldSession.appendEvent → applyEvent → store.commit`, exercised solely by the existing
  interaction / encounter / navigation services. v1 appends nothing.
- **Derived stage (not truth):** `activeObjectiveId` = the first not-done objective's id
  (`null` when complete), a pure function of `(QuestSpec, WorldState)` computed inside
  `evaluateQuest`. It is render-time only — never a `WorldEvent`, `WorldState`,
  `CanonSeed`, `SaveGame` field, persisted row, or log field.
- **Derived consumers (all read-only):** `QuestTracker` (emphasis/flash/completion line),
  the reactive-exit overlay, and the NPC clue selection. None can write back to truth; the
  dialogue service still holds only `Pick<WorldSession,'getWorldState'>`.

A reaction firing is **only** the observation of an authoritative flag/visited mark an
existing service already wrote — exactly as in v0.

## 5. Derived stage — `activeObjectiveId`

`QuestView` gains one field:

```ts
type QuestView = {
  questId: string
  title: string
  status: 'active' | 'complete'
  activeObjectiveId: string | null   // first objective with done === false; null iff complete
  objectives: QuestObjectiveView[]
}
```

- Pure addition inside `evaluateQuest`: `activeObjectiveId =
  objectives.find(o => !o.done)?.id ?? null`. `status === 'complete'` iff
  `activeObjectiveId === null` (kept consistent with the existing `every(done)` check).
- For "The Steward's Toll" the stage progression is
  `claim-tribute-coin → get-past-steward-malik → enter-the-safehouse → null`.
- Display-order semantics only: objectives are **not** gated; an out-of-order completion
  (e.g. visiting the safehouse first) simply makes `activeObjectiveId` skip to the next
  still-incomplete objective. Nothing blocks.

## 6. NPC quest-awareness

**Seam (mirrors ADR-0039 `roomContext`):** an optional read-only `quest` context object
threaded through the existing dialogue input path.

- **`domain/dialogue/contracts.ts`** — add an optional field to `NPCDialogueContext`:
  ```ts
  questStage?: { activeObjectiveId: string | null; status: 'active' | 'complete' }
  ```
  Ids + enum only — **no objective text/title**, so nothing content-bearing crosses the
  provider boundary or risks a log leak.
- **`domain/dialogue/buildDialogueContext.ts`** — accept an optional `questStage` and copy
  it through (shallow copy, like `roomContext`), omitting the key when absent.
- **`dialogue/NPCDialogueService.ts`** — `NPCDialogueInput` gains optional `questStage`;
  `reply` passes it into `buildDialogueContext`. No other change; the service still only
  reads `getWorldState` and appends nothing. Log payload unchanged (counts/status/ids).
- **`app/npcDialogueReplyInput.ts`** — `buildNPCDialogueReplyInput` accepts and forwards an
  optional `questStage`, spread-guarded like `roomContext`.
- **`renderer/RoomViewer.tsx`** — accept a new optional prop
  `questStage?: { activeObjectiveId: string | null; status: 'active' | 'complete' }`,
  store it in a `questStageRef` (updated each render, mirroring `roomDialogueContextRef`),
  and include `questStage: questStageRef.current` in **both** reply-input call sites
  (initial greeting reply and follow-up `onSay`). Always current because every state
  change calls `refreshDerivedViews` and talking mutates nothing.
- **`App.tsx`** — pass `questStage` to `RoomViewer`, derived from the current `quest`
  view: `quest ? { activeObjectiveId: quest.activeObjectiveId, status: quest.status }
  : undefined`. Undefined for prompt-generated sessions (no quest) → provider behavior
  unchanged.
- **`dialogue/FakeNPCDialogueProvider.ts`** — add an authored clue table and selection:
  ```ts
  const QUEST_CLUE: Record<string, Record<string, string>> = {
    'friendly-aide': {
      'claim-tribute-coin':    "Malik won't let you pass empty-handed — there's a tribute coffer by the dais.",
      'get-past-steward-malik':"You have the coin now. Malik blocks the dais — coin, words, or steel will move him.",
      'enter-the-safehouse':   "Malik's handled. The north arch is yours — the safehouse waits beyond.",
    },
  }
  const QUEST_COMPLETE: Record<string, string> = {
    'friendly-aide': "You made it through. Rest easy, traveler.",
  }
  ```
  **Selection precedence** (extends the existing order, does not reorder it): explicit
  `playerLine` match (`PROMPT_LINES`) → **quest clue for the current stage** (when
  `context.questStage` present and a clue exists for `persona`+`activeObjectiveId`, or the
  complete line when `status === 'complete'`) → existing persona cycle → room-grounded →
  fallback. When `questStage` is absent the provider takes the **exact** existing branch
  order (regression-protected).
- **Result — "line changes after progress":** because the clue is keyed on the *current*
  `activeObjectiveId`, opening the coffer (O1 flag) flips Asha's clue from the coffer hint
  to the Malik hint on the next conversation; resolving Malik flips it to the north-arch
  hint; completion yields the complete line. Malik stays encounter-first (unchanged).

## 7. Quest HUD acknowledgment

**`renderer/ui/QuestTracker.tsx`** (presentational only; no service/world import):

- **Active emphasis:** the objective whose `id === view.activeObjectiveId` is marked as
  the current focus (style class only, e.g. `--active`).
- **Completion flash:** the component keeps a `useRef` of the previous `view` and, when an
  objective transitions `false → true` between renders, briefly applies a flash class to
  that row (a short timer cleared on unmount/next change). This is **component-local
  presentational state only** — never persisted, never written back to domain, resets
  naturally on session/room change (like `RoomIntroPanelState`, ADR-0035).
- **Completion acknowledgment / reward feedback:** when `view.status === 'complete'`,
  render an authored acknowledgment line in place of the bare "Complete" (e.g. *"The
  Steward's Toll — complete. The road north is yours."*). **No inventory/loot/material
  reward** — acknowledgment only.
- Stays `pointer-events:none`, `role="status"`, `aria-live="polite"`. New `.quest-tracker*`
  style rules added to `index.css`, consistent with existing tracker styling.

## 8. Reactive exit notice

A small **read-only** App-level overlay (new presentational component, e.g.
`renderer/ui/QuestExitNotice.tsx`) fed a derived `{ text } | null`:

- **Derivation (App, pure):** when the current room is `throne-room` and the quest is
  attached, map stage → line:
  - O2 not yet done (`activeObjectiveId` is `claim-tribute-coin` or
    `get-past-steward-malik`, i.e. `encounter:malik-encounter` flag absent) →
    *"Steward Malik bars the north arch."*
  - O2 done (Malik flag set) → *"With Malik dealt with, the north arch stands open."*
  - Outside the throne room, or no quest attached → `null` (overlay not rendered).
- The line reflects the **same authoritative Malik flag** the quest reads; it is computed
  from the already-derived `QuestView` (no new state read). It is purely narrative — the
  arch's navigation is **unchanged and always usable**, so there is zero softlock surface.
- Rendered as an App-level overlay sibling (like `JournalPanel`), `pointer-events:none`,
  `role="status"`/`aria-live="polite"`. Implementation may instead fold this into a small
  derived prop on an existing overlay if that proves smaller in code review — the contract
  (read-only, derived, non-blocking) is what is locked.

## 9. Save/load

Unchanged from v0 and free: `activeObjectiveId`, the NPC stage clue, the tracker emphasis,
and the exit notice are all pure functions of the restored `WorldState`. **No `SaveGame`
change.** Loading mid-quest re-derives the exact stage, clue, emphasis, and notice.

## 10. Failure behavior

| Situation | Detection | Handling / result | Logging |
| --- | --- | --- | --- |
| **Prompt-generated session** | `questStage`/`quest` undefined | tracker + exit notice not rendered; provider takes existing non-quest branch | — |
| **No clue for stage/persona** | table miss in provider | fall through to existing persona/room/fallback line | — |
| **Stage momentarily stale** | talk before a refresh | clue lags ≤1 interaction; never wrong (talking mutates nothing; all four resolve points refresh) | — |
| **Objective completed out of order** | `find(!done)` skips it | `activeObjectiveId` points at the next incomplete objective; nothing blocks | — |
| **Quest complete** | `activeObjectiveId === null` | complete clue + acknowledgment line; exit notice shows "open" | — |
| **Missing room/flag** | defensive optional-chaining (existing) | condition → `false`; no throw | — |
| **Loaded mid-quest** | re-derive from restored state | exact stage/clue/notice | — |
| **Flash mid-transition** | prev-view diff in component | brief flash; if missed, row still shows done — never wrong | — |

All consumers are read-only with no append path, so no displayed state can corrupt truth.

## 11. Log safety

- **No new log line** is added by this slice. The evaluator and provider remain silent;
  the tracker and exit notice are presentational; `NPCDialogueService` keeps its existing
  counts/status/ids-only log payload (now optionally including the `questStage` *only* as
  the service already logs — and the new context carries ids/enums, **never** objective
  text).
- **Never log:** quest/objective `title`/`text`, NPC clue/dialogue text, `questId`/
  objective ids as content, flag keys, item names/ids, room display names, or any
  narrative/PII — mirrors the ADR-0013/0014/0015/0017/0028/0029 content-free discipline.

## 12. Tests (Vitest; co-located; pure where possible; no new deps, no DOM framework)

- **`domain/quests/evaluateQuest.test.ts` (extend):** `activeObjectiveId` equals the first
  not-done id at each progression step; `null` when complete; consistent with `status`;
  defensive (absent room/flags → first objective); purity/no-mutation preserved; existing
  assertions still pass.
- **`dialogue/FakeNPCDialogueProvider.test.ts` (extend):** each `activeObjectiveId` yields
  its distinct authored clue for `friendly-aide`; the clue changes when stage advances;
  the complete line on `status === 'complete'`; **precedence** (explicit `playerLine` wins
  over quest clue; quest clue wins over persona cycle); **regression** — with
  `questStage` absent the provider output is byte-identical to today; determinism.
- **`domain/dialogue/buildDialogueContext.test.ts` (extend/add):** copies `questStage`
  through; omits the key when absent; deep-copy/no-mutation; no extra fields leak.
- **`dialogue/NPCDialogueService.test.ts` (extend):** still appends nothing; `questStage`
  in input reaches the provider context; log payload remains counts/status/ids only (no
  quest/clue text).
- **`renderer/RoomViewer.test.ts` (extend):** reply input includes the current
  `questStage` at both call sites; absent-stage path unchanged.
- **No DOM/component tests** for `QuestTracker`/`QuestExitNotice` (kept trivially
  presentational; no `jsdom`/`@testing-library` added). HUD/exit behavior is verified by
  the manual smoke checklist.
- **No reducer/interaction/encounter/navigation tests** — those sources are **not
  changed**.

## 13. Proposed source slices

Each slice keeps `npm run build` / `npm run lint` / `npm run test` (in `apps/web`) green;
the maintainer commits each manually.

1. **`feat(domain): derive active quest objective`** — add `activeObjectiveId` to
   `QuestView` in `domain/quests/evaluateQuest.ts`; extend `evaluateQuest.test.ts`. Pure;
   no consumer yet. Independently mergeable.
2. **`feat(ui): reactive quest tracker`** — `QuestTracker` active emphasis + done-flash +
   completion acknowledgment; `.quest-tracker*` styles in `index.css`. App passes nothing
   new (already has `quest`). No domain/service change.
3. **`feat(dialogue): quest-aware demo NPC`** — `contracts.ts` (`questStage?`),
   `buildDialogueContext.ts` passthrough, `NPCDialogueService` input + passthrough,
   `app/npcDialogueReplyInput.ts` passthrough, `RoomViewer` `questStage` prop/ref + both
   call sites, `App.tsx` wires `questStage` down, `FakeNPCDialogueProvider` `QUEST_CLUE`
   table + selection; extend the four dialogue tests.
4. **`feat(ui): reactive exit notice`** — derive the throne-room exit line from the
   `QuestView` in `App.tsx`; render the read-only overlay; styles. Small.
5. **`docs(architecture): record demo-quest-reactive-loop-v1`** *(closeout — after source
   review)* — flip [ADR-0045](../decisions/ADR-0045-demo-quest-reactive-loop-v1.md) to
   *Accepted — implemented*; add an ARCHITECTURE status bullet + a short AGENTS feature-map
   line; add a FAILURE-MODES case only if behavior warrants; flip this plan to
   *implemented*. Touch BOUNDARIES only if a rule actually changed (not anticipated — §15).

## 14. Files likely to change

- **Edited (domain):** `domain/quests/evaluateQuest.ts` (+ `evaluateQuest.test.ts`),
  `domain/dialogue/contracts.ts`, `domain/dialogue/buildDialogueContext.ts`
  (+ test).
- **Edited (dialogue app layer):** `dialogue/FakeNPCDialogueProvider.ts` (+ test),
  `dialogue/NPCDialogueService.ts` (+ test).
- **Edited (composition root + UI):** `app/npcDialogueReplyInput.ts`,
  `renderer/RoomViewer.tsx` (+ `RoomViewer.test.ts`), `renderer/ui/QuestTracker.tsx`,
  `App.tsx`, `app/derivedViews.ts` *(only if the exit-notice derivation is centralized
  there)*, `index.css`.
- **New (UI):** `renderer/ui/QuestExitNotice.tsx` (presentational; may be omitted if the
  notice folds into an existing overlay during implementation).
- **Docs:** new [ADR-0045](../decisions/ADR-0045-demo-quest-reactive-loop-v1.md) (created
  now as *Proposed*); this plan; ARCHITECTURE/AGENTS status at closeout.
- **Deliberately NOT changed:** `domain/world/**` (no event/command/reducer/schema field) ·
  `domain/roomSpec.ts` (no schema change) · `domain/examples/throneRoom.ts` /
  `ruinedRoom.ts` / `demoQuest.ts` / `demoJournal.ts` (no authored room/quest data edit) ·
  `domain/quests/questSpec.ts` (no condition-vocabulary change) ·
  `domain/world/saveGame.ts` / `world-session/saveGame.ts` (no `SaveGame` change) ·
  `world-session/**` · `interactions/**` · `encounters/**` · `memory/**` ·
  `persistence/**` · `server/**` · `renderer/engine/**` (no Three.js/HUD change) ·
  `app/NavigationService.ts` and `App.handleNavigate` **navigation behavior** (no gate) ·
  `generation/**` · `eslint.config.js` (no new lint block) · `package.json` (no new dep).

## 15. Wording risks (called out deliberately)

- **"reactive" ≠ a reactive engine.** v1 is still an authored data lens + pure projection +
  read-only overlays + a deterministic fake-provider clue table. There is no scheduler,
  state machine, branching planner, reward system, or objective-ordering enforcement.
- **"NPC reacts" ≠ the NPC mutates anything.** The dialogue path stays read-only
  (`getWorldState` only). The clue is selected from the **derived** stage; talking writes
  nothing and cannot advance the quest.
- **"exit notice" ≠ exit gate.** The north arch's navigation is **unchanged and always
  usable**; the notice is narrative only. The optional soft gate is explicitly **excluded**
  from v1 (decision §3.6).
- **"reward feedback" ≠ a reward.** Completion shows an authored acknowledgment line; no
  item, status, flag, or inventory change occurs (no inventory system added).
- **`questStage` is ids/enums only.** No objective text/title crosses into the dialogue
  context or any log — preserving the content-free boundary.
- **App `quest` is current at talk time.** Every state mutation routes through
  `refreshDerivedViews`; talking is non-mutating, so the threaded stage is never stale in a
  way that matters (worst case: a one-interaction lag, never wrong state).
- **No new lint block.** Every touched file already sits inside an existing
  `no-restricted-imports` block (domain, dialogue, renderer/ui, app/composition); the new
  directions (UI→Domain types, App→Domain evaluator, dialogue→domain context) are already
  allowed.

## 16. ADR timing (explicit)

Per maintainer instruction, **ADR-0045 is created now as `Proposed`** (alongside this
plan) to capture the approved design before code. It is flipped to *Accepted —
implemented* in the slice-5 docs closeout after the source is reviewed, so the final ADR
records what was actually built. (Note: the requested working number "ADR-0029" was
already taken by `consequence-journal-v0`; the next free decision number is **0045**.)
