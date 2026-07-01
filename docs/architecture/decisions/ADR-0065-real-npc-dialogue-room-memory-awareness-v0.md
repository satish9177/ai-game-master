# ADR-0065: Real NPC Dialogue + Room-Memory Awareness v0

- **Status:** Proposed
- **Date:** 2026-07-01
- **Deciders:** Project owner
- **Extends:**
  [ADR-0017](./ADR-0017-npc-dialogue-foundation-v0.md) (the `NPCDialogueProvider` port,
  read-only `NPCDialogueService` — this ADR adds the first real implementation of that
  port; the port and service contract are unchanged),
  [ADR-0025](./ADR-0025-living-world-room-memory-v0.md) (room memory as inert,
  non-authoritative context — this ADR is the first consumer of `context.memory` that
  produces LLM-visible text; no memory storage, firewall, or truth rule changes).
- **Related:**
  memory-room-recall-context-v0 (`app/recallRoomMemoryContext.ts`, `domain/memory/ranking.ts`
  — already-shipped recall/ranking pipeline this ADR consumes unchanged),
  memory-dialogue-awareness-v0 (`dialogue/FakeNPCDialogueProvider.ts`
  `MEMORY_AWARENESS_LINES` — the deterministic-fake precedent for hedged, kind-only
  memory framing that this ADR extends to real free text),
  [ADR-0023](./ADR-0023-real-room-generator-provider-v0.md) (the opt-in / dev-only / BYOK
  provider precedent — provider selection, `LlmConfig`, safe logging, dev-only caveat —
  mirrored here for dialogue),
  [ADR-0049](./ADR-0049-real-generated-objective-provider-v0.md) (the exact structural
  mirror: `OpenAICompatibleObjectiveGenerator` / `selectObjectiveGenerator` / pure prompt
  builder — this ADR applies the same pattern to the dialogue port).

> Full pre-code design in the implementation plan
> [`real-npc-dialogue-room-memory-awareness-v0`](../implementation-plans/real-npc-dialogue-room-memory-awareness-v0.md).

> v0 is **an opt-in real `NPCDialogueProvider` whose prompt includes recalled room memory as a
> bounded, hedged, clearly non-authoritative BACKGROUND section.** `FakeNPCDialogueProvider`
> remains the default; the real provider is selected only when the existing `LlmConfig` is
> complete (same gate as room/objective/gate generation). The provider returns display text
> only — `NPCDialogueService` has no `WorldSession` write path, so no dialogue output, real or
> fake, memory-aware or not, can ever mutate authoritative state.

---

## Context

Room memory recall into dialogue context already shipped in two slices:

1. **memory-room-recall-context-v0** — `app/recallRoomMemoryContext.ts` calls
   `RoomMemoryService.recall`, ranks results with `rankMemories`, and returns a bounded
   (`DEFAULT_ROOM_MEMORY_DIALOGUE_LIMIT = 5`) `RoomMemoryDialogueContext` of
   `{ text, kind? }` entries. `buildDialogueContext` (`domain/dialogue/buildDialogueContext.ts`)
   already attaches this as `NPCDialogueContext.memory`.
2. **memory-dialogue-awareness-v0** — `FakeNPCDialogueProvider` consumes
   `context.memory.entries` at the lowest priority tier, but only via `entry.kind` through the
   `MEMORY_AWARENESS_LINES` table (hand-written, finite lines keyed on the closed room-memory
   kind). It never reads `entry.text`.

**The premise "the real provider may receive memory but underuses it" does not hold: no real
`NPCDialogueProvider` implementation exists.** `App.tsx:129` constructs
`new FakeNPCDialogueProvider()` unconditionally — there is no `OpenAICompatible*` adapter for
dialogue, unlike room generation (ADR-0023), objective generation (ADR-0049), or gate proposals
(ADR-0064). This ADR introduces that adapter and, in the same slice, makes it the first
component to turn recalled `entry.text` into LLM-visible prompt content — safely, because the
architecture already guarantees the provider's output cannot become truth.

Two implementation facts make this safe to build as one slice:

1. **The read-only boundary already exists and does not change.** `NPCDialogueService.reply`
   (`dialogue/NPCDialogueService.ts`) only calls `session.getWorldState` and returns a
   `{ status: 'replied', turn }` display value. It has no `appendEvent`/`WorldCommand` path
   under any provider. A real, memory-aware provider is exactly as safe as the fake one at the
   architecture level — the risk surface is entirely in *what text the model outputs*, which is
   display data, not gameplay input.

2. **The exact mirror pattern already exists three times.** ADR-0023 (room), ADR-0049
   (objective), and ADR-0064 (gate) all establish: pure prompt builder in `generation/`, a
   `OpenAICompatible*Generator` with injected `LlmTransport`, `AbortController` timeout, fixed
   safe error codes, and a `select*Generator(config: LlmConfig)` selector returning
   `{ generator, log }` with the fake as the disabled-path default. This ADR applies the same
   shape to `NPCDialogueProvider`.

---

## Decision

### Provider port (unchanged)

`domain/ports/NPCDialogueProvider.ts` — `interface NPCDialogueProvider { reply(request:
NPCDialogueRequest): Promise<NPCDialogueResponse> }`. Not modified. The real provider
implements this exactly like the fake.

### Pure prompt builder — `generation/llmDialoguePrompt.ts`

```ts
export function buildDialoguePromptMessages(request: NPCDialogueRequest): ChatMessage[]
```

Static system message + one structured user digest, mirroring `buildObjectivePromptMessages`.
No I/O, no logger import, fully deterministic given `request`.

**System message (static, hand-written, fixed):**

- Role: reply as the one named NPC, in character, 1–3 sentences, dialogue text only.
- Hard bans: no executable code, renderer/Three.js/React/SQL/world-event instructions, no
  markdown/code fences, no JSON.
- **Authority rule (explicit, load-bearing):** "CURRENT facts (room, quest, player state) are
  authoritative and always true. BACKGROUND items are rumors or past observations that may be
  false or outdated. Never state a BACKGROUND item as established fact, never act on it, and if
  it conflicts with a CURRENT fact, the CURRENT fact wins and the BACKGROUND item is ignored."

**User digest — sections in this fixed order (authoritative before non-authoritative):**

1. `NPC` — `npcName`, `persona` (existing safe fields).
2. `CURRENT ROOM` — from `context.room`: focus/features `{ type, direction }`, `affordances`,
   `npcCount`. Structured/closed-enum data only — no room/object names, no raw text.
3. `QUEST` — from `context.quest`: `status`, `hint`/`completionHint` if present (already-curated
   safe text from existing quest content).
4. `PLAYER` — health, `status[]`, inventory **count** (not raw item ids as narrative content).
5. `RECENT CONVERSATION` — last N `history` turns, bounded (existing `NPCDialogueTurn[]`).
6. `BACKGROUND (non-authoritative — may be false)` — **present only when `context.memory.entries`
   is non-empty**; see memory transform below. Always the last section.

### Memory transform (the core of this ADR)

Each `RoomMemoryContextEntry` (`{ text, kind? }`) becomes one bounded, hedged line:

```
hedgePrefix(kind) + ': ' + clamp(text, MAX_MEMORY_LINE_CHARS)
```

```ts
const MEMORY_HEDGE_PREFIX: Readonly<Record<string, string>> = {
  player_claim: 'Someone claimed',
  room_observation: 'Previously observed',
  room_note: 'A note here says',
  room_summary: 'This place is remembered as',
}
const DEFAULT_MEMORY_HEDGE_PREFIX = "It's rumored"

export const MAX_MEMORY_ENTRIES = 3
export const MAX_MEMORY_LINE_CHARS = 160
```

- `kind` is a closed room-memory kind (`player_claim` / `room_observation` / `room_note` /
  `room_summary`) in the *domain* memory model, but `RoomMemoryContextEntry.kind` is typed as a
  plain, untrusted `string` at the dialogue boundary (see `contracts.ts`) — the same reason
  `FakeNPCDialogueProvider.MEMORY_AWARENESS_LINES` treats it as a lookup, not an enum. An
  unrecognized or absent `kind` falls through to `DEFAULT_MEMORY_HEDGE_PREFIX`; the raw `kind`
  string itself is **never** interpolated into the prompt.
- Entries are capped at `MAX_MEMORY_ENTRIES = 3` (tighter than the recall-layer cap of 5) —
  first N entries in ranked order, no re-ranking here.
