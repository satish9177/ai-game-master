# ADR-0067: Generated NPC Dialogue Spec v0

- **Status:** Implemented
- **Date:** 2026-07-02
- **Deciders:** Project owner
- **Extends:**
  [ADR-0040](./ADR-0040-generated-room-npc-presence-v0.md) (`ensureGeneratedNpcPresence`
  — this ADR co-locates a sibling normalizer in the same file and does not change
  that function's placement/collision/insertion logic),
  [ADR-0066](./ADR-0066-generated-npc-dialogue-seed-variety-v0.md) (the closed
  `NPC_PERSONAS`, `ANCHOR_PROMPTS`, `GENERIC_ROOM_PROMPTS`, `HELP_PROMPTS`,
  `stableIndex`, `selectFrom` tables/helpers — reused directly by co-location),
  [ADR-0048](./ADR-0048-generated-room-objective-target-enrichment-v0.md) (the
  `target.id ?? nextId(...)` collision-safe id-assignment pattern this ADR mirrors
  for NPC ids).
- **Related:** [ADR-0017](./ADR-0017-npc-dialogue-foundation-v0.md) (`NPCDialogueSpec`,
  `buildDialogueLookup`, `NPCDialoguePanel` — all unchanged; this ADR only ensures
  generated NPCs carry the data those consumers already require).

> Full pre-code design in the implementation plan
> [`generated-npc-dialogue-spec-v0`](../implementation-plans/generated-npc-dialogue-spec-v0.md).

> v0 closes a gap where a generator-emitted NPC with no `id` and/or no
> `interaction.dialogue` fell through to the plain `DialoguePanel` ("NPC nods
> quietly." / Close) instead of `NPCDialoguePanel`. A new pure sibling function,
> `ensureGeneratedNpcDialogue`, runs unconditionally in `assembleRoom` after
> `ensureGeneratedNpcPresence` and assigns a collision-safe `id` and/or a
> deterministic, closed-table `interaction.dialogue` to any generated-room NPC
> missing either. No provider/LLM call, no schema change, no `RoomViewer`/`App.tsx`/
> `NPCDialoguePanel` change.

---

## Context

`FakeRoomGenerator` (and the real provider prompt) can emit `npc` objects with
`interaction.body` but no `interaction.dialogue`, and with no `id` at all. Two
existing guards then combine to hide the NPC from real dialogue:

- `buildDialogueLookup` (`app/dialogue.ts`) skips any object where
  `!object.id || !interaction?.dialogue`.
- `RoomViewer` only looks up `npcDialogueLookupRef.current.get(target.id)` when
  `target.id` is truthy.

A dialogue-less and/or id-less generated NPC is therefore talkable in the sense
that `F` opens *a* panel, but only the plain `DialoguePanel` fallback — never the
greeting-plus-prompt-buttons `NPCDialoguePanel` that every other generated NPC
(e.g. one `ensureGeneratedNpcPresence` inserts) already gets.

`ensureGeneratedNpcPresence` (ADR-0040) only *inserts* one NPC when a room has
none and `requestsNpc` is set; it does not touch NPCs the generator already
emitted. This left a class of generated NPCs — including ones in adjacent rooms
generated without an explicit `requestsNpc` signal — permanently stuck on the
plain-panel fallback.

---

## Decision

### `ensureGeneratedNpcDialogue`

A new pure, synchronous sibling function, co-located in
`ensureGeneratedNpcPresence.ts` alongside the ADR-0040/ADR-0066 tables and
helpers it reuses:

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

For each object in `room.objects`, in order:

1. Non-`npc` objects pass through unchanged.
2. An `npc` object with `interaction.dialogue` already present passes through
   unchanged and is not counted.
3. Otherwise, if the object's `id` is missing or blank, a collision-safe id is
   assigned via `nextNpcIdFromIds` against the set of every non-blank id already
   present in `room.objects` plus every id assigned earlier in the same pass —
   base candidate `'generated-npc'` (the existing `GENERATED_NPC_BASE_ID`),
   suffixed `-2`, `-3`, … on collision. An NPC that already has a non-blank id
   keeps it byte-identical.
4. If `interaction.dialogue` is absent, a deterministic `NPCDialogueSpec` is
   built from the closed ADR-0066 `NPC_PERSONAS`/`ANCHOR_PROMPTS`/
   `GENERIC_ROOM_PROMPTS`/`HELP_PROMPTS` tables plus one new closed table,
   `NPC_DIALOGUE_GREETINGS` (nameless, per theme bucket, 2 entries each — no
   `{name}` interpolation, since the normalizer does not know or invent a name
   for an NPC the generator already named or left anonymous). The selection key
   is `${room.id}:${id}` so two NPCs in the same room get independent seeds.
   `npcDialogueNormalizedCount` increments only in this branch.
5. `interaction` itself is required by the validated generated-room `RoomSpec`
   NPC schema, so `ensureGeneratedNpcDialogue` operates on already-validated
   generated rooms and reads `object.interaction.dialogue` directly — it only
   normalizes missing/blank `id` and missing `interaction.dialogue`, not a
   missing `interaction`.

The function never mutates its input; it returns the same `room` reference
unchanged when nothing needed normalizing.

### Pipeline placement

`assembleRoom.ts` Stage 2.12.2, immediately after Stage 2.12
(`ensureGeneratedNpcPresence`) and before Stage 2.12.5 (objective target
enrichment):

```
Stage 2.12    ensureGeneratedNpcPresence   (insert one NPC when none + requestsNpc)
Stage 2.12.2  ensureGeneratedNpcDialogue   ← NEW, unconditional
Stage 2.12.5  ensureGeneratedObjectiveTarget
Stage 2.13    sanitizeGeneratedDisplayText
Stage 3       validateRoom
```

Unlike Stage 2.12, Stage 2.12.2 is **unconditional** — it is not gated by
`requestsNpc` and runs on every generated room, including adjacent-style rooms
generated without an explicit NPC request. This is required because a
generator-emitted NPC (not one `ensureGeneratedNpcPresence` inserted) can appear
in any generated room regardless of the `requestsNpc` signal.

`AssembleRoomOptions` gains no new field; the existing `options.themePack` is
threaded into `ensureGeneratedNpcDialogue` the same way it already threads into
`ensureGeneratedNpcPresence`.

### Diagnostic semantics

`RoomDiagnostics.npcDialogueNormalizedCount: number` — the count of NPCs that
received a **new dialogue spec** in this pass. It is not a count of id-only
fixes: an NPC that already had `interaction.dialogue` and only needed an `id`
assigned is not counted, matching the field's purpose of measuring how many NPCs
gained *new dialogue content* rather than how many objects were touched at all.
It is `0` on every fallback branch (`toFallback` for `json`/`schema` failures,
and the post-repair `fallback` branch), and present on all three result shapes
(`generated`, `repaired`, `fallback`).

---

## Final behavior

- A generated NPC with no `id` and no `interaction.dialogue` receives a
  collision-safe `id` and a deterministic closed-table `interaction.dialogue`.
- A generated NPC with an `id` but no `interaction.dialogue` receives dialogue
  and keeps its existing `id` byte-identical.
- A generated NPC with `interaction.dialogue` but no `id` receives an `id` and
  keeps its existing dialogue byte-identical; not counted in
  `npcDialogueNormalizedCount`.
- A generated NPC with both an existing `id` and existing dialogue is left
  completely unchanged.
- Every normalized generated NPC now enters `buildDialogueLookup` and opens
  `NPCDialoguePanel` (greeting + two prompt buttons) instead of falling through
  to the plain `body`/`Close` `DialoguePanel`.
- Prompt ids remain exactly `ask-room` and `ask-help` in every case, so
  `NPCDialogueService`, `FakeNPCDialogueProvider` reply routing, and
  `RoomViewer`'s `onSay(prompt.id)` wiring are unaffected.
- All dialogue-less generated NPCs are normalized in generated assembly — the
  normalizer runs unconditionally in `assembleRoom` Stage 2.12.2, after
  `ensureGeneratedNpcPresence` and before objective enrichment, on every
  generated room.
- Adjacent-style generated rooms (no `requestsNpc` signal) are covered by the
  same unconditional Stage 2.12.2 pass, since Stage 2.12.2 does not read
  `requestsNpc` at all.

---

## Safety boundaries

- **Deterministic only.** No randomness beyond the existing `stableIndex`
  FNV-1a-style hash keyed on `room.id` and the NPC's `id`; same room + same
  options → identical output every call.
- **Closed tables only.** `NPC_DIALOGUE_GREETINGS` is a new, finite,
  hand-written, `Object.freeze`d table with no `{name}` interpolation; persona
  and help-prompt content reuse the existing closed ADR-0066 tables unmodified.
- **Nameless greetings.** Unlike ADR-0066's insertion-time greetings, the
  normalizer's greeting table never interpolates a name — it operates on NPCs
  the generator already named (or left anonymous) and never invents or reads a
  name for dialogue text.
- **No provider/LLM involvement.** Entirely inside the existing deterministic
  domain/seed layer.
- **No free-text input, no click-to-talk.** Dialogue remains the existing
  proximity `F`-to-talk interaction with fixed starter prompts only.
- **No `WorldState` mutation.** `ensureGeneratedNpcDialogue` is a pure function
  over `LoadedRoom`; it has no reference to `WorldSession`/`WorldStore`/
  `WorldCommand`/`WorldEvent` and appends no event.
- **No memory writes.** No reference to `NpcMemoryService`/`RoomMemoryService`
  or their stores.
- **No schema/save-load/persistence change.** `NPCDialogueSpecSchema`,
  `RoomSpec.schemaVersion` (remains `1`), `SaveGame`, and every persistence
  adapter are untouched. Generated NPCs are still re-derived from `RoomSpec`/
  `WorldState` on load, not independently persisted.
- **No `RoomViewer`/`App.tsx`/`NPCDialoguePanel` changes.** Those consumers
  already handled `id` + `interaction.dialogue` correctly; this feature only
  ensures generated NPCs supply that data.
- **No leakage in generated dialogue seed text.** The normalizer never reads or
  emits raw room ids, object ids, room names, object names, generated
  descriptions, provider output, the user prompt, memory text, gate ids, or flag
  keys. Every string in `NPC_DIALOGUE_GREETINGS` (and the reused ADR-0066
  tables) is hand-written and closed; this is provable by construction and is
  additionally asserted by a dedicated no-leak regression test.

---

## Non-goals

- ❌ Any change to `ensureGeneratedNpcPresence`'s placement/id-collision/insertion
  logic — it remains byte-identical.
- ❌ `FakeRoomGenerator`, `OpenAICompatibleRoomGenerator`, or any provider.
- ❌ `dialogue/FakeNPCDialogueProvider.ts` or `dialogue/NPCDialogueService.ts` —
  `FakeNPCDialogueProvider` already falls through safely for any unrecognized
  persona (confirmed by ADR-0066 §2 and by this feature's own regression run), so
  no provider-side change was needed for the new personas/greetings this
  normalizer can produce.
- ❌ `domain/ports/NPCDialogueProvider.ts` or `domain/dialogue/**`.
- ❌ `renderer/RoomViewer.tsx`, `renderer/ui/NPCDialoguePanel.tsx`, `App.tsx`,
  `app/dialogue.ts` (`buildDialogueLookup`) — all already correct once an NPC has
  both `id` and `interaction.dialogue`.
- ❌ `domain/roomSpec.ts`, `domain/world/**`, or any schema.
- ❌ Save-load, persistence, memory, server, `eslint.config.js`, `package.json`.
- ❌ NPC `name`, `prompt`, `body`, `position`, scale, rotation — untouched by this
  normalizer.
- ❌ Existing `interaction.dialogue` — never overwritten.
- ❌ Existing object `id` — never changed, only assigned when absent/blank.
- ❌ Changing reply *content* — the goal is making generated NPCs reachable
  through `NPCDialoguePanel`, not changing what a reply says.

---

## Consequences

- Every generated-room NPC that is visible and has any `interaction` at all is
  now guaranteed to be fully talkable through `NPCDialoguePanel`, closing the
  plain-`DialoguePanel` fallback gap for both `requestsNpc`-inserted and
  generator-emitted NPCs, in both primary and adjacent generated rooms.
- `ensureGeneratedNpcPresence.ts` now hosts two related but independently
  triggered normalizers (insertion vs. completion) sharing the same closed
  tables — a natural extension point if a future slice needs richer generated
  dialogue variety; no new file or export surface was needed for v0.
- `npcDialogueNormalizedCount` gives future diagnostics/log-based monitoring a
  count-only signal for how often generated NPCs needed dialogue completion,
  without ever exposing which NPC or what room.

## Rollback

- Fully reversible in one revert: the new code is additive/local to
  `ensureGeneratedNpcPresence.ts` (`ensureGeneratedNpcDialogue`,
  `NPC_DIALOGUE_GREETINGS`, `nextNpcIdFromIds`, `isNonBlankString`, `buildNpcDialogue`,
  `selectPromptOneWithKey`) plus the single Stage 2.12.2 call and
  `npcDialogueNormalizedCount` field additions in `assembleRoom.ts`. Reverting
  restores the prior behavior exactly: generator-emitted dialogue-less/id-less
  NPCs fall back to the plain `DialoguePanel` again. Nothing persisted depends on
  the new field or table, since generated NPCs are re-derived from `RoomSpec`/
  `WorldState` on load rather than independently saved.
- No migration or schema rollback is needed — `schemaVersion` did not change.

## Testing / manual smoke

### Automated (targeted)

- `ensureGeneratedNpcPresence.test.ts` (`ensureGeneratedNpcDialogue` describe
  block) — id-less+dialogue-less NPC gets both; id-present/dialogue-absent NPC
  keeps its id and gains dialogue; dialogue-present/id-absent (including blank
  id) NPC gains an id and keeps dialogue byte-identical, not counted; NPC with
  both already present is unchanged and not counted; no-leak regression against
  room/object/provider/prompt/memory/gate/flag text; the product invariant that
  `buildDialogueLookup` sees at least one entry after normalizing a room with a
  dialogue-less NPC.
- `assembleRoom.test.ts` — generator NPC with no id/no dialogue gets both through
  the full pipeline; generator NPC with an id but no dialogue keeps its id;
  generator NPC with dialogue but no id keeps its dialogue; the adjacent-style
  path (no `requestsNpc`) still normalizes; an NPC with both already present is
  byte-identical; `npcDialogueNormalizedCount` is `0` on every fallback path; an
  `ensureGeneratedNpcPresence`-inserted NPC (which already carries dialogue) is
  not double-counted.
- Ran for this closeout:
  `npm.cmd run test -- ensureGeneratedNpcDialogue ensureGeneratedNpcPresence assembleRoom dialogue`
  (294 tests across 15 files, all passing), `npm.cmd run lint` (clean), and
  `npx.cmd tsc --noEmit -p .` (clean).

### Manual smoke checklist

1. Prompt-generate a room where the generator emits its own NPC (no explicit NPC
   request in the prompt) → walk up, press **F** → `NPCDialoguePanel` opens with
   a greeting and two prompt buttons. Plain `DialoguePanel` must not appear.
2. A generated NPC with no `id`/no dialogue is talkable exactly like any other
   generated NPC.
3. Navigate into an adjacent generated room containing a generator-emitted NPC →
   same result: **F** opens `NPCDialoguePanel`.
4. Click both starter prompt buttons → replies route normally; no console
   errors.
5. Authored/demo room NPC dialogue (name, greeting, prompts) is byte-identical
   to before this feature.
6. Dev tools / console show no raw ids, object or room names, slugs, or raw JSON
   in the `NPCDialoguePanel` for any generated NPC.

This checklist requires driving the running app in a browser and is **pending
maintainer verification** as of this ADR's closeout.
