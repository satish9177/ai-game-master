# Implementation Plan — `feature/generated-story-objective-contract-v0`

> Status: **design approved — not yet implemented.**
> Maintainer approved the objective + NPC hint scope on 2026-06-28.
> The ADR for this slice is
> [ADR-0047](../decisions/ADR-0047-generated-story-objective-contract-v0.md)
> (Proposed — design approved, not yet implemented).
>
> Companion docs: [ARCHITECTURE](../ARCHITECTURE.md) · [BOUNDARIES](../BOUNDARIES.md) ·
> [FAILURE-MODES](../FAILURE-MODES.md) · [CONVENTIONS](../CONVENTIONS.md).
> Direct precedents and dependencies:
> `demo-quest-mechanical-reactivity-v0`
> ([ADR-0046](../decisions/ADR-0046-demo-quest-mechanical-reactivity-v0.md))
> completed the authored demo reactive loop and established all the machinery this feature
> reuses (`evaluateQuest`, `QuestSpec`, `QuestView`, `QuestTracker`, `QuestDialogueContext`,
> `computeDerivedViews`, `questSpecRef` in App);
> `demo-quest-reactive-loop-v1`
> ([ADR-0045](../decisions/ADR-0045-demo-quest-reactive-loop-v1.md))
> wired `questStage` into `buildNPCDialogueReplyInput` → `FakeNPCDialogueProvider`;
> `room-generation-repair-fallback-v0`
> ([ADR-0020](../decisions/ADR-0020-room-generation-repair-fallback-v0.md))
> established the assemble→repair→drop discipline this plan mirrors;
> `demo-quest-loop-v0`
> ([ADR-0028](../decisions/ADR-0028-demo-quest-loop-v0.md))
> defines "quest is a derived lens, not a system" and the `ActivePlay.questSpec` attachment
> point;
> `world-bible-seed-v0`
> ([ADR-0022](../decisions/ADR-0022-world-bible-seed-v0.md))
> establishes how transient generated metadata is held in composition-root state without
> becoming a `WorldEvent`/`SaveGame`/SQLite row.

---

## Goal

Let a **prompt-generated room** carry one small, safe story beat: a validated generated
objective that attaches to the existing `QuestSpec → QuestView → QuestTracker` path, plus a
sanitized NPC hint that rides the existing `QuestDialogueContext` path.

The feature is two fully independent pipelines — **room assembly** (unchanged) and **objective
assembly** (new, runs after a valid room exists). A dropped or missing objective leaves the
room playing normally. No mechanical gate, no generated navigation blocking, no quest engine,
no real LLM, no schema changes.

The defining property from ADR-0028 is preserved exactly: **the quest is a derived lens, not
a system.** Generated objectives observe flags that existing interactions and encounters
already set; they append nothing.

---

## 1. Status

**Design approved — not yet implemented.**

---

## 2. Current repo facts (verified against source)

- **`QuestSpec` / `evaluateQuest` / `QuestTracker` are fully data-driven today.** Any valid
  `QuestSpec` passed to `evaluateQuest(spec, state)` produces a `QuestView` that `QuestTracker`
  renders — there is no authored-demo check inside these. The spec is attached at the
  composition root (`App.tsx:220`, `App.tsx:483`).
- **`ActivePlay.questSpec?: QuestSpec`** is the attachment point. `questSpecRef.current` is set
  in `App.tsx`; `computeDerivedViews(state, questSpecRef.current, ...)` projects it.
- **`QuestDialogueContext`** (`domain/dialogue/contracts.ts:28–31`) is `{ activeObjectiveId:
  string | null; status: 'active' | 'complete' }`. It threads from `App` →
  `buildNPCDialogueReplyInput` → `NPCDialogueService` → `buildDialogueContext` →
  `FakeNPCDialogueProvider`. No change was made to this type in v0/v1.
- **`FakeNPCDialogueProvider`** looks up quest clues from a hardcoded `QUEST_CLUE` table keyed
  on `persona → activeObjectiveId`. For generated sessions, `quest` is `undefined` in the
  context, so the QUEST_CLUE branch is unreachable already.
