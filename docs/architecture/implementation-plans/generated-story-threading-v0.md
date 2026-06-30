# Implementation Plan — `feature/generated-story-threading-v0`

> Status: **implemented — slices 1–3 complete; docs/status closeout complete.**
> ADR: [ADR-0057](../decisions/ADR-0057-generated-story-threading-v0.md).
> Implemented on 2026-06-30.
>
> **Depends on (implemented and merged):**
> - `feature/generated-room-npc-objective-awareness-v1`
>   ([ADR-0056](../decisions/ADR-0056-generated-room-npc-objective-awareness-v1.md)) — most
>   recent merged feature; the repo is clean off `main`.
> - Adjacent Room Theme Continuity v0
>   ([ADR-0043](../decisions/ADR-0043-adjacent-room-theme-continuity-v0.md)) — `buildAdjacentRoomSeed`,
>   `worldBibleToAdjacentThemeSeed`, and the `RoomSourceFactory` closure in App are the seams
>   this plan extends.
> - Generated Room Composition v0
>   ([ADR-0032](../decisions/ADR-0032-generated-room-composition-v0.md)) — `composeGeneratedRoom`,
>   `selectGeneratedStoryAnchorIndex`, `STORY_ANCHOR_PRIORITY`, and `POST_APOC_STORY_ANCHOR_PRIORITY`
>   are extended in Slice 3.
>
> Companion docs: [ARCHITECTURE](../ARCHITECTURE.md) · [BOUNDARIES](../BOUNDARIES.md) ·
> [ADR-0057](../decisions/ADR-0057-generated-story-threading-v0.md).

---

## Goal

Make adjacent generated rooms feel connected as one small story thread, not isolated random
rooms, without adding a new LLM call, storing state, changing `RoomSpec`, or touching the
objective/quest/NPC-dialogue paths.

Two mechanisms together achieve this for v0 with the deterministic fake generator:

1. **Seed phrase** (Slice 2) — a bounded closed-vocabulary phrase prepended to the adjacent
   seed nudges the fake generator's deterministic output toward thread-consistent room flavoring.
2. **Composition anchor bias** (Slice 3) — `composeGeneratedRoom` prefers the focal prop type
   that best fits the thread kind (e.g., `investigate` rooms prefer a book/map as the anchor).

Both degrade silently to today's behavior when no `WorldBibleSeed` is available.

---

## Minimum Safe Change Check

**What existing code is reused:**

- `buildAdjacentRoomSeed(roomId, themeSeed?)` — gains only a third optional parameter;
  all existing callers at 1–2 args are byte-identical.
- The `RoomSourceFactory` closure in App.tsx (`App.tsx:394`) — already captures
  `adjacentThemeSeed` from `prepared.worldBible`; `kind` is a parallel capture from the same
  already-validated `WorldBibleSeed`. No new ref, no new React state, no new effect.
- `ComposeGeneratedRoomOptions` and `selectGeneratedStoryAnchorIndex` — existing
  `{ themePack }` pattern is extended with an optional `storyKind`; absence is identical behavior.
- `AssembleRoomOptions` — existing pattern for optional closed fields; `storyKind` mirrors
  `themePack` exactly and threads through `GeneratedRoomSource` (already passes options verbatim).

**What new code is actually necessary:**

- `domain/generatedStoryThread.ts` — closed types + two pure functions (~50 lines total).
- `domain/generatedStoryThread.test.ts` — ~40 deterministic test cases.
- `buildAdjacentRoomSeed.ts` — one optional parameter, three-branch join (~5 lines changed).
- `generatedRoomComposition.ts` — four new priority table constants + one extra lookup branch
  in `selectGeneratedStoryAnchorIndex` (~30 lines added).
- `assembleRoom.ts` — one optional field on `AssembleRoomOptions`, one pass-through in the
  `composeGeneratedRoom` call (~3 lines).
- `App.tsx` — two lines to derive `kind`/`storyPhrase` per adjacent id; one field added to the
  adjacent `AssembleRoomOptions` literal (~5 lines).

**Safety boundaries unchanged:**

- `WorldState` / event log / reducers — no new event, no schema field, no mutation.
- Domain purity — no React, no logger, no I/O in `domain/generatedStoryThread.ts`.
- Seed phrase — hand-written finite table; no generated text, no prompt text, no arc free text.
- Adjacent rooms stay `FakeRoomGenerator` — no new network call, no new spend.
- Authored/demo/first-room/fallback/repaired paths — untouched.
- Logging — no new log lines; no new fields on existing log lines.

