# ADR-0061: Generated Mechanical Gate Contract v0 — pure domain gate contract

- **Status:** Accepted (Slice 1 docs); contract module (Slice 2) pending approval
- **Date:** 2026-06-30
- **Deciders:** Project owner
- **Extends:**
  [ADR-0014](./ADR-0014-object-interactions-v0.md) (object interactions — `planInteraction`,
  `InteractionService`, `room-state-changed.flags` one-shot idempotency — the flag substrate a
  gate condition reads),
  [ADR-0013](./ADR-0013-world-state-event-log-v0.md) (world-state / event-log authority — the
  gate is a read-only derivation, never a second source of truth).
- **Related:**
  [ADR-0051](./ADR-0051-generated-objective-per-room-v0.md) and
  [ADR-0049](./ADR-0049-real-generated-objective-provider-v0.md) (generated objectives —
  `assembleObjective`'s satisfiability gate is the precedent for "never create an impossible
  requirement"),
  [ADR-0048](./ADR-0048-generated-room-objective-target-enrichment-v0.md) (objective-target
  enrichment — the same `interaction:<id>` flag derivation a gate condition reuses),
  [ADR-0054](./ADR-0054-generated-room-object-state-v0.md) (read-only flag projection — the same
  "project, don't store" discipline),
  the existing authored demo exit gate (`app/exitGate.ts`, `app/gatedNavigation.ts`).

> Full pre-code design in the implementation plan
> [`generated-mechanical-gate-contract-v0`](../implementation-plans/generated-mechanical-gate-contract-v0.md).

> v0 is **Option A: a pure domain contract only.** It adds closed types, strict validation, a
> pure evaluation function, and a pure satisfiability check. It wires into **nothing** — no
> navigation, no App, no renderer, no generation, no save/load, no schema. Runtime enforcement,
> generated-room insertion, and objective integration are explicitly later, separately-approved
> features.

---

## Context

A "mechanical gate" is a simple, recognizable room mechanic that makes a generated room feel
interactive without scripting: a locked exit that opens after the player interacts with something,
a blocked passage that clears once an object is used, a lever/altar/control panel that flips a
room flag, an exit that becomes available only after an object is inspected. These are the
"find / activate / open" mechanics players expect in a room — not full puzzles.

The repo already has every substrate such a mechanic needs:

- **A flag substrate.** `WorldState.roomStates[roomId].flags` is an authoritative
  `Record<string, boolean>` set by `InteractionService` → `planInteraction` →
  `room-state-changed` whenever a one-shot effect (`inspect`, `take-item`) resolves (ADR-0014).
- **A predicate.** `evaluateCondition(condition, state)` (`domain/quests/evaluateQuest.ts`)
  already reads that substrate for the closed `ObjectiveCondition` union, whose `room-flag` arm is
  exactly "is flag F set in room R."
- **A satisfiability precedent.** `assembleObjective` only attaches a generated objective after a
  gate confirms the referenced flag can actually be set by an in-room effect — the existing rule
  for "never create an impossible requirement."
- **A navigation gate seam.** `evaluateExitGate` (`app/exitGate.ts`) + `navigateWithExitGate`
  (`app/gatedNavigation.ts`) already sit in the live navigation path. Today they encode a single
  hard-coded authored demo gate (`throne-room → ruined-safehouse`, blocked until flag
  `encounter:malik-encounter`); they are pure, read `WorldState.roomStates`, return
  `{ status:'rejected', reason:'blocked' }`, and surface a static, hand-written message through
  `navigationResultMessage`.

What is missing is a **typed, closed, generation-agnostic contract** that expresses such a gate as
data — so that a *later* slice can deterministically attach one to a generated room and a *later*
slice can enforce it at the existing seam, both behind a satisfiability guarantee. Jumping
straight to runtime enforcement risks navigation deadlocks, impossible objectives, and schema
creep. This ADR isolates the safe, zero-runtime foundation first.

---

## Decision

### Core rule

**Define the gate as closed data and derive its state — do not store it, do not enforce it, do
not generate it.** v0 adds one pure domain module. The flag store, the predicate, the writer, the
navigation seam, and every schema are unchanged.

### v0 contract shape (all closed; no free-form, no behavior)

```
GeneratedGateKind          = 'locked-exit'          // the ONLY v0 kind
GeneratedGateConditionKind = 'room-flag'            // the ONLY v0 condition kind

GeneratedGateCondition = { kind: 'room-flag'; roomId: string; flag: string }
GeneratedGateEffect    = { kind: 'unlock-exit'; toRoomId: string }
GeneratedMechanicalGate = {
  id: string
  kind: 'locked-exit'
  condition: GeneratedGateCondition
  effect: GeneratedGateEffect
}

GeneratedGateState = 'locked' | 'unlocked'          // DERIVED, never stored
```

- **`locked-exit` is the only kind.** Levers / switches / altars / control panels are not gate
  *kinds*; they are the in-room *interaction* whose existing flag becomes the gate's
  `condition`. A gate models only "this exit is locked until that flag is set."
- **`room-flag` is the only condition kind.** It reuses the existing `room-flag` predicate shape
  and the existing `evaluateCondition`. There is one predicate substrate across interactions,
  objectives, and gates; no new evaluator and no drift.
- **`unlock-exit` is declarative, not a mutation.** The "effect" names *which exit the gate
  governs* (`toRoomId`). A gate never sets a flag, appends an event, emits a command, or mutates
  any state. It is a predicate over an exit's availability, nothing more.
- **State is derived from `WorldState`.** `evaluateGeneratedGate(gate, state)` returns
  `'unlocked'` iff the condition flag is set in the named room, else `'locked'`. Because it reads
  only existing flags, gate state **persists for free** through the existing `WorldState` snapshot
  (ADR-0059 / ADR-0060) if and when a later slice wires it. No new save field is needed.

### Satisfiability rule (built now, enforced later)

`isGeneratedGateSatisfiable(gate, room)` is a pure check that mirrors `assembleObjective`'s
satisfiability gate:

1. the gate's unlock `flag` must be derivable from an in-room one-shot effect (an object whose
   `interaction.effect` would set that flag via `interactionFlagKey`), **and**
