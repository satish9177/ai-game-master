# ADR-0057: Generated Story Threading v0 — closed-enum thread context for adjacent generated rooms

- **Status:** Accepted — implemented
- **Date:** 2026-06-30
- **Implemented:** 2026-06-30
- **Deciders:** Project owner
- **Extends:**
  [ADR-0043](./ADR-0043-adjacent-room-theme-continuity-v0.md) (Adjacent Room Theme Continuity v0 —
  the `worldBibleToAdjacentThemeSeed` projection pattern and `buildAdjacentRoomSeed` seam this
  feature extends),
  [ADR-0022](./ADR-0022-world-bible-seed-v0.md) (World Bible Seed v0 — the `WorldBibleSeed` closed
  schema and `openingArc.pattern` closed enum used as the thread spine)
- **Related:**
  [ADR-0032](./ADR-0032-generated-room-composition-v0.md) (Generated Room Composition v0 —
  `composeGeneratedRoom` and the anchor-priority seam extended in Slice 3),
  [ADR-0034](./ADR-0034-generated-room-story-anchors-v0.md) (Generated Room Story Anchors v0 —
  the existing anchor selector that Slice 3 adds a story-kind bias to),
  [ADR-0044](./ADR-0044-generated-room-theme-vocabulary-v0.md) (Generated Room Theme Vocabulary v0 —
  the `themePack`-based anchor priority that `storyKind` overrides when both are present)

> Full pre-code design in the implementation plan
> [`generated-story-threading-v0`](../implementation-plans/generated-story-threading-v0.md).

> Implemented in three source slices plus docs closeout: Slice 1 added the pure
> `generatedStoryThread` domain contract, Slice 2 wired the bounded adjacent seed
> phrase, and Slice 3 added closed story-kind composition anchor bias.

---

## Context

Adjacent generated rooms share a theme vocabulary (ADR-0043) and layout composition (ADR-0032),
but they still feel like isolated, unrelated rooms: each is seeded only with
`themePack | tone | keywords | adjacent:${roomId}`. The `FakeRoomGenerator` produces different
rooms for different seeds, but rooms carry no narrative relationship to each other or to the first
prompt-generated room.

`WorldBibleSeed.openingArc` (ADR-0022) already holds a story spine: a closed five-value `pattern`
enum (`escape | investigate | survive | rescue | recover-item`) plus bounded free-text arc fields
(`hook`, `firstObjective`, `pressure`). ADR-0043 deliberately excluded the entire `openingArc`
from the adjacent seed because the **arc fields are free text** and could carry prompt-shaped
narrative content.

The `pattern` field is structurally different: it is a **closed enum with exactly five safe
values**, no user-authored prose, and derivable with one lookup. Using it as a closed generation
hint is structurally identical to using `themePack` — and ADR-0043 already uses `themePack`
safely. This ADR explicitly re-uses only `pattern` and re-confirms the exclusion of all other
`openingArc` fields.

Additionally, structural adjacent room ids encode positional depth: each `:exit:<side>` segment
added to the id represents one hop further from the origin room. This depth is a deterministic,
pure structural fact — not a stored state value, not authoritative truth.

Together, `openingArc.pattern` (kind) and structural depth (role) give enough closed-enum
context to:

1. **Slice 2** — Prepend a bounded, closed-vocabulary story phrase to the adjacent fake generator
   seed, nudging the deterministic `FakeRoomGenerator` toward thread-consistent flavoring.
2. **Slice 3** — Bias the story anchor priority in `composeGeneratedRoom` to prefer objects that
   fit the thread kind (e.g., an `investigate` run prefers a book or map as its focal object over
   a throne), making the rooms read as part of the same narrative arc.

---

## Decision

### Core rule

**No new LLM call. No `RoomSpec` schema change. No world/memory/objective mutation. Generated
adjacent rooms only.**

A new pure domain module (`domain/generatedStoryThread.ts`) derives a closed
`GeneratedStoryRoomContext` from two already-available inputs: the closed `openingArc.pattern`
enum and the structural adjacent `roomId`. The context is projected into a bounded seed phrase
(Slice 2) and an optional anchor-priority bias for composition (Slice 3). It never enters
`LoadedRoom`, save-game, backend, or any authoritative state.

