# ADR-0064: Generated Mechanical Gate Provider v0 — real LLM gate proposals

- **Status:** Implemented
- **Date:** 2026-07-01
- **Deciders:** Project owner
- **Extends:**
  [ADR-0063](./ADR-0063-generated-mechanical-gate-runtime-v0.md) (the deterministic runtime
  evaluator `evaluateGeneratedExitGate` and `navigateWithExitGate` seam — this ADR adds an
  optional provider layer on top; ADR-0063 behavior is unchanged when the provider is disabled
  or rejected),
  [ADR-0061](./ADR-0061-generated-mechanical-gate-contract-v0.md) (the frozen
  `GeneratedMechanicalGate` contract — `validateGeneratedMechanicalGate`,
  `isGeneratedGateSatisfiable`, `evaluateGeneratedGate`, `buildGeneratedMechanicalGate` — not
  modified by this ADR).
- **Related:**
  [ADR-0049](./ADR-0049-real-generated-objective-provider-v0.md) (the mirror pattern:
  `OpenAICompatibleObjectiveGenerator`, `selectObjectiveGenerator`, discriminated selection,
  `buildGeneratedObjectiveAttachment`, `assembleObjective` — this ADR mirrors that pattern),
  [ADR-0014](./ADR-0014-object-interactions-v0.md) (`interactionFlagKey` — the only source of
  truth for the flag a gate condition reads; imported by the assembler to derive `condition.flag`),
  [ADR-0051](./ADR-0051-generated-objective-per-room-v0.md) (`objectivesPerRoom` flag — the scope
  guard that gates the provider call to generated play only),
  [ADR-0013](./ADR-0013-world-state-event-log-v0.md) (`WorldState` — gate state is a read-only
  derivation from flags; the provider never writes or appends),
  the `canAttemptOptional` usage guard (`app/usageGuard.ts`) — the provider call must be behind
  this guard.

> Full pre-code design in the implementation plan
> [`generated-mechanical-gate-provider-v0`](../implementation-plans/generated-mechanical-gate-provider-v0.md).

> v0 is **provider proposes structural data only; app derives and validates the full gate.**
> The LLM may propose only `{ unlockObjectId, exitToRoomId }`. The app derives every other field
> (flag key, condition kind, effect kind, gate id), validates via the frozen contract, and checks
> satisfiability. A `providerGateStatus` field on `ActivePlay` carries one of three states:
> `'not-attempted'` (deterministic ADR-0063 path), `'accepted'` (provider gate active), or
> `'rejected'` (fail open — deterministic must not run). Neither the gate nor the status is
> persisted. On restore, absent status → `'not-attempted'` → deterministic re-derive. Adjacent
> rooms do not call the gate provider in v0.

---

## Context

ADR-0063 established that a generated room's mechanical gate is deterministically derived from the
in-memory `LoadedRoom` on every navigation attempt. This is correct, safe, and sufficient. However,
the deterministic builder (`buildGeneratedMechanicalGate`) picks the first flag-writing object and
the first exit — it cannot account for narrative context, room theme, or the player's current
objectives. Allowing the real provider/LLM to propose which object and exit should form the gate
would make the gate more contextually coherent without compromising any safety boundary.

Three implementation facts make this extension safe:

1. **The frozen contract enforces correctness.** `validateGeneratedMechanicalGate` and
   `isGeneratedGateSatisfiable` are unchanged. Any provider proposal that cannot pass these checks
   is silently dropped. The contract is the only path to an enforceable gate.

2. **The provider never sees or returns a full gate.** The proposal schema is minimal:
   `{ unlockObjectId, exitToRoomId }`. The app derives all flag keys, condition kinds, effect kinds,
   and gate ids — the same derivation logic as the deterministic builder.

3. **The exact mirror pattern already exists.** ADR-0049 (Real Generated Objective Provider v0)
   established `OpenAICompatibleObjectiveGenerator` / `selectObjectiveGenerator` /
   `buildGeneratedObjectiveAttachment` / `assembleObjective`. This ADR mirrors that pattern with a
   dedicated gate-specific provider, a strict structural proposal schema, and an assembler pipeline.

---

## Decision

### Proposal schema

The provider proposes only structural anchor data:

```ts
// domain/generatedMechanicalGateProposal.ts
const GeneratedGateProposalSchema = z.object({
  unlockObjectId: z
    .string()
    .trim()
    .min(1)
    .refine((v) => !/^(?:interaction|encounter):/.test(v), {
      message: 'unlockObjectId must be a room object id, not a derived flag key',
    }),
  exitToRoomId: z.string().trim().min(1),
}).strict()
```

`unlockObjectId` and `exitToRoomId` are the only fields the provider supplies. Every other field
of `GeneratedMechanicalGate` (the flag key, condition kind, effect kind, gate id) is derived by
the assembler using the same logic as `buildGeneratedMechanicalGate`.

### `assembleGate` pipeline

```
rawText
  → JSON.parse              (drop on parse-failed)
  → GeneratedGateProposalSchema.safeParse  (drop on schema-invalid)
  → find object by id in room.objects     (drop on unlock-unsatisfiable: object not found,
                                           or flagForProposedObject returns undefined — not
                                           a flag-writing interaction)
  → derive condition.flag via flagForProposedObject(object) = interactionFlagKey(object.flag, object.id)
  → verify exitToRoomId exists on an in-room interaction exit (drop on exit-unsatisfiable)
  → build raw gate structure
  → validateGeneratedMechanicalGate(raw)  (drop on gate-invalid)
  → isGeneratedGateSatisfiable(gate, room) (drop on gate-invalid)
  → return { gate }
```

`flagForProposedObject` is a private helper in `domain/generatedMechanicalGateProposal.ts` with
identical logic to the private `flagWrittenByObject` in the frozen `domain/generatedMechanicalGate.ts`.
It is NOT imported from that module (the function is private and the contract module is frozen).
It imports only `interactionFlagKey` from `domain/interactions/planInteraction.ts`.

Drop reasons are intentionally internal only. No `GateAssemblyDropCode` is exported, logged,
surfaced to the UI, or included in any error message. The assembler returns `{ gate } | null` —
the caller does not inspect the reason; all drop outcomes resolve to `null`.

### `ProviderGateStatus` (transient, not persisted)

```ts
type ProviderGateStatus = 'not-attempted' | 'accepted' | 'rejected'
```

Added as optional fields on `ActivePlay` (transient only — never in `SaveGame`, never serialized):

```ts
// In ActivePlay:
providerGateStatus?: ProviderGateStatus
providerGate?: GeneratedMechanicalGate
```

These fields are absent after save/load restore. Absent status is treated as `'not-attempted'`.

### Three-path gate-state rule (authoritative)

| `providerGateStatus` (or absent) | `isGeneratedGateSatisfiable` re-check | Verdict |
|---|---|---|
| `'not-attempted'` or absent | — | deterministic `buildGeneratedMechanicalGate(room)` (ADR-0063) |
| `'rejected'` | — | **fail open** — `{ gated: false }`; deterministic must NOT run |
| `'accepted'` | fails (provider gate no longer satisfiable for current room) | **fail open** — `{ gated: false }`; deterministic must NOT run |
| `'accepted'` | passes | evaluate `providerGate` against `WorldState`; lock/unlock as normal |

**Key rule:** `'rejected'` and `'accepted'-but-unsatisfiable` both resolve to fail open without
falling back to the deterministic path. The deterministic builder only runs when the provider was
never attempted (`'not-attempted'` or absent). This is an explicit, non-negotiable maintainer
decision.

### `selectGateGenerator` discriminated union

```ts
// app/selectGateGenerator.ts
type RealGateSelectionLog = { provider: RealLlmProvider; model: string }
type DisabledGateSelectionLog = { provider: 'disabled'; reason: 'config-disabled' }

type GateGeneratorSelection =
  | { kind: 'real'; generator: GateGenerator; log: RealGateSelectionLog }
  | { kind: 'disabled'; reason: 'config-disabled'; log: DisabledGateSelectionLog }

function selectGateGenerator(config: LlmConfig): GateGeneratorSelection
```

When `kind: 'disabled'`, the App does not construct or call a gate generator and leaves the
provider gate status absent (equivalent to `'not-attempted'`). No `FakeGateGenerator` class is
needed.

### `buildGeneratedGateAttachment`

```ts
// app/generatedGate.ts
type GateAttachmentResult =
  | { status: 'accepted'; gate: GeneratedMechanicalGate }
  | { status: 'rejected' }

async function buildGeneratedGateAttachment(
  room: LoadedRoom,
  generator: GateGenerator,
): Promise<GateAttachmentResult>
```