2. the gate's `effect.toRoomId` must match an actual exit present in the room.

A gate that fails either check is **not satisfiable**. v0 enforces nothing, but the binding rule
is recorded here: **a future runtime-enforcement slice must pass `isGeneratedGateSatisfiable`
before a gate may block navigation.** This is how the contract structurally prevents navigation
deadlocks and impossible objectives before any enforcement exists.

### Safe degradation rule

`validateGeneratedMechanicalGate(raw)` is strict (closed enums, `.strict()` objects) and returns
`GeneratedMechanicalGate | null`. Missing, malformed, unknown-kind, or extra-key data returns
`null`, which every future caller must treat as **"no gate" → the exit is open**. Absence of a
gate is always the safe, playable state.

### Optional projection (may be deferred)

`projectGateForRoomView(gate, state) → { state, hint }` is an **optional** pure projection where
`hint` comes only from a closed, hand-written table (precedent: `roomSummary` NOUNS, journal
templates). It is **defined-but-unwired** at most in v0, and may be omitted entirely from the
contract module if not needed; it never reads provider text, flag keys, or ids.

---

## Architectural rules (binding)

1. **Contract only.** The module is pure: no I/O, no logger, no React, no Three.js, no DB, no
   `world-session` write path. It returns data; it logs nothing.
2. **One predicate substrate.** Gate conditions reuse the existing `room-flag` shape and
   `evaluateCondition`. The contract introduces no second predicate engine and no string-based or
   dynamic predicate evaluation.
3. **No new state, event, schema, or store.** Gate state is derived from existing
   `WorldState.roomStates[roomId].flags`. `RoomSpec`, `WorldState`, `WorldEvent`, `SaveGame`, and
   `QuestSpec` `schemaVersion` all remain `1`.
4. **No runtime effect in v0.** The module is imported by **no** runtime code. `App.tsx`,
   `NavigationService`, `exitGate.ts`, `gatedNavigation.ts`, the renderer, and the generators are
   untouched, so authored and existing generated behavior is byte-identical to today.
5. **No generation.** No provider, prompt, LLM, or fake-generator change. The contract never
   ingests raw prompt or provider output; gate data is constructed by future deterministic
   callers, never by the contract.
6. **Satisfiability precedes enforcement.** Any future slice that blocks navigation on a gate must
   first pass `isGeneratedGateSatisfiable`. Deadlock prevention is a contract invariant, not a
   runtime afterthought.
