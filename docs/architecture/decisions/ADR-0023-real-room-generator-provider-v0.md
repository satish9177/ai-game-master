# ADR-0023: Real Room Generator Provider v0 — opt-in OpenAI-compatible adapter

- **Status:** Accepted — **implemented** (Real Room Generator Provider v0)
- **Date:** 2026-06-23
- **Deciders:** Project owner

## Context

Every generation slice so far has used deterministic *fakes*: `FakeRoomGenerator`
turns a seed into a RoomSpec with a seeded PRNG, and `FakeWorldBibleSeeder` derives
initial canon the same way. No real model has ever been called. The
`RoomGenerator` port (`generate(seed): Promise<string>` → **raw, untrusted text**)
and the trust boundary behind it (`GeneratedRoomSource → assembleRoom →
repairRoom/fallbackRoom`) were designed from the start so a real model could slot
in **behind the port without moving any boundary** (ADR-0001, ADR-0010, ADR-0020).

This slice adds the **first real, network-backed `RoomGenerator`** while preserving
every safety property. It is deliberately minimal: one provider call, no retry, no
router, no streaming, no backend, no SDK — the smallest seam that proves a real
model can produce a room safely.

## Decision

Ship **Real Room Generator Provider v0**: a single, opt-in, provider-agnostic
`OpenAICompatibleRoomGenerator` behind the unchanged `RoomGenerator` port. It is
selected by the composition root **only** when the env config is complete;
otherwise the default `FakeRoomGenerator` is used. The real provider affects the
**PromptBar-generated room path only**.

```
readLlmConfig(import.meta.env)            app/llmConfig.ts   (the ONLY env reader)
  → selectRoomGenerator(config)           app/selectRoomGenerator.ts
       complete real config?
         yes → OpenAICompatibleRoomGenerator  generation/  (real fetch, opt-in)
         no  → FakeRoomGenerator               generation/  (default, deterministic)
  → App.handlePrompt → GeneratedRoomSource(promptGenerator, seed, …)
       → generate(seed) → raw untrusted text
       → assembleRoom → loadRoomSpec/validateRoom → repairRoom → fallbackRoom
```

### One generic OpenAI-compatible adapter (OpenAI + DeepSeek)

`generation/OpenAICompatibleRoomGenerator.ts` implements `RoomGenerator` for any
OpenAI-compatible chat-completions endpoint. **OpenAI and DeepSeek differ only by
base URL + key + model**, all injected — there is no per-provider subclass. It:

- builds a compact, bounded prompt from the seed via the pure
  `generation/llmRoomPrompt.ts` (a static system message naming the published
  object vocabulary, the RoomSpec shape, and the Y-up/meters/−Z-north/degrees/
  `#rrggbb` conventions; a single user message carrying the seed clamped to a hard
  `MAX_SEED_CHARS` defensive bound);
- makes **one** non-streaming `POST {baseUrl}/chat/completions` with
  `Authorization: Bearer <key>`, body `{ model, messages, max_tokens, stream:false }`
  (no `temperature`/`top_p`);
- returns `choices[0].message.content` **verbatim** as `Promise<string>`.

The constructor takes the typed config plus an **injected transport seam**
(default: `fetch` + `AbortController`), so tests touch no network. There is **no
SDK dependency** — raw `fetch` only.

### Raw text only — the trust boundary is unchanged

The provider does **not** parse, validate, repair, fence-strip, or use structured
output. Its string stays raw and untrusted exactly like the fake's output and flows
through the unchanged `GeneratedRoomSource → assembleRoom → loadRoomSpec/
validateRoom → repairRoom → fallbackRoom` pipeline — the only trust boundary, and
it is sufficient. Hostile or malformed output is just data that repairs or falls
back; there is no code path from model output to executed JavaScript (ADR-0001).

### Env-driven, completeness-gated selection

`app/llmConfig.ts` is the **only** browser module that reads `import.meta.env`.
It parses a typed `LlmConfig` and exposes a provider → built-in base-URL map and a
completeness check:

- `VITE_AIGM_LLM_PROVIDER` — `fake` (default/unset/unknown) | `openai` | `deepseek`.
- `VITE_AIGM_LLM_MODEL` — required for real selection.
- `VITE_AIGM_LLM_MAX_TOKENS` — bounded output cap (default `2000`).
- `VITE_AIGM_LLM_TIMEOUT_MS` — hard request timeout (default `25000`).
- `VITE_OPENAI_API_KEY` / `VITE_DEEPSEEK_API_KEY` — provider-specific; only the one
  matching the selected provider is read. (`VITE_ANTHROPIC_API_KEY` is reserved for
  the Anthropic follow-up and unused in v0.)
- Built-in base URLs (no base-URL env var): `openai → https://api.openai.com/v1`,
  `deepseek → https://api.deepseek.com/v1`.

`app/selectRoomGenerator.ts` constructs the real generator **iff** `provider ∈
{openai, deepseek}` **and** the matching key is non-empty **and** the model is
non-empty (all trimmed). Any incomplete state degrades to `FakeRoomGenerator` with
the fixed reason code `config-disabled`. `FakeRoomGenerator` **remains the default**;
the real provider is never default and gameplay is never blocked by its absence.
Constructing the real generator performs no I/O, so selection is pure at
composition time.

### Composition wiring

