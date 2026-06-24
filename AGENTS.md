# AGENTS.md — Coding Agent Rules

Rules for AI coding agents and contributors. Read this before coding.

## Core workflow

* Design first. Do not implement until the maintainer approves.
* One small feature slice at a time.
* Do not expand scope.
* Do not commit automatically.
* Keep changes small, reviewable, and independently testable.
* When unsure about a boundary, ask before coding.
* For feature work, the approved implementation plan is the task-specific source of truth.

## Project identity

AI Game Master is a browser-based controlled 3D / isometric solo RPG engine.

A room is described by validated data-only `RoomSpec` JSON and rendered by trusted, hand-written Three.js code.

Current app: `apps/web` using React, TypeScript, Vite, Three.js, zod, Node, and SQLite.

FastAPI/Python are not part of the MVP backend path.

## Non-negotiable architecture rules

* LLM/generation may produce only data or proposals, never executable JS, Three.js, React, Unity, Godot, or scene scripts.
* Raw generated output must be parsed, schema-validated, semantically validated, repaired/fallback-handled where applicable, and only then rendered.
* The renderer must stay hand-written and trusted.
* `RoomSpec` and domain models must remain renderer-agnostic.
* SQLite/world-session current state plus append-only event log are authoritative.
* Summaries, memories, retrieval, and LLM text never override authoritative state.
* The browser must not access SQLite or Node-only persistence directly.
* The frontend remains intentionally in-memory unless the maintainer explicitly approves backend wiring.
* The renderer must not import React, DB, network, server, or persistence code.
* React UI must not import Three.js engine internals except through approved host/composition seams.
* Persistence stays Node-only and browser-excluded.
* Use the logger abstraction. Do not add scattered `console.log`.
* Never log secrets, API keys, raw prompts, generated JSON, provider request/response bodies, or PII.
* Keep DI simple through constructor/function parameters. Do not add heavy frameworks, Redux, Nest, heavy ORMs, or new package/workspace structure without approval.
* WorldSession current state plus append-only event log are authoritative; SQLite is authoritative where backend persistence is wired.

## NPC memory (npc-memory-persistence-v0) — shipped, headless

The first NPC memory layer is **implemented, headless, and Node/SQLite-only**; the
browser stays in-memory and unwired ([ADR-0024](docs/architecture/decisions/ADR-0024-npc-memory-persistence-v0.md)).
**Memory is supporting context only and can never become world truth.** The
`WorldSession` event log + reducers remain the sole authority, and the memory layer
holds **no reference to `WorldSession`/`WorldStore`/`WorldCommand`/`WorldEvent`** — it
has no code path to mutate state (the *memory firewall*, lint-enforced). Player claims
are claims, NPC beliefs/observations can be wrong, dialogue summaries can't update
truth, and `source:'llm'` memories can't apply state changes.

| Module | Role |
| --- | --- |
| `domain/memory/contracts.ts` | Strict versioned schema: strict `(worldId, sessionId, npcId)` scope; kinds `player_claim`/`npc_belief`/`npc_observation`/`dialogue_summary`; source `player`/`npc`/`game`/`llm` (**no `system`**); informational-only `confidence`; inert `text` ≤ 280. Imports only `zod`; exports no command/event-producing function. |
| `domain/memory/firewall.ts` | Pure firewall: `validateMemoryDraft` (write), `filterMemoriesForScope` (read), `selectRecallMemories` (deterministic `seq` desc → `memoryId`; defaults `limit 8`, `maxChars 600`). |
| `domain/ports/NpcMemoryStore.ts` | Insert-only port (typed `session-not-found`/`conflict`; no update/delete). |
| `memory/NpcMemoryService.ts` | Headless `remember`/`recall`; injects store/`Clock`/`IdGenerator`/`Logger` — **no `WorldSession`**, no append path. |
| `memory/InMemoryNpcMemoryStore.ts` | Pure in-memory adapter (tests / future browser path). |
| `persistence/SqliteNpcMemoryStore.ts` · `persistence/migrations/0002_npc_memories.ts` | SQLite store + migration: FK to `world_sessions`, scope index, `UNIQUE(session_id, npc_id, seq)`, no-update trigger (DELETE left open). Read boundary re-validates and re-asserts JSON scope; corrupt/scope-divergent rows are skipped. |

