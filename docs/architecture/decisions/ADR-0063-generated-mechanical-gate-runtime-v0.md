# ADR-0063: Generated Mechanical Gate Runtime v0 — deterministic runtime enforcement

- **Status:** Planned (Slice 1: ADR + implementation plan docs only)
- **Date:** 2026-07-01
- **Deciders:** Project owner
- **Extends:**
  [ADR-0062](./ADR-0062-generated-mechanical-gate-fake-v0.md) (the deterministic builder
  `buildGeneratedMechanicalGate` and the `mechanicalGateAvailable` diagnostic — this ADR
  is ADR-0061's deferred "Slice 5 — runtime enforcement at the existing navigation seam"),
  [ADR-0061](./ADR-0061-generated-mechanical-gate-contract-v0.md) (the pure
  `GeneratedMechanicalGate` contract, `evaluateGeneratedGate`, `isGeneratedGateSatisfiable` — the
  binding satisfiability-precedes-enforcement rule this slice fulfils).
- **Related:**
  [ADR-0014](./ADR-0014-object-interactions-v0.md) (`planInteraction` / `interactionFlagKey` — the
  only writer of the flag the gate condition reads; interacting with the in-room object sets the
  flag that unlocks the exit),
  [ADR-0013](./ADR-0013-world-state-event-log-v0.md) (WorldState / event-log authority — gate
  state is a read-only derivation from existing flags; the gate never writes or appends),
  [ADR-0041](./ADR-0041-generated-room-exit-navigation-v0.md) (`ensureGeneratedExitNavigation` —
  the exit the gate governs is always guaranteed in-room; non-governed exits stay open),
  [ADR-0051](./ADR-0051-generated-objective-per-room-v0.md) (the `objectivesPerRoom` flag used
  here to scope enforcement to generated play only),
  the existing authored demo exit gate (`app/exitGate.ts`, `app/gatedNavigation.ts`).

> Full pre-code design in the implementation plan
> [`generated-mechanical-gate-runtime-v0`](../implementation-plans/generated-mechanical-gate-runtime-v0.md).

> v0 is **re-derive + enforce at the existing navigation seam, generated rooms only.** It adds one
> pure evaluator `evaluateGeneratedExitGate`, wires it into the existing `navigateWithExitGate`
> behind an `objectivesPerRoom` guard, adds one new rejected reason `'gate-locked'` and a static
> UI message. No schema change, no persistence change, no renderer change, no provider/LLM/cost
> call. The authored demo gate path is byte-identical.

---

## Context

ADR-0062 established that a generated room deterministically yields a contract-valid, satisfiable
`GeneratedMechanicalGate` via `buildGeneratedMechanicalGate(room)` and recorded this outcome as
a single safe boolean diagnostic. It explicitly deferred runtime enforcement ("no wiring into
`navigateWithExitGate`, `NavigationService`, or `App`") to a later, separately-approved slice.

That deferral was deliberate: the satisfiability guarantee needed to be proven before enforcement
could land, so the contract enforces deadlock prevention structurally rather than as a runtime
afterthought.

Three implementation facts make enforcement now safe:

1. **The builder is already satisfiability-checked.** `buildGeneratedMechanicalGate(room)` returns
   `null` unless `isGeneratedGateSatisfiable` passes — which guarantees the unlock flag is
   writable by an in-room interaction and the governed exit exists in the room. A `null` result
   always means "open exit." Deadlock cannot arise from the gate itself.

2. **Gate state is already derivable for free.** `evaluateGeneratedGate(gate, state)` reads only
   `WorldState.roomStates[roomId].flags` — the same authoritative, already-persisted flag substrate
   that `planInteraction` writes when the player interacts with the unlock object. Gate state
   follows WorldState for free; no new save field exists or is needed.

3. **An exact enforcement seam already exists.** `navigateWithExitGate` (`app/gatedNavigation.ts`)
   is the single App-level navigation wrapper. Today it encodes one authored demo gate. The seam
   already fetches `WorldState`, evaluates a gate predicate, and returns `{ status:'rejected',
   reason:'blocked' }` or calls the `navigate` delegate. Adding a second, generated-play-only
   check requires touching only this file plus `App.tsx` (to pass the current room and a flag) and
   two thin supporting additions (`evaluateGeneratedExitGate` + a `navigationResultMessage` branch).

---

## Decision

### Core rule

**Re-derive the gate from the in-memory current room at each navigation attempt; evaluate its
state against a freshly fetched `WorldState`; block only the governed exit while locked; fail
open on any absence, error, or unsatisfiable result.** No gate object is stored, persisted, or
sent to the renderer.

### Gate-state rule (authoritative)

| Situation | Gate verdict |
|---|---|
| `getWorldState` fails or `WorldState` unavailable | **open** (fail-open; navigate normally) |
| `buildGeneratedMechanicalGate(room)` returns `null` | **open** (no gate; unsatisfiable; exit free) |
| Gate governs a different exit (`gate.effect.toRoomId !== toRoomId`) | **open** (only one exit governed) |
| Gate valid and governs this exit; flag absent or `false` in `WorldState` | **locked** (return `reason:'gate-locked'`) |
| Gate valid and governs this exit; flag `=== true` in `WorldState` | **open** (unlocked; navigate normally) |

This table is the implementation source of truth. Specifically: `getWorldState` failure → fail
open (do not use a stale state; do not block). A valid gate + missing room-state-flags entry →
locked (the flag has not been set yet; the player must interact with the required object first).
After the interaction writes the flag, the next navigation attempt sees `=== true` → open.

### Scope guard (generated play only)

Enforcement runs only when `generatedGateEnabled` is `true`. In `App.tsx`,
`generatedGateEnabled = activePlay.objectivesPerRoom === true`. This ensures:

- Authored rooms / authored demo play (`objectivesPerRoom` falsy) — the generated-gate branch is
  never entered; the authored demo-gate path (`evaluateExitGate`, reason `'blocked'`) is unchanged.
- Generated rooms / generated play (`objectivesPerRoom: true`) — the new branch runs after the demo
  check (which is off in generated play because `demoQuestEnabled` is false when there is no authored
  questSpec).

### `getWorldState` fetch strategy

`navigateWithExitGate` already fetches `WorldState` when `demoQuestEnabled` is true. With this
slice, it fetches when `demoQuestEnabled || generatedGateEnabled`. The demo gate check runs first
(unchanged); the generated-gate check runs second, reusing the same freshly fetched state object.
A single fetch serves both checks in combined play.

### Safe degradation

`buildGeneratedMechanicalGate(room)` is the only path that can produce an enforceable gate. Its
`null` return is always the open/safe case:

- Room has no flag-writing interaction → `null` → open.
- Room has no exit → `null` → open.
- `isGeneratedGateSatisfiable` fails → `null` → open.
- Gate governs a different exit → open (other exits are never blocked by this gate).

No navigation deadlock is possible because:
1. The builder only returns a gate if the unlock interaction is reachable in-room.
2. Non-governed exits remain unconditionally open.
3. `getWorldState` failure falls through to `navigate`.

### New `'gate-locked'` reason

A distinct rejected reason is required so the existing authored-gate message path is untouched.

- `NavigationService.ts` (`NavigationResult`) — widen the rejected reason union with `'gate-locked'`
  (TypeScript only; not stored, not serialized).
- `navigationResultMessage` (`app/exits.ts`) — new branch returning a fixed, static, player-facing
  string. The string must not contain room ids, object ids, flag keys, `toRoomId`, raw gate JSON,
  prompt/provider output, or generated descriptions. Draft: *"This exit is sealed. Find what
  activates it in this room."*
- The existing `'blocked'` reason and its Malik-specific message remain byte-identical.

### Pure evaluator (new)

```ts
// apps/web/src/app/generatedExitGate.ts
export type GeneratedExitGateResult = { gated: false } | { gated: true }

export function evaluateGeneratedExitGate(input: {
  room: LoadedRoom
  toRoomId: string
  state: Partial<Pick<WorldState, 'roomStates'>> | null | undefined
}): GeneratedExitGateResult
```

- Re-derives the gate from `room` by calling `buildGeneratedMechanicalGate(room)`.
- Returns `{ gated: false }` immediately if: gate is `null`; or `gate.effect.toRoomId !== toRoomId`.
- Otherwise: `evaluateGeneratedGate(gate, state) === 'locked'` → `{ gated: true }`; else
  `{ gated: false }`.
- **No logging, no I/O, no mutation.** Pure and deterministic.
- Mirrors the shape of `evaluateExitGate` in `app/exitGate.ts` for consistency.

### Navigation seam wiring

`navigateWithExitGate` gains two new parameters: `generatedGateEnabled: boolean` and
`currentRoom: LoadedRoom`. The fetch and demo-check path is unchanged. After the demo check:

```ts
if (generatedGateEnabled) {
  const gate = evaluateGeneratedExitGate({
    room: currentRoom,
    toRoomId,
    state: stateResult.ok ? stateResult.state : null,
  })
  if (gate.gated) return { status: 'rejected', reason: 'gate-locked' }
}
```

`stateResult` is the same variable already fetched for the demo check. If `getWorldState` failed
(`!stateResult.ok`), `state` is `null` → `evaluateGeneratedExitGate` returns `{ gated:false }` →
navigate normally (fail-open).

### App wiring

`App.tsx handleNavigate` passes:
- `generatedGateEnabled: activePlay.objectivesPerRoom === true`
- `currentRoom: activePlay.room`

No other `App.tsx` change.

---

## Architectural rules (binding)

1. **Re-derive, do not store.** The gate is re-derived from `activePlay.room` on every navigation
   attempt. It is never stored in `ActivePlay`, `RoomSpec`, `LoadedRoom`, `SaveGame`, or any cache.
   The "derive, don't store" discipline from ADR-0054 / ADR-0062 continues unchanged.
2. **Satisfiability precedes enforcement (from ADR-0061).** Only a gate returned by
   `buildGeneratedMechanicalGate` (which already passed `isGeneratedGateSatisfiable`) may block
   navigation. Dynamic predicate evaluation is forbidden.
3. **Gate-state rule is the single source of truth.** The table in the Decision section governs
   all verdict logic. No other condition may block the exit under this feature.
4. **Fail-open on infrastructure error.** `getWorldState` failure, missing room state, `null` gate,
   or a gate governing a different exit all resolve to "open." The player is never permanently
   stranded by an infrastructure error.
5. **No schema change.** `RoomSpec`, `WorldState`, `WorldEvent`, `SaveGame`, `QuestSpec`
   `schemaVersion` all remain `1`. The `'gate-locked'` reason is TypeScript-only (not serialized).
6. **No renderer change.** The renderer, `RoomViewer.tsx`, and Three.js internals are untouched.
7. **Authored demo gate untouched.** `exitGate.ts` and its `reason:'blocked'` + Malik message are
   byte-identical. The generated-gate branch runs only when `generatedGateEnabled` is `true`.
8. **No provider/LLM/cost path.** The evaluator ingests only a validated `LoadedRoom` and a
   `WorldState` fragment. No provider call, no prompt, no fake generator.
9. **No log leakage.** The evaluator/seam may log at most a boolean/enum result. It must never
   log the gate id, room id, object id, flag key, `toRoomId`, raw gate JSON, prompt output, or any
   generated description.
10. **Generated-play scope only.** The `generatedGateEnabled` guard is the single scope boundary.
    Authored rooms and adjacent-pregenerated rooms (not in generated play) are never affected.

---

## Scope (v0)

**In scope (this feature):**

- Slice 1 — this ADR + the implementation plan + an ARCHITECTURE status note + a FAILURE-MODES row.
- Slice 2 — `app/generatedExitGate.ts`: `evaluateGeneratedExitGate` + co-located unit tests.
  Wired into nothing.
- Slice 3 — `navigateWithExitGate`: add `generatedGateEnabled` + `currentRoom` params; add
  generated-gate check; tests. `NavigationService.ts`: widen reason union. `app/exits.ts`: add
  `'gate-locked'` message branch; tests.
- Slice 4 — `App.tsx`: pass `generatedGateEnabled` + `currentRoom`; interaction-unlock integration
  tests; authored-demo-gate unchanged regression tests.
- Slice 5 — save/load re-derive regression; log-leakage assertions; ARCHITECTURE / FAILURE-MODES
  docs closeout.

**Out of scope / non-goals (must NOT be built in this feature):**

- ❌ Storing or persisting the gate object (in `ActivePlay`, `RoomSpec`, `SaveGame`, cache, etc.).
- ❌ Any `RoomSpec` / `WorldState` / `WorldEvent` / `SaveGame` / `QuestSpec` schema field or new
  event type.
- ❌ Renderer / HUD signals (locked-door visuals, lock icons, shader effects).
- ❌ Backend / server / SQLite changes.
- ❌ Provider / LLM / fake-generator changes.
- ❌ Objective ↔ gate integration (ADR-0061 Slice 6, separately approved).
- ❌ Multi-exit, multi-step, or sequenced gates.
- ❌ Additional gate kinds, condition kinds, or dynamic predicates.
- ❌ Cost-meter / usage changes.
- ❌ Mutation of room objects, interaction effects, or exits.
- ❌ Adjacent-pregeneration or authored-room behavior change.

---

## Data model

No new schema field. The only additions:

```ts
// apps/web/src/app/generatedExitGate.ts — new pure module
export type GeneratedExitGateResult = { gated: false } | { gated: true }
export function evaluateGeneratedExitGate(input: {
  room: LoadedRoom
  toRoomId: string
  state: Partial<Pick<WorldState, 'roomStates'>> | null | undefined
}): GeneratedExitGateResult

// apps/web/src/app/NavigationService.ts — widen existing union (TypeScript-only, not serialized)
// Before: 'missing-exit' | 'unknown-room' | 'already-here' | 'blocked'
// After:  'missing-exit' | 'unknown-room' | 'already-here' | 'blocked' | 'gate-locked'

// apps/web/src/app/gatedNavigation.ts — two new params, one generated-gate check
// (see Decision section for pseudocode)

// apps/web/src/App.tsx — two new args to navigateWithExitGate
// generatedGateEnabled: activePlay.objectivesPerRoom === true
// currentRoom: activePlay.room
```

---

## Files likely to change

- **New (Slice 1):** this ADR;
  `docs/architecture/implementation-plans/generated-mechanical-gate-runtime-v0.md`.
- **Edited (Slice 1, docs):** `docs/architecture/ARCHITECTURE.md` (status note);
  `docs/architecture/FAILURE-MODES.md` (one case row).
- **New (Slice 2):** `apps/web/src/app/generatedExitGate.ts`;
  `apps/web/src/app/generatedExitGate.test.ts`.
- **Edited (Slice 3):** `apps/web/src/app/gatedNavigation.ts` (+ `.test.ts`);
  `apps/web/src/app/NavigationService.ts` (reason union only);
  `apps/web/src/app/exits.ts` (+ `.test.ts`, new message branch).
- **Edited (Slice 4):** `apps/web/src/App.tsx` (two extra args);
  `apps/web/src/App.test.tsx` (integration + regression tests).
- **Edited (Slice 5, docs):** `docs/architecture/ARCHITECTURE.md`;
  `docs/architecture/FAILURE-MODES.md`.

## Files NOT to change

`domain/generatedMechanicalGate.ts` (contract frozen) · `domain/assembleRoom.ts` ·
`domain/roomSpec.ts` · `domain/world/worldState.ts` · `domain/world/events.ts` ·
`domain/world/saveGame.ts` · `domain/quests/questSpec.ts` (schema) ·
`domain/quests/evaluateQuest.ts` · `domain/interactions/planInteraction.ts` ·
`app/exitGate.ts` (authored demo gate — must not change) ·
`app/buildPromptGeneratedRoomSource.ts` · `room/GeneratedRoomSource.ts` ·
`renderer/**` · `generation/**` · `interactions/**` · `encounters/**` · `dialogue/**` ·
`memory/**` · `persistence/**` · `server/**` · the generated-room cache save/load path ·
`eslint.config.js` · `package.json`.

---

## Tests

### Slice 2 — `evaluateGeneratedExitGate` (pure, co-located)

- Governed exit, flag set → `{ gated: false }`.
- Governed exit, flag absent → `{ gated: true }`.
- Governed exit, flag `false` → `{ gated: true }`.
- Non-governed exit (different `toRoomId`) → `{ gated: false }` regardless of flag.
- Room yields `null` gate (no flag-writer or no exit) → `{ gated: false }`.
- `state` is `null` or `undefined` → `{ gated: false }` (fail-open).
- `state.roomStates` missing the gate's room → `{ gated: false }` (fail-open; flag not yet set).
- Deterministic: same room + same state → same result across calls.
- No mutation of room or state.

### Slice 3 — navigation seam + message

- `navigateWithExitGate` with `generatedGateEnabled: true`, locked gate → returns
  `{ status:'rejected', reason:'gate-locked' }`; `navigate` delegate **not** called.
- `generatedGateEnabled: true`, unlocked gate (flag set) → `navigate` called.
- `generatedGateEnabled: true`, `getWorldState` fails → fail-open; `navigate` called.
- `generatedGateEnabled: true`, `null` gate room → `navigate` called.
- `generatedGateEnabled: false` (authored play) → generated check skipped entirely.
- Demo path unchanged: `demoQuestEnabled: true`, Malik flag unset → `reason:'blocked'`; `navigate`
  not called (authored path byte-identical).
- `navigationResultMessage('gate-locked')` → returns the fixed static string.
- `navigationResultMessage('blocked')` → still returns the Malik string (unchanged).

### Slice 4 — App wiring + interaction unlock integration

- `handleNavigate` in generated play with locked gate → returns `reason:'gate-locked'`.
- Interact with required object (sets flag in WorldState) → subsequent `handleNavigate` navigates.
- Authored demo-gate flow unchanged end-to-end.
- `objectivesPerRoom: false` play → generated-gate check never runs.

### Slice 5 — save/load regression + leakage

- Generated room save → restore → `buildGeneratedMechanicalGate(restoredRoom)` yields identical
  gate; flag state from `WorldState` correctly governs locked/unlocked verdict.
- No log context contains gate id, room id, object id, flag key, `toRoomId`, raw gate JSON, or
  generated description.
- No new provider/LLM/cost call is introduced by the gate enforcement path.

---

## Failure modes

| Situation | Detection | Handling | Logging |
|---|---|---|---|
| `getWorldState` fails at navigation seam | `!stateResult.ok` | pass `null` state to evaluator → `{ gated:false }` → navigate (fail-open) | existing warn at seam only |
| Room has no flag-writer or no exit | `buildGeneratedMechanicalGate` returns `null` | `{ gated:false }` → navigate | boolean/enum only |
| Gate unsatisfiable (contract rejects) | `buildGeneratedMechanicalGate` returns `null` | `{ gated:false }` → navigate | boolean/enum only |
| Gate governs a different exit | `gate.effect.toRoomId !== toRoomId` | `{ gated:false }` → navigate (other exits unconditionally open) | none |
| Gate locked (flag absent/false) | `evaluateGeneratedGate === 'locked'` | `reason:'gate-locked'`; fixed static UI message | boolean/enum only |
| Gate unlocked (flag set by interaction) | `evaluateGeneratedGate === 'unlocked'` | navigate normally | none |
| Non-generated play (`objectivesPerRoom` falsy) | `generatedGateEnabled === false` | generated check never entered; authored path unchanged | none |
| Save/load restore | `buildGeneratedMechanicalGate(restoredRoom)` re-derives identical gate | flag state from persisted `WorldState` is the sole authority | none |

---

## Consequences

- Generated rooms in generated play deterministically block their governed exit while the unlock
  flag is unset and open it after `planInteraction` writes the flag — with zero new schema, zero
  new persistence, and zero renderer change.
- The authored demo gate and all authored-room play are byte-identical to today.
- Navigation deadlock is structurally impossible: the builder only returns satisfiability-checked
  gates; non-governed exits are always open; `getWorldState` failure falls open.
- Save/load correctness is free: the gate re-derives from the restored room; flag state restores
  through the existing `WorldState` snapshot.
- Future work (objective ↔ gate sharing, renderer lock signals, additional gate kinds) remains a
  series of small, independently approvable slices over the stable ADR-0061 contract.

## Alternatives considered

- **Store gate in `ActivePlay`** — rejected: dead state requiring lifecycle management; the builder
  is deterministic and cheap; violates ADR-0062 "derive, don't store."
- **Store gate on `RoomSpec`/`LoadedRoom`** — rejected: schema change for no benefit; the gate is
  derivable from the room it would be stored on; would require save/load wiring.
- **Persist gate in `SaveGame` or generated-quest sidecar** — rejected: the gate is fully
  re-derivable from the restored room + flags; a persisted field would be a second source of truth
  and schema creep.
- **Reuse existing `reason:'blocked'`** — rejected: the Malik-specific UI message would surface for
  generated gates; authorship and generated-gate paths need distinct reason tokens so messages can
  differ without coupling.
- **Block navigation in `NavigationService`** — rejected: the service has no gate knowledge;
  `navigateWithExitGate` is the correct seam (as the authored demo gate already demonstrates).
- **Renderer lock signal / HUD icon** — deferred: no renderer change is safe in v0; blocked-exit
  UI affordance is separately approvable later.
