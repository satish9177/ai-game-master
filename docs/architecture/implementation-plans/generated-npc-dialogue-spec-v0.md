# Implementation Plan — `feature/generated-npc-dialogue-spec-v0`

> Status: **Slice 1 complete/approved. Slice 2 complete/approved. Slice 3
> complete/approved. Slice 4 skipped/not needed. Slice 5 complete/pending review.**
> ADR: [ADR-0067](../decisions/ADR-0067-generated-npc-dialogue-spec-v0.md).
> Maintainer approved the design in-chat. Locked decisions:
> deterministic/closed-tables only; sibling normalizer `ensureGeneratedNpcDialogue`
> co-located in `ensureGeneratedNpcPresence.ts`; new Stage 2.12.2 in `assembleRoom`,
> unconditional (not gated by `requestsNpc`); both `id` assignment and `dialogue`
> addition in scope (id-less NPCs are not talkable without it); nameless greeting
> templates only; prompt ids `ask-room`/`ask-help` fixed; count-only diagnostic
> `npcDialogueNormalizedCount`; no provider/LLM, no schema change, no `RoomViewer`/
> `App`/`NPCDialoguePanel`/memory/save-load/persistence change.
>
> Companion docs: [ARCHITECTURE](../ARCHITECTURE.md) · [BOUNDARIES](../BOUNDARIES.md) ·
> [AGENTS.md](../../../AGENTS.md).
> Direct precedents this plan mirrors:
> [ADR-0040](../decisions/ADR-0040-generated-room-npc-presence-v0.md) — the existing
> `ensureGeneratedNpcPresence` sibling this plan parallels in structure;
> [ADR-0066](../decisions/ADR-0066-generated-npc-dialogue-seed-variety-v0.md) — the
> closed ADR-0066 tables (`NPC_PERSONAS`, `ANCHOR_PROMPTS`, `GENERIC_ROOM_PROMPTS`,
> `HELP_PROMPTS`, `stableIndex`, `selectFrom`) this plan reuses directly by co-location;
> [ADR-0048](../decisions/ADR-0048-generated-room-objective-target-enrichment-v0.md) —
> the `nextObjectiveTargetId`/`collectStructuralIds` id-assignment pattern this plan
> mirrors for collision-safe NPC id assignment.

---

## 1. Goal

Generated NPCs emitted by `FakeRoomGenerator` (and the real provider) can have
`interaction.body` but no `interaction.dialogue`. Some also carry no `id`. Both
conditions together cause `RoomViewer` to fall through to the plain `DialoguePanel`:

```
"<NPC> nods quietly."
[Close]
```

instead of `NPCDialoguePanel` with a greeting and prompt buttons.

**Root causes (both must be fixed):**

1. `buildDialogueLookup` (`app/dialogue.ts:20`) skips any NPC where
   `!object.id || !interaction?.dialogue` — so a dialogue-less NPC is never in the
   lookup.
2. `FakeRoomGenerator` emits `npc` objects with no `id` field. `buildInteractables`
   sets `id: undefined` for these, and `RoomViewer:218` guards with
   `target.id ? npcDialogueLookupRef.current.get(target.id) : undefined` — so even
   if dialogue were added, an id-less NPC would miss the lookup.

This slice fixes both: every generated-room NPC that is visible and talkable should
have a safe, deterministic `interaction.dialogue` **and** a non-empty `id` so that
pressing F opens `NPCDialoguePanel` with a greeting and two prompt buttons.

---

## 2. Current repo facts (verified against source)

- **`FakeRoomGenerator.ts:253-261`** emits NPC objects with no `id` and no `dialogue`:
  ```ts
  {
    type: 'npc',
    name,
    position: [...],
    interaction: { key: 'F', prompt: `Press F to speak with ${name}`, body: `${name} nods quietly.` },
  }
  ```
  The real provider prompt (`llmRoomPrompt.ts:47,67-71`) lists `npc` in the type
  allowlist but never requires `id` or `dialogue` — so real-provider generated NPCs
  have the same gap.

