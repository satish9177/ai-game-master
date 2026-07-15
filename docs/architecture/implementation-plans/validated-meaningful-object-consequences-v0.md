# Validated Meaningful Object Consequences v0 — Slice C Plan

- Status: Documentation review; do not implement application code until approved
- Date: 2026-07-15
- Decision: ADR-0094

## Goal and scope

Implement ADR-0094 as the smallest extension of the completed Slice B path.
Eligible generated-play `read` and `search` interactions may apply one validated
clue and/or one binary generated-objective consequence together with the existing
object-state transition and optional item. The event log remains authoritative,
the journal remains a projection, and an absent or invalid catalog retains Slice
B behavior.

This document is Phase 1 documentation only. It does not authorize code or test
implementation.

## Minimum Safe Change Check

- Reuse: ADR-0093 eligibility and transitions, `InteractionService`, the shared
  `meaningful-object-applied` command/event, `WorldSession`, `applyEvent`, room
  flags, inventory validation, generated quest validation, room-cache sidecar,
  save/load replay, and the existing consequence-journal projection/seam.
- Necessary new code: strict consequence-catalog contracts/validator and central
  flag helpers; optional command/event fields; exact attachment validation;
  atomic clue/objective projection; one room-cache sidecar field; narrow quest
  evaluation and journal projection updates; and one deterministic acceptance
  fixture.
- Unchanged safety boundaries: generated prose and providers cannot determine
  effects; UI/renderer emit intent only; purpose-graph generation remains dry;
  facts and memory remain inert; no browser-to-SQLite path or second event store
  is added.
- Targeted proof: strict catalog validation, requested-versus-applied semantics,
  objective authority, atomic CAS/replay, canonical-key edge cases, sidecar
  compatibility, truthful journal projection, and Slice B regression tests.

## Planned files and responsibilities

Exact colocated test filenames may follow existing naming, but implementation is
limited to these existing seams and one new pure domain module.

| Area | Planned responsibility |
| --- | --- |
| `apps/web/src/domain/objectPurpose/meaningfulObjectConsequences.ts` (new) | Strict catalog contracts/parser, semantic validation, canonical clue/objective key helpers, known-clue and objective-stage projections, and exact attachment lookup/equality helpers. |
| `apps/web/src/domain/world/events.ts` | Add optional requested clue/objective fields to the existing command and optional applied clue/objective fields to the existing event. Keep old Slice B shapes valid. |
| `apps/web/src/domain/world/applyEvent.ts` | Project applied clue and objective flags with the existing object state and item in one next snapshot. |
| `apps/web/src/world-session/WorldSession.ts` | Enforce the binding validation order, exact trusted attachment equality, generated-quest/anchor authority, applied-only payload construction, and one CAS commit. |
| `apps/web/src/interactions/InteractionService.ts` | Resolve the validated current-room catalog, derive complete requested fields, send one command, and return closed feedback from authoritative pre-state/result. |
| `apps/web/src/domain/quests/evaluateQuest.ts` | Treat the current generated objective as satisfied by its existing condition or canonical stage-1 flag without changing authored/demo quest behavior. |
| `apps/web/src/domain/quests/generatedRoomCacheSaveState.ts` | Persist the optional validated consequence catalog as its single canonical sidecar owner. |
| `apps/web/src/app/restoreGeneratedRoomCache.ts` and `apps/web/src/app/App.helpers.ts` | Restore, strictly parse, and revalidate the catalog against the restored room and current generated quest; invalid/absent data degrades to Slice B. |
| `apps/web/src/domain/journal/eventConsequenceJournal.ts`, `apps/web/src/app/eventConsequenceJournalSeam.ts`, and `apps/web/src/app/derivedViews.ts` | Project only newly applied event fields, merge through the existing journal seam, dedupe by consequence identity, and refresh after interaction/room entry/save-load. |
| `apps/web/src/App.tsx` and `apps/web/src/renderer/RoomViewer.tsx` | Pass the validated room catalog through existing composition and render closed result feedback; add no authority or effect derivation. |
| Colocated focused tests and one deterministic acceptance fixture | Prove the matrix below without provider, prompt, facts, memory, or renderer authority. |

