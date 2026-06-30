# Implementation Plan — `feature/generated-mechanical-gate-fake-v0`

> Status: **Slice 2 implemented: deterministic builder + off-by-default diagnostic only.**
> Maintainer approved Scope B (pure builder + off-by-default pipeline diagnostic, no room
> mutation, no enforcement) and docs-first on 2026-06-30.
>
> **Depends on (implemented and merged):**
> - Generated Mechanical Gate Contract v0
>   ([ADR-0061](../decisions/ADR-0061-generated-mechanical-gate-contract-v0.md)) —
>   `validateGeneratedMechanicalGate`, `isGeneratedGateSatisfiable`, the closed gate types, and the
>   internal `flagWrittenByObject` / exit-detection helpers this builder reuses.
> - Generated Room Objective Target Enrichment v0
>   ([ADR-0048](../decisions/ADR-0048-generated-room-objective-target-enrichment-v0.md)) — the
>   `enrichObjectiveTarget` boolean-option pattern and the `inspect` flag-writer the gate condition
>   reuses.
> - Generated Room Exit Navigation v0
>   ([ADR-0041](../decisions/ADR-0041-generated-room-exit-navigation-v0.md)) —
>   `ensureGeneratedExitNavigation` guarantees the exit the gate effect reuses.
> - Object Interactions v0
>   ([ADR-0014](../decisions/ADR-0014-object-interactions-v0.md)) — `interactionFlagKey` defines
>   the `interaction:<objectId>` flag the gate condition must equal.
>
> Companion docs: [ARCHITECTURE](../ARCHITECTURE.md) · [BOUNDARIES](../BOUNDARIES.md) ·
> [FAILURE-MODES](../FAILURE-MODES.md) · [CONVENTIONS](../CONVENTIONS.md) ·
> [ADR-0062](../decisions/ADR-0062-generated-mechanical-gate-fake-v0.md).

---

## Goal

Make a generated room (in generated play) deterministically yield a **contract-valid, satisfiable
`GeneratedMechanicalGate`** — a `locked-exit` whose unlock `condition` is the room's existing
inspectable flag-writer and whose `effect.toRoomId` is the room's existing ensured exit — and
surface a single safe boolean signal that such a gate is available. No room mutation, no stored or
persisted gate, no schema change, **no runtime enforcement.**

This is ADR-0061's deferred "Slice 4 — deterministic gate insertion (data only)," realized as a
*derivation* because the ingredients already exist in a generated room. Runtime enforcement
(ADR-0061 Slice 5) and objective ↔ gate integration (Slice 6) remain explicitly out of scope.

---

## Minimum Safe Change Check

**What existing code is reused:**
- `validateGeneratedMechanicalGate` + `isGeneratedGateSatisfiable` + the closed gate types
  (`domain/generatedMechanicalGate.ts`) — the only trust boundary; the builder constructs a
  candidate and returns it only if both pass.
- The module's existing internal helpers `flagWrittenByObject` (inspect/take-item flag derivation,
  excludes encounters + `use-item`) and the exit check (`hasExitToRoom`) — reused to select the
  condition flag and the effect target. No second predicate or second exit scan.
- `interactionFlagKey` semantics (already used by `flagWrittenByObject`) — the gate's
  `condition.flag` equals `interaction:<objectId>` for a bare `inspect`, matching what
  `planInteraction` writes at runtime.
- `AssembleRoomOptions` + the `enrichObjectiveTarget` / `requestsNpc` boolean-option pattern, the
  `RoomDiagnostics` surface, `buildPromptGeneratedRoomSource`, and the `GeneratedRoomSource`
  structured log line.
- The already-guaranteed generated exit (`ensureGeneratedExitNavigation`, Stage 2.9) and, in
  generated play, the already-added objective-target `inspect` flag-writer (`enrichObjectiveTarget`,
  Stage 2.12.5).

**What new code is actually necessary (Slice 2):**
- One pure function `buildGeneratedMechanicalGate(room): GeneratedMechanicalGate | null`
  (~25–40 lines) added to the existing gate module, plus tests.
- `assembleRoom`: one option field `deriveMechanicalGateDiagnostic?: boolean`, one diagnostic field
  `mechanicalGateAvailable: boolean`, and a small gate stage (run builder on the final room when
  the option is on; **return the room unchanged**), plus tests.
- One-line opt-in in `buildPromptGeneratedRoomSource` (`deriveMechanicalGateDiagnostic: true`).
- One extra boolean in the `GeneratedRoomSource` log context (+ a log-safety test assertion).

**Safety boundaries unchanged:**
- `RoomSpec` / `WorldState` / `WorldEvent` / `SaveGame` / `QuestSpec` schemas — no new field,
  `schemaVersion` stays `1`.
