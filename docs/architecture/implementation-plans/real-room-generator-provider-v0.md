# Implementation Plan — `feature/real-room-generator-provider-v0`

> Status: **implemented.** All three slices landed as planned; the decision is
> recorded in [ADR-0023](../decisions/ADR-0023-real-room-generator-provider-v0.md).
> Commits are made manually by the maintainer; agents do not commit.
>
> Companion docs: [ARCHITECTURE](../ARCHITECTURE.md) ·
> [BOUNDARIES](../BOUNDARIES.md) · [FAILURE-MODES](../FAILURE-MODES.md) ·
> [CONVENTIONS](../CONVENTIONS.md). Roadmap context:
> `world-bible-seed-v0` ([ADR-0022](../decisions/ADR-0022-world-bible-seed-v0.md)),
> `room-generation-repair-fallback-v0` ([ADR-0020](../decisions/ADR-0020-room-generation-repair-fallback-v0.md)),
> `adjacent-room-pregeneration-v0` ([ADR-0021](../decisions/ADR-0021-adjacent-room-pregeneration-v0.md)).
>
> Implementation note: the source matched this plan, with one deliberate addition —
> a hard `MAX_SEED_CHARS` clamp in `llmRoomPrompt.ts` as a defensive bound above the
> ≤160-char prompt-path seed, so even a raw-prompt fallback seed cannot send
> unbounded user text to the model.

## Goal

Add the **first real LLM-backed `RoomGenerator`** behind the existing
`RoomGenerator` port, while preserving every safety boundary. The real provider
produces **raw model text only**, which still flows through the unchanged
`GeneratedRoomSource → assembleRoom → repairRoom/fallbackRoom` pipeline, so no
unsafe generated content can reach the renderer.

v0 supports **`fake` / `openai` / `deepseek`** through **one** generic
OpenAI-compatible HTTP generator using **raw `fetch`** (no SDK). `FakeRoomGenerator`
remains the default. The real provider is **opt-in only** and **local-dev / BYOK
only**. **Anthropic is deferred** to a follow-up (its Messages API is not
OpenAI-compatible).

---

## 1. Current prompt-to-room flow

The prompt path lives entirely in the composition root and the generation seam;
the renderer/engine are untouched by it.

```
PromptBar.onSubmit(trimmedPrompt)                         app/PromptBar.tsx
  → App.handlePrompt(prompt)                              App.tsx
       logger.info('prompt submitted', { promptLength })  // length only
       → prepareGeneratedRoomSeed(prompt, seeder, logger) app/worldBible.ts
            → FakeWorldBibleSeeder.seed(prompt) → WorldBibleSeed (validated)
            → worldBibleToGeneratorSeed(bible)  → compact seed (≤160 chars, title-first)
            └ failure → raw prompt as seed, no worldBible
       → new GeneratedRoomSource(generator, seed, logger, fallbackRoom)   room/
            → generator.generate(seed)          → raw untrusted JSON text generation/FakeRoomGenerator.ts
            → assembleRoom(rawText, fallbackRoom)
                 JSON.parse → loadRoomSpec → validateRoom → repairRoom → re-validate → fallback
            → { ok:true, room, provenance }      generated | repaired | fallback
       → startRoomSession(result.room) → setActivePlay(...) → notice if repaired|fallback
```

Facts this plan relies on:

- `App.tsx` constructs **one** module-level `const generator = new FakeRoomGenerator()`,
  used in **two** places: the `AdjacentRoomPregenerator` `createSource` closure
  (`(roomId) => new GeneratedRoomSource(generator, 'adjacent:'+roomId, ...)`) and
  `App.handlePrompt`'s `GeneratedRoomSource`.
- The `RoomGenerator` port is `generate(prompt: string): Promise<string>` — **raw,
  untrusted JSON text** (`domain/ports/RoomGenerator.ts`).
- The PromptBar/world-bible path is a **fresh single-room session + fresh cache,
  no navigation and no warming**.
- There is **no env/config layer in browser code today**: `src/server` uses
  `process.env`; nothing under `src/**` browser code reads `import.meta.env`.
