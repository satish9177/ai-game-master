# ADR-0066: Generated NPC Dialogue Seed Variety v0

- **Status:** Implemented
- **Date:** 2026-07-02
- **Deciders:** Project owner
- **Extends:**
  [ADR-0040](./ADR-0040-generated-room-npc-presence-v0.md) (the boolean-only
  `requestsNpc` insertion path and `ensureGeneratedNpcPresence` — this ADR only varies the
  fixed template that function builds; the insertion/placement/id-collision logic is
  unchanged),
  [ADR-0044](./ADR-0044-generated-room-theme-vocabulary-v0.md) (`GeneratedRoomVisualTheme`
  — reused unmodified as the variety bucket key),
  [ADR-0034](./ADR-0034-generated-room-story-anchors-v0.md) (`selectGeneratedStoryAnchorIndex`
  — reused unmodified, called a second time at NPC-insertion with the same inputs it already
  ran with at composition time).
- **Related:**
  [ADR-0057](./ADR-0057-generated-story-threading-v0.md) — the precedent for using a
  structural id (`room.id`) as a safe, content-free deterministic selection key, and for
  keeping a small hashing helper local/self-contained rather than extracting a shared module.

> Full pre-code design in the implementation plan
> [`generated-npc-dialogue-seed-variety-v0`](../implementation-plans/generated-npc-dialogue-seed-variety-v0.md).

> v0 makes the single NPC that `ensureGeneratedNpcPresence` inserts into a
> prompt-generated room vary its **name, persona, greeting, body line, and two starter-prompt
> labels** deterministically, instead of always inserting the fixed `'Mira'` /
> `'generated-room-guide'` template. Selection reads only `room.id` (a structural id) and
> `options.themePack` (an existing closed enum) — never any room/object name, prompt, or
> generated free text. Prompt ids stay `ask-room` / `ask-help`. No provider/LLM call, no new
> randomness, no schema change.

---

## Context

`ensureGeneratedNpcPresence` (ADR-0040) inserted exactly one hardcoded NPC template whenever a
generated room requested one: name `'Mira'`, persona `'generated-room-guide'`, a fixed
greeting, and two fixed starter-prompt labels. Every generated NPC across every room and every
theme read identically, which made repeated NPC-requesting generation feel scripted/demo-like
rather than reactive to the room's theme or content.

This ADR keeps the function's safety shape exactly as ADR-0040 left it — pure, synchronous,
no I/O, insertion gated on the same `requested` boolean and the same "no existing NPC" guard —
and replaces the single constant template with a small deterministic builder that selects from
closed, hand-written tables.

---

## Decision

### Selection inputs (structural only)

- `room.id` — the validated `RoomSpec.id`, already relied on elsewhere for id-collision checks.
  Used only as a numeric hash key into closed tables, never read as content.
- `options.themePack?: GeneratedRoomVisualTheme` — the existing `'fantasy-keep' | 'post-apoc'`
  enum, now threaded one call further from `assembleRoom`'s Stage 2.12 site into
  `ensureGeneratedNpcPresence`. `undefined`/unrecognized values fall back to a `'default'`
  bucket.
- The room's existing derived story-anchor object **type** (via unmodified
  `selectGeneratedStoryAnchorIndex(room.objects, { themePack })`) — used only to pick a
  closed, type-keyed opening-prompt line; absent anchor falls back to a generic prompt pool.

No room name, object name, prompt/title/body text, generated description, provider output, or
memory text is read anywhere in the new code.

### Deterministic hashing

A local `stableIndex(input: string, modulo: number): number` (FNV-1a-style hash, mirrors the
existing `stableIndex`/hashing precedent in `FakeNPCDialogueProvider.ts` and
`generatedStoryThread.ts`) selects an index into a closed array. Every table lookup is total —
each selector always resolves to a valid array index — so there is no path that can return
`undefined` display text.

### Closed variety tables (`ensureGeneratedNpcPresence.ts`, local, hand-written)

- `NPC_NAMES` — per theme bucket (`default` / `fantasy-keep` / `post-apoc`), 3-4 names each.
- `NPC_PERSONAS` — per theme bucket, 2 persona strings each (e.g. `'generated-room-guide'`,
  `'generated-calm-witness'`, `'generated-keep-warden'`, `'generated-archive-aide'`,
  `'generated-wasteland-scout'`, `'generated-shelter-watch'`).
- `NPC_GREETINGS` / `NPC_BODIES` — per theme bucket, 2 template strings each with a `{name}`
  placeholder substituted after name selection.
- `ANCHOR_PROMPTS` — `Partial<Record<RoomObject['type'], readonly string[]>>`, keyed by the same
  anchor types ADR-0034 already recognizes (`throne`, `altar`, `statue`, `corpse`, `machine`,
  `artifact`, `chest`, `table`, `map`, `book`, `paper`).