`generatedQuestSaveState.ts` and `restoreGeneratedQuestPlay.ts` continue to own
and restore only `QuestSpec`; they must not persist another catalog copy. No
provider, prompt, fact, memory, persistence adapter, SQLite migration, server
union, `RoomSpec`, renderer-engine, or purpose-graph production file changes.
`ARCHITECTURE.md` is not changed in Phase 1.

## Final catalog and schema contracts

The strict catalog is:

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

The final requested command is:

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

The final applied event payload is:

```ts
type MeaningfulObjectAppliedPayload = Readonly<{
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
```

This payload remains inside the existing event envelope. `state` and `questId`
are trusted derivations and are never command inputs.

## Requested versus applied consequences

`InteractionService` derives the full requested consequence shape from the
validated room catalog. `WorldSession` independently resolves exactly one
attachment for `(objectId, action)` and requires exact equality:

- omission of a declared clue or objective rejects;
- addition of an undeclared clue or objective rejects;
- a changed ID or `toStage` rejects; and
- no attachment means the command must contain no Slice C consequence fields.

After validation, `WorldSession` compares the request with authoritative
pre-state. The event contains only newly applied fields. Known clues and
already-satisfied objectives are omitted, while the object's own state change,
validated item, and any other newly applicable consequence still commit. The
result may return closed already-known/already-satisfied feedback, but those
statuses do not create events beyond the valid interaction event and do not
create journal entries.

## Objective policy and authority

The only stages are 0 (unsatisfied) and 1 (satisfied), and only literal
`toStage: 1` is legal. Stage 1 is derived from either the current validated quest
condition or the central objective flag helper.

The consequence path accepts only the current validated generated-play quest,
requires `quest.anchorRoomId === command.roomId`, and requires the objective ID
to exist in that quest. The builder derives `questId`; the flag is stored in
`event.payload.roomId`, so replay has one exact location that is both source room
and quest anchor. Authored/demo, unrelated, cross-room, cross-world/session, UI-
selected, and prose-selected objectives reject. Existing authored/demo quest
evaluation remains unchanged.

## Catalog validation and restoration

Structural validation is strict and rejects unknown keys and non-literal enum
values. Semantic validation rejects empty IDs; duplicate `(objectId, action)`
attachments; duplicate `(clueId, sourceObjectId)` definitions; zero or ambiguous
source-matched clue definitions; empty attachments; and any action other than
`read` or `search`. Different objects may share a clue ID, but each definition
pair must be unique.

Acceptance/restoration additionally verifies stable object resolution,
ADR-0093 generated-play eligibility, compatible family/action, and each attached
objective against the current restored generated quest and its anchor. Any
failure rejects the complete catalog. It is not partially repaired.

The generated room-cache/loaded-room sidecar persists the sole catalog copy.
The generated quest sidecar persists only `QuestSpec`. Old room-cache sidecars
default to catalog absent. Restore revalidates new catalog data against the room
and current quest before exposing it to interactions; absent or invalid data
uses Slice B behavior.

## Canonical keys and projections

One pure module exports and owns:

```ts
meaningfulClueFlagKey(clueId)
// meaningful-clue:${encodeURIComponent(clueId)}

meaningfulObjectiveFlagKey(questId, objectiveId)
// meaningful-objective:${encodeURIComponent(questId)}:${encodeURIComponent(objectiveId)}:stage-1
```

No other module constructs these strings manually. Tests cover colon, slash,
percent, spaces, and Unicode in every encoded identifier position.

Known-clue projection searches canonical clue flags across all room states in
the current `WorldState`; its identity is clue ID, not source object. It reads no
journal, memory, facts, fact visibility, provider output, or prose. Objective
projection reads the canonical flag at the validated anchor/source room and the
existing quest condition.

## Atomic runtime flow

The implementation preserves this binding order:

1. Load a fresh snapshot.
2. Check expected revision.
3. Strictly parse the command.
4. Require current room match.
5. Resolve exactly one stable current-room object.
6. Validate generated-play eligibility.
7. Validate family, action, and current object state.
8. Resolve exactly one trusted consequence attachment.
9. Require command consequences to equal the attachment.
10. Validate clue source and definition.
11. Validate current generated quest and objective.
12. Validate optional item using ADR-0093 rules.
13. Determine which clue/objective consequences are newly applicable.
14. Derive object state, quest ID, and event payload.
15. Apply all actual consequences to one next snapshot.
16. Commit one event and one snapshot through optimistic CAS.