- **`ensureGeneratedNpcPresence.ts:117-119`** early-returns when any NPC already exists:
  ```ts
  if (room.objects.some((object) => object.type === 'npc')) {
    return { room, npcInserted: false }
  }
  ```
  So a generator-emitted NPC blocks insertion, but its dialogue gap is never closed.

- **`app/dialogue.ts:20`** (`buildDialogueLookup`):
  ```ts
  if (!object.id || !interaction?.dialogue || lookup.has(object.id)) continue
  ```
  Both `id` and `dialogue` are required.

- **`RoomViewer.tsx:217-218`**:
  ```ts
  const dialogueTarget = target.id
    ? npcDialogueLookupRef.current.get(target.id)
    : undefined
  ```
  Miss → falls through to plain `DialoguePanel`.

- **ADR-0066 tables already in `ensureGeneratedNpcPresence.ts`** (`NPC_PERSONAS`,
  `NPC_BODIES`, `ANCHOR_PROMPTS`, `GENERIC_ROOM_PROMPTS`, `HELP_PROMPTS`, `stableIndex`,
  `selectFrom`, `selectPromptOne`) are module-private and reusable by co-location
  at zero extra import cost.

- **Id-assignment precedent:** `domain/generatedRoomObjectiveTarget.ts:55,118-138`
  does `target.id ?? nextObjectiveTargetId(room)` with a `collectStructuralIds`
  helper that scans both `room.objects` and `room.skipped` raw ids. The NPC normalizer
  mirrors this pattern.

- **`NPCDialoguePanel.tsx:4-13`** `PERSONA_ROLE_LABELS` already covers all six
  ADR-0066 persona strings (`generated-room-guide`, `generated-calm-witness`,
  `generated-keep-warden`, `generated-archive-aide`, `generated-wasteland-scout`,
  `generated-shelter-watch`). No UI change is needed.

- **`RoomViewer.tsx`**, `App.tsx`, `NPCDialoguePanel.tsx`, schema, save-load, memory,
  and persistence need **no change** — they are already correct once NPCs have both
  an `id` and `interaction.dialogue`.

---

## 3. Scope

### To implement (Slices 2–4)

1. **`apps/web/src/domain/ensureGeneratedNpcPresence.ts`** — co-locate the new
   `ensureGeneratedNpcDialogue` function (§4). Reuse existing module-private tables
   and helpers without new exports. Add one new closed table `NPC_DIALOGUE_GREETINGS`
   (nameless, per theme bucket, 2 entries each). Add a `collectNpcStructuralIds`
   helper (mirrors `collectStructuralIds` from `generatedRoomObjectiveTarget.ts` but
   scoped to NPC id collision only). No change to `ensureGeneratedNpcPresence` or any
   existing helper.

2. **`apps/web/src/domain/assembleRoom.ts`** — new Stage 2.12.2 immediately after
   Stage 2.12 (`ensureGeneratedNpcPresence`) and before Stage 2.12.5 (objective
   enrichment). Add `npcDialogueNormalizedCount: number` to `RoomDiagnostics`
   (count-only; 0 on every fallback branch).

3. **`apps/web/src/domain/ensureGeneratedNpcDialogue.test.ts`** (new file, or
   co-located section in `ensureGeneratedNpcPresence.test.ts` — maintainer to decide
   at implementation time). Covers all invariants in §6.

4. **`apps/web/src/domain/assembleRoom.test.ts`** — extend with the new diagnostic
   field and the two pipeline-level cases (§6).

### Out / non-goals

- ❌ Any change to `ensureGeneratedNpcPresence` (placement/id-collision/insertion logic).
- ❌ `FakeRoomGenerator`, `OpenAICompatibleRoomGenerator`, or any provider.
- ❌ `dialogue/FakeNPCDialogueProvider.ts` or `dialogue/NPCDialogueService.ts`.
- ❌ `domain/ports/NPCDialogueProvider.ts` or `domain/dialogue/**`.
- ❌ `renderer/RoomViewer.tsx`, `renderer/ui/NPCDialoguePanel.tsx`, `App.tsx`.
- ❌ `app/dialogue.ts` (`buildDialogueLookup`).
- ❌ `domain/roomSpec.ts`, `domain/world/**` (all schemas).
- ❌ Save-load, persistence, memory, server, `eslint.config.js`, `package.json`.
- ❌ `NPCDialoguePanel` `PERSONA_ROLE_LABELS` (already covers all personas).
- ❌ NPC `name`, `prompt`, `body`, `position`, scale, rotation — untouched.
- ❌ Existing `interaction.dialogue` — never overwritten.
- ❌ Existing object `id` — never changed.
- ❌ Free-text input, click-to-talk, WorldState mutation, authoritative dialogue.
- ❌ ADR in Slice 1 (written at closeout).