The outer try/catch catches every error (network, timeout, assembler drop, unexpected throw) and
returns `{ status: 'rejected' }`. The `'not-attempted'` value is never returned by this function —
it is represented by the App when the selector is disabled or usage guard skips the provider call.

### Runtime precedence in `evaluateGeneratedExitGate`

```ts
// Updated signature (app/generatedExitGate.ts)
export function evaluateGeneratedExitGate(input: {
  room: LoadedRoom
  toRoomId: string
  state: Pick<WorldState, 'roomStates'> | null | undefined
  providerGateStatus?: ProviderGateStatus
  providerGate?: GeneratedMechanicalGate
}): GeneratedExitGateResult
```

Implementation pseudocode:

```ts
if (input.providerGateStatus === 'rejected') return { gated: false }

if (input.providerGateStatus === 'accepted' && input.providerGate != null) {
  if (!isGeneratedGateSatisfiable(input.providerGate, input.room)) return { gated: false }
  if (input.providerGate.effect.toRoomId !== input.toRoomId) return { gated: false }
  return evaluateGeneratedGate(input.providerGate, input.state as WorldState) === 'locked'
    ? { gated: true }
    : { gated: false }
}

// 'not-attempted' or absent — ADR-0063 deterministic path
const gate = buildGeneratedMechanicalGate(input.room)
if (gate === null) return { gated: false }
if (gate.effect.toRoomId !== input.toRoomId) return { gated: false }
return evaluateGeneratedGate(gate, input.state as WorldState) === 'locked'
  ? { gated: true }
  : { gated: false }
```

The existing ADR-0063 deterministic path is the unchanged else-branch. Callers that pass no
`providerGateStatus` behave identically to today.

### App wiring

In `App.tsx`, in the first-room generated path (after `provenance === 'generated'` check, behind
`canAttemptOptional`):

```ts
const gateSelection = selectGateGenerator(llmConfig)

let providerGateStatus: ProviderGateStatus | undefined
let providerGate: GeneratedMechanicalGate | undefined

if (gateSelection.kind === 'real') {
  const attachment = await buildGeneratedGateAttachment(room, gateSelection.generator)
  if (attachment.status === 'accepted') {
    providerGateStatus = 'accepted'
    providerGate = attachment.gate
  } else {
    providerGateStatus = 'rejected'
  }
}

// ... set activePlay:
const activePlay: ActivePlay = {
  // ... existing fields ...
  providerGateStatus,
  providerGate,
}
```

In `handleNavigate`, pass `providerGateStatus` and `providerGate` from `activePlay` to
`evaluateGeneratedExitGate` (via `navigateWithExitGate` params or directly).

---

## Architectural rules (binding)

1. **Provider proposes data only.** The provider returns only `{ unlockObjectId, exitToRoomId }`.
   The app derives all other gate fields. The provider never returns a full `GeneratedMechanicalGate`
   or any executable structure.
2. **Contract frozen.** `domain/generatedMechanicalGate.ts` is not modified. `assembleGate` uses
   only the public exports: `validateGeneratedMechanicalGate`, `isGeneratedGateSatisfiable`.
3. **Three-path rule is the single source of truth.** `'rejected'` and `'accepted'-but-unsatisfiable`
   both fail open immediately; deterministic (`buildGeneratedMechanicalGate`) runs only when status
   is `'not-attempted'` or absent. This is non-negotiable.
4. **No persistence.** `providerGate` and `providerGateStatus` are never serialized, never in
   `SaveGame`, never in the generated-room cache blob. After save/load restore, absent status →
   `'not-attempted'` → deterministic path.
5. **No schema change.** `RoomSpec`, `WorldState`, `WorldEvent`, `SaveGame`, `QuestSpec`
   `schemaVersion` all remain `1`. `ProviderGateStatus` and `GateAttachmentResult` are
   TypeScript-only types on `ActivePlay`; not serialized.
6. **No raw identifier leakage.** No log, UI string, or error message may contain: gate id, room
   id, object id, flag key, `toRoomId`, raw gate JSON, raw LLM response body, prompt content, or
   any generated description. Selection logs contain only safe provider/model metadata or a fixed
   disabled reason. Provider gate outcomes are not runtime-logged by default.
