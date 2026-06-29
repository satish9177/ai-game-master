# ADR-0055: Generated Room Entry Intro Polish v0 — presentation-layer room-name normalization

- **Status:** Implemented
- **Date:** 2026-06-29
- **Deciders:** Project owner
- **Extends:**
  [ADR-0035](./ADR-0035-room-inspect-summary-v0.md) (Room Inspect Summary v0 — `buildRoomSummary`,
  `RoomIntroPanel`, `buildRoomIntroView`),
  [ADR-0042](./ADR-0042-generated-room-display-sanitization-v0.md) (Generated Room Display
  Sanitization v0 — `sanitizeGeneratedDisplayText`, `SAFE_ROOM_NAME`).
- **Related:**
  [ADR-0010](./ADR-0010-generation-foundation-v0.md) (Generation Foundation v0 —
  `FakeRoomGenerator`, raw text output, trust pipeline),
  [ADR-0022](./ADR-0022-world-bible-seed-v0.md) (World Bible Seed v0 — `worldBibleToGeneratorSeed`,
  title-first ≤160-char seed format).

> Full pre-code design in the implementation plan
> [`generated-room-entry-intro-polish-v0`](../implementation-plans/generated-room-entry-intro-polish-v0.md).

---

## Context

Room Inspect Summary v0 (ADR-0035) surfaces a brief deterministic observational summary at every
room entry as a dismissible intro panel. The summary opens with the clause:

```
You enter the <roomName>.
```

where `roomName` comes directly from `LoadedRoom.name` via the `withArticle` helper in
`domain/roomSummary.ts`.

For authored/demo/fallback rooms, names like `"Throne Room"`, `"Ransacked Safe House"`, and
`"A quiet stone antechamber"` produce natural, readable output. For **generated rooms**,
`FakeRoomGenerator` sets:

```ts
name: label ? `Generated room — ${label}` : 'Generated room'
// label = clampPrompt(prompt, 60)
// prompt is the worldBibleToGeneratorSeed projection, e.g. "post-apoc | tense | survivors"
```

This produces an intro like:

> You enter the Generated room — post-apoc | tense | survivors.

The player-facing text leaks:

- The literal string `"Generated room"` — an implementation marker, not a narrative name.
- The raw generator seed tags (theme enum, tone keywords, world-bible keywords separated by ` | `).

The existing `sanitizeGeneratedDisplayText` (ADR-0042) does **not** fix this: it only rewrites
`room.name` when the name contains a `gen-xxxxxxxx` structural id pattern. The fake's name has
no structural id, so it passes through untouched.

The real provider receives a prompt that asks for a natural room name, so real-generated names are
already clean prose. This leak is **fake-specific** and always identifiable by the literal prefix
`"Generated room"`.

The object-clause body of the summary is already safe: it reads only validated `RoomObject['type']`
values through a closed `NOUNS` table and never reads `object.name`, `interaction.*`, skipped
objects, or raw JSON. That path is unchanged.

---

## Decision

**Normalize the room-name clause in `buildRoomSummary` with a small pure helper.** No generation,
schema, pipeline, provider, wiring, or state changes.

### Core rule

Add a pure exported function `introRoomNoun(roomName: string): string` in
`domain/roomSummary.ts`. Replace the `withArticle(roomName)` call in `buildSummaryText` with
`introRoomNoun(roomName)`.

### Normalization rules (ordered, first match wins)