**Targeted tests:**

- `generatedStoryThread.test.ts` — pure domain, all enum combinations + degradation.
- `buildAdjacentRoomSeed.test.ts` additions — new-parameter combinations + no-phrase regression.
- `generatedRoomComposition.test.ts` additions — story-kind anchor bias + regression.
- App integration additions — phrase in seed on WorldBible path; no phrase on failure path.

---

## Current repo facts (verified)

- **`apps/web/src/app/buildAdjacentRoomSeed.ts`** — two-branch function returning
  `'${themeSeed} | adjacent:${roomId}'` or `'adjacent:${roomId}'`. Adding a third optional
  `storyPhrase?` parameter and a three-branch join is the minimum change.
- **`apps/web/src/App.tsx:387-401`** — `adjacentThemeSeed` is derived from `prepared.worldBible`
  and captured by the `RoomSourceFactory` closure. `prepared.worldBible?.openingArc.pattern` is
  the `GeneratedStoryThreadKind` source — available from the same already-validated `WorldBibleSeed`
  object, at the same line. `worldBibleToAdjacentThemeSeed` (line 388) is the direct precedent.
- **`apps/web/src/domain/generatedRoomComposition.ts:117-143`** — `STORY_ANCHOR_PRIORITY` and
  `POST_APOC_STORY_ANCHOR_PRIORITY` are the two existing constants. `selectGeneratedStoryAnchorIndex`
  (line 200) selects between them with a single ternary on `options.themePack`. Adding four more
  constants and an extended priority-resolution step mirrors the exact same pattern.
- **`apps/web/src/domain/assembleRoom.ts:166-170, 225`** — `AssembleRoomOptions` has
  `requestsNpc?`, `enrichObjectiveTarget?`, `themePack?`. Adding `storyKind?` is additive and
  requires passing it through to `composeGeneratedRoom` at line 225.
- **`apps/web/src/room/GeneratedRoomSource.ts:75`** — `assembleRoom(raw, this.fallbackRoom,
  this.assembleOptions)` passes options verbatim. No change needed here.
- **`apps/web/src/domain/worldBible/worldBibleSeed.ts:31`** — `openingArc.pattern` is typed as
  `z.enum(['escape', 'investigate', 'survive', 'rescue', 'recover-item'])`. `GeneratedStoryThreadKind`
  mirrors this literal union exactly; the types can share the same values without importing each
  other (domain-to-domain is allowed but keeping `generatedStoryThread.ts` self-contained by
  re-declaring the literal union avoids coupling).

---

## Implementation slices

### Slice 1 — Pure domain contract

**Status:** Complete.

**Goal:** Ship the closed types, `deriveStoryThreadContext`, and `storyThreadToSeedPhrase` with
full unit tests. No wiring, no consumer. Zero runtime behavior change.

**Files:**
- `apps/web/src/domain/generatedStoryThread.ts` (new)
- `apps/web/src/domain/generatedStoryThread.test.ts` (new)

**`generatedStoryThread.ts` — structure:**

```ts
export type GeneratedStoryThreadKind =
  | 'escape' | 'investigate' | 'survive' | 'rescue' | 'recover-item'

export type GeneratedStoryRoomRole = 'threshold' | 'developing' | 'deeper'

export type GeneratedStoryPressure = 'steady' | 'rising' | 'high'

export type GeneratedStoryRoomContext = {
  kind: GeneratedStoryThreadKind
  role: GeneratedStoryRoomRole
  pressure: GeneratedStoryPressure
}

// Max length for any seed phrase. All 15 entries in the table are within this cap.
export const MAX_STORY_PHRASE_LENGTH = 50

export function deriveStoryThreadContext(
  kind: GeneratedStoryThreadKind | undefined,
  roomId: string,
): GeneratedStoryRoomContext | undefined {
  if (kind == null) return undefined
  const role = roleFromRoomId(roomId)
  return { kind, role, pressure: pressureFromRole(role) }
}

export function storyThreadToSeedPhrase(ctx: GeneratedStoryRoomContext): string {
  return SEED_PHRASES[ctx.kind][ctx.role]
}

function roleFromRoomId(roomId: string): GeneratedStoryRoomRole {
  const depth = (roomId.match(/:exit:/g) ?? []).length
  if (depth >= 4) return 'deeper'
  if (depth >= 2) return 'developing'
  return 'threshold'
}

function pressureFromRole(role: GeneratedStoryRoomRole): GeneratedStoryPressure {
  switch (role) {
    case 'threshold': return 'steady'
    case 'developing': return 'rising'
    case 'deeper': return 'high'
  }
}

// Hand-written, finite, closed. No runtime interpolation of content values.
// All entries ≤ MAX_STORY_PHRASE_LENGTH characters.
const SEED_PHRASES: Readonly<
  Record<GeneratedStoryThreadKind, Readonly<Record<GeneratedStoryRoomRole, string>>>
> = {
  escape: {
    threshold: 'escape route | first obstacle',
    developing: 'escape route | building pressure',
    deeper: 'escape route | critical path',
  },
  investigate: {
    threshold: 'investigation | early clues',
    developing: 'investigation | gathering evidence',
    deeper: 'investigation | close to the truth',
  },
  survive: {
    threshold: 'survival | first threat',
    developing: 'survival | escalating danger',
    deeper: 'survival | desperate stage',
  },
  rescue: {
    threshold: 'rescue mission | early search',
    developing: 'rescue mission | closing in',
    deeper: 'rescue mission | final approach',
  },
  'recover-item': {
    threshold: 'recovery | early search',
    developing: 'recovery | tracking the target',
    deeper: 'recovery | nearly there',
  },
}
```

