# ADR-0093: Deterministic Meaningful Object Interactions v0

- Status: Proposed for Slice B implementation review
- Date: 2026-07-15
- Extends: ADR-0092, Slice A: Meaningful Object Affordance Contract and Purpose Graph Validation

## Context

ADR-0092 established data-only object-purpose contracts and a generation-time validator. It intentionally did not create runtime interaction effects. Slice B adds a small deterministic runtime path for a closed set of generated-play objects while preserving the validator as a dry, generation-time concern.

The existing generic interaction service can append more than one event for an item reward and reports a later failure as partial. That is unsuitable for an object search that must both mark the object searched and add its item atomically. The authoritative `WorldSession` event log and its projection are already the only state path used by save/load and room-return visits.

## Decision

Slice B authorizes only deterministic, stateful interactions for eligible generated-play objects with stable IDs:

| Family | Eligible types | Visible actions |
| --- | --- | --- |
| document | `scroll`, `book`, `paper`, `map` | `inspect`, `read` |
| container | `chest`, `crate`, `barrel` | `inspect`, `open`, `search` |
| remains | `corpse` | `inspect`, `search` |

`take` and `use` remain part of the frozen ADR-0092 vocabulary, but Slice B does not expose them. `inspect` is repeatable observation only: it appends no command or event and never establishes a terminal state.

An object is eligible only when it resolves through the trusted current-room interaction path, has a non-empty stable ID, is in the table above, and is generated-play content. Objects with an exit, encounter, dialogue, an unsupported type, or a missing/unstable ID retain their current interaction behavior. Visual type mappings remain independent from this gameplay rule.

### Command and event

The closed command input is:

```ts
type MeaningfulObjectFamily = 'document' | 'container' | 'remains'
type MeaningfulObjectStateChangingAction = 'read' | 'open' | 'search'

type MeaningfulObjectAppliedCommand = Readonly<{
  schemaVersion: 1
  type: 'meaningful-object-applied'
  roomId: string
  objectId: string
  family: MeaningfulObjectFamily
  action: MeaningfulObjectStateChangingAction
  item?: InventoryItem
}>
```

The command deliberately has no `nextState`. Trusted command-to-event code derives the only permitted transition:

| Family | Action | Derived state | Item permitted |
| --- | --- | --- | --- |
| document | `read` | `read` | no |
| container | `open` | `open` | no |
| container | `search` | `looted` | yes |
| remains | `search` | `looted` | yes |

All other family/action pairs are rejected. The trusted event is:

```ts
type MeaningfulObjectAppliedEvent = Readonly<{
  id: string
  worldId: string
  type: 'meaningful-object-applied'
  at: string
  payload: Readonly<{
    roomId: string
    objectId: string
    family: MeaningfulObjectFamily
    action: MeaningfulObjectStateChangingAction
    state: 'read' | 'open' | 'looted'
    item?: InventoryItem
  }>
}>
```

`payload.state` is recorded for replay and safe diagnostics, but is derived by trusted code and is never caller-controlled. The production implementation uses the project’s existing event-envelope helpers and `InventoryItem` schema; this notation shows the Slice B payload fields, not a second envelope format.

Before append, the application/domain path validates the current room, trusted object resolution and eligibility, the closed combination, the current derived state, terminal-state idempotency, and the optional item. An item is permitted only on `search`, must exactly match the object’s existing validated `take-item` reward, and must conform to the existing `InventoryItem` schema. Generated prose and caller-supplied prose never choose an item.

One valid event projects both the state flag and, if present, one inventory addition. Thus event replay cannot produce an item-only or state-only partial result. No `item-discovered` event, journal entry, clue, or objective update is created by this slice.

### Canonical persisted flag

All state lookup, compatibility logic, projection, presentation, and tests use one central pure helper:

```ts
type MeaningfulObjectPersistentState = 'read' | 'open' | 'looted'

const meaningfulObjectStateFlagKey = (
  objectId: string,
  state: MeaningfulObjectPersistentState,
): string => `meaningful-object:${encodeURIComponent(objectId)}:${state}`
```

The encoded object ID avoids collisions for IDs containing `:`, `/`, `%`, or Unicode. State derivation is `looted` before `open` for containers; otherwise a container is `closed`, a document is unread/read, and remains are unsearched/looted.

### Availability, effects, and idempotency

Availability is always re-derived from the current authoritative state:

| Family/state | Derived visible actions | State-changing outcome |
| --- | --- | --- |
| document, unread | inspect, read | read -> `read` |
| document, read | inspect | stale/repeated read: no event |
| container, closed | inspect, open | open -> `open` |
| container, open | inspect, search | search -> `looted`, at most one validated item |
| container, looted | inspect | stale/repeated search: no event, already-searched feedback |
| remains, unsearched | inspect, search | search -> `looted`, at most one validated item |
| remains, looted | inspect | stale/repeated search: no event, already-searched feedback |

Feedback and action labels are closed templates. Narrative body text may be displayed under existing safe UI behavior but cannot decide eligibility, transition, reward, or repeat policy. Failure and already-complete results do not append events. Logs, if needed, use only safe action/family/status/count values and no names, prose, or item content.

### Narrow legacy compatibility

Existing `interaction:<objectId>` flags are not generally meaningful-object state. Compatibility is limited to the following audited cases:

| Existing interaction and legacy flag | Slice B interpretation | Reason |
| --- | --- | --- |
| Generic `inspect` on any eligible family | no terminal state | Inspect is observational and must not suppress a new read/search action. |
| Validated one-shot `take-item` on container or remains | `looted` | The previous reward was semantically equivalent; suppress a duplicate reward. |
| Explicitly one-shot read contract on document | `read`, only if such a contract is found | Semantically equivalent read completion. |
| Any other effect, missing ID, authored/demo/unsupported object | no compatibility mapping | Preserve the existing interaction path. |

The current audited interaction-effect union contains `inspect`, `take-item`, and `use-item`; it has no separate explicitly one-shot read contract. Therefore the document legacy-read row has no active mapping in Slice B unless the implementation audit identifies an already-validated equivalent contract.

### Runtime import boundary

The purpose graph remains dry at runtime. Runtime interaction code may import only the frozen object-purpose contracts needed for typed purpose data and the approved pure runtime affordance evaluator. It must not import `purposeGraph.ts`, `validatePurposeGraph.ts`, validator issue codes, or validator diagnostic APIs. Renderer, provider, generation, and persistence adapter code must not consult the purpose graph.

`RoomViewer` and `Engine` receive already-derived view data, render choices, send an object/action intent, and refresh after authoritative state changes. They do not evaluate eligibility or preconditions, select a reward, derive a transition, or mutate authoritative state.

### Persistence and compatibility audit

No `WorldState` field or save-envelope shape changes. The additive event projects to existing room flags and inventory, so snapshots and event-log replay preserve both effects across manual save/load and room return.

The audit found one authoritative `WorldEvent`/`WorldCommand` union in `apps/web/src/domain/world/events.ts`. `WorldSession` builds it; the in-memory and SQLite stores validate/read the same union; server routes use that shared type rather than a second server event union or API validator. No separate persistence schema or migration is needed. If implementation discovers another event union or persistence validator, implementation stops and reports that boundary before adding the event.

## Consequences

Slice B adds one narrowly scoped composite command/event because it is the minimum safe way to make search state and item grants atomic. It does not add a new state store, backend, provider flow, save format, generic effect executor, or generated dependency-pattern attachment.

This ADR authorizes Slice B only and explicitly defers reveal-clue runtime, objective progression, journal projection, Slice C events, machines, barricades, exit unlocking, provider or prompt changes, generated dependency patterns, free-text actions, clue clusters, and player hypotheses.
