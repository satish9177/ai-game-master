# Implementation Plan — `feature/generated-room-objective-target-enrichment-v0`

> Status: **design approved — not yet implemented.**
> Maintainer approved the promote-only enrichment scope on 2026-06-28.
> The ADR for this slice is
> [ADR-0048](../decisions/ADR-0048-generated-room-objective-target-enrichment-v0.md)
> (Proposed — design approved, not yet implemented).
>
> **Depends on:** `feature/generated-story-objective-contract-v0`
> ([ADR-0047](../decisions/ADR-0047-generated-story-objective-contract-v0.md))
> must be implemented first; this plan's source changes build on its new files
> (`assembleObjective`, `ObjectiveGenerator`, `FakeObjectiveGenerator`).
>
> Companion docs: [ARCHITECTURE](../ARCHITECTURE.md) · [BOUNDARIES](../BOUNDARIES.md) ·
> [FAILURE-MODES](../FAILURE-MODES.md) · [CONVENTIONS](../CONVENTIONS.md).
> Direct precedents and dependencies:
> `generated-story-objective-contract-v0`
> ([ADR-0047](../decisions/ADR-0047-generated-story-objective-contract-v0.md))
> defines `assembleObjective` and the `ObjectiveGenerator` port that this plan exercises;
> `generated-room-npc-presence-v0`
> ([ADR-0040](../decisions/ADR-0040-generated-room-npc-presence-v0.md))
> established the boolean-option gate pattern (`requestsNpc`) this plan replicates for
> `enrichObjectiveTarget`;
> `generated-room-object-purpose-v0`
> ([ADR-0037](../decisions/ADR-0037-generated-room-object-purpose-v0.md))
> creates the synthesized inspect interactions on generated objects that this enrichment
> upgrades to flag-setting.

---

## Goal

Close the gap between `assembleObjective` (which can assemble objectives) and real-LLM rooms
(which lack the stable `id` + `effect` properties `assembleObjective` requires). A single
deterministic enrichment stage promotes exactly one eligible generated-room object by assigning a
stable id and adding `effect: { kind: 'inspect' }` — making the room objective-ready without
inventing new content or weakening any safety boundary.

---

## 1. Status

**Design approved — not yet implemented.**

---

## 2. Current repo facts (verified against source)

- **`assembleObjective` satisfiability gate** (`domain/quests/assembleObjective.ts:94-119`)
  requires for `interact-object`: `findObjectById(room, objectId)` returns a match **and**
  `hasInteractionEffect(object)` is true. `hasInteractionEffect` returns `true` iff
  `object.interaction?.effect != null && object.interaction.encounter == null`.
- **`planInspect`** (`domain/interactions/planInteraction.ts:48-59`) derives the flag key as
  `oneShotFlag(effect.flag, ref) = effect.flag ?? 'interaction:' + ref` where `ref` is the
  object's `id` passed from the renderer. Without `effect.flag`, the key is always
  `'interaction:' + id`.
- **`assignGeneratedObjectPurpose`** (`domain/generatedRoomObjectPurpose.ts:74-97`) adds
  `{ key: 'E', prompt, title, body }` to allowlisted object types that currently lack
  interaction — **no `effect`** — so those objects remain flag-incapable.
- **`RoomObject.id` is optional** (`domain/roomSpec.ts:23`) — `id: z.string().optional()`.
  Real-LLM rooms typically omit ids on generated props.
- **`FakeRoomGenerator.asObjectiveTarget`** (`generation/FakeRoomGenerator.ts:148-160`)
  adds `id: 'objective-document'` and `interaction.effect: { kind: 'inspect' }` to the
  primary document. This is the exact pattern the enrichment stage replicates for real-LLM rooms.
- **`FakeObjectiveGenerator.isEligibleInteractObject`** (`generation/FakeObjectiveGenerator.ts:27-36`)
  requires `id != null`, `!id.startsWith('interaction:')`, `!id.startsWith('encounter:')`,
  `interaction.effect != null`, `interaction.encounter == null`. The promoted object will
  satisfy all five.
- **`App` gates `buildGeneratedObjectiveAttachment`** on `result.provenance === 'generated'`
  (`App.tsx:385-387`). Adjacent rooms (never `provenance === 'generated'` from the adjacent
  path perspective) and `repaired`/`fallback` rooms never reach the objective pipeline —
  independent of enrichment.
- **`GeneratedRoomSource` forwards `AssembleRoomOptions` verbatim** (`room/GeneratedRoomSource.ts:38,46,75`).
  No change needed there.
