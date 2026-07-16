# Generated Objective-Bound Exit Progression v0 Plan

- Status: Documentation review; do not implement application code or tests until approved
- Date: 2026-07-16
- Decision: [ADR-0096](../decisions/ADR-0096-generated-objective-bound-exit-progression-v0.md)

## Goal and scope

Allow completion of one validated generated meaningful-object objective to
block or open one validated generated forward exit as a derived navigation view.
The provider can request this pacing only with a strict boolean hint; trusted
code selects every identity and validates every relationship.

This plan is documentation-only Slice 0. It does not authorize production-code
or test changes, commits, or pushes.

## Minimum Safe Change Check

- Reuse: `evaluateQuest`, ADR-0094 meaningful-object consequence validation and
  authoritative objective-stage flag, ADR-0095's strict envelope/independent
  branches, generated return-exit recognition, generated mechanical-gate
  validation, the existing navigation gate seam, room-cache sidecar, restore
  flow, `RoomViewer` intent seam, and object-presentation projection.
- Necessary code: one pure binding contract/validator/selector/evaluator, one
  strict optional provider-intent branch, a settled gate resolver shared by all
  consumers, one optional room-cache field, an immutable binding map, and an
  atomic exit-ID migration.
- Unchanged boundaries: `RoomSpec`, `QuestSpec`, `WorldState`, event-log
  authority, core `SaveGame`, SQLite/API, renderer trust, memory firewall,
  provider text authority, and generated-room validation.
- Targeted proof: deterministic selection and no-mutation tests, provider
  isolation tests, settled-gate and stale-result tests, cache/restore tests,
  exit-ID presentation migration tests, red-team checks, and existing
  meaningful-object/gate regressions.

## Frozen contracts and ownership

```ts
export type GeneratedObjectiveExitBinding = Readonly<{
  objectiveId: string
  exitId: string
}>

export type GeneratedObjectiveExitBindings =
  ReadonlyMap<string, GeneratedObjectiveExitBinding>

export type ExitNavigationIntent = Readonly<{
  exitId: string
  toRoomId: string
}>
```

The map key is `roomId`; it is not repeated inside a binding. The generated
room-cache sidecar is the sole persistent owner. Runtime holds an immutable
room-keyed projection, parallel to the existing consequence-catalog map.

The cache entry receives only this additive optional field:

```ts
objectiveExitBinding: unknown
```

No `RoomSpec`, `QuestSpec`, `WorldState`, or core `SaveGame` field is added. No
unlock event, unlock flag, or mutable unlock state is created.

## Planned files and responsibilities

| Area | Planned responsibility |
| --- | --- |
| New pure `domain/quests` binding module | Strict binding parser, provenance/quest/catalog/exit validation, canonical selection, and read-only evaluation. |
| `app/generatedExitGate.ts` or a focused successor | Expose one settled generated-gate resolver used by every consumer; preserve ADR-0063/0064 precedence. |
| `domain/objectPurpose/generatedMeaningfulConsequenceAttachment.ts` | Add the known optional `progressUnlocksExit` envelope member and parse it independently. |
| `generation/llmObjectivePrompt.ts` | Describe only the optional boolean; provide no exit candidates or authority-bearing fields. |
| `app/generatedObjective.ts`, `app/App.helpers.ts`, `App.tsx` | Retain per-room objective/consequence and settled-gate intermediate results; publish only validated bindings through immutable maps. |
| `domain/quests/generatedRoomCacheSaveState.ts`, `app/restoreGeneratedRoomCache.ts` | Persist and independently revalidate the optional cache binding. |
| `app/exits.ts`, `app/gatedNavigation.ts`, `app/NavigationService.ts` | Carry exit intent, apply the ordered evaluator, and return `objective-incomplete` with fixed feedback. |
| `renderer/RoomViewer.tsx`, `domain/visuals/objectPresentationState.ts` | Atomically use exit IDs for all exit presentation results. |
| Colocated and red-team tests | Cover the matrix below. |

