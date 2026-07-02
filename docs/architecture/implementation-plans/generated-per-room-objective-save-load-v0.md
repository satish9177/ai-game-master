# Implementation Plan — `feature/generated-per-room-objective-save-load-v0`

> Status: **Draft — revised after review. No code written.** Review verdict was
> "request changes"; B1 (per-entry lenient objective degradation) and B2
> (explicit `objectiveMatchesRoom`) are now resolved, stale line references
> refreshed, and the required test list expanded. Ready for Slice 2.
> ADR: **required at closeout** (not drafted yet).
> Companion docs: [ARCHITECTURE](../ARCHITECTURE.md) · [BOUNDARIES](../BOUNDARIES.md) ·
> [AGENTS.md](../../../AGENTS.md).
> Direct precedents:
> [ADR-0059](../decisions/ADR-0059-generated-quest-save-load-v0.md) — current
> room's quest/hints parked in `generatedQuestJson` (unchanged, still the gate);
> [ADR-0060](../decisions/ADR-0060-generated-room-cache-save-load-v0.md) — the
> visited-rooms cache blob this feature extends with per-room objectives;
> [ADR-0049](../decisions/ADR-0049-real-generated-objective-provider-v0.md) /
> generated-objective-per-room-v0 — where per-room objectives come from.

## Summary

- **Why this feature exists.** During live generated play, every visited room's
  objective (quest spec + hints) is memoized per room and correctly re-attached
  on backtracking. After Save → Load, only the *current* room's objective is
  restored (ADR-0059); every other restored room is deliberately seeded with a
  `null` memo entry to avoid regeneration cost — so backtracking after a load
  permanently shows no objective for rooms that had one. This is the documented
  ADR-0060 "objective UI safety" limitation; this feature closes it.
- **What it depends on.** ADR-0059/0060 (shipped). Independent of features
  7/8/9/10.
- **What it intentionally does not do.** No provider/LLM call on load, no
  regeneration of missing objectives, no new sidecar blob, no `SaveGame`/
  `QuestSpec`/`RoomSpec` schema-version change, no raw objective JSON in UI or
  logs.

---

## 1. Goal

After Save → Continue/Load of a generated session, navigating back into a
previously visited generated room restores that room's objective panel/state
(quest spec, hint, completion hint, and completion status derived from restored
`WorldState` flags) exactly as it was before the save — with zero provider
calls and zero usage-meter movement on the load or the backtrack.

## 2. Current repo facts / limitation (verified against source)

- **Live play memo.** `app/App.helpers.ts:40` `PerRoomObjectiveMemo =
  Map<string, GeneratedObjectiveQuestAttachment | null>` where the attachment is
  `{ questSpec, hint, completionHint }` (`app/generatedObjective.ts:6–10`).
  `readPerRoomObjectiveMemo` (`App.helpers.ts:73–87`) re-applies it on
  navigation (`App.tsx:1033–1049`, memo read at `App.tsx:1042`);
  `shouldStartPerRoomObjectiveAttach` (`App.helpers.ts:89–98`) only generates for
  rooms **not in the memo**, so a memo `null` means "attempted/known — do not
  regenerate".
- **Save path saves only the current room's objective.**
  `App.tsx:814–822` → `buildGeneratedQuestSaveJson(..., questHintsRef.current)`
  (`App.helpers.ts:163–183`) → `GeneratedQuestSaveStateSchema`
  (`domain/quests/generatedQuestSaveState.ts:18–33`: current `room`, optional
  `questSpec`/`storyKind`/`hints`). The memo itself is never persisted.
- **Cache blob saves rooms, not objectives.**
  `buildGeneratedRoomCacheSaveJson` (`App.helpers.ts:185–213`, called from
  `handleSave` at `App.tsx:835–843`) saves the current room + visited cached
  rooms into `GeneratedRoomCacheSaveStateSchema`
  (`domain/quests/generatedRoomCacheSaveState.ts:21–27`, cap
  `GENERATED_ROOM_CACHE_MAX = 16` at `:7`). Each entry is the strict
  `SavedGeneratedRoomEntrySchema` (`:9–14`; today just `{ room, provenance }`).
- **The restore seeds the gap.** `App.tsx:345–363`
  `seedRestoredGeneratedObjectiveMemo`: current room ← quest-blob attachment;
  **every other restored room id ← `null`** — intentionally suppressing both the
  objective UI and any regeneration cost on backtrack (ADR-0060 known
  limitation). It already iterates `restoredRoomIds` (`App.tsx:360–362`).
