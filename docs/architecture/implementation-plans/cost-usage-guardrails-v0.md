# Implementation Plan — `feature/cost-usage-guardrails-v0`

> Status: **approved — pending implementation.** Design approved by the maintainer; source
> not yet written; ADR-0030 is deferred to docs closeout after source review (§15).
>
> Companion docs: [ARCHITECTURE](../ARCHITECTURE.md) · [BOUNDARIES](../BOUNDARIES.md) ·
> [FAILURE-MODES](../FAILURE-MODES.md) · [CONVENTIONS](../CONVENTIONS.md). Direct
> precedent and dependencies:
> `real-room-generator-provider-v0` ([ADR-0023](../decisions/ADR-0023-real-room-generator-provider-v0.md))
> is the one feature that can make a real, network-backed LLM call — it owns
> `app/llmConfig.ts` (the only env reader), `app/selectRoomGenerator.ts` (real-vs-fake
> selection), and `OpenAICompatibleRoomGenerator` (returns `content` verbatim, discards
> `usage`);
> `room-generation-repair-fallback-v0` ([ADR-0020](../decisions/ADR-0020-room-generation-repair-fallback-v0.md))
> owns the `GeneratedRoomSource → assembleRoom → repair/fallback` safety pipeline this
> feature must **not** touch;
> `adjacent-room-pregeneration-v0` ([ADR-0021](../decisions/ADR-0021-adjacent-room-pregeneration-v0.md))
> warms rooms with a **separate `FakeRoomGenerator`**, so background warming never spends
> and must never be counted;
> `inventory-health-ui-v0` ([ADR-0026](../decisions/ADR-0026-inventory-health-ui-v0.md)) and
> `demo-quest-loop-v0` ([ADR-0028](../decisions/ADR-0028-demo-quest-loop-v0.md)) are the
> precedent for a **pure projection/logic module + App-owned state + a read-only App-level
> overlay**, tested by pure Vitest with no new DOM dependency.

## Goal

Add a small, local **cost/usage guardrail** around the one place a real LLM call can
happen: the PromptBar prompt-generation path. It protects open-source / BYOK users from
**accidentally triggering repeated expensive generations** by counting real provider
attempts in the current page/App lifetime, surfacing that count against a cap, warning as
the cap nears, and requiring an explicit **confirm-to-continue** once the cap is reached —
plus an in-flight lock so a double-click can't fire two calls.

The defining property: **this is a local UI safety counter, not billing truth.** It is
in-memory only, derived from "is a real provider selected and did we attempt a real
generation," never persisted, never authoritative accounting, and it never inspects the
provider's response or token usage. When the **fake** (default, offline, free) provider is
selected, the entire guard is **inert** — no count, no warning, no block, no UI.

---

## 1. Status

**Approved — pending implementation.** No source written, no ADR created, nothing
committed. ADR-0030 is written only during docs closeout after the source is reviewed
(§12 slice 4, §15).

## 2. Current repo facts (verified against source)

- **A real LLM call can happen only in the PromptBar/App prompt-generation path.**
  `App.handlePrompt` (`apps/web/src/App.tsx:202`) constructs a `GeneratedRoomSource` over
  the composition-root `promptGenerator` and calls `getRoom()`. `promptGenerator` comes
  from `selectRoomGenerator(readLlmConfig())` (`App.tsx:59`) and is the **only** generator
  that can be the real `OpenAICompatibleRoomGenerator`.
- **Adjacent pregeneration is fake-only.** `AdjacentRoomPregenerator` (`App.tsx:87`) is
  constructed with a factory that hardwires a separate `adjacentGenerator = new
  FakeRoomGenerator()` (`App.tsx:64`). Background warming and on-demand door resolution
  therefore never call a real provider and never spend (ADR-0021/0023).
- **The fake provider is the default and is free.** `selectRoomGenerator` returns
  `FakeRoomGenerator` unless `isRealProviderComplete(config)` (provider ∈ {openai,deepseek}
  **and** matching key **and** model, all trimmed non-empty); any incomplete config →
  `{ provider:'fake', reason:'config-disabled' }`. `FakeRoomGenerator` is pure,
  deterministic, offline.
