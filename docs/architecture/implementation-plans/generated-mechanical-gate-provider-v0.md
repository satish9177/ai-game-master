# Implementation Plan — `feature/generated-mechanical-gate-provider-v0`

> Status: **Implemented.**
> Maintainer approved the design direction on 2026-07-01.
>
> **Depends on (implemented and merged):**
> - Generated Mechanical Gate Contract v0
>   ([ADR-0061](../decisions/ADR-0061-generated-mechanical-gate-contract-v0.md)) —
>   `validateGeneratedMechanicalGate`, `isGeneratedGateSatisfiable`, `evaluateGeneratedGate`,
>   `buildGeneratedMechanicalGate` (frozen; not modified by this plan).
> - Generated Mechanical Gate Runtime v0
>   ([ADR-0063](../decisions/ADR-0063-generated-mechanical-gate-runtime-v0.md)) —
>   `evaluateGeneratedExitGate`, `navigateWithExitGate` seam, `reason: 'gate-locked'` — the
>   ADR-0063 deterministic path is the `'not-attempted'` branch of this plan.
> - Real Generated Objective Provider v0
>   ([ADR-0049](../decisions/ADR-0049-real-generated-objective-provider-v0.md)) —
>   `OpenAICompatibleObjectiveGenerator`, `selectObjectiveGenerator`,
>   `buildGeneratedObjectiveAttachment`, `assembleObjective` — the exact mirror pattern this plan
>   follows.
> - Cost/Usage Guardrails v0 — `canAttemptOptional` guard; the gate provider call must be behind it.
>
> Companion docs: [ARCHITECTURE](../ARCHITECTURE.md) · [BOUNDARIES](../BOUNDARIES.md) ·
> [FAILURE-MODES](../FAILURE-MODES.md) · [CONVENTIONS](../CONVENTIONS.md) ·
> [ADR-0064](../decisions/ADR-0064-generated-mechanical-gate-provider-v0.md).

---

## Goal

Allow the real LLM provider to propose which room object and exit form the mechanical gate, while
preserving every safety boundary from ADR-0061 and ADR-0063. The provider proposes only
`{ unlockObjectId, exitToRoomId }`. The app derives all other gate fields, validates through the
frozen contract, and checks satisfiability. Three explicit gate statuses control runtime behavior.

No schema change, no persistence change, no renderer change. The deterministic ADR-0063 path is
unchanged when the provider is disabled or not attempted.

---

## Three-path gate-state rule (authoritative — implement exactly this)

This table is the single source of truth for every gate verdict when `generatedGateEnabled` is true:

| `providerGateStatus` | Condition | Verdict |
|---|---|---|
| `'not-attempted'` or absent | — | deterministic `buildGeneratedMechanicalGate(room)` — ADR-0063 path, unchanged |
| `'rejected'` | — | **fail open** — `{ gated: false }`; deterministic must NOT run |
| `'accepted'` | `isGeneratedGateSatisfiable(providerGate, room)` fails | **fail open** — `{ gated: false }`; deterministic must NOT run |
| `'accepted'` | satisfiable; `gate.effect.toRoomId !== toRoomId` | **open** — not the governed exit |
| `'accepted'` | satisfiable; correct exit; flag absent or `false` | **locked** — `reason: 'gate-locked'` |
| `'accepted'` | satisfiable; correct exit; flag `=== true` | **open** — unlocked; navigate normally |

**Non-negotiable rules:**
- `'rejected'` fails open immediately. Deterministic does NOT run.
- `'accepted'`-but-unsatisfiable fails open immediately. Deterministic does NOT run.
- Deterministic only runs when status is `'not-attempted'` or absent.
- `getWorldState` failure → `state: null` → existing ADR-0063 fail-open (unchanged).

---

## Minimum Safe Change Check

**Existing code reused:**

- `buildGeneratedMechanicalGate(room)` + `validateGeneratedMechanicalGate` +
  `isGeneratedGateSatisfiable` + `evaluateGeneratedGate` — all called directly; no change.
- `interactionFlagKey` from `domain/interactions/planInteraction.ts` — imported by `assembleGate`
  to derive `condition.flag`; no change to that module.
