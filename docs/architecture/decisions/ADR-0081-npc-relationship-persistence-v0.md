# ADR-0081: NPC Relationship Persistence v0

- **Status:** Proposed - Docs-First (design approved; not implemented)
- **Date:** 2026-07-06
- **Deciders:** Project owner
- **Extends:**
  [ADR-0070](./ADR-0070-runtime-room-memory-persistence-v0.md) (runtime save-slot
  sidecar pattern),
  [ADR-0059](./ADR-0059-generated-quest-save-load-v0.md) and
  [ADR-0060](./ADR-0060-generated-room-cache-save-load-v0.md) (browser save-slot
  sidecar pattern),
  [ADR-0077](./ADR-0077-relationship-valence-reducer-v0.md) (relationship reducer
  + closed delta table),
  [ADR-0079](./ADR-0079-relationship-visible-feedback-v0.md) (relationship
  visible feedback).

> Full design + slice breakdown lives in
> [`npc-relationship-persistence-v0`](../implementation-plans/npc-relationship-persistence-v0.md).
> This ADR documents the approved design direction before implementation.

---

## Context

NPC->player relationship state (`NpcRelationshipState`: `trust`, `respect`,
`fear`, `familiarity`) is produced by the pure bounded reducer
(`domain/npcRelationship/reducer.ts`) and held only in an ephemeral, in-memory
`relationshipsRef: Map<string, NpcRelationshipState>` inside `App`. At runtime
today only the neutral structural signals emit, so `familiarity` accrues while
`trust`/`respect`/`fear` stay dry (per
[ADR-0077](./ADR-0077-relationship-valence-reducer-v0.md)).

The browser Save/Continue/Load flow restores authoritative `WorldState` but
drops `relationshipsRef`, so accrued relationship state is forgotten across
save/load/reload. Tone-only dialogue projection and the transient relationship
feedback therefore reset even for an NPC the player has already spoken with in
the same world/session.

Generated quest, generated room cache, and runtime room memory already
established a safe localStorage pattern: keep `saveGameJson` authoritative, and
park optional sidecar bytes in the `SlotWrapper` that are re-validated later by
feature-owned helpers. Runtime relationship persistence follows that same
pattern.

---

## Decision

Persist browser runtime NPC->player relationship state across
Save/Continue/Load with a new optional `npcRelationshipJson` `SlotWrapper`
sidecar. The sidecar is non-authoritative byte parking only. It is parsed,
schema-validated, scope-filtered, and restored (re-seeded) into the ephemeral
`relationshipsRef` after authoritative `WorldState` load succeeds.

A new pure module `apps/web/src/domain/npcRelationship/relationshipSaveState.ts`
owns the versioned envelope, per-record validation reusing
`NpcRelationshipStateSchema`, strict drop-on-malformed behavior, scope filter,
deterministic hard cap, and fixed reason codes. It imports only `zod` and
sibling `domain/npcRelationship` contracts and exports no `WorldCommand`/
`WorldEvent`-producing function.

No SQLite adapter, database migration, `SaveGame` schema, `WorldState` schema,
`NpcRelationshipState` schema, reducer, event, quest, gate, item, flag,
dialogue-effect, provider, prompt, or feedback-derivation change.

---

## npcRelationshipJson Sidecar Shape

`SlotWrapper` will permit:

```ts
{
  saveGameJson: string
  generatedQuestJson?: string
  generatedRoomCacheJson?: string
  roomMemoryJson?: string
  npcRelationshipJson?: string
}
```

`npcRelationshipJson` is a serialized versioned envelope containing full
validated records:

```ts
{
  schemaVersion: 1, // NPC_RELATIONSHIP_SAVE_SCHEMA_VERSION (envelope)
  records: NpcRelationshipState[]
}
```

Each record is a full `NpcRelationshipState` (existing contract), including
`scope { worldId, sessionId, npcId }`, `subject: 'npc'`, `object: 'player'`,
`axes { trust, respect, fear, familiarity }`, and `interactionCount`. The blob
is built by the pure `relationshipSaveState` helpers, bounded by a deterministic
record cap. Empty snapshots, or snapshots whose records do not survive filtering,
omit the sidecar. `saveSlotStore` carries the bytes through; it does not parse or
trust the contents.

