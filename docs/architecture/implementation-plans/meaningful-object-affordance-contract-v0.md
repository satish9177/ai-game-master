# Implementation Plan — `feature/meaningful-object-affordance-contract-v0` (Slice A)

> Status: **Planned / not started.** No code has been written for this feature.
>
> **Depends on (implemented and merged):**
> - Object Interactions v0
>   ([ADR-0014](../decisions/ADR-0014-object-interactions-v0.md)) — `Interaction.effect`,
>   `evaluateCondition`'s `room-flag`/`has-item` predicate substrate, `interactionFlagKey`,
>   `room-state-changed.flags` one-shot idempotency.
> - Generated Mechanical Gate Contract v0
>   ([ADR-0061](../decisions/ADR-0061-generated-mechanical-gate-contract-v0.md)) — the pure
>   "closed data, derived state, satisfiability before use, wired into nothing" pattern this
>   plan generalizes from one exit-gate to room-scoped object affordances.
> - Generated Room Object State v0
>   ([ADR-0054](../decisions/ADR-0054-generated-room-object-state-v0.md)) — establishes that
>   `ObjectInteractionState` (`domain/visuals/contracts.ts`) is a derived presentation
>   projection, never a stored field; this plan's `object-state` precondition/effect follow the
>   same rule.
> - Room Environment Transition Model (dry) v0
>   ([ADR-0078](../decisions/ADR-0078-room-environment-transition-model-dry-v0.md)) — source of
>   the dry-at-runtime source-scan test pattern (`import.meta.glob` + string-reference scan)
>   this plan reuses verbatim.
>
> Companion docs: [ARCHITECTURE](../ARCHITECTURE.md) · [BOUNDARIES](../BOUNDARIES.md) ·
> [FAILURE-MODES](../FAILURE-MODES.md) · [CONVENTIONS](../CONVENTIONS.md) ·
> [ADR-0092](../decisions/ADR-0092-meaningful-object-affordance-contract-v0.md) ·
> research input: `docs/research/meaningful-objects-affordances-clues-research.md`.

---

## Goal

Establish a **pure domain contract and validator** for meaningful object affordances — a
closed `ObjectPurpose`/`ObjectAffordance` shape (six actions, four precondition kinds, six
effect kinds, all closed) plus a pure, deterministic, order-independent fixpoint-reachability
validator over the room-scoped purpose graph those affordances imply — with **no runtime
effect whatsoever**.

This generalizes the exact pattern ADR-0061 proved for a single locked exit
(`GeneratedMechanicalGate`: closed data → derived state → satisfiability check → wired into
nothing) to any object's bounded set of actions, and adds a validator capable of checking a
whole room's affordance graph at once — catching, at generation/validation time, the research
brief's worked failure case (a crank inside a chest that opens only after a machine activates,
which itself needs the crank) and the broader classes of unreachable/duplicate/conflicting
content.

This feature delivers **only** the contract, the graph assembler, the validator, and their
tests. It wires into nothing. Single-object runtime affordances, clue/objective/idempotency
runtime wiring, mechanism/exit integration, generation-pipeline wiring, and clue clusters are
explicitly later, separately-approved slices (B–F, named in ADR-0092 for orientation only) and
are out of scope here.

---

## Minimum Safe Change Check

**What existing code is reused:**

- `evaluateCondition`'s `room-flag`/`has-item` predicate shapes
  (`domain/quests/evaluateQuest.ts`, `domain/quests/questSpec.ts`) — Slice A's `room-flag` and
  `has-item` preconditions mirror these exactly (reusing the shared shape via `Extract`/a
  shared zod fragment where practical), exactly as `GeneratedGateCondition` already reuses
  `ObjectiveCondition`'s `room-flag` arm.
- `ObjectInteractionState` / `ObjectInteractionStateSchema`
  (`domain/visuals/contracts.ts`) — Slice A's `object-state` precondition/`set-object-state`
  effect reuse this closed enum verbatim; **no new state enum is introduced.**
- `InventoryItemSchema` shape (`domain/world/worldState.ts`) — Slice A's `add-item` effect
  reuses the same `{ itemId, name, quantity }` shape (as a plain object type in Slice A's own
  schema, since Slice A must not import `world-session`/runtime-adjacent modules beyond
  `domain/**`).
- The ADR-0061 "closed data → strict zod `.strict()` → `safeParse` → `T | null`" pattern
  (`domain/generatedMechanicalGate.ts`) — Slice A's `validateObjectPurpose` follows the same
  shape and the same "null means safe absence, never throw on content" discipline.
