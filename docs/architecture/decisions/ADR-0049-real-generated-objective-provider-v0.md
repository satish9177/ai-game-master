# ADR-0049: Real Generated Objective Provider v0 — real LLM objective proposal behind the unchanged ObjectiveGenerator port

- **Status:** Accepted / implemented 2026-06-28
- **Date:** 2026-06-28
- **Deciders:** Project owner
- **Extends:** [ADR-0047](./ADR-0047-generated-story-objective-contract-v0.md) (generated story
  objective contract — the `ObjectiveGenerator` port, `assembleObjective`, and
  `FakeObjectiveGenerator`),
  [ADR-0048](./ADR-0048-generated-room-objective-target-enrichment-v0.md) (objective-target
  enrichment — ensures real-LLM rooms carry one objective-ready object),
  [ADR-0023](./ADR-0023-real-room-generator-provider-v0.md) (real room generator provider — the
  exact pattern this ADR mirrors)
- **Related:** [ADR-0028](./ADR-0028-demo-quest-loop-v0.md) (quest as derived lens),
  [ADR-0001](./ADR-0001-data-only-room-spec-trusted-renderer.md) (data-only generation contract),
  [ADR-0003](./ADR-0003-logging-abstraction.md) (logging redaction)

> Implemented from the pre-code design in the implementation plan
> [`real-generated-objective-provider-v0`](../implementation-plans/real-generated-objective-provider-v0.md).

## Context

ADR-0047 (Generated Story Objective Contract v0) delivered `assembleObjective` — a pure,
total, throw-free assembler that converts a raw `string | null` from any `ObjectiveGenerator`
into a trusted `QuestSpec | null`. It also shipped `FakeObjectiveGenerator`: a deterministic
fake source behind the new `ObjectiveGenerator` port that returns a valid, authored-text
proposal string referencing the first eligible object in the room.

ADR-0048 (Generated Room Objective Target Enrichment v0) closed the prerequisites gap: it
promotes exactly one eligible object in real-LLM rooms to objective-ready (stable id +
`effect: { kind: 'inspect' }`), so `assembleObjective`'s satisfiability gate can pass for
real-LLM output.

After both ADRs are implemented, the prompt-generated room path looks like this:

```
prompt
  ├─ real LLM room provider → real room (DeepSeek / OpenAI)
  │     → assembleRoom(..., { enrichObjectiveTarget: true })  ← ADR-0048: promotes 1 target
  │     → LoadedRoom (provenance: 'generated')
  │
  └─ FakeObjectiveGenerator.generate(room) → authored proposal JSON  ← STILL FAKE
        → assembleObjective(raw, room) → QuestSpec (valid, but authored text)
              → quest tracker / NPC hint
```

The gap: real-LLM rooms now carry a guaranteed objective-ready target, but the objective text
("Secure the room", "Investigate the marked feature.") is still deterministic, generic, authored
text from `FakeObjectiveGenerator`. The objective title, description, hint, and completion hint
cannot reflect the actual room theme, because the fake never sees or uses room content.

A real objective call closes this gap: the model receives a minimal structural digest of the
room's eligible target objects and proposes a `GeneratedObjectiveSpec` JSON that names one of
them. `assembleObjective` validates the proposal and checks satisfiability, exactly as it does
for the fake's output — no assembly or validation change is needed.

## Decision

Ship a real, network-backed `ObjectiveGenerator` — `OpenAICompatibleObjectiveGenerator` —
behind the **unchanged `ObjectiveGenerator` port**. The pattern is a near-exact mirror of
ADR-0023's `OpenAICompatibleRoomGenerator`: one generic adapter for any OpenAI-compatible
chat-completions endpoint, injected transport seam, one non-streaming POST, hard timeout, no
retry, verbatim raw text returned.

```
prompt (real LLM config complete)
  │
  ├─ real room provider → assembled LoadedRoom  (UNCHANGED; ADR-0048 enriches 1 target)
  │
  └─ selectObjectiveGenerator(llmConfig)
       → OpenAICompatibleObjectiveGenerator
            ├─ listInteractObjectiveCandidates(room)   → [{objectId, type}, ...]  (structural only)
            ├─ buildObjectivePromptMessages(candidates) → system + user chat messages
            ├─ POST /chat/completions (one call, hard 12 s timeout, no retry)
            └─ choices[0].message.content verbatim  (or null / throw fixed code)
                  │
                  └─ buildGeneratedObjectiveAttachment (try/catch → null)   UNCHANGED
                        └─ assembleObjective(raw, room)   UNCHANGED (the gate)
                              ├─ parse → schema → satisfiability → sanitize → QuestSpec
                              └─ QuestSpec | null
```

