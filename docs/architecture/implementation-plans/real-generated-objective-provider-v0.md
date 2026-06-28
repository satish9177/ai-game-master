# Implementation Plan — `feature/real-generated-objective-provider-v0`

> Status: **implemented 2026-06-28.**
> Maintainer approved the real objective provider scope on 2026-06-28.
> The ADR for this slice is
> [ADR-0049](../decisions/ADR-0049-real-generated-objective-provider-v0.md)
> (Accepted / implemented 2026-06-28).
>
> **Depends on:** `feature/generated-story-objective-contract-v0`
> ([ADR-0047](../decisions/ADR-0047-generated-story-objective-contract-v0.md))
> and `feature/generated-room-objective-target-enrichment-v0`
> ([ADR-0048](../decisions/ADR-0048-generated-room-objective-target-enrichment-v0.md))
> must both be implemented first. This plan's wiring builds on the shipped
> `assembleObjective`, `ObjectiveGenerator` port, `FakeObjectiveGenerator`,
> `buildGeneratedObjectiveAttachment`, and `ensureGeneratedObjectiveTarget` pipeline.
>
> Companion docs: [ARCHITECTURE](../ARCHITECTURE.md) · [BOUNDARIES](../BOUNDARIES.md) ·
> [FAILURE-MODES](../FAILURE-MODES.md) · [CONVENTIONS](../CONVENTIONS.md).
> Direct precedents and dependencies:
> `generated-story-objective-contract-v0`
> ([ADR-0047](../decisions/ADR-0047-generated-story-objective-contract-v0.md))
> defines the `ObjectiveGenerator` port, `assembleObjective`, `FakeObjectiveGenerator`,
> and `buildGeneratedObjectiveAttachment` that this plan wires to a real provider;
> `generated-room-objective-target-enrichment-v0`
> ([ADR-0048](../decisions/ADR-0048-generated-room-objective-target-enrichment-v0.md))
> ensures real-LLM rooms contain one objective-ready `interact-object` target, without
> which the real provider's output would always fail satisfiability;
> `real-room-generator-provider-v0`
> ([ADR-0023](../decisions/ADR-0023-real-room-generator-provider-v0.md))
> is the exact structural template this plan mirrors — same `LlmConfig` / `LlmTransport`
> seam / fixed-code errors / `selectRoomGenerator` pattern, applied to the objective port.

---

## Goal

Wire a real, network-backed `ObjectiveGenerator` (`OpenAICompatibleObjectiveGenerator`) behind
the unchanged `ObjectiveGenerator` port so that prompt-generated DeepSeek/OpenAI rooms receive
an objective title, description, hint, and completion hint that reflect the room's actual object
types — not the generic authored text from `FakeObjectiveGenerator`.

The feature is **strictly additive**: `assembleObjective` is the unchanged safety gate; the
fake remains the default and fallback; no world-state, schema, persistence, or renderer change
is made. Every failure path degrades to no quest, exactly as if the fake had found no eligible
object.

---

## 1. Status

**Implemented 2026-06-28.** Slices 1-5 are complete; this document is now the closeout record
for the shipped v0 behavior and its deferred follow-ups.

---

## 2. Current repo facts (verified against source)

- **`ObjectiveGenerator` port** (`domain/ports/ObjectiveGenerator.ts`): one method
  `generate(room: LoadedRoom): Promise<string | null>`. Unchanged. Both the fake and the real
  provider implement this interface identically.
- **`FakeObjectiveGenerator`** (`generation/FakeObjectiveGenerator.ts`): `isEligibleInteractObject`
  requires `id != null`, `interaction.effect != null`, `interaction.encounter == null`. This is
  the same predicate `assembleObjective`'s satisfiability gate uses for `interact-object`
  conditions. The shared `listInteractObjectiveCandidates` helper will unify these.
- **`buildGeneratedObjectiveAttachment`** (`app/generatedObjective.ts:12-29`): wraps
  `generator.generate(room)` + `assembleObjective(raw, room)` in a `try/catch` that returns
  `null` on any throw. This is already the correct safety net for real provider failures.
- **`App.tsx` composition root** (`App.tsx:81`):
  `const objectiveGenerator = new FakeObjectiveGenerator()`. This is the single line that
  changes in App.tsx.