- Each `text` is clamped to `MAX_MEMORY_LINE_CHARS` (truncate, no ellipsis-content invention).
- `entries.length === 0` (or `context.memory` absent) → the BACKGROUND section is **omitted
  entirely** — the digest is byte-identical to the no-memory case. No empty header, no "nothing
  to report" filler.
- The builder reads `entry.text` and `entry.kind` only. It performs no additional lookup,
  resolution, or transformation of ids/flags/names — `DisplayNameResolver` already ran upstream
  when the memory was written (memory-dialogue-awareness-v0 precedent).

### Real network adapter — `generation/OpenAICompatibleNPCDialogueProvider.ts`

Mirrors `OpenAICompatibleObjectiveGenerator.ts` exactly:

```ts
export type OpenAICompatibleNPCDialogueConfig = Pick<OpenAICompatibleConfig, 'baseUrl' | 'apiKey' | 'model'>

export const DIALOGUE_MAX_TOKENS = 200
export const DIALOGUE_TIMEOUT_MS = 10_000
export const DIALOGUE_LLM_REQUEST_FAILED = 'dialogue-llm-request-failed'
export const DIALOGUE_LLM_TIMEOUT = 'dialogue-llm-timeout'
export const DIALOGUE_LLM_EMPTY_RESPONSE = 'dialogue-llm-empty-response'

export class OpenAICompatibleNPCDialogueProvider implements NPCDialogueProvider {
  constructor(config: OpenAICompatibleNPCDialogueConfig, transport: LlmTransport = defaultTransport)
  async reply(request: NPCDialogueRequest): Promise<NPCDialogueResponse>
}
```

- `reply` builds `buildDialoguePromptMessages(request)`, sends one non-streaming
  `POST {baseUrl}/chat/completions` over the injected `LlmTransport`, with a hard
  `AbortController` timeout and **no retry** — identical shape to the room/objective/gate
  adapters.
- Success → `{ text: content }` (raw model text, trimmed; empty string is a valid empty reply,
  not an error — mirrors the objective generator's `content === '' → null` pattern adapted to a
  required string: an empty/whitespace-only reply throws `DIALOGUE_LLM_EMPTY_RESPONSE` since
  dialogue text is display-required, unlike an optional objective).
- Failure → throws a fixed-shape `Error` whose message is one of the three codes above — never
  the key, prompt, memory text, or raw response body. `NPCDialogueService.reply`'s existing
  `catch` already maps any throw to `{ status: 'failed', reason: 'provider-unavailable' }` with
  a count-only log — **no change needed there.**
- No logging inside the provider (matches every existing `OpenAICompatible*Generator`).

### Selector — `app/selectDialogueProvider.ts`

Mirrors `selectObjectiveGenerator.ts` exactly:

```ts
export type RealDialogueSelectionLog = { provider: RealLlmProvider; model: string }
export type FakeDialogueSelectionLog = { provider: 'fake'; reason: 'config-disabled' }

export type DialogueProviderSelection = {
  provider: NPCDialogueProvider
  log: RealDialogueSelectionLog | FakeDialogueSelectionLog
}

export function selectDialogueProvider(config: LlmConfig): DialogueProviderSelection
```

Real when `isRealProviderComplete(config)` (existing helper, no change), else
`new FakeNPCDialogueProvider()`. Reuses `REAL_PROVIDER_BASE_URLS`, `LlmConfig`, and
`isRealProviderComplete` from `app/llmConfig.ts` **unchanged — no new env variable.**

### App wiring

`App.tsx:129-130` currently:

```ts
const dialogueProvider = new FakeNPCDialogueProvider()
const npcDialogueService = new NPCDialogueService(worldSession, dialogueProvider, logger)
```

becomes (module-level, same pattern as `objectiveGenerator`/`gateGeneratorSelection` at
`App.tsx:116-120`):

```ts
const { provider: dialogueProvider, log: dialogueProviderSelectionLog } =
  selectDialogueProvider(llmConfig)
logger.info('dialogue provider selected', dialogueProviderSelectionLog)
const npcDialogueService = new NPCDialogueService(worldSession, dialogueProvider, logger)
```