- The ADR-0078 dry-at-runtime test pattern (`domain/world/roomEnvironment.test.ts`, lines
  184–201) — `import.meta.glob(['../../**/*.ts', '../../**/*.tsx'], { eager: true, query: '?raw',
  import: 'default' })` scanned for the new module's distinctive type/function names, excluding
  the module's own files and any `.test.ts(x)` file. Reused verbatim for this feature's dry
  proof.
- The existing `src/domain/**` ESLint `no-restricted-imports` block (`eslint.config.js`,
  lines ~125–150) — already forbids React/Three.js/renderer/platform/persistence/server
  imports from `domain/**`. No new lint rule is needed.

**What new code is actually necessary (Slice A):**

- One new domain folder, e.g. `apps/web/src/domain/objectPurpose/` (exact filenames below):
  - `contracts.ts` (~90–120 lines): closed types + strict zod schemas for
    `AffordanceAction`, `AffordancePrecondition`, `AffordanceEffect`, `ObjectAffordance`,
    `ObjectPurposeCategory`, `ObjectPurpose`, and `validateObjectPurpose`.
  - `purposeGraph.ts` (~60–90 lines): pure graph-node-id derivation and
    `buildPurposeGraph(purposes: ObjectPurpose[]): PurposeGraph`.
  - `validatePurposeGraph.ts` (~150–220 lines): the fixpoint-reachability algorithm, the
    diagnostic checks (too-many-affordances, duplicate ids, missing references, unreachable
    nodes, cycle diagnosis, duplicate rewards, repeatable-reward, conflicting transitions,
    purposeless-required-object), and the stable-sorted `PurposeGraphValidationResult`
    assembly.
  - `issueCodes.ts` (~20 lines): the closed `PurposeGraphIssueCode` union (single source, so
    `contracts.ts` and `validatePurposeGraph.ts` do not each redeclare it).
- Co-located test files for each module above, plus one dedicated dry-at-runtime test file
  (or a `dryAtRuntime.test.ts` covering the whole folder in one scan, mirroring the
  single-scan style of `roomEnvironment.test.ts`).
- No other file is edited except `docs/architecture/ARCHITECTURE.md` (one status-note
  paragraph, per repo convention for "Implemented" doc-visible features — see Slice 1 below;
  note this entry will read "contract + validator only, dry at runtime," not "implemented
  gameplay feature").

**Safety boundaries unchanged:**

- `RoomSpec` / `WorldState` / `WorldEvent` / `SaveGame` / `QuestSpec` schemas — no new field,
  no new event, `schemaVersion` stays `1` everywhere.
- Runtime — `InteractionService`, `App.tsx`, `RoomViewer`, the renderer/engine, HUD, navigation,
  and every generation/provider module are untouched; the new folder is imported by **no**
  production module (proven by the dry-at-runtime test, not merely asserted).
- Generation — no provider, prompt, LLM, or fake-generator change; the new modules ingest no
  raw prompt/provider output; all Slice A inputs are hand-written test fixtures.
- Persistence / server / renderer / memory / cost meter — untouched.
- Logging — the new modules emit no logs; nothing exported carries object/clue/item ids or
  room/object names into any log path (there is no log path in Slice A at all).

**Targeted tests:**

- `npm run test -- objectPurpose` (matches the new folder; exact filter string confirmed once
  filenames are final — Vitest matches on file path substring).
- `npm run lint` and `npm run build` to confirm the domain-pure import wall holds and no other
  file changed.

---

## Architecture & boundary fit

- **Layer:** Domain / Contracts (`apps/web/src/domain/`). Pure, dependency-inward, returns
  problems as data (`null` for a malformed single `ObjectPurpose`; a stable `issues[]` array
  for a graph-level validation run), no logger. Already covered by the `domain/**`
  `no-restricted-imports` block — **no new ESLint rule** is needed.
- **Authority:** `WorldState` + the event log remain authoritative and are **not referenced by
  Slice A at all** — the validator operates entirely over the declared contract graph (an
  `ObjectPurpose[]` plus a caller-supplied initial-available node set), never over a live
  `WorldState`. This is stronger than ADR-0061's gate (which at least reads `WorldState` at
  evaluation time): Slice A has no runtime evaluation function yet, only generation-time
  validation, so there is nothing here that could be mistaken for a second source of truth.
- **Predicate/effect reuse:** `room-flag`/`has-item` preconditions and the `object-state`
  enum are the same shapes used elsewhere in the domain layer; no dynamic/string predicate
  evaluation is introduced.

---

## The Slice A contract (to be implemented)

