# Implementation Plan — `feature/generated-per-room-objective-save-load-v0`

> Status: **Draft — design for maintainer review. No code written.**
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

- **Live play memo.** `app/App.helpers.ts:27` `PerRoomObjectiveMemo =
  Map<string, GeneratedObjectiveQuestAttachment | null>` where the attachment is
  `{ questSpec, hint, completionHint }` (`app/generatedObjective.ts:6–10`).
  `readPerRoomObjectiveMemo` (`App.helpers.ts:40–54`) re-applies it on
  navigation (`App.tsx:944–953`); `shouldStartPerRoomObjectiveAttach`
  (`App.helpers.ts:56–65`) only generates for rooms **not in the memo**, so a
  memo `null` means "attempted/known — do not regenerate".
- **Save path saves only the current room's objective.**
  `App.tsx:753–761` → `buildGeneratedQuestSaveJson(..., questHintsRef.current)`
  → `GeneratedQuestSaveStateSchema`
  (`domain/quests/generatedQuestSaveState.ts:18–33`: current `room`, optional
  `questSpec`/`storyKind`/`hints`). The memo itself is never persisted.
- **Cache blob saves rooms, not objectives.**
  `buildGeneratedRoomCacheSaveJson` (`App.helpers.ts:152–180`) saves the current
  room + visited cached rooms into `GeneratedRoomCacheSaveStateSchema`
  (`domain/quests/generatedRoomCacheSaveState.ts:21–27`; entries are strict
  `{ room, provenance }`, max `GENERATED_ROOM_CACHE_MAX = 16`).
- **The restore seeds the gap.** `App.tsx:328–346`
  `seedRestoredGeneratedObjectiveMemo`: current room ← quest-blob attachment;
  **every other restored room id ← `null`** — intentionally suppressing both the
  objective UI and any regeneration cost on backtrack (ADR-0060 known
  limitation).
- **Restore flow.** `App.tsx:836–871`: quest blob gates everything
  (`restoreGeneratedPlayFromSlot`), then `restoreGeneratedRoomCacheFromSlot`
  (`App.tsx:278–326`) re-validates the cache blob and rebuilds cache/navigation/
  pregenerator; `loaded.state.rooms` is available there but its entries carry no
  objective data today.
- **Objective content is already bounded/sanitized at generation time**
  (`assembleObjective`, `GENERATED_OBJECTIVE_TEXT_MAX_LENGTH` — the quest blob
  reuses these bounds for `hints`).

## 3. Final behavior

- **Save (generated play only):** each saved cache entry for a visited room may
  carry that room's memoized objective attachment. Rooms whose memo is `null`
  (or absent) save without an objective — exactly as today.