Persisting the full record (rather than a trimmed `{ npcId, axes }` shape) keeps
`scope` for cross-world filtering, preserves the `subject`/`object` literals and
per-axis bounds, and lets validation reuse the existing
`NpcRelationshipStateSchema` instead of a bespoke axes validator. The record
carries no free-text field, which makes raw-text leakage impossible by
construction.

---

## Validation And Load Rules

Restore treats `npcRelationshipJson` as untrusted local bytes:

- malformed JSON returns `invalid-json`;
- an unknown/unsupported envelope `schemaVersion` returns `unsupported-version`
  and the sidecar is ignored;
- each record is validated with `NpcRelationshipStateSchema`; a record that
  fails validation is **dropped whole - never field-repaired** (no missing-axis
  defaulting, no unknown-axis stripping, no clamp-repair);
- records whose `scope.worldId` or `scope.sessionId` does not match the restored
  authoritative `WorldState` are dropped;
- a deterministic hard record cap bounds payload size.

Load ordering:

1. `saveSlotStore.read` returns `saveGameJson` plus optional sidecars.
2. `SaveGameService.loadSession` restores authoritative session state.
3. `WorldSession.getWorldState` returns the restored authoritative
   `worldId/sessionId`.
4. `relationshipsRef` is cleared (already reset at load start).
5. A valid `npcRelationshipJson` is parsed, filtered to the restored
   `worldId/sessionId`, and its surviving records are re-seeded into
   `relationshipsRef`, **rekeyed by `record.scope.npcId`**.

Restore respects the existing `requestVersion` guard, does **not** call the
reducer, and does **not** call feedback derivation. Missing, invalid,
unsupported, or tampered sidecars degrade to an empty relationship map while the
game load continues.

Save happens only at the existing manual `handleSave` moment (no autosave):
snapshot `relationshipsRef.current`, scope-filter to the current authoritative
`{worldId, sessionId}`, build the blob, and park it. This applies to all play
modes (authored and generated), gated only on a non-empty snapshot.

---

## Authority And Scoping

Relationship state remains a non-authoritative projection:

- no `WorldState` mutation;
- no `WorldEvent` append;
- no `WorldCommand` emission;
- no memory write;
- no fact / `fact_visibility` write;
- no reducer, quest, gate, item, flag, or dialogue-effect change;
- no projection-to-truth promotion path.

Restore is a **projection re-seed**. It does not prove history and does not
create events, facts, or memories. Restore scope is `(worldId, sessionId)`;
records outside the restored authoritative world/session are dropped. `npcId` is
intentionally **not** cross-checked against loaded rooms, because relationship
state is inert projection context, not room/NPC truth - mirroring the
room-memory sidecar's no-`roomId` cross-check.

---

## Feedback And Dialogue

- **Hydration is silent.** Re-seeding `relationshipsRef` must not emit the
  relationship familiarity feedback line; `handleLoad` already resets the
  feedback slot, and restore must not derive from or disturb it. Only future
  gameplay reducer movements can produce feedback.
- **Dialogue projection is unchanged.** The existing bucketed/tone-only
  relationship projection into dialogue context continues; no raw axis score,
  delta, or `interactionCount` leaks into any prompt.

---

## Logging

New diagnostics are safe counts and reason/status codes only, such as restored
count, dropped count, drop-by-scope count, and fixed invalid-sidecar reason.
Logs must not include: raw axis values, raw `npcRelationshipJson`, dialogue
text, prompt text, provider output, structured-effect payloads, feedback text,
reason text, bucket-crossing detail, NPC names, player text, API keys, secrets,
or PII. `npcId` and `familiarityBucket` may appear, consistent with the existing
`deriveAndReduceRelationship` log.

---

## Relationship To Prior Room-Memory Sidecar Pattern

This feature is a direct application of
[ADR-0070](./ADR-0070-runtime-room-memory-persistence-v0.md):

- same `SlotWrapper` sidecar mechanism (`saveSlotStore` parks bytes only);
- same pure feature-owned serializer/parser with a versioned envelope, strict
  re-validation, deterministic caps, scope filter, and fixed reason codes
  (`relationshipSaveState.ts` mirrors `roomMemorySaveState.ts`);
- same restore ordering (authoritative `WorldState` first, then re-seed the
  runtime projection scoped to the restored `worldId/sessionId`);
- same strict "drop unsafe/tampered records, do not repair" posture;
- same omit-when-empty and byte-identical-older-wrapper behavior.