- **`App.tsx` wiring** (`App.tsx:385-403`): `result.provenance === 'generated'` gate already
  guards objective attachment. Only clean `generated` rooms reach `buildGeneratedObjectiveAttachment`.
  Adjacent, repaired, and fallback rooms never reach the objective pipeline regardless of provider.
- **`LlmConfig` / `isRealProviderComplete` / `REAL_PROVIDER_BASE_URLS`** (`app/llmConfig.ts`):
  already read and normalized at module level. `selectObjectiveGenerator` will import and reuse
  these directly — no new env reading or new VITE_* variables.
- **`selectRoomGenerator`** (`app/selectRoomGenerator.ts`): returns `{ generator, log }`;
  `log` is log-safe. `selectObjectiveGenerator` mirrors this shape exactly.
- **`OpenAICompatibleRoomGenerator`** (`generation/OpenAICompatibleRoomGenerator.ts`): the
  structural template. `LlmTransport`, `LlmTransportInit`, `LlmTransportResponse`,
  `extractContent`, the `AbortController` / `timedOut` pattern, and fixed-code error throws are
  all directly reusable (imported or mirrored).
- **`buildRoomPromptMessages`** (`generation/llmRoomPrompt.ts`): the template for
  `buildObjectivePromptMessages`. Pure, side-effect-free, unit-testable in isolation.
- **`assembleObjective` satisfiability gate** (`domain/quests/assembleObjective.ts:94-119`):
  for `interact-object`, requires `findObjectById(room, objectId)` succeeds **and**
  `hasInteractionEffect(object)` is true. The `listInteractObjectiveCandidates` helper must
  match this predicate exactly.
- **`domain/quests/generatedObjectiveSpec.ts`**: `GeneratedObjectiveObjectIdSchema` already
  rejects strings starting with `interaction:` or `encounter:`. The real provider's system
  prompt must not allow the model to emit these.
- **ADR-0048 enrichment** (`domain/generatedRoomObjectiveTarget.ts`): after stage 2.12.5 in
  `assembleRoom`, at least one eligible object carries `id` + `effect: { kind: 'inspect' }` +
  no encounter. The `listInteractObjectiveCandidates` helper will find it.

---

## 3. Scope

### Implemented

1. **`listInteractObjectiveCandidates`** — pure domain helper in
   `domain/quests/objectiveCandidates.ts`. Shared predicate: objects where
   `id != null && interaction.effect != null && interaction.encounter == null && type !== 'npc'`.
   Returns `{ objectId: string; type: string }[]` sorted by story-anchor type priority.

2. **`buildObjectivePromptMessages`** — pure prompt builder in `generation/llmObjectivePrompt.ts`.
   Takes `ObjectiveCandidate[]` from the helper. Produces a static system message and a user
   message of `JSON.stringify(candidates)` only. No room name, object name, user prompt text,
   or interaction text reaches the model.

3. **`OpenAICompatibleObjectiveGenerator`** — real network adapter in
   `generation/OpenAICompatibleObjectiveGenerator.ts`. Implements `ObjectiveGenerator`.
   Uses `OBJECTIVE_MAX_TOKENS = 400` and `OBJECTIVE_TIMEOUT_MS = 12_000`. Injected transport
   seam. Returns content verbatim (`string`) or `null` on empty. Throws fixed-code `Error`
   on hard failure. Imports no logger, reads no env.

4. **`selectObjectiveGenerator`** — selector in `app/selectObjectiveGenerator.ts`. Mirrors
   `selectRoomGenerator`. Returns `{ generator: ObjectiveGenerator; log: ... }`. Real when
   `isRealProviderComplete(config)`, else `new FakeObjectiveGenerator()` with
   `{ provider:'fake', reason:'config-disabled' }`.

5. **`App.tsx` one-line swap** — replaced the `FakeObjectiveGenerator` constant with
   `selectObjectiveGenerator(llmConfig)`. Add `logger.info('objective generator selected', log)`.

### Out / deferred