- `generation/**` may import the domain + PRNG and may use the `fetch` global, but
  (per ESLint `no-restricted-imports`) **must not** import `react`/`react-dom`,
  `three`, `renderer/**`, `platform/**` (including the logger), `**/persistence/**`,
  `**/server/**`, `node:sqlite`, or `node:http`.

## 2. Current generation safety boundary

- `RoomGenerator.generate(seed)` returns **raw, untrusted text**; it is data,
  never executed.
- `GeneratedRoomSource` (`room/`, composition layer) is the only adapter: a
  generator **throw/reject → `unavailable`** (the retry screen); any **returned
  text → `assembleRoom`**, which *always* yields a valid, zero-fatal `LoadedRoom`
  (`generated` / `repaired` / `fallback`). **Bad content never becomes
  `unavailable`** — only infrastructure failure does.
- Logs carry provenance/stage/fixed codes/counts/booleans only — never raw JSON,
  prompt/seed text, story text, object names, or keys. On the `unavailable` path
  the source logs `error: describeError(err)`, i.e. **`err.message`**.

This is the contract the real provider must slot behind **without moving anything**.

## 3. Meaning of "real room generator provider" in v0

One **opt-in** generic generator, `OpenAICompatibleRoomGenerator`, implementing
the unchanged `RoomGenerator` port. It:

- builds a **compact, bounded** prompt from the seed it already receives,
- makes **one** non-streaming chat-completion `POST` (`fetch`) to an
  OpenAI-compatible endpoint (OpenAI or DeepSeek),
- returns the model's **raw text completion verbatim** as `Promise<string>`,
- is selected by the composition root **only** when `provider + matching key +
  model` are all present; otherwise `FakeRoomGenerator`.

Everything downstream is unchanged: the text flows through
`GeneratedRoomSource → assembleRoom → repair/fallback`; provider failure surfaces
as the existing `unavailable` retry path.

## 4. Final decisions (locked)

1. v0 supports **`fake` / `openai` / `deepseek`** only. **Anthropic deferred** to
   a follow-up (non-OpenAI-compatible wire shape; out of v0 scope).
2. **Raw `fetch`** with an **injected transport seam**; **no SDK dependency**.
3. **One** generic `OpenAICompatibleRoomGenerator` serves both OpenAI and DeepSeek;
   they differ only by base URL + key + model.
4. `FakeRoomGenerator` **remains the default**.
5. Real provider is selected **only** when `provider ∈ {openai, deepseek}` **and**
   the matching key is non-empty **and** `model` is non-empty (all trimmed).
   Any incomplete config → `FakeRoomGenerator` with safe reason `config-disabled`.
6. Real provider affects the **PromptBar-generated room path only**.
7. `AdjacentRoomPregenerator` **stays fake** — background warming makes no network
   calls and never spends.
8. Provider output is **raw text only** — **no** parsing, validation, fence
   stripping, or structured output in the provider.
9. `GeneratedRoomSource → assembleRoom → repairRoom/fallbackRoom` is **unchanged**.
10. Browser-direct **BYOK is local-dev only**. `VITE_*` keys are **inlined into
    Vite browser builds**. **Never deploy a built browser bundle containing a real
    key.** Hosted production must move the provider **server-side later**.
11. **One** model call, **no retry**, **hard timeout**.
12. Use **`max_tokens`** in v0; document the newer-OpenAI `max_completion_tokens`
    caveat (configure the model accordingly).

## 5. Non-goals

This slice must **not**:

- Add **Anthropic**, a **multi-provider router**, a **cross-provider fallback
  chain**, or a **cost optimizer**.
- Add **streaming/WebSocket**, a **backend generation endpoint**, a browser→Node
  **API client / CORS**, hosted deploy, or any **SDK dependency**.
- Add an **LLM reviewer**, a **bounded multi-attempt repair/re-prompt loop**, or
  **structured outputs / fence stripping** in the provider.
- Change the **`RoomGenerator` / `RoomSource` ports**, `FakeRoomGenerator`,
  `GeneratedRoomSource`, `assembleRoom` / `repairRoom` / `validateRoom` /
  `fallbackRoom`, the **renderer / `RoomViewer` / engine / builders**, or add UI.