- **Load:** after the ADR-0059 quest restore succeeds and the cache blob
  validates, the memo is seeded per room: entry has an objective → attachment
  restored; entry has none → `null` (today's behavior). The current room's
  objective still comes from `generatedQuestJson` (single source; the cache
  entry for the current room carries no objective). If a tampered current-room
  cache entry includes an `objective`, restore ignores that field; the current
  objective quest blob remains the source.
- **Backtrack after load:** entering a restored room re-applies its restored
  attachment via the existing `readPerRoomObjectiveMemo` path; `evaluateQuest`
  over restored `WorldState` flags shows correct done/active state (object ids
  in the parked `RoomSpec` already match surviving flags, per ADR-0059/0060).
- No objective regeneration on load or backtrack; no meter movement; old saves
  and authored saves behave byte-identically to today.

## 4. Safety boundaries

- **Authority unchanged.** The extended blob remains non-authoritative byte
  parking gated by `generatedQuestJson`. Objective *completion* is never stored
  — it is always re-derived from restored `WorldState` flags via `evaluateQuest`
  (storing it would create a second source of truth).
- **Re-validation on load.** Restored objectives pass `QuestSpecSchema` +
  bounded hint schemas inside the strict entry schema; additionally a pure
  cross-check (`objectiveMatchesRoom`) verifies the quest's target/flag-writing
  object id exists in that entry's own `RoomSpec` — mismatch degrades that
  entry's objective to absent (memo `null`), never an error, never a partial
  attach.
- **No provider calls during load** — parse-only, mirroring ADR-0059/0060; the
  restore path continues to never call `recordAttempt`, `warmAdjacent`-with-real
  -provider, or objective generation.
- **No raw objective JSON exposure.** The blob is never logged; the UI renders
  only through the existing `QuestTracker`/hint projections. New logs are
  count-only (e.g. `generated objectives restored { count, droppedCount }`).
- **Existing behavior preserved.** ADR-0060 cache restore, provenance handling,
  cap 16, null-memo suppression for objective-less rooms, and the authored path
  are unchanged.
- **No schema explosion.** One optional field on the existing
  `SavedGeneratedRoomEntrySchema`; both blob `schemaVersion`s stay `1`; no new
  sidecar, no `SaveGame`/`WorldState`/`RoomSpec`/`QuestSpec` version change.

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
| `apps/web/src/domain/quests/generatedRoomCacheSaveState.ts` | `SavedGeneratedRoomEntrySchema` gains optional strict `objective: { questSpec: QuestSpecSchema, hint: bounded, completionHint: bounded }` (reusing `GENERATED_OBJECTIVE_TEXT_MAX_LENGTH` bounds, mirroring the quest blob). `buildGeneratedRoomCacheSaveState` input entries gain optional `objective`; builder validates via the schema as today. `schemaVersion` stays `1`. |
| `apps/web/src/domain/quests/generatedRoomCacheSaveState.test.ts` | Schema/build/load coverage incl. tampered objective rejection. |
| `apps/web/src/domain/quests/objectiveMatchesRoom.ts` (new, or co-located export) | Pure `objectiveMatchesRoom(questSpec, room): boolean` — the load-time satisfiability cross-check (target object id present in `room.objects`). |
| `apps/web/src/app/App.helpers.ts` | `buildGeneratedRoomCacheSaveJson` gains a `memo: PerRoomObjectiveMemo` input and attaches `objective` to each **non-current** visited entry whose memo attachment is non-null. |
| `apps/web/src/app/App.helpers.test.ts` | Save-projection tests. |
| `apps/web/src/App.tsx` | `handleSave` passes `perRoomObjectiveMemoRef.current`; `restoreGeneratedRoomCacheFromSlot` also returns a validated `restoredObjectives: Map<string, GeneratedObjectiveQuestAttachment>` (built from `loaded.state.rooms`, filtered by `objectiveMatchesRoom`); `seedRestoredGeneratedObjectiveMemo` gains that map and seeds attachments where present, `null` otherwise. |
| `apps/web/src/App.test.tsx` / restore tests | Wiring assertions (see §10). |

### Minimum Safe Change Check

- **Reused:** the entire ADR-0060 blob/validation/restore pipeline, the live
  memo mechanics, `evaluateQuest`, existing hint bounds, existing degradation
  ladder (corrupt blob → current-room-only restore → authored fallback).
- **New code:** one optional schema field, one pure cross-check, one map
  threaded through save/restore.
- **Boundaries unchanged:** authority, cost, logging redaction, cap 16.
- **Targeted tests:** §10.

## 7. Data/state model changes

`SavedGeneratedRoomEntry` (inside the existing `generatedRoomCacheJson` blob,
localStorage-only, non-authoritative):

```ts
{
  room: RoomSpec,
  provenance: 'generated' | 'repaired' | 'fallback',
  objective?: { questSpec: QuestSpec, hint: string, completionHint: string }, // NEW, optional
}
```

No persisted-truth schema changes anywhere.

## 8. Save/load implications

- **Old saves (no `objective` fields):** parse fine (field optional) → memo
  `null` seeding → exactly today's behavior. Explicit test.
- **New saves read by older code:** the entry schema is `.strict()` in the old
  code, so an entry carrying `objective` fails parse → the **whole cache blob**
  is ignored → ADR-0059 current-room-only restore (still playable, documented
  degradation — same class of forward-incompat every strict blob already has).
  The ADR must record this accepted tradeoff vs. bumping the blob
  `schemaVersion` (which would degrade old readers identically via
  `unsupported-version`).
- **Corrupt/tampered objective:** strict schema or `objectiveMatchesRoom`
  failure degrades that entry's objective to absent; the room itself still
  restores. A tampered objective on the current room's cache entry is ignored
  even if it is otherwise valid, because the current-room objective is sourced
  only from `generatedQuestJson`.
- Authored saves: no blobs, byte-identical, unchanged.

## 9. Provider/LLM implications

None at runtime for this feature: save is a pure projection of the memo; load
is parse-only. The restored attachments were provider-generated **before** the
save and were already metered then. The suppression of regeneration cost on
backtrack (memo `null`) is preserved for objective-less rooms.

## 10. Tests required

- Schema: entry with/without `objective` round-trips; overlong hints, invalid
  quest spec, extra keys rejected; blob-level caps unchanged.
- `objectiveMatchesRoom`: match, missing target object, empty objectives.
- Save projection: memo attachment → entry `objective` for visited non-current
  rooms; memo `null`/absent → no field; current room's entry never carries one;
  authored play → no blob (unchanged).
- Restore: valid objectives seed the memo and backtracking re-attaches quest +
  hints (existing navigation path test extended); invalid/mismatched objective
  → that room seeds `null`; missing cache blob → ADR-0059 behavior; old blob
  without objectives → all-null seeding (regression); tampered current-room
  cache entry objective is ignored in favor of the current objective quest blob;
  `evaluateQuest` over restored flags shows pre-save completion state; no
  generator/provider double
  (spy objective generator never called during load or restored-room
  backtrack); captured-logger sweep — no objective text/ids in logs.

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
2. **Domain:** entry schema field + `objectiveMatchesRoom` (+tests).
3. **Save path:** memo → blob projection in `App.helpers`/`handleSave` (+tests).
4. **Restore path:** objectives map out of `restoreGeneratedRoomCacheFromSlot`,
   memo seeding (+tests); closeout docs + **ADR** + manual smoke.

## 14. Dependencies on earlier/later features

- **Depends on (shipped):** ADR-0059, ADR-0060, generated-objective-per-room-v0.
- Independent of features 7/8/9/10; feature 9 may record a deferred
  tampered-blob attack case once this ships.

## 15. Open questions / risks

- **Optional field vs. blob `schemaVersion` bump:** both degrade old readers to
  current-room-only restore; the optional field keeps old saves readable by new
  code without a dual-version loader. Recommend the optional field; maintainer
  to confirm.
- **Should the current room's cache entry also carry its objective** (redundant
  with the quest blob but self-contained)? Recommend no — single source per
  room; confirm.
- **Memo staleness at save time:** the memo holds the last attachment per room;
  if a future feature ever mutates hints mid-room, the memo/questHintsRef could
  diverge. Today they cannot; note as an invariant in the ADR.
- **16-room cap interaction:** rooms evicted from the cache blob lose both room
  and objective and regenerate fresh on deep backtracking (existing ADR-0060
  behavior) — the objective for a regenerated room may then be regenerated (and
  metered) as a *new* room entry. Unchanged, but worth restating in the ADR.