**`generatedStoryThread.test.ts` — cases:**

```
deriveStoryThreadContext
  ✓ kind undefined → returns undefined
  ✓ roomId 'abc:exit:north' (1 :exit:) → role 'threshold', pressure 'steady'
  ✓ roomId 'abc:exit:north:exit:south' (2 :exit:) → role 'developing', pressure 'rising'
  ✓ roomId with 3 :exit: segments → role 'developing', pressure 'rising'
  ✓ roomId with 4 :exit: segments → role 'deeper', pressure 'high'
  ✓ flat roomId (no :exit:) → role 'threshold', pressure 'steady'
  ✓ kind 'escape' → output kind is 'escape'
  ✓ kind 'investigate' → output kind is 'investigate'
  ✓ kind 'survive' → output kind is 'survive'
  ✓ kind 'rescue' → output kind is 'rescue'
  ✓ kind 'recover-item' → output kind is 'recover-item'
  ✓ pure: same inputs twice → identical output

storyThreadToSeedPhrase
  ✓ all 15 (kind × role) combinations return a non-empty string
  ✓ all 15 phrases are ≤ MAX_STORY_PHRASE_LENGTH chars
  ✓ pure: same inputs twice → identical output

(All 15 phrases are asserted to exist via the exhaustive-key type structure;
 no runtime interpolation path exists to assert against.)
```

**Stop point after Slice 1:** Hand off. Maintainer reviews types and phrase table before
seed wiring lands in the codebase.

**Verification:** `npm run test -- generatedStoryThread`

---

### Slice 2 — Adjacent seed wiring

**Status:** Complete.

**Goal:** Wire the story phrase into the adjacent fake generator seed. Behavior change is limited
to the deterministic fake adjacent seed; no LLM call, no spend.

**Files:**
- `apps/web/src/app/buildAdjacentRoomSeed.ts` (edit)
- `apps/web/src/app/buildAdjacentRoomSeed.test.ts` (edit)
- `apps/web/src/App.tsx` (edit)

**`buildAdjacentRoomSeed.ts` — updated signature and body:**

```ts
export function buildAdjacentRoomSeed(
  roomId: string,
  themeSeed?: string,
  storyPhrase?: string,
): string {
  const parts: string[] = []
  if (themeSeed?.trim()) parts.push(themeSeed)
  if (storyPhrase?.trim()) parts.push(storyPhrase)
  parts.push(`adjacent:${roomId}`)
  return parts.join(' | ')
}
```

Existing callers at 1–2 args are byte-identical. The new third arg is optional.

**`buildAdjacentRoomSeed.test.ts` — new cases (existing cases unchanged):**

```
  ✓ (roomId) → 'adjacent:${roomId}' (no args regression, byte-identical)
  ✓ (roomId, theme) → '${theme} | adjacent:${roomId}' (two-arg regression, byte-identical)
  ✓ (roomId, theme, phrase) → '${theme} | ${phrase} | adjacent:${roomId}'
  ✓ (roomId, undefined, phrase) → '${phrase} | adjacent:${roomId}'
  ✓ (roomId, theme, '') → '${theme} | adjacent:${roomId}' (empty phrase treated as absent)
  ✓ (roomId, theme, '   ') → '${theme} | adjacent:${roomId}' (whitespace phrase treated as absent)
```