The key difference is the payload: relationship records are closed, numeric,
free-text-free `NpcRelationshipState` objects validated by an existing schema,
whereas room memory carries text that requires line-safety normalization. The
relationship record needs no text normalization because it has no text.

---

## Why This Is Not WorldState / Memory / Fact / Event Authority

- The relationship contract (`contracts.ts`) is explicit: the state is a
  non-authoritative projection, never a `WorldEvent`, `WorldCommand`,
  `WorldState` field, memory record, or fact.
- Authoritative truth changes only by appending a validated `WorldEvent` and
  projecting it ([ADR-0013](./ADR-0013-world-state-event-log-v0.md)). A
  localStorage sidecar has no such path and gains none here.
- Putting relationship data into `WorldState` would create a second source of
  truth and break event-log reconstruction/integrity.
- The sidecar restores into an in-memory ref that only feeds tone-only dialogue
  projection and transient feedback - both already non-authoritative surfaces.

---

## Alternatives Considered

- **Separate localStorage key.** Rejected: fragments the save; the `SlotWrapper`
  keeps sidecars atomic with `saveGameJson`, avoiding desync.
- **`WorldState` mutation.** Rejected and forbidden: turns a non-authoritative
  projection into truth, violating ADR-0013 and the relationship contract.
- **New SQLite table / schema / migration.** Rejected for v0: browser gameplay
  is in-memory and cannot import persistence; would force forbidden backend
  wiring.
- **Memory / fact / event persistence.** Rejected: relationship persistence must
  not write memory, facts, `fact_visibility`, events, or commands; it is a
  projection re-seed with no path to truth.
- **Trimmed `{ npcId, axes }` shape.** Rejected: drops `scope` (needed for
  cross-world filtering) and `interactionCount`, invents a non-existent `target`
  field, and forces a bespoke axes validator instead of reusing
  `NpcRelationshipStateSchema`.

---

## Safety Boundaries

- **Relationship state remains a non-authoritative projection.** Restore cannot
  mutate `WorldState`, append events, issue commands, write memory/facts, or
  change quests/gates/items/flags/dialogue effects.
- **Authoritative state is unchanged.** `WorldSession`, the event log, the
  projected `WorldState`, and the `SaveGame` schema are untouched.
- **No SQLite / database change.** Browser relationship persistence uses only a
  local save-slot sidecar.
- **Schemas unchanged.** `NpcRelationshipState`, `WorldState`, and `SaveGame`
  schemas are unchanged; the sidecar reuses `NpcRelationshipStateSchema` for
  per-record validation and adds only its own independent envelope version.
- **Scope is strict by world/session.** Restore drops records whose `worldId` or
  `sessionId` does not match the restored authoritative state. `npcId` is not
  cross-checked against loaded rooms.
- **Unsafe restore input drops.** Malformed, unsupported, or schema-invalid
  records are dropped, not repaired.
- **Hydration is silent.** Re-seeding emits no relationship feedback.
- **No raw content logging.** New logs carry safe status, reason codes, and
  counts only.

---

## Non-Goals

- No relationship-driven hostility, chase, or routine behavior.
- No NPC-to-NPC relationships.
- No autosave; persistence happens only at manual save.
- No raw dialogue, prompt, provider output, structured-effect payload, feedback
  text, raw reason text, or bucket text persistence.
- No new prompt exposure of raw scores/deltas; dialogue projection stays
  bucket/tone-only.
- No backend API, browser-to-SQLite persistence, cross-session/global
  relationship store, relationship UI beyond the existing transient feedback, or
  LLM-proposed scores.

---

## Consequences And Limitations

- Browser runtime relationship state (today, familiarity) will survive the
  existing local Save/Continue/Load flow.
- Old saves without `npcRelationshipJson` continue to load and simply restore an
  empty relationship map.
- New saves with `npcRelationshipJson` still keep `saveGameJson` as the only
  authoritative payload.
- The sidecar is tamperable localStorage data, so restore is intentionally
  strict and drops unsafe records; a tampered high value is non-authoritative and
  cosmetic, bounded by schema.
- The feature does not provide cross-session/global relationships, backend APIs,
  browser-to-SQLite persistence, or relationship history.
- This ADR is docs-first; implementation, tests, and manual smoke follow after
  maintainer approval and a clean-main confirmation.
