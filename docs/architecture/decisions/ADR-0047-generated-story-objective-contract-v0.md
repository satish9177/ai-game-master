# ADR-0047: Generated Story Objective Contract v0 — validated generated objective + NPC hint

- **Status:** Proposed — design approved 2026-06-28, not yet implemented
- **Date:** 2026-06-28
- **Deciders:** Project owner
- **Extends:** [ADR-0028](./ADR-0028-demo-quest-loop-v0.md) (quest as derived lens),
  [ADR-0022](./ADR-0022-world-bible-seed-v0.md) (transient generated metadata containment)
- **Related:** [ADR-0045](./ADR-0045-demo-quest-reactive-loop-v1.md) (reactive quest loop),
  [ADR-0046](./ADR-0046-demo-quest-mechanical-reactivity-v0.md) (mechanical reactivity),
  [ADR-0020](./ADR-0020-room-generation-repair-fallback-v0.md) (assemble→repair→drop discipline),
  [ADR-0017](./ADR-0017-npc-dialogue-foundation-v0.md) (inert NPC dialogue),
  [ADR-0040](./ADR-0040-generated-room-npc-presence-v0.md) (generated NPC presence)

> Full pre-code design in the implementation plan
> [`generated-story-objective-contract-v0`](../implementation-plans/generated-story-objective-contract-v0.md).

## Context

`demo-quest-mechanical-reactivity-v0` ([ADR-0046](./ADR-0046-demo-quest-mechanical-reactivity-v0.md))
completed the authored demo reactive loop: a hardcoded `QuestSpec`, an authored NPC with
hardcoded quest-stage clues, and a composition-root exit gate keyed on a hardcoded room pair
and flag. The quest is a **read-only derived lens** (`evaluateQuest(spec, state) → QuestView`)
over authoritative `WorldState`; it never writes, and the gate reads the authoritative flag
directly.

Everything in that loop is authored-demo-specific:

- `demoQuestSpec` names specific room ids and flags.
- `FakeNPCDialogueProvider` looks up clues from a hardcoded `QUEST_CLUE` table keyed on
  authored objective ids.
- `evaluateExitGate` is hardcoded to the `throne-room → ruined-safehouse` pair.
- `QuestTracker` renders the literal "The Steward's Toll is complete." completion message.

Prompt-generated rooms run the full `assembleRoom` pipeline and render successfully with all
the existing visual/interaction affordances — but they receive no objective, no quest tracker,
and no NPC hint, because there is no authored spec to attach.

The bridge toward a generated story beat is closer than it appears. Every piece of machinery
that would serve a generated objective already exists and is data-driven:

- `evaluateQuest(spec, state) → QuestView` is a pure projection over any `QuestSpec`.
- `QuestTracker` consumes any `QuestView`.
- `computeDerivedViews` holds an optional `quest: QuestView | null`.
- The condition vocabulary (`room-flag`, `room-visited`) maps directly onto flags that
  existing interactions and encounters already set.
- The NPC dialogue path already threads an optional `questStage` object end-to-end
  ([ADR-0039](./ADR-0039-npc-dialogue-room-context-v0.md),
  [ADR-0045](./ADR-0045-demo-quest-reactive-loop-v1.md)).
- `ActivePlay` already carries `questSpec?: QuestSpec`.

The missing piece is a **safe, validated data contract** for a generated proposal that
converts into a trusted `QuestSpec` — and a deterministic fake source to exercise the
pipeline before any real LLM is wired.

This ADR designs that contract and its validation pipeline. It deliberately **does not**
wire a real LLM, build a quest engine, introduce generated mechanical gates, or change the
authored demo in any way.

## Decision

Ship a **narrow untrusted generated proposal schema** (`GeneratedObjectiveSpec`) and a
**pure validate-or-drop assembler** (`assembleObjective`) that converts a valid proposal
into the existing trusted `QuestSpec`. The two pipelines — room assembly and objective
assembly — are **fully independent**: room success never depends on objective success, and
a dropped objective leaves the room playing normally.

The defining property from ADR-0028 is preserved: **the quest is a derived lens, not a
system.** `WorldSession` + the append-only `WorldEvent[]` + reducers remain the sole
authority. Generated objectives observe flags that interactions and encounters already set;
they append nothing.

