# ADR-0030: Cost/Usage Guardrails v0 — local session-cap guardrail for real prompt-generation

- **Status:** Accepted — **implemented** (Cost/Usage Guardrails v0)
- **Date:** 2026-06-24
- **Deciders:** Project owner

## Context

`real-room-generator-provider-v0` ([ADR-0023](./ADR-0023-real-room-generator-provider-v0.md))
introduced the first real, network-backed `RoomGenerator` — the opt-in
`OpenAICompatibleRoomGenerator` behind the unchanged `RoomGenerator` port. It is off by default
and selected only when `app/llmConfig.ts` reads a complete `VITE_*` provider config. When it is
selected, every PromptBar-generated room triggers one real network call that may incur cost.

The existing safety properties are preserved: `app/selectRoomGenerator.ts` never returns the
real generator without a complete config; `app/llmConfig.ts` is the only env reader;
`AdjacentRoomPregenerator` keeps a separate `FakeRoomGenerator` so background warming never
calls the real provider. But there was no count of how many real prompt-generation attempts had
been made in the current App lifetime, no user-visible signal when the count approached a
threshold, and no gate when the count reached a cap.

`room-generation-repair-fallback-v0` ([ADR-0020](./ADR-0020-room-generation-repair-fallback-v0.md))
owns the `GeneratedRoomSource → assembleRoom → repair/fallback` safety pipeline — this feature
must not touch it.

`adjacent-room-pregeneration-v0` ([ADR-0021](./ADR-0021-adjacent-room-pregeneration-v0.md))
establishes that background warming uses a separate hardwired `FakeRoomGenerator`, never the
real provider, so it must never be counted and needs no guardrail.

`inventory-health-ui-v0` ([ADR-0026](./ADR-0026-inventory-health-ui-v0.md)) and
`demo-quest-loop-v0` ([ADR-0028](./ADR-0028-demo-quest-loop-v0.md)) are the structural
precedent: a pure domain logic module + App-owned state + a read-only App-level overlay, tested
by pure Vitest with no new DOM dependency.

The real provider returns only `choices[0].message.content` verbatim — the existing
`OpenAICompatibleRoomGenerator` discards the `usage` field entirely — so a request-count guard
is the only deterministic spend unit available without changing the provider.

v0 adds **no token/cost metering, no provider wrapper change, no billing/payments/accounts, no
SaveGame/localStorage/SQLite usage state, no backend/API endpoint, no provider analytics, no
estimated cost display, no room-generation safety pipeline change, no new dependency, and no
DOM/component tests.** Full design in the implementation plan
[`cost-usage-guardrails-v0`](../implementation-plans/cost-usage-guardrails-v0.md).

## Decision

Ship **Cost/Usage Guardrails v0**: a local request-count safety counter for the one path that
can make real LLM calls, surfaced as a `UsageMeter` overlay (real provider only) with an at-cap
confirm-to-continue and an in-flight lock.

The defining property: **this is a local UI safety counter, not billing truth.** The count is
in-memory only for the page/App lifetime, never persisted, never authoritative accounting, and
never inspects the provider's response or token usage. When the **fake** provider is selected
the entire guard is **inert** — no count, no warning, no block, no UI.

```
Usage guard config (module-level, computed once):
  guardEnabled = roomGeneratorSelectionLog.provider !== 'fake'  ← real provider selected?
  guardCap     = llmConfig.sessionCap                           ← VITE_AIGM_LLM_SESSION_CAP (default 10)

Per-render derived verdict:
  guardConfig  = { cap: guardCap, enabled: guardEnabled }
  usageStatus  = evaluate({ count: usageCount }, guardConfig)
    → 'inert'       when !enabled
    → 'ok'          below cap-1
    → 'approaching' at cap-1
    → 'at-cap'      at >= cap

handlePrompt(prompt):
  if (inFlightRef.current) return                          ← in-flight lock (independent of cap)
  if (guardEnabled):
    if status === 'at-cap' && !confirmGrantedRef.current:
      pendingPromptRef ← prompt; return                    ← at-cap gate: hold prompt
    confirmGrantedRef ← false
    usageCountRef.current = recordAttempt(…).count         ← increment before async call
    setUsageCount(usageCountRef.current)
    inFlightRef ← true; setInFlight(true)
    logger.info('usage attempt', { count, cap, status })
  …async getRoom()…
  finally: if (guardEnabled) inFlightRef ← false; setInFlight(false)

handleGenerateAnyway():
  confirmGrantedRef ← true; handlePrompt(pendingPromptRef)   ← replay stored prompt

handleResetUsage():
  usageCountRef.current = 0; setUsageCount(0)
  confirmGrantedRef ← false; pendingPromptRef ← null

render:
  <PromptBar disabled={inFlight} />                          ← in-flight lock disables Generate
  {guardEnabled && <UsageMeter count={usageCount} cap={guardCap} status={usageStatus}
    onGenerateAnyway={handleGenerateAnyway} onReset={handleResetUsage} />}
```