```ts
// apps/web/src/domain/objectPurpose/contracts.ts

export type AffordanceAction = 'inspect' | 'read' | 'search' | 'open' | 'take' | 'use'

export type AffordancePrecondition =
  | { kind: 'room-flag'; roomId: string; flag: string; value: boolean }
  | { kind: 'has-item'; itemId: string; quantity?: number }
  | { kind: 'object-state'; objectId: string; state: ObjectInteractionState }
  | { kind: 'objective-stage'; objectiveId: string; atLeast: number }

export type AffordanceEffect =
  | { kind: 'set-object-state'; objectId: string; state: ObjectInteractionState }
  | { kind: 'set-room-flag'; roomId: string; flag: string; value: boolean }
  | { kind: 'add-item'; item: { itemId: string; name: string; quantity: number } }
  | { kind: 'reveal-clue'; clueId: string }
  | { kind: 'progress-objective'; objectiveId: string; toStage: number }
  | { kind: 'unlock-exit'; exitId: string }

export type AffordanceRepeatPolicy = 'once' | 'per-state' | 'always'

export type ObjectAffordance = {
  id: string
  action: AffordanceAction
  preconditions: AffordancePrecondition[]
  effects: AffordanceEffect[]
  repeat: AffordanceRepeatPolicy
}

export type ObjectPurposeCategory =
  | 'clue-bearing' | 'container' | 'lore' | 'mechanism'
  | 'blocker' | 'resource' | 'decorative'

export type ObjectPurpose = {
  objectId: string
  category: ObjectPurposeCategory
  required: boolean
  affordances: ObjectAffordance[]
}

// Strict parse → ObjectPurpose | null. Invalid/unknown-kind/extra-key input degrades to null,
// mirroring validateGeneratedMechanicalGate. Never throws on content-shaped input.
export function validateObjectPurpose(raw: unknown): ObjectPurpose | null
```

```ts
// apps/web/src/domain/objectPurpose/purposeGraph.ts

export type PurposeGraphNodeKind =
  'affordance' | 'room-flag' | 'object-state' | 'item' | 'clue' | 'objective-stage' | 'exit'

export type PurposeGraphNode = { id: string; kind: PurposeGraphNodeKind }
export type PurposeGraphEdge = { from: string; to: string; kind: 'requires' | 'provides' }
export type PurposeGraph = { nodes: PurposeGraphNode[]; edges: PurposeGraphEdge[] }

// Pure. Node ids are namespaced and deterministic (see "Node id scheme" below).
// Never mutates the input array.
export function buildPurposeGraph(purposes: readonly ObjectPurpose[]): PurposeGraph
```

```ts
// apps/web/src/domain/objectPurpose/validatePurposeGraph.ts

export type PurposeGraphIssue = {
  code: PurposeGraphIssueCode
  nodeIds: string[]       // stable-sorted
  affordanceIds: string[] // stable-sorted
}

export type PurposeGraphValidationResult = {
  valid: boolean
  issues: PurposeGraphIssue[]
  reachableNodeIds: string[]
  firedAffordanceIds: string[]
  walkthroughAffordanceIds: string[]  // diagnostic witness only — see ADR-0092 clarification
}

export type PurposeGraphValidationInput = {
  purposes: readonly ObjectPurpose[]
  /** Node ids considered true/present before any affordance fires (e.g. starting inventory,
   *  starting room-flags, starting object states, objective stage 0). Caller-supplied;
   *  never invented by the validator. */
  initialAvailableNodeIds: readonly string[]
  /** Node ids that must end up reachable (e.g. a required clue, a required objective stage). */
  requiredNodeIds: readonly string[]
}

// Pure. Deterministic and order-independent regardless of array order in `purposes`,
// `initialAvailableNodeIds`, or `requiredNodeIds`. Never mutates its input.
export function validatePurposeGraph(
  input: PurposeGraphValidationInput,
): PurposeGraphValidationResult
```

```ts
// apps/web/src/domain/objectPurpose/issueCodes.ts

export type PurposeGraphIssueCode =
  | 'INVALID_CONTRACT'
  | 'UNKNOWN_ACTION'
  | 'UNKNOWN_PRECONDITION'
  | 'UNKNOWN_EFFECT'
  | 'TOO_MANY_AFFORDANCES'
  | 'DUPLICATE_AFFORDANCE_ID'
  | 'MISSING_OBJECT_REFERENCE'
  | 'MISSING_ITEM_REFERENCE'
  | 'MISSING_OBJECTIVE_REFERENCE'
  | 'MISSING_EXIT_REFERENCE'
  | 'UNREACHABLE_REQUIRED_NODE'
  | 'OBJECTIVE_INCOMPLETABLE'
  | 'UNREACHABLE_DEPENDENCY_CYCLE'
  | 'REPEATABLE_NON_IDEMPOTENT_EFFECT'
  | 'DUPLICATE_NON_IDEMPOTENT_REWARD'
  | 'CONFLICTING_STATE_TRANSITIONS'
  | 'PURPOSELESS_REQUIRED_OBJECT'
```