No world-session/reducer/event, persistence/server, memory, dialogue,
relationship, renderer-engine, or primary room-generation code should change.

## Provider intent and parsing

The strict root allowlist gains only:

```ts
progressUnlocksExit?: unknown
```

Its branch parser is independent:

| Value | Result |
| --- | --- |
| literal `true` | `true` |
| `false`, missing, `null`, string, number, array, object | `false` |

A malformed known value must not discard valid objective or consequence data.
An unknown root key continues to reject the complete envelope under ADR-0095.
The provider receives no exits and cannot choose room/objective/exit IDs, stage,
flag, command, event, predicate, gate, or ordering. There is no new call,
retry, timeout, or token-budget change.

## Eligibility, selection, and validation

Create a binding only when parsed provider intent is true and all conditions
hold:

1. Generated play is enabled and assembly provenance is exactly `generated`.
   Benign generated-provenance normalization diagnostics, including object,
   spawn, exit, size, alias, transform, and purpose normalization, remain
   eligible. Actual `repaired`/`fallback` provenance and authored, registry,
   fixture, and static rooms are excluded.
2. One canonical current-room generated quest exists with exactly one objective.
3. Exactly one validated meaningful-object consequence advances that objective.
4. The candidate exit has stable unique object/exit IDs, is a generated forward
   exit, and is neither a return nor authored/static exit.
5. The candidate has no encounter, dialogue, or other compound interaction.
6. The settled independent generated-gate resolver does not govern it.

Sort candidates first by `toRoomId` and then by `exitId`, both in code-unit
order. Select the first candidate and fully validate the constructed binding.
Input array order must not affect the output.

## Settled-gate coordination

The provider gate state is not stable while its request is in flight. The
feature therefore needs a room-scoped settled gate result that follows the
existing provider/deterministic precedence:

- accepted provider data remains usable only after existing validation and
  satisfiability checks;
- rejected/unavailable provider data is settled as rejected according to current
  closed behavior;
- disabled/not-attempted paths settle through the existing deterministic path
  where applicable.

Selection waits for both the validated objective/consequence result and this
settled gate result. Initial and later-room flows retain partial results by room
until both are available, but stale results never alter the visible room. This
does not authorize an additional provider request solely for the binding.

The same pure resolver must be used for selection, binding validation,
navigation, restore validation, and presentation. At runtime, a restored or
cached binding that conflicts with a currently valid independent gate is absent
for objective blocking only; the independent gate stays active and nothing is
written or repaired.

## Runtime and presentation rule

Fetch authoritative `WorldState` once per navigation attempt and evaluate:

1. authored/encounter blocker;
2. valid legacy generated mechanical gate;
3. validated objective-bound exit blocker;
4. normal navigation.

The objective blocker uses `exitId`: a different exit is unaffected; a missing,
invalid, or stale binding is absent/fail-open; an incomplete objective returns
`objective-incomplete`; and a completed objective proceeds. Its only feedback
is `This way is not open yet.`

If the meaningful-object source is terminal while the authoritative objective
stage is incomplete, objective blocking fails open. State-fetch failure follows
the existing generated-gate fail-open rule. No objective state, flag, event,
clue, item, reward, or unlock record is invented.

The destination-keyed presentation map must move atomically to exit-ID keys in
one slice. All of these must migrate together: presentation-result creation,
App composition, RoomViewer exit interaction, object-presentation projection,
legacy generated-gate visuals, objective-bound visuals, and tests for two exits
that share a destination. No mixed key semantics may remain.

## Persistence, restore, and replay

The optional room-cache binding is strictly and independently revalidated from
the restored room, provenance, quest, consequence catalog, and settled gate
result. Invalid data drops only that field. Old caches without it remain valid.
The current cache entry validates against the generated quest restored through
the current generated-play sidecar; non-current entries validate against their
colocated restored objective.