`src/memory/**` has a lint wall stricter than the other application layers — it also
forbids importing `world-session`/`interactions`/`encounters`/`dialogue`. v0 adds **no
API, no dialogue/LLM wiring, no prompt injection, and no renderer/RoomSpec/Three.js
change**. Logs never include memory `text`, player lines, NPC/room names, provider
prompts/responses, generated JSON, keys, or PII.

## Room memory (living-world-room-memory-v0) — shipped, headless

The first **room** memory layer is **implemented, headless, and Node/SQLite-only**; the
browser stays in-memory and unwired ([ADR-0025](docs/architecture/decisions/ADR-0025-living-world-room-memory-v0.md)).
**Room memory is supporting context only and can never become room truth.**
`WorldState.roomStates` (`.visited`, `.flags`) and the append-only `WorldEvent[]`
remain the sole authority; the memory layer holds **no reference to
`WorldSession`/`WorldStore`/`WorldCommand`/`WorldEvent`/`WorldState`** — it has no
code path to mutate state (the *room-memory firewall*, lint-enforced). Player claims
are claims, `room_observation` is not authoritative truth, `room_note`/`room_summary`
are inert supporting context, and `source:'llm'` memories can't apply state changes.

| Module | Role |
| --- | --- |
| `domain/memory/roomContracts.ts` | Strict versioned schema: strict `(worldId, sessionId, roomId)` scope; kinds `player_claim`/`room_observation`/`room_note`/`room_summary`; source `player`/`npc`/`game`/`llm` (**no `system`**); informational-only `confidence`; inert `text` ≤ 280. `roomId` is a plain string — not FK'd to `rooms`. Imports only `zod`; exports no command/event-producing function. |
| `domain/memory/roomFirewall.ts` | Pure firewall: `validateRoomMemoryDraft` (write), `filterRoomMemoriesForScope` (read), `selectRecallRoomMemories` (deterministic `seq` desc → `memoryId`; defaults `limit 8`, `maxChars 600`). Standalone — does not import or alter the NPC firewall. |
| `domain/ports/RoomMemoryStore.ts` | Insert-only port (typed `session-not-found`/`conflict`; no update/delete). |
| `memory/RoomMemoryService.ts` | Headless `remember`/`recall`; injects store/`Clock`/`IdGenerator`/`Logger` — **no `WorldSession`**, no append path. |
| `memory/InMemoryRoomMemoryStore.ts` | Pure in-memory adapter (tests / future browser path). |
| `persistence/SqliteRoomMemoryStore.ts` · `persistence/migrations/0003_room_memories.ts` | SQLite store + migration: FK to `world_sessions` (**no FK to `rooms`**), scope index, `UNIQUE(session_id, room_id, seq)`, no-update trigger (DELETE left open). Read boundary re-validates and re-asserts JSON scope; corrupt/scope-divergent rows are skipped. |

Covered by the same `src/memory/**` lint wall as NPC memory — also forbids
`world-session`/`interactions`/`encounters`/`dialogue`. **No `eslint.config.js` change
was needed** — existing blocks cover all new files. v0 adds **no API, no dialogue/LLM
wiring, no room-generation injection, no adjacent-room pregeneration wiring, no prompt
injection, and no renderer/RoomSpec/Three.js change.** Logs never include memory `text`,
player lines, room/NPC display names, provider prompts/responses, generated JSON, keys,
or PII.

## Inventory & Health UI v0 — shipped, browser