`UNKNOWN_ACTION`/`UNKNOWN_PRECONDITION`/`UNKNOWN_EFFECT` are primarily produced by
`validateObjectPurpose` returning `null` for a single object (the caller loses the object, not
a partial-graph issue); `validatePurposeGraph` itself operates only over already-validated
`ObjectPurpose[]`, so these three codes are reserved on the graph-result type for completeness
and for the (test-only) path where a fixture intentionally feeds an already-invalid shape past
the type system (`as unknown as ObjectPurpose`) to prove fail-closed behavior end-to-end.

### Node id scheme (deterministic, namespaced)

```
affordance:<objectId>:<affordanceId>
room-flag:<roomId>:<flag>=<value>
object-state:<objectId>:<state>
item:<itemId>
clue:<clueId>
objective-stage:<objectiveId>:<stage>
exit:<exitId>
```

`room-flag` nodes are keyed including the boolean `value` (a `room-flag` precondition wanting
`false` is a different node than one wanting `true`) so the fixpoint reachability check stays a
simple set-membership test with no special-cased boolean logic.

### Graph assembly rule (binding, mirrors ADR-0092)

For each `ObjectPurpose.affordances[i]`:

- create one `affordance` node,
- for each precondition, create (if absent) the corresponding target node and a `requires`
  edge from that node to the affordance node,
- for each effect, create (if absent) the corresponding target node and a `provides` edge from
  the affordance node to that node.

No other edge-creation path exists. Edges are never supplied directly by a caller.

---

## Fixpoint reachability algorithm (implementation detail)

```
function validatePurposeGraph(input):
  graph ← buildPurposeGraph(input.purposes)
  available ← Set(input.initialAvailableNodeIds)
  fired ← Set()
  rounds ← []   # array of arrays of affordance node ids, for walkthroughAffordanceIds

  loop:
    # stable-sort candidate affordances by (objectId, affordance.id) before scanning
    newlyFired ← [affordance nodes not in fired whose every 'requires' source is in available]
                   sorted by (objectId, affordanceId)
    if newlyFired is empty: break
    rounds.push(newlyFired)
    for each affordance in newlyFired:
      fired.add(affordance)
      for each 'provides' target of affordance: available.add(target)

  # --- diagnostics (independent of the loop above; run after fixpoint settles) ---
  issues ← []
  issues += schemaLevelChecks(input.purposes)        # TOO_MANY_AFFORDANCES, DUPLICATE_AFFORDANCE_ID,
                                                       # MISSING_*_REFERENCE, PURPOSELESS_REQUIRED_OBJECT
  issues += rewardSafetyChecks(graph, available)      # REPEATABLE_NON_IDEMPOTENT_EFFECT,
                                                       # DUPLICATE_NON_IDEMPOTENT_REWARD,
                                                       # CONFLICTING_STATE_TRANSITIONS
  for each id in input.requiredNodeIds:
    if id not in available:
      issues += UNREACHABLE_REQUIRED_NODE(id)
      if id is an objective-stage node: issues += OBJECTIVE_INCOMPLETABLE(id)

  sccs ← stronglyConnectedComponents(graph restricted to 'requires'/'provides' edges)
  for each scc with size > 1:
    unreachableRequiredInScc ← scc.nodes ∩ (input.requiredNodeIds \ available)
    if unreachableRequiredInScc is non-empty:
      issues += UNREACHABLE_DEPENDENCY_CYCLE(scc.nodes, unreachableRequiredInScc)

  issues ← stableSort(issues)   # by (code, first nodeId, first affordanceId)

  return {
    valid: issues.length === 0,
    issues,
    reachableNodeIds: stableSort(available),
    firedAffordanceIds: stableSort(fired),
    walkthroughAffordanceIds: rounds.flat(),   # already round-then-stable-sorted
  }
```

This is a direct TypeScript rendering of the ADR-0092 "Solvability algorithm" and "Cycle
handling" sections; the actual implementation may split helper functions differently, but must
preserve: (a) simultaneous per-round firing (not first-match-wins), (b) stable sort keys fixed
before any fixpoint iteration begins, (c) SCC analysis running only as a diagnostic over the
already-computed `available` set, never influencing reachability itself.

---

## Files likely to change