**`App.tsx` — changes inside the `RoomSourceFactory` closure (lines ~387–406):**

After the existing `adjacentThemeSeed` derivation, derive `storyKind` and compute the
phrase per adjacent id:

```ts
// Derive once per session — same scope as adjacentThemeSeed.
const storyKind = prepared.worldBible?.openingArc.pattern

// Inside the (roomId) => ... factory:
(roomId) => {
  const storyCtx = deriveStoryThreadContext(storyKind, roomId)
  const storyPhrase = storyCtx != null ? storyThreadToSeedPhrase(storyCtx) : undefined
  return new GeneratedRoomSource(
    generatedAdjacentGenerator,
    buildAdjacentRoomSeed(roomId, adjacentThemeSeed, storyPhrase),
    logger,
    fallbackRoom,
    { themePack: prepared.worldBible?.themePack, enrichObjectiveTarget: true },
  )
},
```

`storyKind` type is `GeneratedStoryThreadKind | undefined`; the `openingArc.pattern` string
literal union is identical to `GeneratedStoryThreadKind`'s literal union, so the assignment
is type-safe without a cast.

**App integration test additions:**

```
  ✓ prompt-generated play with WorldBible (openingArc.pattern = 'investigate') →
    for a depth-1 adjacent roomId, the seed passed to GeneratedRoomSource includes
    the string 'investigation'
  ✓ WorldBible-failure path (worldBible = undefined) →
    adjacent seed has no story phrase segment (byte-identical to today)
  ✓ adjacent seed on WorldBible path never includes:
    openingArc.hook text, openingArc.firstObjective text, openingArc.pressure text,
    worldBible.premise, worldBible.title, any NPC name, faction name, or location label
```

**Stop point after Slice 2:** Hand off. Maintainer verifies the seed contents and integration
test results before the composition bias lands.

**Verification:**
```
npm run test -- buildAdjacentRoomSeed
npm run test -- App
npm run build
npm run lint
```

---

### Slice 3 — Composition anchor bias

**Status:** Complete.

**Goal:** Make the thread *visible* in composed rooms by biasing the focal-object selection.
Touches the shared assembly pipeline; kept as a separate approved slice.

**Files:**
- `apps/web/src/domain/assembleRoom.ts` (edit — `AssembleRoomOptions`)
- `apps/web/src/domain/generatedRoomComposition.ts` (edit — new tables + updated selector)
- `apps/web/src/domain/generatedRoomComposition.test.ts` (edit — story-kind bias cases)
- `apps/web/src/App.tsx` (edit — pass `storyKind` in adjacent `AssembleRoomOptions`)

**`assembleRoom.ts` — `AssembleRoomOptions` update:**

```ts
import type { GeneratedStoryThreadKind } from './generatedStoryThread'

export type AssembleRoomOptions = {
  requestsNpc?: boolean
  enrichObjectiveTarget?: boolean
  themePack?: GeneratedRoomVisualTheme
  storyKind?: GeneratedStoryThreadKind   // ← new; absent = existing behavior
}
```

In `assembleRoom`, update the `composeGeneratedRoom` call at Stage 2.7:

```ts
const composition = composeGeneratedRoom(objectsFixed, {
  themePack: options.themePack,
  storyKind: options.storyKind,   // ← new pass-through
})
```

**`generatedRoomComposition.ts` — new constants and updated `ComposeGeneratedRoomOptions`:**

```ts
import type { GeneratedStoryThreadKind } from './generatedStoryThread'

export type ComposeGeneratedRoomOptions = {
  themePack?: GeneratedRoomVisualTheme
  storyKind?: GeneratedStoryThreadKind   // ← new; absent = existing behavior
}

// Story-kind anchor priority tables (hand-written, closed, never from generated content).
// Lower number = preferred. Only objects already in STORY_ANCHOR_PRIORITY are included,
// so types not in the table gracefully produce no match (existing behavior).
const INVESTIGATE_ANCHOR_PRIORITY: Partial<Record<RoomObject['type'], number>> = {
  book: 0, map: 0, paper: 0,
  chest: 1,
  corpse: 2,
  artifact: 3,
  machine: 4,
  table: 5,
  statue: 6,
  altar: 7,
  throne: 8,
}

const RECOVER_ITEM_ANCHOR_PRIORITY: Partial<Record<RoomObject['type'], number>> = {
  chest: 0,
  artifact: 1,
  map: 2,
  book: 3, paper: 3,
  table: 4,
  machine: 5,
  corpse: 6,
  statue: 7,
  altar: 8,
  throne: 9,
}

const SURVIVE_ANCHOR_PRIORITY: Partial<Record<RoomObject['type'], number>> = {
  corpse: 0,
  machine: 1,
  artifact: 2,
  chest: 3,
  table: 4, map: 4, book: 4, paper: 4,
  statue: 5,
  altar: 6,
  throne: 7,
}

const RESCUE_ANCHOR_PRIORITY: Partial<Record<RoomObject['type'], number>> = {
  statue: 0,
  throne: 1,
  altar: 2,
  corpse: 3,
  chest: 4,
  artifact: 5,
  machine: 6,
  table: 7, map: 7, book: 7, paper: 7,
}
```