---

## 4. Architecture — `ensureGeneratedNpcDialogue`

```ts
export type EnsureGeneratedNpcDialogueOptions = {
  themePack?: GeneratedRoomVisualTheme
}

export type EnsureGeneratedNpcDialogueResult = {
  room: LoadedRoom
  npcDialogueNormalizedCount: number
}

export function ensureGeneratedNpcDialogue(
  room: LoadedRoom,
  options: EnsureGeneratedNpcDialogueOptions = {},
): EnsureGeneratedNpcDialogueResult
```

**Algorithm (one pass, immutable):**

For each object in `room.objects` in order:

1. Skip if `object.type !== 'npc'`.
2. Skip if `object.interaction.dialogue != null` (already has dialogue — not counted).
   `interaction` itself is required by the validated generated-room `RoomSpec` NPC
   schema, so this normalizer operates on already-validated rooms and reads
   `object.interaction.dialogue` directly — it does not guard against a missing
   `interaction`.
3. Assign a collision-safe `id` if `object.id` is absent or blank:
   - Collect all existing structural ids (from `room.objects` and `room.skipped` raw
     entries) plus ids already assigned earlier in this pass.
   - Candidate base: `'generated-npc'` (matching `GENERATED_NPC_BASE_ID`).
   - Suffix with `-2`, `-3`, … until no collision.
4. Add `interaction.dialogue` with deterministic closed-table content:
   - **persona:** `selectFrom(NPC_PERSONAS[bucket], room.id, 'npc-dialogue-persona:' + id)`
   - **greeting:** `selectFrom(NPC_DIALOGUE_GREETINGS[bucket], room.id, 'npc-dialogue-greeting:' + id)` — **nameless, no `{name}` interpolation**
   - **prompts:** `[{ id:'ask-room', label: selectPromptOne(room, options) }, { id:'ask-help', label: selectFrom(HELP_PROMPTS, room.id, 'npc-dialogue-help:' + id) }]`
5. Increment the count.

Return `{ room: <new room with normalizations applied>, npcDialogueNormalizedCount: count }`.

The function is pure, synchronous, no I/O, no logger, no mutation of input.

**New closed table `NPC_DIALOGUE_GREETINGS` (nameless, per bucket, 2 entries each):**

```ts
const NPC_DIALOGUE_GREETINGS: Readonly<Record<ThemeBucket, readonly string[]>> = {
  default: Object.freeze([
    'Stay close. Keep your voice low.',
    'Watch the room. I will answer what I can.',
  ]),
  'fantasy-keep': Object.freeze([
    'Hold a moment. Tread softly in these halls.',
    'Stand ready. This place still listens.',
  ]),
  'post-apoc': Object.freeze([
    'Stay sharp. The quiet does not last.',
    'Keep low. The ruins carry every sound.',
  ]),
}
```

All strings are hand-written, closed, `Object.freeze`d. No `{name}` placeholder.
No room/object/prompt/provider/memory text. No ids, flag keys, or gate keys.

**Salt convention:** every `selectFrom` call uses a salt prefixed with `'npc-dialogue-'`
and suffixed with the NPC's assigned/existing `id`. This ensures two NPCs in the
same room get different seeds, and does not collide with the ADR-0066 salts used
by `ensureGeneratedNpcPresence` (`'name:'`, `'persona:'`, `'greeting:'`, etc.).

**`selectPromptOne` reuse:** the existing module-private `selectPromptOne(room, options)`
is reusable as-is from the co-located scope. It derives the anchor type from
`selectGeneratedStoryAnchorIndex` and looks up `ANCHOR_PROMPTS` — both already
present and unchanged.

---

