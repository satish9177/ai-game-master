# Implementation Plan - `feature/npc-relationship-persistence-v0`

> Status: **DESIGN APPROVED / DOCS-FIRST / NOT IMPLEMENTED.**
> ADR: [ADR-0081](../decisions/ADR-0081-npc-relationship-persistence-v0.md).
> Companion docs: [ARCHITECTURE](../ARCHITECTURE.md) ·
> [BOUNDARIES](../BOUNDARIES.md) · [AGENTS.md](../../../AGENTS.md).
> Direct precedents:
> [ADR-0070](../decisions/ADR-0070-runtime-room-memory-persistence-v0.md)
> (runtime save-slot sidecar pattern),
> [ADR-0059](../decisions/ADR-0059-generated-quest-save-load-v0.md) and
> [ADR-0060](../decisions/ADR-0060-generated-room-cache-save-load-v0.md)
> (browser save-slot sidecar pattern),
> [ADR-0077](../decisions/ADR-0077-relationship-valence-reducer-v0.md)
> (relationship reducer + delta table),
> [ADR-0079](../decisions/ADR-0079-relationship-visible-feedback-v0.md)
> (relationship visible feedback).

## Status

**DESIGN APPROVED / DOCS-FIRST / NOT IMPLEMENTED.** This plan is written before
any runtime code, module, or test. No `App.tsx`, `saveSlotStore.ts`, or domain
runtime file is changed by this docs slice. Implementation begins only after
maintainer approval and a clean-main confirmation.

## Problem Statement

NPC->player relationship state (`NpcRelationshipState`: `trust`, `respect`,
`fear`, `familiarity`) is produced by the deterministic bounded reducer
(`domain/npcRelationship/reducer.ts`) and held only in an ephemeral, in-memory
`relationshipsRef: Map<string, NpcRelationshipState>` inside `App`. At runtime
today only the neutral structural signals emit, so `familiarity` accrues while
`trust`/`respect`/`fear` stay dry (per
[ADR-0077](../decisions/ADR-0077-relationship-valence-reducer-v0.md)).

The browser Save/Continue/Load flow restores authoritative `WorldState` but
drops `relationshipsRef`. As a result, accrued relationship state (today,
familiarity) is forgotten across save/load/reload, so tone-only dialogue
projection and the transient relationship feedback reset even for an NPC the
player has already spoken with in the same world/session.

The runtime-room-memory persistence feature
([ADR-0070](../decisions/ADR-0070-runtime-room-memory-persistence-v0.md))
already established a safe, non-authoritative localStorage sidecar for exactly
this class of ephemeral runtime state. Relationship persistence follows that
pattern precisely.

## Current Chain / Context

Completed chain leading here:

1. sqlite-fts-memory-retrieval-v0
2. facts-and-fact-visibility-v0
3. npc-memory-dialogue-context-v0
4. dialogue-semantic-events-v0
5. structured-dialogue-effects-v0
6. npc-relationship-state-v0
7. build-health-known-red-cleanup-v0
8. world-clock-v0
9. valenced-dialogue-effect-candidates-v0
10. time-context-and-day-night-presentation-v0
11. relationship-valence-reducer-v0
12. lazy-room-environment-transitions-v0
13. relationship-visible-feedback-v0
14. **npc-relationship-persistence-v0** (this plan)

Parallel work: Chat B owns `feature/npc-patrol-route-v0`
([ADR-0080](../decisions/ADR-0080-npc-patrol-route-v0.md)). This feature must not
assume or depend on patrol-route changes and must not collide with its ADR
number.

Relevant existing code (for reference only; not modified by this docs slice):

- `domain/npcRelationship/contracts.ts` - `NpcRelationshipState`,
  `NpcRelationshipStateSchema`, `NPC_RELATIONSHIP_SCHEMA_VERSION`, axis schemas.
