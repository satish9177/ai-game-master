# Implementation Plan — `feature/real-npc-dialogue-room-memory-awareness-v0`

> Status: **design approved (docs-only), not yet implemented.**
> Maintainer approved docs-only planning and the guardrail scope on 2026-07-01, under the
> existing room/objective/gate precedent: opt-in, dev-only/BYOK, off by default, fake remains
> default, no server-side hosting, no streaming, no retry loop, no provider router, no state
> mutation from dialogue.
> The ADR for this slice is
> [ADR-0065](../decisions/ADR-0065-real-npc-dialogue-room-memory-awareness-v0.md) (Proposed).
>
> **Depends on:** `feature/room-memory-recall-context-v0` (shipped —
> `app/recallRoomMemoryContext.ts`, `domain/memory/ranking.ts`, `RoomMemoryDialogueContext` on
> `NPCDialogueContext`) and `feature/memory-dialogue-awareness-v0` (shipped —
> `FakeNPCDialogueProvider`'s `kind`-only `MEMORY_AWARENESS_LINES` tier). This plan's memory
> transform extends the same recalled data one step further, into free real-provider prompt text.
>
> Companion docs: [ARCHITECTURE](../ARCHITECTURE.md) · [BOUNDARIES](../BOUNDARIES.md) ·
> [FAILURE-MODES](../FAILURE-MODES.md) · [CONVENTIONS](../CONVENTIONS.md).
> Direct precedents this plan mirrors structurally:
> `real-room-generator-provider-v0`
> ([ADR-0023](../decisions/ADR-0023-real-room-generator-provider-v0.md)) — the original
> `OpenAICompatible*` adapter template (`LlmTransport` seam, `AbortController` timeout, fixed
> error codes, dev-only/BYOK caveat);
> `real-generated-objective-provider-v0`
> ([ADR-0049](../decisions/ADR-0049-real-generated-objective-provider-v0.md)) — the exact
> pure-prompt-builder + real-adapter + `select*Generator` shape this plan applies to the
> `NPCDialogueProvider` port;
> `generated-mechanical-gate-provider-v0`
> ([ADR-0064](../decisions/ADR-0064-generated-mechanical-gate-provider-v0.md)) — the most recent
> instance of the same pattern, confirming it is still current practice.

---

## Goal

Give the prompt-generated-dialogue path a real, network-backed `NPCDialogueProvider`
(`OpenAICompatibleNPCDialogueProvider`) behind the unchanged `NPCDialogueProvider` port, whose
prompt includes recalled room memory as a bounded, hedged, explicitly non-authoritative
`BACKGROUND` section — so NPCs voiced by a real LLM can sound aware of what happened earlier in
the room, without memory ever becoming, or being treated as, gameplay truth.

The feature is **strictly additive and read-only**: `NPCDialogueService.reply` keeps its existing
`session.getWorldState`-only, no-`appendEvent` shape; `FakeNPCDialogueProvider` remains the
default and the fallback; no `WorldState`/`WorldEvent`/`SaveGame`/`QuestSpec`/`RoomSpec` schema,
memory storage, migration, or firewall changes. Every provider failure degrades to the existing
`{ status: 'failed', reason: 'provider-unavailable' }` path, exactly as it already does today.

---

## 1. Status

**Design approved, docs-only.** This plan and ADR-0065 are Slice 1. No source file has been
created or modified. Slices 2-5 (below) are not yet started and require no further design
approval to begin, per the maintainer's docs-only-then-implement instruction — but each slice
should still land as its own small, reviewable diff.

---

## 2. Current repo facts (verified against source)

- **`NPCDialogueProvider` port** (`domain/ports/NPCDialogueProvider.ts`): one method
  `reply(request: NPCDialogueRequest): Promise<NPCDialogueResponse>`. Unchanged. The real
  provider implements this identically to the fake.
- **No real implementation exists today.** `App.tsx:129` —
  `const dialogueProvider = new FakeNPCDialogueProvider()` — is unconditional. Unlike room
  (`selectRoomGenerator`), objective (`selectObjectiveGenerator`), and gate
  (`selectGateGenerator`) generation, there is no `select*` function and no `OpenAICompatible*`
  adapter for dialogue anywhere in `generation/`.
- **`NPCDialogueService.reply`** (`dialogue/NPCDialogueService.ts:45-95`): calls
  `buildDialogueContext(...)` then `this.provider.reply({ context, playerLine })` inside a
  `try/catch`. On any throw (network, timeout, or otherwise) it already returns
  `{ status: 'failed', reason: 'provider-unavailable' }` and logs only
  `{ sessionId, npcId, roomId, status, reason, turnCount }` (`logResult`, lines 97-115). **This
  needs no change** — it already treats any provider, real or fake, identically.
- **`NPCDialogueContext.memory`** (`domain/dialogue/contracts.ts:56-68`,
  `RoomMemoryDialogueContext = { entries: RoomMemoryContextEntry[] }`,
  `RoomMemoryContextEntry = { text: string; kind?: string }`): already populated end-to-end —
  `App.tsx:418` calls `recallRoomMemoryContext(...)` →
  `buildNPCDialogueReplyInput({ ..., memoryContext })` (`app/npcDialogueReplyInput.ts:37`) →
  `NPCDialogueService.reply` → `buildDialogueContext(..., input.memoryContext)`
  (`dialogue/NPCDialogueService.ts:66`) → `NPCDialogueContext.memory`. No change needed anywhere
  in this chain.
- **`recallRoomMemoryContext`** (`app/recallRoomMemoryContext.ts`): already ranks
  (`rankMemories`) and bounds to `DEFAULT_ROOM_MEMORY_DIALOGUE_LIMIT = 5` entries, each
  `{ text: entry.record.text, kind: entry.record.kind }`. `entry.record.text` already went
  through `DisplayNameResolver` at write time (memory-dialogue-awareness-v0 precedent) — no raw
  ids reach this layer. This plan's prompt builder further caps to 3 and clamps line length; it
  does not re-rank or re-fetch.
- **`FakeNPCDialogueProvider`'s memory tier** (`dialogue/FakeNPCDialogueProvider.ts:96-131,
  205-216`): `MEMORY_AWARENESS_LINES` keyed by the closed room-memory `kind`
  (`player_claim`/`room_observation`/`room_note`/`room_summary`); reads `entry.kind` only, never
  `entry.text`. This is the direct precedent for this plan's `MEMORY_HEDGE_PREFIX` table — same
  four keys, same fallback-on-miss idea, applied to real free text instead of a canned line.
- **`LlmConfig` / `isRealProviderComplete` / `REAL_PROVIDER_BASE_URLS`**
  (`app/llmConfig.ts`): already read and normalized once at module load
  (`const llmConfig = readLlmConfig()`, `App.tsx:105`). `selectDialogueProvider` will import and
  reuse these directly — **no new env variable.**
- **`selectObjectiveGenerator`** (`app/selectObjectiveGenerator.ts`): the structural template —
  `{ generator, log }` shape (this plan: `{ provider, log }`, since the field is a
  `NPCDialogueProvider`, not a generator).
- **`OpenAICompatibleObjectiveGenerator`** (`generation/OpenAICompatibleObjectiveGenerator.ts`):
  the adapter template. `LlmTransport`, `LlmTransportInit`, `LlmTransportResponse`,
  `extractContent`, the `AbortController`/`timedOut` pattern, and fixed-code error throws are
  all directly reusable (imported types, mirrored logic).
- **`buildObjectivePromptMessages`** (`generation/llmObjectivePrompt.ts`): the template for
  `buildDialoguePromptMessages`. Pure, side-effect-free, unit-testable in isolation, returns
  `ChatMessage[]` (`{ role: 'system' | 'user'; content: string }[]`, type defined in
  `generation/llmRoomPrompt.ts`).
- **App module-level wiring order** (`App.tsx:104-130`): `llmConfig` is read once
  (line 105), then `selectRoomGenerator`/`selectObjectiveGenerator`/`selectGateGenerator` are
  each called once at module scope with a `logger.info(...)` line immediately after (lines
  106-120). `dialogueProvider`/`npcDialogueService` construction (lines 129-130) is the next
  natural insertion point, following the identical pattern.

---

## 3. Scope

### To implement

1. **`buildDialoguePromptMessages`** — pure prompt builder in `generation/llmDialoguePrompt.ts`.
   Takes the full `NPCDialogueRequest` (context + optional `playerLine`). Produces a static
   system message (role, bans, authority rule) and a structured user digest with six ordered
   sections (`NPC`, `CURRENT ROOM`, `QUEST`, `PLAYER`, `RECENT CONVERSATION`, and — only when
   non-empty — `BACKGROUND (non-authoritative — may be false)`). The memory transform is
   `hedgePrefix(kind) + ': ' + clamp(text, MAX_MEMORY_LINE_CHARS)`, capped at
   `MAX_MEMORY_ENTRIES = 3`. No room/object/NPC free text beyond what `NPCDialogueContext`
   already carries reaches the model; no new field is read from anywhere.

2. **`OpenAICompatibleNPCDialogueProvider`** — real network adapter in
   `generation/OpenAICompatibleNPCDialogueProvider.ts`. Implements `NPCDialogueProvider`. Uses
   `DIALOGUE_MAX_TOKENS = 200` and `DIALOGUE_TIMEOUT_MS = 10_000`. Injected transport seam.
   Returns `{ text: content }` on success; throws a fixed-code `Error` on any hard failure.
   Imports no logger, reads no env.

3. **`selectDialogueProvider`** — selector in `app/selectDialogueProvider.ts`. Mirrors
   `selectObjectiveGenerator`. Returns `{ provider: NPCDialogueProvider; log: ... }`. Real when
   `isRealProviderComplete(config)`, else `new FakeNPCDialogueProvider()` with
   `{ provider: 'fake', reason: 'config-disabled' }`.

4. **`App.tsx` wiring** — replace the hardcoded `FakeNPCDialogueProvider` constant with
   `selectDialogueProvider(llmConfig)`, add the matching `logger.info('dialogue provider
   selected', log)` line, matching the existing room/objective/gate selection call sites exactly.

### Out / deferred (unchanged from ADR-0065 non-goals)

New memory storage/table/migration/`schemaVersion` bump · NPC private memory ·
`event_visibility` · `facts`/`fact_visibility` · FTS/vector/Chroma/embeddings · LLM-written
memory (no `RoomMemoryService.remember` call from the provider or service) · dialogue-text
sniffing into facts/flags/events · world-state mutation from dialogue · streaming · multi-attempt
repair/re-prompt loop · provider router/fallback chain · server-side dialogue provider hosting ·
adjacent-room or non-active-NPC provider calls · any change to `RoomMemoryDialogueContext`,
`recallRoomMemoryContext`, `rankMemories`, the room-memory kind enum, `buildDialogueContext`,
`buildRoomDialogueContext`, `NPCDialogueService`, `NPCDialogueProvider` port, or
`FakeNPCDialogueProvider`'s existing behavior · `world-session`, `interactions`, `encounters`,
`memory`, `persistence`, `server`, `renderer`, reducers, `saveGame`, `eslint.config.js`,
`package.json`.

---

## 4. Minimum Safe Change Check

- **Reused:** `NPCDialogueProvider` port (unchanged) · `NPCDialogueService.reply`'s existing
  try/catch → `provider-unavailable` mapping (unchanged, no new logic needed) ·
  `NPCDialogueContext.memory` / `RoomMemoryDialogueContext` / `RoomMemoryContextEntry` (unchanged
  shapes) · `recallRoomMemoryContext` (unchanged, already bounded/ranked) · `LlmConfig` /
  `isRealProviderComplete` / `REAL_PROVIDER_BASE_URLS` (no new env vars) · `LlmTransport` /
  `LlmTransportInit` / `LlmTransportResponse` / `extractContent` pattern (mirrored from the
  objective generator) · `ChatMessage` type (`generation/llmRoomPrompt.ts`) ·
  `FakeNPCDialogueProvider` (now explicitly the fallback, unchanged) · `selectObjectiveGenerator`
  shape (mirrored) · `FakeNPCDialogueProvider.MEMORY_AWARENESS_LINES` kind-keying idea (mirrored
  as `MEMORY_HEDGE_PREFIX`, not imported — different table, different purpose).
- **New code (minimum):** one pure prompt builder (with the memory transform) · one real provider
  (mirroring the objective/gate providers) · one selector (mirroring `selectObjectiveGenerator`)
  · one small `App.tsx` wiring change (construct-and-log, same shape as the three existing
  selector call sites).
- **Safety boundaries unchanged:** `NPCDialogueService` has no `WorldSession` write path under
  any provider; memory remains inert non-authoritative context (`domain/memory` /
  `memory/**` untouched); the real provider returns `{ text: string }` only, never parsed back
  into a memory write, flag, or event; the fake stays the default; no schema/migration/firewall
  change anywhere; provider failures use fixed safe codes only; no memory text, `kind`, player
  line, or dialogue text reaches any log.
- **Targeted tests:** prompt section-ordering and memory-cap/clamp/hedge-mapping unit tests;
  provider transport-mock tests with sanitized-error assertions; selector fake/real split tests;
  App-level selection + regression tests; a leakage sweep across the three new files.

---

## 5. Files touched by the planned slices

**New files:**

- `apps/web/src/generation/llmDialoguePrompt.ts` — `buildDialoguePromptMessages`,
  `DIALOGUE_SYSTEM_PROMPT`, `MEMORY_HEDGE_PREFIX`, `DEFAULT_MEMORY_HEDGE_PREFIX`,
  `MAX_MEMORY_ENTRIES`, `MAX_MEMORY_LINE_CHARS`. Generation layer; no logger, no I/O, no env.
- `apps/web/src/generation/llmDialoguePrompt.test.ts`
- `apps/web/src/generation/OpenAICompatibleNPCDialogueProvider.ts` — real provider.
  `DIALOGUE_MAX_TOKENS`, `DIALOGUE_TIMEOUT_MS` constants. Injected transport seam. Fixed-code
  throws: `dialogue-llm-request-failed`, `dialogue-llm-timeout`, `dialogue-llm-empty-response`.
- `apps/web/src/generation/OpenAICompatibleNPCDialogueProvider.test.ts`
- `apps/web/src/app/selectDialogueProvider.ts` — `selectDialogueProvider(config: LlmConfig)`
  returning `{ provider, log }`.
- `apps/web/src/app/selectDialogueProvider.test.ts`

**Modified files:**

- `apps/web/src/App.tsx` — three lines:
  - Replace `const dialogueProvider = new FakeNPCDialogueProvider()` with
    `const { provider: dialogueProvider, log: dialogueProviderSelectionLog } = selectDialogueProvider(llmConfig)`
  - Add `logger.info('dialogue provider selected', dialogueProviderSelectionLog)` on the next
    line, before `const npcDialogueService = new NPCDialogueService(...)`.
  - Add the new import for `selectDialogueProvider`; the existing `FakeNPCDialogueProvider`
    import is retained (still used inside `selectDialogueProvider`, and directly if any existing
    test constructs it).
- `docs/architecture/ARCHITECTURE.md` — one status paragraph (Slice 5, docs closeout).

---

## 6. Files NOT to touch

`domain/ports/NPCDialogueProvider.ts` · `domain/dialogue/contracts.ts` ·
`domain/dialogue/buildDialogueContext.ts` · `domain/dialogue/buildRoomDialogueContext.ts` ·
`dialogue/NPCDialogueService.ts` · `dialogue/FakeNPCDialogueProvider.ts` ·
`app/recallRoomMemoryContext.ts` · `app/npcDialogueReplyInput.ts` · `domain/memory/**` ·
`memory/**` (headless application layer) · `persistence/**` · `domain/world/**` (all schemas) ·
`domain/quests/**` · `generation/FakeRoomGenerator.ts` · `generation/FakeObjectiveGenerator.ts` ·
`generation/OpenAICompatibleRoomGenerator.ts` · `generation/OpenAICompatibleObjectiveGenerator.ts`
· `generation/OpenAICompatibleGateGenerator.ts` · `generation/llmRoomPrompt.ts` (read-only import
of `ChatMessage`) · `app/llmConfig.ts` (read-only import) · `app/selectRoomGenerator.ts` ·
`app/selectObjectiveGenerator.ts` · `app/selectGateGenerator.ts` ·
`renderer/ui/NPCDialoguePanel.tsx` · `renderer/ui/DialoguePanel.tsx` · `renderer/**` ·
`world-session/**` · `interactions/**` · `encounters/**` · `server/**` · `eslint.config.js` ·
`package.json`.

---

## 7. Implementation slices

Each slice is independently shippable and independently testable. Do not merge slices.

---

**Slice 1 — Docs (this slice)**
`docs: add ADR-0065 and implementation plan for real NPC dialogue room-memory awareness v0`

New files: this plan, `ADR-0065-real-npc-dialogue-room-memory-awareness-v0.md`.

No source code. Status: **complete** (this document).

---

**Slice 2 — Pure prompt builder**
`feat(generation): dialogue prompt builder — bounded, hedged, memory-aware digest`

New files: `llmDialoguePrompt.ts`, `llmDialoguePrompt.test.ts`.

No network, no wiring. The builder is pure and side-effect-free: takes the full
`NPCDialogueRequest`, returns `ChatMessage[]` (system + user). Imports `ChatMessage` from
`generation/llmRoomPrompt.ts` and the dialogue contract types from `domain/dialogue/contracts.ts`
only (types, not `domain/memory`).

Tests:
- System message is static and contains the explicit "CURRENT facts are authoritative … BACKGROUND
  … may be false … CURRENT fact wins" instruction.
- User digest section order is always `NPC, CURRENT ROOM, QUEST, PLAYER, RECENT CONVERSATION[,
  BACKGROUND]` — `BACKGROUND` last when present.
- `context.memory` absent, or `entries: []` → no `BACKGROUND` section; digest is structurally
  identical to a fixture built from the same request minus `memory`.
- `entries.length > MAX_MEMORY_ENTRIES (3)` → only the first 3 (in given order) appear.
- Entry `text` longer than `MAX_MEMORY_LINE_CHARS (160)` → truncated, no invented suffix content.
- Each of the four closed kinds (`player_claim`, `room_observation`, `room_note`,
  `room_summary`) → correct fixed hedge prefix from `MEMORY_HEDGE_PREFIX`.
- Unrecognized `kind` (arbitrary string) and absent `kind` → `DEFAULT_MEMORY_HEDGE_PREFIX`
  (`"It's rumored"`).
- The raw `kind` string value never appears verbatim anywhere in the built `ChatMessage[]`
  content (assert via substring search for the raw kind tokens, e.g. `'player_claim'` must not
  appear as a literal substring even when that kind is present — only its mapped prefix should).
- No room/object ids, flag keys, gate JSON, or raw prompt/provider text appears anywhere in the
  built messages — only closed-enum `context.room`/`context.quest` fields and the transformed
  memory lines.
- Builder module imports no logger and performs no I/O (structural check: no `fetch`, no
  `console`, no `platform/logger` import).
- Deterministic: same `NPCDialogueRequest` in → identical `ChatMessage[]` out.

Verification: `npm run test -- llmDialoguePrompt`, `npm run lint`, `npm run build`

---

**Slice 3 — Real provider**
`feat(generation): OpenAICompatibleNPCDialogueProvider — real network-backed dialogue provider`

New files: `OpenAICompatibleNPCDialogueProvider.ts`, `OpenAICompatibleNPCDialogueProvider.test.ts`.

The provider mirrors `OpenAICompatibleObjectiveGenerator` structurally, implementing
`NPCDialogueProvider.reply` instead of `ObjectiveGenerator.generate`. Uses
`DIALOGUE_MAX_TOKENS = 200` and `DIALOGUE_TIMEOUT_MS = 10_000`. Injected transport seam for
testability. Calls `buildDialoguePromptMessages(request)` from Slice 2.

Fixed error codes: `dialogue-llm-request-failed`, `dialogue-llm-timeout`,
`dialogue-llm-empty-response`.

Tests:
- Returns `{ text: content }` verbatim (trimmed) on a successful 2xx JSON response.
- Empty/whitespace-only `choices[0].message.content` → throws
  `Error('dialogue-llm-empty-response')` (unlike the objective generator's `'' → null`: dialogue
  text is a required display value, so an empty reply is treated as a failure, not a valid
  "no objective" outcome).
- `choices[0].message.content` is not a string → throws `Error('dialogue-llm-empty-response')`.
- Transport throws (network error) → throws `Error('dialogue-llm-request-failed')`.
- Timer fires before transport resolves → throws `Error('dialogue-llm-timeout')`;
  `AbortController` aborted.
- Response `!ok` → throws `Error('dialogue-llm-request-failed')`.
- Response body malformed (not JSON) → throws `Error('dialogue-llm-request-failed')`.
- **Sanitized-error assertion:** no thrown error message contains any substring of the injected
  API key, any memory `text`/`kind` from the request fixture, the player line, the room id, the
  npc id, or the raw response body string.
- No retry: exactly one transport call per `reply` invocation.
- `AbortController` signal passed to transport; timer cleared on success.
- Provider module imports no logger.

Verification: `npm run test -- OpenAICompatibleNPCDialogueProvider`, `npm run lint`,
`npm run build`

---

**Slice 4 — Selector + App wiring**
`feat(app): selectDialogueProvider — config-driven fake/real dialogue selection`

New files: `selectDialogueProvider.ts`, `selectDialogueProvider.test.ts`.
Modified file: `App.tsx` — swap + log line + import (see §5).

Mirrors `selectObjectiveGenerator`. Returns `{ provider: NPCDialogueProvider, log }`.

Tests (`selectDialogueProvider.test.ts`):
- Returns real `OpenAICompatibleNPCDialogueProvider` when `isRealProviderComplete` (provider set,
  key non-empty, model non-empty).
- Returns `FakeNPCDialogueProvider` on incomplete config (missing provider / key / model).
- Log object for real selection contains `{ provider, model }` only — never the API key.
- Log object for fake selection is `{ provider: 'fake', reason: 'config-disabled' }`.
- Constructing the real provider performs no I/O (safe to call at module load, matching every
  existing selector).

Tests (App.tsx additions, mirroring the existing `objectiveGenerator` App-level coverage):
- When `isRealProviderComplete`, `dialogueProvider` is an `OpenAICompatibleNPCDialogueProvider`
  instance (duck-typed / injected-transport check).
- When config is incomplete, `dialogueProvider` is a `FakeNPCDialogueProvider` instance
  (regression: default path unchanged).
- `logger.info('dialogue provider selected', ...)` is called once at module load with a
  log-safe object (no key, no memory text).
- Existing `FakeNPCDialogueProvider.test.ts` and `NPCDialogueService.test.ts` remain green,
  unmodified.

Verification: `npm run test -- selectDialogueProvider`, `npm run test -- NPCDialogueService`,
`npm run test -- FakeNPCDialogueProvider`, `npm run lint`, `npm run build`

---

**Slice 5 — Leakage sweep, docs closeout, manual smoke**
`docs: close out real NPC dialogue room-memory awareness v0`

No new production files. Update `docs/architecture/ARCHITECTURE.md` with a short "Real NPC
Dialogue + Room-Memory Awareness v0" status paragraph mirroring the existing feature-map style
(see e.g. the Real Generated Objective Provider v0 entry), citing ADR-0065.

Tests / checks:
- Grep-level sweep: no `console.*` call and no `platform/logger` import in
  `generation/llmDialoguePrompt.ts` or `generation/OpenAICompatibleNPCDialogueProvider.ts`.
- Confirm `NPCDialogueService.logResult` output shape is unchanged when exercised against a real
  (mocked-transport) provider double — still only
  `{ sessionId, npcId, roomId, status, reason, turnCount }`.
- Manual smoke (dev-only, local `.env.local` with a real BYOK key): hold a short dialogue in a
  generated room that has at least one recalled room memory; confirm (a) the reply is in
  character and references the room without asserting a memory item as established fact, and
  (b) no memory text/kind/player line appears in dev console output.

Verification: `npm run test`, `npm run lint`, `npm run build`; manual smoke as above (not part
of CI, dev-only).

---

## 8. Verification commands (full slice set)

```bash
# Slice 2
npm run test -- llmDialoguePrompt

# Slice 3
npm run test -- OpenAICompatibleNPCDialogueProvider

# Slice 4
npm run test -- selectDialogueProvider
npm run test -- NPCDialogueService
npm run test -- FakeNPCDialogueProvider

# Every slice
npm run lint
npm run build

# Broader regression before calling the feature done
npm run test -- dialogue
npm run test -- memory
npm run test
```

Run from `apps/web`. Prefer the targeted test commands per slice; run the full `npm run test`
only once at final closeout (Slice 5), per `AGENTS.md`'s "prefer targeted verification" rule.
