# ADR-0096: Generated Objective-Bound Exit Progression v0

- Status: Proposed — documentation-only Slice 0; implementation requires later approval
- Date: 2026-07-16
- Extends: [ADR-0095](./ADR-0095-validated-generated-meaningful-object-consequence-attachment-v0.md), [ADR-0063](./ADR-0063-generated-mechanical-gate-runtime-v0.md), and [ADR-0064](./ADR-0064-generated-mechanical-gate-provider-v0.md)

## Context

Generated meaningful-object interactions can already progress one generated
objective through an authoritative, validated consequence attachment. Generated
mechanical gates can already block navigation through a read-only derivation
from validated room data and authoritative `WorldState`. Those systems are
intentionally separate: completing a generated objective does not yet provide
an intentional, trusted way to make one generated forward exit available.

This decision defines that narrow integration. It does not authorize code in
this Slice 0.

## Decision

### Authority and frozen binding

The provider may request progression pacing with one optional boolean only. It
does not select or supply an objective ID, exit ID, room ID, stage, flag,
command, event, predicate, gate, or ordering preference. Trusted code derives
the binding after all normal validation has completed.

```ts
export type GeneratedObjectiveExitBinding = Readonly<{
  objectiveId: string
  exitId: string
}>

export type GeneratedObjectiveExitBindings =
  ReadonlyMap<string, GeneratedObjectiveExitBinding>
```

The map key is `roomId`. The binding deliberately does not duplicate `roomId`.
There is at most one binding per room and it governs at most one exit.

Navigation availability is a derived view only:

```text
validated room-cache binding
+ validated current generated QuestSpec
+ authoritative WorldState
+ settled valid independent gate resolution
→ traversable or blocked
```

Completion remains the existing authoritative evaluation:

```ts
evaluateQuest(quest, state, {
  meaningfulObjectProgression: true,
})
```

No new objective completion rule is introduced or reproduced.

### Provenance eligibility

Binding eligibility requires assembly provenance to be exactly `generated`.
Benign generated-room normalization and repair diagnostics do not disqualify a
room: this includes `objectsRepaired`, `spawnRepaired`, `exitsRepaired`,
`sizeRepaired`, `aliasesRepaired`, `objectTransformsRepaired`,
`purposesAssigned`, and other normalizations that retain generated provenance.

Actual `repaired` and `fallback` provenance are excluded, as are authored,
registry, fixture, and static rooms. The decision is based on provenance, not a
blanket interpretation of individual repair diagnostic booleans.

### Settled generated-gate resolution

Binding selection must never read a transient gate-provider state. A room has a
settled, room-scoped generated-gate resolution only after the existing
provider/deterministic precedence has reached a final result:

- an accepted provider gate is retained only when it is valid and satisfiable;
- a rejected or unavailable provider result is a settled rejection and follows
  the existing closed behavior;
- a disabled or not-attempted provider path resolves through the existing
  deterministic gate path where that path applies.

A provider request still in flight is not a selection input. Binding selection
runs only after both the validated objective/consequence attachment and the
settled gate resolution are available. Initial-room and later-room asynchronous
flows retain their intermediate results by room until both inputs settle; stale
results must never update the visible room.

This decision adds no provider call. It requires one pure settled-gate resolver
to be reused by binding selection, binding validation, navigation enforcement,
restore validation, and presentation projection. A restored or cached binding
is revalidated against the then-current settled resolution. If it conflicts
with a currently valid independent gate, the objective-bound blocker is absent;
the independent gate remains enforceable and no cache mutation, flag, event, or
synthetic state is produced.

### Provider parsing isolation

The existing optional objective/consequence root envelope gains only:

```ts
progressUnlocksExit?: unknown
```

It is parsed independently from the objective and meaningful-consequence
branches:

| Raw value | Parsed intent |
| --- | --- |
| literal `true` | `true` |
| `false`, missing, `null`, string, number, array, or object | `false` |

A malformed value for this known optional member must not discard an otherwise
valid objective or meaningful-consequence branch. Unknown root keys retain
ADR-0095's strict root allowlist behavior and may reject the complete envelope.
The provider receives no exit candidates.

