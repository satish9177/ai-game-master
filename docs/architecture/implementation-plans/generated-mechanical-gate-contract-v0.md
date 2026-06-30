# Implementation Plan — `feature/generated-mechanical-gate-contract-v0`

> Status: **Implemented.** Maintainer approved Option A (pure domain contract only) on
> 2026-06-30. Slice 2 added `apps/web/src/domain/generatedMechanicalGate.ts` and
> `apps/web/src/domain/generatedMechanicalGate.test.ts`; the contract remains unwired and has no
> runtime enforcement.
>
> **Depends on (implemented and merged):**
> - Object Interactions v0
>   ([ADR-0014](../decisions/ADR-0014-object-interactions-v0.md)) — `planInteraction`,
>   `interactionFlagKey`, `InteractionService`, and `room-state-changed.flags` are the flag
>   substrate a gate condition reads.
> - World State & Event Log v0
>   ([ADR-0013](../decisions/ADR-0013-world-state-event-log-v0.md)) — `WorldState.roomStates`
>   is authoritative; the gate is a read-only derivation over it.
> - Generated objective per room / real objective provider
>   ([ADR-0051](../decisions/ADR-0051-generated-objective-per-room-v0.md),
>   [ADR-0049](../decisions/ADR-0049-real-generated-objective-provider-v0.md)) —
>   `assembleObjective`'s satisfiability gate is the precedent `isGeneratedGateSatisfiable`
>   mirrors.
>
> Companion docs: [ARCHITECTURE](../ARCHITECTURE.md) · [BOUNDARIES](../BOUNDARIES.md) ·
> [FAILURE-MODES](../FAILURE-MODES.md) · [CONVENTIONS](../CONVENTIONS.md) ·
> [ADR-0061](../decisions/ADR-0061-generated-mechanical-gate-contract-v0.md).

---

## Goal

Establish a **pure domain contract** for a generated mechanical gate — v0 specifically a
*locked exit that opens when an in-room flag is set* — without any runtime effect.