**`selectGeneratedStoryAnchorIndex` — updated priority resolution:**

```ts
export function selectGeneratedStoryAnchorIndex(
  objects: RoomObject[],
  options: ComposeGeneratedRoomOptions = {},
): number {
  const priorityTable = storyKindPriority(options.storyKind)
    ?? (options.themePack === 'post-apoc'
      ? POST_APOC_STORY_ANCHOR_PRIORITY
      : STORY_ANCHOR_PRIORITY)
  // ...rest of function unchanged...
}

function storyKindPriority(
  kind: GeneratedStoryThreadKind | undefined,
): Partial<Record<RoomObject['type'], number>> | undefined {
  switch (kind) {
    case 'investigate': return INVESTIGATE_ANCHOR_PRIORITY
    case 'recover-item': return RECOVER_ITEM_ANCHOR_PRIORITY
    case 'survive': return SURVIVE_ANCHOR_PRIORITY
    case 'rescue': return RESCUE_ANCHOR_PRIORITY
    case 'escape': return undefined   // no strong anchor bias; fallback to themePack
    default: return undefined
  }
}
```

`escape` deliberately returns `undefined` so it falls back to the theme-pack priority — escape
tension is expressed by exit navigation and seed variety, not by a specific focal prop type.

**`generatedRoomComposition.test.ts` — story-kind bias cases:**

```
selectGeneratedStoryAnchorIndex with storyKind:
  ✓ 'investigate': room with throne + book → selects book (priority 0 < throne's 8)
  ✓ 'recover-item': room with altar + chest → selects chest (priority 0 < altar's 8)
  ✓ 'survive': room with statue + corpse → selects corpse (priority 0 < statue's 5)
  ✓ 'rescue': room with book + statue → selects statue (priority 0 < book's 7)
  ✓ 'escape': room with throne + book → uses default priority (throne at 0 wins)
  ✓ undefined storyKind + default: existing behavior byte-identical
  ✓ undefined storyKind + post-apoc: existing post-apoc behavior byte-identical
  ✓ 'investigate' + post-apoc themePack: storyKind wins (book preferred over machine)
  ✓ 'escape' + post-apoc: themePack applies (machine preferred, escape has no bias)
```

**`App.tsx` — pass `storyKind` in adjacent `AssembleRoomOptions`:**

The `storyKind` derived in Slice 2 is already captured in the closure scope. Pass it:

```ts
{ themePack: prepared.worldBible?.themePack, enrichObjectiveTarget: true, storyKind }
```

No new variable needed — `storyKind` is already in scope from Slice 2.

**Stop point after Slice 3:** Hand off. Maintainer verifies composition tests and manual smoke
before docs closeout.

**Verification:**
```
npm run test -- generatedRoomComposition
npm run test -- assembleRoom
npm run test -- App
npm run build
npm run lint
```

---

### Slice 4 — Docs closeout

**Status:** Complete.

**Files:**
- `docs/architecture/decisions/ADR-0057-generated-story-threading-v0.md` (edit: Status → Implemented)
- `docs/architecture/implementation-plans/generated-story-threading-v0.md` (edit: Status → implemented)
- `docs/architecture/ARCHITECTURE.md` (edit: status legend entry planned → implemented)

**Verification:** `npm run test` (full suite) · `npm run build` · `npm run lint`

---

## Safety checklist

Before handing off each slice:

- [ ] `domain/generatedStoryThread.ts` imports nothing from `world-session`, `interactions`,
  `encounters`, `dialogue`, `memory`, `generation`, React, Three.js, or the logger.
- [ ] `deriveStoryThreadContext` has no free-text string parameter beyond `roomId`; the only
  `WorldBibleSeed` field consumed is `openingArc.pattern` (closed enum).
- [ ] `storyThreadToSeedPhrase` returns only from the `SEED_PHRASES` table; no runtime
  interpolation of content values.