- **The real provider returns content only; token usage is not available.**
  `OpenAICompatibleRoomGenerator.generate` extracts `choices[0].message.content` and
  returns it verbatim; it never reads `usage`. So a request-count guard is the only
  deterministic spend unit available without changing the provider (Option A).
- **`PromptBar` has a `disabled` prop but it is currently unused/not fully wired.**
  `PromptBar` (`apps/web/src/app/PromptBar.tsx`) accepts `disabled?: boolean` and already
  factors it into `canSubmit`, but `App.tsx:418` renders `<PromptBar onSubmit={handlePrompt} />`
  with no `disabled` passed — so today it is always enabled.
- **App already owns derived UI state and renders App-level overlays.** `App` holds
  `playerHud` / `quest` / `journal` / `notice` and renders them as overlay siblings of
  `RoomViewer` (`App.tsx:402-417`), with a dismissable `room-notice` (`role="status"`).
- **The composition root already logs selection safely.** `logger.info('room generator
  selected', roomGeneratorSelectionLog)` (`App.tsx:61`) logs only the provider enum, model
  id, and numeric caps (real) or `{ provider:'fake', reason }`. The selection result
  already tells the App whether a real provider is active.

## 3. Locked decisions

- **Option A:** local request-count guardrail + UI warning. No token/usage metering.
- **Cap default 10** real prompt-generation attempts per page/App lifetime.
- **At cap: confirm-to-continue, not a hard block.**
- **Count every real provider attempt**, including `unavailable` / repaired / fallback
  outcomes.
- **No estimated cost display in v0.**
- **Pure guard module placement: `domain/usage/`.**
- **App passes `enabled` / `cap` / `count` into the pure guard logic** and owns the React
  state; the domain module stays pure.
- **Wire `PromptBar` `disabled` during in-flight generation** to prevent double-click
  repeated calls.
- **Guard applies only when the real provider is selected.**
- **Fake provider path is inert:** no count, no warning, no blocking, no UI.
- **Adjacent pregeneration remains fake-only and is not counted.**
- **No provider response/token metering. No provider wrapper change.**
- **No backend / account / billing / payment. No provider analytics.**
- **No usage persistence; no `localStorage` / `SaveGame` / SQLite for usage.**
- **No sensitive logging.**
- **Do not change the room-generation safety path** (`GeneratedRoomSource` / `assembleRoom`
  / repair / fallback).

## 4. Authority / cost model

- **This is local guardrail state, not billing truth.** The count exists only to stop a
  user accidentally firing many real calls in one sitting; it makes no claim about money,
  tokens, or provider-side accounting.
- **The request count is a local UI safety counter.** One real prompt-generation attempt =
  one increment. It is the deterministic unit of spend on the only spend path; it is not a
  token count and not a cost figure.
- **It is not persisted and not authoritative accounting.** It lives in App memory for the
  page/App lifetime, resets on reload, and is never written to `WorldState`, the event log,
  `SaveGame`, `localStorage`, or SQLite. It is never an input to gameplay truth and has no
  write path to it.

## 5. Exact v0 behavior

- **Count real attempts.** When the selected generator is real (`enabled`), `handlePrompt`
  increments the count **once per attempt**, before/around the real `getRoom()` call, so the
  attempt is counted regardless of its outcome (success / `unavailable` / repaired /
  fallback). The fake path never increments.
- **Cap 10.** Default cap is 10 (configurable, §8). Status is derived from `count` vs `cap`.
- **Approaching warning at 9/10.** When `count` reaches `cap − 1` (9 of 10), the meter shows
  the approaching warning copy. (Threshold defined in the pure module, not hardcoded in UI.)
- **At-cap confirm-to-continue.** When `count >= cap`, the next Generate is gated: the meter
  shows the at-cap copy and a **"Generate anyway"** confirm. Confirming allows that one
  further real attempt to proceed (and still counts). It is **not** a hard wall — BYOK users
  own their keys.
- **In-flight `disabled` lock.** While a real `getRoom()` is pending, `App` passes
  `disabled` into `PromptBar` so a second click cannot fire a second call. The lock is
  independent of the cap and clears when the call resolves.
- **Fake path inert.** When the fake provider is selected, `enabled` is false: no
  increment, no meter, no warning, no gate, no in-flight lock change driven by the guard.

