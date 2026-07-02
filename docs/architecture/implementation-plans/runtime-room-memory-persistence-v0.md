# Implementation Plan - `feature/runtime-room-memory-persistence-v0`

> Status: **Implemented - manual smoke pending maintainer verification.**
> ADR: [ADR-0070](../decisions/ADR-0070-runtime-room-memory-persistence-v0.md).
> Companion docs: [ARCHITECTURE](../ARCHITECTURE.md) ·
> [BOUNDARIES](../BOUNDARIES.md) · [AGENTS.md](../../../AGENTS.md).
> Direct precedents:
> [ADR-0025](../decisions/ADR-0025-living-world-room-memory-v0.md),
> [ADR-0059](../decisions/ADR-0059-generated-quest-save-load-v0.md), and
> [ADR-0060](../decisions/ADR-0060-generated-room-cache-save-load-v0.md).

## Summary

Runtime room memories created during browser play now survive
Save/Continue/Load through an optional `roomMemoryJson` `SlotWrapper` sidecar.
The sidecar is byte parking only. It is never authoritative state, never a
`SaveGame` field, never a `WorldEvent`, and never read by reducers.

The implementation also includes the safety hardening identified during plan
review: live room-memory text is normalized to one safe line before storage,
and restored sidecar records with unsafe control/newline text are dropped
rather than repaired.

Manual smoke is still pending maintainer verification.

## Final Behavior

- Room memories recorded through the existing deterministic promotion path can
  be snapshotted from the runtime `InMemoryRoomMemoryStore`.
- Saving parks a bounded, versioned `roomMemoryJson` blob alongside
  `saveGameJson`, `generatedQuestJson`, and `generatedRoomCacheJson` only when
  memories survive the save-state filters.
- Loading first restores authoritative `WorldState`; then the room-memory
  runtime store is cleared; then a valid `roomMemoryJson` sidecar is
  re-validated, filtered to the restored `worldId/sessionId`, and restored.
- Missing, invalid, unsupported, or tampered sidecars degrade to an empty room
  memory store while the game load continues.
- Existing recall/ranking semantics are unchanged. After load,
  `recallRoomMemoryContext` uses the restored memories through the existing
  service path.
- No visible UI, feedback UI, provider behavior, usage-meter behavior, SQLite
  adapter, database migration, `RoomMemoryStore` port, `WorldState` reducer,
  event, quest, gate, item, flag, or dialogue effect changed.

## Sidecar Shape

`SlotWrapper` now permits:

```ts
{
  saveGameJson: string
  generatedQuestJson?: string
  generatedRoomCacheJson?: string
  roomMemoryJson?: string
}
```

`roomMemoryJson` parks:

```ts
{
  schemaVersion: 1,
  records: RoomMemoryRecord[]
}
```

The parked state is bounded by `ROOM_MEMORY_SAVE_MAX_PER_ROOM = 8` and
`ROOM_MEMORY_SAVE_MAX_TOTAL = 128`. It is built only from records that match
the current save scope when a `worldId/sessionId` scope is provided.

## Completed Slices

| Slice | Status | Commit ref | Notes |
| --- | --- | --- | --- |
| 1. Docs safety amendment | Complete | `3e966b6` | Added the line-safety hardening slice to the plan before persistence wiring. |
| 2. Room memory text line-safety | Complete | `afc3918` | Live memory text is normalized to one safe line; prompt rendering keeps memory lines from fabricating section headers. |
| 3. Pure `roomMemoryJson` save-state module | Complete | `afc3918` | Added versioned build/load/filter helpers with strict schema validation and safe fixed reason codes. |
| 4. `InMemoryRoomMemoryStore` snapshot/restore | Complete | `4e542af` | Added adapter-only `snapshotAll`/`restoreAll`; the `RoomMemoryStore` port stayed unchanged. |
| 5. App save/load wiring | Complete | `c588a23` | Wired `roomMemoryJson` into browser save/load using the in-memory adapter helpers. |
| 6. Docs closeout | Complete in working tree | Uncommitted | ADR-0070 + architecture update + this closeout. Manual smoke remains pending. |

## Safety Boundaries

