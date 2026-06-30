# ADR-0062: Generated Mechanical Gate Fake v0 — deterministic gate derivation for generated rooms

- **Status:** Implemented (Slice 2: deterministic builder + off-by-default diagnostic)
- **Date:** 2026-06-30
- **Deciders:** Project owner
- **Extends:**
  [ADR-0061](./ADR-0061-generated-mechanical-gate-contract-v0.md) (the pure
  `GeneratedMechanicalGate` contract — `validateGeneratedMechanicalGate`,
  `isGeneratedGateSatisfiable`, `evaluateGeneratedGate`, and the closed types this slice
  *consumes* to produce a gate; this is ADR-0061's deferred "Slice 4 — deterministic gate
  insertion (data only)").
- **Related:**
  [ADR-0048](./ADR-0048-generated-room-objective-target-enrichment-v0.md) (objective-target
  enrichment — the `enrichObjectiveTarget` boolean-option-on-`assembleRoom` pattern this slice
  replicates, and the `inspect` flag-writer it adds that the gate's `condition` reuses),
  [ADR-0040](./ADR-0040-generated-room-npc-presence-v0.md) (the original `requestsNpc`
  boolean-option gate pattern),
  [ADR-0041](./ADR-0041-generated-room-exit-navigation-v0.md) (`ensureGeneratedExitNavigation` —
  the guaranteed usable exit the gate's `effect.toRoomId` reuses),
  [ADR-0014](./ADR-0014-object-interactions-v0.md) (`interactionFlagKey` — the writer-side key the
  gate's `condition.flag` must equal),
  [ADR-0054](./ADR-0054-generated-room-object-state-v0.md) ("project/derive, don't store"
  discipline this slice follows for the gate object itself).

> Full pre-code design in the implementation plan
> [`generated-mechanical-gate-fake-v0`](../implementation-plans/generated-mechanical-gate-fake-v0.md).

> v0 is **a pure deterministic gate *builder* plus one off-by-default pipeline diagnostic.** It
> derives a contract-valid, satisfiable `GeneratedMechanicalGate` from a generated room's
> *already-present* shape (an `inspect`/`take-item` flag-writer + an ensured exit) without
> mutating the room, without storing or persisting the gate, without any schema change, and
> **without runtime enforcement.** Navigation, `exitGate`, `gatedNavigation`, the renderer,
> save/load, and every schema stay byte-identical to today.

---

## Context

ADR-0061 defined a closed `GeneratedMechanicalGate` contract (`kind: 'locked-exit'`,
`condition: { kind: 'room-flag', roomId, flag }`, `effect: { kind: 'unlock-exit', toRoomId }`)
plus three pure functions, and explicitly wired it into **nothing**. Its deferred Slice 4 was
"attach a validated, satisfiable gate to a generated room during assembly/composition (data
only)." This ADR is that slice.

The decisive observation is that **a generated room already contains everything a satisfiable gate
needs by the time `assembleRoom` finishes** — so no insertion of new objects or flags is required:

1. `ensureGeneratedExitNavigation` (Stage 2.9) guarantees at least one usable exit object whose
   `interaction.exit.toRoomId` is set — the candidate for the gate's `effect.toRoomId`.
2. In generated play, `enrichObjectiveTarget: true` (Stage 2.12.5, set in
   `buildPromptGeneratedRoomSource`) adds an `inspect` effect to one eligible object. That object
   then writes the room flag `interaction:<objectId>` when inspected (via `interactionFlagKey`) —
   the candidate for the gate's `condition.flag`.

`isGeneratedGateSatisfiable` is satisfied exactly when those two ingredients exist and the
condition's `roomId` matches the room. They do. So the gate **derives** from existing room shape,
mirroring how the gate's *state* already derives from existing flags (ADR-0061) and the
ADR-0054 "derive, don't store" discipline. Building new objects, a new flag, a `RoomSpec`/schema
field, or a persisted gate record would all be redundant for the v0 goal.

What is missing is a single deterministic function that performs that derivation behind the
ADR-0061 validation + satisfiability guarantees, plus a safe, off-by-default signal that a gate is
available for a generated room — so a *later*, separately-approved slice can enforce it at the
existing `navigateWithExitGate` seam.

---

## Decision

### Core rule

**Derive the gate from the finished room; do not insert, store, persist, or enforce it.** v0 adds
one pure builder and one boolean diagnostic. The room is returned **unchanged** by the gate stage.
No object, flag, exit, schema, event, store, save field, navigation seam, or renderer signal is
added or altered.

### The builder (new)

```ts
// apps/web/src/domain/generatedMechanicalGate.ts  (added to the existing module)
export function buildGeneratedMechanicalGate(
  room: LoadedRoom,
): GeneratedMechanicalGate | null
```

- **Condition source.** Reuses the module's existing `flagWrittenByObject` logic to find the first
  room object (in array order, deterministic) that writes a room flag via an `inspect` or
  `take-item` effect — excluding encounter-owned interactions and `use-item`, exactly as
  `isGeneratedGateSatisfiable` already requires. That flag becomes `condition.flag`;
  `condition.roomId` is `room.id`.
- **Effect target.** Reuses exit detection (an object with `interaction.exit.toRoomId`) to find the
  first forward exit (deterministic, array order). Its `toRoomId` becomes `effect.toRoomId`.
- **Identity.** Deterministic id `` `${room.id}:mechanical-gate` ``.
- **Guarantee.** The candidate is run through the existing `validateGeneratedMechanicalGate` **and**
  `isGeneratedGateSatisfiable(gate, room)`. The builder returns the gate **only if both pass**;
  otherwise it returns `null`. A room lacking a flag-writer or an exit yields `null`.
- **Purity.** No I/O, no logger, no mutation, no provider/prompt input. Deterministic: the same room
  yields an identical gate (stable id, stable selection).

### Pipeline wiring (minimal, off by default)

- `AssembleRoomOptions` gains `deriveMechanicalGateDiagnostic?: boolean` (default `false`), mirroring
  `enrichObjectiveTarget` / `requestsNpc`.
- When `true`, `assembleRoom` runs the builder on the **final** room (after objective-target
  enrichment and display sanitization) and sets a new diagnostic `mechanicalGateAvailable: boolean`
  = `buildGeneratedMechanicalGate(room) !== null`. The room is **not** modified. When `false`
  (default, and every fallback path), the builder does not run and `mechanicalGateAvailable` is
  `false`.
- `buildPromptGeneratedRoomSource` sets `deriveMechanicalGateDiagnostic: true` (generated first-room play
  only). Adjacent pregeneration keeps the default `false`, exactly like `enrichObjectiveTarget`.
- `GeneratedRoomSource` logs `mechanicalGateAvailable` as one more safe boolean in its existing
  structured assembly line.

### Why no room mutation, no stored gate

- **No mutation.** In generated play the flag-writer (objective target) and the exit already exist,
  so inserting an object/flag would be redundant new code (Minimum Safe Change). The gate is a
  *derivation*, not a *thing in the room*.
- **No stored/persisted gate.** The gate is fully re-derivable from the room via the builder at any
  later time, exactly as gate *state* re-derives from flags. Storing the gate object on
  `AssembledRoom` would be dead data with no v0 consumer (the diagnostic boolean is the only
  current consumer). The generated-room cache save/load (ADR-0060) therefore needs **no** change —
  the gate re-derives after restore. A future enforcement slice calls the builder on demand.

---

## Architectural rules (binding)

1. **Builder is pure.** No I/O, no logger, no React, no Three.js, no DB, no world-session write
   path, no provider/prompt input. It returns data or `null`; it logs nothing.
2. **Contract is the only trust boundary.** The builder never bypasses
   `validateGeneratedMechanicalGate` or `isGeneratedGateSatisfiable`; an unsatisfiable candidate is
   `null`. There is no second gate validator and no dynamic predicate.
3. **No room mutation.** The gate stage returns the same `LoadedRoom` reference it received.
   Object positions, ids, interactions, effects, exits, and provenance are untouched, so authored
   and existing generated play stay byte-identical.
4. **No new state, event, schema, store, or save field.** `RoomSpec`, `WorldState`, `WorldEvent`,
   `SaveGame`, and `QuestSpec` `schemaVersion` all stay `1`. The gate is never persisted.
5. **No runtime enforcement in v0.** `App.tsx`, `NavigationService`, `exitGate.ts`,
   `gatedNavigation.ts`, and the renderer are untouched. The gate blocks nothing yet.
6. **No generation change.** No provider, prompt, LLM, or fake-room/objective-generator change.
   The builder ingests a validated `LoadedRoom`, never raw prompt or provider output.
7. **Satisfiability precedes any future enforcement.** A later slice that blocks navigation must
   use the builder's already-satisfiability-checked gate (ADR-0061's binding rule). Deadlock
   prevention stays a contract invariant.
8. **Safe diagnostics only.** The entire diagnostic/log surface for this feature is the single
   boolean `mechanicalGateAvailable` (a boolean/count-only signal). It is **forbidden** to log,
   surface, or otherwise emit any of: the gate `id`, the room `id`, any object `id`, the
   `condition.flag` (or any flag key), the `effect.toRoomId`, raw gate JSON, the raw prompt or
   provider request/response, or any generated description / object / room / NPC name. The builder
   and the domain module emit no logs at all; only the host (`GeneratedRoomSource`) logs, and only
   the boolean.

---

## Scope (v0)

**In scope (this feature):**

- Slice 1 — this ADR + the implementation plan + an ARCHITECTURE status note + a FAILURE-MODES row.
  **(implemented).**
- Slice 2 — `buildGeneratedMechanicalGate` in `domain/generatedMechanicalGate.ts`; the
  `deriveMechanicalGateDiagnostic` option, `mechanicalGateAvailable` diagnostic, and gate stage in
  `assembleRoom.ts`; `buildPromptGeneratedRoomSource` opt-in; `GeneratedRoomSource` log line;
  co-located tests. **(implemented).**

**Out of scope / non-goals (must NOT be built in this feature):**

- ❌ Runtime enforcement / any wiring into `navigateWithExitGate`, `NavigationService`, or `App`
  (ADR-0061 Slice 5, separately approved later).
- ❌ Mutating the room to *insert* a flag-writer, lever, exit, or lock object (the builder derives
  from existing shape only).
- ❌ Storing or persisting a gate object on `AssembledRoom`, `RoomLoadResult`, `SaveGame`, or the
  generated-room cache.
- ❌ Objective ↔ gate integration (ADR-0061 Slice 6, separately approved later).
- ❌ Provider / prompt / LLM / fake-generator changes.
- ❌ `RoomSpec` / `WorldState` / `WorldEvent` / `SaveGame` / `QuestSpec` schema fields; new event
  types; new state stores; new save fields.
- ❌ Renderer / HUD signals (locked-door visuals, lock icons).
- ❌ Additional gate kinds, condition kinds, multi-step/sequenced gates, or any room-flag mutation
  by a gate.
- ❌ Cost-meter / usage changes; backend / server / SQLite changes; a new ESLint rule (the builder
  is domain-pure and already covered by the `domain/**` block).

---

## Data model

No new schema and no new persisted shape. The only additions are one pure function and one boolean
diagnostic field:

```ts
// domain/generatedMechanicalGate.ts — pure builder over a validated room.
export function buildGeneratedMechanicalGate(room: LoadedRoom): GeneratedMechanicalGate | null

// domain/assembleRoom.ts
export type AssembleRoomOptions = {
  // ...existing...
  deriveMechanicalGateDiagnostic?: boolean // default false
}

export type RoomDiagnostics = {
  // ...existing...
  /**
   * Whether a contract-valid, satisfiable mechanical gate is derivable from the
   * returned generated room. Boolean/count-only — this is the ONLY diagnostic or
   * log output for the feature. It never carries the gate id, room id, object id,
   * flag key, toRoomId, raw gate JSON, prompt/provider output, or any generated
   * description / object / room name. Always false when the option is off and on
   * every fallback path. The room is NOT modified to produce this signal.
   */
  mechanicalGateAvailable: boolean
}
```

---

## Files likely to change

- **New (Slice 1):** this ADR;
  `docs/architecture/implementation-plans/generated-mechanical-gate-fake-v0.md`.
- **Edited (Slice 1, docs):** `docs/architecture/ARCHITECTURE.md` (status note);
  `docs/architecture/FAILURE-MODES.md` (one case row).
- **Edited (Slice 2):** `apps/web/src/domain/generatedMechanicalGate.ts` (+ `.test.ts`);
  `apps/web/src/domain/assembleRoom.ts` (+ `.test.ts`);
  `apps/web/src/app/buildPromptGeneratedRoomSource.ts`;
  `apps/web/src/room/GeneratedRoomSource.ts` (+ `.test.ts`, log assertion).

## Files NOT to change

`domain/roomSpec.ts` · `domain/world/worldState.ts` · `domain/world/events.ts` ·
`domain/world/saveGame.ts` · `domain/quests/questSpec.ts` (schema) ·
`domain/quests/evaluateQuest.ts` · `domain/interactions/planInteraction.ts` · `app/exitGate.ts` ·
`app/gatedNavigation.ts` · `app/NavigationService.ts` · `App.tsx` · `renderer/**` ·
`generation/**` (no generator change) · `interactions/**` · `encounters/**` · `dialogue/**` ·
`memory/**` · `persistence/**` · `server/**` · the generated-room cache save/load path ·
`eslint.config.js` · `package.json`.

---

## Tests (Vitest, co-located, headless — Slice 2)

- **Builder — produces a gate:** a room with an `inspect` flag-writer + an exit → a non-null gate
  with `condition.roomId === room.id`, `condition.flag === interaction:<objectId>`,
  `effect.toRoomId === <exit target>`, and a stable id; the returned gate passes
  `validateGeneratedMechanicalGate` and `isGeneratedGateSatisfiable` (round-trip). Same for a
  `take-item` flag-writer.
- **Builder — returns null:** no flag-writer → `null`; no exit → `null`; only an encounter-owned
  interaction → `null`; only `use-item` → `null`; `condition.roomId` could not match → `null`.
- **Builder — deterministic:** the same room yields an identical gate across calls; first-in-array
  selection when multiple flag-writers / exits exist.
- **assembleRoom — off by default:** `deriveMechanicalGateDiagnostic` absent/`false` →
  `mechanicalGateAvailable === false`; the returned room is reference-identical to the no-option
  run (no mutation).
- **assembleRoom — on:** `deriveMechanicalGateDiagnostic: true` with `enrichObjectiveTarget: true` on a room
  whose objects yield a flag-writer + exit → `mechanicalGateAvailable === true`; the gate stage
  leaves the room objects unchanged (only the diagnostic differs).
- **assembleRoom — on but ungated room:** `deriveMechanicalGateDiagnostic: true` on a room with no
  flag-writer → `mechanicalGateAvailable === false`.
- **Fallback paths:** json/schema/semantic fallback → `mechanicalGateAvailable === false`.
- **Log-safety:** `GeneratedRoomSource` logs the boolean; no gate id/flag/toRoomId/name appears in
  any log context. The builder/module emits no logs.
- **Inertness:** no `app/**`, `renderer/**`, navigation, or save/load module enforces or persists
  the gate; navigation behavior is unchanged.

---

## Failure modes

| Situation | Detection | Handling | Logging |
| --- | --- | --- | --- |
| Room has no flag-writer or no exit | `buildGeneratedMechanicalGate` satisfiability check | return `null`; `mechanicalGateAvailable: false` → "no gate" (safe) | boolean only |
| Candidate fails the contract | `validateGeneratedMechanicalGate` / `isGeneratedGateSatisfiable` | return `null`; no gate surfaced | boolean only |
| Option off / adjacent / fallback room | `deriveMechanicalGateDiagnostic !== true` | builder not run; `mechanicalGateAvailable: false`; room unchanged | boolean only |
| Future enforcement attempts an unsatisfiable gate | ADR-0061 binding rule | rejected in design/review; enforcement consumes only the satisfiability-checked builder output | n/a |
| Stale gate after load (cache restore) | only matters once enforced | gate re-derives from the restored room; no second source of truth; no save field | none |

---

## Consequences

- A generated room in generated play deterministically yields a contract-valid, satisfiable
  `locked-exit` gate over its existing objective-target inspectable and ensured exit — surfaced as
  one safe boolean — with zero new objects, flags, schema, or persisted state.
- Runtime is byte-identical: authored play, existing generated play, navigation, the renderer,
  save/load, and every schema are unchanged; the gate enforces nothing yet.
- The deadlock/impossible-objective risk stays contained: the builder only returns
  satisfiability-checked gates, so a future enforcement slice inherits the guarantee.
- Future work (runtime enforcement at `navigateWithExitGate`, objective ↔ gate sharing) remains a
  series of small, independently approvable slices over a stable contract and a stable builder.

## Alternatives considered

- **Builder + room mutation to *insert* a flag-writer (ADR-0061 Slice 4 "insertion", Option C)** —
  rejected for v0: in generated play the flag-writer already exists via `enrichObjectiveTarget`, so
  a mutation step is redundant new code and risks disturbing object layout. Deferred unless a later
  slice needs gates in rooms without an objective target.
- **Storing the derived gate on `AssembledRoom` / persisting it** — rejected: dead data with no v0
  consumer; violates "derive, don't store" and would tempt a `SaveGame`/cache field. The gate
  re-derives on demand.
- **Builder only, wired into nothing (Option A)** — rejected as too thin: it would not exercise the
  generated pipeline at all, so "generated rooms can contain a gate candidate" would be untested in
  the real assembly path.
- **Runtime enforcement now** — rejected: ADR-0061's binding rule keeps enforcement a separate
  slice behind satisfiability; coupling it here reintroduces navigation-deadlock risk.
- **A new `RoomSpec`/`WorldState` gate field or event** — rejected: the existing flag substrate and
  the contract already encode the gate; a new field would create a second source of truth and
  schema creep for no benefit.