---

### Boundary clarification — ADR-0043 `openingArc` exclusion

ADR-0043 excluded `openingArc` from adjacent seeds. That exclusion was correct for the **free-text
arc fields**: `hook`, `firstObjective`, `pressure`, `premise`, `title`, `majorConflict`,
`canonNotes`, `startingLocation`, `npcs`, `factions`, `locations` all carry user-authored or
generated prose and must remain excluded.

**This feature re-introduces only `openingArc.pattern` — a closed enum.** The exclusion of every
other `openingArc` field and every other free-text `WorldBibleSeed` field is re-confirmed as a
binding safety rule below and in the implementation plan.

---

### New closed types (`domain/generatedStoryThread.ts`)

```ts
// 1:1 with WorldBibleSeed.openingArc.pattern — the thread spine.
export type GeneratedStoryThreadKind =
  | 'escape'
  | 'investigate'
  | 'survive'
  | 'rescue'
  | 'recover-item'

// Position in the thread, derived from structural :exit: depth in the roomId.
// threshold = depth 1 (one hop), developing = depth 2–3, deeper = depth 4+.
export type GeneratedStoryRoomRole = 'threshold' | 'developing' | 'deeper'

// Pressure band derived from role only — no free text.
export type GeneratedStoryPressure = 'steady' | 'rising' | 'high'

export type GeneratedStoryRoomContext = {
  kind: GeneratedStoryThreadKind
  role: GeneratedStoryRoomRole
  pressure: GeneratedStoryPressure
}
```

`GeneratedStoryBeat` (per-step beat sequences) is intentionally omitted: beat sequencing implies
stored progression state, which edges toward a quest engine. Role derived from structural depth
achieves "further in the thread feels different" without any state.

---

### Pure derivation functions

```ts
/**
 * Derive thread context from the closed kind and the structural room id.
 * Returns undefined when kind is undefined (no WorldBible or seeding failure).
 * Reads only: kind (closed enum) and roomId (structural string for depth count).
 * Never reads: arc free text, prompt text, generated content, object ids, flags.
 */
export function deriveStoryThreadContext(
  kind: GeneratedStoryThreadKind | undefined,
  roomId: string,
): GeneratedStoryRoomContext | undefined

/**
 * Project thread context to a bounded, closed-vocabulary seed phrase.
 * Source: a hand-written finite table keyed on (kind, role). No runtime
 * interpolation of content values; never reads arc text or generated content.
 * Length bounded by MAX_STORY_PHRASE_LENGTH (≤ 50 chars).
 */
export function storyThreadToSeedPhrase(ctx: GeneratedStoryRoomContext): string
```

**Role derivation (pure, structural):** count occurrences of `:exit:` in `roomId`. 1 →
`threshold`, 2–3 → `developing`, 4+ → `deeper`. 0 (flat / non-structural id) → `threshold`
as a safe default (authored rooms never enter this path).

**Pressure derivation (pure, from role only):** `threshold → steady`, `developing → rising`,
`deeper → high`.

**Seed phrase table (hand-written, closed vocabulary):**

| kind | threshold | developing | deeper |
| --- | --- | --- | --- |
| `escape` | `'escape route \| first obstacle'` | `'escape route \| building pressure'` | `'escape route \| critical path'` |
| `investigate` | `'investigation \| early clues'` | `'investigation \| gathering evidence'` | `'investigation \| close to the truth'` |
| `survive` | `'survival \| first threat'` | `'survival \| escalating danger'` | `'survival \| desperate stage'` |
| `rescue` | `'rescue mission \| early search'` | `'rescue mission \| closing in'` | `'rescue mission \| final approach'` |
| `recover-item` | `'recovery \| early search'` | `'recovery \| tracking the target'` | `'recovery \| nearly there'` |

---

### Slice 2 — Adjacent seed wiring

`buildAdjacentRoomSeed` gains an optional third parameter `storyPhrase?: string`. Composition
order when segments are present:

```
theme | storyPhrase | adjacent:${roomId}
```

Any absent segment is omitted. The tail `adjacent:${roomId}` is always present.

In App.tsx, inside the existing per-adjacent `RoomSourceFactory` closure:

1. `kind` is read from `prepared.worldBible?.openingArc.pattern` — captured once per session, a
   closed enum value from an already-validated `WorldBibleSeed`.
2. `deriveStoryThreadContext(kind, roomId)` is called per adjacent id.
3. `storyThreadToSeedPhrase(ctx)` produces the phrase when context is defined.
4. The phrase is passed to `buildAdjacentRoomSeed(roomId, adjacentThemeSeed, storyPhrase)`.

No new React state, ref, or effect. `kind` is captured in the same closure scope that already
captures `adjacentThemeSeed`.

---

### Slice 3 — Composition anchor bias

`ComposeGeneratedRoomOptions` gains an optional `storyKind?: GeneratedStoryThreadKind`.
`AssembleRoomOptions` gains the same optional field and threads it to composition.

`selectGeneratedStoryAnchorIndex` uses story-kind–specific priority tables when `storyKind` is
present, falling back to the existing theme-pack priority when absent. Story-kind takes
precedence over theme-pack when both are supplied.

**Story-kind anchor priority tables (hand-written, closed):**

| kind | priority order (lower = preferred) |
| --- | --- |
| `investigate` | `book/map/paper` (0) › `chest` (1) › `corpse` (2) › `artifact` (3) › `machine` (4) › `table` (5) › `statue` (6) › `altar` (7) › `throne` (8) |
| `recover-item` | `chest` (0) › `artifact` (1) › `map` (2) › `book/paper` (3) › `table` (4) › `machine` (5) › `corpse` (6) › `statue` (7) › `altar` (8) › `throne` (9) |
| `survive` | `corpse` (0) › `machine` (1) › `artifact` (2) › `chest` (3) › `table/map/book/paper` (4) › `statue` (5) › `altar` (6) › `throne` (7) |
| `rescue` | `statue` (0) › `throne` (1) › `altar` (2) › `corpse` (3) › `chest` (4) › `artifact` (5) › `machine` (6) › `table/map/book/paper` (7) |
| `escape` | *(falls back to theme-pack or default priority — forward movement is exit-based, not anchor-based)* |

In App.tsx, the same per-adjacent `RoomSourceFactory` closure passes `storyKind` in
`AssembleRoomOptions` using the `kind` already captured for the seed phrase.

---

### Safety rules (binding)

1. **Only `openingArc.pattern` is read from `WorldBibleSeed.openingArc`.** The fields `hook`,
   `firstObjective`, `pressure`, and all other arc fields are never read, included in seeds,
   logged, or passed to any function.
2. **No other free-text `WorldBibleSeed` field is used.** `premise`, `title`, `majorConflict`,
   `canonNotes`, `startingLocation`, `npcs`, `factions`, `locations` are excluded.
3. **No raw user prompt is used.** Thread kind comes from the already-validated `WorldBibleSeed`,
   not the original prompt string.
4. **No generated content is used as seed or context.** No generated room name, object name,
   interaction text, provider output, or generated description enters the thread context or phrase.
5. **No object IDs, flag text, or objective JSON.** The feature is fully decoupled from the
   objective/quest pipeline. Neither `GeneratedStoryRoomContext` nor the phrase carries any of
   those values.
6. **No world/memory/objective/NPC mutation.** Pure computation only: no events, no state writes,
   no memory writes, no objective creation.
7. **No new LLM call.** Adjacent rooms remain `FakeRoomGenerator` only.
8. **No `RoomSpec` schema change.** `schemaVersion` stays `1`.
9. **Absence degrades cleanly.** No `WorldBibleSeed` → `kind` is `undefined` →
   `deriveStoryThreadContext` returns `undefined` → no phrase → seed is byte-identical to today.
   `storyKind` absent from `AssembleRoomOptions` → composition behavior is byte-identical to today.

---

## Architectural rules (binding)

1. `domain/generatedStoryThread.ts` is a pure domain file: no I/O, no logger, no React, no
   imports from `world-session`, `interactions`, `encounters`, `dialogue`, `memory`, or any
   application layer.
2. The module is intentionally self-contained: `GeneratedStoryThreadKind` must mirror
   `WorldBibleSeed.openingArc.pattern`'s literal union, but it does not import
   `domain/worldBible/worldBibleSeed.ts`, `RoomSpec`, `LoadedRoom`, quest types, or
   generation-layer types.