7. **Safe diagnostics only.** Should any future slice log, it carries only counts, booleans, or
   stable codes — never object ids, flag keys, `toRoomId`, room/object names, gate JSON, prompt,
   or provider text.

---

## Scope (v0)

**In scope (this feature):**

- Slice 1 — this ADR + the implementation plan + an ARCHITECTURE status note.
- Slice 2 — `domain/generatedMechanicalGate.ts` with `validateGeneratedMechanicalGate`,
  `evaluateGeneratedGate`, `isGeneratedGateSatisfiable`, the closed types above, and co-located
  unit tests. Wired into nothing.
- Slice 3 (optional, still unwired) — `projectGateForRoomView` + a closed hint table + tests, or
  deferred if not needed.

**Out of scope / non-goals (must NOT be built in this feature):**

- ❌ Runtime enforcement / any wiring into `navigateWithExitGate`, `NavigationService`, or `App`
  (separately-approved later slice).
- ❌ Inserting a gate into a generated (or authored) room, deterministically or otherwise
  (separately-approved later slice).
- ❌ Objective ↔ gate integration (separately-approved later slice).
- ❌ Provider / prompt / LLM / fake-generator changes.
- ❌ `RoomSpec` / `WorldState` / `WorldEvent` / `SaveGame` / `QuestSpec` schema fields; new event
  types; new state stores.
- ❌ Save/load changes (gate state derives from already-persisted flags).
- ❌ Renderer / HUD signals (locked-door visuals, lock icons).
- ❌ Backend / server / SQLite changes.
- ❌ Additional gate kinds, condition kinds, multi-step / sequenced / dependent gates, lever
  objects, or any room-flag mutation by a gate.
- ❌ Cost-meter / usage changes.
- ❌ A new ESLint rule (the module is domain-pure and already covered by the `domain/**` block).

---

## Data model

No new schema. The only new types live in `domain/generatedMechanicalGate.ts` and are inferred
from a strict zod schema:

```ts
import type { WorldState } from './world/worldState'
import type { LoadedRoom } from './loadRoomSpec'

export type GeneratedGateKind = 'locked-exit'
export type GeneratedGateConditionKind = 'room-flag'

export type GeneratedGateCondition =
  { kind: 'room-flag'; roomId: string; flag: string }

export type GeneratedGateEffect =
  { kind: 'unlock-exit'; toRoomId: string }

export type GeneratedMechanicalGate = {
  id: string
  kind: GeneratedGateKind
  condition: GeneratedGateCondition
  effect: GeneratedGateEffect
}

export type GeneratedGateState = 'locked' | 'unlocked'

// Strict parse → gate | null. Invalid/unknown/extra-key input degrades to null ("no gate").
export function validateGeneratedMechanicalGate(raw: unknown): GeneratedMechanicalGate | null

// Pure; reuses evaluateCondition(condition, state). Missing roomState → 'locked'.
export function evaluateGeneratedGate(
  gate: GeneratedMechanicalGate,
  state: WorldState,
): GeneratedGateState

// Pure; mirrors assembleObjective's satisfiability gate. No enforcement here — the predicate a
// future runtime slice must pass before blocking navigation.
export function isGeneratedGateSatisfiable(
  gate: GeneratedMechanicalGate,
  room: LoadedRoom,
): boolean

// OPTIONAL (Slice 3) — may be deferred. hint comes only from a closed hand-written table.
export function projectGateForRoomView(
  gate: GeneratedMechanicalGate,
  state: WorldState,
): { state: GeneratedGateState; hint: string }
```

---

## Files likely to change

- **New (Slice 1):** this ADR;
  `docs/architecture/implementation-plans/generated-mechanical-gate-contract-v0.md`.
- **New (Slice 2):** `apps/web/src/domain/generatedMechanicalGate.ts`,
  `apps/web/src/domain/generatedMechanicalGate.test.ts`.
- **Edited (docs):** `docs/architecture/ARCHITECTURE.md` (status note).
- **Edited (Slice 2, minimal/optional):** `domain/quests/evaluateQuest.ts` only if reusing
  `evaluateCondition` benefits from a re-exported `room-flag` condition type — confirmed in the
  plan; `evaluateCondition` is already exported, so this may be a no-op.

