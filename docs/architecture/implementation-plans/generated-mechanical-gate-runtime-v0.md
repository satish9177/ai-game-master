# Implementation Plan — `feature/generated-mechanical-gate-runtime-v0`

> Status: **Slice 1 complete: ADR-0063 + this plan (docs-only).**
> Maintainer approved the re-derive architecture on 2026-07-01.
>
> **Depends on (implemented and merged):**
> - Generated Mechanical Gate Contract v0
>   ([ADR-0061](../decisions/ADR-0061-generated-mechanical-gate-contract-v0.md)) —
>   `validateGeneratedMechanicalGate`, `evaluateGeneratedGate`, `isGeneratedGateSatisfiable`, and
>   the closed gate types this enforcement slice consumes.
> - Generated Mechanical Gate Fake v0
>   ([ADR-0062](../decisions/ADR-0062-generated-mechanical-gate-fake-v0.md)) —
>   `buildGeneratedMechanicalGate(room)` (the deterministic re-derive builder that is the only
>   path to an enforceable gate) and the `mechanicalGateAvailable` diagnostic.
> - Object Interactions v0
>   ([ADR-0014](../decisions/ADR-0014-object-interactions-v0.md)) — `planInteraction` /
>   `interactionFlagKey`: the only writer of the flag the gate condition reads. Interacting with the
>   in-room object writes `room-state-changed { flags: { [interactionFlagKey(...)]: true } }`.
> - Session Save/Load v0 / Generated Quest Save-Load v0
>   ([ADR-0059](../decisions/ADR-0059-generated-quest-save-load-v0.md),
>   [ADR-0060](../decisions/ADR-0060-generated-room-cache-save-load-v0.md)) — the gate re-derives
>   from the restored room + persisted `WorldState` flags after a save/load cycle; no new save field
>   is required or added.
>
> Companion docs: [ARCHITECTURE](../ARCHITECTURE.md) · [BOUNDARIES](../BOUNDARIES.md) ·
> [FAILURE-MODES](../FAILURE-MODES.md) · [CONVENTIONS](../CONVENTIONS.md) ·
> [ADR-0063](../decisions/ADR-0063-generated-mechanical-gate-runtime-v0.md).

---

## Goal

Safely enforce deterministic generated mechanical gates at runtime. When a generated room has a
valid/satisfiable generated mechanical gate, the governed exit is blocked while the gate condition
is locked, and becomes available after the player interacts with the required in-room object.

No schema change, no persistence change, no renderer change, no provider/LLM/cost call.

---

## Gate-state rule (authoritative — implement exactly this)

This table is the implementation source of truth for every gate verdict:

| Situation | Verdict |
|---|---|
| `getWorldState` fails or `WorldState` unavailable | **open** — fail-open; navigate normally |
| `buildGeneratedMechanicalGate(room)` returns `null` | **open** — no gate / unsatisfiable / exit free |
| Gate governs a different exit (`gate.effect.toRoomId !== toRoomId`) | **open** — only one exit governed; others unconditionally open |
| Gate valid, governs this exit; flag absent or `false` in `WorldState` | **locked** — return `reason:'gate-locked'` |
| Gate valid, governs this exit; flag `=== true` in `WorldState` | **open** — unlocked; navigate normally |

Key points:
- `getWorldState` failure → **fail-open** (do not use a stale or missing state; never block on infra error).
- Valid gate + flag absent (room-state-flags key missing, or value `false`) → **locked** (flag not
  yet set; the player must interact with the required object first).
- After `planInteraction` writes the flag (`=== true`), the next navigation attempt → **open**.
- `null` gate for any reason → **open** (unsatisfiable, no flag-writer, no exit, contract invalid).

---

## Minimum Safe Change Check

**What existing code is reused:**

- `buildGeneratedMechanicalGate(room)` (`domain/generatedMechanicalGate.ts`) — the builder is
  called directly; already passes `validateGeneratedMechanicalGate` + `isGeneratedGateSatisfiable`
  internally. No second validator is needed.