- Wire the real provider into **`AdjacentRoomPregenerator`** or the **authored
  bootstrap**, or make the real provider the **default**.
- Wire **persistence / API / SQLite**, or change `world-session` authority.
- **Log** the API key, raw prompt, world-bible text, derived seed, provider
  request body, provider response body, generated JSON, or error details.

## 6. Chosen option and placement

**Option C — factory + fake default + opt-in real provider, browser-direct,
generic OpenAI-compatible HTTP via raw `fetch`, dev-only BYOK.** (Considered and
rejected: **A** plain browser-direct without a factory; **B** a backend endpoint
— no browser→Node path exists today, much larger scope; **D** defer.)

| Piece | Location |
| --- | --- |
| `OpenAICompatibleRoomGenerator` (generic, provider-agnostic) | `apps/web/src/generation/OpenAICompatibleRoomGenerator.ts` |
| Pure prompt builder | `apps/web/src/generation/llmRoomPrompt.ts` |
| Env → typed config + provider→base-URL map + completeness check | `apps/web/src/app/llmConfig.ts` |
| `selectRoomGenerator(config, …)` (fake default; real only when complete) | `apps/web/src/app/selectRoomGenerator.ts` |
| Live generator instances | composition state in `App.tsx` (`promptGenerator`, `adjacentGenerator`) |

- The generator lives in **`generation/`** behind the unchanged port and is the
  **first generation-layer module that performs I/O** — by design
  (`ARCHITECTURE.md` already marks "🔜 real LLM adapters" here; the fakes were
  pure, real adapters do network I/O). It uses the `fetch` global, **imports no
  logger, and reads no env**; config + an optional transport seam are injected by
  constructor.
- **`app/`** reads `import.meta.env`, maps provider → base URL, checks
  completeness, and constructs the generator. `GeneratedRoomSource` is untouched
  and keeps all safe logging.
- New files under `generation/**` and `app/**` are already covered by the existing
  ESLint boundary blocks — **no new lint rule is needed** (mirrors ADR-0020/0021/0022).

## 7. Provider configuration rules

- Env is read **only** in `app/llmConfig.ts`; `generation/` receives a plain
  config object.
- **Shared config:**
  - `VITE_AIGM_LLM_PROVIDER` — `fake` (or unset) | `openai` | `deepseek`.
  - `VITE_AIGM_LLM_MODEL` — required for real selection.
  - `VITE_AIGM_LLM_MAX_TOKENS` — bounded output cap (default e.g. `2000`).
  - `VITE_AIGM_LLM_TIMEOUT_MS` — hard request timeout (default e.g. `25000`).
- **Provider-specific keys:**
  - `VITE_OPENAI_API_KEY`
  - `VITE_DEEPSEEK_API_KEY`
  - (`VITE_ANTHROPIC_API_KEY` reserved for the Anthropic follow-up; unused in v0.)
- **Base URL** is a built-in per-provider default (no base-URL env var in v0):
  - `openai → https://api.openai.com/v1`
  - `deepseek → https://api.deepseek.com/v1`
- **Selection completeness:** real provider selected **iff** `provider ∈
  {openai, deepseek}` **and** the matching key is non-empty **and** `model` is
  non-empty (all trimmed). Any incomplete state → `FakeRoomGenerator`, safe reason
  `config-disabled`. The real provider is **never default**.
- Ship a committed **`.env.example`** with placeholders only. Real values live in
  a gitignored `.env.local`. Documented dev-only.

## 8. Provider behavior (request / transport / timing)

OpenAI-compatible chat completion, one call, no retry:

```
POST {baseUrl}/chat/completions
Authorization: Bearer <key>
Content-Type: application/json

{ "model": <model>,
  "messages": [ { "role": "system", "content": <SYSTEM> },
                { "role": "user",   "content": <seed> } ],
  "max_tokens": <maxTokens>,
  "stream": false }
```