No other call site changes: `NPCDialogueService`, `buildDialogueContext`,
`recallRoomMemoryContext`, `buildNPCDialogueReplyInput`, and the `NPCDialoguePanel`/
`DialoguePanel` UI are all untouched.

---

## Architectural rules (binding)

1. **Provider returns text only.** `NPCDialogueResponse` stays `{ text: string }`. No new
   fields, no structured output, no state directives.
2. **`NPCDialogueService` gains no write path.** It still only reads `WorldState` via
   `session.getWorldState`; no `appendEvent`, `WorldCommand`, or `WorldSession` mutation call is
   added by this ADR, real provider or not.
3. **Memory is display input to a text-only seam, never parsed back into truth.** No dialogue
   text — from the fake or the real provider — is ever sniffed, parsed, or promoted into a
   memory write, a flag, an event, or a fact. `domain/memory` and `memory/**` are not imported by
   `generation/**` or by this ADR's new modules.
4. **No new memory storage, schema, or firewall change.** `RoomMemoryDialogueContext`,
   `recallRoomMemoryContext`, `rankMemories`, the room-memory kind enum, and the memory firewall
   (`memory/**` cannot import `world-session`) are all unchanged. No migration, no
   `schemaVersion` bump anywhere.
5. **Fake remains the default.** `selectDialogueProvider` returns the fake unless
   `isRealProviderComplete(config)` — the exact same gate as room/objective/gate selection.
   Existing `FakeNPCDialogueProvider` behavior, including its own memory-awareness tier, is
   unchanged.
6. **Memory framing is bounded and hedged.** `MAX_MEMORY_ENTRIES = 3`,
   `MAX_MEMORY_LINE_CHARS = 160`, fixed hedge-prefix table, generic hedge for unrecognized kind,
   raw `kind` never interpolated, BACKGROUND section omitted when memory is empty, BACKGROUND
   always last, explicit non-override instruction in the system prompt.
7. **No raw content leakage in logs.** No log, selection log, or error message may contain:
   memory text, memory `kind`, player line, NPC dialogue text, room/object names, prompt content,
   or raw provider request/response bodies. Selection logs carry only `{ provider, model }` or
   `{ provider: 'fake', reason: 'config-disabled' }` — identical shape to every existing selector
   log.
8. **Fixed safe error codes only.** `DIALOGUE_LLM_REQUEST_FAILED` /
   `DIALOGUE_LLM_TIMEOUT` / `DIALOGUE_LLM_EMPTY_RESPONSE` — never the underlying error, key, or
   body. `NPCDialogueService`'s existing catch-and-map to `provider-unavailable` needs no change.
9. **No new dependency, streaming, retry loop, or provider router.** One non-streaming request,
   no retry, injected transport seam — identical constraint to every existing real provider.
10. **No renderer, backend, schema, or persistence change.** `renderer/**`, `server/**`,
    `persistence/**`, all schema files (`RoomSpec`, `WorldState`, `WorldEvent`, `SaveGame`,
    `QuestSpec`) are untouched.
11. **Dev-only / BYOK caveat carries over unchanged (ADR-0023 §14).** Real dialogue provider
    keys are Vite-inlined `VITE_*` values — local-dev/BYOK only in v0; no hosted deployment.

---

## Scope (v0)

**In scope (this feature):**

- Slice 1 — this ADR + the implementation plan (docs only).
- Slice 2 — `generation/llmDialoguePrompt.ts` (pure prompt builder, memory transform) +
  co-located unit tests.
- Slice 3 — `generation/OpenAICompatibleNPCDialogueProvider.ts` (transport, timeout, error
  codes) + co-located unit tests.
- Slice 4 — `app/selectDialogueProvider.ts` + `App.tsx` wiring (module-level selector, replacing
  the hardcoded fake) + co-located/integration unit tests.
- Slice 5 — docs closeout (`ARCHITECTURE.md` status entry) + manual smoke check with a real
  BYOK key (dev-only) + leakage-test sweep.

**Out of scope / non-goals (must NOT be built in this feature):**

- ❌ New memory storage, table, or memory-store method.
- ❌ Any migration or `schemaVersion` bump (`RoomSpec`, `WorldState`, `WorldEvent`, `SaveGame`,
  `QuestSpec` all stay at their current versions).