- **`QuestTracker.tsx:71–73`** hardcodes `"The Steward's Toll is complete. The road north is
  yours."` — this string would render under any generated quest with no authored-demo guard.
  This is a copy leak that must be fixed in this slice.
- **`evaluateExitGate`** (`app/exitGate.ts`) is hardcoded to `throne-room → ruined-safehouse`
  and is consulted only when `demoQuestEnabled` is true (`activePlay.questSpec != null`).
  Attaching a generated `questSpec` would make `demoQuestEnabled` true, but the pair check
  ensures no generated room id ever triggers the gate. **Confirmed safe — no generated gate.**
- **`assembleRoom`** (`domain/assembleRoom.ts`) is the model for the objective assembler.
  It is pure, total, silent, returns problems as data. The objective assembler must follow
  the same discipline.
- **`sanitizeGeneratedDisplayText`** (`domain/sanitizeGeneratedDisplayText.ts`) already
  handles safe-length truncation and display sanitization of generated text. The assembler
  reuses it for all free-text fields.
- **`FakeRoomGenerator`** (`generation/FakeRoomGenerator.ts`) returns `Promise<string>` (raw
  room JSON). It is the model for `FakeObjectiveGenerator`. The objective generator is a
  **separate** source — it does not modify the room JSON format, and `assembleRoom` is unchanged.
