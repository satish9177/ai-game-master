# ADR-0070: Runtime Room Memory Persistence v0

- **Status:** Accepted - Implemented (manual smoke pending maintainer verification)
- **Date:** 2026-07-02
- **Deciders:** Project owner
- **Extends:**
  [ADR-0025](./ADR-0025-living-world-room-memory-v0.md) (room memory is inert,
  scoped supporting context),
  [ADR-0059](./ADR-0059-generated-quest-save-load-v0.md) and
  [ADR-0060](./ADR-0060-generated-room-cache-save-load-v0.md) (browser save-slot
  sidecar pattern),
  [ADR-0065](./ADR-0065-real-npc-dialogue-room-memory-awareness-v0.md) (dialogue
  may read bounded, hedged room-memory context).

> Full implementation closeout lives in
> [`runtime-room-memory-persistence-v0`](../implementation-plans/runtime-room-memory-persistence-v0.md).

---

## Context

Living-World Room Memory v0 added the headless room-memory contracts, firewall,
service, in-memory adapter, and SQLite adapter, but browser runtime play still
held room memory only in an `InMemoryRoomMemoryStore` inside `App`. The browser
Save/Continue/Load flow restored authoritative `WorldState` while dropping the
runtime room-memory store, so NPC dialogue room-memory awareness could forget
promoted room observations after a load.

Generated quest and generated room cache restore already established a safe
localStorage pattern: keep `saveGameJson` authoritative, and park optional
sidecar bytes in the `SlotWrapper` that are re-validated later by feature-owned
helpers. Runtime room memory persistence follows that same pattern.

---

## Decision

Persist browser runtime room memory across Save/Continue/Load with an optional
`roomMemoryJson` `SlotWrapper` sidecar. The sidecar is non-authoritative byte
parking only. It is parsed, schema-validated, filtered, and restored into the
runtime `InMemoryRoomMemoryStore` after authoritative `WorldState` load
succeeds.

This feature also keeps the safety hardening added during implementation:
runtime room-memory text is normalized to one safe line before storage, and
restore drops unsafe or tampered sidecar records rather than repairing them.

No SQLite adapter, database migration, `SaveGame` schema, `WorldState` schema,
`RoomMemoryStore` port, reducer, event, quest, gate, item, flag, dialogue
effect, provider path, or memory ranking/recall semantic changed.

---

## roomMemoryJson Sidecar Shape

`SlotWrapper` now permits:

```ts
{
  saveGameJson: string
  generatedQuestJson?: string
  generatedRoomCacheJson?: string
  roomMemoryJson?: string
}
```

`roomMemoryJson` is a serialized `RoomMemorySaveState`:

```ts
{
  schemaVersion: 1,
  records: RoomMemoryRecord[]
}
```

The blob is built by the pure `domain/memory/roomMemorySaveState` helpers. It is
bounded to the newest 8 memories per room and 128 memories total, with
deterministic ordering/drop behavior. Empty snapshots or snapshots whose records
do not survive filtering omit the sidecar.

`saveSlotStore` carries `roomMemoryJson` through as bytes. It does not parse or
trust the contents.

---

## Live Memory Text Line-Safety

`validateRoomMemoryDraft` normalizes room-memory text to a single safe line
before a memory is stored:

- ASCII control characters, including newline, carriage return, and tab, become
  spaces;
- repeated whitespace collapses;
- leading/trailing whitespace is trimmed;
- the existing 280-character bound remains;
- text that becomes empty is rejected as `empty-text`.

This closes the live path where generated room/object display text could have
introduced line breaks into inert memory text and, later, into the real dialogue
provider's background memory section. Prompt rendering also keeps recalled
memory lines from fabricating section headers.

No raw rejected or normalized memory text is logged.

---

## Restore Filtering

Restore treats `roomMemoryJson` as untrusted local bytes:

- malformed JSON returns `invalid-json`;
- wrong versions return `unsupported-version`;
- schema failures return `invalid-schema`;
- records whose `worldId` or `sessionId` does not match the restored
  authoritative `WorldState` are dropped;