Completion is still reconstructed solely from the event-log-derived
`WorldState` through `evaluateQuest(...meaningfulObjectProgression: true)`. A
completed objective opens immediately on restore. No unlocked state is saved or
replayed, and no generator/provider call happens during restore or cache return.

## Implementation slices

### Slice 1 — pure binding

Add the binding contract, strict parser, validator, deterministic selector,
read-only evaluator, and unit tests. No runtime caller.

### Slice 2 — provider intent

Add independent `progressUnlocksExit` parsing and prompt instructions through
the existing optional objective call. No provider authority-bearing data and no
new call.

### Slice 3 — settled coordination and cache

Add settled gate-resolution coordination, optional cache persistence, and
restore validation. Do not select from an in-flight provider state.

### Slice 4 — exit identity migration

Carry `{ exitId, toRoomId }`, atomically migrate all exit presentation to
exit-ID keys, and add `objective-incomplete` feedback.

### Slice 5 — composition wiring

Wire initial and later-room asynchronous attachment, active-room projection,
room return, navigation, save, and restore.

### Slice 6 — safety closeout

Add red-team coverage, documentation closeout, and real-provider manual
acceptance. Every slice preserves valid independent gates.

## Test matrix

1. Incomplete objective blocks only the selected exit; completion opens it.
2. Two exits sharing a destination remain independent in navigation and
   presentation.
3. Return, authored/static, encounter/dialogue/compound, duplicate, and invalid
   exits are never selected.
4. Benign generated-provenance normalizations remain eligible; actual
   `repaired`/`fallback` provenance is rejected.
5. Existing independent generated mechanical gates are never overwritten.
6. Gate provider in flight cannot create a binding; a settled provider conflict
   prevents selection.
7. Restored stale conflict deactivates only the objective blocker.
8. Invalid objective/exit/catalog/binding references, terminal-source race, and
   state-fetch failure fail open.
9. Missing binding and old cache/save preserve current behavior; completed
   objective is open immediately after restore.
10. Literal true is the only enabled provider intent; malformed known values do
    not discard valid objective/consequence branches; unknown root keys reject
    the envelope.
11. Provider data cannot choose IDs, stages, flags, commands, events, gates, or
    ordering, and receives no exits.
12. Selection is deterministic across room/proposal input permutations and
    never mutates room, quest, catalog, or binding input.
13. Existing legacy visuals remain correct after the exit-ID migration, and no
    caller remains destination-keyed.
14. Generic feedback and diagnostics are log-safe; no raw provider data, prompt,
    binding, structural ID, or generated prose leaks.
15. Navigation/evaluation writes no duplicate event, state, flag, or unlock
    record; existing meaningful-object replay/idempotency remains green.

## Manual acceptance plan

Use a real-provider generated room with one objective-bearing meaningful
document, container, or remains; one forward generated exit; one return exit;
story-specific Read/Search discovery; and accepted `progressUnlocksExit: true`.

Verify:

1. The forward exit starts visibly blocked while the return exit remains open.
2. The first meaningful Read/Search advances the objective and immediately
   enables the forward exit.
3. Repeated interaction produces no duplicate state.
4. Leaving and returning preserves the binding.
5. Save/load restores the binding and an already-completed objective opens
   immediately.
6. A valid unrelated gate remains blocked.
7. Invalid/stale binding data fails open only for the objective blocker.
8. Logs contain no raw provider output, prompt, IDs, binding data, or generated
   prose.

## Verification after implementation

Run focused binding/provider/cache/navigation/presentation/red-team tests, then
from `apps/web`:

```powershell
npm run test
npm run lint
npm run build
node node_modules/typescript/bin/tsc -b
git diff --check
```

Record actual outcomes. Do not commit or push without a later explicit request.

## Explicit exclusions

No new provider call, provider-controlled navigation authority, generated
executable code, automatic completion/rewards, item consumption, crafting,
authored or cross-room progression, multi-stage/chained objectives, branching
exit graphs, backend/API work, database changes, or renderer-engine work.
