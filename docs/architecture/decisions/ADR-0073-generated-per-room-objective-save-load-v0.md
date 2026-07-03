# ADR-0073: Generated Per-Room Objective Save/Load v0 — restore visited-room objectives from the cache blob

- **Status:** Accepted — implemented
- **Date:** 2026-07-03
- **Implemented:** 2026-07-03
- **Deciders:** Project owner

## Context

`generated-quest-save-load-v0` ([ADR-0059](./ADR-0059-generated-quest-save-load-v0.md))
restores the **current** generated room's objective (quest spec + hints) across a
Save/Continue/Load cycle. `generated-room-cache-save-load-v0`
([ADR-0060](./ADR-0060-generated-room-cache-save-load-v0.md)) restores the visited
generated rooms themselves so backtracking after load serves stable, byte-identical
rooms. ADR-0060 explicitly deferred one gap in its "objective UI safety" note:

> *"Non-current per-room generated objective text is not restored; navigating to a
> restored cached room shows no quest objective (objective-generation is blocked by
> memo, so no cost is spent, but the text is also gone)."*

During live play every visited room's objective is memoized per room
(`PerRoomObjectiveMemo`) and re-attached on backtracking. After a load, ADR-0060
deliberately seeds every non-current restored room with a `null` memo entry — this
suppresses regeneration cost but also permanently hides the objective for rooms that
had one. This feature closes that gap by parking each visited room's memoized
objective attachment inside the existing ADR-0060 cache blob and re-seeding the memo
from it on load, with **no** provider call, **no** new sidecar, and **no**
`schemaVersion` change.

## Decision

Extend the existing `generatedRoomCacheJson` blob (ADR-0060) so each saved
**non-current** visited-room entry may carry that room's memoized objective
attachment. On load, after the ADR-0059 quest restore and ADR-0060 cache restore both
succeed, seed the per-room objective memo from the parked attachments. The
current-room objective continues to come solely from `generatedQuestJson`.

### Scope and invariants

- **Non-current visited cached rooms now save/restore objective attachments.** Each
  parked attachment is exactly `{ questSpec, hint, completionHint }` — the same shape
  the live `PerRoomObjectiveMemo` holds.
- **The current-room objective still comes only from `generatedQuestJson`.** It is a
  single source per room. The current-room cache entry **never** carries an objective
  on save, and any `objective` field on the current-room cache entry is ignored on
  restore even if present (tamper resilience).
- **Restore seeds the memo only by `restoredRoomIds`** — the rooms
  `restoreGeneratedRoomCache` actually rehydrated (`loadRoomSpec` succeeded) plus the
  current room — never by the objective map's own keys, so a room skipped by
  `loadRoomSpec` can never leave an orphan objective memo entry.
- **Completion is re-derived, never persisted.** The attachment carries no completion
  field. Objective done/active state is always re-derived from the restored
  authoritative `WorldState` flags via `evaluateQuest`; storing it would create a
  second source of truth.
- **Malformed / mismatched / tampered objective attachments degrade to
  null/absent while the room restore continues.** The `objective` field is accepted
  **leniently** (`z.unknown().optional()`) at blob parse so a malformed sub-object
  never fails the entry, the array, or the whole blob. A dedicated strict
  `SavedGeneratedRoomObjectiveSchema.safeParse` plus a pure `objectiveMatchesRoom`
  cross-check gate the attach at build and at restore; either failing degrades that
  room's objective to `null` while the room itself restores under existing ADR-0060
  behavior.

### `objectiveMatchesRoom(questSpec, room)` cross-check

A pure, `WorldState`-free predicate that returns `true` only when the parked objective
genuinely belongs to the parked room. It requires `questSpec.anchorRoomId === room.id`
and a single objective whose condition resolves against that room's `RoomSpec`:

- `room-flag interaction:<objectId>` → `condition.roomId === room.id` **and**
  `<objectId>` resolves to a real interactable (effect-bearing, non-encounter) object
  in the room.
- `room-flag encounter:<…>` → `condition.roomId === room.id` **and** some room object's
  derived `encounter:${encounter.id ?? objectId}` equals the flag.
- `room-visited` → `condition.roomId === room.id` **or** the room has an exit whose
  `toRoomId === condition.roomId`.
- `has-item` / `has-status` / any other kind → `false`.

It only protects objective restore: it mutates no `WorldState`, appends no event, and
never blocks the room.

### Data model

`SavedGeneratedRoomEntry` (inside the existing `generatedRoomCacheJson` blob;
localStorage-only, non-authoritative) gains one optional field:

```ts
SavedGeneratedRoomObjectiveSchema = z.object({
  questSpec: QuestSpecSchema,
  hint: z.string().min(1).max(GENERATED_OBJECTIVE_TEXT_MAX_LENGTH),        // non-empty, ≤160
  completionHint: z.string().min(1).max(GENERATED_OBJECTIVE_TEXT_MAX_LENGTH), // non-empty, ≤160
}).strict()

SavedGeneratedRoomEntrySchema = z.object({
  room: RoomSpecSchema,
  provenance: z.enum(['generated', 'repaired', 'fallback']),
  objective: z.unknown().optional(), // lenient at blob parse; strict shape applied separately
}).strict()
```

`buildGeneratedRoomCacheSaveState` validates the objective strictly at build time;
`loadGeneratedRoomCacheSaveState` re-applies the strict shape plus `objectiveMatchesRoom`
per entry via `sanitizeLoadedObjectives`, dropping only the offending objective. The
blob `schemaVersion` stays `1`. There is no `SaveGame` / `WorldState` / `RoomSpec` /
`QuestSpec` version bump and no DB/schema migration.

### Save / restore wiring

- **Save:** `handleSave` passes `perRoomObjectiveMemoRef.current` into
  `buildGeneratedRoomCacheSaveJson`. Each non-current visited entry whose memo
  attachment is non-null carries that attachment; the current-room entry never does.
- **Restore:** `restoreGeneratedRoomCache` returns an `objectives` map (non-current
  rooms only). `restoreGeneratedRoomCacheFromSlot` threads it out as
  `restoredObjectives`, and `seedRestoredGeneratedObjectiveMemo` seeds the mapped
  attachment where present (else `null`) while iterating `restoredRoomIds`. The
  current room is still seeded from the quest blob.
- **Backtrack after load:** entering a restored room re-applies its attachment through
  the existing `readPerRoomObjectiveMemo` path; `evaluateQuest` over restored flags
  shows the correct done/active state.

### Authority, cost, and content invariants (unchanged)

- **No provider calls.** Save is a pure projection of the memo; load is parse-only.
  The restore path calls no `RoomGenerator`/`ObjectiveGenerator`, no `recordAttempt`,
  and no real-provider `warmAdjacent`.
- **No WorldState mutation.** No `WorldEvent`/`WorldCommand` is appended; `roomStates`,
  `player`, and `inventory` are untouched.
- **No memory writes.** No NPC or room memory layer is touched.
- **No DB/schema migration.** No authoritative schema and no `schemaVersion` field
  changes; no persistence migration.
- **No dialogue behavior change.**
- **No raw objective JSON exposure.** The blob is never logged; objectives surface
  only through the existing `QuestTracker`/hint projections. New diagnostics are
  count-only.

### Accepted forward-compat tradeoff

Because `SavedGeneratedRoomEntrySchema` is `.strict()` in the **old** reader, a new
save carrying an `objective` key fails parse there, so pre-feature code drops the whole
cache blob and degrades to ADR-0059 current-room-only restore — the same
forward-incompat class every strict sidecar blob already has, and identical to what a
`schemaVersion` bump would produce via `unsupported-version`. **New** code degrades
per-entry, never per-blob. A single revert restores the prior behavior with no
migration.

### Memo-staleness invariant

The memo holds the last attachment per room. Today nothing mutates a room's hints
mid-room, so the memo and `questHintsRef` cannot diverge; the parked attachment always
matches what live play would re-attach. A future feature that mutates hints mid-room
would need to revisit this invariant.

## Consequences

- **Backtracking to a visited generated room after load shows its objective again**
  (quest spec + hints), with completion re-derived from restored `WorldState`.
- **A room that legitimately had no objective still shows none** after load, and no
  generation fires on entering it (memo `null` preserved).
- **Zero cost on load and backtrack.** No provider/generator call and no usage-meter
  movement, exactly as ADR-0059/0060.
- **Old saves and authored saves are byte-identical / behave identically.** Old cache
  blobs (no `objective` fields) load fine and seed `null`; authored saves write no
  blobs.
- **Tamper/corruption is contained per objective.** A malformed, schema-invalid, or
  room-mismatched objective degrades only that room's objective to `null`; the room and
  every other room restore normally.
- **Known limitations (inherited from ADR-0060, unchanged):** warmed-but-unvisited
  rooms are not persisted; the 16-room cap still evicts deeper rooms (an evicted room
  and its objective regenerate — and re-meter — as a fresh room on deep backtracking);
  cache insertion order (not true MRU) drives cap pruning.