7. **No fake GateGenerator.** `selectGateGenerator` returns a discriminated union. When disabled,
   the App makes no fake class or fake call; absent status is treated as `'not-attempted'`.
8. **`canAttemptOptional` guard.** The gate provider call must be behind the existing usage guard.
   No provider call is made when `canAttemptOptional` returns false.
9. **First-room only (v0).** Adjacent rooms do not call the gate provider. When the player
   navigates to a new room, the new `ActivePlay` has no `providerGateStatus` → absent → deterministic.
10. **No renderer, backend, or save-schema change.** `renderer/**`, `server/**`, `persistence/**`,
    `domain/world/saveGame.ts`, all schema files are untouched.

---

## Scope (v0)

**In scope (this feature):**

- Slice 1 — this ADR + the implementation plan.
- Slice 2 — `domain/ports/GateGenerator.ts` (port interface) +
  `domain/generatedMechanicalGateProposal.ts` (`GeneratedGateProposalSchema`, `assembleGate`,
  private `flagForProposedObject`) + co-located unit tests.
- Slice 3 — `generation/llmGatePrompt.ts` (pure prompt builder) +
  `generation/OpenAICompatibleGateGenerator.ts` (transport, timeout, error codes) +
  co-located unit tests.
- Slice 4 — `app/selectGateGenerator.ts` (discriminated selection) +
  `app/generatedGate.ts` (`buildGeneratedGateAttachment`) +
  update `app/generatedExitGate.ts` (add provider-gate paths) + co-located unit tests.
- Slice 5 — update `App.tsx` (provider call + `ActivePlay` fields) +
  update `app/gatedNavigation.ts` or `navigateWithExitGate` to thread `providerGateStatus` /
  `providerGate` + integration tests.
- Slice 6 — save/load regression + leakage tests + `ARCHITECTURE.md` + `FAILURE-MODES.md` closeout.

**Out of scope / non-goals (must NOT be built in this feature):**

- ❌ `RoomSpec` / `WorldState` / `WorldEvent` / `SaveGame` / `QuestSpec` schema change.
- ❌ Persisting `providerGate` or `providerGateStatus` in any save blob or cache.
- ❌ Adjacent-room gate provider calls.
- ❌ A `FakeGateGenerator` class.
- ❌ Renderer / HUD / Three.js changes.
- ❌ Backend / server / SQLite changes.
- ❌ Cost-meter / usage changes beyond the existing `canAttemptOptional` guard.
- ❌ Multi-exit, multi-step, or sequenced gates.
- ❌ Additional gate kinds, condition kinds, or dynamic predicates.
- ❌ Exporting `flagWrittenByObject` from `domain/generatedMechanicalGate.ts`.
- ❌ Modifying the frozen `GeneratedMechanicalGate` contract functions.

---

## Data model

No new schema field. New TypeScript-only additions:

```ts
// domain/ports/GateGenerator.ts — new port interface
export interface GateGenerator {
  generate(room: LoadedRoom): Promise<string | null>
}

// domain/generatedMechanicalGateProposal.ts — new module
export const GeneratedGateProposalSchema: z.ZodObject<...>
export function assembleGate(
  rawText: string,
  room: LoadedRoom,
): { gate: GeneratedMechanicalGate } | null

// generation/OpenAICompatibleGateGenerator.ts — new provider
export const GATE_MAX_TOKENS = 200
export const GATE_TIMEOUT_MS = 10_000
export const GATE_LLM_REQUEST_FAILED = 'gate-llm-request-failed'
export const GATE_LLM_TIMEOUT       = 'gate-llm-timeout'
export const GATE_LLM_EMPTY_RESPONSE = 'gate-llm-empty-response'
export class OpenAICompatibleGateGenerator implements GateGenerator { ... }

// app/selectGateGenerator.ts — new selector
export type GateGeneratorSelection =
  | { kind: 'real'; generator: GateGenerator; log: RealGateSelectionLog }
  | { kind: 'disabled'; reason: 'config-disabled'; log: DisabledGateSelectionLog }
export function selectGateGenerator(config: LlmConfig): GateGeneratorSelection

// app/generatedGate.ts — new attachment builder
export type GateAttachmentResult =
  | { status: 'accepted'; gate: GeneratedMechanicalGate }
  | { status: 'rejected' }
export async function buildGeneratedGateAttachment(
  room: LoadedRoom,
  generator: GateGenerator,
): Promise<GateAttachmentResult>

// app/generatedExitGate.ts — extend signature (Slice 4)
// adds optional providerGateStatus? and providerGate? params
// existing callers passing neither behave identically to ADR-0063

// ActivePlay (App.tsx or its type definition) — transient additions
// providerGateStatus?: 'not-attempted' | 'accepted' | 'rejected'
// providerGate?: GeneratedMechanicalGate
```