- `evaluateGeneratedGate(gate, state)` — the pure gate-state evaluator; reuses `evaluateCondition`
  from `domain/quests/evaluateQuest.ts`. No new predicate.
- `navigateWithExitGate` (`app/gatedNavigation.ts`) — the exact enforcement seam, same pattern as
  the authored demo gate. The `getWorldState` fetch already happens here; reused for both checks.
- `evaluateExitGate` + `ExitGateResult` (`app/exitGate.ts`) — not touched; the new module
  `generatedExitGate.ts` mirrors its shape for consistency.
- `NavigationResult` rejected reason union (`app/NavigationService.ts`) — widened with one string
  token `'gate-locked'` (TypeScript only; not serialized).
- `navigationResultMessage` (`app/exits.ts`) — existing switch extended with one new branch.
- `activePlay.objectivesPerRoom` (`App.tsx`) — existing boolean already distinguishing generated
  from authored play; used as the scope guard without any new field.
- `activePlay.room` (`App.tsx`) — already in scope; passed as `currentRoom` to the seam.

**What new code is actually necessary:**

- `app/generatedExitGate.ts` — one pure evaluator function + one result type (~25 lines).
- `app/generatedExitGate.test.ts` — co-located unit tests.
- `gatedNavigation.ts` — two new params (`generatedGateEnabled`, `currentRoom`) + one generated-
  gate `if` block (~10 lines).
- `NavigationService.ts` — one string token added to an existing union (1 line).
- `exits.ts` — one new `if` branch in `navigationResultMessage` (~3 lines).
- `App.tsx` — two extra args in the `navigateWithExitGate` call (~2 lines).

**Safety boundaries unchanged:**

- `RoomSpec` / `WorldState` / `WorldEvent` / `SaveGame` / `QuestSpec` schemas — `schemaVersion`
  remains `1`; no new field, no new event type.
- Authored demo gate — `exitGate.ts` is not touched; `reason:'blocked'` and the Malik message are
  byte-identical.
- The generated room — `buildGeneratedMechanicalGate` is read-only; no room mutation.
- Persistence / save-load — no new save field; gate re-derives after restore from existing data.
- Renderer / Three.js — no renderer file touched.
- Generation / provider — no provider call, no fake generator change.
- Logging — the seam may log a boolean/enum result only; no gate id, room id, object id, flag key,
  `toRoomId`, raw gate JSON, or generated description is ever logged.

**Targeted tests per slice:**

- Slice 2: `npm run test -- generatedExitGate`
- Slice 3: `npm run test -- gatedNavigation`, `npm run test -- exits`
- Slice 4: `npm run test -- App`
- Full: `npm run test`, `npm run lint`, `npm run build`

---

## Architecture & boundary fit

- **Layer:** `app/generatedExitGate.ts` is a pure app-layer function (same layer as `exitGate.ts`).
  It imports from `domain/` (the gate builder and evaluator) but has no I/O, no React, no Three.js.
- **Authority:** `WorldState` + event log remain authoritative. The evaluator reads flags; it never
  writes, appends, or mutates.
- **Trust boundary:** `buildGeneratedMechanicalGate` is the only path to an enforceable gate; it
  already runs `validateGeneratedMechanicalGate` + `isGeneratedGateSatisfiable`. A `null` result is
  always open.
- **Scope guard:** `generatedGateEnabled = activePlay.objectivesPerRoom === true`. Authored play,
  fallback play, and adjacent-pregeneration rooms are never in scope.

---

## Slices

### Slice 1 — Docs-only (this slice, complete)

ADR-0063 + this plan. No code change.

Verification: `npm run lint` (docs-only change; confirm no lint error on changed files).

### Slice 2 — Pure evaluator (no wiring)

**File: `apps/web/src/app/generatedExitGate.ts` (new)**