- `GENERIC_ROOM_PROMPTS` — fallback pool when no anchor is present.
- `HELP_PROMPTS` — closed pool for the second starter prompt (`id: 'ask-help'`), theme-independent.

All tables are `Object.freeze`d, finite, and contain only hand-written strings — never
interpolated room/object content except the selected NPC's own generated `name`, which is
itself drawn from a closed table.

### Threading

- `EnsureGeneratedNpcPresenceOptions` gains one new optional field: `themePack?:
  GeneratedRoomVisualTheme`.
- `assembleRoom.ts` Stage 2.12 passes `themePack: options.themePack` into
  `ensureGeneratedNpcPresence` — the only change to that file.
- Prompt ids remain exactly `'ask-room'` and `'ask-help'` in every case, so
  `NPCDialogueService`, `FakeNPCDialogueProvider` reply routing, and `RoomViewer`'s
  `onSay(prompt.id)` wiring are unaffected.
- `NPCDialoguePanel.tsx`'s existing `PERSONA_ROLE_LABELS` map gains entries for every new
  persona string so each bucket's NPC gets a cosmetic subtitle; unrecognized personas still
  render no subtitle (existing fallback, unchanged).

---

## Architectural rules (binding)

1. **`ensureGeneratedNpcPresence` stays pure and synchronous.** No I/O, no logger, no
   randomness beyond the deterministic hash, no mutation of the input room.
2. **No content-derived selection.** Only `room.id` (structural id) and `options.themePack`
   (closed enum) and the anchor **type** (closed enum, already-derived) drive selection —
   never room name, object name, prompt/title/body text, or any generated free text.
3. **Prompt ids are structural and unchanged.** `'ask-room'` / `'ask-help'` never vary; only
   `label` text varies.
4. **Every table lookup is total.** Bucket defaults to `'default'` for any
   unrecognized/undefined `themePack`; anchor-prompt lookup falls back to
   `GENERIC_ROOM_PROMPTS` when no anchor type matches. No lookup can produce `undefined`
   display text or throw.
5. **No schema change.** `NPCDialogueSpecSchema`, `RoomSpec.schemaVersion`, and every other
   schema are unchanged.
6. **No change to placement/collision/id-collision logic.** `findNpcPosition`, `nextNpcId`,
   `GENERATED_NPC_BASE_ID`, `GENERATED_NPC_COLOR`, `NPC_BLOCKING_TYPES` are untouched.
7. **Authored/demo NPCs are unaffected.** `ensureGeneratedNpcPresence` only ever builds a
   template when `room.objects.some(o => o.type === 'npc')` is false — the same guard as
   before this ADR.
8. **`NPCDialoguePanel` persona labels remain a closed, hand-written map.** New entries are
   additive UI subtitle text only; not derived from generated content.
9. **No provider/LLM involvement, no typed free-text input, no click-to-talk.** This ADR is
   entirely inside the existing deterministic domain/seed layer and the existing F-to-talk
   proximity interaction.
10. **No memory/schema/persistence/save-load change, no `WorldState` mutation from dialogue.**
    Generated NPCs are still re-derived from `RoomSpec`/`WorldState` on load, not
    independently persisted.

---

## Scope (v0)

**In scope (implemented):**

- Slice 1 — implementation plan (docs only). **Complete.**
- Slice 2 — `ensureGeneratedNpcPresence.ts` deterministic seed variety: `themePack` option,
  `buildNpcTemplate`, closed tables, local `stableIndex`. **Complete, approved.**
- Slice 3 — `assembleRoom.ts` threads `themePack` into the Stage 2.12
  `ensureGeneratedNpcPresence` call. **Complete, approved.**
- Slice 4 — `NPCDialoguePanel.tsx` `PERSONA_ROLE_LABELS` entries for the new persona strings.
  **Complete, approved.**
- Slice 5 — this ADR + docs closeout + manual smoke checklist. **Complete (this document).**

**Out of scope / non-goals (not built):**

- ❌ Provider/LLM involvement of any kind (fake or real) in seed selection.
- ❌ Any change to `dialogue/FakeNPCDialogueProvider.ts`, `dialogue/NPCDialogueService.ts`,
  `domain/ports/NPCDialogueProvider.ts`, `domain/dialogue/**`,
  `generation/OpenAICompatibleNPCDialogueProvider.ts`.