- **`buildPromptGeneratedRoomSource`** (`app/buildPromptGeneratedRoomSource.ts`) is the only
  caller that sets prompt-specific assemble options. Adding `enrichObjectiveTarget: true` there
  is a one-line change.
- **Stage ordering in `assembleRoom`** (`domain/assembleRoom.ts:246-263`): stages 2.11
  (`assignGeneratedObjectPurpose`) and 2.12 (`ensureGeneratedNpcPresence`) precede stage 2.13
  (`sanitizeGeneratedDisplayText`) and stage 3 (`validateRoom`). The new stage must run after
  2.11 (candidates created) and before 2.13 (text sanitization runs last) and 3 (final
  validation checks the promoted object).
- **Story-anchor type priority** (`domain/generatedRoomComposition.ts`) is `throne > altar >
  statue > corpse > machine/artifact > chest > table/map/book/paper`. Enrichment candidate
  selection uses the same ranking (minus `throne`, which is not in the object-purpose
  allowlist and would already have an interaction via anchor selection). This ensures consistent
  focal-object priority across all three features.

---

## 3. Scope

### In

1. **`ensureGeneratedObjectiveTarget`** — a new pure domain helper in
   `domain/generatedRoomObjectiveTarget.ts`. Receives `LoadedRoom`; returns
   `{ room: LoadedRoom; objectiveTargetEnriched: boolean }`. Performs steps 1–4 of the
   selection algorithm (see §4 below). No logger, no I/O, no `Math.random`.

2. **`assembleRoom` Stage 2.12.5** — a new gated call to `ensureGeneratedObjectiveTarget`
   controlled by `AssembleRoomOptions.enrichObjectiveTarget?: boolean` (default `false`).
   New `objectiveTargetEnriched: boolean` diagnostic field added to `RoomDiagnostics` and all
   three return sites (`generated`, `repaired`, `fallback`; `false` on all non-generated paths).

3. **`buildPromptGeneratedRoomSource`** — set `enrichObjectiveTarget: true` in the assemble
   options. One additional line. Adjacent generator construction paths unchanged.

4. **Tests** — `domain/generatedRoomObjectiveTarget.test.ts` (pure helper) and extensions to
   `domain/assembleRoom.test.ts` and `app/generatedObjective.test.ts` (see §8 below).

### Out

- No `domain/roomSpec.ts` schema change.
- No `domain/quests/assembleObjective.ts` change.
- No `domain/generatedRoomObjectPurpose.ts` change (stays presentation-only).
- No `generation/FakeRoomGenerator.ts` change (fake already satisfies the short-circuit).
- No `generation/FakeObjectiveGenerator.ts` change.
- No `WorldState` / `WorldEvent` / `WorldCommand` / reducer / `SaveGame` change.
- No gates, navigation, or exit changes.
- No adjacent pregeneration changes.
- No real-LLM objective provider changes.
- No backend / memory / persistence / server changes.
- No `renderer/engine/**` changes.
- No new dependency. No new lint block.
- No `resolve-encounter` or `visit-room` enrichment in v0 (only `interact-object` promotion).
- No `effect.flag` assignment.

---

## 4. Selection algorithm (locked — do not modify during implementation)

Operates on `LoadedRoom.objects` only. Never reads names, description text, or `room.skipped`.

**Step 1 — Already-eligible short-circuit.**
If any object satisfies `object.id != null && object.interaction?.effect != null && object.interaction.encounter == null`, return `{ room, objectiveTargetEnriched: false }` (same reference — no allocation). This preserves every `FakeRoomGenerator` room exactly and any LLM room that happened to emit an effect+id object.

**Step 2 — Build candidate set.**
Collect objects where all hold:
- `'interaction' in object && object.interaction != null`
- `object.interaction.effect == null`
- `object.interaction.encounter == null`
- `object.interaction.exit == null`
- `object.type !== 'npc'`
- `object.type` ∈ `{ book, paper, map, chest, crate, barrel, corpse, table, machine, altar, statue, artifact }`

**Step 3 — Pick deterministically.**
Type ranking: `altar` (highest) → `statue` → `corpse` → `machine` / `artifact` (tied) →
`chest` → `table` / `map` / `book` / `paper` (tied). Within a tier, choose the lowest index
among candidates. This is deterministic from validated types and indices only.

**Step 4 — If candidate set is empty, no-op.**
Return `{ room, objectiveTargetEnriched: false }`. Never create a new object.

---

## 5. Stable id and effect rules (locked)