### Data model (`domain/usage/usageGuard.ts`)

Pure types and functions — no I/O, no logger, no React, no provider imports. Mirrors the
`evaluateQuest` / `projectPlayerHud` style.

- **`UsageGuardConfig`** — static knobs: `{ cap: number; enabled: boolean }`. `enabled` is set
  from the real-provider selection result; `cap` from `llmConfig.sessionCap` (default 10).
- **`UsageGuardState`** — mutable-by-projection counter: `{ count: number }`. Starts at 0;
  each real attempt increments it.
- **`UsageGuardStatus`** — closed enum: `'inert' | 'ok' | 'approaching' | 'at-cap'`. Derived
  by `evaluate(state, config)` per render.

Pure helpers (total, deterministic, no mutation, return fresh objects):
- `initialUsageState()` → `{ count: 0 }`.
- `recordAttempt(state)` → `{ count: state.count + 1 }`.
- `resetUsage()` → `{ count: 0 }`.
- `evaluate(state, config)` → `UsageGuardStatus`: `inert` when `!enabled`; `at-cap` when
  `count >= cap`; `approaching` when `count === cap - 1`; else `ok`.

### Config (`app/llmConfig.ts`)

- **`VITE_AIGM_LLM_SESSION_CAP`** (optional) — read by `app/llmConfig.ts` alongside the
  existing `VITE_*` flags, parsed with the existing `parsePositiveInt` (positive integer or
  fallback to `DEFAULT_SESSION_CAP = 10`). Surfaced as `llmConfig.sessionCap` for the App to
  read at startup.
- **Default 10** whenever the flag is unset, zero, negative, or non-numeric.
- No cost-estimate flag and no estimated-cost display in v0.

### App wiring

`App` owns all guardrail state. Two parallel storage pairs are used for each counter: a `ref`
(stable, readable inside `useCallback` closures) and a `useState` (triggers re-renders):
`usageCountRef` / `usageCount`, `inFlightRef` / `inFlight`. Additional refs:
`confirmGrantedRef` (tracks a user-granted confirm-to-continue) and `pendingPromptRef` (stores
a prompt held at cap until granted). These are component-local and reset on page load.
`guardEnabled` and `guardCap` are module-level constants derived once at startup.

**Count increment** happens before the async `getRoom()` call resolves, so unavailable /
repaired / fallback outcomes all count — any real attempt is a real spend, regardless of
outcome.

**In-flight lock** (`inFlightRef`) is set when a real generation begins and cleared in the
`finally` block regardless of outcome. It drives `disabled={inFlight}` on `PromptBar` and
prevents a second click from firing a second call. The lock is independent of the cap.

**At-cap gate**: when `status === 'at-cap' && !confirmGrantedRef.current`, the prompt is stored
in `pendingPromptRef` and the handler returns. `handleGenerateAnyway` sets `confirmGrantedRef`
and replays the stored prompt — that attempt still increments the count.

**`UsageMeter` rendering**: gated on `guardEnabled`; passes `count`, `cap`, `status`,
`onGenerateAnyway`, and `onReset` as props. When `status === 'inert'` the component returns
`null`, so the fake-provider path is visually inert even if somehow rendered.

### Component (`renderer/ui/UsageMeter.tsx`)

Presentational React only — props `{ count, cap, status, onGenerateAnyway, onReset }` in,
DOM out. Returns `null` when `status === 'inert'`. Always shows `Generations: N / cap` when
active. Static, prompt-free warning copy for `approaching` (at cap − 1) and `at-cap`. "Generate
anyway" confirm button shown only at `at-cap`. "Reset usage" button always present; disabled
when `count === 0`. `role="status"` + `aria-live="polite"`. Styled with `.usage-meter*` rules
in `index.css`, consistent with `.room-notice` / `.status-hud*`. Imports only domain types and
React; imports no `three`, engine internals, `world-session`, or services.

### Failure behavior

- **Provider unavailable / repaired / fallback** — count still increments; the call was made.
  The existing retry/fallback path is unchanged and independent of the meter.
- **Reset** — in-memory only; does not reset on prompt, navigation, or save/load; only on the
  "Reset usage" affordance or page reload. `handleResetUsage` also clears `confirmGrantedRef`
  and `pendingPromptRef` so a stored at-cap prompt is discarded.