- records with `provenance.source === 'llm'` are dropped;
- records whose text still contains newline/control characters are dropped, not
  normalized;
- `roomId` is deliberately not cross-checked against loaded rooms.

Missing, invalid, unsupported, or tampered sidecars degrade to an empty room
memory store while the game load continues.

---

## InMemoryRoomMemoryStore Snapshot/Restore

`InMemoryRoomMemoryStore` has adapter-only helpers:

- `snapshotAll(): RoomMemoryRecord[]`
- `restoreAll(records: readonly RoomMemoryRecord[]): void`

These helpers are not part of the `RoomMemoryStore` port. They exist only for
browser runtime save/load wiring. `restoreAll` replaces the current in-memory
contents after re-validating records through `RoomMemoryRecordSchema`; invalid
records are silently dropped by the adapter.

Because restored records preserve `seq` and `dedupeKey`, later live writes keep
the existing sequence and dedupe behavior.

---

## App Save/Load Ordering

Save path:

1. `SaveGameService.saveSession` writes the authoritative save JSON.
2. `App` reads current `WorldState` to obtain the current `worldId/sessionId`
   scope.
3. `App` snapshots the runtime `InMemoryRoomMemoryStore`.
4. The pure helper builds `roomMemoryJson` for records matching that scope.
5. `saveSlotStore.write` parks the optional sidecar beside the existing save
   bytes.

Load path:

1. `saveSlotStore.read` returns `saveGameJson` plus optional sidecars.
2. `SaveGameService.loadSession` restores authoritative session state.
3. `WorldSession.getWorldState` returns the restored authoritative
   `worldId/sessionId`.
4. The runtime room-memory store is cleared.
5. A valid `roomMemoryJson` is parsed, filtered, and restored.
6. Generated-play sidecars and view state are restored.
7. `refreshDerivedViews(state)` runs, which triggers the existing room-memory
   recall path against the freshly restored or empty store.

This ordering prevents stale memories from a previous in-app session from
surviving a load and makes restored memories visible to the existing recall
path immediately after load.

---

## Authority And Scoping

Room memory remains supporting context only:

- no `WorldState` mutation;
- no `WorldEvent` append;
- no `WorldCommand` emission;
- no reducer, quest, gate, item, flag, or dialogue-effect change;
- no memory-to-truth promotion path.

Restore scope is `(worldId, sessionId)`. Records outside the restored
authoritative world/session are dropped. `roomId` is intentionally not checked
against loaded rooms because room memory is inert context, not room truth, and
`roomId` has never been an FK to rooms in ADR-0025.

---

## Logging

New diagnostics are safe counts and reason/status codes only, such as restored
count, dropped count, and fixed invalid-sidecar reason. Logs must not include:
memory text, room names, object names, NPC names, generated JSON,
`roomMemoryJson`, provider prompts/responses, player lines, dialogue text, API
keys, secrets, or PII.

---

## Consequences And Limitations

- Runtime browser room memory now survives the existing local Save/Continue/Load
  flow.
- Old saves without `roomMemoryJson` continue to load and simply restore an
  empty room-memory store.
- New saves with `roomMemoryJson` still keep `saveGameJson` as the only
  authoritative payload.
- The feature does not provide cross-session/global memory, backend APIs,
  browser-to-SQLite memory persistence, summarization, vector search, memory UI,
  forgetting/eviction, or LLM-written memory.
- The sidecar is tamperable localStorage data, so restore is intentionally
  strict and drops unsafe records.
- Manual smoke is pending maintainer verification.

---

## Manual Smoke Pending

The implementation has automated coverage for save-state helpers, store
snapshot/restore, save-slot parking, App save/load wiring, stale memory reset,
scope drops, unsafe/tampered record drops, and dedupe preservation. Maintainer
manual smoke remains pending for the browser Save/Continue/Load experience and
console log review.