**Id assignment:**
- Chosen object has `id` → keep it; only add the effect.
- Chosen object has no `id` → assign `'generated-objective-target'`.
- Collision check: scan `room.objects.map(o => o.id)` (and `room.skipped` raw id fields
  defensively). If `'generated-objective-target'` collides, try
  `'generated-objective-target-2'`, `'-3'`, … incrementing until unique. The suffix index
  is the candidate object's list index (deterministic, no `Math.random`).

**Effect assignment:**
- Add `effect: { kind: 'inspect' }` to the existing `interaction`. Preserve `.key`, `.prompt`,
  `.title`, `.body` unchanged.
- **Never set `effect.flag`** — `planInspect` must derive `'interaction:' + id` automatically.
- If the object defensively lacks an `interaction` field (should not happen given step 2
  filter): synthesize `{ key: 'E', prompt: 'Inspect', title: 'Inspect', body: 'You inspect
  it carefully.', effect: { kind: 'inspect' } }` using only fixed authored strings.

---

## 6. Minimum Safe Change Check

- **Reused:** `AssembleRoomOptions` and the `enrichObjectiveTarget`-as-boolean pattern
  (mirrors `requestsNpc`); `RoomDiagnostics` diagnostic surface; `buildPromptGeneratedRoomSource`
  injection point; `FakeObjectiveGenerator.isEligibleInteractObject` (the promoted object
  satisfies it without change); `assembleObjective` satisfiability gate (unchanged, now
  reached instead of returning null); `evaluateQuest` / `QuestTracker` / `questSpecRef`
  (all existing, all unchanged).
- **New code (minimum):** one pure helper file; one option field + one pipeline call in
  `assembleRoom`; one option line in `buildPromptGeneratedRoomSource`; one diagnostic field in
  three return sites.
- **Safety boundaries unchanged:** `assembleObjective` not touched; `hasInteractionEffect` gate
  still exercised on every call; no content invented; no flag string generated by enrichment;
  no raw text logged; no adjacent/authored/fallback path affected.
- **Targeted tests:** helper pure-function tests; `assembleRoom` option-on/off; end-to-end
  `enriched-room → assembleObjective → evaluateQuest` flag completion.

---

## 7. Files to touch

**New files:**
- `apps/web/src/domain/generatedRoomObjectiveTarget.ts` — pure helper.
- `apps/web/src/domain/generatedRoomObjectiveTarget.test.ts` — unit tests.

**Modified files:**
- `apps/web/src/domain/assembleRoom.ts` — add `enrichObjectiveTarget?: boolean` to
  `AssembleRoomOptions`; add Stage 2.12.5; add `objectiveTargetEnriched: boolean` to
  `RoomDiagnostics` and all three return sites.
- `apps/web/src/domain/assembleRoom.test.ts` — cover new stage (option on/off; no-op on
  already-eligible; no-op on no candidate).
- `apps/web/src/app/buildPromptGeneratedRoomSource.ts` — set `enrichObjectiveTarget: true`.
- `apps/web/src/app/generatedObjective.test.ts` — extend with a regression that a
  real-LLM-shaped room (objects with interactions but no id/effect) becomes
  objective-attachable after enrichment.

---

## 8. Files NOT to touch

`domain/roomSpec.ts` · `domain/quests/assembleObjective.ts` ·
`domain/quests/generatedObjectiveSpec.ts` · `domain/quests/questSpec.ts` ·
`domain/quests/evaluateQuest.ts` · `domain/generatedRoomObjectPurpose.ts` ·
`generation/FakeObjectiveGenerator.ts` · `generation/FakeRoomGenerator.ts` ·
`domain/interactions/**` · `interactions/**` · `encounters/**` ·
`world-session/**` · `domain/world/**` · reducers · `domain/world/saveGame.ts` ·
`world-session/saveGame.ts` · `app/exitGate.ts` · `app/gatedNavigation.ts` ·
`app/NavigationService.ts` · `app/buildAdjacentRoomSeed.ts` · `room/GeneratedRoomSource.ts` ·
`memory/**` · `persistence/**` · `server/**` · `renderer/engine/**` · `renderer/ui/**` ·
`App.tsx` (unless a future slice wires the option — not this slice) ·
`eslint.config.js` · `package.json`.

---

## 9. Implementation slices

Each slice is independently testable. Do not merge slices.

---

**Slice 1 — Pure helper + unit tests (no wiring)**
`feat(domain): generated room objective target enrichment helper`

New files: `generatedRoomObjectiveTarget.ts`, `generatedRoomObjectiveTarget.test.ts`.
No change to `assembleRoom` or any other file. Tests cover all selection algorithm paths.

Verification: `npm run test -- generatedRoomObjectiveTarget`, `npm run lint`, `npm run build`.

---