**`assembleObjective` is the only trust and satisfiability gate.** It does not change. A
hallucinated `objectId`, garbage JSON, schema violations, or an unsatisfiable condition all
return `null`; `buildGeneratedObjectiveAttachment` already wraps the full call in `try/catch`
and returns `null` on any throw. Any failure path leaves the room playing normally with no
tracker and no hint — identical to today's behavior when the fake produces no eligible object.

### 1. Same port, no new port

`ObjectiveGenerator` (`domain/ports/ObjectiveGenerator.ts`) is unchanged:

```ts
interface ObjectiveGenerator {
  generate(room: LoadedRoom): Promise<string | null>
}
```

`OpenAICompatibleObjectiveGenerator implements ObjectiveGenerator`. The real provider and the
fake are interchangeable at the composition root; no downstream code changes.

### 2. Reuse existing `LlmConfig` — no new env variables

`selectObjectiveGenerator(config: LlmConfig)` mirrors `selectRoomGenerator(config)`:

- Reuses `isRealProviderComplete(config)` — the same completeness gate
  (`provider ∈ {openai, deepseek}` + non-empty key + non-empty model).
- Reuses `REAL_PROVIDER_BASE_URLS` for the per-provider base URL.
- Returns `{ generator, log }` where `log` is log-safe (provider enum + model, never key).

The same `VITE_AIGM_LLM_PROVIDER`, `VITE_OPENAI_API_KEY` / `VITE_DEEPSEEK_API_KEY`, and
`VITE_AIGM_LLM_MODEL` env variables that select the real room provider also select the real
objective provider. No new `VITE_*` variables are introduced.

**Dedicated smaller caps (not from config):** room generation is capped by `config.maxTokens`
(default 2000) and `config.timeoutMs` (default 25 s). A `GeneratedObjectiveSpec` JSON is
roughly 300–500 characters; the objective provider uses its own fixed, smaller constants:

```ts
export const OBJECTIVE_MAX_TOKENS = 400
export const OBJECTIVE_TIMEOUT_MS = 12_000  // 12 s hard cap
```

These are module-level constants in `OpenAICompatibleObjectiveGenerator.ts` and are applied
regardless of `config.maxTokens`/`config.timeoutMs`. The shorter timeout bounds added latency
before the room renders (v0 is blocking; see §6).

### 3. Pure prompt builder — closed structural digest only

A pure, side-effect-free module `generation/llmObjectivePrompt.ts`:

```
buildObjectivePromptMessages(candidates: ObjectiveCandidate[]): ChatMessage[]
  → [{ role: 'system', content: OBJECTIVE_SYSTEM_PROMPT },
     { role: 'user',   content: JSON.stringify(candidates) }]

ObjectiveCandidate = { objectId: string; type: string }
```

**What goes in the prompt:** only the closed structural digest of eligible objects —
`listInteractObjectiveCandidates(room)` projected to `{ objectId, type }` pairs. The `type`
field is a closed `RoomObject['type']` enum value (e.g. `"altar"`, `"chest"`, `"book"`). No
room name, object name, interaction prompt/title/body, generated description, user prompt, hint
text, or raw room JSON is included.

**`OBJECTIVE_SYSTEM_PROMPT`** (static, bounded, authored):

> You are generating a story objective for a 3D game room.
> You are given a list of eligible target objects, each with an `objectId` and a `type`.
> Output ONLY a JSON object. No prose, no explanation, no markdown, no code fences.
>
> Shape:
> `{ "title": string (≤80 chars), "description": string (≤160 chars),
>    "hint": string (≤160 chars), "completionHint": string (≤160 chars),
>    "condition": { "kind": "interact-object", "objectId": string } }`
>
> Rules:
> - `objectId` MUST be exactly one of the provided `objectId` values. Do not invent an id.
> - `kind` is always `"interact-object"` in this context.
> - No extra keys. No flag-key strings (never emit strings starting with "interaction:" or "encounter:").
> - `title` is the name of the objective (≤80 chars). `description` is what the player must do (≤160 chars).
> - `hint` is a clue an NPC might give while the objective is active (≤160 chars).
> - `completionHint` is a line an NPC might say after completion (≤160 chars).
> - Match the tone of the room's object types.