- `domain/npcRelationship/neutral.ts` - `neutralRelationship(scope)`.
- `domain/npcRelationship/reducer.ts` - pure `applyRelationshipEffects`, bounds,
  monotonic familiarity, `MAX_INTERACTION_COUNT`.
- `app/deriveAndReduceRelationship.ts` - inert runtime seam; safe count/bucket
  logging.
- `App.tsx` - `relationshipsRef` (created; reset on new prompt and on load
  start; written by the reducer path; read by `getRelationshipContextForNpc`),
  `handleSave`/`handleLoad`, `requestVersion` guard, relationship feedback slot.
- `app/saveSlotStore.ts` - `SlotWrapper` with optional
  `generatedQuestJson`/`generatedRoomCacheJson`/`roomMemoryJson`.
- `domain/memory/roomMemorySaveState.ts` - the reference serializer/parser this
  feature mirrors.
- `app/App.helpers.ts` - `restoreRuntimeRoomMemoryFromSlot` (the reference
  restore helper).

## Final Storage Decision

Persist browser runtime NPC->player relationship state across
Save/Continue/Load with a new **optional `npcRelationshipJson` `SlotWrapper`
sidecar**. The sidecar is non-authoritative byte parking only. It is parsed,
schema-validated, scope-filtered, and restored (re-seeded) into the ephemeral
`relationshipsRef` after authoritative `WorldState` load succeeds.

A new pure module `apps/web/src/domain/npcRelationship/relationshipSaveState.ts`
owns the versioned envelope, per-record validation (reusing
`NpcRelationshipStateSchema`), strict drop-on-malformed behavior, scope filter,
deterministic hard cap, and fixed reason codes. It imports only `zod` and
sibling `domain/npcRelationship` contracts. It exports no `WorldCommand`/
`WorldEvent`-producing function.

No SQLite adapter, database migration, `SaveGame` schema, `WorldState` schema,
`NpcRelationshipState` schema, reducer, event, quest, gate, item, flag,
dialogue-effect, provider, or feedback-derivation change.

## Rejected Storage Options

- **Separate localStorage key.** Rejected: fragments the save. The `SlotWrapper`
  bundles sidecars so they save/clear atomically with `saveGameJson`. A separate
  key can desync (relationship survives a cleared save, or vice-versa).
- **`WorldState` mutation.** Rejected and forbidden. Relationship state is
  explicitly non-authoritative (`contracts.ts`). Writing it into `WorldState`
  would make a projection into truth, violating the append-only event-log
  authority ([ADR-0013](../decisions/ADR-0013-world-state-event-log-v0.md)) and
  the relationship contract's non-authoritative stance.
- **New SQLite table / schema / migration.** Rejected for v0. Browser gameplay
  is in-memory and cannot import persistence (reciprocal lint walls, BOUNDARIES).
  This would force backend wiring AGENTS forbids without explicit approval.
- **Memory / fact / event persistence.** Rejected. Relationship persistence must
  not write NPC/room memory, facts, `fact_visibility`, `WorldEvent`s, or
  `WorldCommand`s. It is a projection re-seed only, with no path to truth.

## Persistence Shape

`SlotWrapper` gains one optional field:

```ts
{
  saveGameJson: string
  generatedQuestJson?: string
  generatedRoomCacheJson?: string
  roomMemoryJson?: string
  npcRelationshipJson?: string
}
```

`npcRelationshipJson` parks a serialized versioned envelope containing **full**
validated `NpcRelationshipState` records (not a trimmed custom shape):

```ts
{
  schemaVersion: 1, // NPC_RELATIONSHIP_SAVE_SCHEMA_VERSION (envelope version)
  records: NpcRelationshipState[]
}
```

Each record is a full `NpcRelationshipState` as already defined in
`domain/npcRelationship/contracts.ts`:

```ts
{
  schemaVersion: 1, // NPC_RELATIONSHIP_SCHEMA_VERSION (record version)
  scope: { worldId: string, sessionId: string, npcId: string },
  subject: 'npc',
  object: 'player',
  axes: { trust: number, respect: number, fear: number, familiarity: number },
  interactionCount: number
}
```

Notes:

- The envelope `schemaVersion` is a new, independent constant
  (`NPC_RELATIONSHIP_SAVE_SCHEMA_VERSION`), distinct from the per-record
  `NPC_RELATIONSHIP_SCHEMA_VERSION`, mirroring `ROOM_MEMORY_SAVE_SCHEMA_VERSION`
  vs `RoomMemoryRecord`'s own version.
- Persisting the full record keeps `scope` (needed for cross-world filtering),
  `subject`/`object` literals, per-axis bounds, and `interactionCount`, so no
  reconstruction/normalization is required on load. Reuse the existing
  `NpcRelationshipStateSchema` for validation rather than a bespoke axes
  validator.
- The record structurally carries no free-text field, which is the safety
  property that makes raw-text leakage impossible by construction.

## Authority Model

- The persisted blob is **non-authoritative byte parking**. Restore is a
  **projection re-seed** of `relationshipsRef` only.
- It is never a `SaveGame` field, `WorldState` field, `WorldEvent`,
  `WorldCommand`, memory record, or fact.
- It does **not** prove history and does **not** create events, facts, or
  memories. It cannot mutate truth; only reducers and the event log mutate truth.
- Exactly as non-authoritative as the live `relationshipsRef` it re-seeds.

## Validation Rules

- Parse `npcRelationshipJson`; malformed JSON returns `invalid-json`.
- Read the version envelope; an unsupported/unknown `schemaVersion` returns
  `unsupported-version` and the sidecar is ignored.
- Validate each record with `NpcRelationshipStateSchema`.
- **Strict drop, never field-repair.** Any record that fails schema validation
  is dropped whole. No missing-axis defaulting, no unknown-axis stripping, no
  clamp-repair (the `.strict()` schema already enforces axis bounds, literals,
  and shape).
- **Scope filter:** drop any record whose `scope.worldId` or `scope.sessionId`
  does not match the restored authoritative `WorldState`.
- **Deterministic hard cap:** cap the number of persisted/restored NPC records
  (e.g. a fixed `NPC_RELATIONSHIP_SAVE_MAX_RECORDS`), truncated in a deterministic
  order, to bound payload size against a poisoned/huge save.
- **Empty result omits the sidecar.** When no record survives the save filters,
  the builder returns `null` and the wrapper key is omitted entirely, keeping the
  wrapper byte-identical to the older format.

## Save Lifecycle

- **Manual save only.** There is no autosave. Persistence happens only at the
  existing user-triggered `handleSave` moment.
- Snapshot `relationshipsRef.current` values at save time.
- Scope-filter to the current authoritative `{worldId, sessionId}` (read from
  `WorldSession.getWorldState`, as the room-memory sidecar already does).
- Build `npcRelationshipJson` via the pure module; apply the deterministic cap;
  omit the key when nothing survives.
- Park it through `saveSlotStore.write` beside the existing save bytes. Applies
  to **all play modes** (authored and generated), gated only on non-empty
  snapshot - not on `objectivesPerRoom`.

## Load Lifecycle

- Restore only **after** the restored world/session identity is known
  (`SaveGameService.loadSession` then `WorldSession.getWorldState`).
- Clear `relationshipsRef` (already reset at load start in `handleLoad`) before
  re-seeding.
- Parse + validate the sidecar; filter surviving records by the restored
  `{worldId, sessionId}`.
- **Rekey the surviving records by `record.scope.npcId`** into
  `relationshipsRef.current` (the live map is keyed by `npcId`).
- Respect the existing `requestVersion` guard: only seed the ref if the load
  request is still current.
- **Do not call the reducer.** Restore assigns records directly; it never routes
  through `applyRelationshipEffects`/`deriveAndReduceRelationship`.