- Response: read `choices[0].message.content` (a string) and return it **verbatim**.
- **Transport seam:** the constructor takes the injected config
  (`baseUrl, apiKey, model, maxTokens, timeoutMs`) plus an **optional transport
  function** that defaults to a `fetch` + `AbortController` implementation. Tests
  pass a fake transport so no network is touched.
- **Timeout:** hard client timeout via `AbortController` (`timeoutMs`). One
  attempt; **no retry** (bounded latency/spend; satisfies "no fallback chain / no
  cost optimizer").
- **Token field caveat:** v0 sends `max_tokens`. Some newer OpenAI models require
  `max_completion_tokens` instead; configure `VITE_AIGM_LLM_MODEL` to a chat model
  that accepts `max_tokens`. The field mapping is a documented follow-up, not v0
  scope.

## 9. Prompt construction rules

- Compact, bounded, in pure `generation/llmRoomPrompt.ts` (so its bounds are
  unit-testable).
- System message instructs: emit **only** a JSON `RoomSpec` — no prose, no
  markdown fences, no code — using the published vocabulary
  (`throne/pillar/rug/torch/arch/scroll/npc/prop`, plus the post-apocalyptic set),
  the `shell` / `spawn` / `lighting` / `exits` shape, and the conventions (Y-up,
  meters, −Z north, degrees, `#rrggbb`).
- User message = the already-bounded seed (≤160 chars on the prompt path).
- Bounded `max_tokens`, `stream: false`, single attempt, hard timeout.
- No prompt/seed text is ever logged.

## 10. Output handling rules

- The provider returns `choices[0].message.content` **verbatim** as
  `Promise<string>`. It does **not** parse, validate, repair, fence-strip, or use
  structured output.
- The string stays **untrusted** until `assembleRoom`
  (`JSON.parse → loadRoomSpec → validateRoom → repairRoom → fallback`). Bad or
  hostile output is just data that repairs or falls back — the existing trust
  boundary is the only safety net, and it is sufficient.

## 11. Failure / unavailable behavior

The real provider is **strictly additive and non-blocking**: its absence or
failure degrades to today's behavior.

| Situation | Detection | Handling / result | Logging |
| --- | --- | --- | --- |
| Incomplete config (provider/key/model) | `app/llmConfig` + `selectRoomGenerator` | Select `FakeRoomGenerator`; gameplay never blocked | `provider:'fake'`, fixed code `config-disabled` |
| Network error / non-2xx / abort (timeout) | `OpenAICompatibleRoomGenerator` | Throw **fixed-code** error → `GeneratedRoomSource` maps to `unavailable` (retry screen) | existing `unavailable` line, fixed code only |
| Empty / missing `choices[0].message.content` | provider response check | same: throw fixed-code error → `unavailable` | fixed code only |
| Provider returns malformed / non-JSON text | unchanged | `assembleRoom` → `repaired` or `fallback` room (`ok:true`) + existing notice | provenance/codes (unchanged) |
| Provider returns valid clean JSON | unchanged | `generated` room, no notice | provenance (unchanged) |

- **Bounded:** one call, no retry, hard timeout (~25 s default; within ADR-0007's
  10–30 s target for the first room).
- **Sanitized errors:** the provider catches everything internally and rethrows a
  **fixed-shape `Error`** whose `message` is a safe code (e.g.
  `'llm-request-failed'`) carrying **no** key, request/response body, prompt, or
  model output. This keeps `GeneratedRoomSource`'s existing
  `describeError(err.message)` log line a safe fixed code — so **`GeneratedRoomSource`
  needs no change**. A test asserts the thrown message contains no substring of the
  key/body/seed.

## 12. Logging / key-safety rules

- `OpenAICompatibleRoomGenerator` logs nothing (no logger import).
- The composition root emits one safe selection line:
  `logger.info('room generator selected', { provider, model, maxTokens, timeoutMs })`
  on real selection, or `{ provider: 'fake', reason: 'config-disabled' }` when
  config is incomplete. `model` is not a secret.
- The failure path reuses `GeneratedRoomSource`'s existing `unavailable` line (fixed
  code only).
- **Never logged:** the API key, raw prompt, world-bible text, derived seed,
  provider request body, provider response body, generated JSON, or error details.