---

## Files likely to change

- **New (Slice 1):** this ADR;
  `docs/architecture/implementation-plans/generated-mechanical-gate-provider-v0.md`.
- **New (Slice 2):** `apps/web/src/domain/ports/GateGenerator.ts`;
  `apps/web/src/domain/generatedMechanicalGateProposal.ts`;
  `apps/web/src/domain/generatedMechanicalGateProposal.test.ts`.
- **New (Slice 3):** `apps/web/src/generation/llmGatePrompt.ts`;
  `apps/web/src/generation/OpenAICompatibleGateGenerator.ts`;
  `apps/web/src/generation/OpenAICompatibleGateGenerator.test.ts`.
- **New (Slice 4):** `apps/web/src/app/selectGateGenerator.ts`;
  `apps/web/src/app/selectGateGenerator.test.ts`;
  `apps/web/src/app/generatedGate.ts`;
  `apps/web/src/app/generatedGate.test.ts`.
- **Edited (Slice 4):** `apps/web/src/app/generatedExitGate.ts` (+`.test.ts` extended).
- **Edited (Slice 5):** `apps/web/src/App.tsx`;
  `apps/web/src/app/gatedNavigation.ts` (thread `providerGateStatus` / `providerGate`);
  `apps/web/src/App.test.tsx` (integration + regression tests).
- **Edited (Slice 6, docs):** `docs/architecture/ARCHITECTURE.md`;
  `docs/architecture/FAILURE-MODES.md`.

## Files NOT to change

`domain/generatedMechanicalGate.ts` (frozen contract) · `domain/assembleRoom.ts` ·
`domain/roomSpec.ts` · `domain/world/worldState.ts` · `domain/world/events.ts` ·
`domain/world/saveGame.ts` · `domain/quests/questSpec.ts` (schema) ·
`domain/quests/evaluateQuest.ts` · `domain/interactions/planInteraction.ts` (read-only import) ·
`app/exitGate.ts` (authored demo gate — must not change) ·
`app/exits.ts` (gate-locked message unchanged from ADR-0063) ·
`app/NavigationService.ts` (reason union unchanged from ADR-0063) ·
`renderer/**` · `persistence/**` · `server/**` · `encounters/**` · `dialogue/**` ·
`memory/**` · `interactions/**` · the generated-room cache save/load path ·
`eslint.config.js` · `package.json`.

---

## Tests

### Slice 2 — `assembleGate` (pure, co-located)

- Valid `rawText`, object found, flag-writing interaction, exit exists -> returns `{ gate }`.
- `rawText` is not valid JSON -> returns `null`.
- Parsed JSON fails schema (missing field, extra field, id starts with `interaction:`) -> `null`.
- `unlockObjectId` not found in `room.objects` -> `null`.
- Object found but has no flag-writing interaction (encounter / use-item / no-effect) -> `null`.
- `exitToRoomId` not found on an in-room interaction exit -> `null`.
- Assembled gate fails `validateGeneratedMechanicalGate` -> `null`.
- Assembled gate fails `isGeneratedGateSatisfiable` -> `null`.
- All drops resolve to `null` - caller cannot distinguish reason (by design).
- `flagForProposedObject` produces same flag key as `interactionFlagKey(object.flag, object.id)`.

### Slice 3 — `OpenAICompatibleGateGenerator` (transport-injected)

- Injected transport returns valid JSON response → `generate` returns raw content string.
- Transport throws (network error) → throws `Error('gate-llm-request-failed')`.
- Timer fires before transport resolves → throws `Error('gate-llm-timeout')`; `AbortController`
  aborted.