- **Fake provider** — `guardEnabled === false`; in-flight lock never fires; count never
  increments; `UsageMeter` not rendered; `PromptBar.disabled` stays `false`.

### Boundaries

`domain/usage/usageGuard.ts` sits under the existing `domain/**` lint block (imports nothing;
exports only pure types and functions — no React, Three.js, renderer, platform, or
world-session). `renderer/ui/UsageMeter.tsx` sits under the existing `renderer/ui/**` lint
block (imports React and the domain `UsageGuardStatus` type; no `three`, engine internals, or
services). `App.tsx` is the composition root. **No new lint block, no `eslint.config.js`
change, and no new layer** was introduced.

### Tests

Pure Vitest tests in `domain/usage/usageGuard.test.ts` (co-located, no new deps, no DOM):

- `recordAttempt` increments count by exactly 1; returns a fresh object (no mutation).
- `evaluate` → `inert` when `!enabled`; `ok` below threshold; `approaching` at `cap − 1`;
  `at-cap` at `cap` and beyond.
- `resetUsage` returns `{ count: 0 }` regardless of prior state.
- Cap respected at various values; purity/no-mutation/fresh-object guarantees throughout.

`app/llmConfig.test.ts` extended for `VITE_AIGM_LLM_SESSION_CAP`: parses a valid positive
integer, falls back to 10 when unset/zero/negative/non-numeric, trimmed like other flags.

No DOM/component tests — `UsageMeter` and `PromptBar` are presentational and not exercised by
`jsdom`/`@testing-library`; **no new test dependency added** (consistent with every prior v0).

### Log safety

May be logged: `count` (integer), `cap` (integer), derived `status` enum. One log line per
real attempt: `logger.info('usage attempt', { count, cap, status })`.

Must never be logged: API keys, raw prompts, prompt-derived seeds, provider
request/response bodies, `usage`/token numbers, generated JSON, model output, any cost figure,
or PII. No new log line carries prompt or content text.

### What was deliberately not changed

`domain/world/**` · `domain/roomSpec.ts` · `world-session/**` · `interactions/**` ·
`encounters/**` · `dialogue/**` · `memory/**` · `persistence/**` · `server/**` ·
`generation/OpenAICompatibleRoomGenerator.ts` · `app/selectRoomGenerator.ts` ·
`app/AdjacentRoomPregenerator.ts` · `renderer/RoomViewer.tsx` · `renderer/engine/**` ·
`domain/examples/fallbackRoom.ts` · `domain/assembleRoom.ts` · `domain/repairRoom.ts` ·
`eslint.config.js` · `package.json`. The room-generation safety pipeline
(`GeneratedRoomSource → assembleRoom → repair/fallback`) is entirely unchanged. Adjacent
pregeneration remains fake-only and uncounted.

## Consequences

- **A local, session-scoped request-count guardrail now exists for the real prompt-generation
  path.** BYOK/open-source users get a visible `Generations: N / 10` count, an approaching
  warning at 9/10, an at-cap confirm-to-continue at 10/10, and a reset affordance.
- **The fake provider path is completely inert.** No count, no meter, no warning, no in-flight
  lock, no `PromptBar` disable — the fake experience is unchanged.
- **Adjacent pregeneration is uncounted.** Background warming uses a separate
  `FakeRoomGenerator` and is never touched by the guard.
- **Count increments before the provider call resolves.** Unavailable, repaired, and fallback
  outcomes all count. The existing repair/fallback notice is unchanged and independent.
- **Confirm-to-continue, not a hard wall.** At cap the next Generate is gated, not blocked.
  BYOK users can proceed intentionally. The count still increments for that extra attempt.
- **In-flight lock prevents double-click repeated calls.** Independent of the cap.
- **No persistence, no backend.** Usage state is in-memory only; it resets on page reload.
  No `localStorage`, `SaveGame`, SQLite, or backend usage state.
- **"Session" means App/page lifetime**, not `WorldSession`. Code, types, and logs use
  "App-lifetime / page" to avoid conflation with the authoritative `WorldSession` entity; user-
  facing copy may say "this session" as that reads naturally to a user.
- **Log-safe.** Count/cap/status enum are the only values logged — never keys, prompts, seeds,
  provider bodies, generated JSON, token counts, or PII.
- **Known limitations:** request count is a local safety counter, not authoritative billing
  truth; reload resets it; the fake provider shows no meter; no token-accurate cost accounting;
  no cross-session quota; no hosted/server-side enforcement; no estimated cost display in v0.
- **Not yet:** token/cost metering, provider-response metering, estimated cost display, billing
  integration, cross-session quota, hosted enforcement, or provider analytics.