- `OpenAICompatibleObjectiveGenerator` — the exact pattern for `OpenAICompatibleGateGenerator`;
  `LlmTransport` / `LlmTransportInit` / `LlmTransportResponse` types re-exported from it.
- `selectObjectiveGenerator` — the exact pattern for `selectGateGenerator` (discriminated union
  instead of fake class).
- `buildGeneratedObjectiveAttachment` — the exact pattern for `buildGeneratedGateAttachment`.
- `assembleObjective` — the exact pattern for `assembleGate`; `GeneratedObjectiveSpecSchema`
  shows the correct refine-based id validation.
- `evaluateGeneratedExitGate` (ADR-0063) — extended with two optional params; existing callers
  with no `providerGateStatus` behave byte-identically.
- `navigateWithExitGate` — already threads `currentRoom` and `generatedGateEnabled`; add two more
  optional params or thread via the existing `input` type.
- `activePlay.objectivesPerRoom` — existing boolean; scope guard unchanged.
- `canAttemptOptional` — already in use for objective provider; reused unchanged.

**New code actually necessary:**

- `domain/ports/GateGenerator.ts` — one interface, ~5 lines.
- `domain/generatedMechanicalGateProposal.ts` — schema, `assembleGate`, private
  `flagForProposedObject`; ~80 lines.
- `generation/llmGatePrompt.ts` — pure prompt builder returning `messages`; ~40 lines.
- `generation/OpenAICompatibleGateGenerator.ts` — transport + timeout + error codes; ~100 lines
  (mirrors `OpenAICompatibleObjectiveGenerator` exactly; only prompt and constants differ).
- `app/selectGateGenerator.ts` — discriminated selector; ~40 lines.
- `app/generatedGate.ts` — `buildGeneratedGateAttachment`; ~30 lines.
- `app/generatedExitGate.ts` — extend with ~15 lines of provider-path logic; existing code
  unchanged below.
- `App.tsx` — ~15 lines in first-room generated path; ~4 lines in `handleNavigate`.

**Safety boundaries unchanged:**

- `RoomSpec` / `WorldState` / `WorldEvent` / `SaveGame` / `QuestSpec` schemas — `schemaVersion`
  stays `1`; no new field, no new event type.
- Frozen contract (`domain/generatedMechanicalGate.ts`) — not touched.
- Authored demo gate (`app/exitGate.ts`, `reason: 'blocked'`, Malik message) — byte-identical.
- `app/exits.ts` / `app/NavigationService.ts` — not touched (gate-locked reason from ADR-0063).
- Renderer / Three.js — not touched.
- `persistence/**` / `server/**` — not touched.
- Logging — only boolean/enum values; no gate id, object id, flag key, room id, raw LLM body,
  prompt content, or generated description in any log, UI string, or error message.

**Targeted tests per slice:**

- Slice 2: `npm run test -- generatedMechanicalGateProposal`
- Slice 3: `npm run test -- OpenAICompatibleGateGenerator`
- Slice 4: `npm run test -- selectGateGenerator`, `npm run test -- generatedGate`,
  `npm run test -- generatedExitGate`
- Slice 5: `npm run test -- App`
- Slice 6: `npm run test`, `npm run lint`, `npm run build`

---

## Architecture & boundary fit

- **Layer:** `domain/generatedMechanicalGateProposal.ts` is domain-layer (pure, no I/O).
  `generation/OpenAICompatibleGateGenerator.ts` is generation-layer (I/O, transport). `app/**`
  files are app-layer. Boundary rules from `BOUNDARIES.md` are respected throughout.
- **Domain→domain import:** `assembleGate` importing `interactionFlagKey` from
  `domain/interactions/planInteraction.ts` is a domain→domain import; allowed by boundary rules.
- **Trust boundary:** The LLM returns only `{ unlockObjectId, exitToRoomId }`. Every other field
  is derived and validated by the app before any gate is accepted. The frozen contract is the
  gatekeeper.
- **Scope guard:** `generatedGateEnabled = activePlay.objectivesPerRoom === true`. Authored play
  and adjacent-pregeneration rooms are never in scope. The provider call is additionally guarded
  by `canAttemptOptional`.