```
prompt
  │
  ├─► RoomGenerator → raw room text → assembleRoom(rawText, fallback)
  │                                         → LoadedRoom   (UNCHANGED)
  │
  └─► ObjectiveGenerator → raw objective text → assembleObjective(rawText, loadedRoom)
                                                       ├─ QuestSpec → ActivePlay.questSpec
                                                       │              (hint → questHintRef)
                                                       └─ null  → no questSpec attached
                                                                    room plays normally

          ↓ existing path (unchanged)

  computeDerivedViews(state, questSpec, journalSpec)
    → evaluateQuest(spec, state) → QuestView
      → QuestTracker (read-only)
      → NPC questStage context (read-only, inert)
```

### 1. The untrusted generated proposal (`GeneratedObjectiveSpec`)

A new narrow schema `GeneratedObjectiveSpec` defines what the generator may emit.
It lives in `domain/quests/generatedObjectiveSpec.ts` and is the **only place** a
generator may name condition kinds. All fields are strictly bounded and closed.

```
GeneratedObjectiveCondition  (discriminated union, strict):
  | { kind: 'interact-object';   objectId: string }
  | { kind: 'resolve-encounter'; objectId: string }
  | { kind: 'visit-room';        roomId: string  }

GeneratedObjectiveSpec  (strict):
  title:          string (1..80 chars)
  description:    string (1..160 chars)
  hint:           string (1..160 chars)   ← NPC clue; inert display only
  completionHint: string (1..160 chars)   ← NPC completion line; inert display only
  condition:      GeneratedObjectiveCondition
```

Forbidden from the generated proposal:

- Raw `room-flag` / `has-item` / `has-status` strings — the LLM may never emit a flag key.
- Raw flag key strings of any kind (`interaction:*`, `encounter:*`).
- `objectId` or `roomId` that the assembler cannot verify against the actual room.
- Free-text expressions, JS, code, or any executable form.
- More than one condition per proposal (single-objective only in v0).

The generator names an `objectId` or `roomId`; the trusted assembler derives the internal
condition type and flag key. The LLM never constructs the flag string itself.

### 2. The trusted assembler (`assembleObjective`)

A pure, total, throw-free function:

```
assembleObjective(
  rawText: string,
  room: LoadedRoom,
): {
  spec: QuestSpec | null
  hint: string | null
  completionHint: string | null
  diagnostics: ObjectiveAssemblyDiagnostics
}
```

The pipeline mirrors `assembleRoom`'s discipline — synchronous, no I/O, no logger, problems
returned as data, never thrown:

**Stage 1 — Parse.** `JSON.parse`. Failure → `{ spec: null, ... }`.

**Stage 2 — Schema.** Strict zod against `GeneratedObjectiveSpec`. Unknown keys, wrong
enums, over-length text → `null`.

**Stage 3 — Semantic satisfiability (the safety gate).** Every condition kind must be
provably completable by a real in-room action:

- `interact-object`: `room.objects` must contain an object with `id === objectId` **and**
  its interaction must be of a kind that sets a flag (`effect` present, or the object will
  set `interaction:<objectId>` via the one-shot mechanic). An object that exists but cannot
  set a flag is **unsatisfiable → drop**.
- `resolve-encounter`: `room.objects` must contain an object with `id === objectId` **and**
  `interaction.encounter` present. That encounter, when resolved, sets `encounter:<objectId>`.
  Missing encounter → **unsatisfiable → drop**.
- `visit-room`: the `roomId` must match `interaction.exit.toRoomId` on at least one object in
  the room — meaning there is an actual usable exit to that room. A `roomId` with no
  corresponding exit in this room is **unsatisfiable → drop** (the player can never reach it
  from here).

If the condition is unsatisfiable the function returns `null` — never invents an alternative.

**Stage 4 — Text sanitization.** `hint` and `completionHint` pass through the existing
`sanitizeGeneratedDisplayText` to strip/truncate. These are the only generated text fields
that reach the UI (inert, display-only). The `title` and `description` fields are used only
when constructing the `QuestSpec.objectives[0].text`; they are sanitized to the same bounds.

**Stage 5 — Build `QuestSpec`.** Produce a valid single-objective `QuestSpec` using the
room's own `id` as `anchorRoomId`:

```
questId:       '<roomId>-objective'
title:         <sanitized title>
anchorRoomId:  room.id
objectives: [{
  id:        'generated-0'
  text:      <sanitized description>
  condition:
    interact-object   → { kind: 'room-flag', roomId: room.id, flag: 'interaction:<objectId>' }
    resolve-encounter → { kind: 'room-flag', roomId: room.id, flag: 'encounter:<objectId>' }
    visit-room        → { kind: 'room-visited', roomId: <roomId> }
}]
```