Real `resolve-encounter` / `visit-room` objective generation · multi/chained objectives ·
async/non-blocking objective attach · separate objective usage meter · fence-stripping or
repair loop in the provider · server-side provider · persistence of generated `QuestSpec` /
hints · any change to `assembleObjective`, `generatedObjectiveSpec`, `ObjectiveGenerator` port,
`FakeObjectiveGenerator`, `buildGeneratedObjectiveAttachment`, `assembleRoom`,
`ensureGeneratedObjectiveTarget`, `questSpec`, `evaluateQuest`, `demoQuestSpec`,
`evaluateExitGate`, `exitGate.ts`, `gatedNavigation`, `NavigationService`, `world-session`,
`interactions`, `encounters`, `dialogue`, `memory`, `persistence`, `server`, `renderer`,
reducers, `saveGame`, or `eslint.config.js` / `package.json`.

---

## 4. Minimum Safe Change Check

- **Reused:** `ObjectiveGenerator` port · `assembleObjective` (the gate, unchanged) ·
  `buildGeneratedObjectiveAttachment` (try/catch wrapper, unchanged) · `LlmConfig` /
  `isRealProviderComplete` / `REAL_PROVIDER_BASE_URLS` (no new env vars) · `LlmTransport`
  seam (mirrored from room generator) · `FakeObjectiveGenerator` (now the fallback, unchanged) ·
  `provenance === 'generated'` gate in App (unchanged) · `selectRoomGenerator` shape (mirrored).
- **New code (minimum):** one pure predicate helper · one pure prompt builder · one real
  provider (mirroring the room provider) · one selector (mirroring `selectRoomGenerator`) ·
  one line change in `App.tsx`.
- **Safety boundaries unchanged:** `assembleObjective` parse → schema → satisfiability →
  sanitize pipeline is the sole trust boundary; the provider emits only raw text; no generated
  flag strings can reach the assembler; satisfiability is mandatory; text sanitization is
  mandatory; no objective text, object names, ids, hints, or provider body reaches logs;
  authored demo, fake objective, room validation/repair/fallback, and adjacent exclusion
  are all preserved.
- **Targeted tests:** prompt structural-only content; candidate predicate matches assembler
  gate; provider transport mocking; selector fake/real split; sanitized-error assertion.

---

## 5. Files touched by the implemented slices

**New files:**

- `apps/web/src/domain/quests/objectiveCandidates.ts` — `listInteractObjectiveCandidates` +
  `ObjectiveCandidate` type. Domain layer; no logger, no I/O.
- `apps/web/src/domain/quests/objectiveCandidates.test.ts`
- `apps/web/src/generation/llmObjectivePrompt.ts` — `buildObjectivePromptMessages` +
  `OBJECTIVE_SYSTEM_PROMPT` + `ObjectiveCandidate` re-export. Generation layer; no logger,
  no I/O, no env.
- `apps/web/src/generation/llmObjectivePrompt.test.ts`
- `apps/web/src/generation/OpenAICompatibleObjectiveGenerator.ts` — real provider.
  `OBJECTIVE_MAX_TOKENS`, `OBJECTIVE_TIMEOUT_MS` constants. Injected transport seam.
  Fixed-code throws: `objective-llm-request-failed`, `objective-llm-timeout`,
  `objective-llm-empty-response`.
- `apps/web/src/generation/OpenAICompatibleObjectiveGenerator.test.ts`
- `apps/web/src/app/selectObjectiveGenerator.ts` — `selectObjectiveGenerator(config: LlmConfig)`
  returning `{ generator, log }`.
- `apps/web/src/app/selectObjectiveGenerator.test.ts`

**Modified files:**

- `apps/web/src/App.tsx` — two lines only:
  - Replace `const objectiveGenerator = new FakeObjectiveGenerator()` with
    `const { generator: objectiveGenerator, log: objectiveGeneratorSelectionLog } = selectObjectiveGenerator(llmConfig)`
  - Add `logger.info('objective generator selected', objectiveGeneratorSelectionLog)` on the
    next line.
  - Add the new import for `selectObjectiveGenerator`.

---

## 6. Files NOT to touch