- Response `!ok` → throws `Error('gate-llm-request-failed')`.
- Response body malformed (not JSON) → throws `Error('gate-llm-request-failed')`.
- `choices[0].message.content === ''` → returns `null`.
- `choices[0].message.content` is not a string → throws `Error('gate-llm-empty-response')`.
- No retry: a single transport call is made per `generate` invocation.

### Slice 4 — `selectGateGenerator`, `buildGeneratedGateAttachment`, extended evaluator

**`selectGateGenerator`:**
- `isRealProviderComplete(config)` true → `{ kind: 'real', generator: OpenAICompatibleGateGenerator }`.
- Config incomplete → `{ kind: 'disabled', reason: 'config-disabled', log: { provider: 'disabled', reason: 'config-disabled' } }`.

**`buildGeneratedGateAttachment`:**
- `generator.generate` returns valid text → `assembleGate` succeeds → `{ status: 'accepted', gate }`.
- `generator.generate` returns valid text → `assembleGate` returns `null` → `{ status: 'rejected' }`.
- `generator.generate` returns `null` → `{ status: 'rejected' }`.
- `generator.generate` throws → caught by outer try/catch → `{ status: 'rejected' }`.
- Never throws; always returns one of the two result variants.

**`evaluateGeneratedExitGate` (extended):**
- `providerGateStatus: 'rejected'` → `{ gated: false }` regardless of gate/state/exit.
- `providerGateStatus: 'accepted'`, `isGeneratedGateSatisfiable` fails → `{ gated: false }`.
- `providerGateStatus: 'accepted'`, satisfiable, wrong `toRoomId` → `{ gated: false }`.
- `providerGateStatus: 'accepted'`, satisfiable, correct exit, flag absent → `{ gated: true }`.
- `providerGateStatus: 'accepted'`, satisfiable, correct exit, flag set → `{ gated: false }`.
- `providerGateStatus: 'not-attempted'` → ADR-0063 deterministic path (existing tests pass).
- `providerGateStatus` absent → ADR-0063 deterministic path (existing tests pass).
- `providerGate` is `undefined` with `status: 'accepted'` → treated as no gate → `{ gated: false }`.

### Slice 5 — App integration + provider call flow

- `canAttemptOptional` false -> provider not called; provider status absent or `'not-attempted'`.
- `gateSelection.kind: 'disabled'` -> provider not called; provider status absent or `'not-attempted'`.
- `gateSelection.kind: 'real'`, attachment `'accepted'` -> `activePlay.providerGateStatus = 'accepted'`.
- `gateSelection.kind: 'real'`, attachment `'rejected'` -> `activePlay.providerGateStatus = 'rejected'`.
- Navigate with `providerGateStatus: 'rejected'` → fail open (gate not enforced).
- Navigate with `providerGateStatus: 'accepted'`, locked flag → `reason: 'gate-locked'`.
- Navigate with `providerGateStatus: 'accepted'`, flag set → navigate succeeds.
- `objectivesPerRoom: false` → `generatedGateEnabled: false` → no gate check; no provider call.
- ADR-0063 authored-demo-gate regression: `reason: 'blocked'` unchanged; `exitGate.ts` untouched.

### Slice 6 — Save/load regression + leakage

- Save with `providerGateStatus: 'accepted'` → `SaveGame` blob contains no `providerGateStatus`
  or `providerGate` field; `schemaVersion` unchanged.
- Restore → `providerGateStatus` absent → deterministic path; gate re-derives from restored room.
- Restored room, flag absent in `WorldState` → gate locked.
- Restored room, flag present in `WorldState` → gate open.
- No log context in the provider/gate path contains: gate id, room id, object id, flag key,
  `toRoomId`, raw LLM response body, prompt content, or generated description.
- No new provider call introduced in the gate-enforcement branch of `evaluateGeneratedExitGate`.

---

## Failure modes