- Logs may include **only** the provider enum, model id, `maxTokens`/`timeoutMs`
  numbers, and safe fixed codes.

## 13. User-visible behavior

Identical to today: a clean `generated` room shows no notice; a `repaired` /
`fallback` room renders with the existing static, prompt-free notice; an
`unavailable` failure shows the existing "Could not generate a room. Please try
again." retry screen. The only happy-path difference is a real network
round-trip; no new UI/spinner is added. Offline / no key → fake, indistinguishable
to the user.

## 14. Browser key risk and deployment caveat (must document)

- Vite **inlines `VITE_*` values into the built JS bundle**. A built browser
  bundle that was compiled with a real `VITE_*_API_KEY` **contains that key**.
- v0 is therefore **local-dev / BYOK only**: put the key in a **gitignored
  `.env.local`**, use it with `npm run dev`, and **never `npm run build` + deploy
  a bundle that carries a real key.**
- The real provider stays **disabled** unless the developer explicitly opts in with
  their own key.
- **Hosted production must move the provider server-side later** (natural home: the
  existing Node `src/server`, which already composes the domain). Recorded as the
  explicit follow-up in ADR-0023.

## 15. Test plan (Vitest, no DOM / no network)

- **`llmConfig` + `selectRoomGenerator`:** returns fake when provider unset/`fake`,
  matching key missing/empty/whitespace, or model missing; returns the generic
  generator for `openai`/`deepseek` only when provider + matching key + model are
  complete; resolves the correct base URL per provider; incomplete config yields
  reason `config-disabled`.
- **`OpenAICompatibleRoomGenerator`** with an **injected fake transport**: builds a
  bounded prompt; POSTs to `{baseUrl}/chat/completions` with `Authorization:
  Bearer`; sends `model`, `max_tokens`, `messages`, `stream:false`; returns
  `choices[0].message.content` verbatim; on non-2xx / abort / empty content →
  rejects with the **fixed-code** error; does not send `temperature`/`top_p`.
- **Prompt bounds (`llmRoomPrompt`):** bounded length; seed passed through; no
  unbounded user text.
- **Log / key safety:** drive selection + a provider failure through a capturing
  logger; assert only enum/model/numbers/codes appear — no key, prompt, seed,
  world-bible, request/response body, or generated JSON. Assert the thrown error
  message contains no substring of the key, body, or seed.
- **Unavailable handling:** a rejecting generator → `GeneratedRoomSource` returns
  `{ ok:false, error.code:'unavailable' }` (reuses the existing pattern).
- **Trust boundary with LLM-shaped output:** a stub generator returning canned
  strings (clean JSON / malformed / fenced) → `assembleRoom` yields
  `generated` / `fallback` / `repaired` (reuses existing `GeneratedRoomSource`
  tests with a canned-string generator).

## 16. Implementation slices (proposed commits)

Each slice builds and leaves the app working; the maintainer commits manually.

1. **`feat(generation): add OpenAICompatibleRoomGenerator + pure prompt builder`** —
   `generation/OpenAICompatibleRoomGenerator.ts` + `generation/llmRoomPrompt.ts`
   with tests (injected transport, no wiring). `FakeRoomGenerator` untouched.
2. **`feat(app): select room generator from config (fake default; openai/deepseek
   opt-in; prompt path only)`** — `app/llmConfig.ts` + `app/selectRoomGenerator.ts`
   with tests; wire `App.tsx` to construct `promptGenerator` via the factory while
   `adjacentGenerator` stays `FakeRoomGenerator`; add the one safe selection log
   line; add `.env.example`.
3. **`docs(architecture): record real-room-generator-provider v0`** — record
   **ADR-0023**; update `ARCHITECTURE.md` (Generation plug-in point),
   `BOUNDARIES.md` (note the new generation I/O adapter; no new lint rule),
   `FAILURE-MODES.md` (real-provider `unavailable` / `config-disabled` rows), and
   `AGENTS.md` (status paragraph + out-of-scope note); mark this plan and ADR-0023
   as *implemented*; document the dev-only key caveat, the Anthropic follow-up, and
   the server-side follow-up.

## 17. Files added / changed