1. `trimmed = roomName.trim()`. If `trimmed` is empty → return `'the room'`.
2. If `trimmed` matches `/^generated room\b/i` → return `'the room'`.
   - Covers the bare constant `"Generated room"` (from `SAFE_ROOM_NAME` and from `sanitizeGeneratedDisplayText`'s fallback).
   - Covers the fake's full marker `"Generated room — post-apoc | tense | survivors"`.
   - Does **not** affect authored names that happen to begin with a lowercase `generated`.
3. If `trimmed` contains `|` → take the text before the first `|`, trim it, and apply
   `withArticle` to that segment. If the segment is empty → return `'the room'`.
   - Covers `"Ashfall Market | post-apoc | grim"` → `"the Ashfall Market"`.
   - The ` | `-joiner is the `worldBibleToGeneratorSeed` field separator; it never appears in
     authored or fallback names.
4. Otherwise → return `withArticle(trimmed)` (authored/real-generated names unchanged).

### Why name-shape scoping instead of an explicit provenance flag

Threading `provenance` from `GeneratedRoomSource` through `buildRoomIntroView` →
`AppRoomIntro` → `AppRoomEntryOverlay` would require new plumbing in at least four files for
no safety gain. The name-shape rules are:

- **Self-contained and purely domain-testable.** `introRoomNoun` has no App, React, or state
  dependency.
- **Provably correct for all authored names.** Authored/fallback names (`"Throne Room"`,
  `"Ransacked Safe House"`, `"A quiet stone antechamber"`) provably do not start with
  `"Generated room"` (case-insensitive) and contain no ` | ` separator.
- **Consistent with the existing sanitizer constant.** `SAFE_ROOM_NAME = 'Generated room'`
  (ADR-0042) uses the same literal prefix. The two are now complementary: the sanitizer
  rewrites names that contain structural ids; this normalizer handles the intro clause for
  names that carry the generator marker or seed tags.

### Rule 3 em-dash scoping

Rule 2 catches names starting with `"Generated room"` including the ` — ` variant. Rule 3
(the `|` split) is intentionally **not** applied globally: legitimate authored names like
`"Ashfall Market — South Gate"` should pass through unchanged to rule 4 (`withArticle`).
Only ` | ` (pipe) is the generator seed separator; ` — ` without the `"Generated room"` prefix
is treated as a normal part of the name.

---

## Architectural rules (binding)

1. **Pure function, no I/O.** `introRoomNoun` has no logger, React, Three.js, DB, network, or
   state access. It returns a string deterministically from a string.
2. **No `RoomSpec` schema change.** `schemaVersion` remains `1`. No new field.
3. **No generation or provider change.** `FakeRoomGenerator`, `OpenAICompatibleRoomGenerator`,
   `llmRoomPrompt.ts`, and all prompt text are unchanged.
4. **No pipeline change.** `assembleRoom`, `sanitizeGeneratedDisplayText`, `validateRoom`,
   `repairRoom`, layout normalizers, composition, NPC presence, objective enrichment —
   all untouched.
5. **No App/UI wiring change.** `buildRoomIntroView`, `AppRoomIntro`, `AppRoomEntryOverlay`,
   `RoomIntroPanel`, and `roomIntroPanelState` are unchanged.
6. **No new diagnostics or logging.** The helper never logs anything; it returns data.
7. **No raw generated text may appear in the intro clause.** The rule set above is the
   exhaustive guarantee: rule 2 strips the marker, rule 3 strips seed tags, rules 1 and 4
   either return a safe constant or delegate to `withArticle` which handles only the article
   prefix, never content.
8. **Authored/fallback/demo behavior is byte-identical to today.** The four rules are proven
   by tests to pass authored and fallback names through unchanged.

---

## Scope (v0)

**In scope:**

- `introRoomNoun(roomName: string): string` — new pure exported function in
  `domain/roomSummary.ts`.
- One-line change in `buildSummaryText`: replace `withArticle(roomName)` with
  `introRoomNoun(roomName)`.
- Deterministic Vitest cases for `introRoomNoun` in `domain/roomSummary.test.ts`.
- ADR and implementation plan docs.
- One line in `ARCHITECTURE.md` status legend (planned → implemented on closeout).

**Out of scope / non-goals:**

- ❌ `"You return…"` revisit messaging (future slice; requires navigation visit-tracking state).
- ❌ LLM call for intro text generation.
- ❌ Provider prompt changes.
- ❌ `RoomSpec` schema field for display name.
- ❌ `FakeRoomGenerator` name change (the name is a data output of the trusted pipeline; it is
  sanitized at presentation, not at generation).
- ❌ Provenance flag threading through App/UI.
- ❌ New App/renderer/wiring change.
- ❌ New diagnostics, logging surface, or state store.
- ❌ Changes to `sanitizeGeneratedDisplayText` (it is not weakened; this feature layers above it).

---

## Data model

No new schema. No new type. `introRoomNoun` and the updated `buildSummaryText` are the only code
additions. `RoomSummary` shape is unchanged.

---

## Files likely to change

- **Edited:** `apps/web/src/domain/roomSummary.ts` — `introRoomNoun` + wire into `buildSummaryText`.
- **Edited:** `apps/web/src/domain/roomSummary.test.ts` — new cases for `introRoomNoun`.
- **New:** `docs/architecture/decisions/ADR-0055-generated-room-entry-intro-polish-v0.md` (this file).
- **New:** `docs/architecture/implementation-plans/generated-room-entry-intro-polish-v0.md`.
- **Edited:** `docs/architecture/ARCHITECTURE.md` — status legend entry.

## Files NOT to change

`generation/**` · `domain/roomSpec.ts` · `domain/assembleRoom.ts` · `domain/validateRoom.ts` ·
`domain/repairRoom.ts` · `domain/generatedRoom*.ts` · `domain/sanitizeGeneratedDisplayText.ts` ·
`app/roomIntro.ts` · `renderer/ui/RoomIntroPanel.tsx` · `renderer/ui/roomIntroPanelState.ts` ·
`App.tsx` (entry overlay) · `world-session/**` · `interactions/**` · `encounters/**` ·
`dialogue/**` · `memory/**` · `persistence/**` · `server/**` · `renderer/engine/**` ·
`eslint.config.js` · `package.json`

---

## Tests (Vitest, co-located, deterministic)

All cases are in `domain/roomSummary.test.ts`. No DOM, no React, no network.

```
introRoomNoun
  ✓ empty string → 'the room'
  ✓ whitespace-only → 'the room'
  ✓ 'Generated room' (bare constant) → 'the room'
  ✓ 'generated room' (all-lowercase) → 'the room'
  ✓ 'Generated Room' (title-case) → 'the room'
  ✓ 'Generated room — post-apoc | tense | survivors' → 'the room'
  ✓ 'Generated room — fantasy-keep | grim | dungeon' → 'the room'
  ✓ 'Ashfall Market | post-apoc | grim' → 'the Ashfall Market'
  ✓ 'Throne Room' → 'the Throne Room' (unchanged)
  ✓ 'A quiet stone antechamber' → 'A quiet stone antechamber' (article already present, unchanged)
  ✓ 'Ransacked Safe House' → 'the Ransacked Safe House' (unchanged)
  ✓ 'Ashfall Market — South Gate' → 'the Ashfall Market — South Gate' (em-dash preserved)

buildRoomSummary (end-to-end regression for the intro clause)
  ✓ room named 'Generated room — post-apoc | tense | survivors' → text starts 'You enter the room.'
  ✓ above text does NOT contain 'Generated room', 'post-apoc', 'tense', 'survivors', '|', or '—'
  ✓ room named 'Generated room' → text starts 'You enter the room.'
  ✓ room named 'Throne Room' → text contains 'You enter the Throne Room.'
  ✓ authored/fallback rooms → not-throw, intro text unchanged
  ✓ existing object-summary no-leak tests still pass (no regression)
```

---

## Failure modes

| Situation | Handling |
| --- | --- |
| `room.name` is empty or whitespace | Returns `'the room'` (rule 1). |
| Marker name arrives post-sanitizer as bare `'Generated room'` | Caught by rule 2. |
| Real-provider room with natural prose name | Passes to rule 4 (`withArticle`); unchanged. |
| Authored name containing `|` by accident | Rule 3: leading segment kept; trailing tags dropped. This is intentional — ` \| ` is the generation separator and should not appear in authored names; documented in ADR. |
| Fallback room name `'A quiet stone antechamber'` | Article already present; `withArticle` returns unchanged; rule 4. |

---

## Consequences

- Generated-room entry intro no longer leaks `"Generated room"` or seed tags.
- The intro degrades gracefully to `"You enter the room."` when no natural name is available.
- Authored, demo, fallback, and real-provider prose names produce exactly the same intro as today.
- The pipeline and schema are unchanged; the fix is a two-line change inside one pure function.
- `sanitizeGeneratedDisplayText` is not weakened; the two mechanisms are complementary.

## Alternatives considered

- **Thread `provenance` through App → buildRoomIntroView → RoomIntroPanel** — rejected: four-file
  plumbing change for no safety gain over name-shape scoping; `introRoomNoun` is self-contained
  and unit-testable with zero wiring.
- **Fix `FakeRoomGenerator` to emit a natural name** — rejected: the fake name is an output of
  the data pipeline (not a presentation bug at generation time). The name is valid `RoomSpec` data;
  fixing it there would silently break any test that asserts the deterministic name, and the real
  provider already produces natural names. Presentation normalization is the right layer.
- **Add a `displayName` field to `RoomSpec`** — rejected: schema change for a presentation
  concern; `schemaVersion` would need bumping; adds maintenance surface. The existing `name` field
  already carries the intended name; we only need to normalize how it appears in this one clause.
- **`"You return…"` messaging for revisits** — deferred: requires visit-count state in
  `buildRoomIntroView`; out of scope for this presentation-only slice.