No new condition vocabulary. The output is a standard `QuestSpec` with one `QuestObjective`
using existing condition kinds. `evaluateQuest` consumes it without change.

**Diagnostics.** Fixed boolean/count-only surface — never text, names, or JSON:
`objectiveValid`, `objectiveDropped`, `conditionKind` (enum), `conditionUnsatisfiable`,
`textSanitized`.

### 3. `FakeObjectiveGenerator` — the v0 deterministic source

A deterministic fake `ObjectiveGenerator` (behind a new port — same pattern as
`RoomGenerator`) takes the assembled `LoadedRoom` and a seeded PRNG and emits a raw
`Promise<string | null>`. It returns `null` (no objective) when the room has no suitable
interactive object with a stable id; otherwise it picks the first eligible object and
constructs a valid JSON `GeneratedObjectiveSpec` string referencing it.

Rules for the fake:
- Uses only the seeded PRNG — no `Math.random`, no clock, no network.
- References only objects that exist in the assembled room **and** carry the required
  interaction.
- Emits raw text only — no schema parsing or validation (those belong to the assembler).
- Emits no logger call (same as `FakeRoomGenerator`).

The real LLM will later replace this fake behind the same port. No assembly or validation
change will be needed.

### 4. Composition wiring — two independent pipelines

`App` (the composition root) runs both generators on the prompt-generated path:

```
handlePrompt
  └─ FakeRoomGenerator.generate(seed)  → roomRawText
  └─ assembleRoom(roomRawText, fallback) → LoadedRoom
  └─ FakeObjectiveGenerator.generate(room) → objectiveRawText | null
  └─ assembleObjective(objectiveRawText, room) → { spec, hint, completionHint, diagnostics }
  └─ attach spec to activePlay.questSpec  (or leave null)
  └─ store hint in questHintRef / questCompletionHintRef  (composition-root state, not persisted)
```

**Independence is mandatory:** the objective pipeline runs only after a valid `LoadedRoom`
exists. It never runs for `repaired`, `fallback`, or `unavailable` results. On any failure
the room renders normally with no quest tracker and no NPC hint.

Authored bootstrap and `AdjacentRoomPregenerator` **never run the objective pipeline**.
Adjacents have structural room ids and no deliberate prompt intent; attaching a generated
objective to a pregenerated adjacent would be inappropriate (same reasoning as `requestsNpc`,
ADR-0040).

The generated `QuestSpec` flows through `computeDerivedViews → evaluateQuest → QuestView`
identically to the authored demo. `QuestTracker` receives a `QuestView` and renders it; it
does not know whether the spec was authored or generated.

### 5. NPC hint wiring — inert display only

Generated objectives carry a `hint` string and a `completionHint` string. These are
sanitized generated text — they must never gate navigation, control logic, or reach logs.

`QuestDialogueContext` (`domain/dialogue/contracts.ts`) gains two optional fields:

```ts
hint?: string           // current-objective NPC clue
completionHint?: string // completion NPC line
```

These are **transient context only** — never a `WorldEvent`, `WorldState`, `SaveGame` field,
persisted row, or log field. The App builds `QuestDialogueContext` from the current
`QuestView` plus `questHintRef.current` and `questCompletionHintRef.current`.

`FakeNPCDialogueProvider` selection precedence gains one step, inserted between the existing
`playerLine` match and the authored `QUEST_CLUE` table:

```
explicit playerLine match
  → context.quest.hint   (generated; when present and objective active)
  → QUEST_CLUE[persona][activeObjectiveId]  (authored demo; unchanged fallback)
  → persona cycle
  → room-grounded fallback
  → FALLBACK_LINES
```

When `hint` is absent (`QuestDialogueContext.hint === undefined`) the provider's behavior is
**byte-identical to today** — the authored `QUEST_CLUE` table and the rest of the chain are
unaffected. Prompt-generated NPCs without a valid objective also have no `quest` context, so
the authored QUEST_CLUE table is simply unreachable; no authored NPC text can appear for a
generated room.

`completionHint` follows the same precedence over `QUEST_COMPLETION_LINES[key]`. When absent
the authored completion line is used.

### 6. `QuestTracker` completion message — generic

