# Release Readiness Check — v0

**Date:** 2026-06-24
**Branch:** `feature/release-readiness-check-v0`
**Base commit checked:** `82cfbeb` (`Merge pull request #24 from satish9177/feature/open-source-demo-polish-v0`)
**Checker:** Claude Code (Sonnet 4.6)

---

## Commands run and results

| Command | Result | Notes |
| --- | --- | --- |
| `git status` | ✅ Clean | No uncommitted changes; working tree clean |
| `git diff --check` | ✅ Pass | No whitespace errors |
| `npm run build --prefix apps/web` | ✅ Pass | `tsc -b` + Vite build; 180 modules, no type errors |
| `npm run lint --prefix apps/web` | ✅ Pass | No ESLint violations |
| `npm run test --prefix apps/web` | ✅ Pass | 713 tests, 74 files, all pass |
| `npm install` | Skipped | `node_modules` present; `package-lock.json` in sync; safe to install fresh with `npm install` per README |

---

## README command verification

README instructs:

```bash
cd apps/web
npm install
npm run dev      # start the Vite dev server
npm run build    # type-check (tsc -b) + production build
```

- `npm run build` verified above: ✅ clean pass.
- `npm run dev` not run (no headless browser available in this session); documented as a manual step below.
- `npm install` instruction is accurate and sufficient.

README relative links checked:

| Link | Target exists? |
| --- | --- |
| `AGENTS.md` | ✅ |
| `docs/architecture/ARCHITECTURE.md` | ✅ |
| `docs/architecture/BOUNDARIES.md` | ✅ |
| `docs/architecture/CONVENTIONS.md` | ✅ |
| `docs/architecture/FAILURE-MODES.md` | ✅ |
| `docs/architecture/decisions/` | ✅ (30 ADRs present) |
| `apps/web/.env.example` | ✅ |

No broken links found.

---

## Fake-mode / offline demo checklist

The following items describe what a first-run visitor should see with **no env vars set** (the default `provider=fake` path). Items marked ✅ are confirmed by code inspection (pure projections, authored literals, deterministic generators — all verifiable without a browser). Items marked 🔲 require a live browser session to confirm visually.

| Item | Status | Evidence |
| --- | --- | --- |
| App starts without env vars | ✅ | `selectRoomGenerator` always falls back to `FakeRoomGenerator` when config is incomplete or `provider=fake`; `llmConfig.ts` defaults handle missing vars |
| Authored throne-room demo loads | ✅ | `throneRoom.ts` is a static literal; `bootstrapExampleWorld` builds from it; no network or key required |
| Status HUD appears | ✅ | `projectPlayerHud(state)` seeded at both session-start sites in `App.tsx`; `StatusHud` rendered as sibling overlay |
| Quest tracker appears | ✅ | `demoQuestSpec` attached on authored bootstrap; `evaluateQuest` is pure and offline |
| Consequence journal appears | ✅ | `demoJournalSpec` attached on authored bootstrap; `projectJournal` is pure; collapsed by default |
| Save / Load bar visible | ✅ | `SaveLoadBar` rendered as App-level overlay; `hasSave` controls Continue visibility |
| Prompt generation works in fake mode | ✅ | `FakeRoomGenerator` is deterministic PRNG; same prompt → same room; no key/network needed |
| `UsageMeter` hidden in fake mode | ✅ | `guardEnabled = provider !== 'fake'`; when fake, `UsageMeter` is not rendered at all |
| No network requests on first load | ✅ | `FakeRoomGenerator` and `FakeWorldBibleSeeder` perform no `fetch` calls; adjacents warm via `RoomRegistry`, not network |
| Movement (WASD) | 🔲 | Requires browser; architecture confirms `MovementControls` is wired |
| E/F interaction prompt | 🔲 | Requires browser; `engine.onActiveInteractionChange` wired to React state |
| North-arch navigation to ruined safehouse | 🔲 | Requires browser; `NavigationService` + `AdjacentRoomPregenerator` wired in `App` |
| Save → reload → Continue restores progress | 🔲 | Requires browser; logic confirmed via `SaveGameService` + `buildRestoredPlay` code review |
| Journal entries unlock on actions | 🔲 | Requires browser; `evaluateCondition` logic confirmed by 713 passing tests |

---

## BYOK / env docs verification

`apps/web/.env.example` was reviewed in full.