- ❌ NPC private memory (per-NPC belief store distinct from room memory).
- ❌ `event_visibility` or any event-visibility concept.
- ❌ `facts` / `fact_visibility` — no promotion of memory or dialogue text into a "fact" table.
- ❌ FTS / vector search / Chroma / embeddings / semantic search of any kind.
- ❌ LLM-written memory — the real dialogue provider never calls `RoomMemoryService.remember`
  or any memory write path.
- ❌ Dialogue-text sniffing to mint trusted facts, flags, or events from NPC/player lines.
- ❌ World-state mutation from free dialogue, real or fake.
- ❌ Streaming responses, multi-attempt repair/re-prompt loop, provider router/fallback chain.
- ❌ Server-side hosting of the dialogue provider.
- ❌ Adjacent-room or non-active-NPC dialogue provider calls (v0 is the same single active-NPC
  seam `NPCDialogueService.reply` already serves).
- ❌ Changing `RoomMemoryDialogueContext`, `recallRoomMemoryContext`, `rankMemories`, or the
  room-memory kind enum.
- ❌ Changing `FakeNPCDialogueProvider`'s existing behavior or its own memory-awareness tier.

---

## Data model

No schema change. New TypeScript-only additions:

```ts
// generation/llmDialoguePrompt.ts
export const MAX_MEMORY_ENTRIES = 3
export const MAX_MEMORY_LINE_CHARS = 160
export const DIALOGUE_SYSTEM_PROMPT: string
export function buildDialoguePromptMessages(request: NPCDialogueRequest): ChatMessage[]

// generation/OpenAICompatibleNPCDialogueProvider.ts
export type OpenAICompatibleNPCDialogueConfig = Pick<OpenAICompatibleConfig, 'baseUrl' | 'apiKey' | 'model'>
export const DIALOGUE_MAX_TOKENS = 200
export const DIALOGUE_TIMEOUT_MS = 10_000
export const DIALOGUE_LLM_REQUEST_FAILED = 'dialogue-llm-request-failed'
export const DIALOGUE_LLM_TIMEOUT = 'dialogue-llm-timeout'
export const DIALOGUE_LLM_EMPTY_RESPONSE = 'dialogue-llm-empty-response'
export class OpenAICompatibleNPCDialogueProvider implements NPCDialogueProvider { ... }

// app/selectDialogueProvider.ts
export type RealDialogueSelectionLog = { provider: RealLlmProvider; model: string }
export type FakeDialogueSelectionLog = { provider: 'fake'; reason: 'config-disabled' }
export type DialogueProviderSelection = {
  provider: NPCDialogueProvider
  log: RealDialogueSelectionLog | FakeDialogueSelectionLog
}
export function selectDialogueProvider(config: LlmConfig): DialogueProviderSelection
```

`NPCDialogueProvider`, `NPCDialogueRequest`, `NPCDialogueResponse`, `NPCDialogueContext`,
`RoomMemoryDialogueContext`, `RoomMemoryContextEntry` — all unchanged.

---

## Files likely to change

- **New (Slice 1):** this ADR;
  `docs/architecture/implementation-plans/real-npc-dialogue-room-memory-awareness-v0.md`.
- **New (Slice 2):** `apps/web/src/generation/llmDialoguePrompt.ts`;
  `apps/web/src/generation/llmDialoguePrompt.test.ts`.
- **New (Slice 3):** `apps/web/src/generation/OpenAICompatibleNPCDialogueProvider.ts`;
  `apps/web/src/generation/OpenAICompatibleNPCDialogueProvider.test.ts`.
- **New (Slice 4):** `apps/web/src/app/selectDialogueProvider.ts`;
  `apps/web/src/app/selectDialogueProvider.test.ts`.
- **Edited (Slice 4):** `apps/web/src/App.tsx` (module-level provider construction only);
  `apps/web/src/App.test.tsx` (selection/regression coverage, if App-level dialogue selection
  is asserted there).
- **Edited (Slice 5, docs):** `docs/architecture/ARCHITECTURE.md`.

## Files NOT to change