The current hardcoded `"The Steward's Toll is complete. The road north is yours."` is a
presentational copy leak: it would render under any generated quest. Change it to a generic
line derived from `view.title`:

```
{view.title} is complete.
```

No `QuestSpec` or `QuestView` schema change. Pure presentational fix in `QuestTracker.tsx`.
Authored demo: `view.title === "The Steward's Toll"` → "The Steward's Toll is complete." —
effectively the same opening. The "The road north is yours." authored second sentence is
dropped. If that authored sentence must be preserved, an optional `completionText` field can
be added to `QuestSpec` in a future slice.

### 7. Scoping — authored demo is fully preserved

The objective pipeline is gated the same way as the existing demo quest:

- Authored bootstrap: `demoQuestSpec` is attached as before; the objective pipeline never
  runs for the authored world. Every authored-demo behavior is unchanged.
- Prompt-generated: `assembleObjective` runs after a successful `assembleRoom`. On success,
  the generated `QuestSpec` is attached to `activePlay.questSpec`, triggering the tracker and
  NPC hint. On failure or null, `questSpec` stays null — exactly as if the room had no quest.
- No generated mechanical gate: `evaluateExitGate` is hardcoded to the authored pair and
  is consulted only when the authored `questSpec` is attached. Generated sessions have no
  gate; navigation is always free.
- Save/load: the generated `QuestSpec` and hints are **not persisted** (no `SaveGame` change).
  On reload of a generated session the tracker/hint vanish; progress flags (`room-flag`,
  `room-visited`) are in the authoritative `WorldState` event log and survive, but the spec
  that would display them is gone. This is acceptable for v0 (same category as
  `RoomIntroPanelState` ephemerality, ADR-0035). Must be documented, not silent.

### 8. Explicitly excluded from v0

- No generated mechanical gates, no generated `evaluateExitGate`, no generated navigation
  blocking. Deferred to a future ADR (requires a generated softlock-proof vocabulary).
- No real-LLM / real-provider objective generation. Fake/deterministic source only.
- No multi-objective arrays, chained objectives, or global quest state.
- No generated `has-item` or `has-status` conditions (no validated generated item/status
  vocabulary exists yet).
- No inventory rewards, loot, combat, health, or death.
- No `RoomSpec`, `WorldEvent`, `WorldCommand`, reducer, or `SaveGame` schema change.
- No `questSpec.ts` or `evaluateQuest.ts` change.
- No persistence of the generated objective spec.
- No backend, memory, or new dependency.
- No raw prompt, provider body, generated JSON, object/NPC names, hint text, or room names
  in logs.

### Boundaries

All new code lives inside existing lint blocks:

- `domain/quests/generatedObjectiveSpec.ts` — under `domain/**`; imports only zod. Pure.
- `domain/quests/assembleObjective.ts` — under `domain/**`; imports only domain types,
  zod, and `sanitizeGeneratedDisplayText`. Pure.
- `generation/FakeObjectiveGenerator.ts` — under `generation/**`; imports only domain
  types and the seeded PRNG. No logger, no network, no env.
- `domain/dialogue/contracts.ts` — minor type addition; stays under `domain/**`.
- `dialogue/FakeNPCDialogueProvider.ts` — under `dialogue/**`; no new imports.
- `renderer/ui/QuestTracker.tsx` — presentational copy fix only.
- `app/npcDialogueReplyInput.ts`, `App.tsx` — composition root; all existing imports allowed.

No new lint block. No `eslint.config.js` change. No new layer. The renderer engine,
world-session, interactions, encounters, memory, persistence, and server are untouched.

### Tests

Pure Vitest, co-located, no new deps, no DOM framework:

- `generatedObjectiveSpec.test.ts` — rejects unknown `kind`, extra keys (strict), over-length
  text, missing fields; accepts each valid condition kind.
- `assembleObjective.test.ts`:
  - Returns `null` (never throws) on bad JSON, schema failure, and every unsatisfiable case:
    object id not found, object found but no interaction, `interact-object` on an object with
    no `effect`, `resolve-encounter` on an object with no `encounter`, `visit-room` with a
    roomId not matching any exit.
  - Returns a valid single-objective `QuestSpec` for each satisfied condition kind.
  - Condition → flag key derivation: `interact-object` maps to `interaction:<objectId>`;
    `resolve-encounter` maps to `encounter:<objectId>`.
  - End-to-end: valid `QuestSpec` → `evaluateQuest` reports `done` once the flag is set in
    `WorldState`. (`room-visited` variant: done once `roomStates[roomId].visited === true`.)
  - Text sanitization: over-length/unsafe hint is truncated; diagnostic `textSanitized` true.
  - Diagnostics: `conditionUnsatisfiable` true on drop; `objectiveDropped` true on null.