**Slice 2 — Wire into `assembleRoom`**
`feat(domain): wire objective-target enrichment stage into assembleRoom`

Add `enrichObjectiveTarget` option, Stage 2.12.5, `objectiveTargetEnriched` diagnostic field.
Extend `assembleRoom.test.ts`.

Verification: `npm run test -- assembleRoom`, `npm run lint`, `npm run build`.

---

**Slice 3 — Enable on prompt path + regression test**
`feat(app): enable objective-target enrichment on prompt-generated path`

One line in `buildPromptGeneratedRoomSource`. Extend `generatedObjective.test.ts` with the
real-LLM-shaped room regression.

Verification: `npm run test -- generatedObjective`, `npm run test -- buildPromptGeneratedRoomSource`,
`npm run lint`, `npm run build`.

---

**Slice 4 — Docs closeout**
`docs: record generated room objective target enrichment v0`

Flip ADR-0048 status to Accepted/Implemented. Update ARCHITECTURE.md feature map (mark
"Generated Room Objective Target Enrichment v0" as ✅ Implemented). Update AGENTS.md feature
map. Update FAILURE-MODES.md case 4i provenance note if needed.

Verification: `git diff --check` only.

---

## 10. Test plan

### `generatedRoomObjectiveTarget.test.ts` (mandatory)

- **Already-eligible short-circuit:** a room where one object already has `id` + `effect` +
  `encounter == null` → returns same room reference, `objectiveTargetEnriched: false`. Covers
  `FakeRoomGenerator` rooms.
- **Promotes one candidate:** a room where no object is eligible but one is a purpose-type
  with a synthesized interaction and no effect → `objectiveTargetEnriched: true`; the promoted
  object now has `effect: { kind: 'inspect' }` and either a preserved or newly assigned id.
- **Preserves existing interaction text:** `.key`, `.prompt`, `.title`, `.body` on the promoted
  object are byte-identical to before enrichment.
- **Never sets `effect.flag`:** the promoted object's `effect` has no `flag` property (or
  `flag === undefined`).
- **Type ranking:** when two candidates exist, the higher-ranked type (e.g. `altar` over
  `book`) is chosen; within a type, lowest index wins.
- **Id preservation:** if the chosen object already has an `id`, that id is kept (the effect
  is added to the existing id).
- **Id assignment:** if the chosen object has no `id`, the promoted object gets
  `id === 'generated-objective-target'` (or the suffix variant on collision).
- **Collision avoidance:** if `'generated-objective-target'` already exists on another object,
  the promoted object gets `'generated-objective-target-2'` (or next available suffix).
- **No candidate → no-op:** a room with only `npc`/`arch`/`exit`-carrying objects →
  `objectiveTargetEnriched: false`, room unchanged.
- **Object count unchanged:** the promoted room has `objects.length === input.objects.length`.
- **Non-target objects byte-identical:** every object except the promoted one is strictly equal
  (same reference) to its input counterpart.
- **Purity:** no `Date.now`, no `Math.random`, no I/O, no mutation of the input room.
- **Flag key compatibility:** `isEligibleInteractObject` (from `FakeObjectiveGenerator`) returns
  `true` for the promoted object (verifies end-to-end eligibility without importing the generator).

### `assembleRoom.test.ts` additions (mandatory)

- **Option off (default):** a real-LLM-shaped room with no id/effect objects → `objectiveTargetEnriched:
  false` in diagnostics; the room contains no objective-ready object.
- **Option on:** same room with `enrichObjectiveTarget: true` → `objectiveTargetEnriched: true`;
  the room now has exactly one object satisfying the eligibility predicate.
- **Provenance stays `generated`:** enrichment does not raise `repaired` or `fallback`.
- **Fallback path:** `objectiveTargetEnriched: false` on all fallback/repaired return sites.
- **No-op when already-eligible:** a `FakeRoomGenerator`-style room with `enrichObjectiveTarget:
  true` → `objectiveTargetEnriched: false`; output byte-identical (same room reference from helper).

### `generatedObjective.test.ts` additions (mandatory)

- **Real-LLM-shaped room regression:** build a `LoadedRoom` whose objects have synthesized
  purpose interactions (key/prompt/title/body) but no `id` or `effect` — mirroring what a
  real DeepSeek room looks like after `assignGeneratedObjectPurpose`. Run through
  `assembleRoom(..., { enrichObjectiveTarget: true })` → `buildGeneratedObjectiveAttachment`.
  Assert: `attachment` is non-null; `questSpec` is valid; the condition flag equals
  `interaction:<assignedId>`.