- [ ] `buildAdjacentRoomSeed` existing callers at 1–2 args remain byte-identical.
- [ ] Adjacent seed never contains: `hook`, `firstObjective`, `pressure`, `premise`, `title`,
  `majorConflict`, `canonNotes`, NPC names, faction text, location labels, or raw user prompt.
- [ ] Story-kind anchor priority tables are hand-written constants; no values come from generated
  content or runtime variables.
- [ ] `storyKind` in `AssembleRoomOptions`/`ComposeGeneratedRoomOptions` is absent → exact
  current behavior (regression-tested).
- [ ] No new log line carries `kind`, `role`, `pressure`, phrase text, or any story-thread value.
- [ ] `RoomSpec`, `LoadedRoom`, `validateRoom`, `repairRoom`, `sanitizeGeneratedDisplayText`,
  `ensureGeneratedNpcPresence`, `generatedRoomObjectiveTarget`, `quests/**`, `dialogue/**`,
  and all objective/NPC paths are untouched.
- [ ] `eslint.config.js` and `package.json` are untouched.
- [ ] Cost-guardrail: adjacent path stays `FakeRoomGenerator`; no new LLM call; usage meter
  unchanged.

---

## Manual smoke checklist

Run after Slice 3 is complete (`npm run dev`; no API key needed — adjacent is always fake):

1. Submit a prompt that seeds an **investigate** bible (e.g., *"mysterious ruins, I need to find
   what happened here"*).
2. Enter the first generated room. Walk to an exit arch and pass through to an adjacent room.
   **Expect:** the adjacent room loads normally, renders without error, no repaired/fallback
   notice appears.
3. Walk **two to three rooms deep** along exits from the origin.
   **Expect:** later rooms have a consistent "investigation" feeling — document-type or
   container-type objects are compositionally centered as the focal prop more often than thrones
   or altars. (Note: with the fake generator the effect is subtle — seed variety improves
   consistency; the full payoff requires a real adjacent provider.)
4. Try a **rescue** bible prompt (e.g., *"I must save someone trapped in the keep"*).
   **Expect:** adjacent rooms more often feature statues or throne-like authority objects as the
   focal prop.
5. Submit a prompt that **fails world-bible seeding** (force by breaking the seeder temporarily
   or using the existing raw-prompt fallback). Walk to an adjacent room.
   **Expect:** adjacent room loads normally (graceful degradation); no story phrase appears in
   the seed (verifiable via a debug log breakpoint if desired); no error thrown.
6. Load the **authored/demo** bootstrap. Navigate between the two authored rooms.
   **Expect:** no behavior change. Demo flow is byte-identical.
7. Open the browser console: **no** new `console.*` output appears. Existing safe log lines
   (`room resolved`, `adjacent warm requested`, `room generated`) are unchanged in content.
8. Confirm no repaired/fallback notice appears for a normally-threaded adjacent room
   (`provenance` stays `generated`).

---

## Failure modes

| Situation | Detection | Handling | Logging |
| --- | --- | --- | --- |
| No `WorldBibleSeed` (seeding failure, FAILURE-MODES 4c) | `prepared.worldBible` undefined | `storyKind` undefined → `deriveStoryThreadContext` returns undefined → no phrase → no bias → seed/composition byte-identical to today | none |
| `openingArc.pattern` value not in closed enum | Impossible post-schema validation; `deriveStoryThreadContext` returns undefined as safe default | degraded to no-context path | none |
| `roomId` has no `:exit:` segment | depth count 0 → `'threshold'` default role | phrase still derived and bounded; authored rooms never enter this path | none |
| `storyKind` absent from `AssembleRoomOptions` | undefined check in `storyKindPriority()` | returns undefined → existing theme-pack or default priority unchanged | none |
| Adjacent room generation fails (generator throws) | existing `AdjacentRoomPregenerator.runResolve` catch | unchanged `unavailable` path; no thread context to roll back | existing safe log only |

---

## Regression gates

Run after each slice before handoff:

```bash
# Slice 1 — targeted
npm run test -- generatedStoryThread

# Slice 2 — targeted + broad
npm run test -- buildAdjacentRoomSeed
npm run test -- App
npm run build
npm run lint

# Slice 3 — targeted + broad
npm run test -- generatedRoomComposition
npm run test -- assembleRoom
npm run test -- App
npm run build
npm run lint

# Slice 4 closeout — full suite
npm run test
npm run build
npm run lint
```

Do not claim any check passed unless it was actually run.
