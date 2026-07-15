# ADR-0094: Validated Meaningful Object Consequences v0

- Status: Proposed for Slice C implementation review
- Date: 2026-07-15
- Extends: ADR-0093, Deterministic Meaningful Object Interactions v0

## Context

ADR-0092 defined a data-only object-purpose vocabulary and a dry generation-time
validator. ADR-0093 implemented deterministic runtime interactions for generated
documents, containers, and remains. Slice B can change object state and grant one
validated item atomically, but it deliberately cannot reveal a clue, satisfy a
generated objective, or project either consequence into the journal.

Slice C adds only those validated consequences. It does not make prose,
providers, the renderer, the UI, memory, facts, or the journal authoritative.
`WorldSession` current state plus its append-only event log remain the source of
truth. The existing `meaningful-object-applied` command/event remains the single
semantic event so object state, item, clue, and objective effects can be
validated and committed atomically.

## Decision

This ADR authorizes Slice C only.

### Scope

Slice C permits a validated consequence attachment on an eligible ADR-0093
`read` or `search` interaction. An attachment may reveal one clue, satisfy one
objective, or do both. It may coexist with the ADR-0093 object-state transition
and validated item reward.

The existing `meaningful-object-applied` command/event is extended with optional
fields. No second semantic event is introduced. Existing Slice B commands and
events remain valid because all Slice C fields are optional.

### Strict consequence catalog

The minimum data-only contracts are:

```ts
type ClueSpec = Readonly<{
  id: string
  sourceObjectId: string
}>

type MeaningfulObjectConsequenceAttachment = Readonly<{
  objectId: string
  action: 'read' | 'search'
  clueId?: string
  objective?: Readonly<{
    objectiveId: string
    toStage: 1
  }>
}>

type MeaningfulObjectConsequenceCatalog = Readonly<{
  schemaVersion: 1
  clues: readonly ClueSpec[]
  consequences: readonly MeaningfulObjectConsequenceAttachment[]
}>
```

The catalog validator uses strict parsing and rejects the complete catalog when
any of these rules fail:

- object, clue, and objective IDs are non-empty;
- an attachment is unique by `(objectId, action)`;
- a clue definition is unique by `(clueId, sourceObjectId)`;
- every attached clue resolves to exactly one definition whose `sourceObjectId`
  equals the attachment's `objectId`;
- every attachment contains at least one of `clueId` or `objective`;
- `open` cannot have an attachment and only `read` and `search` are accepted;
- unknown fields fail strict parsing; and
- duplicate or ambiguous entries reject the complete catalog.

Different source objects may reference the same clue ID. Discovery remains
set-like by clue ID, while source validation remains exact by the pair
`(clueId, sourceObjectId)`. Duplicate identical source/clue pairs are invalid.

The catalog is a trusted, validated sidecar. Slice C may add its contracts,
validator, accepting seams, one deterministic acceptance fixture, and
persistence/restoration. It does not synthesize attachments, infer them from
prose, call a provider, change a prompt, or wire the ADR-0092 purpose graph into
runtime.

### One persistence owner

The generated room-cache/loaded-room sidecar is the single canonical owner of a
room's validated consequence catalog because the catalog is per-room and keyed
by stable room object IDs. The generated quest sidecar continues to own only the
validated `QuestSpec`. The runtime combines the restored room catalog with the
restored current generated quest when validating an objective consequence.

The same catalog must not be copied into the generated quest sidecar. Restored
catalog data is strictly parsed and semantically revalidated against the
restored room and, for objective attachments, the current restored generated
quest. An absent or invalid catalog is treated as no Slice C catalog and
preserves Slice B behavior. Old sidecars therefore remain compatible.

### Requested command

The command describes the complete trusted attachment requested for the
interaction:

```ts
type MeaningfulObjectAppliedCommand = Readonly<{
  schemaVersion: 1
  type: 'meaningful-object-applied'
  roomId: string
  objectId: string
  family: 'document' | 'container' | 'remains'
  action: 'read' | 'open' | 'search'
  item?: InventoryItem
  clueId?: string
  objective?: Readonly<{
    objectiveId: string
    toStage: 1
  }>
}>
```

`InteractionService` derives `item`, `clueId`, and `objective` from trusted,
validated room data. The renderer and UI supply only object/action intent and
never supply consequence fields. `WorldSession` resolves the trusted attachment
again and requires exact equality. Omitting a catalog-declared consequence,
adding an undeclared consequence, or changing any declared value fails closed.
ADR-0093 item equality and action rules continue to apply.

### Applied event

The event records only consequences that actually changed authoritative state:

```ts
type MeaningfulObjectAppliedEvent = Readonly<{
  id: string
  worldId: string
  type: 'meaningful-object-applied'
  at: string
  payload: Readonly<{
    roomId: string
    objectId: string
    family: 'document' | 'container' | 'remains'
    action: 'read' | 'open' | 'search'
    state: 'read' | 'open' | 'looted'
    item?: InventoryItem
    clueId?: string
    objective?: Readonly<{
      questId: string
      objectiveId: string
      toStage: 1
    }>
  }>
}>
```

This notation shows the Slice C payload on the existing project event envelope;
it does not define another envelope. Trusted code derives `state` and
`objective.questId`.

The requested command and applied event intentionally differ:

- a newly discovered clue is included as `payload.clueId`;
- an already-known clue is omitted from the event;
- an objective that changes from stage 0 to stage 1 is included as
  `payload.objective`;
- an already-satisfied objective is omitted from the event; and
- the event may still include the object-state transition and item reward when
  a clue or objective arm is an idempotent no-op.

Closed feedback such as `You already knew this clue.` or
`That objective was already satisfied.` may be derived from authoritative
pre-state and the command result. Such feedback does not become an event or a
journal entry.

### Objective authority and binary progression

Slice C has only binary objective progression:

- stage 0 means unsatisfied;
- stage 1 means satisfied; and
- the only legal target is the literal `toStage: 1`.

An objective is already at stage 1 when its existing validated quest condition
is satisfied or its canonical Slice C objective flag exists. An attached
already-satisfied objective is an idempotent no-op; it does not reject other
valid effects in the same interaction. A genuine multi-stage objective model is
outside this decision.

Objective consequences are permitted only when all of the following are true:

- the quest is the current validated generated-play quest;
- `quest.anchorRoomId === command.roomId`;
- the target objective exists in that quest; and
- the command requests exactly `toStage: 1`.

The event builder derives `questId`. The objective flag is written into
`event.payload.roomId`, which is both the source object's room and the validated
quest anchor room. Cross-room objective progression is not supported. Authored
quests, demo quests, unrelated quests, quests from another room/world/session,
and objectives selected by UI input or prose cannot be progressed by this path.

### Canonical authoritative flags

Central pure helpers construct the only Slice C flag keys:

```ts
const meaningfulClueFlagKey = (clueId: string): string =>
  `meaningful-clue:${encodeURIComponent(clueId)}`

const meaningfulObjectiveFlagKey = (
  questId: string,
  objectiveId: string,
): string =>
  `meaningful-objective:${encodeURIComponent(questId)}:${encodeURIComponent(objectiveId)}:stage-1`
```

Modules must not manually reconstruct these keys. Encoding is binding and must
be tested with IDs containing colons, slashes, percent characters, spaces, and
Unicode.

A clue is known when its canonical clue flag exists in any room state in the
current `WorldState` for the current world/session. Discovery is set-like by clue
ID. This projection reads no journal entry, memory, fact, fact visibility,
provider output, or generated clue prose.

### Binding validation and commit order

One interaction follows this exact order:

1. Load a fresh snapshot.
2. Check the expected revision.
3. Strictly parse the command.
4. Require the current room to match `command.roomId`.
5. Resolve exactly one stable object in the current room.
6. Validate generated-play eligibility.
7. Validate family, action, and current object state.
8. Resolve exactly one trusted consequence attachment.
9. Require the command consequences to equal the attachment.
10. Validate clue source and definition.
11. Validate the current generated quest and objective.
12. Validate the optional item using ADR-0093 rules.
13. Determine which clue/objective consequences are newly applicable.
14. Derive object state, quest ID, and the applied event payload.
15. Apply all actual consequences to one next snapshot.
16. Commit one event and one snapshot through optimistic compare-and-set.

Steps 8-11 govern a `read` or `search` with a trusted Slice C attachment. An
ADR-0093 interaction with no attachment, including `open`, takes the unchanged
Slice B branch and must omit every Slice C command field.

Any failure before commit produces no object flag, inventory item, clue flag,
objective flag, event, or journal entry. Replay applies the event's object,
item, clue, and objective fields to one next state. There is no partial success.

### Journal projection

The consequence journal remains a replay-derived, read-only projection over the
authoritative event log. Storage is unchanged. It emits only:

- a newly applied `payload.clueId` -> `You discovered a clue.`; and
- a newly applied `payload.objective` -> `You advanced an objective.`.

It emits nothing for an already-known clue, already-satisfied objective,
rejected command, stale revision, object state alone, or item reward alone.
Clues and objectives dedupe independently by their authoritative identities.
Entry IDs are deterministic and collision-safe across replay; event sequence
plus consequence kind is an acceptable source. Internal IDs are never rendered
to the player. A bounded display cap may hide older projected entries but must
never remove authoritative clue or objective flags.

### Persistence, replay, and compatibility

Slice C adds no `WorldState` field, save envelope, SQLite schema, migration,
backend event union, journal store, memory store, or fact store. The extended
shared event schema remains the schema used by browser save/load, in-memory and
SQLite event storage, server routes, replay, and snapshot projection.

Existing Slice B events have no Slice C fields and continue to parse and replay
unchanged. Old saves and room-cache sidecars have no catalog and retain Slice B
behavior. New catalog-bearing room-cache sidecars are strictly validated on
load. Authoritative clue/objective flags survive room return and save/load via
the existing snapshot/event-log path.

## Consequences

Slice C gains deterministic clue discovery, binary generated-objective
completion, and truthful journal projection without adding another semantic
event or source of truth. Exact catalog equality and applied-only event fields
prevent caller escalation and false journal claims. The cost is a narrow
backward-compatible expansion of the shared command/event schema and one
validated per-room sidecar owned by the room cache.

## Explicit exclusions

ADR-0094 does not authorize automatic consequence attachment, provider or
prompt changes, clue prose as authority, facts or `fact_visibility` mutation,
memory promotion, dialogue unlocks, clue clusters, confidence or reliability,
player hypotheses, multi-stage objectives, authored quest progression,
cross-room objective progression, machines, barricades, exit unlocking, or
Slice D.