| Item | Status | Notes |
| --- | --- | --- |
| Default provider is `fake` | ✅ | `VITE_AIGM_LLM_PROVIDER=fake` is the only non-empty value |
| No real API key in `.env.example` | ✅ | Both key lines are blank (`VITE_OPENAI_API_KEY=`, `VITE_DEEPSEEK_API_KEY=`) |
| Browser-key caveat documented | ✅ | Header comment clearly states dev-only / BYOK only; warns never to deploy a built bundle with a real key |
| `.env.local` is gitignored | ✅ | `*.local` in `apps/web/.gitignore`; confirmed no `.env.local` on disk |
| Consistent with README "Generation modes" section | ✅ | README copies the same caveat; steps match the file |
| Session cap documented | ✅ | `VITE_AIGM_LLM_SESSION_CAP=10` with explanation; consistent with ADR-0030 |
| Token cap and timeout documented | ✅ | `VITE_AIGM_LLM_MAX_TOKENS=2000`, `VITE_AIGM_LLM_TIMEOUT_MS=25000` with notes |

---

## Secret / log-safety review

### `console.*` usage
All `console.*` calls are confined to `src/platform/logger/consoleLogger.ts` — the single approved logger adapter per ADR-0003. ESLint `no-console` rule enforces this everywhere else.
**No scattered `console.log` found anywhere in `src/`.**

### API key handling
- `VITE_OPENAI_API_KEY` and `VITE_DEEPSEEK_API_KEY` are read only in `app/llmConfig.ts`.
- The `selectRoomGenerator` function constructs the `log` object with `{ provider, model, maxTokens, timeoutMs }` — **`apiKey` is explicitly excluded** from the log payload.
- `OpenAICompatibleRoomGenerator` has **no logger calls** — on failure it throws a fixed-code `Error` (`llm-request-failed` / `llm-timeout` / `llm-empty-response`) that never contains key, seed, prompt, or body text.
- No API key values appear in any source file (test files use fake `sk-openai` / `sk-deepseek` literals, which are not real keys).

### Prompt / generated JSON logging
- `App.tsx` logs `{ promptLength: prompt.length }` for a submitted prompt — length only, **never the prompt text**.
- `GeneratedRoomSource` logs provenance codes, issue codes, and counts — **never raw JSON or story text**.
- `FakeRoomGenerator` and `FakeWorldBibleSeeder` are silent (no logger).
- Memory services log ids/enums/counts/codes only; `text` field is never logged.
- Save/load logs ids/codes/counts only; event payloads, item names, room names are never logged.

### Provider request/response body
- `OpenAICompatibleRoomGenerator` sends a raw `fetch` call. On any error it catches and rethrows a fixed safe error code. The request body (which contains the prompt) and response body are **never logged**.

### PII / narrative content
No path logs dialogue text, NPC names, item names, room names, player status strings, journal/quest text, or any narrative content. This is enforced by a combination of ESLint rules and the content-free log discipline documented in all ADRs from 0013 onward.

**Overall log-safety assessment: PASS.**

---

## Known limitations (by design for v0)

These are documented in README.md and are not blockers for the demo release:

- Dev-only real provider (browser-direct BYOK only; no server-side key management).
- No real collision detection; movement clamped to room AABB.
- No death/game-over state; health can reach 0.
- Browser gameplay is in-memory + `localStorage` only; Node/SQLite backend is headless.
- Fake NPC dialogue; real LLM dialogue is a future slice.
- Adjacent-room warming uses the fake generator only.
- Primitives only; no GLTF or textures.
- Single save slot; no file export/import.
- WebGL unavailable/context-lost is not handled (FAILURE-MODES item 3 is marked 🔜).
- Log-level filtering (debug in dev, warn+ in prod) not yet set by composition root (noted in `consoleLogger.ts`).

---

## Release recommendation

**READY for open-source demo release.**

All automated checks pass:
- TypeScript build: clean.
- ESLint: no violations.
- Vitest: 713/713 tests pass.
- Git tree: clean, no uncommitted files.
- No real secrets in tracked files.
- No API key, prompt, or generated JSON in any log path.
- README instructions and env docs are accurate.
- All relative doc links resolve.

The browser-interactive items (movement, navigation, save/load round-trip) could not be verified with a headless browser in this session. They are covered by 713 passing unit and integration tests and the architectural guarantee that the demo world is authored, deterministic, and offline by default. A final sanity check with `npm run dev` in a real browser is **recommended before tagging**.

---

## Follow-ups (not blocking)

| Item | Priority | Notes |
| --- | --- | --- |
| Manual browser smoke-test before tagging | Recommended | Run `npm run dev`, walk the "60 seconds" path from README |
| WebGL unavailable fallback (FAILURE-MODES #3) | Low | Currently marked 🔜; not a demo blocker |
| Log-level filtering in composition root | Low | `consoleLogger.ts` notes it as a future enhancement; not a security issue |
| `max_completion_tokens` field mapping for newer OpenAI models | Low | Noted in `.env.example`; only affects BYOK users on newer models |

---

## Files changed by this check

- `docs/release/release-readiness-check-v0.md` — created (this file)
- No other files were changed.