- **Fail-open everywhere:** Provider error → `'rejected'`; unsatisfiable accepted gate → fail
  open; `getWorldState` failure → fail open (ADR-0063). No player can be permanently stranded.

---

## Slices

### Slice 1 — Docs-only (this slice)

ADR-0064 + this plan. No code change.

Verification: `npm run lint` (docs-only; confirm no lint error on changed files).

---

### Slice 2 — Domain port + assembler

**File: `apps/web/src/domain/ports/GateGenerator.ts` (new)**

```ts
import type { LoadedRoom } from '../loadRoomSpec'

export interface GateGenerator {
  generate(room: LoadedRoom): Promise<string | null>
}
```

**File: `apps/web/src/domain/generatedMechanicalGateProposal.ts` (new)**

```ts
import { z } from 'zod'
import { interactionFlagKey } from './interactions/planInteraction'
import { validateGeneratedMechanicalGate, isGeneratedGateSatisfiable } from './generatedMechanicalGate'
import type { LoadedRoom, RoomObject } from './loadRoomSpec'
import type { GeneratedMechanicalGate } from './generatedMechanicalGate'

export const GeneratedGateProposalSchema = z
  .object({
    unlockObjectId: z
      .string()
      .trim()
      .min(1)
      .refine((v) => !/^(?:interaction|encounter):/.test(v), {
        message: 'unlockObjectId must be a room object id, not a derived flag key',
      }),
    exitToRoomId: z.string().trim().min(1),
  })
  .strict()

// Mirrors the private flagWrittenByObject in domain/generatedMechanicalGate.ts.
// Must not import from that module — the function is private and the contract is frozen.
// Imports only interactionFlagKey from domain/interactions/planInteraction.ts.
function flagForProposedObject(object: RoomObject): string | undefined {
  if (!('interaction' in object)) return undefined
  if (object.interaction?.encounter !== undefined) return undefined

  const effect = object.interaction?.effect
  if (effect?.kind === 'inspect') return interactionFlagKey(effect.flag, object.id)
  if (effect?.kind === 'take-item') return interactionFlagKey(undefined, object.id)
  return undefined
}

export function assembleGate(
  rawText: string,
  room: LoadedRoom,
): { gate: GeneratedMechanicalGate } | null {
  let parsed: unknown
  try {
    parsed = JSON.parse(rawText)
  } catch {
    return null // parse-failed
  }

  const result = GeneratedGateProposalSchema.safeParse(parsed)
  if (!result.success) return null // schema-invalid

  const { unlockObjectId, exitToRoomId } = result.data

  const unlockObject = room.objects.find((o) => o.id === unlockObjectId)
  if (unlockObject == null) return null // unlock-unsatisfiable

  const flag = flagForProposedObject(unlockObject)
  if (flag == null) return null // unlock-unsatisfiable

  const exitExists = room.objects.some((object) => 'interaction' in object && object.interaction?.exit?.toRoomId === exitToRoomId)
  if (!exitExists) return null // exit-unsatisfiable

  const raw = {
    id: `${room.id}:mechanical-gate`,
    condition: { kind: 'room-flag' as const, flag, roomId: room.id },
    effect: { kind: 'unlock-exit' as const, toRoomId: exitToRoomId },
  }

  const gate = validateGeneratedMechanicalGate(raw)
  if (gate == null) return null // gate-invalid

  if (!isGeneratedGateSatisfiable(gate, room)) return null // gate-invalid

  return { gate }
}
```

**File: `apps/web/src/domain/generatedMechanicalGateProposal.test.ts` (new)**

Tests per the test plan in ADR-0064 Slice 2 section.

Verification: `npm run test -- generatedMechanicalGateProposal`, `npm run lint`.

---

### Slice 3 — Provider (prompt + generator)

**File: `apps/web/src/generation/llmGatePrompt.ts` (new)**

Pure function returning the `messages` array for the chat completion call. The user message is a
bounded structural digest only: eligible flag-writing candidates as `{ objectId, type }` and exits
as `{ exitToRoomId }`. It must NOT include raw room JSON, room names/descriptions, object
names/labels/descriptions, interaction text, prompt/user text, generated narrative text, flags, or
full gate JSON.