```ts
import { buildGeneratedMechanicalGate, evaluateGeneratedGate } from '../domain/generatedMechanicalGate'
import type { LoadedRoom } from '../domain/loadRoomSpec'
import type { WorldState } from '../domain/world/worldState'

export type GeneratedExitGateResult = { gated: false } | { gated: true }

export function evaluateGeneratedExitGate(input: {
  room: LoadedRoom
  toRoomId: string
  state: Partial<Pick<WorldState, 'roomStates'>> | null | undefined
}): GeneratedExitGateResult {
  const { room, toRoomId, state } = input
  const gate = buildGeneratedMechanicalGate(room)
  if (gate === null) return { gated: false }
  if (gate.effect.toRoomId !== toRoomId) return { gated: false }
  return evaluateGeneratedGate(gate, state as WorldState) === 'locked'
    ? { gated: true }
    : { gated: false }
}
```

Note on `state` typing: `evaluateGeneratedGate` accepts `WorldState`; the seam passes a
`Partial<Pick<WorldState,'roomStates'>> | null | undefined` because we only need `roomStates` and
the evaluator handles missing entries gracefully (returns `'locked'` if the room state is absent,
which is correct — the flag has not been set). Cast to `WorldState` is safe here because
`evaluateCondition` only reads `.roomStates[roomId]?.flags?.[flag]`. If a lighter type is
preferred, introduce a `GateStateInput` type alias for this narrow shape and update
`evaluateGeneratedGate` to accept it — that is a follow-up cleanup, not v0 scope.

**File: `apps/web/src/app/generatedExitGate.test.ts` (new)**

Tests per the test plan in ADR-0063 Slice 2 section. Co-located, headless, Vitest.

Verification: `npm run test -- generatedExitGate`, `npm run lint`.

### Slice 3 — Navigation seam + safe message

**File: `apps/web/src/app/gatedNavigation.ts` (modify)**

Add `generatedGateEnabled: boolean` and `currentRoom: LoadedRoom` to the input type. Import
`evaluateGeneratedExitGate`. After the demo-gate check and before calling `navigate`:

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

`stateResult` is already in scope from the fetch above. If `getWorldState` was not fetched (neither
`demoQuestEnabled` nor `generatedGateEnabled` were true in theory — but in practice these two are
mutually exclusive in the current design), ensure the fetch is guarded correctly:

```ts
// Fetch state once when either gate check is active.
let stateResult: WorldStateResult | undefined
if (demoQuestEnabled || generatedGateEnabled) {
  stateResult = await getWorldState(sessionId)
}
```

On `getWorldState` failure (`!stateResult.ok`) the evaluator receives `null` → `{ gated: false }` →
navigate (fail-open, consistent with the demo-gate path).

**File: `apps/web/src/app/NavigationService.ts` (modify)**

Widen the `NavigationResult` rejected reason union:

```ts
// Before:
| { status: 'rejected'; reason: 'missing-exit' | 'unknown-room' | 'already-here' | 'blocked' }
// After:
| { status: 'rejected'; reason: 'missing-exit' | 'unknown-room' | 'already-here' | 'blocked' | 'gate-locked' }
```

No other change to `NavigationService.ts`.

**File: `apps/web/src/app/exits.ts` (modify)**

Add a new branch in `navigationResultMessage`:

```ts
if (result.status === 'rejected' && result.reason === 'gate-locked') {
  return 'This exit is sealed. Find what activates it in this room.'
}
```

The string is **fixed and static**: no room ids, no object ids, no flag keys, no `toRoomId`, no
generated content. Position the new branch before the existing `'blocked'` branch to avoid
shadowing concerns.

Verification: `npm run test -- gatedNavigation`, `npm run test -- exits`, `npm run lint`,
`npm run build`.

### Slice 4 — App wiring + integration tests

**File: `apps/web/src/App.tsx` (modify)**

In `handleNavigate`, add two args to the `navigateWithExitGate` call:

```ts
const result = await navigateWithExitGate({
  sessionId: activePlay.sessionId,
  fromRoomId: activePlay.room.id,
  toRoomId,
  demoQuestEnabled: activePlay.questSpec != null,
  getWorldState: (sessionId) => worldSession.getWorldState(sessionId),
  navigate: () => navigation.navigate({ sessionId: activePlay.sessionId, toRoomId }),
  // new:
  generatedGateEnabled: activePlay.objectivesPerRoom === true,
  currentRoom: activePlay.room,
})
```

No other `App.tsx` change.

**File: `apps/web/src/App.test.tsx` (add/modify tests)**

- Generated play, locked gate: navigate governed exit before interaction → `reason:'gate-locked'`.
- Generated play, interaction writes flag → navigate governed exit → `status:'navigated'`.
- Generated play, non-governed exit → unaffected by gate; navigates normally.
- Generated play, `getWorldState` fails → navigate fails-open.
- Authored demo-gate flow: `reason:'blocked'` still triggers for Malik gate; generated-gate check
  not entered in authored play.
- `objectivesPerRoom: false` (or undefined) → `generatedGateEnabled` is `false` → generated check
  never runs.

Verification: `npm run test -- App`, `npm run lint`, `npm run build`.

### Slice 5 — Save/load regression + leakage closeout

**Tests (add to appropriate test files):**

- Save a generated session with locked gate → reload → `buildGeneratedMechanicalGate(restoredRoom)`
  produces the same gate; `evaluateGeneratedGate` with restored `WorldState` (flag absent) →
  `'locked'`; navigate governed exit → `reason:'gate-locked'`.
- After interact (flag set) → save → reload → flag present in restored `WorldState` →
  `evaluateGeneratedGate` → `'unlocked'`; navigate → `status:'navigated'`.
- Log-leakage check: structured log context from the gate-enforcement path contains no gate id,
  room id, object id, flag key, `toRoomId`, raw gate JSON, prompt/provider content, or generated
  description. Only boolean/enum values permitted.
- No new provider/LLM/cost call in the gate enforcement code path (static check via import
  analysis or test spy).

**Docs:**

- `docs/architecture/ARCHITECTURE.md` — add a status note for `feature/generated-mechanical-gate-runtime-v0`.
- `docs/architecture/FAILURE-MODES.md` — add one row for the locked-gate case.

Verification: `npm run test`, `npm run lint`, `npm run build`.

---

## Manual smoke checklist (Slice 4 / Slice 5)

1. Start the dev server with a generated room that has `mechanicalGateAvailable: true` (logs will
   confirm the boolean).
2. Attempt to navigate the governed exit (the first exit in array order) before interacting with
   any object. Expect: navigation rejected; UI shows the static sealed-exit message.
3. Interact with the required object (the flag-writer: inspect or take-item). No navigation prompt
   appears; the interaction resolves normally.
4. Attempt the governed exit again. Expect: navigation succeeds; room changes.
5. Save the session (Save/Load bar).
6. Refresh the browser or load the save. Expect: the gate re-derives from the restored room; the
   flag is present in `WorldState` (interaction already done); navigate the governed exit →
   succeeds immediately.
7. In a **separate** authored session (throne-room start): confirm the Malik demo gate still blocks
   the `ruined-safehouse` exit as before; generated-gate branch never fires.

---

## Test plan (all slices)

### Slice 2 — `evaluateGeneratedExitGate` (pure, co-located)

- Governed exit + flag set → `{ gated: false }`.
- Governed exit + flag absent → `{ gated: true }`.
- Governed exit + flag `false` → `{ gated: true }`.
- Non-governed exit (different `toRoomId`) → `{ gated: false }` regardless of flag state.
- Room yields `null` gate (no flag-writer, no exit) → `{ gated: false }`.
- `state` is `null` → `{ gated: false }` (fail-open).
- `state` is `undefined` → `{ gated: false }` (fail-open).
- `state.roomStates` missing the gate's room → `{ gated: false }` (flag not yet set; open is wrong
  here — actually this is locked: the flag has not been written yet).

  **Correction:** `state.roomStates` missing the gate's room → `evaluateGeneratedGate` reads
  `roomStates[roomId]?.flags?.[flag]` → `undefined` → `=== true` is `false` → returns `'locked'`
  → `{ gated: true }`. This is the correct behaviour: the flag has not been set, so the gate
  IS locked. The fail-open only applies when `state` itself is `null`/`undefined` (infra error).
  Tests must verify both cases.