- **Do not call feedback derivation.** Restore never routes through
  `relationshipFeedbackAfterReduction`; hydration is silent (see below).
- Missing, invalid, unsupported, or tampered sidecars degrade to an empty
  relationship map while the game load continues.

## Feedback Interaction

- **Hydration is silent.** Re-seeding `relationshipsRef` must not emit the
  relationship familiarity feedback line. `handleLoad` already resets the
  feedback slot to the room-entry state; restore must not touch it or derive from
  it.
- Only **future gameplay reducer movements** (a real post-load bucket crossing
  through `relationshipFeedbackAfterReduction`) can produce visible feedback.
- The first post-load reducer tick behaves normally against the re-seeded prior
  state.

## Dialogue Interaction

- The existing bucketed/tone-only relationship projection into dialogue context
  continues unchanged.
- No raw axis scores, deltas, or `interactionCount` leak into any prompt; the
  projection remains bucket/tone-only, exactly as today.

## Logging / Debug Safety

- New diagnostics are **safe counts and status/reason codes only**: restored
  count, dropped count, drop-by-scope count, and fixed invalid-sidecar reason
  codes, mirroring the room-memory restore log.
- Logs must **not** include: raw axis values, `interactionCount` values as scores,
  raw `npcRelationshipJson`, dialogue text, prompt text, provider output,
  structured-effect payloads, feedback text, reason text, bucket-crossing detail,
  NPC names, player text, API keys, secrets, or PII.
- `npcId` may appear in logs (an id, not a name), consistent with the existing
  `deriveAndReduceRelationship` log. `familiarityBucket` may be logged (already
  logged today), but raw axis integers must not.

## Implementation Slices

| Slice | Scope | Deliverable |
| --- | --- | --- |
| 1 | Pure save-state module | `domain/npcRelationship/relationshipSaveState.ts`: `NPC_RELATIONSHIP_SAVE_SCHEMA_VERSION`, `NPC_RELATIONSHIP_SAVE_MAX_RECORDS`, `buildNpcRelationshipSaveJson(records, scope)`, `loadNpcRelationshipSaveState(json)`, `filterRestorableRelationships(records, scope)`; strict validation via `NpcRelationshipStateSchema`; fixed reason codes; deterministic cap. **+ pure unit tests.** |
| 2 | Save-slot sidecar field | Add optional `npcRelationshipJson` to `SlotWrapper`, `SlotReadResult`, `write(...)`, `isSlotWrapper`, and both bindings; carry through as bytes only; byte-identical wrapper when omitted. **+ tests.** |
| 3 | App restore helper | `app/App.helpers.ts`: add `restoreNpcRelationshipsFromSlot({...})` returning surviving records + safe counts + status, mirroring `restoreRuntimeRoomMemoryFromSlot`. **+ tests.** |
| 4 | App manual save/load wiring | `App.tsx`: build `npcRelationshipJson` from `relationshipsRef` at manual save; re-seed `relationshipsRef` (rekey by npcId) at load respecting `requestVersion`, without reducer or feedback derivation; safe count logging. **+ tests.** |
| 5 | Safety / regression tests | Authority-leak, raw-text-leak, cross-world-leak, feedback-silence, and prompt bucket-only continuity tests (extend the redteam/evaluation families where they exist). |
| 6 | Docs closeout | Flip this plan and ADR-0081 to Implemented; add manual smoke results; add the ARCHITECTURE.md status entry at closeout per repo convention. |

## Test Plan

Pure module (Slice 1):

- Round-trip: build from valid records -> parse -> identical validated records.
- Strict drop: a record with an out-of-bounds axis / wrong literal / missing
  field is dropped; valid siblings survive.