`domain/quests/assembleObjective.ts` · `domain/quests/generatedObjectiveSpec.ts` ·
`domain/quests/questSpec.ts` · `domain/quests/evaluateQuest.ts` ·
`domain/ports/ObjectiveGenerator.ts` · `domain/generatedRoomObjectiveTarget.ts` ·
`domain/generatedRoomObjectPurpose.ts` · `domain/assembleRoom.ts` · `domain/validateRoom.ts` ·
`domain/repairRoom.ts` · `domain/roomSpec.ts` · `domain/world/**` · reducers ·
`domain/world/saveGame.ts` · `domain/dialogue/contracts.ts` ·
`domain/examples/demoQuest.ts` / `throneRoom.ts` / `ruinedRoom.ts` ·
`generation/FakeObjectiveGenerator.ts` · `generation/FakeRoomGenerator.ts` ·
`generation/OpenAICompatibleRoomGenerator.ts` · `generation/llmRoomPrompt.ts` ·
`app/generatedObjective.ts` · `app/buildPromptGeneratedRoomSource.ts` ·
`app/llmConfig.ts` · `app/selectRoomGenerator.ts` ·
`app/exitGate.ts` · `app/gatedNavigation.ts` · `app/NavigationService.ts` ·
`dialogue/**` · `world-session/**` · `interactions/**` · `encounters/**` · `memory/**` ·
`persistence/**` · `server/**` · `renderer/engine/**` · `renderer/ui/**` ·
`room/GeneratedRoomSource.ts` · `eslint.config.js` · `package.json`.

---

## 7. Implementation slices

Each slice is independently shippable and independently testable. Do not merge slices.

---

**Slice 1 — Candidate predicate helper (pure, headless)**
`feat(domain): objective candidate lister for interact-object eligibility`

New files: `objectiveCandidates.ts`, `objectiveCandidates.test.ts`.

No wiring, no prompt, no provider. The helper is a pure domain function: reads only validated
`LoadedRoom.objects`, applies the same eligibility predicate as `assembleObjective`'s
`interact-object` satisfiability branch, and returns `ObjectiveCandidate[]` sorted by
story-anchor type priority.

Tests:
- Returns candidates matching `id != null && interaction.effect != null && interaction.encounter == null && type !== 'npc'`
- Excludes `npc`, `arch`, exit-carrying, and encounter-carrying objects
- Empty room → empty list; no eligible objects → empty list
- Ordering matches story-anchor priority: `altar > statue > corpse > machine/artifact > chest > table/map/book/paper`
- Type field is the closed `RoomObject['type']` enum value only

Verification: `npm run test -- objectiveCandidates`, `npm run lint`, `npm run build`

---

**Slice 2 — Pure prompt builder**
`feat(generation): objective prompt builder — structural digest only`

New files: `llmObjectivePrompt.ts`, `llmObjectivePrompt.test.ts`.

No network, no wiring. The builder is pure and side-effect-free: takes `ObjectiveCandidate[]`,
returns two `ChatMessage` objects (system + user). Imports `ObjectiveCandidate` from the
domain helper and `ChatMessage` from `llmRoomPrompt.ts`.

Tests:
- System message is static; does not include any content-bearing text
- User message is `JSON.stringify(candidates)` — valid JSON array
- User message contains only `objectId` and `type` fields — no room name, object name,
  interaction text, user prompt text, or generated descriptions
- Empty candidates list → valid JSON user message (`"[]"`)
- Deterministic for same candidates
- A room with a known candidate list produces an expected bounded message

Verification: `npm run test -- llmObjectivePrompt`, `npm run lint`, `npm run build`

---

**Slice 3 — Real provider**
`feat(generation): OpenAICompatibleObjectiveGenerator — real network-backed objective provider`

New files: `OpenAICompatibleObjectiveGenerator.ts`, `OpenAICompatibleObjectiveGenerator.test.ts`.

The provider mirrors `OpenAICompatibleRoomGenerator` structurally. Uses `OBJECTIVE_MAX_TOKENS
= 400` and `OBJECTIVE_TIMEOUT_MS = 12_000`. Injected transport seam for testability.

Fixed error codes: `objective-llm-request-failed`, `objective-llm-timeout`,
`objective-llm-empty-response`.