All failure paths stop before append. A valid event replay projects its object
flag, optional inventory item, optional clue flag, and optional objective flag
into one next snapshot. CAS failure commits none. No sequential commands or
partial state are permitted.

## Idempotency and journal behavior

Object terminal flags retain ADR-0093 repeat policy. Clue identity is a set by
clue ID across room states. Objective identity is
`(questId, objectiveId, stage 1)`. Therefore two source objects may share a clue
or objective without duplicating its authoritative consequence; the second
object's own state/item/other consequence may still apply.

The existing event consequence journal projects only actual event fields:

- `payload.clueId` -> `You discovered a clue.`
- `payload.objective` -> `You advanced an objective.`

It emits no entry for an idempotent no-op, rejection, stale revision, object
state alone, or item alone. It dedupes clue and objective identities
independently. Entry IDs are deterministic and collision-safe across replay,
using event sequence plus consequence kind or an equivalently stable scheme.
Internal identifiers never appear in rendered text. The existing bounded display
cap affects projection only and never deletes authoritative flags.

## Feedback

Only closed templates are used. At minimum:

- `You discovered a clue.`
- `You already knew this clue.`
- `You advanced an objective.`
- `That objective was already satisfied.`
- `This interaction is unavailable.`
- `The world changed. Try again.`

If an interaction applies multiple arms, feedback uses one fixed ordering.
Generated prose never selects an effect or a result message. Already-known and
already-satisfied feedback comes from authoritative pre-state/result and never
creates a journal entry.

## Persistence and compatibility

No `WorldState` field or save-envelope shape changes. The optional shared event
fields are accepted by browser save/load, replay, in-memory/SQLite stores, and
server routes through the existing single schema. No migration or second event
union is added.

Old Slice B events remain valid with Slice C fields absent and replay byte-for-
byte with their existing payloads. Old saves and room sidecars have no catalog
and retain Slice B behavior. New sidecars persist one catalog copy and revalidate
it on restore. Room return and save/load preserve applied flags through existing
snapshot/event-log behavior and preserve unapplied attachments through the one
room-cache sidecar.

## Test plan

### Catalog and canonical helpers

1. A valid clue-only, objective-only, and combined attachment parses.
2. Empty object, clue, and objective IDs reject.
3. Duplicate `(objectId, action)` attachments reject the complete catalog.
4. Duplicate `(clueId, sourceObjectId)` definitions reject the complete catalog.
5. A clue with no exact source-matched definition rejects.
6. Ambiguous exact clue/source matches reject.
7. Different source objects may reference the same clue ID.
8. An attachment with neither clue nor objective rejects.
9. `open` and every action other than `read`/`search` reject.
10. Unknown fields at every catalog level reject.
11. Canonical clue/objective keys encode colon, slash, percent, spaces, and
    Unicode without collision.
12. Known-clue projection is set-like across all current-state room flags and
    reads no journal, facts, memory, provider result, or prose.

### Requested command, authority, and applied event

13. A valid new clue appends one event and flag.
14. Repeating the same object action appends nothing.
15. Two objects revealing the same clue produce one clue identity.
16. A missing clue definition fails with no state change.
17. A clue source mismatch fails with no state change.
18. Generated prose cannot alter command or event consequences.
19. Command omission of a catalog-declared clue rejects.
20. Command omission of a catalog-declared objective rejects.
21. A caller-added clue or objective rejects.
22. A changed declared clue/objective value rejects.
23. An already-known clue is omitted from the applied event.
24. A valid item and object state still commit when the clue is already known.
25. Binary objective stage 0 progresses to stage 1 once.
26. Repeated objective progression does not progress again.
27. An already-satisfied objective is omitted from the applied event.
28. A valid clue, item, and object state still commit when the objective is
    already satisfied.
29. Missing and unrelated objectives reject.
30. Backward, skipped, non-integer, stage 0, and greater-than-1 targets reject;
    only literal stage 1 is accepted.
31. A quest-anchor/`roomId` mismatch rejects.
32. Authored/demo objective targeting rejects.
33. Quests or objectives from another room, world, or session reject.
34. A stale revision commits no object, item, clue, objective, or event.
35. A combined valid interaction applies every actual arm atomically.
36. Any invalid arm leaves all authoritative state unchanged.