- **Restore flow.** `App.tsx:932–967`: quest blob gates everything
  (`restoreGeneratedPlayFromSlot`, def `App.tsx:284–293`), then
  `restoreGeneratedRoomCacheFromSlot` (`App.tsx:295–343`) re-validates the cache
  blob and rebuilds cache/navigation/pregenerator. `restoreGeneratedRoomCache`
  (`app/restoreGeneratedRoomCache.ts:13–40`) **skips** any entry whose room fails
  `loadRoomSpec`, so `restoredRoomIds` (`:19,33,37`) holds only rooms actually
  rehydrated into the cache plus the current room. `loaded.state.rooms` is
  available in the slot wrapper but its entries carry no objective data today.
- **Objective content is already bounded/sanitized at generation time**
  (`assembleObjective`, `GENERATED_OBJECTIVE_TEXT_MAX_LENGTH` — the quest blob
  reuses these bounds for `hints`).

## 3. Final behavior

- **Save (generated play only):** each saved cache entry for a visited room may
  carry that room's memoized objective attachment. Rooms whose memo is `null`
  (or absent) save without an objective — exactly as today.
- **Load:** after the ADR-0059 quest restore succeeds and the cache blob
  validates, the memo is seeded by iterating `restoredRoomIds` **only** (the
  rooms `restoreGeneratedRoomCache` actually rehydrated — never the objective
  map's own keys), so a room skipped by `loadRoomSpec` can never leave an orphan
  objective memo entry. For each restored non-current room id: its entry's
  objective is parsed/validated **separately** during restore/projection — a
  valid, room-matching objective seeds the attachment; a missing, malformed, or
  mismatched objective seeds `null` (today's behavior). The current room's
  objective still comes from `generatedQuestJson` (single source; the cache
  entry for the current room carries no objective). If a tampered current-room
  cache entry includes an `objective`, restore ignores that field entirely; the
  quest blob remains the source.
- **Backtrack after load:** entering a restored room re-applies its restored
  attachment via the existing `readPerRoomObjectiveMemo` path; `evaluateQuest`
  over restored `WorldState` flags shows correct done/active state (object ids
  in the parked `RoomSpec` already match surviving flags, per ADR-0059/0060).
  Completion is always re-derived from `WorldState`; it is never stored on the
  attachment.
- No objective regeneration on load or backtrack; no meter movement; old saves
  and authored saves behave byte-identically to today.

## 4. Safety boundaries

- **Authority unchanged.** The extended blob remains non-authoritative byte
  parking gated by `generatedQuestJson`. Objective *completion* is never stored
  — it is always re-derived from restored `WorldState` flags via `evaluateQuest`
  (storing it would create a second source of truth).
- **Lenient objective, strict room (B1).** The `objective` field on
  `SavedGeneratedRoomEntry` is accepted **leniently** so a malformed `objective`
  sub-object never fails the whole cache entry (and never the whole cache blob):
  the room still restores under the existing ADR-0060 cache-restore behavior.
  Objective parsing/validation happens **separately** during restore/projection
  via a dedicated `safeParse` (bounded `QuestSpec` + non-empty, ≤160 hint/
  completionHint). If that `safeParse` fails, that room's objective seeds `null`;
  the room is unaffected. If the room entry itself is invalid, the room follows
  existing cache-restore behavior (skipped by `loadRoomSpec`, not in
  `restoredRoomIds`, so no objective is seeded either). Honest saves only ever
  emit valid objective attachments, so this degradation is a tamper/corruption
  guard, not a normal path.
- **`objectiveMatchesRoom` cross-check (B2).** After the objective `safeParse`
  succeeds, a pure `objectiveMatchesRoom(questSpec, room): boolean` gates the
  attach. It returns `true` only when **all** hold, else `false`:
  - `questSpec.anchorRoomId === room.id`; and, for the objective's condition:
  - `room-flag` `interaction:<objectId>` → `condition.roomId === room.id` **and**
    `<objectId>` resolves to a real interactable object in that room's
    `RoomSpec`;
  - `room-flag` `encounter:<encounterId|objectId>` → `condition.roomId ===
    room.id` **and** the flag suffix resolves to a real encounter
    target/reference supported by the room/objective model (i.e. some object
    whose derived `encounter:${encounter.id ?? objectId}` equals the flag);
  - `room-visited` → `condition.roomId === room.id` **or** the current room has
    an exit whose `toRoomId === condition.roomId`;
  - unknown/unmatchable condition kind → `false`.

  `objectiveMatchesRoom` **only** protects objective restore: it mutates no
  `WorldState`, appends no event, and never blocks the room. A mismatched or
  tampered objective degrades to `null` and the room still restores. Objective
  **completion** is still re-derived from restored `WorldState` via
  `evaluateQuest`, never stored.
- **No provider calls during load** — parse-only, mirroring ADR-0059/0060; the
  restore path continues to never call `recordAttempt`, `warmAdjacent`-with-real
  -provider, or objective generation.
- **No raw objective JSON exposure.** The blob is never logged; the UI renders
  only through the existing `QuestTracker`/hint projections. New logs are
  count-only (e.g. `generated objectives restored { count, droppedCount }`).
- **Existing behavior preserved.** ADR-0060 cache restore, provenance handling,
  cap 16, null-memo suppression for objective-less rooms, and the authored path
  are unchanged.
- **No schema explosion.** One optional (leniently-accepted) field on the
  existing `SavedGeneratedRoomEntrySchema`; both blob `schemaVersion`s stay `1`;
  no new sidecar, no `SaveGame`/`WorldState`/`RoomSpec`/`QuestSpec` version
  change, no DB/schema migration.
- **Objective text bounds.** Cached `objective.hint` / `objective.completionHint`
  mirror the generated-objective constraints (`generatedObjectiveSpec.ts:27–28`):
  **non-empty, ≤160 chars**. Empty strings are not allowed for cached non-current
  room objectives (the empty-hint case exists only for the current room sourced
  from the quest blob, which is never written into a cache entry).

## 5. Non-goals

- ❌ Regenerating objectives for rooms that lack one (cost policy unchanged).
- ❌ Persisting objective completion status, resolved-object sets, or hints
  history beyond `{ questSpec, hint, completionHint }`.
- ❌ Restoring warmed/unvisited rooms or changing the 16-room cap/ordering.
- ❌ A third sidecar blob or a cross-blob objective index.
- ❌ Gate (`providerGate`/`providerGateStatus`) persistence — gates re-derive at
  navigation time (ADR-0063) and are out of scope.
- ❌ Changing live-play memo semantics, `attachPerRoomObjectiveOnEnter`, or the
  usage guard.

## 6. File-level change plan

| File | Change |
| --- | --- |
| `apps/web/src/domain/quests/generatedRoomCacheSaveState.ts` | Add a **separate** `SavedGeneratedRoomObjectiveSchema` = strict `{ questSpec: QuestSpecSchema, hint: non-empty ≤160, completionHint: non-empty ≤160 }` (bounds from `GENERATED_OBJECTIVE_TEXT_MAX_LENGTH`, mirroring the quest blob). `SavedGeneratedRoomEntrySchema` gains an optional `objective` accepted **leniently** (e.g. `z.unknown().optional()`) so a malformed objective never fails the entry/array/blob; the strict `SavedGeneratedRoomObjectiveSchema` is applied at restore, not at blob parse. `buildGeneratedRoomCacheSaveState` input entries gain optional `objective`, validated by the strict objective schema **at build time** and passed through into the built entry. `schemaVersion` stays `1`. |
| `apps/web/src/domain/quests/generatedRoomCacheSaveState.test.ts` | Schema/build/load coverage: strict objective at build; lenient acceptance at blob parse (malformed objective ⇒ blob still valid, room preserved); load round-trip. |
| `apps/web/src/domain/quests/objectiveMatchesRoom.ts` (new, or co-located export) | Pure `objectiveMatchesRoom(questSpec, room): boolean` per §4 (B2): `anchorRoomId === room.id`; `room-flag interaction:<objectId>` ⇒ `condition.roomId === room.id` **and** `<objectId>` is a real interactable object in the room; `room-flag encounter:<encounterId\|objectId>` ⇒ `condition.roomId === room.id` **and** the suffix resolves to a real encounter reference in the room/objective model; `room-visited` ⇒ `condition.roomId === room.id` **or** the room has an exit to `condition.roomId`; unknown/unmatchable ⇒ `false`. Reuses the same room-derivation logic `assembleObjective` uses. Pure, no `WorldState`. |
| `apps/web/src/app/App.helpers.ts` | `buildGeneratedRoomCacheSaveJson` gains a `memo: PerRoomObjectiveMemo` input and attaches `objective` to each **non-current** visited entry whose memo attachment is non-null. The current-room entry never carries an objective. |
| `apps/web/src/app/App.helpers.test.ts` | Save-projection tests. |
| `apps/web/src/App.tsx` | `handleSave` passes `perRoomObjectiveMemoRef.current`; `restoreGeneratedRoomCacheFromSlot` also returns `restoredObjectives: Map<string, GeneratedObjectiveQuestAttachment>` built from `loaded.state.rooms` by, per entry, `safeParse` against `SavedGeneratedRoomObjectiveSchema` and then `objectiveMatchesRoom` (either failing ⇒ entry omitted from the map); `seedRestoredGeneratedObjectiveMemo` gains that map and, **iterating `restoredRoomIds` only** (skipping the current room id), seeds the mapped attachment where present else `null`. Current room still seeds from the quest blob. |
| `apps/web/src/App.test.tsx` / restore tests | Wiring assertions (see §10). |

### Minimum Safe Change Check

- **Reused:** the entire ADR-0060 blob/validation/restore pipeline, the live
  memo mechanics, `evaluateQuest`, existing hint bounds, existing degradation
  ladder (corrupt blob → current-room-only restore → authored fallback).
- **New code:** one leniently-accepted optional entry field + one strict
  `SavedGeneratedRoomObjectiveSchema` applied at build/restore, one pure
  `objectiveMatchesRoom` cross-check, one map threaded through save/restore.
- **Boundaries unchanged:** authority, cost, logging redaction, cap 16.
- **Targeted tests:** §10.

## 7. Data/state model changes

`SavedGeneratedRoomEntry` (inside the existing `generatedRoomCacheJson` blob,
localStorage-only, non-authoritative):

```ts
{
  room: RoomSpec,
  provenance: 'generated' | 'repaired' | 'fallback',
  // NEW, optional. Accepted leniently at blob parse (a malformed value does not
  // fail the entry). Validated separately against the strict shape below at
  // build time and at restore; on failure the room still restores, objective ⇒ null.
  objective?: {
    questSpec: QuestSpec,       // QuestSpecSchema
    hint: string,               // non-empty, ≤ GENERATED_OBJECTIVE_TEXT_MAX_LENGTH (160)
    completionHint: string,     // non-empty, ≤ 160
  },
}
```

No persisted-truth schema changes anywhere; no version bump, no DB/schema
migration. The lenient acceptance is only for forward/tamper resilience — honest
saves always write a strictly-valid `objective` or none.

## 8. Save/load implications

- **Old saves (no `objective` fields):** parse fine (field optional) → memo
  `null` seeding → exactly today's behavior. Explicit test.
- **New saves read by older code (forward-compat only):** the entry schema is
  `.strict()` in the **old** reader, so an entry carrying an `objective` key
  fails parse there → the **whole cache blob** is ignored by old code → ADR-0059
  current-room-only restore (still playable — the same class of forward-incompat
  every strict blob already has). The ADR must record this accepted tradeoff vs.
  bumping the blob `schemaVersion` (which would degrade old readers identically
  via `unsupported-version`). This whole-blob drop is **old-reader behavior
  only**; new code degrades per-entry (next bullet).
- **Corrupt/tampered objective (new code):** because new code accepts `objective`
  leniently at blob parse, a malformed `objective` sub-object does **not** fail
  the entry, the array, or the blob — the room restores normally. The dedicated
  objective `safeParse` (strict shape) or the `objectiveMatchesRoom` cross-check
  then fails for that entry, so only **that room's objective** degrades to `null`;
  every other restored room is unaffected. A tampered objective on the current
  room's cache entry is ignored even if otherwise valid, because the current-room
  objective is sourced only from `generatedQuestJson`.
- **Objective on a room that fails `loadRoomSpec`:** the room is skipped by
  `restoreGeneratedRoomCache` and absent from `restoredRoomIds`, so seeding never
  visits it and its objective is silently dropped with the room (no orphan memo).
- Authored saves: no blobs, byte-identical, unchanged.

## 9. Provider/LLM implications

None at runtime for this feature: save is a pure projection of the memo; load
is parse-only. The restored attachments were provider-generated **before** the
save and were already metered then. The suppression of regeneration cost on
backtrack (memo `null`) is preserved for objective-less rooms.

## 10. Tests required

**Required cases (must all be present):**

- **Round-trip — objective attached to a non-current generated cached room:**
  save projects the memo attachment onto that entry; restore seeds it; backtrack
  re-attaches quest + hints.
- **Old saves without `objective` still load:** parse fine → non-current rooms
  seed `null` (regression / today's behavior).
- **Schema-valid but semantically mismatched objective ⇒ room restores,
  objective `null`** (`objectiveMatchesRoom` fails; room unaffected).
- **Malformed objective sub-object ⇒ room restores, objective `null`** (lenient
  blob parse; strict objective `safeParse` fails; room unaffected; no blob drop).
- **Current-room cache objective ignored ⇒ current objective comes from the
  quest blob** (even a valid/tampered current-entry objective is not used).
- **Encounter objective round-trip** (`room-flag encounter:<…>` condition).
- **`room-visited` objective round-trip** (including the adjacent-room-target
  case where `condition.roomId !== room.id` but an exit exists).
- **Interaction-object objective round-trip** (`room-flag interaction:<…>`).
- **Cap/eviction:** >16 cached rooms each with an objective ⇒ only 16 entries
  saved (current first, no objective); the evicted room **and its objective** are
  absent; on backtrack the evicted room regenerates (existing ADR-0060 behavior).
- **Restored completion is re-derived from `WorldState`, not stored:**
  `evaluateQuest` over restored flags shows the pre-save done/active state; the
  attachment carries no completion field.
- **No side effects on load/backtrack:** spy asserts **no** provider/objective-
  generator call, **no** `WorldState` mutation/event append, **no** memory write,
  **no** dialogue side effect; captured-logger sweep finds no objective
  text/ids/hints in logs.

**Supporting coverage:**

- Schema/build: strict objective validated at build (overlong hint, empty hint,
  invalid quest spec, extra keys rejected **at build**); blob parse accepts a
  malformed objective leniently (blob stays valid, room preserved); blob-level
  caps unchanged.
- `objectiveMatchesRoom`: each B2 branch — `anchorRoomId` mismatch, `room-flag`
  `roomId` mismatch, missing interaction object, encounter-suffix match/mismatch,
  `room-visited` self vs. exit-target vs. unreachable, unknown condition kind.
- Save projection: memo attachment → entry `objective` for visited non-current
  rooms; memo `null`/absent → no field; current room's entry never carries one;
  authored play → no blob.
- Restore wiring: seeding iterates `restoredRoomIds` only (a room skipped by
  `loadRoomSpec` leaves no orphan objective memo entry); missing cache blob →
  ADR-0059 current-room-only behavior.

## 11. Manual smoke checklist

1. Generated play (fake, no key): visit rooms A→B→C collecting per-room
   objectives; complete A's objective; Save in C; reload browser; Continue;
   backtrack C→B→A → each room shows its objective; A shows completed state.
2. A room that legitimately had no objective (generation returned null) still
   shows none after load, and no generation fires on entering it.
3. Old save from before this feature: loads, backtrack shows no objectives
   (today's behavior), no errors.
4. Real provider (BYOK): load and backtrack cause zero network requests and no
   meter movement.
5. No raw quest/objective JSON in console or UI.

## 12. Rollback notes

Single revert. New-format saves keep loading in the reverted app **minus** the
cache blob (strict-parse failure → current-room-only restore) — acceptable and
identical to the forward-incompat story in §8. No migration, no schema-version
rollback.

## 13. Implementation slices

1. **Docs (this plan)** — review checkpoint.
2. **Domain:** lenient `objective` entry field + strict
   `SavedGeneratedRoomObjectiveSchema` (build/restore validation) +
   `objectiveMatchesRoom` (+tests).
3. **Save path:** memo → blob projection in `App.helpers`/`handleSave` (+tests).
4. **Restore path:** objectives map out of `restoreGeneratedRoomCacheFromSlot`,
   memo seeding (+tests); closeout docs + **ADR** + manual smoke.

## 14. Dependencies on earlier/later features

- **Depends on (shipped):** ADR-0059, ADR-0060, generated-objective-per-room-v0.
- Independent of features 7/8/9/10; feature 9 may record a deferred
  tampered-blob attack case once this ships.

## 15. Open questions / risks

- **Resolved — optional field vs. blob `schemaVersion` bump:** use the optional
  (leniently-accepted) field. Both degrade old readers to current-room-only
  restore, but the optional field keeps old saves readable by new code without a
  dual-version loader.
- **Resolved — degradation granularity (B1):** malformed objective data
  degrades **per-entry** in new code (room still restores, objective ⇒ `null`);
  the whole-blob drop is old-reader forward-compat only. See §4, §8.
- **Resolved — `objectiveMatchesRoom` definition (B2):** explicit per-condition
  match (anchor + room-flag/interaction, room-flag/encounter, room-visited); see
  §4. Object-id-in-`RoomSpec` alone is insufficient.
- **Resolved — current room's cache entry does not carry its objective:** single
  source per room — the current-room objective comes only from the quest blob.
- **Memo staleness at save time:** the memo holds the last attachment per room;
  if a future feature ever mutates hints mid-room, the memo/questHintsRef could
  diverge. Today they cannot; note as an invariant in the ADR.
- **16-room cap interaction:** rooms evicted from the cache blob lose both room
  and objective and regenerate fresh on deep backtracking (existing ADR-0060
  behavior) — the objective for a regenerated room may then be regenerated (and
  metered) as a *new* room entry. Unchanged, but worth restating in the ADR.