```ts
import type { LoadedRoom } from '../domain/loadRoomSpec'

export function buildGatePromptMessages(room: LoadedRoom): Array<{
  role: 'system' | 'user'
  content: string
}> {
  // Returns system + user message instructing the LLM to respond with ONLY valid JSON
  // matching { unlockObjectId: string, exitToRoomId: string }.
  // Lists eligible { objectId, type } candidates and { exitToRoomId } exits from the room.
  // Does NOT log or expose these values; they are only in the prompt body (never logged).
  ...
}
```

**File: `apps/web/src/generation/OpenAICompatibleGateGenerator.ts` (new)**

Mirrors `OpenAICompatibleObjectiveGenerator` exactly. Only constants and prompt call differ:

```ts
import type { LoadedRoom } from '../domain/loadRoomSpec'
import type { GateGenerator } from '../domain/ports/GateGenerator'
import type {
  LlmTransport,
  LlmTransportInit,
  LlmTransportResponse,
  OpenAICompatibleConfig,
} from './OpenAICompatibleRoomGenerator'
import { buildGatePromptMessages } from './llmGatePrompt'

export type { LlmTransport, LlmTransportInit, LlmTransportResponse }

export type OpenAICompatibleGateConfig = Pick<OpenAICompatibleConfig, 'baseUrl' | 'apiKey' | 'model'>

export const GATE_MAX_TOKENS = 200
export const GATE_TIMEOUT_MS = 10_000

export const GATE_LLM_REQUEST_FAILED  = 'gate-llm-request-failed'
export const GATE_LLM_TIMEOUT         = 'gate-llm-timeout'
export const GATE_LLM_EMPTY_RESPONSE  = 'gate-llm-empty-response'

export class OpenAICompatibleGateGenerator implements GateGenerator {
  private readonly config: OpenAICompatibleGateConfig
  private readonly transport: LlmTransport

  constructor(config: OpenAICompatibleGateConfig, transport: LlmTransport = defaultTransport) {
    this.config = config
    this.transport = transport
  }

  async generate(room: LoadedRoom): Promise<string | null> {
    const body = JSON.stringify({
      model: this.config.model,
      messages: buildGatePromptMessages(room),
      max_tokens: GATE_MAX_TOKENS,
      stream: false,
    })

    const controller = new AbortController()
    let timedOut = false
    const timer = setTimeout(() => {
      timedOut = true
      controller.abort()
    }, GATE_TIMEOUT_MS)

    let response: LlmTransportResponse
    try {
      response = await this.transport(`${this.config.baseUrl}/chat/completions`, {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
          Authorization: `Bearer ${this.config.apiKey}`,
        },
        body,
        signal: controller.signal,
      })
    } catch {
      throw new Error(timedOut ? GATE_LLM_TIMEOUT : GATE_LLM_REQUEST_FAILED)
    } finally {
      clearTimeout(timer)
    }

    if (!response.ok) throw new Error(GATE_LLM_REQUEST_FAILED)

    let payload: unknown
    try {
      payload = await response.json()
    } catch {
      throw new Error(GATE_LLM_REQUEST_FAILED)
    }

    const content = extractContent(payload)
    if (content === '') return null
    if (typeof content !== 'string') throw new Error(GATE_LLM_EMPTY_RESPONSE)
    return content
  }
}
```

`extractContent` and `defaultTransport` mirror the objective generator's private helpers exactly.

**File: `apps/web/src/generation/OpenAICompatibleGateGenerator.test.ts` (new)**

Tests per the test plan in ADR-0064 Slice 3 section. Use injected transport spy; no real network
call. Verify `AbortController` is aborted on timeout; verify no retry.

Verification: `npm run test -- OpenAICompatibleGateGenerator`, `npm run lint`.

---

### Slice 4 — App-layer selector, attachment builder, extended evaluator

**File: `apps/web/src/app/selectGateGenerator.ts` (new)**