`domain/dialogue/**` (`contracts.ts`, `buildDialogueContext.ts`, `buildRoomDialogueContext.ts`) ·
`domain/ports/NPCDialogueProvider.ts` · `dialogue/NPCDialogueService.ts` ·
`dialogue/FakeNPCDialogueProvider.ts` · `app/recallRoomMemoryContext.ts` ·
`domain/memory/**` · `memory/**` (headless application layer) · `persistence/**` (memory stores) ·
`domain/world/**` (all schemas) · `app/npcDialogueReplyInput.ts` ·
`renderer/ui/NPCDialoguePanel.tsx` · `renderer/ui/DialoguePanel.tsx` · `renderer/**` ·
`server/**` · `world-session/**` · `interactions/**` · `encounters/**` ·
`app/llmConfig.ts` (read-only import) · `eslint.config.js` · `package.json`.

---

## Tests

### Slice 2 — `buildDialoguePromptMessages` (pure, co-located)

- No `context.memory` (or `entries: []`) → output identical to a fixture baseline with no
  BACKGROUND section (byte-for-byte / structural equality with the pre-memory digest).
- `entries.length` > `MAX_MEMORY_ENTRIES` → only the first `MAX_MEMORY_ENTRIES` appear.
- Entry `text` longer than `MAX_MEMORY_LINE_CHARS` → clamped, no invented content appended.
- Each closed `kind` (`player_claim`, `room_observation`, `room_note`, `room_summary`) → correct
  fixed hedge prefix.
- Unrecognized / absent `kind` → `DEFAULT_MEMORY_HEDGE_PREFIX`; the raw `kind` string itself
  never appears anywhere in the built messages.
- BACKGROUND section is always the last section, after NPC/ROOM/QUEST/PLAYER/CONVERSATION.
- System message contains the explicit "CURRENT facts are authoritative … BACKGROUND … may be
  false … CURRENT fact wins" instruction.
- No raw room/object ids, flag keys, or gate JSON appear anywhere in the built messages (only
  closed enums / already-safe fields from `context.room`/`context.quest`).
- Builder performs no I/O and imports no logger (structural/lint-level check).

### Slice 3 — `OpenAICompatibleNPCDialogueProvider` (transport-injected, mirrors objective tests)

- Injected transport returns valid content → `reply` resolves `{ text: content }`.
- Transport throws → `Error(DIALOGUE_LLM_REQUEST_FAILED)`.
- Timer fires before transport resolves → `Error(DIALOGUE_LLM_TIMEOUT)`; `AbortController`
  aborted.
- Response `!ok` → `Error(DIALOGUE_LLM_REQUEST_FAILED)`.
- Response body malformed (not JSON) → `Error(DIALOGUE_LLM_REQUEST_FAILED)`.
- `choices[0].message.content` empty/whitespace-only or non-string →
  `Error(DIALOGUE_LLM_EMPTY_RESPONSE)`.
- No retry: exactly one transport call per `reply` invocation.
- Error messages/thrown values never contain the API key, prompt content, memory text, or raw
  response body (string-equality check against the fixed code only).

### Slice 4 — `selectDialogueProvider` + App wiring

- `isRealProviderComplete(config)` true → `{ provider: OpenAICompatibleNPCDialogueProvider
  instance, log: { provider, model } }`.
- Config incomplete (any of provider/key/model missing) → `{ provider: FakeNPCDialogueProvider
  instance, log: { provider: 'fake', reason: 'config-disabled' } }`.
- Existing `FakeNPCDialogueProvider.test.ts` and `NPCDialogueService.test.ts` remain green
  unmodified (regression: fake default path unchanged).
- App-level: dialogue provider selection log is emitted once at module load with the same
  `{ provider, model }` / `{ provider: 'fake', reason }` shape as room/objective/gate selection
  logs — no memory text, no key.

### Slice 5 — Leakage sweep + manual smoke

- Grep-level assertion across `generation/llmDialoguePrompt.ts`,
  `generation/OpenAICompatibleNPCDialogueProvider.ts`, `app/selectDialogueProvider.ts`: no
  `console.*` calls, no logger import in the two `generation/` files.
- `NPCDialogueService.logResult` (unchanged) continues to log only
  `{ sessionId, npcId, roomId, status, reason, turnCount }` under the real provider path too —
  regression assertion with a real-provider double.
- Manual smoke (dev-only, BYOK): with a complete `LlmConfig`, hold a short dialogue in a room
  with recalled memory present; confirm the reply references the room contextually without
  asserting the memory as established fact, and confirm no memory text/kind appears in console
  output.