## 5. Pipeline position in `assembleRoom`

```
Stage 2.12   ensureGeneratedNpcPresence  (insert one NPC when none + requestsNpc)
Stage 2.12.2  ensureGeneratedNpcDialogue  ← NEW, unconditional
Stage 2.12.5 ensureGeneratedObjectiveTarget
Stage 2.13   sanitizeGeneratedDisplayText
Stage 3      validateRoom
```

`AssembleRoomOptions` gains no new field — `themePack` already present is passed
into `ensureGeneratedNpcDialogue`. `RoomDiagnostics` gains one new field:

```ts
/**
 * Number of existing generated-room NPCs that were given a safe deterministic
 * dialogue spec (and, where absent, a collision-safe id). Count-only; never
 * carries NPC names, ids, room names, or generated text. 0 on all fallback paths.
 */
npcDialogueNormalizedCount: number
```

All three result branches (`generated`, `repaired`, fallback) and the two
`toFallback` paths set this field. The field is 0 on every fallback path.

---

## 6. Minimum Safe Change Check

**What existing code is reused:**

- `NPC_PERSONAS`, `ANCHOR_PROMPTS`, `GENERIC_ROOM_PROMPTS`, `HELP_PROMPTS`,
  `stableIndex`, `selectFrom`, `selectPromptOne`, `themeBucket` — all already
  module-private in `ensureGeneratedNpcPresence.ts`; reused by co-location at zero
  extra export surface.
- `selectGeneratedStoryAnchorIndex` — already imported, already called at Stage 2.12.
- `GeneratedRoomVisualTheme` type — already imported.
- `AssembleRoomOptions.themePack` — already in scope at Stage 2.12.2 call site.
- The `collectStructuralIds`/`nextId` id-collision pattern from
  `generatedRoomObjectiveTarget.ts` — mirrored locally, not extracted (following the
  "intentionally self-contained" convention from ADR-0057/ADR-0066).

**What new code is actually necessary:**

- `ensureGeneratedNpcDialogue` function (~40 lines).
- `NPC_DIALOGUE_GREETINGS` table (~8 lines).
- `collectNpcStructuralIds`/`nextNpcDialogueId` helper (~15 lines).
- Stage 2.12.2 call + diagnostic field in `assembleRoom.ts` (~10 lines including all
  diagnostic-literal additions).
- New test file and `assembleRoom.test.ts` additions.

**Safety boundaries unchanged:**

- `ensureGeneratedNpcPresence` is byte-identical — its placement/collision/insertion
  logic is untouched.
- `RoomSpec`, `NPCDialogueSpecSchema`, `schemaVersion` — all unchanged.
- `RoomViewer`, `NPCDialoguePanel`, `App.tsx`, save-load, memory, backend — all
  untouched.
- The normalizer is generated-room-only (only `assembleRoom` calls it;
  authored/static/fallback rooms never enter `assembleRoom`).
- All seed text is provably free of generated/runtime content (construction-time
  proof + regression test).
- Dialogue is display-only; `NPCDialogueService` produces text replies only; no
  `WorldState` mutation path exists in the dialogue layer (confirmed by
  `BOUNDARIES.md`).

---

## 7. Tests

### New: `ensureGeneratedNpcDialogue.test.ts`

File location: `apps/web/src/domain/ensureGeneratedNpcDialogue.test.ts`
(maintainer may choose to co-locate in `ensureGeneratedNpcPresence.test.ts` instead;
the cases are identical either way).