```ts
import type { GateGenerator } from '../domain/ports/GateGenerator'
import { OpenAICompatibleGateGenerator } from '../generation/OpenAICompatibleGateGenerator'
import {
  REAL_PROVIDER_BASE_URLS,
  isRealProviderComplete,
  type LlmConfig,
  type RealLlmProvider,
} from './llmConfig'

export type RealGateSelectionLog   = { provider: RealLlmProvider; model: string }
export type DisabledGateSelectionLog = { provider: 'disabled'; reason: 'config-disabled' }

export type GateGeneratorSelection =
  | { kind: 'real'; generator: GateGenerator; log: RealGateSelectionLog }
  | { kind: 'disabled'; reason: 'config-disabled'; log: DisabledGateSelectionLog }

export function selectGateGenerator(config: LlmConfig): GateGeneratorSelection {
  if (isRealProviderComplete(config)) {
    return {
      kind: 'real',
      generator: new OpenAICompatibleGateGenerator({
        baseUrl: REAL_PROVIDER_BASE_URLS[config.provider],
        apiKey: config.apiKey,
        model: config.model,
      }),
      log: { provider: config.provider, model: config.model },
    }
  }
  return {
    kind: 'disabled',
    reason: 'config-disabled',
    log: { provider: 'disabled', reason: 'config-disabled' },
  }
}
```

**File: `apps/web/src/app/generatedGate.ts` (new)**

```ts
import type { LoadedRoom } from '../domain/loadRoomSpec'
import type { GeneratedMechanicalGate } from '../domain/generatedMechanicalGate'
import type { GateGenerator } from '../domain/ports/GateGenerator'
import { assembleGate } from '../domain/generatedMechanicalGateProposal'

export type GateAttachmentResult =
  | { status: 'accepted'; gate: GeneratedMechanicalGate }
  | { status: 'rejected' }

export async function buildGeneratedGateAttachment(
  room: LoadedRoom,
  generator: GateGenerator,
): Promise<GateAttachmentResult> {
  try {
    const raw = await generator.generate(room)
    if (raw == null) return { status: 'rejected' }
    const assembled = assembleGate(raw, room)
    if (assembled == null) return { status: 'rejected' }
    return { status: 'accepted', gate: assembled.gate }
  } catch {
    return { status: 'rejected' }
  }
}
```

**File: `apps/web/src/app/generatedExitGate.ts` (modify)**

Extend the input type and add provider-gate paths before the existing deterministic path:

```ts
import {
  buildGeneratedMechanicalGate,
  evaluateGeneratedGate,
  isGeneratedGateSatisfiable,
} from '../domain/generatedMechanicalGate'
import type { LoadedRoom } from '../domain/loadRoomSpec'
import type { WorldState } from '../domain/world/worldState'
import type { GeneratedMechanicalGate } from '../domain/generatedMechanicalGate'

export type ProviderGateStatus = 'not-attempted' | 'accepted' | 'rejected'
export type GeneratedExitGateResult = { gated: false } | { gated: true }

export function evaluateGeneratedExitGate(input: {
  room: LoadedRoom
  toRoomId: string
  state: Pick<WorldState, 'roomStates'> | null | undefined
  providerGateStatus?: ProviderGateStatus
  providerGate?: GeneratedMechanicalGate
}): GeneratedExitGateResult {
  const { room, toRoomId, state, providerGateStatus, providerGate } = input

  if (providerGateStatus === 'rejected') return { gated: false }

  if (providerGateStatus === 'accepted' && providerGate != null) {
    if (!isGeneratedGateSatisfiable(providerGate, room)) return { gated: false }
    if (providerGate.effect.toRoomId !== toRoomId) return { gated: false }
    return evaluateGeneratedGate(providerGate, state as WorldState) === 'locked'
      ? { gated: true }
      : { gated: false }
  }

  // 'not-attempted' or absent — ADR-0063 deterministic path (unchanged)
  const gate = buildGeneratedMechanicalGate(room)
  if (gate === null) return { gated: false }
  if (gate.effect.toRoomId !== toRoomId) return { gated: false }
  return evaluateGeneratedGate(gate, state as WorldState) === 'locked'
    ? { gated: true }
    : { gated: false }
}
```

**Test files (new/extended):**

- `app/selectGateGenerator.test.ts` — selector unit tests.
- `app/generatedGate.test.ts` — attachment builder unit tests; use generator spy.
- `app/generatedExitGate.test.ts` — extend existing tests with provider-path cases.