- `FakeObjectiveGenerator.test.ts` — returns raw JSON string (valid proposal) when eligible
  object present; returns `null` when no eligible object; deterministic (same seed = same
  output); emits no logger call.
- `FakeNPCDialogueProvider.test.ts`:
  - `context.quest.hint` is used when present and objective active; authored `QUEST_CLUE` is
    not consulted.
  - `context.quest.completionHint` is used when present and status complete; authored
    `QUEST_COMPLETION_LINES` is not consulted.
  - Absent `hint` / `completionHint`: provider output is **byte-identical to today** for all
    existing authored paths (regression test).
- Scoping: authored bootstrap does not run `assembleObjective`; adjacent pregeneration does
  not run `assembleObjective`. When `assembleObjective` returns `null`, `questSpec` stays
  null, tracker is absent, room plays normally.
- Log safety: no assertion may check for text, names, generated JSON, or hint content in log
  output.

### Log safety

No new log line for objective assembly. Diagnostics are count/boolean/enum-only. Hint text,
completion text, objective title/description, object names, room names, raw generated JSON,
and prompt text are never logged — mirrors the ADR-0013/0017/0020/0028/0029/0045/0046
content-free discipline.

`assembleObjective` is silent (returns diagnostics as data, like `assembleRoom`). The
composition root may log a safe count/boolean summary; the actual content never crosses the
log boundary.

### What is deliberately not changed

`domain/world/**` · `domain/roomSpec.ts` · `domain/quests/questSpec.ts` ·
`domain/quests/evaluateQuest.ts` · `domain/examples/demoQuest.ts` /
`throneRoom.ts` / `ruinedRoom.ts` · `domain/world/saveGame.ts` ·
`world-session/saveGame.ts` · `app/exitGate.ts` · `app/gatedNavigation.ts` ·
`app/NavigationService.ts` · `world-session/**` · `interactions/**` · `encounters/**` ·
`memory/**` · `persistence/**` · `server/**` · `renderer/engine/**` · `generation/**`
(existing files unchanged; `FakeObjectiveGenerator` is a new addition) ·
`eslint.config.js` · `package.json`.

## Consequences

- **Generated rooms can have one small story beat.** A prompt-generated room can include a
  single validated objective — the player sees a quest tracker, the NPC gives a contextual
  hint, and completing the in-room action completes the quest. A clear "the world responds to
  what you did" beat, for the first time on the generated-room path.
- **Two independent pipelines.** Room assembly and objective assembly are fully decoupled. A
  dropped, invalid, or missing objective never affects the room; the room always plays.
- **Authority unchanged.** `WorldSession` + event log + reducers remain the sole truth.
  Generated objectives observe flags that existing interactions/encounters already set;
  they append nothing and read nothing not already authoritative.
- **No generated executable code, no generated flag strings.** The LLM names an `objectId`;
  the trusted assembler derives the flag key. The LLM cannot emit `interaction:*` or
  `encounter:*` flag strings directly.
- **Satisfiability is mandatory.** An objective whose condition no in-room action can satisfy
  is dropped, not rendered. No generated softlock is possible.
- **No generated gate.** Navigation remains free on all generated-room paths. `evaluateExitGate`
  is authored-only and unchanged.
- **Authored demo unchanged.** `demoQuestSpec`, `evaluateExitGate`, authored NPC dialogue, and
  mechanical reactivity are all unaffected. The authored demo `QUEST_CLUE` table is the
  fallback when no generated hint is present.
- **NPC hint is inert display only.** Sanitized generated text reaches the dialogue panel
  as a hint string; it never keys logic, gates navigation, or reaches logs.
- **Known limitations:** the generated `QuestSpec` and hints are transient — they are lost on
  save/load (progress flags persist; the tracker/hint do not). Single objective only. Fake
  source only (no real LLM objective generation). No generated mechanical gate.
- **Deferred (future):** real-LLM objective generation; multiple/chained objectives; generated
  mechanical gate vocabulary with a softlock-proof predicate; persistence of the generated
  spec across save/load; `QuestSpec.completionText` authored field; quest rewards/loot;
  multi-room objective chains; generated encounter objectives for adjacent rooms.
