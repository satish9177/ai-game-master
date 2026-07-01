# Implementation Plan — `feature/generated-npc-dialogue-seed-variety-v0`

> Status: **planned (Slice 1 — this doc).**
> Maintainer approved the design in-chat (this session) under the following locked decisions:
> deterministic only, no provider/LLM involvement, fix lives entirely inside the existing
> `ensureGeneratedNpcPresence.ts` pure function, `themePack` is threaded in from `assembleRoom`,
> variety tables are closed and hand-written, selection uses `room.id` + `themePack` + the
> room's existing derived story-anchor object type, prompt ids stay `ask-room`/`ask-help`, NPC
> placement/id-collision logic is untouched, and `FakeNPCDialogueProvider`, the real dialogue
> provider, `NPCDialogueService`, `RoomViewer`, `App.tsx`, memory, schema, save/load, renderer,
> and persistence are all out of scope.
>
> An ADR (next number: **ADR-0066**) can be added at closeout if implementation confirms this
> design holds without deviation — matching the existing convention of one ADR per shipped `-v0`
> slice (ADR-0001 through ADR-0065 today).
>
> Companion docs: [ARCHITECTURE](../ARCHITECTURE.md) · [BOUNDARIES](../BOUNDARIES.md) ·
> [AGENTS.md](../../../AGENTS.md).
> Direct precedents this plan mirrors structurally:
> `generated-room-story-anchors-v0` ([ADR-0034](../decisions/ADR-0034-generated-room-story-anchors-v0.md))
> — the closed, `RoomObject.type`-only anchor selector this plan reuses verbatim
> (`selectGeneratedStoryAnchorIndex`);
> `generated-story-threading-v0` ([ADR-0057](../decisions/ADR-0057-generated-story-threading-v0.md))
> — the precedent for using a structural id (there: `roomId` depth via regex) as a safe,
> content-free deterministic selection key, and for keeping a tiny pure helper
> "intentionally self-contained" rather than extracting a shared module;
> `generated-room-theme-vocabulary-v0` ([ADR-0044](../decisions/ADR-0044-generated-room-theme-vocabulary-v0.md))
> — the `GeneratedRoomVisualTheme` ('fantasy-keep' | 'post-apoc') threading pattern this plan
> reuses as-is.

---

## 1. Goal

Generated rooms that request an NPC (`requestsNpc: true`, set by the existing boolean-only
`detectsNpcRequest` classifier) currently always insert the exact same hardcoded NPC: name
`'Mira'`, persona `'generated-room-guide'`, greeting `'Stay close. I am Mira.'`, and the exact
same two starter prompts (`'What do you notice here?'`, `'Can you help me?'`). This makes
generated NPC interaction read as fixed/demo-like.

This slice makes the inserted NPC's **name, persona, greeting, and starter-prompt labels** vary
deterministically based on safe, already-validated, closed-enum data — with **no LLM call, no
new randomness, no schema change, and no read of any room/object name, prompt, body, or
generated free text.**

---

## 2. Current repo facts (verified against source)

- **Exact hardcoded source:** `apps/web/src/domain/ensureGeneratedNpcPresence.ts:16-59`.
  ```ts
  const GENERATED_NPC_BASE_ID = 'generated-npc'
  const GENERATED_NPC_NAME = 'Mira'
  const GENERATED_NPC_COLOR = '#597a9b'
  const GENERATED_NPC_FOOTPRINT = 0.45
  ...
  const NPC_TEMPLATE: Omit<NpcObject, 'id' | 'position'> = {
    type: 'npc',
    name: GENERATED_NPC_NAME,
    color: GENERATED_NPC_COLOR,
    rotationY: 0,
    scale: 1,
    interaction: {
      key: 'F',
      prompt: `Press F to talk to ${GENERATED_NPC_NAME}`,
      body: `${GENERATED_NPC_NAME} keeps watch, ready to answer quietly.`,
      dialogue: {
        persona: 'generated-room-guide',
        greeting: `Stay close. I am ${GENERATED_NPC_NAME}.`,
        prompts: [
          { id: 'ask-room', label: 'What do you notice here?' },
          { id: 'ask-help', label: 'Can you help me?' },
        ],
      },
    },
  }
  ```
  `ensureGeneratedNpcPresence(room, options)` (`requested: boolean` only) builds one NPC object
  from this single constant template when no NPC already exists in the room, then places it via
  `findNpcPosition` — an existing, untouched candidate-position/collision search. **Not** fake
  dialogue-provider fallback, **not** dialogue-lookup fallback, **not** fixture/demo data — a
  domain-layer generated-NPC seed template.