The user message is `JSON.stringify(candidates)` — a bounded JSON array, clamped to avoid
unbounded user text. No seed string, no user prompt text, no room name.

**Candidate count cap:** `listInteractObjectiveCandidates` returns at most the top-ranked
candidates by the existing story-anchor type priority (`altar > statue > corpse >
machine/artifact > chest > table/map/book/paper`). In practice ADR-0048 enrichment typically
yields one or two candidates; the cap guards against an unlikely degenerate room.

### 4. Shared `listInteractObjectiveCandidates` helper — predicate consistency

A pure domain helper in `domain/quests/objectiveCandidates.ts`:

```ts
listInteractObjectiveCandidates(room: LoadedRoom): ObjectiveCandidate[]
```

Returns the same set of objects that `assembleObjective`'s satisfiability gate would accept for
`interact-object`: objects where `id != null`, `interaction.effect != null`,
`interaction.encounter == null`, and `type !== 'npc'`.

This helper is used by `buildObjectivePromptMessages` to build the real-provider digest.
`FakeObjectiveGenerator` remains unchanged in v0 and keeps its local eligibility check; extracting
that fake predicate to share the helper is deferred. The safety gate is still
`assembleObjective`: if a candidate is absent or the model hallucinates an id, satisfiability
fails and returns `null`.

### 5. `OpenAICompatibleObjectiveGenerator` — network details

Structurally identical to `OpenAICompatibleRoomGenerator`:

- One non-streaming `POST {baseUrl}/chat/completions` with an injected `LlmTransport` seam.
- Hard `AbortController` timeout using `OBJECTIVE_TIMEOUT_MS`.
- `timedOut` flag disambiguates abort from other transport rejection.
- Returns `choices[0].message.content` verbatim as `string` on success, or `null` if content
  is present but empty (indicating the model produced nothing useful — treated as "no objective"
  rather than a hard failure).
- Throws a **fixed-shape `Error`** with one of three safe codes on hard failure:
  `objective-llm-request-failed` / `objective-llm-timeout` / `objective-llm-empty-response`.
- Does **not** parse, validate, strip fences, or repair the output. The string is raw and
  untrusted, exactly like the fake's string, and flows through the unchanged `assembleObjective`
  trust boundary.
- Imports no logger, reads no env, logs nothing. Errors are fixed codes only — never the API
  key, request body, response body, generated text, or raw provider error.

`buildGeneratedObjectiveAttachment` already wraps the entire call in `try/catch` and maps any
throw to `null`, so every failure path (timeout, network, non-2xx, empty, bad JSON from model)
cleanly degrades to no quest.

### 6. Composition wiring — minimum App.tsx change

Current App.tsx line 81:
```ts
const objectiveGenerator = new FakeObjectiveGenerator()
```

Replacement (two lines):
```ts
const { generator: objectiveGenerator, log: objectiveGeneratorSelectionLog } =
  selectObjectiveGenerator(llmConfig)
logger.info('objective generator selected', objectiveGeneratorSelectionLog)
```

The selection log carries `{ provider, model }` for real (never the key) or
`{ provider: 'fake', reason: 'config-disabled' }`. No other App.tsx change.

**Blocking objective call (v0):** the objective call is awaited before `enterActivePlay`, same
as today's fake call. With the real provider this adds up to 12 s of latency before the room
renders. This is a documented known limitation; async objective attach is deferred.

**No separate usage meter:** one prompt = one logical attempt = at most two real calls (room +
objective). The existing `recordAttempt` guard counts only the room call. An objective-specific
meter is deferred.

### 7. `interact-object` only in v0

The prompt requests `kind: "interact-object"` exclusively. ADR-0048 enriches only
`interact-object`-eligible objects, so this is the only satisfiable kind for real-LLM rooms.
`resolve-encounter` and `visit-room` generation are deferred to a future slice that would need
its own enrichment guarantee.

`assembleObjective` already handles all three condition kinds — this restriction lives in the
prompt only, not in the assembler.

### 8. Prompt-generated first rooms only; adjacent rooms excluded

The `result.provenance === 'generated'` gate in `App.tsx` (line 385) already guards objective
attachment. Adjacent pregeneration never produces `provenance === 'generated'` on the main
path and never runs `buildGeneratedObjectiveAttachment`. Authored bootstrap sets `demoQuestSpec`
directly and does not run the objective pipeline. Nothing changes here.