## 6. Data model

All three types live in the pure `domain/usage/` module; the App holds an instance in
`useState` and feeds inputs in. Nothing here is persisted.

- **`UsageGuardConfig`** — the static knobs: `{ cap: number; enabled: boolean }`. `enabled`
  is set true by the App only when a real provider was selected; `cap` comes from config
  (§8, default 10). (`enabled` may alternatively be carried as a separate App flag and
  passed alongside config; the pure functions treat a disabled guard as fully inert either
  way.)
- **`UsageGuardState`** — the mutable-by-projection counter: `{ count: number }` (real
  attempts so far this App lifetime; starts at 0).
- **`UsageGuardStatus`** — the derived, display-only verdict: a closed enum
  `'inert' | 'ok' | 'approaching' | 'at-cap'`, computed by a pure `evaluate(state, config)`
  (`inert` when `!enabled`; `approaching` at `cap − 1`; `at-cap` at `>= cap`; else `ok`).

Pure helpers (no I/O, no logger, no React): `initialUsageState()`, `recordAttempt(state)`
(returns a new state with `count + 1`), `evaluate(state, config) → UsageGuardStatus`, and
`resetUsage()`. Total, deterministic, side-effect-free; returns fresh objects; mirrors the
`evaluateQuest` / `projectPlayerHud` style.

## 7. UI

- **`UsageMeter` overlay, real provider only.** A new presentational React component
  (`renderer/ui/UsageMeter.tsx`), rendered as an App-level overlay sibling of the existing
  notices **only when `enabled`** (real provider selected). Props-in, DOM-out; no `three`,
  no engine internals, no services. `role="status"`, styling consistent with `.room-notice`.
- **Show `N / cap`.** A compact always-visible `Generations: N / 10` readout while a real
  provider is active.
- **Warning copy** (static, prompt-free, no narrative/PII):
  - approaching (9/10): *"You've used N of 10 room generations this session. These call your
    configured AI provider and may incur cost."*
  - at-cap: *"You've reached this session's generation limit (10). Generate again to
    continue — each one calls your AI provider."*
- **"Generate anyway" confirm.** Shown in the at-cap state; clicking it permits the next
  real attempt (which still counts).
- **"Reset usage".** A small affordance that resets `count` to 0 for the current App
  lifetime.

## 8. Config

- **Optional `VITE_AIGM_LLM_SESSION_CAP`.** Read **only** in `app/llmConfig.ts` alongside
  the existing `VITE_*` flags, parsed with the existing `parsePositiveInt` (positive integer
  or fallback). Surfaced on `LlmConfig` (or a small sibling) for the App to pass into the
  guard.
- **Default 10.** Used whenever the flag is unset or invalid.
- **No estimated-cost flag in v0.** No `VITE_*` cost knob, no cost multiplier, no cost
  display.

## 9. Failure behavior

- **Provider unavailable still counts.** A real attempt that ends in `unavailable` (the
  existing retry screen) has already (potentially) spent, so it increments the count.
- **Repaired / fallback still counts.** A real attempt that returns `ok:true` with
  `provenance: 'repaired' | 'fallback'` made the call and so increments. The existing
  repair/fallback notice is unchanged and independent of the meter.
- **Reset behavior.** Count resets to 0 on page reload (in-memory) and on the explicit
  "Reset usage" affordance. It does **not** reset on a new prompt, navigation, or save/load.
- **Repeated prompt clicks.** The in-flight `disabled` lock prevents a second call while one
  is pending; the cap + confirm-to-continue prevents accidental runaway across separate
  clicks.

## 10. Log safety

- **May be logged:** the request **count** (integer), the **cap** (integer), the derived
  **status** enum, and `enabled` (boolean) — e.g. a single `usage cap reached { count, cap }`
  line. These are non-sensitive counters/enums, consistent with the existing
  ids/counts/codes discipline.
- **Must never be logged:** API keys, raw prompts, prompt-derived seeds, provider
  request/response bodies, any provider `usage`/token numbers, generated JSON, model output,
  any cost figure tied to identity, or PII. No new log line carries prompt or content text.

## 11. Tests