| Test | What it asserts |
|---|---|
| Generator NPC (no id, no dialogue) → gets `id` + `dialogue` | `npcDialogueNormalizedCount === 1`; NPC has non-empty `id`; `interaction.dialogue` present |
| NPC has a non-empty `id` but no `interaction.dialogue` | `dialogue` is added; existing `id` string is byte-identical to input; `npcDialogueNormalizedCount === 1` |
| **Product invariant** | `buildDialogueLookup(result.room).size >= 1` after normalizing a room with one dialogue-less NPC |
| Existing `dialogue` untouched | byte-identical; not counted in `npcDialogueNormalizedCount` |
| Existing `id` preserved | same string after normalize |
| Multiple id-less NPCs → distinct ids | two NPCs in one room each get a different `id`; no collision |
| Prompt ids exactly `ask-room` and `ask-help` | in all buckets and anchor-present/absent cases |
| Anchor-present prompt-1 label | comes from `ANCHOR_PROMPTS[anchorType]` |
| No-anchor prompt-1 label | comes from `GENERIC_ROOM_PROMPTS` |
| Theme buckets | `'fantasy-keep'` → persona from `fantasy-keep` bucket; `'post-apoc'` → `post-apoc` bucket; `undefined` → `default` bucket |
| Determinism | same room + same options → identical output every call |
| Purity / no mutation | `room` reference unchanged; input room's objects array not mutated |
| No-leak | normalized NPC's JSON contains no `room.name`, no other object's `name`/`prompt`/`title`/`body`, no raw ids, no gate/flag text |
| Non-NPC objects untouched | every non-`npc` object byte-identical after normalize |

### Extended: `assembleRoom.test.ts`

| Test | What it asserts |
|---|---|
| Raw generated JSON with id-less, dialogue-less NPC | assembled NPC has non-empty `id` and `interaction.dialogue`; `diagnostics.npcDialogueNormalizedCount >= 1` |
| Adjacent-style path (no `requestsNpc`, no `themePack`) | generator NPC is still normalized; `npcDialogueNormalizedCount >= 1` |
| Fallback paths (json/schema/semantic failures) | `diagnostics.npcDialogueNormalizedCount === 0` |
| `npcDialogueNormalizedCount` type | present on all three result shapes (`generated`, `repaired`, fallback) |

---

## 8. Files

### Changed

| File | Change |
|---|---|
| `apps/web/src/domain/ensureGeneratedNpcPresence.ts` | Add `ensureGeneratedNpcDialogue`, `NPC_DIALOGUE_GREETINGS`, `collectNpcStructuralIds`, `nextNpcDialogueId`. No change to existing code. |
| `apps/web/src/domain/assembleRoom.ts` | Stage 2.12.2 call; `npcDialogueNormalizedCount` in `RoomDiagnostics` and all result literals. |
| `apps/web/src/domain/assembleRoom.test.ts` | Two new pipeline cases; `npcDialogueNormalizedCount` in existing diagnostic assertions. |

### New

| File | Purpose |
|---|---|
| `apps/web/src/domain/ensureGeneratedNpcDialogue.test.ts` | Unit tests for the normalizer (or co-located in `ensureGeneratedNpcPresence.test.ts`). |

### NOT changed

`app/dialogue.ts` · `renderer/RoomViewer.tsx` · `renderer/ui/NPCDialoguePanel.tsx` ·
`App.tsx` · `app/buildPromptGeneratedRoomSource.ts` · `generation/FakeRoomGenerator.ts` ·
`dialogue/FakeNPCDialogueProvider.ts` · `dialogue/NPCDialogueService.ts` ·
`domain/ports/NPCDialogueProvider.ts` · `domain/dialogue/**` · `domain/roomSpec.ts` ·
`domain/world/**` · `domain/generatedRoomComposition.ts` (read-only import already
present) · `domain/generatedRoomThemeVocabulary.ts` (type import, unchanged) ·
`domain/generatedRoomObjectiveTarget.ts` · `domain/sanitizeGeneratedDisplayText.ts` ·
`domain/generatedMechanicalGate.ts` · `memory/**` · `persistence/**` ·
`world-session/**` · `interactions/**` · `encounters/**` · `server/**` ·
`eslint.config.js` · `package.json`

---

## 9. Implementation slices

**Slice 1 — Docs (this plan)**
`docs: add implementation plan for generated npc dialogue spec v0`
No source code. Status: **complete/approved.**

---

**Slice 2 — Domain normalizer + unit tests**
`feat(domain): ensure generated NPC dialogue spec — normalizer + tests`

Modified: `ensureGeneratedNpcPresence.ts`
New: dialogue-normalizer test cases co-located in `ensureGeneratedNpcPresence.test.ts`.

Implements `ensureGeneratedNpcDialogue`, `NPC_DIALOGUE_GREETINGS`, and the
`nextNpcIdFromIds`/`isNonBlankString` id-collision helpers per §4. All tests in §7
(normalizer section) pass. Status: **complete/approved.**