Verification: `npm run test -- selectGateGenerator`, `npm run test -- generatedGate`,
`npm run test -- generatedExitGate`, `npm run lint`.

---

### Slice 5 — App wiring + integration tests

**File: `apps/web/src/app/gatedNavigation.ts` (modify)**

Extend the input type to accept `providerGateStatus?: ProviderGateStatus` and
`providerGate?: GeneratedMechanicalGate`. Pass them through to `evaluateGeneratedExitGate`:

```ts
// In the generatedGateEnabled block:
if (generatedGateEnabled) {
  const gate = evaluateGeneratedExitGate({
    room: currentRoom,
    toRoomId,
    state: stateResult?.ok ? stateResult.state : null,
    providerGateStatus,
    providerGate,
  })
  if (gate.gated) return { status: 'rejected', reason: 'gate-locked' }
}
```

No other change to `gatedNavigation.ts`. The `'gate-locked'` reason and message are already
wired from ADR-0063.

**File: `apps/web/src/App.tsx` (modify)**

In the first-room generated path (after `provenance === 'generated'`, behind `canAttemptOptional`):

```ts
const gateSelection = selectGateGenerator(llmConfig)

let providerGateStatus: ProviderGateStatus | undefined
let providerGate: GeneratedMechanicalGate | undefined

if (gateSelection.kind === 'real') {
  const attachment = await buildGeneratedGateAttachment(room, gateSelection.generator)
  providerGateStatus = attachment.status === 'accepted' ? 'accepted' : 'rejected'
  providerGate = attachment.status === 'accepted' ? attachment.gate : undefined
}

const activePlay: ActivePlay = {
  // ... existing fields ...
  providerGateStatus,
  providerGate,
}
```

In `handleNavigate`, pass `providerGateStatus` and `providerGate` from `activePlay` to
`navigateWithExitGate`:

```ts
const result = await navigateWithExitGate({
  // ... existing params ...
  generatedGateEnabled: activePlay.objectivesPerRoom === true,
  currentRoom: activePlay.room,
  providerGateStatus: activePlay.providerGateStatus,
  providerGate: activePlay.providerGate,
})
```

**File: `apps/web/src/App.test.tsx` (add/modify tests)**

- `canAttemptOptional` false -> provider not called; provider status absent or `'not-attempted'`.
- `gateSelection.kind: 'disabled'` -> provider not called; provider status absent or `'not-attempted'`.
- Enabled, attachment `'accepted'` → `activePlay.providerGateStatus = 'accepted'`.
- Enabled, attachment `'rejected'` → `activePlay.providerGateStatus = 'rejected'`.
- `providerGateStatus: 'rejected'` → navigate governed exit → `{ gated: false }` (fail open).
- `providerGateStatus: 'accepted'`, flag absent → navigate governed exit → `reason: 'gate-locked'`.
- `providerGateStatus: 'accepted'`, flag set → navigate → `status: 'navigated'`.
- `objectivesPerRoom: false` → `generatedGateEnabled: false` → no gate check.
- ADR-0063 authored-demo-gate regression: `reason: 'blocked'` unchanged.

Verification: `npm run test -- App`, `npm run lint`, `npm run build`.

---

### Slice 6 — Save/load regression + leakage closeout

**Tests (add to appropriate test files):**

- Save a generated session with `providerGateStatus: 'accepted'` → inspect `SaveGame` blob →
  confirm no `providerGateStatus`, no `providerGate` field; `schemaVersion` unchanged.
- Restore → `activePlay.providerGateStatus` absent → `evaluateGeneratedExitGate` takes
  deterministic path; gate re-derives from restored room.
- Restored + flag absent in `WorldState` → gate locked.
- Restored + flag present in `WorldState` → gate open.
- Log-leakage check: structured log context from the entire gate provider path contains no gate id,
  room id, object id, flag key, `toRoomId`, raw LLM response body, prompt content, or generated
  description. Gate provider outcomes are not runtime-logged by default; selection logs contain only safe provider/model metadata or a fixed disabled reason.
- Confirm no new provider/cost call in the `evaluateGeneratedExitGate` code path (static import
  analysis or spy assertion).

**Docs:**