A **display-only player HUD** is implemented in the browser, surfacing
`player.health`, `player.status`, and `inventory` from the existing authoritative
`WorldState` ([ADR-0026](docs/architecture/decisions/ADR-0026-inventory-health-ui-v0.md)).

| Module | Role |
| --- | --- |
| `renderer/ui/playerHud.ts` + `playerHud.test.ts` | Pure `projectPlayerHud(state) → PlayerHudView` projection + Vitest tests (health fraction, item mapping, status copy, purity/no-mutation, structural read-only). No domain/service import. |
| `renderer/ui/StatusHud.tsx` | Presentational React: health bar + `current/max` text; inventory list (explicit "No items" when empty); status chips (omitted when empty). `pointer-events:none`; `role="status"` + `aria-live="polite"`. |
| `App.tsx` wiring | Owns `playerHud: PlayerHudView | null`; seeds at both session-start sites; resets on new prompt; renders `<StatusHud>` as an App-level overlay sibling of `RoomViewer` (survives navigation remounts). |
| `RoomViewer.tsx` wiring | Single `onWorldStateChange?: (state: WorldState) => void` prop; called only after interaction/encounter `applied`/`already-resolved` resolves. No other change. |

**The HUD is a read-only render cache — never truth, never written back.** v0 adds
**no combat, no health/damage model, no inventory economy, no item actions, no
equipment, no status-effect engine, no backend wiring, no memory integration, no LLM
item generation, no `RoomSpec` change, no Three.js engine change, no new dependency,
and no DOM/component tests.** Logs never include item names/ids, health values/deltas,
status strings, or any narrative content.

## Session Save/Load v0 — shipped, browser

A **manual browser save/load** is implemented: one named `localStorage` slot stores
the integrity-checked `SaveGame` JSON; every load re-validates through the full
`SaveGameService` boundary before any state change
([ADR-0027](docs/architecture/decisions/ADR-0027-session-save-load-v0.md)).

| Module | Role |
| --- | --- |
| `app/saveSlotStore.ts` | `SaveSlotStore` interface + `LocalStorageSaveSlotStore` (key `aigm.save.slot`). `localStorage` wrapped in try/catch; never throws into render. `KeyValueStore` seam enables in-memory testing. |
| `app/buildRestoredPlay.ts` | Pure helper: `(state, resolveResult, fallbackRoom) → { play, degraded }`. Wraps resolved room; `degraded` true when room is non-authored or unresolvable. No store/service import. |
| `renderer/ui/SaveLoadBar.tsx` | Presentational save/load bar: `{ canSave, hasSave, busy, error, onSave, onContinue }`. Calm `role="alert"` errors only; no save content shown. |
| `App.tsx` wiring | Constructs `SaveGameService` + `LocalStorageSaveSlotStore`; owns `handleSave`/`handleLoad` with `requestVersion` guarding; renders `<SaveLoadBar>` as an App-level overlay. |

**`localStorage` is a byte parking spot, never truth.** Only `saveGameJson` is read on
load; slot metadata (`label`/`savedAt`/`currentRoomId`) is display-only and ignored on
load. v0 adds **no backend, no API client, no autosave, no multiple slots, no file
export/import, no generated `RoomSpec` / room-cache / world-bible persistence, no
memory/NPC integration, no LLM replay, no `RoomViewer` change, and no new dependency.**
Logs never include SaveGame JSON, seed name, event payloads, item names/ids, room names,
dialogue, prompt text, or any narrative/PII.

## Demo Quest Loop v0 — shipped, browser

A **deterministic authored demo quest** ("The Steward's Toll") surfaces as a **read-only
quest tracker** overlay — a pure projection of authoritative `WorldState` for the authored
example world session ([ADR-0028](docs/architecture/decisions/ADR-0028-demo-quest-loop-v0.md)).