Verification:
```bash
npm run test -- ensureGeneratedNpcDialogue
npm run test -- ensureGeneratedNpcPresence
npm run lint
npm run build
```

---

**Slice 3 — `assembleRoom` threading + tests**
`feat(domain): thread ensureGeneratedNpcDialogue into generated room assembly`

Modified: `assembleRoom.ts`, `assembleRoom.test.ts`

Adds Stage 2.12.2 and the `npcDialogueNormalizedCount` diagnostic per §5. All tests
in §7 (assembleRoom section) pass. Full `assembleRoom.test.ts` suite re-runs with
the new diagnostic field present on every result shape. Status: **complete/approved.**

Verification:
```bash
npm run test -- assembleRoom
npm run lint
npm run build
```

---

**Slice 4 — Fake-provider coherence check**
**Skipped/not needed.** `FakeNPCDialogueProvider` already falls through safely for
any unrecognized persona (ADR-0066 §2 confirmed this), and this feature's goal is
making generated NPCs enter `NPCDialoguePanel` — not changing reply content — so
there is no new persona/content surface for the provider to react to. The Slice 2/3
targeted test runs (`dialogue`, `ensureGeneratedNpcPresence`, `ensureGeneratedNpcDialogue`,
`assembleRoom`) already exercised this regression surface with no failures; no
additional code change or separate verification pass was required.

---

**Slice 5 — Docs closeout + ADR + manual smoke**
`docs: close generated npc dialogue spec v0`
Status: **complete/pending review.**

New: `docs/architecture/decisions/ADR-0067-generated-npc-dialogue-spec-v0.md`
Modified: `docs/architecture/ARCHITECTURE.md` (status paragraph, citing ADR)

Manual smoke checklist (§10) must pass before this slice is merged.

Verification:
```bash
npm run test
npm run lint
npm run build
```

---

## 10. Manual smoke checklist

1. Prompt-generate a room where the generator emits its own NPC (no explicit NPC
   request in the prompt) → walk up, press **F** → `NPCDialoguePanel` opens with a
   greeting and two prompt buttons. Plain `DialoguePanel` must not appear.
2. Navigate into an adjacent generated room containing a generator-emitted NPC →
   same result: **F** opens `NPCDialoguePanel`.
3. Click both starter prompt buttons → replies appear; no console errors.
4. Authored/demo room NPC dialogue (name, greeting, prompts) is byte-identical
   to before this feature.
5. Generated room whose NPC already had `interaction.dialogue` (e.g. an
   `ensureGeneratedNpcPresence`-inserted NPC) → dialogue unchanged; panel works
   as before.
6. Dev tools / console show no raw ids, object or room names, slugs, or raw JSON
   in the `NPCDialoguePanel` for any generated NPC.

---

## 11. Verification commands (full slice set)

```bash
# Slice 2
npm run test -- ensureGeneratedNpcDialogue
npm run test -- ensureGeneratedNpcPresence

# Slice 3
npm run test -- assembleRoom

# Slice 4 (regression)
npm run test -- dialogue

# Closeout
npm run test
npm run lint
npm run build
```

Run from `apps/web`. Use targeted commands per slice; run full `npm run test` only
at Slice 5 closeout.

---

## 12. Slice 5 closeout notes

Commands actually run for this closeout (from `apps/web`):

```bash
npm.cmd run test -- ensureGeneratedNpcDialogue ensureGeneratedNpcPresence assembleRoom dialogue
npm.cmd run lint
npx.cmd tsc --noEmit -p .
```

Results: all 15 matched test files / 294 tests passed; lint clean; `tsc --noEmit`
clean. The full unscoped `npm run test`/`npm run build` and the optional
`npx.cmd vitest run` were not run for this docs-only closeout, per the targeted-verification
guidance in `AGENTS.md`.

The manual smoke checklist (§10) requires driving the running app in a browser and
is **pending maintainer verification** — it was not executed as part of this
docs-only closeout pass. Slice 5 status is therefore **complete/pending review**
until the maintainer confirms the manual smoke checklist.