Tests:
- Returns content string verbatim on successful 2xx JSON response
- Returns `null` (not a throw) when `choices[0].message.content` is an empty string
- Throws `objective-llm-request-failed` on network error / fetch throw
- Throws `objective-llm-timeout` when `AbortController` fires
- Throws `objective-llm-request-failed` on non-2xx response status
- Throws `objective-llm-request-failed` when response body is not valid JSON
- **Sanitized-error assertion:** no thrown error message contains any substring of the
  injected API key, the room id, any object id, or the response body string
- Transport seam called exactly once per `generate` call
- `AbortController` signal passed to transport; timer cleared on success

Verification: `npm run test -- OpenAICompatibleObjectiveGenerator`, `npm run lint`, `npm run build`

---

**Slice 4 — Selector**
`feat(app): selectObjectiveGenerator — config-driven fake/real selection`

New files: `selectObjectiveGenerator.ts`, `selectObjectiveGenerator.test.ts`.

Mirrors `selectRoomGenerator`. Returns `{ generator: ObjectiveGenerator, log }`.

Tests:
- Returns real `OpenAICompatibleObjectiveGenerator` when `isRealProviderComplete` (provider set,
  key non-empty, model non-empty)
- Returns `FakeObjectiveGenerator` on incomplete config (missing provider / key / model)
- Log object for real selection contains `provider` enum and `model` only — never the API key
- Log object for fake selection is `{ provider: 'fake', reason: 'config-disabled' }`
- Constructing the real generator performs no I/O (safe to call at module load)

Verification: `npm run test -- selectObjectiveGenerator`, `npm run lint`, `npm run build`

---

**Slice 5 — App.tsx wiring**
`feat(app): wire real objective generator selection in composition root`

Modified file: `App.tsx` — one-line swap + one log line + one new import.

Tests (additions to existing App.tsx test file):
- When `isRealProviderComplete`, `objectiveGenerator` is an `OpenAICompatibleObjectiveGenerator`
  instance (type guard or duck-typed check via the injected transport seam)
- When config is incomplete, `objectiveGenerator` is a `FakeObjectiveGenerator` instance
- `logger.info('objective generator selected', ...)` is called with a log-safe object (no key)
- Existing test: when `buildGeneratedObjectiveAttachment` returns non-null with a real provider
  mock, the spec attaches and the tracker renders — same behavior as with the fake
- Existing test: when the real provider throws (mock), `buildGeneratedObjectiveAttachment`
  returns `null`, `questSpec` stays null, room renders normally
- Existing scoping tests: authored bootstrap and adjacent paths remain unaffected

Verification: `npm run test -- App`, `npm run lint`, `npm run build`

---

**Slice 6 — Docs closeout**
`docs: record real generated objective provider v0`

- Flip ADR-0049 status to Accepted / implemented 2026-06-28.
- Update ARCHITECTURE.md status legend (move from 🔜 Planned to ✅ Implemented;
  add "Real Generated Objective Provider v0 — generation + app composition" to the
  implemented list; add the new ✅ section body).
- Update AGENTS.md feature map.
- No source tests required for docs-only.

Verification: `git diff --check` only.

---

## 8. Test plan

### Mandatory

**`objectiveCandidates.test.ts`**
- Eligibility predicate (id present + effect present + no encounter + not npc) is consistent
  with `assembleObjective`'s `hasInteractionEffect` and `findObjectById` chain.
- Excludes `arch`, objects with `interaction.exit`, `npc`, objects with `interaction.encounter`,
  objects with no `interaction`, objects with no id.
- Ordering: `altar`-type candidates appear before `chest`, `chest` before `book`.
- Empty room, no-candidate room, and single-candidate room all return correct lists.
- Pure: no I/O, no `Date.now`, no `Math.random`.

**`llmObjectivePrompt.test.ts`**
- User message is valid JSON; parsed value is an array of `{ objectId, type }` objects.
- No content-bearing fields (no room name, object name, interaction title/body/prompt,
  room id, generated text, user prompt) appear in either message.
- System message is static (snapshot test acceptable given no user content).
- Empty candidates → `[]` in user message; system message unchanged.
- Deterministic.