- **Flag derivation convention** (`domain/interactions/planInteraction.ts:121`):
  `interaction:<objectId>` for one-shot interactions; `encounter:<objectId>` for encounter
  resolution (`app/exitGate.ts:5` confirms the `encounter:<ref>` convention where ref = the
  encounter's object id).
- **`room.objects[n].id`** is optional in `RoomSpec` (`domain/roomSpec.ts:23`).
  `FakeObjectiveGenerator` must only reference objects that carry a stable `id` after
  assembly. The satisfiability check in `assembleObjective` must verify the id exists on the
  actual object in `LoadedRoom`, not just in the raw JSON.

---

## 3. Scope

### In

1. **`GeneratedObjectiveSpec` schema** — narrow untrusted proposal schema in
   `domain/quests/generatedObjectiveSpec.ts`. Three closed condition kinds only:
   `interact-object`, `resolve-encounter`, `visit-room`. All text fields bounded and strict.
   No raw flag strings, no code, no open enums.

2. **`assembleObjective`** — pure, total, throw-free pipeline in
   `domain/quests/assembleObjective.ts`. Parse → schema → satisfiability check → text
   sanitization → build `QuestSpec`. Returns `{ spec: QuestSpec | null; hint: string | null;
   completionHint: string | null; diagnostics }`. Silent (no logger). Unsatisfiable or invalid
   → `null`; never invents content.

3. **`FakeObjectiveGenerator`** — deterministic fake source in
   `generation/FakeObjectiveGenerator.ts`, behind a new `ObjectiveGenerator` port in
   `domain/ports/`. Takes an assembled `LoadedRoom` and a seeded PRNG; references only objects
   with stable ids and the right interaction kind. Returns `Promise<string | null>`.

4. **`QuestDialogueContext` extension** — add `hint?: string` and `completionHint?: string`
   to the existing type in `domain/dialogue/contracts.ts`. Transient context only — no
   schema/SaveGame/backend impact.

5. **`FakeNPCDialogueProvider` hint support** — prefer `context.quest.hint` over the authored
   `QUEST_CLUE` table when present; `context.quest.completionHint` over `QUEST_COMPLETION_LINES`.
   Absence → byte-identical to today.

6. **Composition-root wiring** — `App.tsx`: add `questHintRef` and `questCompletionHintRef`;
   run `FakeObjectiveGenerator.generate(room)` then `assembleObjective(rawText, room)` after
   a successful `assembleRoom` on the prompt-generated path; attach `spec` to
   `activePlay.questSpec`; pass hints through `buildNPCDialogueReplyInput`. No change for
   authored bootstrap, adjacent, restore, or load paths.

7. **`QuestTracker` generic completion** — replace hardcoded `"The Steward's Toll is complete.
   The road north is yours."` with `{view.title} is complete.` Purely presentational;
   no schema change.

8. **`buildNPCDialogueReplyInput` hint forwarding** — pass `hint` and `completionHint` from
   `QuestDialogueContext` into the request when present.

### Out

Generic/data-driven gate or quest engine · generated mechanical gate / generated
`evaluateExitGate` / generated navigation blocking · real-LLM objective generation · multiple
or chained objectives · generated `has-item` / `has-status` conditions · inventory rewards /
loot / combat / health · `RoomSpec` schema change · `questSpec.ts` schema change ·
`evaluateQuest.ts` change · `WorldEvent` / `WorldCommand` / reducer change · `SaveGame`
change · persistence of generated objective spec · backend / server / memory / persistence
change · new dependency · new lint block.

---

## 4. Minimum Safe Change Check

- **Reused:** `QuestSpec` / `evaluateQuest` / `QuestView` / `QuestTracker` / `computeDerivedViews`
  (all unchanged); `ActivePlay.questSpec` attachment point; `QuestDialogueContext` seam
  (extended with two optional fields only); `buildNPCDialogueReplyInput` forwarding pattern;
  `FakeNPCDialogueProvider` precedence chain (one step inserted); `sanitizeGeneratedDisplayText`;
  `assembleRoom` discipline as the model for `assembleObjective`; `questSpecRef` pattern in App.
- **New code (minimum):** one schema file; one pure assembler; one fake generator + port; two
  optional fields on an existing context type; one precedence step in the provider; two
  composition-root refs + one pipeline call; one presentational copy fix.
- **Safety boundaries unchanged:** authority stays `WorldSession` + event log + reducers;
  objective assembler is pure, silent, and appends nothing; `assembleRoom` and `evaluateExitGate`
  are untouched; no generated flag string reaches the assembler; satisfiability is mandatory;
  text sanitization is mandatory; no hint/name/JSON in logs.
- **Targeted tests:** schema validation; satisfiability for each condition kind; end-to-end
  `assembleObjective → evaluateQuest` with state; hint precedence in provider; regression for
  absent-hint provider path; scoping (authored path unaffected; adjacent unaffected).

---

## 5. Files to touch (source — pending separate go-ahead)

**New files:**
- `apps/web/src/domain/ports/ObjectiveGenerator.ts` — port interface: `generate(room:
  LoadedRoom, prng: SeededPrng): Promise<string | null>`.
- `apps/web/src/domain/quests/generatedObjectiveSpec.ts` — `GeneratedObjectiveConditionSchema`
  (3 kinds), `GeneratedObjectiveSpecSchema`, `ObjectiveAssemblyDiagnostics` type.
- `apps/web/src/domain/quests/assembleObjective.ts` — the pure assembler. Imports only domain
  types, zod, and `sanitizeGeneratedDisplayText`. No logger, no I/O.
- `apps/web/src/generation/FakeObjectiveGenerator.ts` — deterministic fake; same import
  discipline as `FakeRoomGenerator`.

**Modified files:**
- `apps/web/src/domain/dialogue/contracts.ts` — add `hint?: string; completionHint?: string`
  to `QuestDialogueContext`.
- `apps/web/src/dialogue/FakeNPCDialogueProvider.ts` — insert hint step in precedence chain.
- `apps/web/src/renderer/ui/QuestTracker.tsx` — generic completion copy.
- `apps/web/src/app/npcDialogueReplyInput.ts` — forward `hint` / `completionHint` when
  present in `questStage`.
- `apps/web/src/App.tsx` — add `questHintRef` / `questCompletionHintRef`; run objective
  pipeline on the prompt-generated path; pass hints to `buildNPCDialogueReplyInput`.

---

## 6. Files NOT to touch

`domain/world/**` · `domain/roomSpec.ts` · `domain/quests/questSpec.ts` ·
`domain/quests/evaluateQuest.ts` · `domain/examples/demoQuest.ts` / `throneRoom.ts` /
`ruinedRoom.ts` · `domain/world/saveGame.ts` · `world-session/saveGame.ts` ·
`app/exitGate.ts` · `app/gatedNavigation.ts` · `app/NavigationService.ts` ·
`app/exits.ts` · `app/derivedViews.ts` · `domain/assembleRoom.ts` · `domain/repairRoom.ts` ·
`domain/validateRoom.ts` · `generation/FakeRoomGenerator.ts` (existing files unchanged) ·
`world-session/**` · `interactions/**` · `encounters/**` · `memory/**` · `persistence/**` ·
`server/**` · `renderer/engine/**` · `renderer/RoomViewer.tsx` (unless QuestTracker import
only) · `eslint.config.js` · `package.json`.

---

## 7. Implementation slices

Each slice is independently shippable and independently testable. Do not merge slices.

**Slice 1 — Schema + assembler (pure, headless)**
`feat(domain): generated objective spec schema and assembler`

New files: `generatedObjectiveSpec.ts`, `assembleObjective.ts`. No wiring, no UI, no
generator. Tests: all schema and satisfiability cases; `assembleObjective → evaluateQuest`
end-to-end; diagnostics.

Verification: `npm run test -- assembleObjective`, `npm run test -- generatedObjectiveSpec`,
`npm run lint`, `npm run build`.

---

**Slice 2 — Fake generator + port**
`feat(generation): fake objective generator`

New files: `domain/ports/ObjectiveGenerator.ts`, `generation/FakeObjectiveGenerator.ts`.
No App wiring. Tests: determinism; returns null when no eligible object; no logger call.

Verification: `npm run test -- FakeObjectiveGenerator`, `npm run lint`, `npm run build`.

---

**Slice 3 — Composition wiring**
`feat(app): wire objective pipeline on prompt-generated path`

Modify `App.tsx`: add `questHintRef` / `questCompletionHintRef`; call
`FakeObjectiveGenerator.generate(room)` then `assembleObjective(rawText, room)` after
successful `assembleRoom`; attach `spec` to `activePlay.questSpec`. Pass hints through
`buildNPCDialogueReplyInput` (minor change to `npcDialogueReplyInput.ts`).

Tests: when assembler returns valid spec, `questSpec` is attached and tracker renders;
when assembler returns null, `questSpec` stays null, room renders normally; authored
bootstrap path does not run `FakeObjectiveGenerator`; adjacent path unaffected.

Verification: `npm run test -- App`, `npm run test -- derivedViews`, `npm run lint`,
`npm run build`.

---

**Slice 4 — NPC hint + QuestTracker completion copy**
`feat(ui): generated objective NPC hint and generic quest completion`

Modify `domain/dialogue/contracts.ts` (`QuestDialogueContext` + `hint`/`completionHint`),
`FakeNPCDialogueProvider.ts` (hint step in precedence), `QuestTracker.tsx` (generic
completion), `npcDialogueReplyInput.ts` (forward hints).

Tests: provider uses `context.quest.hint` when present; absent hint is byte-identical to
today (regression); `completionHint` preferred over authored line when present; `QuestTracker`
completion renders `{view.title} is complete.` for any title.

Verification: `npm run test -- FakeNPCDialogueProvider`, `npm run test -- QuestTracker`,
`npm run test -- npcDialogueReplyInput`, `npm run lint`, `npm run build`.

---

**Slice 5 — Docs closeout**
`docs: record generated story objective contract v0`

Flip ADR-0047 status to Accepted/Implemented. Update ARCHITECTURE.md feature map (add
"Generated Story Objective Contract v0" under ✅ Implemented). Update AGENTS.md feature
map. No source tests required for docs-only.

Verification: `git diff --check` only.

---

## 8. Test plan

### Mandatory

**`generatedObjectiveSpec.test.ts`**
- Rejects unknown `condition.kind`; rejects extra keys (strict schema); rejects over-length
  `title` (>80), `description` (>160), `hint` (>160), `completionHint` (>160); rejects
  missing required fields; accepts each valid condition kind with minimal input.

**`assembleObjective.test.ts`**
- Returns `null` without throwing on: invalid JSON, schema failure, empty input.
- Satisfiability — returns `null` for each unsatisfiable case:
  - `interact-object` referencing a non-existent `objectId`.
  - `interact-object` referencing an object with no interaction.
  - `interact-object` referencing an object whose interaction carries no effect (cannot set a flag).
  - `resolve-encounter` referencing an object with no `encounter`.
  - `visit-room` with a `roomId` not matching any exit in the room.
- Returns a valid `QuestSpec` for each satisfied condition kind:
  - `interact-object` → `condition.kind === 'room-flag'`, `flag === 'interaction:<objectId>'`.
  - `resolve-encounter` → `condition.kind === 'room-flag'`, `flag === 'encounter:<objectId>'`.
  - `visit-room` → `condition.kind === 'room-visited'`, `roomId === <matched exit roomId>`.
- End-to-end: valid `QuestSpec` from assembler → `evaluateQuest(spec, state)` reports
  `done: false` before flag set; `done: true` once `state.roomStates[roomId].flags[flag]
  === true` (or `visited === true` for `room-visited`).
- Text sanitization: over-length hint is truncated; `diagnostics.textSanitized === true`.
- Diagnostics: `conditionUnsatisfiable: true` when dropped for satisfiability;
  `objectiveDropped: true` when returning `null`; `conditionKind` is the enum value;
  `objectiveValid: true` only on success.
- Purity: no input mutation, no `Date.now`, no `Math.random`, no I/O.

**`FakeObjectiveGenerator.test.ts`**
- Returns a parseable JSON string referencing a real object when an eligible interactive
  object is in the room.
- Returns `null` when no eligible object (no interaction, or no id).
- Deterministic: same seed + same room → identical output string.
- Emits no logger call.

**`FakeNPCDialogueProvider.test.ts` (additions)**
- `context.quest.hint` is returned when present and objective is active; authored `QUEST_CLUE`
  is not consulted.
- `context.quest.completionHint` is returned when present and status is `complete`; authored
  `QUEST_COMPLETION_LINES` is not consulted.
- When both `hint` and an authored `QUEST_CLUE` entry exist for the same stage, `hint` wins.
- **Regression:** absent `hint` / `completionHint` (`context.quest` present but no hint
  fields) → provider output is **byte-identical to today** for all existing authored inputs.
- **Regression:** absent `quest` → provider output byte-identical to today.

**Scoping (integration-style unit tests)**
- Authored bootstrap path: `questSpec` is set to `demoQuestSpec`; `FakeObjectiveGenerator`
  is never instantiated; `assembleObjective` is never called.
- Prompt-generated path + `assembleObjective` returns `null`: `questSpec` is null; no
  tracker; no hint.
- Adjacent pregeneration: `assembleObjective` is never called.

### Log safety assertion
All test assertions on log output (if any) must verify the log output does **not** contain:
hint text, objective title/description, object names, room names, flag strings, generated
JSON, or prompt text.

---

## 9. Manual smoke checklist

1. **Generated room with objective:** enter a prompt that generates a room with an interactive
   object. Expect: QuestTracker appears with one objective; objective is not yet done.
2. **Perform the objective action:** press E/F on the target object. Expect: objective flips
   to done; tracker shows `{title} is complete.` (no "Steward's Toll" copy).
3. **NPC hint:** talk to the generated-room NPC before completing the objective. Expect: NPC
   gives the generated hint text (not "The tribute coffer sits somewhere..."). After
   completion: NPC gives `completionHint`.
4. **Generated-room navigation is free:** press E on exits; navigation is never refused.
   No gate message. Confirms no generated gate.
5. **Dropped objective:** generate a room where no interactive object has a stable id
   (implementation-dependent; may not be testable manually if the fake always picks one).
   Expect: room plays normally, no tracker, no NPC hint.
6. **Authored demo unchanged:** load the authored example world. Expect: "The Steward's Toll"
   tracker; Asha gives authored stage clues; north arch is gated; coffer behavior unchanged.
   The completion message reads "The Steward's Toll is complete." (from generic `{view.title}
   is complete.`).
7. **Save/load (known limitation):** save a generated session mid-objective; reload. Expect:
   progress flags are restored (the action you took is recorded); however the QuestTracker and
   NPC hint **do not appear** after load (the generated `QuestSpec` is not persisted). This is
   expected v0 behavior and must not be treated as a bug.

---

## 10. Failure modes and safety

**Satisfiability (critical):** `assembleObjective` must verify not just that the objectId
exists, but that the object carries the right interaction kind. An object with no effect
cannot set `interaction:<id>`. An object with no encounter cannot set `encounter:<id>`. These
are not recoverable with repair — drop to `null`.

**Object id stability:** `RoomObject.id` is optional in `RoomSpec`. The assembler must check
the id is non-null on the actual `LoadedRoom` object (after all assembly normalizers ran), not
just on the raw JSON. The fake generator must only reference objects that have a stable id
after assembly.

**`demoQuestEnabled` / gate scoping:** attaching a generated `questSpec` to `activePlay`
makes `activePlay.questSpec != null` true, which is the signal `App.handleNavigate` uses to
decide whether to consult `evaluateExitGate`. The gate is safe because `evaluateExitGate`
returns `{ gated: false }` for any room pair that is not exactly `throne-room →
ruined-safehouse` — and generated rooms never have those ids. But this coupling must be
documented: a future change that makes the gate consult more room pairs must also exclude
generated quest sessions explicitly.

**Generated hint as UI text:** the hint is the first generated free text to reach the
player's dialogue panel via the NPC. It is sanitized and length-bounded before it arrives.
It must never key logic (confirmed: the provider returns it as a text string; it has no
`if (hint === ...)` branches in the game loop). Keep it strictly inert.

**Ephemeral objective on reload:** the generated `QuestSpec` is not persisted. Progress
flags (`room-flag`, `room-visited`) survive in `WorldState` but the tracker does not
reappear. This must be called out in the UI (or at minimum in docs) so the player is not
surprised. A future "generated quest log persistence" slice can address this.

**Pipeline independence:** the objective pipeline must not run on `repaired`, `fallback`, or
`unavailable` room results. Guarded by running `assembleObjective` only inside the
`provenance === 'generated'` success branch of `assembleRoom`.

**No-op on null:** when `assembleObjective` returns `null`, `questSpecRef.current` must
stay null (or be cleared if previously set by a previous generated room). No partial state.

---

## 11. Non-goals (explicit)

- Generated mechanical gates or generated navigation blocking of any kind.
- Real LLM / real provider objective generation.
- Multiple or chained objectives.
- Global or cross-room objectives beyond a single `visit-room` to an adjacent exit.
- Generated `has-item`, `has-status`, or `has-encounter-outcome` conditions.
- Inventory rewards, loot drops, combat, health, or death handling.
- `RoomSpec`, `questSpec.ts`, `evaluateQuest.ts`, `WorldEvent`, `WorldCommand`, reducer,
  or `SaveGame` schema change.
- Persistence of the generated `QuestSpec`, hint, or `completionHint` across save/load.
- Backend, server, memory, or persistence wiring.
- New ESLint rule or new dependency.
- Authored demo quest modification of any kind.
- Authored `evaluateExitGate` or `gatedNavigation` modification of any kind.

---

## 12. Deferred (future ADR)

- **Generated gate vocabulary** — a closed set of gate condition kinds that a generator may
  propose, with a trusted satisfiability + softlock-proof predicate. Requires independent
  design (the authored gate needed an explicit "Malik is always resolvable" proof; generated
  gates require a generated proof). Explicitly out of this feature.
- **Persistence of generated `QuestSpec`** — attach the spec to `SaveGame` so tracker/hints
  survive save/load.
- **Multi-objective generated quests** — chained objectives with explicit ordering and
  satisfiability web checking.
- **Real-LLM objective generation** — wire a real provider behind the `ObjectiveGenerator`
  port, keeping all assembly and satisfiability logic unchanged.
- **`QuestSpec.completionText`** — authored completion sentence on the spec, so the
  authored demo can restore "The road north is yours." if desired.
- **Quest rewards** — inventory grants, status effects, health, unlocks.