A mechanical gate is a simple, recognizable room mechanic ("find / activate / open"): a locked
exit, a blocked passage that clears after an interaction, a lever/altar/control panel that flips a
room flag, an exit that becomes available after an object is inspected. The repo already has the
substrate (`WorldState.roomStates[roomId].flags`, `evaluateCondition`, the
`navigateWithExitGate` seam, `assembleObjective`'s satisfiability precedent). What is missing is a
typed, closed, generation-agnostic way to *express* such a gate as data.

This feature delivers only that contract plus tests. It wires into nothing. Runtime enforcement,
generated-room insertion, and objective integration are explicitly later, separately-approved
features (Slices 4–6 below) and are out of scope here.

---

## Minimum Safe Change Check

**What existing code is reused:**
- `WorldState.roomStates[roomId].flags` — the authoritative one-shot flag store (ADR-0014). No
  new state store; gate state is derived from it.
- `evaluateCondition(condition, state)` (`domain/quests/evaluateQuest.ts`) — already evaluates the
  `room-flag` predicate; `evaluateGeneratedGate` reuses it (it is already exported).
- `interactionFlagKey(effect.flag, id)` (`domain/interactions/planInteraction.ts`) — the single
  writer-side key derivation; `isGeneratedGateSatisfiable` reuses it to confirm a gate's unlock
  flag is reachable from an in-room effect, exactly as `assembleObjective` does.
- `LoadedRoom` / `RoomObject` shapes and `interaction.exit.toRoomId` — used (read-only) to confirm
  the governed exit exists.
- The `room-flag` predicate shape from `ObjectiveCondition` (`domain/quests/questSpec.ts`) — the
  gate condition mirrors it so there is one predicate substrate.

**What new code was actually necessary (Slice 2):**
- One pure module `domain/generatedMechanicalGate.ts` (~80–120 lines): closed types, a strict zod
  schema, `validateGeneratedMechanicalGate`, `evaluateGeneratedGate`, `isGeneratedGateSatisfiable`.
- One co-located test file `domain/generatedMechanicalGate.test.ts`.
- Optional Slice 3 (`projectGateForRoomView` + closed hint table) was deferred.

**Safety boundaries unchanged:**
- `RoomSpec` / `WorldState` / `WorldEvent` / `SaveGame` / `QuestSpec` schemas — no new field, no
  new event, `schemaVersion` stays `1`.
- Navigation — `NavigationService`, `exitGate.ts`, `gatedNavigation.ts`, `App.tsx` untouched; the
  module is imported by no runtime code, so authored and existing generated behavior is
  byte-identical.
- Generation — no provider, prompt, LLM, or fake-generator change; the contract ingests no raw
  prompt or provider output.
- Persistence / server / renderer / memory / cost meter — untouched.
- Logging — the module emits no logs; no flag keys, ids, `toRoomId`, room/object names, or JSON
  ever leave it.

**Targeted tests:**
- `npm run test -- generatedMechanicalGate` (Slice 2).
- `npm run lint` and `npm run build` to confirm the domain-pure import wall holds and nothing else
  changed.

---

## Architecture & boundary fit

- **Layer:** Domain / Contracts (`apps/web/src/domain/`). Pure, dependency-inward, returns
  problems as data (`null`), no logger. Already covered by the `domain/**` `no-restricted-imports`
  block — **no new ESLint rule** is needed.
- **Authority:** `WorldState` + event log remain authoritative. The gate is a derivation; it never
  writes, appends, or stores. It mirrors the ADR-0054 "project, don't store" discipline.
- **Predicate reuse:** one predicate substrate (`room-flag` + `evaluateCondition`) across
  interactions, objectives, and gates. No dynamic/string predicate evaluation.

---

## The v0 contract (implemented)

```ts
// apps/web/src/domain/generatedMechanicalGate.ts
import type { WorldState } from './world/worldState'
import type { LoadedRoom } from './loadRoomSpec'

export type GeneratedGateKind = 'locked-exit'            // only v0 kind
export type GeneratedGateConditionKind = 'room-flag'     // only v0 condition kind

export type GeneratedGateCondition =
  { kind: 'room-flag'; roomId: string; flag: string }

export type GeneratedGateEffect =
  { kind: 'unlock-exit'; toRoomId: string }              // declarative, not a mutation

export type GeneratedMechanicalGate = {
  id: string
  kind: GeneratedGateKind
  condition: GeneratedGateCondition
  effect: GeneratedGateEffect
}

export type GeneratedGateState = 'locked' | 'unlocked'   // derived, never stored
```

### `validateGeneratedMechanicalGate(raw: unknown): GeneratedMechanicalGate | null`
- Strict zod: closed `kind`/`condition.kind`/`effect.kind` literals, `.strict()` objects,
  non-empty `id`/`roomId`/`flag`/`toRoomId`.
- `safeParse`; on failure return `null`. **`null` is the documented "no gate" signal** — every
  future caller treats it as "exit open." Never throws on bad input.

### `evaluateGeneratedGate(gate, state): GeneratedGateState`
- Reuses `evaluateCondition(gate.condition, state)`.
- `'unlocked'` iff the condition flag is set in the named room; else `'locked'`.
- Missing `roomStates[roomId]` → `'locked'` (conservative; never throws).

### `isGeneratedGateSatisfiable(gate, room): boolean`
- Mirrors `assembleObjective`'s satisfiability gate. Returns `true` iff **all**:
  1. `gate.condition.roomId === room.id`,
  2. some object in `room` has an interaction effect that currently writes a room flag
     (`inspect` / `take-item`) whose `interactionFlagKey(...)` equals `gate.condition.flag`, and
  3. `gate.effect.toRoomId` matches an exit present in the room (an object with
     `interaction.exit.toRoomId === gate.effect.toRoomId`).
- Pure; reuses `interactionFlagKey`. `use-item` does not satisfy because it does not write room
  flags today, and encounter-owned interactions are excluded because encounter handling takes
  precedence over plain effects. **No enforcement here** — this is the predicate a future runtime
  slice must pass before blocking navigation.

### `projectGateForRoomView(gate, state): { state, hint }` — OPTIONAL (Slice 3)
- May be deferred entirely. If built: `hint` comes only from a closed hand-written table
  (precedent: `roomSummary` NOUNS, journal templates), keyed on `state`. Never reads provider
  text, flag keys, ids, `toRoomId`, or room/object names. Still wired into nothing.

---

## Slices

Each slice is independently testable and separately approved. **This feature covers Slices 1–3
only.** Slices 4–6 are listed for orientation and are explicitly out of scope unless separately
approved.

1. **Docs-only (complete).** ADR-0061 + this plan + an ARCHITECTURE status note.
   No code. Verify with the smallest relevant check; report any skipped check.
2. **Pure contract module (complete).**
   `domain/generatedMechanicalGate.ts` + `domain/generatedMechanicalGate.test.ts`:
   `validateGeneratedMechanicalGate`, `evaluateGeneratedGate`, `isGeneratedGateSatisfiable`.
   Imported by nothing. `npm run test -- generatedMechanicalGate`, `npm run lint`, `npm run build`.
3. **Optional safe view projection (deferred).**
   `projectGateForRoomView` + closed hint table + tests. Still unwired. Skipped for v0.
4. **(Later — separately approved) Deterministic gate insertion.** Attach a validated, satisfiable
   gate to a generated room during assembly/composition (data only). Out of this feature.
5. **(Later — separately approved) Runtime enforcement.** Consume the contract at the existing
   `navigateWithExitGate` seam, **gated on `isGeneratedGateSatisfiable`**, surfacing the existing
   `reason:'blocked'` static message. Out of this feature. Browser smoke checklist belongs here.
6. **(Later — separately approved) Objective integration.** Allow a generated objective and a gate
   to share an unlock flag so completing the objective opens the exit. Out of this feature.

> Save/load is intentionally **not** a slice: gate state derives from `WorldState` flags, which
> already persist via ADR-0059 / ADR-0060. A future enforcement slice should add a regression test
> confirming this, but no save/load code change is anticipated.

---

## Test plan (Slice 2)

Pure domain, co-located, headless — no DOM, no world-session wiring beyond constructing a
`WorldState` fixture.

- **Validation:** valid gate parses to the typed shape; unknown `kind` → `null`; unknown
  `condition.kind` → `null`; unknown `effect.kind` → `null`; extra/unexpected keys → `null`
  (`.strict`); missing `id`/`condition`/`effect` → `null`; empty `flag`/`roomId`/`toRoomId` →
  `null`; non-object input (`null`, string, array) → `null`.
- **Evaluation:** flag set in the named room → `'unlocked'`; flag absent → `'locked'`; flag set in
  a *different* room → `'locked'`; missing `roomStates[roomId]` → `'locked'`; parity check — same
  state yields the same result as an `ObjectiveCondition` `room-flag` through `evaluateCondition`.
- **Satisfiability:** room with matching `condition.roomId`, a matching in-room flag-writing
  interaction (`inspect` or `take-item` through `interactionFlagKey`), and a matching exit →
  `true`; wrong room id, flag unreachable, exit absent (`toRoomId` not present), `use-item`, or
  encounter-owned interactions → `false`.
- **Safe degrade:** document/assert that `null` is the "no gate" contract value.
- **Log-safety:** the module exports no logger usage; any returned string (Slice 3 hint) contains
  no flag key, id, `toRoomId`, or room/object name.
- **Inertness:** a guard test/assertion (or review note) that no `app/**`, `renderer/**`, or other
  runtime module imports the new module in this feature.

---

## Verification commands

- `npm run test -- generatedMechanicalGate`
- `npm run lint`
- `npm run build`
- `git diff --check`

---

## Risks & non-goals

- **Overbuilding a puzzle system** — mitigated: one `kind` (`locked-exit`), one condition kind
  (`room-flag`), no sequences/levers/multi-step. Richer mechanics are new approved features.
- **Navigation deadlocks** — impossible in v0 (no enforcement); the binding rule requires future
  enforcement to pass `isGeneratedGateSatisfiable`, built and tested now.
- **Impossible objectives** — same satisfiability guarantee; objective↔gate wiring deferred.
- **Schema creep** — none: no `RoomSpec`/`WorldState`/`SaveGame`/`QuestSpec` field, no event, no
  store; state derives from existing flags.
- **Unsafe generated mechanics** — the contract ingests no provider output; gate data is closed
  enums + validated strings, never code, never a dynamic predicate.
- **Leaking ids/flags** — the module logs nothing; hints (if built) come from a closed table.
- **Authored-room behavior change** — none: the module is inert in v0; the demo `exitGate` path is
  untouched.

**Non-goals:** real/provider gate generation, runtime enforcement, gate insertion, UI/renderer
signals, multiple gate/condition kinds, lever objects, room-flag mutation, save/load changes,
backend/server changes, cost-meter changes.