**`OpenAICompatibleObjectiveGenerator.test.ts`**
- Transport mock receiving one call on `generate`.
- Returns verbatim string on 2xx + valid JSON + non-empty content.
- Returns `null` on 2xx + valid JSON + empty string content (not a throw).
- Throws `objective-llm-request-failed` when `transport` rejects (network error).
- Throws `objective-llm-timeout` when abort fires before response.
- Throws `objective-llm-request-failed` on non-2xx status.
- Throws `objective-llm-request-failed` when `response.json()` rejects.
- **Key safety:** injected `apiKey = 'test-secret-key'`; assert that no thrown error `.message`
  contains `'test-secret-key'`, any mocked room/object id, or response body text.
- Timer is cleared after success and after failure (no dangling timer).

**`selectObjectiveGenerator.test.ts`**
- Complete config (provider, key, model all set) → `OpenAICompatibleObjectiveGenerator`.
- Incomplete config (any of provider/key/model missing) → `FakeObjectiveGenerator`.
- Log object: real → `{ provider, model }` (two fields only); fake → `{ provider: 'fake', reason: 'config-disabled' }`.
- No network call during selection.

**App.tsx additions**
- Real provider mock: `generate` resolves with a valid `GeneratedObjectiveSpec` JSON string
  whose `objectId` matches the enriched target in the room → `questSpec` is set on `activePlay`
  → tracker renders.
- Real provider mock: `generate` rejects → `questSpec` is null → tracker absent → room renders
  normally.
- Selection log assertion: the logged object does not contain the API key string.

**Regression (unchanged tests that must still pass)**
- `assembleObjective.test.ts` — all existing cases, no change.
- `FakeObjectiveGenerator.test.ts` — all existing cases, no change.
- `generatedObjectiveSpec.test.ts` — all existing cases, no change.
- `generatedObjective.test.ts` — all existing cases, no change.
- `generatedRoomObjectiveTarget.test.ts` — all existing cases, no change.

### Log safety (all suites)
No test may assert the presence of text, names, generated JSON, hint content, or API key
strings in log output.

---

## 9. Manual smoke checklist

1. **Fake config (default, no env):** generated room produces the generic "Secure the room"
   fake objective title; no network call is made; quest tracker appears; NPC hint
   reads the fake authored text. Byte-identical to today.
2. **Complete real config (BYOK dev env):** prompt → real room (DeepSeek/OpenAI) →
   real objective call → quest tracker shows a theme-coherent objective title and description;
   NPC hint reflects the room's object types.
3. **Real objective times out / errors:** room still renders normally; no quest tracker;
   no error notice; no crash. Log shows only the fixed error code.
4. **Real provider returns malformed JSON or fenced JSON:** `assembleObjective` parse-fails;
   `questSpec` is null; room plays normally; diagnostics are code-only.
5. **Hallucinated objectId (fake via transport mock):** `assembleObjective` satisfiability drop;
   `questSpec` is null; room plays normally.
6. **Authored bootstrap:** no objective generator call. Demo quest tracker shows the authored
   spec as normal; nothing changes.
7. **Adjacent room navigation:** navigating to an adjacent room does not trigger an objective
   call. No tracker/hint appear for adjacents.
8. **Logs:** `objective generator selected { provider: 'deepseek', model: '...' }` appears;
   no prompt text, no room name, no object ids, no hint text, no API key in logs.
9. **Usage meter:** counter increments once per prompt (room call only); does not increment
   for the objective call.

---

## 10. Known limitations (document, do not fix in this slice)

- **Blocking latency:** the objective call (up to 12 s) delays room render on the real path.
  Async attach is the future improvement.
- **Two real calls per prompt:** room + objective; usage guard counts one attempt only.
- **interact-object only:** `resolve-encounter` and `visit-room` condition kinds are not
  generated; they require their own enrichment guarantee (future slice).
- **No fence stripping / repair:** if the model emits a fenced JSON block, `assembleObjective`
  will parse-fail and return `null`. A fence-stripping normalizer is deferred.
- **Save/load transience (inherited from ADR-0047):** the generated `QuestSpec` and hints are
  lost on save/load. Progress flags survive; tracker and hint do not reappear.
- **Dev-only BYOK (inherited from ADR-0023):** a real-key bundle must not be deployed.