- `docs/architecture/ARCHITECTURE.md` — add status note for `feature/generated-mechanical-gate-provider-v0`.
- `docs/architecture/FAILURE-MODES.md` — add rows for provider timeout, provider rejection,
  accepted-but-unsatisfiable, and post-restore-deterministic cases.

Verification: `npm run test`, `npm run lint`, `npm run build`.

---

## Manual smoke checklist (Slice 5 / Slice 6)

1. Configure a real LLM provider (base URL + API key + model). Start the dev server.
2. Start a new generated-play session (`objectivesPerRoom: true`).
3. Confirm the selected gate provider log contains only safe provider/model metadata or a fixed disabled reason; provider gate outcomes are not logged by default.
4. If `'accepted'`: attempt to navigate the provider-chosen exit before interacting with the
   unlock object. Expect: `reason: 'gate-locked'`; UI shows the static sealed-exit message.
5. Interact with the provider-chosen unlock object (interact/take). Then navigate the exit.
   Expect: navigation succeeds.
6. If `'rejected'`: confirm the exit is open (fail open); deterministic gate may still apply via
   ADR-0063 path if the room has a valid gate.
7. Save the session. Refresh. Confirm the restored session uses the deterministic path (not the
   provider gate); gate re-derives from room; prior interaction flags are respected.
8. Disable the LLM provider config. Start a new session. Confirm deterministic ADR-0063 behavior applies;
   no gate provider call is made.
9. In an authored session (throne-room start): confirm Malik demo gate still blocks
   `ruined-safehouse` exit; `reason: 'blocked'`; generated-gate branch never fires.

---

## Test plan (all slices)

### Slice 2 — `assembleGate` (pure, co-located)

- Valid raw text, object found, flag-writing interaction (`inspect` or `take-item`), exit exists →
  returns `{ gate }` passing `validateGeneratedMechanicalGate` and `isGeneratedGateSatisfiable`.
- Raw text not valid JSON → `null`.
- Parsed JSON missing required field → `null`.
- Parsed JSON has extra field (not `.strict()`-safe) → `null`.
- `unlockObjectId` starts with `interaction:` → `null` (schema refine).
- `unlockObjectId` starts with `encounter:` → `null` (schema refine).
- `unlockObjectId` not found in `room.objects` → `null`.
- Object found, interaction effect is `encounter` → `flagForProposedObject` returns `undefined` → `null`.
- Object found, interaction effect is `use-item` → `flagForProposedObject` returns `undefined` → `null`.
- Object found, no interaction → `flagForProposedObject` returns `undefined` → `null`.
- `exitToRoomId` not found on an in-room interaction exit → `null`.
- Derived gate fails `validateGeneratedMechanicalGate` → `null`.
- Derived gate fails `isGeneratedGateSatisfiable` → `null`.
- `flagForProposedObject` with `inspect` effect returns `interactionFlagKey(effect.flag, object.id)`.
- `flagForProposedObject` with `take-item` effect returns `interactionFlagKey(effect.flag, object.id)`.

### Slice 3 — `OpenAICompatibleGateGenerator` (transport-injected)

- Transport returns valid response with string content → `generate` returns that string.
- Transport throws → `generate` throws `Error('gate-llm-request-failed')`.
- Timer fires before transport resolves → `generate` throws `Error('gate-llm-timeout')`;
  `controller.abort()` was called.
- Response `!ok` → throws `Error('gate-llm-request-failed')`.
- Response body not parseable JSON → throws `Error('gate-llm-request-failed')`.
- `content === ''` → returns `null`.
- `content` is a number (not a string) → throws `Error('gate-llm-empty-response')`.
- No retry: exactly one transport call per `generate` invocation.
- `GATE_MAX_TOKENS = 200` used in request body.

### Slice 4 — selector, attachment builder, extended evaluator

**`selectGateGenerator`:**
- `isRealProviderComplete` true → `{ kind: 'real', generator: OpenAICompatibleGateGenerator, log: { provider, model } }`.
- Config incomplete → `{ kind: 'disabled', reason: 'config-disabled', log: { provider: 'disabled', reason: 'config-disabled' } }`.