- **Memory remains supporting context only.** Restored memories cannot mutate
  `WorldState`, append events, issue commands, change quests, change gates,
  write item/flag/dialogue effects, or become room truth.
- **Authoritative state is unchanged.** `WorldSession`, the event log, and the
  projected `WorldState` remain the only truth path. `SaveGame` schema is
  unchanged.
- **No SQLite/database change.** Browser runtime memory persistence uses only a
  local save-slot sidecar. `SqliteRoomMemoryStore`, migrations, and backend
  persistence are untouched.
- **Port unchanged.** `snapshotAll` and `restoreAll` are adapter-only methods on
  `InMemoryRoomMemoryStore`; `RoomMemoryStore` still exposes only `record` and
  `listForRoom`.
- **Scope is strict by world/session.** Restore drops records whose `worldId` or
  `sessionId` does not match the restored authoritative state. `roomId` is not
  cross-checked against loaded rooms.
- **Unsafe restore input drops.** Restore drops `source: 'llm'` records and
  records whose text still contains newline/control characters. It does not
  normalize tampered sidecar text.
- **No raw content logging.** New logs carry safe status, reason codes, and
  counts only. They do not include raw memory text, room names, object names,
  generated JSON, provider prompts/responses, `roomMemoryJson`, player text, or
  PII.

## Verification History

Slice 2/3 verification recorded for `afc3918`:

- `npm.cmd run test -- roomFirewall roomMemorySaveState llmDialoguePrompt`
- `npm.cmd run lint`

Slice 4 verification recorded for `4e542af`:

- `npm.cmd run test -- InMemoryRoomMemoryStore`
- `npm.cmd run lint`

Slice 5 verification recorded for `c588a23`:

- `npm.cmd run test -- App saveSlotStore roomMemorySaveState InMemoryRoomMemoryStore memory`
  - Passed: 47 files, 784 tests.
- `npm.cmd run lint`
  - Passed.
- `npx.cmd tsc --noEmit -p tsconfig.app.json`
  - Failed only in unrelated baseline locations:
    `src/domain/assembleRoom.test.ts`,
    `src/domain/ensureGeneratedNpcPresence.ts`, and
    `src/generation/OpenAICompatibleNPCDialogueProvider.test.ts`.
  - No failures referenced the Slice 5 changed files.

Slice 6 docs closeout verification:

- `git diff --check`
  - Passed. Git reported only existing line-ending normalization warnings for
    edited Markdown files.
- Optional targeted tests/lint were not required for docs-only closeout unless
  re-run by the maintainer.

## Manual Smoke Checklist

Pending maintainer verification:

1. Demo world: trigger an interaction that promotes room memory; confirm the
   NPC memory-awareness behavior appears in dialogue; Save; reload the browser;
   Continue; confirm the same memory-awareness behavior returns.
2. Generated play: trigger a durable room-state change that promotes memory;
   Save; Continue; confirm recall works in that room after restore.
3. Old save created before this feature: Continue loads normally, with no
   console errors and no room memories.
4. Manually corrupt `roomMemoryJson` in localStorage; Continue still loads,
   room memory is empty, and only a safe reason/count log appears.
5. Confirm console logs show counts/reason codes only and never memory text,
   room names, object names, or raw sidecar JSON.
6. Save with zero memories; confirm the localStorage wrapper has no
   `roomMemoryJson` key.

## Consequences And Limitations

- Browser runtime room memory now survives the existing local Save/Continue/Load
  flow.
- The feature does not provide cross-session/global memory, memory UI,
  forgetting/eviction, summarization, vector search, backend memory APIs, or
  SQLite-backed browser memory persistence.
- The sidecar is user-tamperable localStorage data, so restore treats it as
  untrusted input and drops anything unsupported or unsafe.
- `roomId` is deliberately not checked against loaded rooms; memory remains
  inert supporting context even if a room later regenerates differently.
- Manual smoke is still pending.

## Rollback Notes

The sidecar key is optional. Reverting the feature leaves existing save slots
loadable because older wrapper readers ignore unknown keys. No database
migration, authoritative schema change, or backend rollback is required.