| Module | Role |
| --- | --- |
| `domain/quests/questSpec.ts` | `QuestSpec`/`QuestSpecSchema` (zod-validated authored data; closed condition vocabulary: `room-flag`, `room-visited`, `has-item`, `has-status`). Imports only `zod`; exports no command/event-producing function. |
| `domain/quests/evaluateQuest.ts` | Pure `evaluateQuest(spec, state) → QuestView`. Total, deterministic, no I/O; reads defensively (optional chaining); missing rooms/flags/visited → `false`, never throws. |
| `domain/examples/demoQuest.ts` | Hand-authored `demoQuestSpec` literal: "The Steward's Toll", three objectives tied to existing `throne-room` flags (`interaction:offering-coffer`, `encounter:malik-encounter`) and `ruined-safehouse` visited. |
| `renderer/ui/QuestTracker.tsx` | Presentational React: `{ view: QuestView }` in, DOM out. No `three`, engine internals, `world-session`, or services. `pointer-events:none`; `role="status"` + `aria-live="polite"`. |
| `App.tsx` wiring | Owns `quest: QuestView | null`; attaches `demoQuestSpec` only for the authored example bootstrap and for anchor-gated restores (`'throne-room' in state.roomStates`); re-projects via `refreshDerivedViews(state)` at all four state points (bootstrap, `onWorldStateChange`, `handleNavigate` `navigated`, load); renders `<QuestTracker>` as an App-level overlay. |

**The quest tracker is a read-only lens — never truth, never written back.** v0 adds
**no quest engine, no new `WorldEvent` or `WorldCommand`, no reducer change, no authored-room
edit, no LLM quest generation, no backend/memory/persistence wiring, no new dependency,
and no DOM/component tests.** Quest/objective text, ids, flag keys, item names/ids, status
strings, and any narrative content are never logged.

## Consequence Journal v0 — shipped, browser

A **six-entry authored consequence journal** surfaces as a **collapsible read-only journal
panel** — a pure projection of authoritative `WorldState` for the authored example world session
([ADR-0029](docs/architecture/decisions/ADR-0029-consequence-journal-v0.md)).

| Module | Role |
| --- | --- |
| `domain/journal/journalSpec.ts` | `JournalSpec`/`JournalEntrySpec`/`JournalSpecSchema` (zod-validated authored data; reuses the closed `ObjectiveCondition` vocabulary from `questSpec.ts`). Imports only `zod`; exports no command/event-producing function. |
| `domain/journal/projectJournal.ts` | Pure `projectJournal(spec, state) → JournalView`. Total, deterministic, no I/O; reads defensively via the shared exported `evaluateCondition`; missing rooms/flags/statuses/items → `false`, never throws. Emits only true entries in authored order. |
| `domain/examples/demoJournal.ts` | Hand-authored `demoJournalSpec` literal: six entries tied to existing `WorldState` conditions — `throne-room` flags (tribute coin, Malik), `ruined-safehouse` visited, `infected` status, `encounter:walker-encounter` flag, and `royal-writ` inventory. |
| `renderer/ui/JournalPanel.tsx` | Presentational React: `{ view: JournalView }` in, DOM out. Collapsible, collapsed by default; empty state "Nothing of consequence yet."; interactive collapse toggle; `pointer-events:none` for text; `role="status"` + `aria-live="polite"`. No `three`, engine internals, `world-session`, or services. |
| `domain/quests/evaluateQuest.ts` (export added) | `evaluateCondition(condition, state): boolean` is now exported (previously private) — a pure shared helper for both quest and journal evaluation. No behavior change to the quest path. |
| `App.tsx` wiring | Owns `journal: JournalView | null`; attaches `demoJournalSpec` only for the authored example bootstrap and for anchor-gated restores (`'throne-room' in state.roomStates`); `refreshDerivedViews(state)` (introduced with ADR-0028) now also sets `journal`; renders `<JournalPanel>` as an App-level overlay. |