**`buildGeneratedGateAttachment`:**
- Generator returns valid text → `assembleGate` succeeds → `{ status: 'accepted', gate }`.
- Generator returns valid text → `assembleGate` returns `null` → `{ status: 'rejected' }`.
- Generator returns `null` → `{ status: 'rejected' }`.
- Generator throws → caught → `{ status: 'rejected' }`.
- Never throws itself.

**`evaluateGeneratedExitGate` (extended):**
- `providerGateStatus: 'rejected'` → `{ gated: false }` (regardless of gate, state, exit).
- `providerGateStatus: 'accepted'`, `providerGate: undefined` → `{ gated: false }`.
- `providerGateStatus: 'accepted'`, gate not satisfiable for room → `{ gated: false }`.
- `providerGateStatus: 'accepted'`, satisfiable, wrong exit → `{ gated: false }`.
- `providerGateStatus: 'accepted'`, satisfiable, correct exit, flag absent → `{ gated: true }`.
- `providerGateStatus: 'accepted'`, satisfiable, correct exit, flag `false` → `{ gated: true }`.
- `providerGateStatus: 'accepted'`, satisfiable, correct exit, flag `true` → `{ gated: false }`.
- `providerGateStatus: 'not-attempted'` → deterministic path; existing ADR-0063 test cases pass.
- `providerGateStatus` absent (undefined) → deterministic path; existing ADR-0063 test cases pass.

### Slice 5 — App integration + provider call flow

(Per ADR-0064 Slice 5 test plan section.)

- `canAttemptOptional` false -> provider not called; provider status absent or `'not-attempted'`.
- `gateSelection.kind: 'disabled'` -> provider not called; provider status absent or `'not-attempted'`.
- `gateSelection.kind: 'real'`, attachment `'accepted'` -> `activePlay.providerGateStatus = 'accepted'`.
- `gateSelection.kind: 'real'`, attachment `'rejected'` -> `activePlay.providerGateStatus = 'rejected'`.
- Navigate with `'rejected'` → fail open.
- Navigate with `'accepted'`, locked → `reason: 'gate-locked'`.
- Navigate with `'accepted'`, unlocked → `status: 'navigated'`.
- `objectivesPerRoom: false` → no gate check.
- Demo gate regression: `reason: 'blocked'` unchanged.

### Slice 6 — Save/load regression + leakage

(Per ADR-0064 Slice 6 test plan section.)

---

## Risks & non-goals

**Risks and mitigations:**

- **Provider-gate deadlock** — impossible: `'rejected'` and unsatisfiable accepted gates fail open;
  the governed exit is never permanently blocked by a provider failure. Confirmed by tests.
- **Post-restore gate mismatch** — known limitation: after save/load, the deterministic gate may
  govern a different object/exit than the provider gate did. Both are satisfiability-checked by
  contract, so no deadlock occurs and the player can always progress.
- **Stale `providerGate` after room navigation** — impossible: adjacent rooms have no
  `providerGateStatus` field on their new `ActivePlay`; absent → `'not-attempted'` → deterministic.
- **Log/UI leakage** — mitigated by the no-identifier logging rule and the static gate-locked
  message (from ADR-0063, unchanged). Verified by Slice 6 leakage tests.
- **`flagForProposedObject` diverging from `flagWrittenByObject`** — mitigated by unit tests that
  verify both produce the same key for the same inputs. If `interactionFlagKey` ever changes, both
  callers update together (same import).
- **Cost overrun** — mitigated by the existing `canAttemptOptional` guard; no new usage mechanism
  is introduced.
- **Breaking ADR-0063 authored-demo gate** — impossible: `exitGate.ts` and `app/exits.ts` are not
  touched; the `generatedGateEnabled` guard is still required.

**Non-goals for this feature:**

- Adjacent-room gate provider calls.
- A `FakeGateGenerator` class.
- Persisting `providerGate` or `providerGateStatus`.
- Renderer / HUD lock visuals.
- Schema changes to `RoomSpec`, `WorldState`, `SaveGame`, or `QuestSpec`.
- Backend / server / SQLite changes.
- Multi-exit, multi-step, or sequenced gates.
- Additional gate kinds, condition kinds, or dynamic predicates.
- Exporting private helpers from `domain/generatedMechanicalGate.ts`.
- Cost-meter / usage changes beyond the existing `canAttemptOptional` guard.