- **Call site:** `apps/web/src/domain/assembleRoom.ts:270-276` (Stage 2.12):
  ```ts
  const npcPresenceResult = ensureGeneratedNpcPresence(purposeFixed, {
    requested: options.requestsNpc ?? false,
  })
  ```
  `AssembleRoomOptions` (`assembleRoom.ts:174-180`) already carries `themePack?:
  GeneratedRoomVisualTheme` and `storyKind?: GeneratedStoryThreadKind`, both already in scope at
  this call site (used one stage earlier, at 2.7, by `composeGeneratedRoom`). `themePack` is
  **not currently passed** into `ensureGeneratedNpcPresence` — that one-line gap is the only
  `assembleRoom.ts` change this plan needs.
- **`storyKind` is out of reach for this feature in practice.** `requestsNpc: true` is only ever
  set by `app/buildPromptGeneratedRoomSource.ts:23-28`, which builds `AssembleRoomOptions` with
  `requestsNpc` and `themePack` but **never** `storyKind` (confirmed: `storyKind` is only
  attached for *adjacent* generated rooms per ADR-0057, and
  `AdjacentRoomPregenerator.test.ts:791`'s own test title — *"keeps adjacent GeneratedRoomSource
  default requestsNpc false"* — confirms adjacent rooms never request an NPC). So the only
  first-room NPC insertion path that exists today has `themePack` available and `storyKind`
  always `undefined`. This plan designs for that reality: `themePack` drives the persona/name
  bucket; `storyKind` is accepted as an optional pass-through with no effect for now (so a future
  slice or a test fixture that does supply it does not crash or behave surprisingly — it is
  simply not read).
- **Reusable anchor selector:** `apps/web/src/domain/generatedRoomComposition.ts` exports
  `selectGeneratedStoryAnchorIndex(objects: RoomObject[], options?: { themePack?; storyKind? }):
  number`. Pure, reads only validated `RoomObject.type` values via closed priority tables
  (`STORY_ANCHOR_PRIORITY` / `POST_APOC_STORY_ANCHOR_PRIORITY` / per-`storyKind` tables), never
  names/prompts/body text. Already called once per room at Stage 2.7
  (`composeGeneratedRoom` → `generatedRoomComposition.ts:359`). Calling it again at Stage 2.12
  with the same `room.objects` (object *types* are unaffected by the position changes composition
  and later stages make) and the same `themePack` reproduces the same anchor index deterministically
  — no new state, no threading required beyond the `themePack` option this plan already adds.
- **Deterministic hashing precedent:** `apps/web/src/dialogue/FakeNPCDialogueProvider.ts:226-230`
  already has a local `stableIndex(value: string, length: number): number` (char-code sum mod
  length) used to vary reply text deterministically by `npcId`/persona/prompt id. `apps/web/src/domain/generatedStoryThread.ts`
  is the domain-layer precedent for the same idea using structural id data (`roomId`) instead of
  content, and is explicitly commented `"Intentionally self-contained; keep in sync with..."` —
  i.e., duplicating a tiny pure helper locally, rather than extracting a shared module, is this
  codebase's established convention for this exact situation. This plan follows it: a small local
  `stableIndex`-equivalent inside `ensureGeneratedNpcPresence.ts`, seeded by `room.id` (the
  validated `RoomSpec.id`, a structural identifier already relied on elsewhere for id-collision
  checks — never generated narrative text). Using an id only as a numeric selector into a closed
  table does not leak the id's content anywhere; the output is always one of the hand-written
  strings below.
- **`FakeNPCDialogueProvider` is unaffected by persona value changes.** `PERSONA_LINES` and
  `PROMPT_LINES` (`FakeNPCDialogueProvider.ts:5-23`) are keyed only by `'friendly-aide'` /
  `'survivor'` (authored-room personas). `QUEST_CLUE`/`QUEST_COMPLETION_LINES` are keyed only by
  `'friendly-aide'`. Any persona string not in these tables (today's `'generated-room-guide'`,
  and this plan's new bucketed personas) already falls through safely, in order, to
  `objectiveAwarenessLine` (persona-agnostic) → `roomGroundedFallback` (type-keyed, persona
  agnostic) → `memoryAwarenessLine` (kind-keyed, persona agnostic) → `FALLBACK_LINES`
  (`stableIndex(key, ...)`, safe for any string `key`). **No change to `FakeNPCDialogueProvider`
  is needed** for correctness; this plan only extends `NPCDialoguePanel.tsx`'s cosmetic
  `PERSONA_ROLE_LABELS` map so the new persona strings get a UI subtitle instead of none.
- **Prompt ids are structural, not content.** `apps/web/src/renderer/RoomViewer.test.ts` and
  `apps/web/src/renderer/ui/NPCDialoguePanel.tsx:76-84` route strictly by `prompt.id` (passed to
  `onSay(prompt.id)`); only `prompt.label` is display text. Keeping `id: 'ask-room'` / `id:
  'ask-help'` fixed and varying only `label` means zero changes to dialogue routing, `RoomViewer`,
  or any id-keyed lookup.
- **No-leak regression test already exists and must keep passing.**
  `ensureGeneratedNpcPresence.test.ts` (*"does not leak generated room or existing object text
  into inserted NPC strings"*) asserts the inserted NPC's JSON never contains the room's `name`,
  any other object's id, or any other object's `prompt`/`title`/`body`/`name` text. This plan's
  new tables are 100% hand-written closed strings and never read `room.name` or any object's
  name/prompt/body — the assertion continues to hold structurally, and the test is extended (not
  weakened) with the new theme/anchor axes.

---

## 3. Scope

### To implement

1. **`ensureGeneratedNpcPresence.ts`** — the entire change:
   - Add `themePack?: GeneratedRoomVisualTheme` to `EnsureGeneratedNpcPresenceOptions`.
   - Replace the single `NPC_TEMPLATE` constant with a small pure `buildGeneratedNpcTemplate(room,
     themePack)` builder that:
     a. Derives a **theme bucket** — `'fantasy-keep'` → `'warden'`; `'post-apoc'` → `'survivor'`;
        `undefined`/anything else → `'guide'` (today's default, kept as the fallback bucket).
     b. Derives a **name index** via a local `stableIndex(room.id, pool.length)` into the bucket's
        closed name pool (each pool has 3-4 names; the default/`'guide'` pool contains multiple
        names, so it no longer always resolves to `'Mira'`).
     c. Derives the **persona string**, **greeting lead-in**, and **role label hint** from the
        same bucket (closed 1:1 tables, one entry per bucket — 3 buckets total).
     d. Derives the **anchor type** via `selectGeneratedStoryAnchorIndex(room.objects, {
        themePack })` (reused, unmodified) and looks up an anchor-keyed closed table
        (`ANCHOR_PROMPT_LINES: Partial<Record<RoomObject['type'], string>>`) for the first
        starter-prompt label (`id: 'ask-room'`); no anchor found → today's existing generic line
        `'What do you notice here?'` (unchanged literal, so a themeless/anchorless room's first
        prompt is byte-identical to current behavior).
     e. Derives the **second starter-prompt label** (`id: 'ask-help'`) via the same `room.id`
        index into a small closed pool of 2-3 generic help-phrasings (including the existing
        `'Can you help me?'` as one option, so it remains a possible — just not guaranteed —
        outcome).
   - Everything else in the file (`ensureGeneratedNpcPresence`, `findNpcPosition`, `nextNpcId`,
     all collision/placement helpers, `GENERATED_NPC_BASE_ID`, `GENERATED_NPC_COLOR`,
     `GENERATED_NPC_FOOTPRINT`, `NPC_BLOCKING_TYPES`) is **unchanged**.
2. **`assembleRoom.ts`** — one-line addition at the existing Stage 2.12 call site: pass
   `themePack: options.themePack` into `ensureGeneratedNpcPresence(...)`. No stage reordering, no
   new option, no diagnostics-shape change (`npcInserted` stays the only signal, unchanged type).
3. **`NPCDialoguePanel.tsx`** — add the two new persona strings (`'generated-room-warden'`,
   `'generated-room-survivor'`) to the existing `PERSONA_ROLE_LABELS` map (`NPCDialoguePanel.tsx:5-9`),
   each mapped to a short role word (e.g. `'Warden'`, `'Survivor'`... final wording decided at
   implementation time, subject to the "no leaked content" rule — these are hand-written UI
   labels, not derived from any generated text). This is purely cosmetic (subtitle text under the
   NPC name); omitting it would only mean the new personas show no subtitle, so this step is
   low-risk and easy to verify.

### Out / non-goals

- No provider/LLM involvement of any kind (fake or real).
- No changes to `dialogue/FakeNPCDialogueProvider.ts`, `dialogue/NPCDialogueService.ts`,
  `domain/ports/NPCDialogueProvider.ts`, `domain/dialogue/contracts.ts`,
  `domain/dialogue/buildDialogueContext.ts`, `generation/OpenAICompatibleNPCDialogueProvider.ts`.
- No use of `storyKind` for variety (not reachable when `requestsNpc` is true today; accepted
  as an unread pass-through only, see §2).
- No use of room memory, objective/quest text, or any recalled/generated free text as a variety
  source — objective enrichment (`ensureGeneratedObjectiveTarget`, Stage 2.12.5) runs *after* NPC
  insertion (Stage 2.12), so objective state does not exist yet at this point in the pipeline and
  is not a safe or even available signal.
- No use of `room.name`, any object's `name`, `prompt`, `title`, or `body` text.
- No typed free-text input, no click-to-talk/raycast selection.
- No change to prompt ids (`ask-room`, `ask-help` stay fixed).
- No change to `GENERATED_NPC_BASE_ID`, id-collision logic (`nextNpcId`), or placement/collision
  logic (`findNpcPosition` and its helpers).
- No change to `GENERATED_NPC_COLOR`, geometry, scale, or rotation — no renderer/builder change.
- No schema change (`NPCDialogueSpecSchema`, `RoomSpec.schemaVersion` all unchanged).
- No change to `RoomViewer.tsx`, `App.tsx`, save/load, persistence, memory, or the server.
- No regression to authored/demo NPC dialogue (authored NPCs never pass through
  `ensureGeneratedNpcPresence` — they already have their own `interaction.dialogue` from the
  authored `RoomSpec`, and `ensureGeneratedNpcPresence` only inserts when `room.objects.some(o =>
  o.type === 'npc')` is false).

---

## 4. Deterministic selection rules (exact v0 behavior)

Given a room `R` and `options.themePack`:

1. **Bucket** = `'warden'` if `themePack === 'fantasy-keep'`; `'survivor'` if `themePack ===
   'post-apoc'`; else `'guide'`.
2. **Name** = `NAME_POOL[bucket][stableIndex(R.id, NAME_POOL[bucket].length)]`.
3. **Persona** = `PERSONA[bucket]` (fixed 1:1, e.g. `'generated-room-warden'` /
   `'generated-room-survivor'` / `'generated-room-guide'`).
4. **Greeting** = `` `${GREETING_LEAD[bucket]}. I am ${name}.` `` (same template shape as today;
   only the lead-in and name vary).
5. **Anchor type** = `R.objects[selectGeneratedStoryAnchorIndex(R.objects, { themePack })]?.type`
   (`undefined` when the selector returns `-1`, i.e. `lacksAnchor`).
6. **Prompt 1 label** (`id: 'ask-room'`) = `ANCHOR_PROMPT_LINES[anchorType] ?? 'What do you notice
   here?'` (unchanged literal fallback).
7. **Prompt 2 label** (`id: 'ask-help'`) = `HELP_PROMPT_LINES[stableIndex(R.id, HELP_PROMPT_LINES.length)]`.
8. `interaction.prompt` = `` `Press F to talk to ${name}` `` (unchanged template).
   `interaction.body` = `` `${name} keeps watch, ready to answer quietly.` `` (unchanged template).

All of `NAME_POOL`, `PERSONA`, `GREETING_LEAD`, `ANCHOR_PROMPT_LINES`, `HELP_PROMPT_LINES` are
finite, hand-written `Record`/`Partial<Record<...>>` constants local to
`ensureGeneratedNpcPresence.ts`. `stableIndex` is a small local pure function (char-code sum mod
length, mirroring the existing pattern in `FakeNPCDialogueProvider.ts:226-230`), reading only
`room.id` — never room/object name or content text.

### Illustrative table sketch (exact wording finalized during implementation)

```ts
const NAME_POOL: Readonly<Record<'guide' | 'warden' | 'survivor', readonly string[]>> = {
  guide:    ['Mira', 'Rook', 'Sable', 'Wren'],
  warden:   ['Corvin', 'Halric', 'Isolde'],
  survivor: ['Dex', 'Ash', 'Rig'],
}

const PERSONA: Readonly<Record<'guide' | 'warden' | 'survivor', string>> = {
  guide: 'generated-room-guide',
  warden: 'generated-room-warden',
  survivor: 'generated-room-survivor',
}

const GREETING_LEAD: Readonly<Record<'guide' | 'warden' | 'survivor', string>> = {
  guide: 'Stay close',
  warden: 'Stand ready',
  survivor: 'Keep it quiet',
}

const ANCHOR_PROMPT_LINES: Partial<Record<RoomObject['type'], string>> = {
  throne: 'What happened to the ruler here?',
  altar: 'What was this altar for?',
  statue: 'Who is this statue of?',
  corpse: 'What happened to them?',
  chest: 'Is that chest safe to open?',
  machine: 'What does this machine do?',
  artifact: 'What is that artifact?',
  table: 'What was this table used for?',
  map: 'Do you know this map?',
  book: "What's in that book?",
  paper: 'What do those papers say?',
}

const HELP_PROMPT_LINES = [
  'Can you help me?',
  'What should I do here?',
  'Any advice for me?',
] as const
```

Note: `PERSONA_ROLE_LABELS` in `NPCDialoguePanel.tsx` must exactly cover `PERSONA['warden']` and
`PERSONA['survivor']` string values so both new buckets get a subtitle; `PERSONA['guide']`
(`'generated-room-guide'`) already has an entry (`'Guide'`) today and needs no change.

---

## 5. Minimum Safe Change Check

- **Reused:** `selectGeneratedStoryAnchorIndex` (unmodified) · `GeneratedRoomVisualTheme` type
  (unmodified) · the `stableIndex` hashing *pattern* from `FakeNPCDialogueProvider.ts` (mirrored
  locally, per this codebase's own "intentionally self-contained" convention — not extracted into
  a shared module) · the existing `AssembleRoomOptions.themePack` plumbing already present at the
  `assembleRoom.ts` Stage 2.12 call site · the existing `findNpcPosition`/`nextNpcId`/collision
  logic, entirely untouched · the existing `NPCDialoguePanel.tsx` `PERSONA_ROLE_LABELS` map
  (extended, not restructured).
- **New code (minimum):** one options field (`themePack`) · one small template-builder function
  replacing one constant, inside the same file · roughly five small closed `Record`/array
  constants · one tiny local `stableIndex` helper · one line in `assembleRoom.ts` · two new
  entries in one existing UI `Record`.
- **Safety boundaries unchanged:** `ensureGeneratedNpcPresence` remains pure and synchronous — no
  I/O, no logger, no randomness beyond the deterministic hash, no mutation of the input room
  (existing "does not mutate input room" test keeps passing). No room/object name, prompt, title,
  or body text is ever read by the new code (existing "does not leak..." test keeps passing,
  extended). `RoomDiagnostics.npcInserted` stays a plain boolean; no new diagnostic field, no new
  log surface anywhere (`GeneratedRoomSource.logAssembly` already logs only `npcInserted`
  boolean, unchanged). Prompt ids (`ask-room`/`ask-help`) unchanged, so `NPCDialogueService`,
  `FakeNPCDialogueProvider` reply routing, and `RoomViewer`'s `onSay(prompt.id)` wiring are
  provably unaffected. `NPCDialogueSpecSchema` and `RoomSpec.schemaVersion` are unchanged, so no
  validation/migration impact. Authored/static/fallback rooms never call
  `ensureGeneratedNpcPresence` with a pre-existing NPC absent, so their dialogue is provably
  unaffected (same early-return guard as today: `if (room.objects.some(o => o.type ===
  'npc'))`).
- **Targeted tests:** `ensureGeneratedNpcPresence.test.ts`, `assembleRoom.test.ts` (npc-insertion
  subset), `NPCDialoguePanel.test.tsx` (role-label subset).

---

## 6. Files touched by the planned slices

**Modified files only — no new files:**

- `apps/web/src/domain/ensureGeneratedNpcPresence.ts` — core change (§3.1).
- `apps/web/src/domain/ensureGeneratedNpcPresence.test.ts` — update the existing `'Mira'`-asserting
  test to match the new deterministic output for that fixture's `room.id`; add per-bucket,
  per-anchor-type, and "no theme / no anchor still not always Mira" cases; extend (not weaken)
  the existing no-leak/purity/determinism/placement tests.
- `apps/web/src/domain/assembleRoom.ts` — one-line addition threading `themePack` into the
  existing Stage 2.12 call (§3.2).
- `apps/web/src/domain/assembleRoom.test.ts` — update the `requestsNpc: true` assertions that
  currently hardcode `'Mira'`; add one themed-insertion case (e.g. `requestsNpc: true, themePack:
  'post-apoc'` produces a `survivor`-bucket persona/name).
- `apps/web/src/renderer/ui/NPCDialoguePanel.tsx` — two new `PERSONA_ROLE_LABELS` entries (§3.3).
- `apps/web/src/renderer/ui/NPCDialoguePanel.test.tsx` — add a case asserting the new personas
  render their new subtitle labels (mirrors the existing `'generated-room-guide'` → `'Guide'`
  coverage, if present, or adds it alongside).

## 7. Files NOT to touch

`domain/ports/NPCDialogueProvider.ts` · `domain/dialogue/contracts.ts` ·
`domain/dialogue/buildDialogueContext.ts` · `domain/dialogue/buildRoomDialogueContext.ts` ·
`dialogue/NPCDialogueService.ts` · `dialogue/FakeNPCDialogueProvider.ts` ·
`generation/OpenAICompatibleNPCDialogueProvider.ts` · `generation/llmDialoguePrompt.ts` ·
`domain/generatedRoomComposition.ts` (read-only import of `selectGeneratedStoryAnchorIndex`) ·
`domain/generatedRoomThemeVocabulary.ts` (read-only import of the type) ·
`domain/generatedStoryThread.ts` · `domain/generatedRoomObjectiveTarget.ts` ·
`domain/generatedMechanicalGate.ts` · `domain/sanitizeGeneratedDisplayText.ts` ·
`domain/memory/**` · `memory/**` · `persistence/**` · `domain/world/**` (all schemas) ·
`domain/quests/**` · `app/App.tsx` · `app/buildPromptGeneratedRoomSource.ts` ·
`app/detectsNpcRequest.ts` · `app/AdjacentRoomPregenerator.ts` · `room/GeneratedRoomSource.ts` ·
`renderer/RoomViewer.tsx` · `renderer/engine/**` · `world-session/**` · `interactions/**` ·
`encounters/**` · `server/**` · `eslint.config.js` · `package.json`.

---

## 8. Implementation slices

Each slice is independently shippable and independently testable. Do not merge slices.

---

**Slice 1 — Docs (this slice)**
`docs: add implementation plan for generated npc dialogue seed variety v0`

New file: this plan. No source code. Status: **complete** (this document).

---

**Slice 2 — `ensureGeneratedNpcPresence` deterministic seed variety**
`feat(domain): generated NPC seed variety — deterministic name/persona/greeting/prompt tables`

Modified: `ensureGeneratedNpcPresence.ts`, `ensureGeneratedNpcPresence.test.ts`.

Implements §3.1 and §4 in full, including the local `stableIndex` helper and all closed tables.
`themePack` is accepted as a new optional option on `EnsureGeneratedNpcPresenceOptions` in this
slice (not yet wired from `assembleRoom` — that's Slice 3), so this slice's tests call
`ensureGeneratedNpcPresence(room, { requested: true, themePack: 'fantasy-keep' })` etc. directly.

Tests:
- Determinism: same `room` + same `options` → identical NPC every call (extend the existing
  determinism test).
- Default bucket (`themePack: undefined`) across several different `room.id` fixtures yields more
  than one distinct name — i.e., it is no longer effectively always `'Mira'`.
- `themePack: 'fantasy-keep'` → persona/name/greeting from the `warden` bucket.
- `themePack: 'post-apoc'` → persona/name/greeting from the `survivor` bucket.
- Anchor present (e.g. an `altar` in the room) → prompt 1 label matches
  `ANCHOR_PROMPT_LINES.altar`.
- No anchor candidate in the room → prompt 1 label is exactly today's literal `'What do you
  notice here?'` (byte-identical fallback — regression guard).
- Prompt 2 label is always one of `HELP_PROMPT_LINES`, varying by `room.id`.
- Prompt ids remain exactly `'ask-room'` and `'ask-help'` in all cases.
- `interaction.prompt` / `interaction.body` always interpolate the selected name (existing
  template shape, extended to cover the new name pools).
- No-leak test (existing, extended): assert none of the new closed strings ever contain
  `room.name`, any other object's `id`, or any other object's `prompt`/`title`/`body`/`name`
  (trivially true by construction — regression guard kept).
- Purity/no-mutation test (existing) re-run unchanged — still passes, since the new logic reads
  but never writes `room`.
- Placement/collision tests (existing: spawn/exit/blocking-object avoidance, id-collision
  suffixing) re-run unchanged — this slice does not touch `findNpcPosition` or `nextNpcId`.

Verification: `npm run test -- ensureGeneratedNpcPresence`, `npm run lint`, `npm run build`

---

**Slice 3 — `assembleRoom` themePack threading**
`feat(domain): thread themePack into generated NPC insertion`

Modified: `assembleRoom.ts`, `assembleRoom.test.ts`.

One-line change at the existing Stage 2.12 call site (§3.2). No other stage, no diagnostics
change.

Tests:
- `assembleRoom(raw, fallback, { requestsNpc: true, themePack: 'post-apoc' })` inserts an NPC from
  the `survivor` bucket (asserted via the returned room's NPC object).
- `assembleRoom(raw, fallback, { requestsNpc: true })` (no `themePack`) inserts an NPC from the
  default `guide` bucket, still not hardcoded to `'Mira'` for every fixture (mirrors Slice 2's
  default-bucket variety assertion, exercised through the full pipeline this time).
- Existing `requestsNpc: true` / `requestsNpc: false` tests updated to match the new deterministic
  output for their fixed input fixtures (no behavior *regression* — just an updated expected
  literal where the old test hardcoded `'Mira'`).
- `RoomDiagnostics.npcInserted` boolean behavior is unchanged (still `true`/`false` exactly as
  before; no new diagnostic field).
- Full existing `assembleRoom.test.ts` suite (stage ordering, repair/fallback, alias/transform
  repair, spawn/exit repair, objective-target enrichment, display-text sanitization, mechanical
  gate diagnostic) re-run unchanged — this slice touches only the Stage 2.12 call arguments.

Verification: `npm run test -- assembleRoom`, `npm run lint`, `npm run build`

---

**Slice 4 — `NPCDialoguePanel` persona label map (if needed)**
`feat(ui): add role labels for generated NPC seed variety personas`

Modified: `NPCDialoguePanel.tsx`, `NPCDialoguePanel.test.tsx`.

Adds the two new `PERSONA_ROLE_LABELS` entries (§3.3). Purely additive to an existing `Record`;
no prop/behavior change to the component.

Tests:
- Rendering with `persona: 'generated-room-warden'` shows the new subtitle label.
- Rendering with `persona: 'generated-room-survivor'` shows the new subtitle label.
- Existing `persona: 'generated-room-guide'` case (subtitle `'Guide'`) still passes, unchanged.
- Existing authored-persona cases (`'friendly-aide'` → `'Ally'`, `'survivor'` → `'Survivor'`)
  still pass, unchanged — confirms no collision between the authored `'survivor'` persona string
  and this plan's new `'generated-room-survivor'` string.
- Unrecognized/absent persona still renders no subtitle (existing fallback behavior unchanged).

Verification: `npm run test -- NPCDialoguePanel`, `npm run lint`, `npm run build`

---

**Slice 5 — Docs closeout + manual smoke**
`docs: close generated npc dialogue seed variety v0`

No new production files. Update `docs/architecture/ARCHITECTURE.md` with a short "Generated Room
NPC Dialogue Seed Variety v0" status paragraph mirroring the existing feature-map style, citing
ADR-0066 if the ADR was added at this point.

Tests / checks:
- Full targeted regression: `dialogue`, `ensureGeneratedNpcPresence`, `assembleRoom`,
  `NPCDialoguePanel`.
- Grep-level sweep confirming `ensureGeneratedNpcPresence.ts` still imports no logger, no
  `platform/**`, no `react`/`three`, and performs no I/O (structural check, mirrors every prior
  domain-layer closeout in this repo).
- Manual smoke checklist (see §10).

Verification: `npm run test`, `npm run lint`, `npm run build`; manual smoke as below (not part of
CI).

---

## 9. Rollback / safety notes

- **Fully reversible in one commit.** All changes are additive/local to
  `ensureGeneratedNpcPresence.ts` (+1 line in `assembleRoom.ts`, +2 map entries in
  `NPCDialoguePanel.tsx`). Reverting Slice 2-4 restores byte-identical prior behavior; no data
  migration, no schema version bump, nothing persisted depends on the new tables.
- **No save/load impact.** Generated NPCs are not independently persisted — they are re-derived
  from `RoomSpec`/`WorldState` on load exactly as today (`ADR-0059`/`ADR-0060` restore paths
  re-run `loadRoomSpec`, not `ensureGeneratedNpcPresence`, so restored rooms already have their
  NPC object baked into the parked `RoomSpec` and are unaffected either way).
- **No cost/provider impact.** No new network call, no new usage-meter interaction.
- **Failure mode if a table lookup misses:** every lookup in §4 has an explicit, safe default
  (`ANCHOR_PROMPT_LINES[type] ?? <existing literal>`; bucket defaults to `'guide'` for any
  unrecognized/undefined `themePack`), so there is no code path that can throw or produce
  `undefined` display text — matching the "missing metadata degrades safely to generic, never
  Mira-only" requirement from the approved design.
- **Regression guard:** the existing "does not leak generated room or existing object text" and
  "does not mutate input room" tests in `ensureGeneratedNpcPresence.test.ts` are kept and extended,
  not replaced — any future change that accidentally reads room/object content will fail these
  tests immediately.

---

## 10. Manual smoke checklist

1. Prompt-generate a room with NPC-requesting language, no strong theme signal → NPC
   name/persona vary across a few different prompts/sessions (not always `'Mira'`); proximity + F
   still opens the dialogue panel with two authored prompt buttons.
2. Same, with a fantasy-keep-leaning prompt → `warden`-bucket name/persona/greeting.
3. Same, with a post-apoc-leaning prompt → `survivor`-bucket name/persona/greeting.
4. Generated room with a clear story anchor (e.g. an altar) present → first starter prompt
   references the anchor-appropriate line from `ANCHOR_PROMPT_LINES`.
5. Generated room with no story anchor → first starter prompt is the unchanged generic line.
6. Authored/demo room NPC dialogue (name, greeting, prompts) is byte-identical to before this
   change.
7. Continuing the conversation (`onSay`) still routes correctly by prompt id; no console errors;
   dev tools show no leaked room/object text, ids, or raw JSON in the panel.

---

## 11. Verification commands (full slice set)

```bash
# Slice 2
npm run test -- ensureGeneratedNpcPresence

# Slice 3
npm run test -- assembleRoom

# Slice 4
npm run test -- NPCDialoguePanel

# Every slice
npm run lint
npm run build

# Broader regression before calling the feature done
npm run test -- dialogue
npm run test
```

Run from `apps/web`. Prefer the targeted test commands per slice; run the full `npm run test`
only once at final closeout (Slice 5), per `AGENTS.md`'s "prefer targeted verification" rule.