- **Pure usage guard tests (primary).** Vitest over `domain/usage/`: `recordAttempt`
  increments; `evaluate` returns `inert` when disabled, `ok` below threshold, `approaching`
  at `cap − 1`, `at-cap` at `>= cap` and beyond; `resetUsage` returns count 0; cap respected;
  purity / no-mutation / fresh-object guarantees.
- **`llmConfig` cap parsing tests.** Extend `app/llmConfig.test.ts`: `VITE_AIGM_LLM_SESSION_CAP`
  parses a valid positive int, falls back to 10 when unset/zero/negative/non-numeric, and is
  trimmed like the other flags.
- **No DOM tests.** `UsageMeter` and `PromptBar` stay presentational and are not exercised by
  jsdom / `@testing-library`; **no new test dependency is added** (consistent with every
  prior v0). App wiring is validated through the pure guard + targeted unit coverage, not DOM.

## 12. Proposed source slices

1. **Pure usage guard + config.** Add `domain/usage/usageGuard.ts` (types + pure functions)
   with full unit tests, and `VITE_AIGM_LLM_SESSION_CAP` parsing in `llmConfig.ts` with
   tests. No UI, no App wiring, no behavior change. Independently shippable.
2. **App wiring: count / gate / in-flight lock.** App-owned usage state; set `enabled` from
   the real-provider selection signal; increment on each real attempt in `handlePrompt`;
   pass `disabled` into `PromptBar` for the in-flight lock; carry the cap. Add the single
   count-only log line.
3. **`UsageMeter` + CSS.** Presentational overlay (real-provider only), `N / cap` readout,
   warning copy, "Generate anyway" confirm, "Reset usage"; `.usage-meter*` styles in
   `index.css` reusing `.room-notice` conventions.
4. **Docs closeout after review.** Write ADR-0030; update ARCHITECTURE, BOUNDARIES (expect
   no new layer/lint rule), FAILURE-MODES (new case 22), and the AGENTS shipped section.

## 13. Files likely to change

- **New** `apps/web/src/domain/usage/usageGuard.ts` (+ `usageGuard.test.ts`) — pure logic.
- `apps/web/src/app/llmConfig.ts` (+ `llmConfig.test.ts`) — `VITE_AIGM_LLM_SESSION_CAP`.
- `apps/web/src/App.tsx` — usage state, `enabled` from selection, increment in
  `handlePrompt`, `PromptBar` `disabled` (in-flight + at-cap gate), render `UsageMeter`,
  count-only log.
- `apps/web/src/app/PromptBar.tsx` — wire the existing `disabled` (and, if used, a confirm
  affordance — otherwise confirm lives in `UsageMeter`).
- **New** `apps/web/src/renderer/ui/UsageMeter.tsx` — presentational overlay.
- `apps/web/src/index.css` — `.usage-meter*` styling.
- Docs (closeout only, §12 slice 4): **new** `ADR-0030-cost-usage-guardrails-v0.md`,
  `ARCHITECTURE.md`, `BOUNDARIES.md`, `FAILURE-MODES.md`, `AGENTS.md`.

## 14. Wording risks

- **"session" is ambiguous.** UI copy says "this session," but the counter is scoped to the
  **page/App lifetime** (resets on reload), not a `WorldSession`. Keep UI copy plain
  ("this session" reads naturally to a user) but ensure code, types, and logs say
  **App-lifetime / page** to avoid conflation with the authoritative `WorldSession`.
- **"cost" must stay hedged.** Copy may say calls "may incur cost"; it must never state or
  imply an actual amount, since v0 has no token/cost data. No estimated-cost figure.
- **"limit" must not imply a hard wall.** At-cap is confirm-to-continue; copy uses "Generate
  again to continue" / "Generate anyway," never "blocked" or "you cannot."
- **Avoid "metering / billing / quota / usage tracking" in user-facing and code naming** —
  those imply provider/billing semantics this feature explicitly is not. Prefer "guardrail",
  "generation count", "session cap".

## 15. ADR note

**ADR-0030 is not created now.** Per the locked process, the ADR
(`ADR-0030-cost-usage-guardrails-v0.md`) is written during **docs closeout after the source
is implemented and reviewed** (§12 slice 4), together with the ARCHITECTURE / BOUNDARIES /
FAILURE-MODES / AGENTS updates — not as part of this planning step.