- **End-to-end satisfiability:** set `state.roomStates[roomId].flags['interaction:<assignedId>']
  = true` → `evaluateQuest(spec, state).status === 'complete'`.
- **Regression — existing fake tests still pass:** all tests in the existing
  `'generated objective on a real prompt-generated room'` suite pass unchanged.
- **Log/leak safety:** `JSON.stringify(attachment)` does not contain the promoted object's
  type string, any synthesized `body` text, or the enrichment stage label.

### Log safety assertion

No test may assert that a log line contains object ids, type strings, interaction text, room
names, generated JSON, provider output, or prompt text.

---

## 11. Manual smoke checklist

1. **Real-LLM room with objective (DeepSeek/OpenAI BYOK, dev-only):** prompt "a quiet archive".
   Expect: QuestTracker appears with one objective; objective is active.
2. **Complete the objective:** press E on the highlighted inspectable object. Expect: objective
   flips to done; tracker shows `{title} is complete.`
3. **NPC hint (if NPC present):** talk to the NPC before completing. Expect: NPC gives the
   generated hint text. After completion: NPC gives `completionHint`.
4. **No tracker room:** prompt a room that generates only structural objects (arch, pillar,
   npc, exits). Expect: no quest tracker; room plays normally; no error.
5. **Fake generator (provider disabled):** confirm existing fake objective behavior is
   byte-identical — tracker appears, same hint, same completion.
6. **Adjacent navigation:** navigate through an exit; confirm the adjacent room has no quest
   tracker and navigation is free.
7. **Authored demo unchanged:** load the authored example world. "The Steward's Toll" tracker,
   Asha gives authored clues, north arch gated, coffer behavior — all unchanged.
8. **Logs (browser console):** confirm `objectiveTargetEnriched` appears only as a boolean;
   no object id, type name, room name, or interaction text visible.

---

## 12. Failure modes and safety

**No candidate (expected, handled):** `ensureGeneratedObjectiveTarget` returns the unchanged
room; `FakeObjectiveGenerator` returns `null`; `assembleObjective` is not reached; room plays
without a quest tracker. This is the correct, safe outcome.

**Collision on constant id (handled):** suffix loop is deterministic and bounded by the object
count. In practice the constant `'generated-objective-target'` would only collide if a real
LLM happened to emit that exact id on another object — extremely unlikely, and handled safely.

**Effect on encounter object (impossible):** Step 2 candidate filter excludes objects with
`encounter != null`, so the enrichment can never interfere with the encounter-flag namespace.

**Effect on exit object (impossible):** Step 2 filter excludes objects with `exit != null`,
so no exit-carrying arch is ever promoted.

**Repaired/fallback path receiving no objective (correct):** App gates `buildGeneratedObjectiveAttachment`
on `provenance === 'generated'`. A room that falls back after enrichment (e.g. a fatal survives
repair) still gets no objective — consistent with ADR-0047's independence requirement.

**`demoQuestEnabled` coupling:** unchanged from ADR-0047 — attaching a generated `questSpec`
makes `activePlay.questSpec != null` true, but `evaluateExitGate` only fires on the authored
room pair `throne-room → ruined-safehouse`. Generated room ids never match, so no generated
gate is possible.

---

## 13. Non-goals (explicit)

- Inventing new objects when no candidate exists.
- `resolve-encounter` or `visit-room` target enrichment (out of v0; both require their own
  candidate filter and test coverage).
- Assigning `effect.flag` explicitly on any enriched object.
- Changing `assembleObjective` in any way.
- Changing `assignGeneratedObjectPurpose` in any way (stays presentation-only).
- Multiple-object promotion (exactly one, or zero).
- Adjacent room enrichment.
- Real-LLM objective provider wiring.
- `RoomSpec` / `WorldState` / `WorldEvent` / `WorldCommand` / reducer / `SaveGame` change.
- Backend, memory, persistence, or server wiring.
- New dependency or lint block.

---

## 14. Deferred (future ADR)

- **`resolve-encounter` enrichment** — promote one encounter-carrying generated object so a
  `resolve-encounter` objective can attach. Requires verifying the encounter's one-shot flag
  derivation and that the encounter has a stable id.
- **`visit-room` enrichment** — verify an exit with the target `roomId` exists; this is purely
  a satisfiability check, not a structural mutation, but belongs in a separate slice.
- **Real-LLM objective provider** — wire a real provider behind `ObjectiveGenerator`; enrichment
  makes the room ready regardless of provider.
- **Generated quest persistence** — persist the generated `QuestSpec` and hints in `SaveGame`
  so the tracker/hints survive reload.
- **Multi-objective** — promote multiple objects for chained objectives; requires a satisfiability
  web check.