---

## Failure modes

| Situation | Detection | Handling | Logging |
|---|---|---|---|
| Provider disabled / config incomplete | `isRealProviderComplete(config)` false | `selectDialogueProvider` returns the fake; behavior identical to today | selection log: `{ provider: 'fake', reason: 'config-disabled' }` |
| Real provider transport throws / network error | caught in `NPCDialogueService.reply`'s existing `try/catch` | `{ status: 'failed', reason: 'provider-unavailable' }` (unchanged) | existing count-only warn log (unchanged) |
| Real provider timeout | `AbortController` fires inside the adapter; propagates as a throw | same as above — mapped by the existing service catch | existing count-only warn log (unchanged) |
| Real provider returns empty/malformed response | adapter throws `DIALOGUE_LLM_EMPTY_RESPONSE` | same as above | existing count-only warn log (unchanged) |
| `context.memory` absent or empty | builder checks `entries.length === 0` | BACKGROUND section omitted; digest identical to no-memory case | none (pure function) |
| Memory `kind` unrecognized or absent | hedge-prefix lookup miss | generic `DEFAULT_MEMORY_HEDGE_PREFIX` used; raw `kind` never emitted | none |
| Model narrates a memory entry as fact despite hedging | out of this ADR's enforcement power (LLM behavior, not code) | mitigated, not guaranteed, by system-prompt authority rule + section ordering; **no code path lets the reply mutate state regardless** | n/a — display text only, never parsed back into truth |
| `dialogue` spec missing on the NPC | existing `NPCDialogueService.reply` guard (unchanged) | `{ status: 'rejected', reason: 'missing-dialogue' }` (unchanged) | existing log (unchanged) |
| World state fetch fails | existing `session.getWorldState` guard (unchanged) | `{ status: 'failed', reason: 'not-found' }` (unchanged) | existing log (unchanged) |

---

## Consequences

- Prompt-generated / any active NPC dialogue can, when a real LLM provider is configured, sound
  aware of what happened earlier in the room — without any change to what memory *is* (still
  inert, non-authoritative, closed-enum, dedupe-keyed context) or how it reaches truth (it never
  does).
- `NPCDialogueService`'s zero-write architecture, not prompt wording, remains the actual safety
  guarantee: any future dialogue provider, however memory-aware, inherits the same trust
  boundary automatically.
- The fake/real provider location asymmetry — `FakeNPCDialogueProvider` in `dialogue/`,
  `OpenAICompatibleNPCDialogueProvider` in `generation/` — mirrors the existing room-generator
  asymmetry (`FakeRoomGenerator` in `generation/`, but dialogue's fake predates this ADR in
  `dialogue/`). This is accepted as intentional: `generation/**` is the one inner layer already
  permitted network I/O by lint, so the new real adapter belongs there regardless of where the
  existing fake sits.
- Future work (streaming replies, richer memory selection/summarization for the prompt, a
  provider router, hosted deployment) remains separately approvable; none is implied by this
  ADR.

## Alternatives considered

- **`kind`-only memory exposure to the real provider (mirror the fake exactly)** — rejected: the
  fake's `kind`-only table is the correct choice for a *deterministic* provider (finite,
  testable lines), but a real LLM gains essentially nothing from a bare kind label. Bounded
  hedged transformed text is the minimum that makes the real provider's memory awareness
  meaningful while staying safe.
- **Pass raw `entry.text` verbatim under a labeled section, no per-line hedge** — rejected: a
  section label alone is a single point of failure if the model's attention weights the label
  loosely; a per-line hedge prefix repeats the epistemic status at the point of use, which is
  cheap and strictly safer.
- **Split into two slices (bare real provider first, memory awareness later)** — rejected per
  maintainer decision: the real provider without memory awareness has little product value on
  its own, and the memory transform is small enough to review as one slice.
- **Put the real adapter in `dialogue/` next to the fake** — rejected: `dialogue/**`'s lint block
  does not permit network I/O the way `generation/**` does; moving that boundary would be an
  unrelated, unapproved lint change. `generation/**` is the correct home regardless of the fake's
  location.
- **Log a truncated/hashed sample of memory text for observability** — rejected: `AGENTS.md` is
  unconditional — memory text is never logged, full stop. No exception carved out here.