**The journal is a read-only lens — never truth, never written back.** v0 adds **no new
`WorldEvent` or `WorldCommand`, no reducer change, no authored-room edit, no LLM summarization,
no memory integration, no backend/API/persistence changes, no `SaveGame` schema change, no new
dependency, and no DOM/component tests.** Journal title/entry text, ids, flag keys, item
names/ids, status strings, room display names, and any narrative content are never logged.

## Cost/Usage Guardrails v0 — shipped, browser

A **local request-count safety guardrail** wraps the PromptBar prompt-generation path when a
real provider is selected — counting real attempts against a configurable session cap, warning
as the cap nears, and requiring an explicit **confirm-to-continue** at cap
([ADR-0030](docs/architecture/decisions/ADR-0030-cost-usage-guardrails-v0.md)).

| Module | Role |
| --- | --- |
| `domain/usage/usageGuard.ts` | Pure types (`UsageGuardConfig`, `UsageGuardState`, `UsageGuardStatus`) + four pure helpers (`initialUsageState`, `recordAttempt`, `resetUsage`, `evaluate`). No I/O, no logger, no React. Covered by pure Vitest; no DOM dependency. |
| `renderer/ui/UsageMeter.tsx` | Presentational React overlay: props `{ count, cap, status, onGenerateAnyway, onReset }` in, DOM out. Returns `null` when `status === 'inert'`. `role="status"` + `aria-live="polite"`. No `three`, engine internals, `world-session`, or services. |
| `app/llmConfig.ts` (extended) | `VITE_AIGM_LLM_SESSION_CAP` parsed via existing `parsePositiveInt`; `DEFAULT_SESSION_CAP = 10`. Surfaced as `llmConfig.sessionCap`. |
| `App.tsx` wiring | `guardEnabled` (real provider selected) and `guardCap` are module-level constants. App holds `usageCountRef`/`usageCount` and `inFlightRef`/`inFlight` pairs. Count increments **before** `getRoom()` resolves so failures still count. In-flight lock passes `disabled={inFlight}` to `PromptBar`. At-cap gate stores the prompt until `handleGenerateAnyway` grants confirm. `UsageMeter` rendered only when `guardEnabled`. |

**The guardrail is a local in-memory counter — never truth, never written back.** v0 adds **no
token/cost metering, no provider wrapper change, no billing/payments/accounts/analytics, no
`SaveGame`/`localStorage`/SQLite/backend usage state, no estimated cost display, no
room-generation safety pipeline change, no new dependency, and no DOM/component tests.** Logs
carry count/cap/status enum only — never keys, prompts, seeds, provider bodies, generated JSON,
token counts, or PII. The fake provider path is completely inert: no count, no meter, no gate,
no UI. Adjacent pregeneration is fake-only and uncounted.

## Current guardrails

Do not add unless explicitly requested by the maintainer or by the approved implementation plan for the current feature:

* hosted/cloud deployment
* server-side LLM provider
* browser API client/CORS proxy
* browser DB access
* second backend
* Anthropic adapter
* provider router/fallback chain
* real-provider adjacent-room pregeneration
* streaming
* multi-attempt LLM repair loop
* deeper validator rules
* new memory/living-world systems outside the approved memory feature
* complex combat
* mobile/touch controls
* free-camera/first-person mode
* minimap
* GLTF asset pipeline
* npm workspaces or extracted packages

## What to read before planning

Always read:

1. `AGENTS.md`
2. `docs/architecture/ARCHITECTURE.md` (see the status legend at the top for what is currently implemented)
3. `docs/architecture/BOUNDARIES.md`

Read only if relevant:

* `docs/architecture/ARCHITECTURE.md`
* `docs/architecture/FAILURE-MODES.md`
* `docs/architecture/CONVENTIONS.md`
* the ADR directly related to the requested feature

Do not read every ADR unless the task requires it.

## Build and verify

From `apps/web`:

```bash
npm run build
npm run lint
npm run test
```

For docs-only changes, run the smallest relevant check and report if a check was skipped.
