# ADR-0045: Demo Quest Reactive Loop v1 — derived stage, quest-aware NPC, reactive HUD/exit feedback

- **Status:** Proposed — design approved 2026-06-28, **not yet implemented**
- **Date:** 2026-06-28
- **Deciders:** Project owner
- **Supersedes / extends:** [ADR-0028](./ADR-0028-demo-quest-loop-v0.md) (Demo Quest Loop v0)

> Working name "ADR-0029" from the design brief was already taken by
> [ADR-0029](./ADR-0029-consequence-journal-v0.md) (Consequence Journal v0); this decision
> takes the next free number, **0045**. Full pre-code design in the implementation plan
> [`demo-quest-reactive-loop-v1`](../implementation-plans/demo-quest-reactive-loop-v1.md).

## Context

`demo-quest-loop-v0` ([ADR-0028](./ADR-0028-demo-quest-loop-v0.md)) shipped "The Steward's
Toll" as a **read-only derived lens**: `evaluateQuest(spec, state) → QuestView` is a pure
projection of authoritative `WorldState` (`roomStates[*].{ visited, flags }`, `inventory`,
`player.status`), re-projected by `refreshDerivedViews(state)` at the four points the App
obtains a fresh state (bootstrap, interaction/encounter resolve via `onWorldStateChange`,
navigation `navigated` result, and load). The quest adds no event, command, reducer, flag,
or authored-room edit, and has no append path.

That loop is safe and clean but **passive**: it observes progress and renders a checkbox
HUD. It does not yet feel like a real game because (a) the demo NPC's dialogue is not
quest-aware — Asha cycles persona lines regardless of progress; (b) completion is a bare
"Complete" label with no acknowledgment; and (c) nothing in the world visibly responds when
an objective advances.

Every hook needed to make this reactive already exists and is read-only:

- The App already holds the current `QuestView` (`app/derivedViews.ts` →
  `computeDerivedViews`), refreshed at all four state points.
- The NPC dialogue path is already read-only and already threads an **optional context
  object** end-to-end: `npc-dialogue-room-context-v0`
  ([ADR-0039](./ADR-0039-npc-dialogue-room-context-v0.md)) added `roomContext` via
  `buildNPCDialogueReplyInput → NPCDialogueService.reply → buildDialogueContext →
  NPCDialogueContext → FakeNPCDialogueProvider`. `NPCDialogueService` holds only
  `Pick<WorldSession,'getWorldState'>` — it cannot append (ADR-0017).
- `consequence-journal-v0` ([ADR-0029](./ADR-0029-consequence-journal-v0.md)) is a second
  flag-driven read-only overlay reacting to the **same** authoritative signals
  (`interaction:offering-coffer`, `encounter:malik-encounter`, `ruined-safehouse.visited`).

The only gaps are (a) one new **derived** datum — the current objective — and (b) wiring it
into three existing read-only consumers. No new authority is required.

This slice deliberately adds **no quest engine, no new `WorldEvent`/`WorldCommand`/reducer,
no `RoomSpec` schema change, no navigation gate, no authored room/quest-data edit, no LLM
dialogue, no real-provider change, no inventory/loot reward, no combat/health change, no
backend/memory/persistence wiring, no new dependency, and no new lint block.**

## Decision

Ship **a thin reactive presentation + dialogue layer over the v0 derived quest.** Add one
pure derived field, `QuestView.activeObjectiveId`, and feed it to three read-only consumers.
The v0 defining property is preserved exactly: **the quest is a derived lens, not a
system.** `WorldSession` + the append-only `WorldEvent[]` + reducers remain the sole
authority; every reaction is a pure function of `WorldState` the App already refreshes.

```
WorldState (authoritative; unchanged)
  │  refreshDerivedViews(state)   ← bootstrap | interaction/encounter resolve | navigate | load
  ▼
evaluateQuest(spec, state) → QuestView { ..., activeObjectiveId }   ← +1 derived field (pure)
  │
  ├──► QuestTracker        : active emphasis + done-flash + completion acknowledgment   (UI, read-only)
  ├──► Reactive exit notice: throne-room arch "barred" vs "clear" by Malik flag         (UI, read-only)
  └──► RoomViewer (questStageRef)
         └─ on talk: buildNPCDialogueReplyInput({ ..., questStage })
              └─ NPCDialogueService.reply  (getWorldState only; appends nothing)
                   └─ buildDialogueContext(state, npc, history, room, questStage)        ← copies stage through
                        └─ FakeNPCDialogueProvider: QUEST_CLUE[persona][activeObjectiveId] (authored, deterministic)
```

### 1. Derived stage — `activeObjectiveId`