- **New (Slice 1 — docs):** this plan; `docs/architecture/decisions/ADR-0092-meaningful-object-affordance-contract-v0.md` (already drafted alongside this plan).
- **Edited (Slice 1 — docs):** `docs/architecture/ARCHITECTURE.md` (one status-note paragraph
  under the "Implemented" list, worded to say "contract + validator only, dry at runtime, not
  a gameplay feature," following the ADR-0078 precedent's wording style).
- **New (Slice 2 — code, not started):**
  - `apps/web/src/domain/objectPurpose/contracts.ts`
  - `apps/web/src/domain/objectPurpose/contracts.test.ts`
  - `apps/web/src/domain/objectPurpose/purposeGraph.ts`
  - `apps/web/src/domain/objectPurpose/purposeGraph.test.ts`
  - `apps/web/src/domain/objectPurpose/validatePurposeGraph.ts`
  - `apps/web/src/domain/objectPurpose/validatePurposeGraph.test.ts`
  - `apps/web/src/domain/objectPurpose/issueCodes.ts`
  - `apps/web/src/domain/objectPurpose/dryAtRuntime.test.ts` (or folded into one of the above —
    decided during implementation; either way, exactly one dry-at-runtime scan test must exist)

## Files NOT to change

`domain/roomSpec.ts` · `domain/world/worldState.ts` · `domain/world/events.ts` ·
`domain/world/saveGame.ts` · `domain/quests/questSpec.ts` (schema) ·
`domain/quests/evaluateQuest.ts` · `domain/interactions/effects.ts` ·
`domain/generatedMechanicalGate.ts` · `domain/visuals/contracts.ts` ·
`domain/generatedRoomObjectPurpose.ts` (ADR-0037's existing, smaller purpose synthesis stays
untouched — Slice A is an independent, additive contract) · `app/exitGate.ts` ·
`app/gatedNavigation.ts` · `app/NavigationService.ts` · `App.tsx` · `renderer/**` ·
`generation/**` · `interactions/**` · `encounters/**` · `dialogue/**` · `memory/**` ·
`persistence/**` · `server/**` · `eslint.config.js` · `package.json`.

---

## Tests (Vitest, co-located, headless — Slice 2)

Pure domain tests only; no DOM, no world-session wiring, no fixtures beyond plain TypeScript
object literals (`ObjectPurpose[]`, `initialAvailableNodeIds`, `requiredNodeIds`).

### Contract validation (`contracts.test.ts`)

- Valid `ObjectPurpose` with 1–3 affordances parses to the typed shape.
- Unknown `action` → `null`.
- Unknown precondition/effect `kind` → `null`.
- Extra/unexpected keys (`.strict()`) → `null`.
- Missing required fields (`objectId`, `category`, `affordances`, `id`, `action`, `repeat`) →
  `null`.
- Wrong types (number where string expected, string where boolean expected) → `null`.
- `null`/non-object/array top-level input → `null`.
- `object-state` precondition/effect referencing a value outside `ObjectInteractionState` →
  `null`.

### Graph assembly (`purposeGraph.test.ts`)

- A single affordance with one precondition and one effect produces exactly one `requires` and
  one `provides` edge and the expected 3 nodes.
- Two affordances sharing a precondition target reuse the same node (no duplicate node with the
  same id).
- `buildPurposeGraph` does not mutate its `purposes` input (assert via a deep-equality snapshot
  taken before and after the call, or `Object.freeze` the fixture and assert no throw).
- Node ids follow the documented namespaced scheme exactly (spot-check each of the 7 kinds).

### Fixpoint reachability & diagnostics (`validatePurposeGraph.test.ts`) — the required matrix

1. **Simple document → clue chain passes.** One `read` affordance, no preconditions, effect
   `reveal-clue`; the clue id is in `requiredNodeIds` → `valid: true`, clue in
   `reachableNodeIds`.
2. **Key/tool → chest → clue chain passes.** `has-item` precondition seeded via
   `initialAvailableNodeIds`; an `open` affordance requiring it, effect `set-object-state:open`;
   a `search` affordance requiring that object-state, effect `reveal-clue` → `valid: true`.
3. **Crank inside chest / chest needs machine / machine needs crank fails** (the research
   brief's worked example). Three affordances forming a pure cycle with no external provider →
   `valid: false`, includes `UNREACHABLE_DEPENDENCY_CYCLE` naming all three affordances, and
   `UNREACHABLE_REQUIRED_NODE` for whichever node is declared required.
4. **A graph cycle with an external initial provider passes.** Same three-node cycle shape as
   (3), but one node is additionally seeded in `initialAvailableNodeIds` → `valid: true`, no
   `UNREACHABLE_DEPENDENCY_CYCLE` issue, all cycle nodes in `reachableNodeIds`.
5. **Required clue with no provider fails.** `requiredNodeIds` includes a clue id with zero
   `reveal-clue` effects anywhere in `purposes` → `UNREACHABLE_REQUIRED_NODE`.
6. **Optional unreachable clue does not invalidate the room.** Same shape as (5) but the clue id
   is *not* in `requiredNodeIds` → `valid: true`; the clue is simply absent from
   `reachableNodeIds`.
7. **Repeatable inventory reward fails.** An affordance with `repeat: 'always'` and an
   `add-item` effect → `REPEATABLE_NON_IDEMPOTENT_EFFECT`.
8. **Two once-only providers revealing the same clue pass.** Two different `once` affordances
   (different objects or the same object, different affordance ids) both effect
   `reveal-clue` with the same `clueId` → `valid: true`, no `DUPLICATE_NON_IDEMPOTENT_REWARD`
   (clue reveal is exempt — set-like by id, per ADR-0092).
9. **Two providers setting the same flag to the same value pass.** Two `once` affordances both
   effect `set-room-flag` with identical `roomId`/`flag`/`value` → `valid: true`, no
   `CONFLICTING_STATE_TRANSITIONS`.
10. **Conflicting reachable object-state transitions fail.** Two reachable `once` affordances
    set the same `objectId` to different `ObjectInteractionState` values with neither ordering
    the other → `CONFLICTING_STATE_TRANSITIONS`.
11. **Duplicate affordance IDs fail.** Two affordances on the same `ObjectPurpose` (or, if
    ids are meant to be object-scoped-unique only, confirm and test that scope explicitly)
    share the same `id` → `DUPLICATE_AFFORDANCE_ID`.
12. **More than three affordances on one object fails.** A `category: 'container'` (non-
    decorative) `ObjectPurpose` with 4 affordances → `TOO_MANY_AFFORDANCES`; confirm exactly 3
    is accepted and exactly 4 is rejected (boundary test).
13. **Missing object/item/objective/exit references fail.** A precondition/effect referencing
    an `objectId`/`itemId`/`objectiveId`/`exitId` that appears nowhere else as a target the
    validator can resolve → the matching `MISSING_*_REFERENCE` code. (Confirm the plan's exact
    resolution rule during implementation: Slice A validates references *within* the supplied
    `purposes`/`initialAvailableNodeIds`/`requiredNodeIds` closure, since there is no `LoadedRoom`
    or `WorldState` to cross-check against yet — document this scoping explicitly in the code
    comment and in the test names.)
14. **Unknown actions/preconditions/effects fail closed.** Covered primarily in
    `contracts.test.ts` (returns `null` at the single-object level); add one
    `validatePurposeGraph`-level test that feeds a pre-validated-bypassing fixture
    (`as unknown as ObjectPurpose`) to confirm the graph validator itself never throws and
    reports `UNKNOWN_ACTION`/`UNKNOWN_PRECONDITION`/`UNKNOWN_EFFECT` rather than crashing, for
    defense-in-depth if a future caller skips `validateObjectPurpose`.
15. **Deterministic issue ordering.** Run the same invalid fixture through `validatePurposeGraph`
    twice with `purposes` in two different array orders (e.g. reversed) → identical `issues`
    array (deep equality, including order).
16. **Deterministic walkthrough ordering.** Run a valid multi-round fixture through
    `validatePurposeGraph` twice with `purposes` reversed → identical
    `walkthroughAffordanceIds` (deep equality, including order).
17. **Input structures are not mutated.** Deep-freeze (`Object.freeze`, recursively via a small
    test helper or a library already in devDependencies if one exists — otherwise a manual
    recursive freeze helper local to the test file) the `purposes` array and
    `initialAvailableNodeIds`/`requiredNodeIds` before calling `validatePurposeGraph`; assert no
    throw (which would indicate an attempted mutation of frozen data) and that a
    deep-equality snapshot taken before/after is unchanged.
18. **Empty decorative-object graph passes.** A `category: 'decorative'` `ObjectPurpose` with
    `affordances: []` → no `PURPOSELESS_REQUIRED_OBJECT`, `valid: true` (assuming no other
    required content references it).
19. **Required non-decorative object without a meaningful effect fails.** A
    `required: true`, `category: 'container'` (or any non-decorative category)
    `ObjectPurpose` whose only affordance has zero effects (e.g. a bare `inspect` with no
    `effects`) → `PURPOSELESS_REQUIRED_OBJECT`.
20. **No runtime module imports or calls the Slice A implementation.** The dedicated
    dry-at-runtime test (see below).

### Dry-at-runtime proof (`dryAtRuntime.test.ts`)

Reuses the ADR-0078 pattern verbatim:

```ts
import { describe, expect, it } from 'vitest'

describe('object purpose contract/validator is dry at runtime', () => {
  const sourceModules = import.meta.glob(['../../**/*.ts', '../../**/*.tsx'], {
    eager: true,
    query: '?raw',
    import: 'default',
  }) as Record<string, string>

  const MODULE_MARKERS = [
    'objectPurpose/contracts',
    'objectPurpose/purposeGraph',
    'objectPurpose/validatePurposeGraph',
    'ObjectPurpose',
    'ObjectAffordance',
    'PurposeGraphValidationResult',
    'validateObjectPurpose',
    'buildPurposeGraph',
    'validatePurposeGraph',
  ]

  it('has no production runtime or composition importer yet', () => {
    const productionReferences = Object.entries(sourceModules).filter(([path, source]) => {
      if (path.includes('/objectPurpose/')) return false // the feature's own module/tests
      if (path.endsWith('.test.ts') || path.endsWith('.test.tsx')) return false
      return MODULE_MARKERS.some((marker) => source.includes(marker))
    })

    expect(productionReferences).toEqual([])
  })
})
```

This scans **every** `.ts`/`.tsx` source under `apps/web/src/` (both extensions, per the
ADR-0078 closeout note about not silently missing a `.tsx` importer), excluding only the
feature's own folder and any test file, for either an import path fragment or any of the
distinctive exported type/function names. A false positive (e.g. an unrelated file coincidentally
containing the string `ObjectPurpose`) is acceptable to investigate manually if it ever occurs;
today, these names do not exist anywhere else in the codebase (confirmed by the repo audit
above — no prior `ObjectPurpose`/`ObjectAffordance` symbol exists; ADR-0037's synthesized
interaction concept uses different names).

---

## Verification commands

Derived from `AGENTS.md` §"Build and verify" and the exact commands ADR-0061's plan and
ADR-0078's closeout used, run from `apps/web`:

- `npm run test -- objectPurpose` (targeted — matches the new folder path substring)
- `npm run test` (full suite — confirms zero regression elsewhere, matching the ADR-0078
  closeout precedent of running the full suite for a new pure-domain module)
- `npm run lint`
- `npm run build`
- `git diff --check` (whitespace-error check before any commit; no commit is made as part of
  this plan)

No separate `tsc --noEmit` script exists beyond what `npm run build` performs (Vite/tsc build);
if the repo's `package.json` defines a standalone typecheck script at implementation time, add
it here as an additional targeted command — confirm exact script name from `apps/web/package.json`
during Slice 2 rather than assuming one.

No docs/link-check script currently exists in this repository (none found under `apps/web/package.json`
or a root-level docs tooling config during this audit); if the ADR/plan cross-links need
verification, do so by manual review (both new docs link only to existing, already-created
files: ADR-0092 ↔ this plan ↔ ADR-0061/0014/0054/0078 ↔
`docs/research/meaningful-objects-affordances-clues-research.md`, all of which exist).

---

## Slices

Each slice is independently testable and separately approved. **This feature (Slice A of the
research report's lettering) covers only the two slices below.** All further work (single-
object runtime affordances, clue/objective/idempotency wiring, mechanism/exit integration,
generation-pipeline wiring, clue clusters, and any hypothesis-system exploration) is out of
scope and requires its own future ADR/plan, mirroring exactly how ADR-0061 named but did not
authorize its Slices 4–6.

1. **Docs-only (this delivery).** ADR-0092 + this plan + an `ARCHITECTURE.md` status note. No
   code. Verify with the smallest relevant check (none required beyond review; no test/build
   command exercises docs-only changes) and report that no check was skipped-but-needed.
2. **Pure contract + graph + validator module (not started).**
   `domain/objectPurpose/contracts.ts`, `purposeGraph.ts`, `validatePurposeGraph.ts`,
   `issueCodes.ts`, and their co-located tests plus the dry-at-runtime test. Imported by
   nothing outside its own folder and tests. Verify with the commands listed above.

**Explicitly not a slice here (future, separately approved):**

- Attaching an `ObjectPurpose` to a generated or authored room (data-only insertion) — the
  Slice-4-equivalent, mirroring ADR-0062's relationship to ADR-0061.
- Runtime affordance-availability evaluation (`evaluateObjectAffordance(purpose, worldState,
  inventory, ...)`) consumed at the existing `InteractionService`/`planInteraction` seam — the
  Slice-5-equivalent, mirroring ADR-0063.
- Generation/provider wiring that proposes `ObjectPurpose` data — the Slice-6-equivalent,
  mirroring ADR-0064.
- Clue content schema, clusters, dialogue integration, journal runtime wiring, and any
  player-hypothesis exploration (research report Slices C/F/G).

---

## Frozen enums (for review convenience — authoritative copy lives in ADR-0092 and the contract
## source once written)

**Actions (6):** `inspect`, `read`, `search`, `open`, `take`, `use`.

**Preconditions (4 kinds):** `room-flag`, `has-item`, `object-state`, `objective-stage`.

**Effects (6 kinds):** `set-object-state`, `set-room-flag`, `add-item`, `reveal-clue`,
`progress-objective`, `unlock-exit`.

**Repeat policy (3):** `once`, `per-state`, `always`.

**Purpose categories (7):** `clue-bearing`, `container`, `lore`, `mechanism`, `blocker`,
`resource`, `decorative`.

**Issue codes (17):** `INVALID_CONTRACT`, `UNKNOWN_ACTION`, `UNKNOWN_PRECONDITION`,
`UNKNOWN_EFFECT`, `TOO_MANY_AFFORDANCES`, `DUPLICATE_AFFORDANCE_ID`,
`MISSING_OBJECT_REFERENCE`, `MISSING_ITEM_REFERENCE`, `MISSING_OBJECTIVE_REFERENCE`,
`MISSING_EXIT_REFERENCE`, `UNREACHABLE_REQUIRED_NODE`, `OBJECTIVE_INCOMPLETABLE`,
`UNREACHABLE_DEPENDENCY_CYCLE`, `REPEATABLE_NON_IDEMPOTENT_EFFECT`,
`DUPLICATE_NON_IDEMPOTENT_REWARD`, `CONFLICTING_STATE_TRANSITIONS`,
`PURPOSELESS_REQUIRED_OBJECT`.

Explicitly excluded actions/effects (not in Slice A, no future date implied):
`remove-item`, `repair`, `activate`, `deactivate`, `clear`, `force-open`, `move`, `compare`,
`reveal` (as an action), `journal-candidate`, noise/alert effects, object-spawning effects,
any executable-script shape.

---

## Risks & non-goals

- **Overbuilding a puzzle system** — mitigated: 6 actions, 4 precondition kinds, 6 effect
  kinds, max 3 affordances per object, no branching/alternative-path framework beyond
  provider-safety classification. Richer mechanics are new, separately-approved features.
- **Purpose graph becoming a second source of truth** — structurally impossible in Slice A:
  there is no runtime evaluator at all yet, and the ADR's binding rule requires any future
  runtime evaluator to re-derive availability from live `WorldState`/inventory/derived object
  state/objective stage rather than consult cached graph output.
- **Consumable-key softlocks** — eliminated by construction: no `remove-item` effect exists in
  the closed vocabulary, so no precondition item can ever be consumed in Slice A's vocabulary.
- **Schema creep** — none: no `RoomSpec`/`WorldState`/`SaveGame`/`QuestSpec` field, no event, no
  store; the new types exist only in the new domain folder.
- **Non-determinism in the validator** — mitigated by the explicit stable-sort-before-fixpoint
  and canonical-round-ordering rules, and directly tested (test matrix items 15–16).
- **Silent scope creep into runtime wiring** — mitigated by the dry-at-runtime test (item 20),
  which fails the build the moment any production file references the new module, rather than
  relying on code review alone to catch it.
- **Unsafe generated content** — not applicable in Slice A: the module ingests no provider/LLM
  output; all inputs are hand-written test fixtures.

**Non-goals (explicit):** runtime affordance evaluation, generated-room insertion, provider/LLM
wiring, HUD/renderer signals, clue content/cluster system, dialogue/journal integration,
consumable items, save/load changes, backend/server changes, cost-meter changes, any new
ESLint rule, any change to ADR-0037's existing purpose-synthesis behavior.

---

## Review checklist (to be completed at delivery of Slice A code)

- [ ] Files created: `contracts.ts`, `purposeGraph.ts`, `validatePurposeGraph.ts`,
      `issueCodes.ts`, and their test files (exact final filenames confirmed at
      implementation time).
- [ ] Files updated: `docs/architecture/ARCHITECTURE.md` status note only.
- [ ] Test matrix items 1–20 above all present and passing.
- [ ] `npm run test -- objectPurpose`, `npm run test`, `npm run lint`, `npm run build`,
      `git diff --check` all reported with actual pass/fail status (never claimed without
      having run them).
- [ ] Dry-at-runtime test confirms zero production importers.
- [ ] No `App.tsx`, renderer, HUD, provider, prompt, schema, save/load, backend, or memory file
      changed.
- [ ] No commit made (docs-only delivery for this plan; code delivery for Slice 2 requires its
      own explicit maintainer go-ahead per `AGENTS.md`'s "do not commit automatically" rule).