### 9. Fail-safe table

| Situation | Detection | Handling | Logging |
| --- | --- | --- | --- |
| Incomplete config (provider/key/model) | `selectObjectiveGenerator` → `isRealProviderComplete` | select `FakeObjectiveGenerator`; offline, no network call | `provider:'fake'`, `reason:'config-disabled'` |
| Network error / non-2xx | `OpenAICompatibleObjectiveGenerator` | throw `objective-llm-request-failed` → `buildGeneratedObjectiveAttachment` catch → `null` | fixed code via caller (see below) |
| Hard timeout (abort) | `AbortController` (12 s) | throw `objective-llm-timeout` → catch → `null` | fixed code via caller |
| Empty / missing `choices[0].message.content` | content check | return `null` (no throw); caller maps to `null` | — |
| Malformed / non-JSON model output | unchanged `assembleObjective` stage 1 | `parse-failed` → `null`; room plays normally | assembler diagnostics (code only) |
| Schema-invalid / extra keys / flag-key string | `assembleObjective` stage 2 | `schema-invalid` → `null` | assembler diagnostics (code only) |
| Hallucinated or ineligible `objectId` | `assembleObjective` stage 3 satisfiability | `condition-unsatisfiable` → `null` | assembler diagnostics (code only) |
| Valid, satisfiable proposal | `assembleObjective` stage 5 | `QuestSpec` attached; tracker + NPC hint appear | `objectiveAttached: true`, `conditionKind` enum |

The `buildGeneratedObjectiveAttachment` `try/catch` is the final net: any unexpected throw from
the provider also maps to `null`. A safe optional composition-root log line
(`objective generator attached: { attached: boolean, conditionKind }`) may be added using
diagnostics data from `assembleObjective` — but never the raw output, generated text, or object
ids.

### Boundaries

All new and modified code lives inside existing lint blocks:

- `generation/OpenAICompatibleObjectiveGenerator.ts` — under `generation/**`. Imports only
  domain types, the injected transport types (mirrored from the room generator). No logger, no
  env, no React, no Three.js.
- `generation/llmObjectivePrompt.ts` — same lint block. Pure: no I/O, no logger, no env.
- `app/selectObjectiveGenerator.ts` — under `app/**`. Imports `LlmConfig`,
  `isRealProviderComplete`, `REAL_PROVIDER_BASE_URLS` from `app/llmConfig`, and the two
  generators. No logger import (selection logging happens at the call site in `App.tsx`).
- `domain/quests/objectiveCandidates.ts` — under `domain/**`. Imports only domain types.
  Pure: no logger, no I/O, no `Date.now`, no `Math.random`.
- `App.tsx` — composition root; all current imports already allowed.

No new lint block. No `eslint.config.js` change. No new layer. No new dependency. No new
`VITE_*` env variable.

### Tests

Pure Vitest, co-located, no new dependencies, no DOM framework, no real network.

- `llmObjectivePrompt.test.ts` — digest contains only `objectId`/`type` pairs; never object
  names, interaction text, room name, user prompt, or generated descriptions; user message is
  valid JSON; system prompt is static and bounded; empty candidates list produces a safe
  well-formed message; deterministic for same candidates.
- `objectiveCandidates.test.ts` — eligibility matches `assembleObjective`'s satisfiability
  predicate (id present + effect present + no encounter + not npc); excludes arch/exit/encounter
  objects; excludes npc; top-ranked candidates appear first by type priority; empty room →
  empty list; room with no eligible objects → empty list.
- `OpenAICompatibleObjectiveGenerator.test.ts` — returns content string verbatim on 2xx JSON;
  returns `null` on empty content (not a throw); throws `objective-llm-request-failed` on
  network error; throws `objective-llm-timeout` on abort; throws `objective-llm-request-failed`
  on non-2xx; throws `objective-llm-request-failed` on non-JSON body; **sanitized error check**:
  no thrown error message contains any substring of the injected API key, room id, object id,
  or response body; transport seam injected and called once.
- `selectObjectiveGenerator.test.ts` — real provider returned when config complete; fake
  returned on incomplete config (missing provider / key / model); log object is provider enum +
  model only (never key); fake log is `{ provider:'fake', reason:'config-disabled' }`.

Existing tests unchanged: `assembleObjective.test.ts`, `FakeObjectiveGenerator.test.ts`,
`generatedObjectiveSpec.test.ts`, `generatedObjective.test.ts`, `generatedRoomObjectiveTarget.test.ts`.