3. `deriveStoryThreadContext` accepts only `(kind: GeneratedStoryThreadKind | undefined,
   roomId: string)`. It never receives arc free text, prompt text, generated content, or any
   runtime state variable.
4. `storyThreadToSeedPhrase` accepts only a `GeneratedStoryRoomContext` and returns only from the
   hand-written finite table. No runtime string interpolation of content values.
5. `buildAdjacentRoomSeed`'s new `storyPhrase?` parameter is concatenated only with the existing
   ` | ` separator — the function performs no parsing or content inspection of the phrase.
6. Story-kind anchor priority tables are hand-written constants. They are never populated from
   generated content, objective specs, quest specs, or runtime values.
7. `storyKind` in `AssembleRoomOptions` / `ComposeGeneratedRoomOptions` is an optional closed
   field consumed only in `selectGeneratedStoryAnchorIndex`. It never enters `LoadedRoom`,
   `RoomSpec`, save-game, or any logged field.
8. No new log line exposes `kind`, `role`, `pressure`, seed phrase text, or any story-thread
   value. Existing safe log surfaces (`provenance`, `composed`, booleans, counts) are unchanged.
9. `RoomSpec`, `LoadedRoom`, `validateRoom`, `repairRoom`, `sanitizeGeneratedDisplayText`,
   `ensureGeneratedNpcPresence`, `generatedRoomObjectiveTarget`, and all quest/objective/dialogue
   paths are untouched by every slice.

---

## Scope (v0)

**In scope:**

- Slice 1: `domain/generatedStoryThread.ts` + `generatedStoryThread.test.ts` — closed types,
  `deriveStoryThreadContext`, `storyThreadToSeedPhrase`, full unit tests.
- Slice 2: Extend `buildAdjacentRoomSeed` with optional `storyPhrase`; App wiring to derive
  `kind` and compute a per-adjacent phrase inside the existing factory closure.
- Slice 3: `storyKind` in `AssembleRoomOptions` + `ComposeGeneratedRoomOptions`; story-kind
  anchor priority tables; App wiring to pass `storyKind` in adjacent `AssembleRoomOptions`.
- Slice 4: Docs closeout — ADR status, ARCHITECTURE.md status legend.
- Generated adjacent rooms only. The first prompt-generated room is unchanged.

**Out of scope / non-goals:**

- ❌ New LLM call or network call of any kind.
- ❌ `RoomSpec` / `WorldBibleSeed` / `QuestSpec` / `GeneratedObjectiveSpec` schema change.
- ❌ Free-text arc fields (`hook`, `firstObjective`, `pressure`) — never used, never re-considered.
- ❌ `GeneratedStoryBeat` or any per-step beat/progression sequence.
- ❌ Objective / quest coupling or objective-target creation.
- ❌ NPC thread-awareness (separate future feature).
- ❌ Real-provider adjacent generation or real-provider prompt changes.
- ❌ Authored / demo / fallback / first-room paths.
- ❌ World / memory / objective / NPC mutation.
- ❌ Backend, persistence, server, or save/load changes.
- ❌ Navigation or cache behavior changes.

---

## Data model

No new schema. `GeneratedStoryRoomContext` is a transient computation result that never enters
`LoadedRoom`, `RoomSpec`, save-game, backend, or authoritative state. The new persistent types are
the closed-enum aliases in `domain/generatedStoryThread.ts` and two optional fields on existing
options structs (`AssembleRoomOptions`, `ComposeGeneratedRoomOptions`).

---

## Files likely to change

**New files:**
- `apps/web/src/domain/generatedStoryThread.ts`
- `apps/web/src/domain/generatedStoryThread.test.ts`
- `docs/architecture/decisions/ADR-0057-generated-story-threading-v0.md` (this file)
- `docs/architecture/implementation-plans/generated-story-threading-v0.md`

**Slice 2:**
- `apps/web/src/app/buildAdjacentRoomSeed.ts`
- `apps/web/src/app/buildAdjacentRoomSeed.test.ts`
- `apps/web/src/App.tsx`