- `state.roomStates[roomId].flags` exists but does not include the gate's flag key → `{ gated: true }`.
- After flag is set (`=== true`): governed exit → `{ gated: false }`.
- Deterministic: same room + same state → same result across calls.
- No mutation of `room` or `state`.

### Slice 3 — Navigation seam + message

- `generatedGateEnabled: true`, locked governed exit → `reason:'gate-locked'`; `navigate` not
  called.
- `generatedGateEnabled: true`, unlocked (flag set) → `navigate` called.
- `generatedGateEnabled: true`, `getWorldState` fails → fail-open; `navigate` called.
- `generatedGateEnabled: true`, `null`-gate room → `navigate` called.
- `generatedGateEnabled: false` → generated check entirely skipped.
- Demo path: `demoQuestEnabled: true`, Malik flag absent → `reason:'blocked'`; `navigate` not
  called (unchanged).
- `navigationResultMessage` with `reason:'gate-locked'` → returns static sealed-exit string.
- `navigationResultMessage` with `reason:'blocked'` → still returns Malik string (unchanged).
- `navigationResultMessage` for all other reasons unchanged.

### Slice 4 — App integration + interaction unlock

- Generated play, navigate locked governed exit → UI shows sealed-exit message.
- Interact with required object, then navigate → succeeds.
- Non-governed exit unblocked throughout.
- Authored demo-gate flow end-to-end unchanged.
- `objectivesPerRoom: false` → `generatedGateEnabled: false` → generated check never runs.

### Slice 5 — Save/load regression + leakage

- Save before interaction → restore → gate still locked → block.
- Save after interaction → restore → gate unlocked → open.
- No log line in gate path contains disallowed identifiers or generated content.
- No provider/cost call in gate enforcement path.

---

## Risks & non-goals

**Risks and mitigations:**

- **Navigation deadlock** — mitigated by the builder's satisfiability guarantee (`null` → open)
  and the rule that only the *governed* exit is blocked (other exits stay open). Confirmed by tests.
- **Stale gate derivation** — mitigated by re-deriving on every navigation attempt from the
  in-memory `activePlay.room`. Room does not change between navigation calls to the same room.
- **Infra error stranding the player** — mitigated by the fail-open rule: `getWorldState` failure
  → `null` state → evaluator → `{ gated:false }` → navigate.
- **Log/UI leakage** — mitigated by the static string and the no-identifier logging rule. Verified
  by Slice 5 leakage tests.
- **Breaking authored demo gate** — mitigated by the `generatedGateEnabled` scope guard (off for
  authored play) and by not touching `exitGate.ts`.
- **Breaking save/load** — no save schema change; the gate re-derives; flag state restores via
  existing `WorldState`. Verified by Slice 5 regression.
- **Accidental LLM gate generation** — impossible in this feature: only `buildGeneratedMechanicalGate`
  can produce an enforceable gate, and it reads a `LoadedRoom` (never a prompt or provider output).

**Non-goals for this feature:**

- Objective ↔ gate sharing (ADR-0061 Slice 6, separately approved).
- Renderer lock visuals, door-barred HUD, lock icons.
- Additional gate kinds, condition kinds, multi-step / sequenced gates.
- Dynamic or LLM-generated gate predicates.
- Schema fields on `RoomSpec`, `WorldState`, `SaveGame`, or `QuestSpec`.
- Backend / server / SQLite changes.
- Cost-meter / usage changes.
- Mutation of rooms, objects, interactions, or exits.