`QuestView` gains `activeObjectiveId: string | null`, computed inside `evaluateQuest` as the
first objective with `done === false` (`null` iff every objective is done, consistent with
`status === 'complete'`). Pure/total/deterministic; no I/O, no `Date.now`/`Math.random`, no
input mutation. It is render-time only — never a `WorldEvent`, `WorldState`, `CanonSeed`,
`SaveGame` field, persisted row, or log field. Objectives stay **display-ordered, never
gated**; an out-of-order completion simply advances the stage to the next incomplete
objective.

### 2. Quest-aware NPC dialogue (deterministic fake)

The NPC reads progress as **data**, never by mutation. An optional, ids/enums-only
`questStage?: { activeObjectiveId: string | null; status: 'active' | 'complete' }` is
threaded along the existing `roomContext` seam: `App` derives it from the current
`QuestView` and passes it to `RoomViewer`, which stores it in a `questStageRef` (always
current — every state change refreshes the view and talking mutates nothing) and includes
it in both reply-input call sites. `buildNPCDialogueReplyInput`, `NPCDialogueService`, and
`buildDialogueContext` forward it into `NPCDialogueContext.questStage`.

`FakeNPCDialogueProvider` gains an authored `QUEST_CLUE` table keyed by
`persona → activeObjectiveId` (plus a complete line). **Selection precedence extends, never
reorders, the existing chain:** explicit `playerLine` match → quest clue for the current
stage → persona cycle → room-grounded → fallback. When `questStage` is absent (every
prompt-generated session, every non-demo NPC) the provider takes the **exact** existing
branch order — byte-identical output, regression-protected by test. Because the clue is
keyed on the *current* stage, Asha's line **changes after each objective advances**
(coffer hint → Malik hint → north-arch hint → complete line). Malik stays encounter-first
and unchanged. **No objective text crosses the provider boundary** — only ids/enums — so no
content leaks into context or logs, and the response is deterministic (no LLM).

### 3. Reactive HUD acknowledgment

`QuestTracker` (still presentational, `pointer-events:none`, `role="status"`/`aria-live`)
emphasizes the objective matching `activeObjectiveId`, flashes a row that transitions
`false → true` (component-local presentational state via a previous-`view` ref and a short
timer — never persisted, never written back, resets on session/room change like
`RoomIntroPanelState`, ADR-0035), and renders an authored completion acknowledgment in
place of the bare "Complete" when `status === 'complete'`. The acknowledgment is **feedback
only** — no item, status, flag, or inventory change (no inventory system added).

### 4. Reactive exit notice (non-blocking)

A read-only App-level overlay shows a derived line for the throne-room north arch:
*"Steward Malik bars the north arch."* before the `encounter:malik-encounter` flag is set,
*"With Malik dealt with, the north arch stands open."* after. The line is derived from the
same `QuestView` (the same authoritative Malik flag the quest reads); it is **narrative
only** — the arch's navigation is unchanged and always usable, so there is **zero softlock
surface**. Outside the throne room or with no quest attached, the overlay is not rendered.

> **Superseded for the mechanical behavior by
> [ADR-0046](./ADR-0046-demo-quest-mechanical-reactivity-v0.md) (Demo Quest Mechanical
> Reactivity v0).** The "arch's navigation is unchanged and always usable" stance above —
> and the "optional non-blocking soft exit gate" / "mechanical object/exit unlock" entries
> in §5 and Deferred — are now handled by that follow-up ADR: the north arch is mechanically
> gated on `encounter:malik-encounter` at the composition root (`App.handleNavigate`, not
> `NavigationService`), still with **zero softlock surface** because Malik's `fight` choice
> has no requirement and is always resolvable. If this §4 narrative overlay is built, its
> "barred/open" copy must read the **same** Malik flag so notice and mechanics never
> disagree; if it is not built, the gate's `blocked` message is the visible feedback.

### 5. Explicitly excluded from v1

- **The optional soft exit gate** (a non-blocking `App.handleNavigate` check on the Malik
  flag) is **not** in v1. Navigation authority and behavior are unchanged.
- No `RoomSpec` schema change, no 3D-HUD interaction-prompt rewrite, no renderer change.
- No new `WorldEvent`/`WorldCommand`/reducer, no authored room/quest-data edit, no LLM/
  real-provider dialogue, no memory, no backend/persistence, no inventory/loot/combat
  change, no new dependency.

### Gating

Unchanged from v0: the demo `QuestSpec` is attached to `ActivePlay` only for the authored
example world (anchor `throne-room` present), so prompt-generated sessions have
`quest === null` → no tracker, no exit notice, and `questStage === undefined` → the NPC
provider is unaffected. Because all consumers are read-only and total, even a mis-gate could
only mis-display, never corrupt state.