## Files NOT to change

`domain/roomSpec.ts` · `domain/world/worldState.ts` · `domain/world/events.ts` ·
`domain/world/saveGame.ts` · `domain/quests/questSpec.ts` (schema) · `app/exitGate.ts` ·
`app/gatedNavigation.ts` · `app/NavigationService.ts` · `app/exits.ts` · `App.tsx` ·
`renderer/**` · `generation/**` · `interactions/**` · `encounters/**` · `dialogue/**` ·
`memory/**` · `persistence/**` · `server/**` · `eslint.config.js` · `package.json`.

---

## Tests (Vitest, co-located, headless — Slice 2)

- **Validation:** valid gate parses; unknown `kind` → `null`; unknown `condition.kind` → `null`;
  extra keys (`.strict`) → `null`; missing `condition`/`effect`/`id` → `null`; empty
  `flag`/`roomId`/`toRoomId` → `null`.
- **Evaluation:** condition flag set in the named room → `'unlocked'`; flag unset → `'locked'`;
  missing roomState → `'locked'` (never throws); parity with an objective `room-flag` on the same
  state (shared predicate).
- **Satisfiability:** in-room one-shot `inspect` effect produces the flag **and** `toRoomId`
  matches an exit → `true`; no in-room effect produces the flag → `false`; `toRoomId` not an exit
  in the room → `false`.
- **Safe degrade:** `null` from `validateGeneratedMechanicalGate` is the documented "no gate"
  signal.
- **Projection (if built):** `hint` is from the closed table only; contains no flag key, id,
  `toRoomId`, or room/object name.
- **Log-safety:** module emits no logs; returned strings contain no flag keys / ids / JSON.
- **Authored unchanged:** no `app/**` or runtime file imports the new module (the contract is
  inert in v0).

---

## Failure modes

| Situation | Detection | Handling | Logging |
| --- | --- | --- | --- |
| Malformed / unknown / extra-key gate data | `validateGeneratedMechanicalGate` strict parse | return `null`; callers treat as "no gate" → exit open | none |
| `evaluateGeneratedGate` with missing `roomStates[roomId]` | absent room state | return `'locked'` (conservative); never throws | none |
| Unsatisfiable gate (flag unreachable or `toRoomId` not an exit) | `isGeneratedGateSatisfiable` | returns `false`; a future runtime slice must not block on it | none |
| Future enforcement attempts to block an unsatisfiable gate | the binding rule above | rejected in design/review; enforcement is gated on satisfiability | n/a |
| Stale derived state | only matters once wired | state re-derives from flags at evaluation time; no second source of truth | none |

---

## Consequences

- A closed, generation-agnostic contract exists for "a generated locked exit that opens when an
  in-room flag is set," reusing the one flag substrate and predicate already in the repo.
- Nothing changes at runtime: authored play, existing generated play, navigation, the renderer,
  save/load, and every schema are byte-identical to today.
- The deadlock/impossible-objective risk is contained structurally: enforcement cannot ship until
  it passes `isGeneratedGateSatisfiable`, which is built and tested now.
- Future work (gate insertion, runtime enforcement, objective integration) becomes a series of
  small, independently approvable slices over a stable contract instead of one risky change.

## Alternatives considered

- **Contract + runtime enforcement now (Option C)** — rejected for v0: introduces navigation
  deadlock and impossible-objective risk and couples the first slice to `App`/navigation. Deferred
  behind the satisfiability invariant.
- **Contract + deterministic gate insertion now (Option B)** — rejected for v0: requires touching
  generated-room assembly and is only meaningful once enforcement exists. Separate later slice.
- **Contract + objective integration now (Option D)** — rejected for v0: couples gates to the
  quest pipeline before the gate contract is proven. Separate later slice.
- **A new `RoomSpec`/`WorldState` gate field or event type** — rejected: the existing flag
  substrate already encodes "did X happen in room Y"; a new field/event would expand the schema
  for no benefit and create a second source of truth.
- **A new gate-state store** — rejected: duplicates `WorldState.roomStates.flags`; violates the
  "no new state store" rule and the authority boundary (mirrors the ADR-0054 rejection).
- **Free-form / string predicate conditions** — rejected: would be dynamic evaluation of generated
  data. The closed `room-flag` reuse keeps evaluation to a fixed switch over validated data.