- Navigation / enforcement — `exitGate.ts`, `gatedNavigation.ts`, `NavigationService`, `App.tsx`
  untouched; the gate blocks nothing.
- The room — the gate stage returns the same `LoadedRoom` reference; objects, ids, effects, exits,
  provenance unchanged.
- Generation — no provider/prompt/LLM/fake-generator change; the builder ingests a validated
  `LoadedRoom`, never raw text.
- Persistence — no `SaveGame` field; the generated-room cache (ADR-0060) is untouched because the
  gate re-derives after restore.
- Logging — the diagnostic/log output is limited to the single `mechanicalGateAvailable`
  boolean/count only. It is explicitly forbidden to log the gate id, room id, object id, flag key,
  `toRoomId`, raw gate JSON, prompt/provider output, or any generated description / object / room /
  NPC name. The builder/domain module logs nothing; only the host (`GeneratedRoomSource`) logs, and
  only the boolean.

**Targeted tests:**
- `npm run test -- generatedMechanicalGate`
- `npm run test -- assembleRoom`
- `npm run lint` and `npm run build` (confirm the domain-pure import wall holds; no other change).

---

## Architecture & boundary fit

- **Layer:** Domain (`buildGeneratedMechanicalGate`, pure) + a thin assembly-pipeline diagnostic
  (`assembleRoom`) + composition opt-in (`buildPromptGeneratedRoomSource`) + host logging
  (`GeneratedRoomSource`). Same layering as `enrichObjectiveTarget` (ADR-0048).
- **Authority:** `WorldState` + event log stay authoritative. The gate is a derivation over a
  validated room; it never writes, appends, stores, or persists. Mirrors ADR-0054 "derive, don't
  store" — applied to the gate object itself, as ADR-0061 applies it to gate state.
- **Trust boundary:** the ADR-0061 contract functions are the only gate validator. The builder
  cannot emit an invalid or unsatisfiable gate.
- **ESLint:** none added; the builder is domain-pure under the existing `domain/**` block.

---

## The v0 builder (to implement in Slice 2)

```ts
// apps/web/src/domain/generatedMechanicalGate.ts (added alongside the existing exports)

/**
 * Derive a contract-valid, satisfiable locked-exit gate from a generated room's
 * EXISTING shape: the first object that writes a room flag (inspect/take-item,
 * excluding encounters and use-item) becomes the unlock condition; the first
 * forward exit becomes the governed exit. Returns null ("no gate" — the safe
 * state) when either ingredient is missing or the candidate is not satisfiable.
 * Pure, deterministic, no mutation, no logging, no provider/prompt input.
 */
export function buildGeneratedMechanicalGate(
  room: LoadedRoom,
): GeneratedMechanicalGate | null {
  const flag = firstFlagWriter(room)              // reuses flagWrittenByObject
  const toRoomId = firstForwardExitTarget(room)   // reuses exit detection
  if (flag === undefined || toRoomId === undefined) return null

  const candidate = validateGeneratedMechanicalGate({
    id: `${room.id}:mechanical-gate`,
    kind: 'locked-exit',
    condition: { kind: 'room-flag', roomId: room.id, flag },
    effect: { kind: 'unlock-exit', toRoomId },
  })
  if (candidate === null) return null
  return isGeneratedGateSatisfiable(candidate, room) ? candidate : null
}
```

- `firstFlagWriter` / `firstForwardExitTarget` are tiny internal helpers that reuse the existing
  `flagWrittenByObject` and exit-presence logic already in the module (no duplicated predicate).
  Selection is first-in-array-order for determinism.
- Running the candidate back through `validateGeneratedMechanicalGate` + `isGeneratedGateSatisfiable`
  keeps the ADR-0061 contract as the single guarantee, even though the builder constructs the
  candidate itself.

### Pipeline diagnostic (assembleRoom)

- Add `deriveMechanicalGateDiagnostic?: boolean` to `AssembleRoomOptions` (default `false`).
- After Stage 2.13 (display sanitization), on the **final** room, compute:
  ```ts
  const mechanicalGateAvailable =
    options.deriveMechanicalGateDiagnostic === true &&
    buildGeneratedMechanicalGate(finalRoom) !== null
  ```
  The room is **not** reassigned. Add `mechanicalGateAvailable` to every `RoomDiagnostics` return
  (generated, repaired, both fallbacks, and `toFallback`) — `false` on all degraded/fallback paths.
- `buildPromptGeneratedRoomSource` adds `deriveMechanicalGateDiagnostic: true`. Adjacent pregeneration keeps
  the default `false`.
- `GeneratedRoomSource.logAssembly` adds `mechanicalGateAvailable: diagnostics.mechanicalGateAvailable`
  to its existing safe context.

---

## Slices