### Save/load

Free, exactly as v0: `activeObjectiveId`, the NPC clue, the tracker emphasis, and the exit
notice are pure functions of the restored `WorldState`. **No `SaveGame` change.**

### Boundaries

Every touched file sits inside an existing lint block, and every new dependency direction is
already allowed: `domain/quests` and `domain/dialogue` stay under `domain/**` (import only
domain types/`zod`); `dialogue/**` keeps importing domain + the `world-session` read path
only; `renderer/ui/**` (`QuestTracker`, the exit-notice component) imports React + domain
types only; `App.tsx`/`RoomViewer.tsx`/`app/**` are the composition root. **No new lint
block, no `eslint.config.js` change, no new layer.** The renderer engine, world-session,
interactions, encounters, memory, persistence, and server are untouched.

### Tests

Pure Vitest, co-located, no new deps, no DOM framework:

- `evaluateQuest.test.ts` — `activeObjectiveId` at each progression step; `null` on
  complete; consistent with `status`; defensive/no-throw; purity preserved.
- `FakeNPCDialogueProvider.test.ts` — each stage's distinct clue; clue changes on advance;
  complete line; precedence (`playerLine` > quest clue > persona cycle); **regression** —
  absent `questStage` is byte-identical to today; determinism.
- `buildDialogueContext` test — copies `questStage` through; omits when absent; no mutation;
  no extra fields leak.
- `NPCDialogueService.test.ts` — still appends nothing; `questStage` reaches provider
  context; log payload remains counts/status/ids only.
- `RoomViewer.test.ts` — reply input includes the current `questStage` at both call sites;
  absent-stage path unchanged.
- No DOM/component tests for `QuestTracker`/exit notice (kept trivially presentational);
  no reducer/interaction/encounter/navigation tests (those sources unchanged).

### Log safety

No new log line. The evaluator and provider stay silent; the tracker and exit notice are
presentational; `NPCDialogueService` keeps its counts/status/ids-only payload. Quest/
objective text, NPC clue/dialogue text, flag keys, item names/ids, room display names, and
PII are never logged — mirrors the ADR-0013/0014/0015/0017/0028/0029 content-free
discipline.

### What is deliberately not changed

`domain/world/**` (no event/command/reducer/schema field) · `domain/roomSpec.ts` (no schema
change) · `domain/quests/questSpec.ts` (no condition-vocabulary change) ·
`domain/examples/throneRoom.ts` / `ruinedRoom.ts` / `demoQuest.ts` / `demoJournal.ts` (no
authored room/quest-data edit) · `domain/world/saveGame.ts` / `world-session/saveGame.ts`
(no `SaveGame` change) · `app/NavigationService.ts` and `App.handleNavigate` navigation
behavior (no gate) · `world-session/**` · `interactions/**` · `encounters/**` · `memory/**`
· `persistence/**` · `server/**` · `renderer/engine/**` · `generation/**` ·
`eslint.config.js` · `package.json`.

## Consequences

- **The demo quest now feels reactive.** The NPC gives a stage-appropriate clue that
  changes after each objective advances; the HUD emphasizes the active objective, flashes
  completions, and acknowledges the finished quest; the north arch is narrated as it
  changes state — a clear "world responded" beat at each step.
- **Authority unchanged.** `WorldSession` + event log + reducers remain the sole truth.
  The quest, NPC, tracker, and exit notice are all read-only with no append path; no
  reaction can flip an objective or write a flag.
- **No domain footprint.** Zero new events, commands, reducers, schema fields, or persisted
  state; one pure derived field on an existing view.
- **Save/load restores reactivity for free.** Re-projecting from restored `WorldState`
  reproduces the exact stage, clue, emphasis, and notice; no `SaveGame` change.
- **Hidden for prompt-generated sessions.** The v0 anchor-room gate is reused; those
  sessions see no tracker/exit notice, and the NPC provider behavior is byte-identical.
- **Log-safe.** No new log line; ids/enums-only context; no narrative content logged.
- **Known limitations:** single authored demo quest only; NPC awareness is an authored fake
  clue table for one persona, not generated dialogue; the exit "unlock" is narrative, not
  mechanical; no generic quest engine, no rewards, no multiple/chained quests, no DOM tests.
- **Deferred (future):** the optional non-blocking soft exit gate; a mechanical object/exit
  unlock (reactive 3D-HUD prompt or a new affordance); LLM/real-provider quest-aware
  dialogue; generated-quest support; quest rewards; multiple/chained quests; a quest log UI;
  fail states / time-limited objectives.
