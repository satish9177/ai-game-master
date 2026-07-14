# ADR-0092: Meaningful Object Affordance Contract and Purpose-Graph Validator v0 — pure, generation-time-only

- **Status:** Proposed (Slice A design approved for implementation; not yet implemented)
- **Date:** 2026-07-15
- **Deciders:** Project owner
- **Research input:** `docs/research/meaningful-objects-affordances-clues-research.md`
  ("Meaningful Objects, Affordances, Clues, and Causal Interaction"). Central conclusion:
  objects become meaningful when they participate in a validated causal structure
  (`preconditions → action → effects`); the dependency structure is authoritative only
  during generation-time validation, and runtime must always re-derive availability from
  existing authoritative state.
- **Extends:**
  [ADR-0061](./ADR-0061-generated-mechanical-gate-contract-v0.md) (the pure
  `GeneratedMechanicalGate` contract — closed types, strict validation, a pure evaluation
  function, and a pure satisfiability check, wired into nothing — this ADR generalizes that
  exact pattern from one exit to object affordances),
  [ADR-0014](./ADR-0014-object-interactions-v0.md) (object interactions — `Interaction.effect`,
  `evaluateCondition`'s `room-flag`/`has-item` predicate substrate, `room-state-changed.flags`
  one-shot idempotency — the closed vocabulary this contract's preconditions/effects reuse),
  [ADR-0078](./ADR-0078-room-environment-transition-model-dry-v0.md) (the "pure model, dry at
  runtime, proven by a dedicated dry-at-runtime test" precedent this ADR follows exactly).
- **Related:**
  [ADR-0037](./ADR-0037-generated-room-object-purpose-v0.md) (generated-object purpose
  synthesis — the existing, smaller "purpose" concept this contract subsumes for objects that
  opt into the richer affordance model; ADR-0037's type-based allowlist is unchanged and keeps
  serving objects that never adopt an `ObjectPurpose`),
  [ADR-0054](./ADR-0054-generated-room-object-state-v0.md) (object interaction state —
  `open`/`closed`/`locked`/`looted`/`read`/`activated` is a **derived presentation
  projection**, never a stored `WorldState` field; this ADR's `object-state`
  precondition/`set-object-state` effect follow the same "derive, don't store" rule),
  [ADR-0049](./ADR-0049-real-generated-objective-provider-v0.md) /
  [ADR-0062](./ADR-0062-generated-mechanical-gate-fake-v0.md) (satisfiability-before-insertion
  precedent this ADR's validator generalizes).

> Full pre-code design, contracts, validator pseudocode-to-TypeScript mapping, test matrix,
> and slices live in the implementation plan
> [`meaningful-object-affordance-contract-v0`](../implementation-plans/meaningful-object-affordance-contract-v0.md).

> **This ADR records the full target architecture across future slices (B–G) for context, but
> approves only Slice A for implementation now: a pure `domain/` contract plus a pure
> fixpoint-reachability validator, both dry at runtime.** It wires into nothing — no runtime,
> no generation, no renderer, no App, no schema, no provider. Slices B onward each require a
> separate maintainer-approved ADR/plan, exactly as ADR-0061's Slices 4–6 did.

---

## Context

The research report's central finding, confirmed against nine primary/verified sources
(TextWorld, ScienceWorld, ALFWorld, the robotics-affordance survey, Riedl & Young's narrative
planning, ClueCart, "That Darned Sandstorm," Doran & Parberry's quest-structure analysis, and
Ron Gilbert's puzzle dependency charts, among others), is that every system which reliably
produces solvable, comprehensible interactive content represents objects as
`(preconditions → action → effects)` triples inside a graph checked for reachability **before**
the content is playable. This repository already contains that architecture in miniature:
ADR-0061's `GeneratedMechanicalGate` is exactly a one-affordance dependency graph
(`condition` = precondition, `effect` = provider) with a satisfiability check
(`isGeneratedGateSatisfiable`) that must pass before any future enforcement slice may use it.

Today, most generated objects still arrive with either no interaction at all or the
type-based `Read`/`Inspect`/`Examine` allowlist from ADR-0037 — presentation-only, with no
effect, no clue, no dependency on anything else in the room. The product problem this feature
addresses (per the research brief) is that inspecting an object rarely reveals, changes,
unlocks, or remembers anything. The fix the research recommends, and this ADR adopts, is not a
new engine: it is generalizing the exact `GeneratedMechanicalGate` pattern — closed data,
derived state, satisfiability before use — from "one exit" to "any object's affordances," plus
a validator that can check a whole room's affordance graph at once instead of one gate at a
time.

Three architectural facts constrain the design:

1. **There is no authoritative object-interaction-state store.** `open`/`closed`/`locked`/
   `looted`/`read`/`activated` (`ObjectInteractionState`, `domain/visuals/contracts.ts`) is a
   **derived presentation projection** over `WorldState.roomStates[roomId].flags`
   (ADR-0054), never a stored field. Any contract that references "object state" as a
   precondition or effect must stay honest about this: it names a state in the closed enum,
   it does not imply a new store.
2. **The existing predicate substrate is `evaluateCondition`** (`domain/quests/evaluateQuest.ts`),
   covering `room-flag`, `has-item`, `room-visited`, `has-status` over `WorldState`. The
   existing effect substrate is `InteractionEffect` (`domain/interactions/effects.ts`):
   `inspect` (optional flag), `take-item` (item), `use-item` (itemId/quantity/health). Any new
   vocabulary must compose with, not duplicate, these.
3. **Generation-time validation must never become a second source of truth.** ADR-0061's
   binding rule — "a future runtime-enforcement slice must pass satisfiability before a gate
   may block navigation" — generalizes here as: **the purpose graph and its validator run only
   at generation/validation time (and in tests). No runtime module may consult a cached
   `available`/`enabled`/`completed` boolean from generated data.** Runtime, when it exists in
   a later slice, must always recompute affordance availability from `WorldState`, inventory,
   object interaction state (itself derived), and objective stage — the same re-derivation
   discipline ADR-0063 (mechanical gate runtime) already established for gates.

What is missing today is a typed, closed contract for "this object supports these bounded
actions, each gated by these preconditions and producing these effects," plus a pure
fixpoint-reachability validator that can catch the research brief's worked example (a crank
inside a chest that opens only after a machine activates that needs the crank) before a room
ships. This ADR defines that contract and validator as a pure domain module, wired into
nothing, exactly as ADR-0061 did for the single-gate case.

---

## Decision

### Core rule

**Define the affordance contract and the purpose graph as closed data; validate reachability
with a pure deterministic fixpoint; do not store, generate, enforce, or consult any of it at
runtime.** Slice A adds domain types, a strict validator, and a pure graph-assembly +
reachability-checking module. No existing file's runtime behavior changes.

### Scope of this decision record

This ADR documents the **full intended architecture** (contract shape, vocabulary, validator
algorithm, graph model, issue codes) so that later slices have a stable target and do not
redesign the vocabulary piecemeal. It **approves implementation of Slice A only**. Slices
B–G (single-object runtime affordances, clue/objective/idempotency wiring, mechanism/exit
integration, generation pipeline wiring, clue clusters, and any player-hypothesis
exploration) are named for orientation, mirror the research report's phased plan, and each
requires its own separately-approved ADR/plan before code — identical in spirit to how
ADR-0061 named but did not authorize its Slices 4–6.

### Closed V1 vocabulary (frozen for Slice A)

**Actions** (six, closed):

```
'inspect' | 'read' | 'search' | 'open' | 'take' | 'use'
```

**Preconditions** (four kinds, closed):

```
{ kind: 'room-flag'; roomId: string; flag: string; value: boolean }
{ kind: 'has-item'; itemId: string; quantity?: number }
{ kind: 'object-state'; objectId: string; state: ObjectInteractionState }
{ kind: 'objective-stage'; objectiveId: string; atLeast: number }
```

**Effects** (six kinds, closed):

```
{ kind: 'set-object-state'; objectId: string; state: ObjectInteractionState }
{ kind: 'set-room-flag'; roomId: string; flag: string; value: boolean }
{ kind: 'add-item'; item: { itemId: string; name: string; quantity: number } }
{ kind: 'reveal-clue'; clueId: string }
{ kind: 'progress-objective'; objectiveId: string; toStage: number }
{ kind: 'unlock-exit'; exitId: string }
```

`object-state` reuses the existing closed `ObjectInteractionState` enum
(`'none' | 'closed' | 'open' | 'locked' | 'looted' | 'read' | 'activated'`,
`domain/visuals/contracts.ts`) so Slice A introduces **no new state enum** — only new places
that name it (a precondition and an effect over the *contract graph*, not over `WorldState`;
see "Purpose graph status" below for why this is safe without a runtime store).

**Explicitly excluded from V1** (research-report §5/§12 decision table; each requires its own
future ADR if ever pursued): `remove-item`, `repair`, `activate`, `deactivate`, `clear`,
`force-open`, `move`, `compare`, `reveal` as an action, dialogue-topic unlocks, journal
effects, noise/alert effects, object spawning, executable scripts of any kind.

**Fail-closed rule.** Any action, precondition kind, effect kind, object-interaction-state
value, or malformed/missing/wrong-typed field outside this closed vocabulary makes
`validateObjectPurpose` return `null` for that object ("no purpose" — the object keeps
whatever interaction, if any, it already has) exactly as `validateGeneratedMechanicalGate`
returns `null` for a malformed gate. The validator never throws on content-shaped input.

### Purpose graph status (binding)

The purpose/dependency graph is a **generation-time and validation-time artifact only.** It
may be:

- built from a room's declared `ObjectPurpose[]` by pure graph assembly,
- checked for reachability, cycles, duplicate rewards, and conflicting transitions by the
  pure validator,
- used to derive a diagnostic witness walkthrough,
- exercised in tests and (later) deterministic generation-time repair.

It must **never** become runtime truth. No runtime module may:

- store or read a cached `available: true` / `enabled: true` / `completed: true` field derived
  from the graph,
- consult `firedAffordanceIds` or `walkthroughAffordanceIds` as anything other than a
  diagnostic witness (defined precisely below),
- treat the graph as a second `WorldState`.

Whenever a later slice wires runtime affordance availability, it must recompute availability
by evaluating each affordance's `preconditions` against **live** `WorldState`, inventory,
derived object interaction state, and objective stage — the same discipline
`evaluateGeneratedGate` already applies by re-reading `WorldState` on every call rather than
trusting a stored `locked`/`unlocked` value. Slice A does not implement that runtime
evaluator; it only guarantees the contract shape such a future evaluator will consume is
already validated.

### Non-consumable keys/tools (V1)

Items referenced by a `has-item` precondition are **never consumed** by any Slice A effect —
there is no `remove-item` effect in the closed vocabulary. This is a deliberate simplification
(research report §5, brief requirement) that structurally eliminates the entire
consumable-key softlock class: a key/tool used to satisfy a precondition remains in inventory
and can satisfy the same or a different precondition again. Consumable resources are
explicitly deferred to a future slice, which would need its own softlock analysis.

### Affordance limits

A non-decorative `ObjectPurpose` (`category !== 'decorative'`) may declare **at most three**
affordances. The validator reports `TOO_MANY_AFFORDANCES` (diagnostic, not a throw) for any
object exceeding the limit. `decorative` objects may declare zero affordances without
triggering `PURPOSELESS_REQUIRED_OBJECT` (that check applies only when `required: true`).

### Solvability algorithm (binding)

**Deterministic fixpoint reachability is the primary and only solvability test in Slice A.**
Starting from a room's declared initial-available node set (room-flags known false/absent,
starting inventory, starting object states, objective stage 0 — all supplied by the caller as
part of the validation input, never invented by the validator):

1. Repeatedly scan not-yet-fired affordances; if an affordance's preconditions are all
   satisfied by the current available-node set, mark it fired and add its effects' produced
   nodes to the available set.
2. Repeat until a full scan produces no new fired affordance (fixpoint).
3. Any node required by a `required: true` purpose or referenced as a required target that is
   not in the final available set is `UNREACHABLE_REQUIRED_NODE`.

To guarantee **order-independence**, each fixpoint pass evaluates affordances in a stable
sort (by `objectId` then `affordance.id`, both required non-empty strings) and a pass "fires"
the full set of newly-satisfiable affordances found in that pass simultaneously (classic
fixpoint/worklist evaluation, not first-match-wins), so the final `reachableNodeIds` and
`firedAffordanceIds` sets are identical regardless of input array order. `walkthroughAffordanceIds`
additionally fixes a **canonical order** for the witness sequence (round number, then the
stable sort within the round) so two validator runs over equal (but differently ordered) input
produce byte-identical output.

### Cycle handling (binding)

**Strongly-connected-component (SCC) analysis is diagnostic only; a cycle is not automatically
invalid.** A cycle is reported as `UNREACHABLE_DEPENDENCY_CYCLE` only when:

- a required node inside the cycle never enters the reachable set from the fixpoint (i.e., the
  cycle has no external/initial provider breaking it), **and**
- that unreachability contributes to an `UNREACHABLE_REQUIRED_NODE` or
  `OBJECTIVE_INCOMPLETABLE` finding.

A cycle that *is* reachable because some node in it is seeded by the initial-available set (an
external provider) is valid and produces no issue — fixpoint reachability alone already proves
it solvable; SCC detection exists only to make an *unreachable* cyclic dependency's error
message name the cycle instead of just listing disconnected unreachable nodes.

### Multiple providers (binding)

Multiple providers of the same node are **not automatically invalid.** Slice A explicitly
allows:

- multiple `once` affordances (on the same or different objects) revealing the same `clueId`,
- several affordances setting the same room-flag/object-state to the **same** value (order-
  independent idempotent convergence),
- redundant/missable providers of the same required or optional clue (the research report's
  "fragmented environmental evidence" pattern needs this).

Slice A rejects or diagnoses:

- `DUPLICATE_NON_IDEMPOTENT_REWARD`: more than one reachable provider of the same `add-item` or
  `progress-objective` target where the affordances are not declared as safe alternatives (see
  `repeat`/provider-safety metadata below) — this is the "duplicate rewards" failure class.
- `REPEATABLE_NON_IDEMPOTENT_EFFECT`: any affordance with `repeat !== 'once'` that has an
  `add-item` or `progress-objective` effect.
- `CONFLICTING_STATE_TRANSITIONS`: two reachable `once` affordances that set the same
  `objectId` (via `set-object-state`) or the same `(roomId, flag)` (via `set-room-flag`) to
  **different** values with no ordering edge between them (neither is a precondition of the
  other).

Slice A models enough metadata (`repeat`, and provider counting per target node) to classify
this safety, but explicitly does **not** build a general alternative-path/branching framework —
that stays a future slice if the research-backed need is confirmed by play.

### Idempotency (declared, not enforced)

`repeat` is a closed value on every affordance: `'once' | 'per-state' | 'always'`.

- `add-item` and `progress-objective` effects are only legal on `repeat: 'once'` affordances
  (enforced by `REPEATABLE_NON_IDEMPOTENT_EFFECT`).
- `reveal-clue` is set-like by `clueId`; declaring it twice on different `once` affordances is
  allowed (idempotent by id — see "multiple providers" above).
- `progress-objective` is monotonic by declared contract (`toStage` values are checked for
  non-decreasing use across an objective's declared providers where orderable; full runtime
  monotonicity enforcement is a later slice).
- Setting the same room-flag/object-state to the same value from multiple affordances is
  idempotent and allowed.
- `inspect`-only, effect-free observation affordances may be `repeat: 'always'`.
- **Slice A validates the declared contract only.** No reducer, event-log guard, or runtime
  idempotency check exists yet or is implied to exist by this ADR; that is explicitly a later
  slice's responsibility, mirroring how ADR-0061 built satisfiability now and left enforcement
  for later.

### Journal boundary (binding)

`journal-candidate` is **not** an effect kind in this contract. A future journal integration
must project display entries from validated *events* (`affordance applied → event appended →
journal projector derives display entry`), never from a declared effect in this contract. This
keeps the affordance contract about world-level consequences only, matching the existing
consequence-journal architecture (ADR-0029/ADR-0058), which already projects from events.

### Clue boundary (binding)

`reveal-clue` exists as a typed effect and `clue` exists as a graph node kind in Slice A. This
ADR does **not** introduce clue prose/content schema, clue categories, reliability, fact
support/contradiction, clue clusters, progress indicators, player hypotheses, journal runtime,
or dialogue integration. `clueId` is an opaque, validator-scoped string in Slice A — it names a
graph node for reachability purposes and nothing else.

### LLM boundary (binding)

Slice A contains **no prompt, provider, or generation-pipeline change of any kind.** No LLM is
present anywhere in this feature. This ADR records (for future-slice orientation only, not for
implementation now) that any later generation integration must have the LLM select a known-
valid pattern and choose validated object slots and display prose — never freeform graph
edges, never executable effects, never runtime availability decisions, never `WorldState`
mutation.

---

## Recommended contracts (Slice A, final names)

```ts
// apps/web/src/domain/objectPurpose/contracts.ts (new module; exact path decided in the plan)

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
  affordances: ObjectAffordance[]   // max 3 when category !== 'decorative'
}
```

No observation prose, provider metadata, narration templates, or UI labels are added — those
remain later-slice concerns (research report §5's explicit instruction, reaffirmed here).

### Graph model (Slice A, room-scoped, pure TypeScript, no graph database)

```ts
export type PurposeGraphNodeKind =
  'affordance' | 'room-flag' | 'object-state' | 'item' | 'clue' | 'objective-stage' | 'exit'

export type PurposeGraphNode = { id: string; kind: PurposeGraphNodeKind }
export type PurposeGraphEdge = { from: string; to: string; kind: 'requires' | 'provides' }
export type PurposeGraph = { nodes: PurposeGraphNode[]; edges: PurposeGraphEdge[] }
```

The LLM never emits edges directly (this ADR carries no LLM at all, but the rule is recorded
for future slices per the research report's binding constraint): edges are always derived
mechanically from each affordance's declared `preconditions` (→ `requires` edges into the
affordance node) and `effects` (→ `provides` edges out of the affordance node). Node ids are
namespaced by kind and referent (e.g. `flag:<roomId>:<flag>`, `item:<itemId>`,
`clue:<clueId>`, `objective-stage:<objectiveId>:<n>`, `object-state:<objectId>:<state>`,
`exit:<exitId>`, `affordance:<objectId>:<affordanceId>`) so assembly is a pure, deterministic
function of the input `ObjectPurpose[]`.

### Validation result

```ts
export type PurposeGraphIssue = {
  code: PurposeGraphIssueCode   // closed, see below
  nodeIds: string[]             // stable-sorted; empty for whole-graph issues
  affordanceIds: string[]       // stable-sorted; empty when not affordance-scoped
}

export type PurposeGraphValidationResult = {
  valid: boolean                        // true iff issues is empty
  issues: PurposeGraphIssue[]           // deterministic order — see below
  reachableNodeIds: string[]            // stable-sorted
  firedAffordanceIds: string[]          // stable-sorted
  walkthroughAffordanceIds: string[]    // canonical witness order — see clarification below
}
```

**Clarification (binding):** `walkthroughAffordanceIds` is a **diagnostic witness**, not a
canonical player path and not persisted/runtime state. It is *a* valid firing order that
proves the required nodes are reachable (round-by-round, stable-sorted within each round) —
useful for tests and for a future repair step to explain *why* a room passed, and for a human
reviewer to sanity-check a generated room. It is not "the" walkthrough (multiple valid
orders can exist when affordances are independent), it carries no notion of player choice or
UI ordering, and no runtime code may treat it as an instruction sequence to execute.

### Stable issue codes (closed, Slice A)

```
INVALID_CONTRACT
UNKNOWN_ACTION
UNKNOWN_PRECONDITION
UNKNOWN_EFFECT
TOO_MANY_AFFORDANCES
DUPLICATE_AFFORDANCE_ID
MISSING_OBJECT_REFERENCE
MISSING_ITEM_REFERENCE
MISSING_OBJECTIVE_REFERENCE
MISSING_EXIT_REFERENCE
UNREACHABLE_REQUIRED_NODE
OBJECTIVE_INCOMPLETABLE
UNREACHABLE_DEPENDENCY_CYCLE
REPEATABLE_NON_IDEMPOTENT_EFFECT
DUPLICATE_NON_IDEMPOTENT_REWARD
CONFLICTING_STATE_TRANSITIONS
PURPOSELESS_REQUIRED_OBJECT
```

Issues are data, never thrown exceptions, for any content-shaped (schema-valid) input — the
validator only throws on programmer error (e.g. calling it with the wrong argument shape),
never on adversarial or malformed *content*, matching `validateGeneratedMechanicalGate`'s
`safeParse` → `null` discipline.

---

## Architectural rules (binding)

1. **Pure domain module, no I/O.** No logger, no React, no Three.js, no DB, no
   `world-session`/`interactions`/`encounters`/`dialogue`/`generation` import. Covered by the
   existing `src/domain/**` `no-restricted-imports` ESLint block — no new lint rule is needed.
2. **One predicate/effect substrate reused, not duplicated.** `room-flag` and `has-item`
   preconditions mirror `ObjectiveCondition`'s shapes exactly (reuse via `Extract`/shared zod
   pieces where practical, mirroring how `GeneratedGateCondition` is
   `Extract<ObjectiveCondition, { kind: 'room-flag' }>`); `object-state` reuses
   `ObjectInteractionState` from `domain/visuals/contracts.ts` verbatim.
3. **No new state, event, schema, or store.** `RoomSpec`, `WorldState`, `WorldEvent`,
   `SaveGame`, `QuestSpec` `schemaVersion` all remain `1`. No object-interaction-state store is
   created — Slice A's `object-state` precondition/effect operate only within the declared
   contract graph, never against a live store.
4. **No runtime effect in Slice A.** The module is imported by **no** runtime, App, renderer,
   generation, or provider code. Proven by a dedicated dry-at-runtime test (see the
   implementation plan), following the ADR-0078 pattern exactly, not asserted by comment alone.
5. **No generation.** No provider, prompt, LLM, or fake-generator change. The module never
   ingests raw prompt/provider output; `ObjectPurpose[]` inputs in Slice A come only from test
   fixtures.
6. **Fail closed on unknown vocabulary.** Any action/precondition/effect/state kind outside the
   closed enums, or any malformed reference, degrades to a reported issue (schema-shaped input)
   or `null` (malformed input to `validateObjectPurpose`) — never a thrown error, never a
   silent pass.
7. **Deterministic, order-independent output.** `reachableNodeIds`, `firedAffordanceIds`,
   `issues`, and `walkthroughAffordanceIds` are stable-sorted/canonically ordered so two calls
   with differently-ordered-but-equal input produce byte-identical results.
8. **No mutation of inputs.** The validator and graph assembler never mutate the
   `ObjectPurpose[]`/room fixtures passed to them.
9. **Safe diagnostics only, if ever logged.** Should any future caller log validator output, it
   must carry only counts/codes/booleans — never object ids, clue ids, flag keys, item ids, or
   room/object names (existing logging-redaction rule, AGENTS.md).

---

## Scope (Slice A only)

**In scope (this feature):**

- This ADR + the implementation plan + an `ARCHITECTURE.md` status note (Slice 1 per the plan).
- Pure domain module(s): closed `ObjectPurpose`/`ObjectAffordance`/precondition/effect types
  and strict zod schemas; `validateObjectPurpose`; graph assembly; `validatePurposeGraph`
  (fixpoint reachability + the diagnostic checks above); co-located unit tests (Slice 2 per the
  plan). Wired into nothing.
- A dedicated dry-at-runtime source-scan test proving no production import exists yet.

**Out of scope / non-goals (must NOT be built in this feature):**

- ❌ Any runtime consumption: no reducer, no `InteractionService` change, no HUD/renderer
  affordance list, no App wiring.
- ❌ Attaching an `ObjectPurpose` to any generated or authored room (a later, separately
  approved slice — mirrors ADR-0062's relationship to ADR-0061).
- ❌ Any generation/provider/prompt change.
- ❌ `RoomSpec` / `WorldState` / `WorldEvent` / `SaveGame` / `QuestSpec` schema fields; new event
  types; new state stores.
- ❌ Save/load changes.
- ❌ Renderer/HUD signals of any kind.
- ❌ Backend/server/SQLite changes.
- ❌ Clue content schema, clue clusters, hypotheses, dialogue integration, journal runtime
  wiring (research report Slices C/F/G equivalents).
- ❌ Consumable items, `remove-item`, or any of the explicitly excluded V1 actions/effects.
- ❌ Cost/usage-meter changes.
- ❌ A new ESLint rule (already covered by the `domain/**` block).

---

## Failure modes

| Situation | Detection | Handling | Logging |
| --- | --- | --- | --- |
| Malformed/unknown-kind/extra-key `ObjectPurpose` or affordance data | strict zod `safeParse` | return `null` ("no purpose" — object keeps existing interaction, if any) | none |
| Unknown action/precondition/effect kind | zod discriminated-union parse failure | same as above (`null`); never a partial/best-effort parse | none |
| More than 3 affordances on a non-decorative object | `TOO_MANY_AFFORDANCES` check | reported as a validation issue; `valid: false` | none |
| Required node unreachable from initial state | fixpoint reachability | `UNREACHABLE_REQUIRED_NODE` (and `OBJECTIVE_INCOMPLETABLE` if it blocks an objective) | none |
| Cyclic dependency with no external provider | fixpoint stalls + SCC diagnostic | `UNREACHABLE_DEPENDENCY_CYCLE` naming the cycle's nodes | none |
| Cyclic dependency with an external/initial provider | fixpoint reaches all cycle nodes | no issue — valid | none |
| Duplicate non-idempotent reward path | provider-count check on `add-item`/`progress-objective` targets | `DUPLICATE_NON_IDEMPOTENT_REWARD` | none |
| Repeatable affordance with a reward effect | `repeat !== 'once'` + reward-effect check | `REPEATABLE_NON_IDEMPOTENT_EFFECT` | none |
| Two reachable `once` affordances set the same object-state/flag to different values, unordered | pairwise conflict check on reachable providers | `CONFLICTING_STATE_TRANSITIONS` | none |
| Required non-decorative object with no effect-bearing affordance | category/required + effects-empty check | `PURPOSELESS_REQUIRED_OBJECT` | none |
| Any future code accidentally imports the Slice A module | dry-at-runtime source-scan test | test fails in CI before merge | none |

---

## Consequences

- A closed, generation-agnostic contract exists for "this object supports these bounded
  actions, gated by these preconditions, producing these effects," directly generalizing the
  proven `GeneratedMechanicalGate` pattern from one exit to any object.
- A pure, deterministic, order-independent validator exists that catches the research brief's
  worked failure case (crank/chest/machine cycle) and the broader failure classes (unreachable
  clues, missing items, duplicate rewards, conflicting transitions, purposeless required
  objects) **before** any room ships, mirroring `isGeneratedGateSatisfiable`'s
  "prove it before you use it" discipline at room scale instead of single-gate scale.
- Nothing changes at runtime: authored play, existing generated play, navigation, the renderer,
  save/load, and every schema are byte-identical to today.
- Future work (single-object runtime affordances, clue/objective wiring, mechanism/exit
  integration, generation pipeline wiring) becomes a series of small, independently approvable
  slices over a stable, already-tested contract — exactly the trajectory ADR-0061 → ADR-0062 →
  ADR-0063 → ADR-0064 already validated for gates.

## Alternatives considered

- **Ship runtime wiring alongside the contract (skip the dry slice).** Rejected: repeats the
  exact risk ADR-0061 avoided — coupling a new closed vocabulary to `InteractionService`/HUD
  before the vocabulary itself is proven creates deadlock/impossible-content risk and a much
  larger reviewable diff. Deferred to a later, separately-approved slice.
- **Model object-interaction-state as a new authoritative `WorldState` field.** Rejected: would
  duplicate the derived-projection discipline ADR-0054 established (state is computed from
  flags, never stored) and would be a schema change with no Slice A justification.
- **A general alternative-path/branching framework for multiple providers.** Rejected for V1:
  the research report explicitly recommends modeling only enough metadata to classify
  provider safety (idempotent vs. reward-duplicating), not a full framework — over-engineering
  relative to the current 2–4-step room-scale need.
- **A graph database, PDDL engine, or ASP/constraint solver for the validator.** Rejected: the
  research report's cross-paper synthesis and this repo's existing precedent (`evaluateCondition`,
  `isGeneratedGateSatisfiable`) both show a pure in-memory fixpoint suffices at room scale; a
  solver/service would be a new dependency and a new deployment/service surface for no proven
  benefit (explicit repo guardrail: no new package/workspace structure without approval).
- **Allow consumable keys/tools in V1.** Rejected: reintroduces the exact softlock class
  (consumption exceeding provision) the research report identifies as avoidable by a simple V1
  rule; deferred to a future slice with its own consumption-softlock analysis (research report
  §6, validator check 5).
- **Include `journal-candidate` as a declared effect.** Rejected: the existing consequence-
  journal architecture (ADR-0029/ADR-0058) already projects display entries from validated
  events; adding a second entry point (a declared effect) would create two ways to produce a
  journal entry and risks the effect becoming a narration-shaped escape hatch. Journal entries
  stay strictly event-projected.