`App.tsx` calls `selectRoomGenerator(readLlmConfig())` once and uses the returned
`promptGenerator` for the PromptBar-generated `GeneratedRoomSource` only. A separate
`const adjacentGenerator = new FakeRoomGenerator()` feeds the
`AdjacentRoomPregenerator` factory: **adjacent pre-generation stays fake in v0** —
background warming makes no network calls and never spends. No renderer, RoomViewer,
PromptBar, RoomGenerator port, FakeRoomGenerator, `GeneratedRoomSource`,
`assembleRoom`/`repairRoom`/`fallbackRoom`, world-session, backend, API, SQLite, or
persistence contract changes. New files under `generation/**` and `app/**` are
already covered by the existing ESLint boundary blocks, so **no new lint rule is
needed** (mirrors ADR-0020/0021/0022).

### Failure and log safety

The real provider is strictly additive and non-blocking; its absence or failure
degrades to today's behavior.

- **Incomplete config** → `FakeRoomGenerator`, fixed reason `config-disabled`.
- **Network error / non-2xx / timeout (abort) / empty or missing
  `choices[0].message.content` / non-JSON body** → the generator throws a
  **fixed-shape `Error`** whose message is one of three safe codes only —
  `llm-request-failed`, `llm-timeout`, `llm-empty-response`. `GeneratedRoomSource`
  maps a generator throw/reject to the existing `unavailable` retry path.
- **Malformed / non-JSON completion text** → `assembleRoom` yields a `repaired` or
  `fallback` room (`ok:true`) with the existing static notice — unchanged.
- **Valid clean JSON** → a `generated` room, no notice — unchanged.

The provider **imports no logger and logs nothing**. The fixed error codes carry
**no** API key, request/response body, prompt/seed text, model output, or raw
provider error — a unit test asserts the thrown message contains no substring of the
key, seed, or body. Because `GeneratedRoomSource` logs `err.message` on the
`unavailable` path, fixed safe codes are a **hard requirement**, not a nicety: that
existing log line stays safe with no change to `GeneratedRoomSource`.

The composition root emits one safe selection line:
`logger.info('room generator selected', { provider, model, maxTokens, timeoutMs })`
on real selection, or `{ provider: 'fake', reason: 'config-disabled' }` otherwise.
`model` is a non-secret id. Logs never contain the API key, raw prompt, world-bible
text, derived seed, provider request/response body, generated JSON, completion text,
or raw error details.

### Browser key risk and the dev-only / BYOK caveat

Vite **inlines `VITE_*` values into the built browser bundle**. A production build
compiled with a real `VITE_*_API_KEY` would ship that key to every visitor. v0 is
therefore **local-dev / BYOK only**: keep real keys in a gitignored `.env.local`,
use them only with `npm run dev`, and **never `npm run build` + deploy a bundle
compiled with a real key**. A committed `.env.example` documents this with
placeholders only. **Hosted/production must move the provider server-side later**
(natural home: the existing Node `src/server`, which already composes the domain).

## Consequences

- A real model can now generate PromptBar rooms behind the unchanged port, proving
  the trust boundary holds against real, non-deterministic output without moving any
  boundary.
- OpenAI and DeepSeek are supported through one adapter; adding another
  OpenAI-compatible provider is a base-URL + key + model entry, not new code.
- With no/incomplete config — the default — behavior is byte-identical to before:
  deterministic fake, no network, no spend.
- The browser-direct key is a real risk, contained by the dev-only/BYOK caveat and
  the never-deploy rule. Hosted production is gated on the server-side follow-up.
- v0 intentionally has no Anthropic adapter, multi-provider router, cross-provider
  fallback chain, cost optimizer, retry loop, streaming, backend generation
  endpoint, LLM reviewer, or structured-output/fence-stripping in the provider.

## Follow-ups (explicit, out of v0 scope)

- **Anthropic adapter.** Anthropic's Messages API is not OpenAI-compatible (system
  prompt and `max_tokens`/content shape differ), so it needs its own adapter behind
  the same port. `VITE_ANTHROPIC_API_KEY` is reserved for it.
- **`max_completion_tokens` mapping.** v0 sends `max_tokens`; some newer OpenAI
  models require `max_completion_tokens`. Configure `VITE_AIGM_LLM_MODEL` to a chat
  model that accepts `max_tokens`; the field mapping is a documented follow-up.
- **Server-side hosting.** A hosted deployment must move the provider behind the
  Node server (key held server-side, browser calls the API), replacing the dev-only
  BYOK browser-direct path.

## Alternatives considered

- **Plain browser-direct without a factory (Option A)** — rejected: no clean,
  testable seam to keep the fake the default and gate real selection on completeness.
- **A backend generation endpoint now (Option B)** — rejected for v0: no browser→Node
  client/CORS path exists today, so this is much larger scope. It is the documented
  server-side follow-up.
- **Defer entirely (Option D)** — rejected: a minimal opt-in real provider de-risks
  the trust boundary against real model output now, at low cost.
- **An SDK (`openai`/provider clients)** — rejected: raw `fetch` over an injected
  transport is smaller, dependency-free, and easier to keep network-free in tests.
- **Per-provider subclasses** — rejected: OpenAI and DeepSeek differ only by base
  URL + key + model; one generic adapter is simpler and covers both.
- **Parse/validate/fence-strip in the provider** — rejected: it would duplicate and
  weaken the existing `assembleRoom` trust boundary, which is the single place
  untrusted text becomes a validated room.