### Log safety

Logs may include: provider enum, model id, `objectiveAttached` boolean, `conditionKind` enum,
`objectiveDropped` boolean, fixed error codes.

Logs must never include: API key, raw provider response body, raw provider request body,
generated JSON, objective title/description/hint/completionHint text, object names, object ids,
room name, room id as content, user prompt text, world-bible text, or any narrative content.

The provider imports no logger. Error throws carry only fixed safe codes. A unit test asserts
that no thrown message contains a substring of the injected key, room id, object id, or body.

### What is deliberately not changed

`domain/quests/assembleObjective.ts` · `domain/quests/generatedObjectiveSpec.ts` ·
`domain/quests/questSpec.ts` · `domain/quests/evaluateQuest.ts` ·
`domain/ports/ObjectiveGenerator.ts` · `domain/generatedRoomObjectiveTarget.ts` ·
`domain/generatedRoomObjectPurpose.ts` · `domain/assembleRoom.ts` · `domain/validateRoom.ts` ·
`domain/repairRoom.ts` · `domain/roomSpec.ts` · `domain/world/**` · reducers ·
`domain/world/saveGame.ts` · `domain/examples/demoQuest.ts` / `throneRoom.ts` / `ruinedRoom.ts` ·
`generation/FakeObjectiveGenerator.ts` (now the fallback; unchanged) ·
`generation/FakeRoomGenerator.ts` · `generation/OpenAICompatibleRoomGenerator.ts` ·
`generation/llmRoomPrompt.ts` · `app/generatedObjective.ts` ·
`app/buildPromptGeneratedRoomSource.ts` · `app/llmConfig.ts` · `app/selectRoomGenerator.ts` ·
`app/exitGate.ts` · `app/gatedNavigation.ts` · `app/NavigationService.ts` ·
`world-session/**` · `interactions/**` · `encounters/**` · `dialogue/**` · `memory/**` ·
`persistence/**` · `server/**` · `renderer/engine/**` · `renderer/ui/**` ·
`world-session/saveGame.ts` · `eslint.config.js` · `package.json`.

## Consequences

- **Real-LLM rooms get theme-coherent objectives.** A DeepSeek/OpenAI room now gets an
  objective title, description, hint, and completion hint that reflect the room's actual object
  types — not generic authored text. The quest tracker and NPC hint appear with real content.
- **Fake rooms byte-identical.** The fake is selected when config is incomplete; its output is
  unchanged. All existing fake-path tests pass without modification.
- **`assembleObjective` not weakened.** Its parse → schema → satisfiability → sanitize pipeline
  is unchanged. The real provider's output is subject to exactly the same gates as the fake's.
- **Hallucinated ids fail safely.** If the model names an `objectId` not in the room,
  `assembleObjective` returns `null`; the room plays normally. `listInteractObjectiveCandidates`
  feeding the prompt minimizes this risk by constraining the model to valid ids.
- **No generated executable code, no generated flag strings.** The model names an `objectId`;
  the trusted assembler derives `interaction:<objectId>`. The model cannot emit `interaction:*`
  strings directly (the schema strips them and the system prompt forbids them).
- **Blocking latency (known limitation v0).** The room render is delayed by the objective call
  (up to 12 s on the real path). Async objective attach is the documented deferred improvement.
- **Two real calls per prompt (known limitation v0).** Room + objective. The existing usage
  guard counts one attempt. A separate objective usage meter is deferred.
- **Dev-only / BYOK caveat (unchanged from ADR-0023).** `VITE_*` keys are inlined into the
  built bundle; v0 is local-dev only. Hosted production moves both providers server-side later.
- **Transience (inherited from ADR-0047).** Generated `QuestSpec` and hints are not persisted.
  Progress flags survive save/load; the tracker/hint do not reappear after reload.
- **No generated gates or persistence.** Objectives observe existing interaction flags only.
  They do not create generated mechanical gates, navigation locks, quest-engine behavior,
  save-game fields, RoomSpec/schema fields, world events, reducers, backend routes, or
  persistence changes.
- **Deferred:** async/non-blocking objective attach; separate objective usage meter; shared
  predicate extraction between `FakeObjectiveGenerator` and `objectiveCandidates`; generated
  mechanical gates; a quest engine; multi-step/chained objectives; objective persistence;
  richer provider/router support; fence-stripping; server-side provider.