### Selection and validation

Trusted code creates a binding only when parsed `progressUnlocksExit` is true.
It requires all of the following:

1. Generated play is enabled and provenance is exactly `generated`.
2. There is one canonical current-room generated quest with exactly one
   objective.
3. There is exactly one validated objective-bearing meaningful-object
   consequence for that objective.
4. A candidate has stable, unique object and exit IDs and is an eligible
   generated forward exit.
5. The candidate is not a return exit, authored/static exit, encounter,
   dialogue, or other compound exit.
6. The candidate is not governed by a valid independent generated mechanical
   gate from the settled resolver.

Eligible exits are sorted by `toRoomId` in code-unit order and then by `exitId`
in code-unit order. The first candidate is selected, the binding is constructed
by trusted code, and the constructed binding is fully revalidated. Provider
array order and room-object array order cannot affect the result.

### Exit identity and runtime order

Navigation intent must carry both identities:

```ts
export type ExitNavigationIntent = Readonly<{
  exitId: string
  toRoomId: string
}>
```

Objective-bound evaluation is keyed by `exitId`, never destination identity. A
single atomic implementation slice will migrate presentation from
destination-keyed results to exit-ID-keyed results. `App`, `RoomViewer`, exit
lookup, object-presentation projection, existing generated mechanical-gate
visuals, and objective-bound visuals must all use the same key after that
slice. In particular, two exits that share a destination must remain visually
and mechanically independent.

For each navigation attempt, fetch authoritative `WorldState` once and evaluate
in this order:

1. existing authored/encounter blocker;
2. valid generated legacy mechanical gate;
3. validated objective-bound exit blocker;
4. normal navigation.

For the objective-bound blocker, a different `exitId` is unaffected; an
invalid or missing binding is absent and fails open; an incomplete objective
returns `objective-incomplete`; and a complete objective continues to normal
navigation. The fixed feedback is: “This way is not open yet.”

Independent blockers remain enforceable. A terminal meaningful-object source
whose objective-stage flag is still incomplete fails open for the
objective-bound blocker, preventing an asynchronous permanent lock. State-fetch
failure follows the existing generated-blocker fail-open behavior. No flag,
event, reward, clue, item, or completion state is synthesized.

### Persistence and replay

The generated room-cache sidecar is the sole persistent binding owner. Its room
entry gains one additive, lenient field:

```ts
objectiveExitBinding: unknown
```

The field is strictly parsed and independently validated against the restored
room, provenance, quest, meaningful-object consequence catalog, and settled
generated-gate resolution. Invalid data drops only the binding. Old caches and
saves without the field remain compatible. A completed objective opens a valid
bound exit immediately after restore.

Do not persist an `unlocked` boolean. Do not add a `RoomSpec`, `QuestSpec`, or
`WorldState` field; an unlock event or flag; mutable gate state; a core
`SaveGame` field; or SQLite/API changes.

## Consequences

This introduces one bounded, room-local progression mechanism without creating
a second source of truth. The cost is a small optional cache-sidecar value, a
strict provider-intent branch, settled asynchronous coordination, and an
atomic exit-identity migration. The renderer remains a read-only consumer of
trusted boolean presentation data.

## Implementation plan

The approved implementation sequence is recorded in
[generated-objective-bound-exit-progression-v0](../implementation-plans/generated-objective-bound-exit-progression-v0.md).
Each slice must preserve valid independent gates and use fail-open behavior for
invalid/stale objective bindings.

## Explicit exclusions

- No new LLM call, retry, streaming path, or token-budget increase.
- No provider-selected identity, condition, gate, command, event, or ordering.
- No automatic objective completion or item, clue, reward, or flag grant.
- No authored/static, encounter-owned, multi-exit, multi-objective, cross-room,
  multi-stage, or branching progression system.
- No renderer-engine, Three.js, backend, persistence, SQLite, or API work.
- No repair of unrelated generated-gate provider behavior outside the settled
  resolver needed by this feature.