- Unsupported version envelope -> `unsupported-version`, sidecar ignored.
- Malformed JSON -> `invalid-json`.
- Scope filter: records outside `{worldId, sessionId}` dropped.
- Deterministic cap: more than the cap -> truncated deterministically.
- Empty survivors -> builder returns `null` (sidecar omitted).
- Serialized JSON contains only ids, the `'npc'`/`'player'` literals,
  `schemaVersion`, and integer axes/`interactionCount` - no free text.

Save-slot (Slice 2):

- Wrapper omits `npcRelationshipJson` when not provided (byte-identical to older
  format); reads back through when present; unknown/older wrappers still load.

Restore helper + App (Slices 3-4):

- Save under world A / load restored world A -> records re-seeded, rekeyed by
  npcId.
- Save under world A / load restored world B -> all A records dropped by scope;
  `relationshipsRef` empty.
- `requestVersion` race: a superseded load does not seed the ref.
- Reset ordering: new prompt never reads the sidecar; load clears before
  re-seeding.

Safety / regression (Slice 5):

- **Authority leak:** restore appends no `WorldEvent`, issues no `WorldCommand`,
  mutates no `WorldState`, writes no memory/fact.
- **Raw-text leak:** built JSON has no free-text values; `NpcRelationshipState`
  carries no free-text field.
- **Cross-world leak:** as above scope tests.
- **Feedback silence:** loading a save with familiarity already in a higher
  bucket emits no `RELATIONSHIP_FAMILIARITY_INCREASED_MESSAGE`; a first post-load
  reducer tick behaves normally.
- **Prompt bucket-only continuity:** dialogue context remains bucket/tone-only;
  no raw axis score reaches the prompt.
- **Corrupt/unsupported sidecar:** ignored safely; map empty; load still
  succeeds.
- **Log safety:** restore logs counts/status/buckets only; no raw axis values or
  sidecar JSON.

## Risks / Drawbacks

- **localStorage is byte parking, not truth.** This is precisely why it is the
  right medium here; the only risk is treating restore as authority, which the
  authority model explicitly forbids.
- **Tamper surface.** A hand-edited slot could set familiarity to its max. Value
  is non-authoritative and drives only tone bucket + transient feedback, so the
  blast radius is cosmetic and capped by schema bounds.
- **Payload / quota.** A fourth sidecar adds bytes; `write` already returns
  `quota-exceeded`. Mitigated by the deterministic hard record cap.
- **Positional-arg creep in `saveSlotStore`.** `write(...)` gains a further
  positional param, continuing an ugly-but-consistent signature. Acceptable for
  v0 (matching the pattern beats a mid-feature refactor); noted as a follow-up.
- **Stale `npcId` records are harmless.** A record for an NPC not in the loaded
  room simply sits in the map until that NPC speaks. `npcId` is deliberately
  **not** cross-checked against loaded rooms, mirroring room memory's no-`roomId`
  cross-check.

## Must-Not-Forget Edge Cases

- **Reset ordering** on new prompt and on load: `relationshipsRef` is cleared
  before restore; restore runs only after the clear and only for scope-matching
  records. A brand-new prompt world must never read the sidecar.
- **`requestVersion` race:** seed the ref only if the load request is still
  current.
- **Hydration feedback silence:** seed the ref directly; never route hydration
  through the feedback deriver; do not disturb the feedback slot beyond the
  existing load reset.
- **Malformed / corrupt JSON:** `invalid-json`, ignored safely.
- **Unsupported version:** ignored safely.
- **Scope mismatch:** dropped by the scope filter.
- **Empty map omits the sidecar** (byte-identical wrapper).
- **`interactionCount` continuity:** persisted and restored; the reducer's
  `MAX_INTERACTION_COUNT` clamp still applies on the next live reduction.
- **ADR number collision with Chat B:** this feature uses **ADR-0081**;
  patrol-route holds **ADR-0080**.

## Rollback Notes

The sidecar key is optional. Reverting the feature leaves existing save slots
loadable because older wrapper readers ignore unknown keys. No database
migration, authoritative schema change, or backend rollback is required.