**Slice 3:**
- `apps/web/src/domain/assembleRoom.ts` (optional `storyKind` on `AssembleRoomOptions`)
- `apps/web/src/domain/generatedRoomComposition.ts` (optional `storyKind`, new tables)
- `apps/web/src/domain/generatedRoomComposition.test.ts` (story-kind anchor tests)
- `apps/web/src/App.tsx` (pass `storyKind` in adjacent `AssembleRoomOptions`)

**Slice 4:**
- `docs/architecture/ARCHITECTURE.md`

## Files NOT to change

`domain/roomSpec.ts` · `domain/loadRoomSpec.ts` · `domain/validateRoom.ts` ·
`domain/repairRoom.ts` · `domain/sanitizeGeneratedDisplayText.ts` ·
`domain/ensureGeneratedNpcPresence.ts` · `domain/generatedRoomObjectiveTarget.ts` ·
`domain/generatedRoomAliases.ts` · `domain/generatedRoomLayout.ts` ·
`domain/generatedRoomObjectPurpose.ts` · `domain/generatedRoomObjectTransforms.ts` ·
`domain/generatedRoomThemeVocabulary.ts` · `domain/ensureGeneratedExitNavigation.ts` ·
`domain/generatedReturnExit.ts` · `domain/worldBible/**` · `domain/quests/**` ·
`domain/dialogue/**` · `generation/**` · `room/GeneratedRoomSource.ts` ·
`app/buildPromptGeneratedRoomSource.ts` · `dialogue/**` · `interactions/**` ·
`encounters/**` · `memory/**` · `persistence/**` · `server/**` · `world-session/**` ·
`renderer/**` · `eslint.config.js` · `package.json`

---

## Tests

All Vitest, co-located, headless, deterministic — no DOM, no React, no network.

### `generatedStoryThread.test.ts` (new, Slice 1)

```
deriveStoryThreadContext
  ✓ kind undefined → returns undefined
  ✓ roomId with exactly 1 ':exit:' segment → role 'threshold', pressure 'steady'
  ✓ roomId with 2 ':exit:' segments → role 'developing', pressure 'rising'
  ✓ roomId with 3 ':exit:' segments → role 'developing', pressure 'rising'
  ✓ roomId with 4 ':exit:' segments → role 'deeper', pressure 'high'
  ✓ flat roomId (no ':exit:') → role 'threshold', pressure 'steady' (safe default)
  ✓ each kind value ('escape', 'investigate', 'survive', 'rescue', 'recover-item')
    → correct kind on output
  ✓ pure: identical inputs → identical output

storyThreadToSeedPhrase
  ✓ every (kind, role) combination returns a non-empty string from the phrase table
  ✓ all 15 (kind × role) entries — phrase length ≤ MAX_STORY_PHRASE_LENGTH
  ✓ pure: identical inputs → identical output

Safety (static structural assertions):
  ✓ deriveStoryThreadContext function signature has no 'string' free-text parameter
    beyond roomId (type-level; compile-enforced)
  ✓ storyThreadToSeedPhrase exhaustive: all enum combinations produce a defined string
```

### `buildAdjacentRoomSeed.test.ts` (additions, Slice 2)

```
  ✓ no theme, no phrase → 'adjacent:${roomId}' (byte-identical to today)
  ✓ theme only, no phrase → '${theme} | adjacent:${roomId}' (byte-identical to today)
  ✓ theme + phrase → '${theme} | ${phrase} | adjacent:${roomId}'
  ✓ phrase only (no theme) → '${phrase} | adjacent:${roomId}'
  ✓ empty/whitespace phrase → treated as absent (no phrase segment in output)
```

### App integration (additions, Slice 2)

```
  ✓ prompt-generated play with WorldBible (openingArc.pattern = 'investigate') →
    adjacent RoomSourceFactory seed for a depth-1 roomId contains 'investigation'
  ✓ WorldBible-failure path → adjacent seed has NO story phrase (byte-identical to today)
  ✓ adjacent seed never contains: arc free text, prompt text, NPC names,
    faction text, bible title, premise, or any free-text WorldBibleSeed field
```

### `generatedRoomComposition.test.ts` (additions, Slice 3)