- **New (generation):** `generation/OpenAICompatibleRoomGenerator.ts`,
  `generation/llmRoomPrompt.ts` (+ co-located `*.test.ts`).
- **New (composition):** `app/llmConfig.ts`, `app/selectRoomGenerator.ts`
  (+ tests).
- **New (config/docs):** `.env.example`; `ADR-0023`; this plan.
- **Edited:** `App.tsx` (construct `promptGenerator` via the factory; keep
  `adjacentGenerator` fake; emit the safe selection log line). Docs:
  `ARCHITECTURE.md`, `BOUNDARIES.md`, `FAILURE-MODES.md`, `AGENTS.md`.
- **Deliberately NOT changed:** `domain/ports/RoomGenerator.ts`,
  `domain/ports/RoomSource.ts`, `generation/FakeRoomGenerator.ts`,
  `room/GeneratedRoomSource.ts`, `domain/assembleRoom.ts`, `domain/repairRoom.ts`,
  `domain/validateRoom.ts`, `domain/examples/fallbackRoom.ts`, `renderer/**`,
  `RoomViewer.tsx`, `app/AdjacentRoomPregenerator.ts`, `app/NavigationService.ts`,
  the world-bible files, `world-session/**`, `persistence/**`, `server/**`,
  `package.json` (no SDK dependency), and `eslint.config.js` (new files are already
  covered; `fetch` is permitted in `generation/**`).

## 18. ADR and doc updates (slice 3)

- **ADR-0023 — real-room-generator-provider v0:** records the opt-in generic
  OpenAI-compatible provider, the `fetch`/injected-transport/no-SDK decision, the
  fake-default + completeness-gated selection, the prompt-path-only scope (adjacent
  stays fake), the raw-text-only output contract, the strict log/key-safety rules,
  the dev-only BYOK browser-key caveat, and the two explicit follow-ups (Anthropic
  adapter; server-side hosting).
- `ARCHITECTURE.md`: extend the Generation plug-in point — a real adapter now
  exists behind the unchanged port; the schema/assembly boundary and renderer do
  not move.
- `BOUNDARIES.md`: note that `generation/**` now contains a network I/O adapter
  (still no logger/renderer/React/Three/DB imports); no new lint rule.
- `FAILURE-MODES.md`: add the real-provider rows (`config-disabled` degrade;
  network/timeout/empty-content → `unavailable`; malformed text → repaired/fallback
  via the unchanged pipeline).
- `AGENTS.md`: status paragraph + out-of-scope note (one provider at runtime; no
  router/fallback-chain/cost-optimizer/streaming/backend; dev-only key).

## 19. Approval answers (binding for this slice)

1. **Providers:** `fake` / `openai` / `deepseek` only. **Anthropic deferred**;
   `VITE_ANTHROPIC_API_KEY` reserved, unused in v0.
2. **Transport:** raw `fetch` with an **injected transport seam**; **no SDK**.
3. **Generator:** one generic `OpenAICompatibleRoomGenerator` (provider-agnostic;
   base URL + key + model injected).
4. **Default:** `FakeRoomGenerator` remains default.
5. **Selection:** real provider only when provider + matching key + model are
   complete; otherwise fake with reason `config-disabled`.
6. **Scope:** real provider affects the **PromptBar-generated room path only**;
   `AdjacentRoomPregenerator` stays fake.
7. **Output:** raw model text only — no parsing/validation/fence-stripping/structured
   output in the provider.
8. **Pipeline:** `GeneratedRoomSource → assembleRoom → repairRoom/fallbackRoom`
   unchanged.
9. **Base URLs:** built-in defaults `openai → https://api.openai.com/v1`,
   `deepseek → https://api.deepseek.com/v1`; no base-URL env var in v0.
10. **Calls:** one call, no retry, hard timeout (`AbortController`).
11. **Token field:** `max_tokens` in v0; `max_completion_tokens` for newer OpenAI
    models documented as a follow-up.
12. **Browser key:** local-dev / BYOK only; `VITE_*` keys are inlined into browser
    builds; never deploy a built bundle containing a real key; hosted production
    moves the provider server-side later.