1. **Docs-only (this slice).** ADR-0062 + this plan + an ARCHITECTURE status note + a FAILURE-MODES
   row. No code. Verify with the smallest relevant check; report any skipped check.
2. **Builder + pipeline diagnostic (pending approval).**
   `buildGeneratedMechanicalGate` + tests; `deriveMechanicalGateDiagnostic` option, `mechanicalGateAvailable`
   diagnostic + gate stage in `assembleRoom` + tests; `buildPromptGeneratedRoomSource` opt-in;
   `GeneratedRoomSource` log + log-safety test.
   `npm run test -- generatedMechanicalGate`, `npm run test -- assembleRoom`, `npm run lint`,
   `npm run build`.
3. **(Later — separately approved) Runtime enforcement** at the `navigateWithExitGate` seam,
   gated on the builder's satisfiability-checked gate, surfacing the existing `reason:'blocked'`
   static message. Browser smoke checklist belongs here. Out of this feature (ADR-0061 Slice 5).
4. **(Later — separately approved) Objective ↔ gate integration** — share an unlock flag so
   completing the objective opens the exit. Out of this feature (ADR-0061 Slice 6).

> Save/load is intentionally **not** a slice: the gate is re-derivable from the room, which already
> persists via ADR-0059 / ADR-0060. No save/load code change is anticipated; a future enforcement
> slice may add a regression test confirming re-derivation after restore.

---

## Test plan (Slice 2)

Pure domain + assembly, co-located, headless.

- **Builder — produces a gate:** room with an `inspect` flag-writer + an exit → non-null gate with
  `condition.roomId === room.id`, `condition.flag === interaction:<objectId>`,
  `effect.toRoomId === <exit target>`, stable id `<roomId>:mechanical-gate`; the returned gate
  passes `validateGeneratedMechanicalGate` and `isGeneratedGateSatisfiable`. Same for a `take-item`
  flag-writer.
- **Builder — null cases:** no flag-writer → `null`; no exit → `null`; only encounter-owned
  interaction → `null`; only `use-item` → `null`.
- **Builder — deterministic / selection:** same room → identical gate across calls; first-in-array
  flag-writer and first-in-array exit chosen when several exist.
- **assembleRoom — off/default:** `deriveMechanicalGateDiagnostic` absent or `false` →
  `mechanicalGateAvailable === false`; returned room reference-identical to the no-option run.
- **assembleRoom — on, gated room:** `deriveMechanicalGateDiagnostic: true` + `enrichObjectiveTarget: true`
  on a room that yields a flag-writer + exit → `mechanicalGateAvailable === true`; room objects
  unchanged by the gate stage.
- **assembleRoom — on, ungated room:** `deriveMechanicalGateDiagnostic: true` on a room with no flag-writer →
  `mechanicalGateAvailable === false`.
- **assembleRoom — fallbacks:** json/schema/semantic fallback → `mechanicalGateAvailable === false`.
- **GeneratedRoomSource — threading + log-safety:** option threads through; log context includes
  only the `mechanicalGateAvailable` boolean and no gate id, room id, object id, flag key,
  `toRoomId`, raw gate JSON, or generated name/description.
- **Inertness:** navigation/enforcement/persistence behavior unchanged; no module enforces or
  persists the gate.

---

## Verification commands

- `npm run test -- generatedMechanicalGate`
- `npm run test -- assembleRoom`
- `npm run test -- GeneratedRoomSource`
- `npm run lint`
- `npm run build`
- `git diff --check`

---

## Risks & non-goals

- **Overbuilding toward a puzzle/lock system** — mitigated: one builder, one `locked-exit` kind,
  one `room-flag` condition (all from ADR-0061), no levers/sequences/multi-step, no room mutation.
- **Dead data** — mitigated: the gate is not stored; the only current consumer is the boolean
  diagnostic. The gate re-derives on demand for a future enforcement slice.
- **Navigation deadlocks** — impossible in v0 (no enforcement); the builder only ever returns
  satisfiability-checked gates, preserving ADR-0061's binding rule for future enforcement.
- **Schema / save-load creep** — none: no `RoomSpec`/`WorldState`/`SaveGame`/`QuestSpec` field, no
  event, no store, no cache change.
- **Leaking ids/flags** — the builder/module logs nothing; only `mechanicalGateAvailable` (boolean)
  is logged by the host.
- **Authored / adjacent behavior change** — none: the option defaults `false`, adjacent keeps the
  default, and the room is returned unchanged on every path.

**Non-goals:** runtime enforcement, navigation locking, room mutation/insertion, gate storage or
persistence, objective ↔ gate wiring, UI/renderer signals, additional gate/condition kinds,
provider/LLM/fake-generator changes, cost-meter changes, backend/server changes.