```
selectGeneratedStoryAnchorIndex with storyKind:
  ✓ 'investigate' storyKind: prefers book/map/paper over throne when both present
  ✓ 'recover-item' storyKind: prefers chest over altar when both present
  ✓ 'survive' storyKind: prefers corpse over statue when both present
  ✓ 'rescue' storyKind: prefers statue over book/map when both present
  ✓ 'escape' storyKind: falls back to default/themePack priority (same as no storyKind)
  ✓ no storyKind → existing behavior byte-identical (regression)
  ✓ post-apoc themePack, no storyKind → existing post-apoc behavior (regression)
  ✓ storyKind + themePack both present → storyKind priority takes precedence
```

### Regression tests (all slices)

- All existing `buildAdjacentRoomSeed.test.ts` cases pass unchanged (Slice 2 only adds the new
  parameter; existing callers with 1–2 args are byte-identical).
- All existing `generatedRoomComposition.test.ts` cases pass unchanged (Slice 3 only adds cases;
  `storyKind` absent → identical behavior).
- Cost-guardrail: no new LLM call on adjacent path — usage-guard tests unchanged.
- Object-state persistence: `resolvedObjectIdsForGeneratedPlay` and generated-room object-state
  projection tests untouched.
- NPC objective-awareness: `buildNPCObjectiveContext` and `FakeNPCDialogueProvider` tier tests
  byte-identical.

---

## Failure modes

| Situation | Detection | Handling | Logging |
| --- | --- | --- | --- |
| No `WorldBibleSeed` (seeding failure, FAILURE-MODES 4c) | `prepared.worldBible` is `undefined` | `kind` is `undefined` → `deriveStoryThreadContext` returns `undefined` → no phrase → seed byte-identical to today | none |
| `openingArc.pattern` value not in closed enum | Impossible post-`WorldBibleSeedSchema` validation; defensive default: treat as `undefined` | degraded to no-phrase path | none |
| `roomId` has no `:exit:` segment | depth count = 0 → safe `'threshold'` default | phrase still derived and bounded; authored rooms never enter this path | none |
| `storyKind` absent from `AssembleRoomOptions` | `undefined` check in `selectGeneratedStoryAnchorIndex` | existing theme-pack or default priority unchanged | none |
| Adjacent room generation fails | existing `AdjacentRoomPregenerator.runResolve` catch | unchanged `unavailable` path; no thread context to roll back | existing safe log only |

---

## Consequences

- Adjacent generated rooms for prompt-generated play receive a bounded closed-vocabulary story
  phrase in their seed, nudging the deterministic `FakeRoomGenerator` toward thread-consistent
  flavoring with no new LLM call.
- When a story anchor object is present, `composeGeneratedRoom` biases selection toward a
  kind-appropriate object type (e.g., `investigate` runs prefer a book/map as the focal prop).
- The first prompt-generated room, authored rooms, demo rooms, fallback rooms, and adjacent rooms
  without a `WorldBibleSeed` are byte-identical to today.
- `WorldBibleSeed.openingArc.pattern` is now used as a safe generation hint. All other
  `openingArc` fields remain excluded; this is explicitly documented and re-confirmed.
- No new schema, no new state, no new LLM call, no new backend route.
- Full payoff — rooms that visibly read as a continuous arc rather than isolated spaces — requires
  real-provider adjacent generation (a future, separately-guardrailed feature).

## Alternatives considered

- **Use `openingArc.hook` / `firstObjective` / `pressure` free text in adjacent seeds** —
  rejected: those fields carry user-authored narrative prose. ADR-0043's exclusion stands.
- **`GeneratedStoryBeat` per-step beat sequencing** — deferred: beat sequences imply stored
  progression state, which edges toward a quest engine. Role from structural depth achieves
  "further in the thread feels different" without stored state.
- **New LLM call for thread-aware adjacent generation** — rejected for v0: no new network calls;
  the payoff here is seed variety and composition bias with the existing deterministic fake.
- **Apply threading to the first prompt-generated room** — rejected: the first room is already
  seeded from the full `worldBibleToGeneratorSeed` projection; threading is the adjacent-only
  concern.
- **NPC thread-awareness** — deferred: a separate feature concern. The NPC dialogue context
  already has `NPCObjectiveKind` (ADR-0056); a thread-kind analogue is independently designed.