| Situation | Detection | Handling | Logging |
|---|---|---|---|
| Provider disabled / config incomplete | `gateSelection.kind === 'disabled'` | no provider call; status absent/`'not-attempted'`; deterministic path (ADR-0063) | disabled selector log only (no identifiers) |
| `canAttemptOptional` false | usage guard check | skip provider call; status absent/`'not-attempted'` | none |
| Provider transport throws / network error | caught in `buildGeneratedGateAttachment` | `{ status: 'rejected' }` -> `providerGateStatus = 'rejected'` | none by default; provider error code is sanitized if observed by tests |
| Provider timeout | `AbortController` fires; caught | `{ status: 'rejected' }` -> `providerGateStatus = 'rejected'` | none by default; provider error code is sanitized if observed by tests |
| Provider returns empty/malformed response | `extractContent` returns non-string or empty | `{ status: 'rejected' }` -> `providerGateStatus = 'rejected'` | none by default; provider error code is sanitized if observed by tests |
| LLM returns invalid JSON | `JSON.parse` throws in `assembleGate` | `null` → `{ status: 'rejected' }` → `providerGateStatus = 'rejected'` | none |
| LLM returns schema-invalid proposal | `GeneratedGateProposalSchema.safeParse` fails | `null` → `{ status: 'rejected' }` | none |
| `unlockObjectId` not found / not a flag-writer | object lookup / `flagForProposedObject` | `null` → `{ status: 'rejected' }` | none |
| `exitToRoomId` not found on an in-room interaction exit | exit lookup | `null` → `{ status: 'rejected' }` | none |
| Gate fails contract validation | `validateGeneratedMechanicalGate` / `isGeneratedGateSatisfiable` | `null` → `{ status: 'rejected' }` | none |
| `providerGateStatus: 'rejected'` at nav time | path check in evaluator | `{ gated: false }` — fail open immediately | none |
| `providerGateStatus: 'accepted'`, gate no longer satisfiable for room | `isGeneratedGateSatisfiable` re-check at nav time | `{ gated: false }` — fail open; deterministic NOT invoked | none |
| `providerGateStatus: 'accepted'`, gate satisfiable, flag absent | `evaluateGeneratedGate === 'locked'` | `{ gated: true }` → `reason: 'gate-locked'` | none |
| Save/load restore | `providerGateStatus` absent after restore | treated as `'not-attempted'` → deterministic path | none |
| `getWorldState` fails at nav time | existing ADR-0063 fail-open path | `state: null` → evaluator → `{ gated: false }` | existing warn at seam only |

---

## Consequences

- Generated rooms in generated play may have a contextually-chosen gate (LLM-proposed unlock object
  and exit) instead of the deterministic first-found selection — without changing any contract,
  schema, or persistence path.
- When the provider is disabled or fails, ADR-0063 deterministic behavior is unchanged.
- When the provider is rejected, the exit is unconditionally open — the player is never stranded
  by a provider failure.
- Save/load correctness is free for the `'not-attempted'`/restore path: the gate re-derives from
  the restored room. Restored sessions with a previously-accepted provider gate fall back to
  deterministic; the gate may govern a different object or exit, but both are satisfiable by
  contract, so no deadlock occurs.
- The frozen `GeneratedMechanicalGate` contract (ADR-0061) and the deterministic runtime
  (ADR-0063) are extended, not replaced. Future work (multi-exit gates, renderer lock signals,
  adjacent-room provider calls) remains a series of small, independently approvable slices.

## Alternatives considered

- **Reuse the deterministic builder path for provider fallback** — rejected: the maintainer
  explicitly required that `'rejected'` status fails open without deterministic fallback. Silent
  fallback would mask provider problems and make enforcement behavior unpredictable.
- **Return a `FakeGateGenerator` for the disabled path** — rejected: the maintainer prefers a
  discriminated `{ kind: 'disabled' }` union. No fake class avoids dead code, avoids a fake LLM
  call, and makes the disabled path explicit.
- **Export `flagWrittenByObject` from the frozen contract module** — rejected: the contract module
  is frozen; exporting a private implementation detail would break the abstraction. The assembler
  re-implements `flagForProposedObject` with identical logic, importing only `interactionFlagKey`.
- **Provider returns a full `GeneratedMechanicalGate` JSON** — rejected: would allow the LLM to
  propose arbitrary gate ids, condition kinds, and effect kinds, bypassing the derivation and
  validation layer. Structural-only proposal keeps the trust boundary narrow.
- **Call the gate provider for adjacent rooms** — deferred: first-room-only in v0 keeps the cost
  and complexity surface small; adjacent-room provider calls can be approved separately.
- **Persist `providerGate` in `SaveGame`** — rejected: the gate is re-derivable (deterministic
  path) or re-callable (if the provider is re-enabled); a persisted field would be a second source
  of truth and a schema-version bump for no player-visible benefit.