- ❌ Use of `storyKind` for variety (accepted as an unread pass-through only — not reachable
  when `requestsNpc` is true today, per ADR-0057's adjacent-room-only `storyKind` attachment).
- ❌ Use of `room.name`, any object's `name`, `prompt`, `title`, or `body` text as a variety
  source.
- ❌ Typed free-text input, click-to-talk/raycast selection.
- ❌ Any change to prompt ids (`ask-room`, `ask-help` stay fixed).
- ❌ Any change to `GENERATED_NPC_BASE_ID`, id-collision logic, or placement/collision logic.
- ❌ Any schema, `RoomViewer.tsx`, `App.tsx`, save/load, persistence, or memory change.
- ❌ Any regression to authored/demo NPC dialogue.

---

## Safety boundaries

- **Closed tables only.** `NPC_NAMES`, `NPC_PERSONAS`, `NPC_GREETINGS`, `NPC_BODIES`,
  `ANCHOR_PROMPTS`, `GENERIC_ROOM_PROMPTS`, `HELP_PROMPTS` are finite, hand-written,
  `Object.freeze`d constants local to `ensureGeneratedNpcPresence.ts`.
- **Structural inputs only.** Selection reads `room.id`, `options.themePack`, and the safe
  object **type** of the derived story anchor — nothing else from room/object state.
- **No leakage in visible generated NPC seed text.** The inserted NPC's name, persona,
  greeting, body, and prompt labels never contain raw prompt text, user text, generated
  descriptions, object names, room names, object ids, gate ids, flag keys, provider output, or
  memory text. This is provable by construction (every string comes from a closed table) and is
  additionally asserted by the existing, extended "does not leak generated room or existing
  object text" regression test.
- **`NPCDialoguePanel` persona labels are closed-map only.** `PERSONA_ROLE_LABELS` is a fixed
  `Record<string, string>`; unrecognized personas render no subtitle.
- **Gameplay subtitle rendering stays inert.** `NPCDialoguePanel` already accepts a `persona`
  prop and renders a subtitle when recognized; `RoomViewer` does not currently pass `persona`
  into any other gameplay surface, so this ADR does not change what is visible beyond the
  dialogue panel itself. Wiring persona into any other UI remains a future, separately
  approvable feature.

---

## Testing / manual smoke

### Automated (targeted)

- `ensureGeneratedNpcPresence.test.ts` — determinism, default-bucket variety (no longer always
  `'Mira'`), per-theme-bucket selection, anchor-present vs. anchor-absent prompt-1 fallback,
  prompt-2 variety, prompt ids fixed, no-leak/purity/placement regressions extended and kept
  green.
- `assembleRoom.test.ts` — `themePack` threading produces the matching bucket's NPC through the
  full pipeline; `RoomDiagnostics.npcInserted` boolean behavior unchanged; full existing suite
  re-run unchanged.
- `NPCDialoguePanel.test.tsx` — new persona strings render their new subtitle; existing
  authored-persona and `generated-room-guide` cases unchanged; unrecognized persona still
  renders no subtitle.

### Manual smoke checklist

1. Generate several NPC-requesting rooms with no strong theme signal → NPC name/persona vary
   across prompts/sessions (not always `'Mira'`); proximity + `F` still opens the dialogue
   panel with two prompt buttons.
2. Fantasy-leaning prompt → NPC name/persona/greeting come from the `fantasy-keep` bucket.
3. Post-apoc-leaning prompt → NPC name/persona/greeting come from the `post-apoc` bucket.
4. Prompt buttons still work — clicking either starter prompt produces a reply.
5. Prompt ids route correctly — `ask-room` and `ask-help` map to the expected reply content via
   `onSay(prompt.id)`; no id/content mismatch.
6. Authored/demo NPC dialogue (name, greeting, prompts) is byte-identical to before this
   change.
7. No raw ids, slugs, room/object names, or raw JSON are visible in the dialogue panel or dev
   console for any generated NPC.

---

## Consequences

- Generated NPC dialogue seeds now read as reactive to room theme and content instead of
  scripted/identical every time, with zero new safety surface — the change is entirely inside
  an already-pure, already-tested domain function.
- The theme-bucket variety pattern (`'default'` / `'fantasy-keep'` / `'post-apoc'` closed
  tables keyed by `room.id` hash) is now a second precedent, alongside ADR-0057's story-thread
  seed tables, for adding deterministic flavor text without a provider call. Future slices
  needing similar variety (e.g. richer anchor-prompt phrasing, more theme buckets) can extend
  these tables directly.
- `PERSONA_ROLE_LABELS` in `NPCDialoguePanel.tsx` must be kept in sync with `NPC_PERSONAS` if
  either table's persona strings change; this is a manual, not enforced, consistency
  requirement (no test currently asserts full table coverage).

## Rollback

- Fully reversible in one revert: all changes are additive/local to
  `ensureGeneratedNpcPresence.ts` (+ one line in `assembleRoom.ts`, + persona-label entries in
  `NPCDialoguePanel.tsx`). Reverting restores the prior byte-identical `'Mira'`/
  `'generated-room-guide'` template; nothing persisted depends on the new tables, since
  generated NPCs are re-derived from `RoomSpec`/`WorldState` on load rather than independently
  saved.
- No migration or schema rollback is needed — no schema version changed in this feature.