### Replay, persistence, journal, and boundaries

37. Room return preserves discovered clues and satisfied objectives.
38. Save/load preserves flags and prevents duplicate consequences.
39. Replay reconstructs an identical clue set and objective state.
40. World/session scope prevents cross-world and cross-session leakage.
41. The catalog is persisted in exactly one sidecar.
42. A restored catalog is revalidated against the restored room and current
    generated quest.
43. Old room sidecars without a catalog retain Slice B behavior.
44. Old saves without a catalog retain Slice B behavior.
45. Old Slice B events remain valid and byte-compatible and replay unchanged.
46. Journal projection emits entries only from newly applied event fields.
47. An already-known clue creates no new journal entry.
48. An already-satisfied objective creates no new journal entry.
49. Rejected commands and stale revisions create no journal entry.
50. Object-state-only and item-only events create no Slice C journal entry.
51. Journal clue and objective dedupe is stable and independent across replay.
52. Journal output and feedback expose no internal IDs or payload prose.
53. A bounded journal display cap never removes authoritative flags.
54. Facts and `fact_visibility` remain unchanged, including existing visibility
    behavior.
55. Meaningful-object events are not promoted to memory and create no memory
    write.
56. No provider or prompt is called or changed.
57. Strict command/event schemas reject unknown fields.
58. Renderer/UI supply object/action intent only and cannot supply consequences.
59. Runtime does not import the ADR-0092 graph/validator modules.
60. Shared server and SQLite paths use the same extended event schema; no second
    union or migration exists.
61. Existing document, container, and remains Slice B behavior remains intact
    when catalog data is absent or invalid.

## Deterministic manual acceptance fixture

Use one trusted fixture with stable IDs:

- a document whose `read` reveals clue A;
- a container whose `search` grants its existing validated item and reveals
  clue B;
- remains whose `search` reveals clue C and satisfies the current generated
  objective `generated-0` to stage 1; and
- a decorative/unsupported object with no Slice C behavior.

Read/search each eligible object, confirm each consequence and truthful journal
entry appears once, repeat the actions, leave and return, then save/load and
repeat verification. Confirm the already-known/already-satisfied feedback creates
no journal entry; the decorative object retains old behavior; and no fact,
memory, provider, prompt, or generated prose affects the outcome.

## Verification after implementation

From `apps/web`, record exact exit codes and test counts for:

```powershell
npm run test -- objectPurpose
npm run test -- meaningfulObject
npm run test -- saveGame
npm run test
npm run lint
npm run build
node node_modules/typescript/bin/tsc -b
git diff --check
```

Use actual focused test filters present after implementation; do not claim a
check passed unless it ran. Phase 1 is docs-only, so code tests/build/lint are
not required for this delivery. Run `git diff --check` and manually review both
documents and links.

## Failure, degradation, and safety impact

- Catalog failure: reject the complete catalog and preserve Slice B behavior;
  do not partially accept, repair, or synthesize attachments.
- Command/authority failure: fail closed before append with no partial state or
  journal projection.
- Stale revision: return closed retry feedback and commit nothing.
- Logging: add no narrative, IDs, item content, SaveGame JSON, provider content,
  or other sensitive payload logging; safe status enums/counts only if needed.
- Schema: optional shared command/event fields and one optional room-cache
  sidecar field; no `WorldState`, save-envelope, `QuestSpec`, DB, or server-union
  schema.
- Authoritative state: only a successfully appended shared event may add
  canonical clue/objective flags. Journal, memory, facts, prose, renderer, and UI
  remain non-authoritative.

## Explicitly deferred

This plan does not implement automatic consequence attachment, provider or
prompt changes, clue prose as authority, facts or `fact_visibility` mutation,
memory promotion, dialogue unlocks, clue clusters, confidence/reliability,
player hypotheses, multi-stage objectives, authored quest progression,
cross-room objective progression, machines, barricades, exit unlocking, or
Slice D.

## Implementation stop points

Stop and return for maintainer direction if implementation discovers that the
room-cache sidecar cannot be the single catalog owner, another event union or
persistence validator exists, objective evaluation cannot be limited to the
current generated quest without changing authored/demo behavior, or atomic
application would require a second event/store. Do not broaden the design.
