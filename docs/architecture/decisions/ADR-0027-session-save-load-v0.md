# ADR-0027: Session Save/Load v0 — browser-local manual save/load via SaveGameService

- **Status:** Accepted — **implemented** (Session Save/Load v0)
- **Date:** 2026-06-24
- **Deciders:** Project owner

## Context

`world-state-event-log-v0` ([ADR-0013](./ADR-0013-world-state-event-log-v0.md)) established
the `SaveGame` document (`{ schemaVersion, seed, log, snapshot }`), `SaveGameService`
(`saveSession`/`loadSaveGame`/`loadSession`), and `WorldStore.restoreSession` — all already
tested and browser-safe. State produced by those services was lost on refresh because no durable
browser byte store existed.

`inventory-health-ui-v0` ([ADR-0026](./ADR-0026-inventory-health-ui-v0.md)) established the
App-level overlay pattern (`StatusHud` as sibling of `RoomViewer`) and the `projectPlayerHud`
precedent that the restore path reuses.

`multi-room-navigation-cache-v0` ([ADR-0016](./ADR-0016-multi-room-navigation-cache-v0.md)) and
`adjacent-room-pregeneration-v0` ([ADR-0021](./ADR-0021-adjacent-room-pregeneration-v0.md)) own
the room-acquisition seam (`AdjacentRoomPregenerator.resolveRoom`) that restore re-uses to rebuild
the current room.

`room-generation-repair-fallback-v0` ([ADR-0020](./ADR-0020-room-generation-repair-fallback-v0.md))
owns the static `FALLBACK_NOTICE` that restore shows when the current room does not come back
through the authored path.

`world-bible-seed-v0` ([ADR-0022](./ADR-0022-world-bible-seed-v0.md)) establishes that the world
bible is **never** a SaveGame/state and is never saved.

`backend-sqlite-persistence-v0` ([ADR-0018](./ADR-0018-backend-sqlite-persistence-v0.md)) and
`backend-world-session-api-v0` ([ADR-0019](./ADR-0019-backend-world-session-api-v0.md)) are the
Node-only persistence/API that the browser **deliberately does not call** — a standing guardrail
this slice keeps unchanged.

The only gaps to close were: (a) a durable browser byte store, (b) a tiny UI control, and (c) App
glue that rebuilds `ActivePlay` after a load. The hard part — `SaveGameService`, the `SaveGame`
integrity check, `restoreSession`, and the version gate — already existed and is unchanged.

v0 adds **no backend, no API, no browser API client, no browser SQLite, no autosave, no accounts,
no multi-slot, no session browser, no generated `RoomSpec` persistence, no room cache persistence,
no world bible persistence, no memory/NPC/room-memory integration, no LLM replay, no renderer/Three.js
change, no `RoomViewer` change, and no new dependencies**. Full design in the implementation plan
[`session-save-load-v0`](../implementation-plans/session-save-load-v0.md).

## Decision

Ship **one named `localStorage` slot** round-tripping the existing `SaveGame` document through
the existing `SaveGameService`, with a pure restore helper, an injected slot store, a presentational
`SaveLoadBar`, and minimal `App` wiring.

The defining property: **`localStorage` is a byte parking spot, never truth.** Every load
re-parses, version-checks, integrity-checks, and reconstructs the session from the event log
before anything is shown. The slot wrapper's `label`/`savedAt`/`currentRoomId` are display hints;
only `saveGameJson` crosses the integrity boundary.

```
Save:
  App.handleSave
    └─ saveGameService.saveSession(activePlay.sessionId)       → ok: JSON string
         └─ saveSlotStore.write({ saveGameJson, label, savedAt, currentRoomId })

Load:
  App.handleLoad
    └─ saveSlotStore.read()                                    → wrapper | null
         └─ saveGameService.loadSession(wrapper.saveGameJson)
              • loadSaveGame: JSON.parse → version gate → schema → integrity
              • store.restoreSession({ sessionId, log, snapshot })
              └─ { ok:true, sessionId }
         └─ worldSession.getWorldState(sessionId)              → restored WorldState
         └─ adjacentPregenerator.resolveRoom(state.currentRoomId)
         └─ buildRestoredPlay(state, resolveResult, fallbackRoom)
              • roomSource    = preloadedRoomSource(resolvedRoom)
              • sessionId     = state.sessionId
              • navigation    = exampleNavigation
              • initialPlayer = projectPlayerHud(state)
              • degraded      = !resolveResult.ok || resolveResult.source !== 'registry'
         └─ App: setActivePlay(play); setPlayerHud(play.initialPlayer)
                 if (degraded) setNotice(FALLBACK_NOTICE)
```

### Authority model

- **Truth (authoritative):** the `SaveGame` document's `saveGameJson` field — the
  integrity-checked event log + projected `WorldState` snapshot. `loadSaveGame` re-asserts
  the full integrity boundary (log validity, seed↔first-event equality,
  `projectWorldState(log) === snapshot`) before any restore.
- **Not truth (never read on load):** `label`, `savedAt`, `currentRoomId` in the slot
  wrapper — display hints stored for the UI, never passed to `SaveGameService` and never
  trusted.

### `SaveSlotStore` (`app/saveSlotStore.ts`)

An interface over a `KeyValueStore` seam (a single `get`/`set`/`delete` abstraction):

- `read()` → `SlotWrapper | null`: reads and JSON-parses the slot; returns `null` on absence,
  parse error, or missing `saveGameJson`.
- `write(wrapper)` → `{ ok:true } | { ok:false; code }`: JSON-stringifies and stores the full
  wrapper.
- `has()` → `boolean`; `clear()` → `void`.

`LocalStorageSaveSlotStore` is the thin browser binding (key `aigm.save.slot`). All
`localStorage` access is wrapped in try/catch: unavailable reads → treat as no slot; quota
exceeded on write → typed `quota-exceeded` code. The store never throws into the render cycle.

Tested via an in-memory `KeyValueStore` fake (key round-trips, absence, null, throwing fake for
unavailable/quota). The `localStorage` binding is exercised manually in the running app.

### `buildRestoredPlay` (`app/buildRestoredPlay.ts`)

A **pure** function `buildRestoredPlay(state, resolveResult, fallbackRoom)`:

- Returns `{ play: ActivePlay; degraded: boolean }`.
- `roomSource` = `preloadedRoomSource(resolvedRoom)` for authored or generated resolve, or the
  fallback under `currentRoomId` when `resolveResult.ok === false`.
- `degraded` = `!resolveResult.ok || resolveResult.source !== 'registry'` — authored current
  room → `false`, generated or unresolvable → `true`.
- `navigation` = `exampleNavigation` (existing singleton).
- `initialPlayer` = `projectPlayerHud(state)`.
- Imports no store/service; returns only an `ActivePlay` descriptor. The input `WorldState` is
  never mutated.

Tested (Vitest, co-located, pure only, no DOM): authored resolve → `degraded:false`; generated →
`degraded:true`; failed resolve → `degraded:true` with fallback room under `currentRoomId`;
purity/no-mutation; no store/service import.

### `SaveLoadBar` (`renderer/ui/SaveLoadBar.tsx`)

Presentational React only. Receives `{ canSave, hasSave, busy, error, onSave, onContinue }`.

- **Save:** enabled when `canSave` (i.e. `activePlay != null`) and not `busy`.
- **Continue:** shown/enabled only when `hasSave`; hidden/disabled otherwise (no false "Continue").
- **Busy:** both buttons disabled during the async save/load.
- **Error:** a calm `role="alert"` message for any typed failure ("This save could not be
  loaded." / "Couldn't save your game."); never raw error text, never save content.

Follows the same App-level overlay pattern as `StatusHud`
([ADR-0026](./ADR-0026-inventory-health-ui-v0.md)).

### `App` wiring

`App` constructs `SaveGameService(worldStore, worldSession, logger)` and
`LocalStorageSaveSlotStore()` once. It adds:

- **`handleSave`**: async, sets `busy`; calls `saveGameService.saveSession`, then
  `saveSlotStore.write`; on success shows transient "Saved" state; on typed failure shows a calm
  error message. Never logs save content.
- **`handleLoad`**: async, sets `busy`; reads slot → `loadSession` → `getWorldState` →
  `resolveRoom` → `buildRestoredPlay` → `setActivePlay` / `setPlayerHud` / notice; bumps the
  existing `requestVersion` ref (same guard as the boot/prompt paths) to prevent a stale
  in-flight bootstrap from clobbering the restored `ActivePlay`; on typed failure shows a calm
  error message, current play untouched.
- Renders `<SaveLoadBar>` as an App-level overlay sibling of `RoomViewer` and `StatusHud`.
- `hasSave` is derived from `saveSlotStore.has()` after each save/load cycle.

### Failure behavior

| Situation | Detection | Handling / result | Logging |
| --- | --- | --- | --- |
| Corrupt save (bad JSON / wrong shape) | `loadSaveGame`: `invalid-json` / `invalid-schema` | calm "couldn't load"; nothing restored; current play untouched | error `code` only |
| Unsupported version | `loadSaveGame`: `unsupported-version` | calm "couldn't load"; no silent migration | `code` only |
| Integrity mismatch | `loadSaveGame`: `integrity-mismatch` | reject whole save; nothing restored | `code` (+ `sessionId` if known) |
| Same session already loaded | `restoreSession` → `already-exists` | calm "this session is already loaded"; no-op | `sessionId` / `code` |
| Generated room cache missing | by design — content was never saved | re-resolve via seam; fallback room + static notice; correct authoritative state | seam ids/`source` only |
| Current room cannot be resolved | `resolveRoom` → `{ ok:false }` | substitute fallback under `currentRoomId`; `degraded:true` → notice; state still correct | `roomId` / `reason` |
| Load while a session is active | always (a session exists after boot) | different `sessionId` restores alongside it; `ActivePlay` replaced; unsaved progress lost | `sessionId` only |
| `localStorage` unavailable / blocked | `SaveSlotStore` try/catch | reads → treat as no slot (Continue hidden); writes → calm "couldn't save"; never throws into render | `code` only |
| `localStorage` quota exceeded on save | write throws `QuotaExceededError` | calm "couldn't save your game"; existing slot left intact | `code` only |

### Boundaries

`app/saveSlotStore.ts`, `app/buildRestoredPlay.ts`, and `renderer/ui/SaveLoadBar.tsx` sit under
existing lint blocks — **no new lint rule and no `eslint.config.js` change**. `localStorage` is
a browser/DOM global that lives legitimately in the `app/` composition layer; it crosses no
boundary rule (it is not `persistence/**` or `node:*`). `SaveGameService` is browser-safe
(domain contracts + `InMemoryWorldStore` ports only; no `node:*`, no `persistence/**`). No layer
imports `persistence/**` or `server/**` from the browser. No engine object enters the restore
path. No new dependency was added.

### What was deliberately not changed

`domain/world/saveGame.ts` (the `SaveGame` schema) · `world-session/saveGame.ts`
(`SaveGameService`, `SaveGame`, `loadSaveGame`, `loadSession`) · `domain/ports/WorldStore.ts`
(`restoreSession` already exists) · `world-session/InMemoryWorldStore.ts` · `persistence/**` ·
`server/**` · `renderer/engine/**` · `renderer/RoomViewer.tsx` · `eslint.config.js` ·
`package.json`.

## Consequences

- **Manual browser save/load now exists.** A player can save the current session to a single
  named `localStorage` slot and resume it later in the same browser.
- **Authority unchanged.** `localStorage` holds a byte wrapper; only `saveGameJson` is read on
  load and it passes the full `SaveGameService` integrity boundary before any state change. The
  `WorldSession` event log + reducers remain the sole authority.
- **Authoritative state restores faithfully.** Player health/status, inventory, visited rooms,
  and interaction/encounter flags are exactly as saved.
- **Authored current room restores faithfully** (`source:'registry'`, no notice).
  **Generated/non-authored current room:** re-resolved by id through the existing seam; if not
  through the authored path, `FALLBACK_NOTICE` is shown and `degraded:true`. Generated room
  content is not byte-restored; only authoritative state/event log is restored faithfully.
- **No domain footprint.** Zero new events, reducers, schema fields, or persisted server state.
- **`RoomViewer` unchanged.** A load produces a new `ActivePlay` (`roomSource` + `sessionId`);
  `RoomViewer` remounts via its existing `useEffect` deps.
- **Subsequent play continues from the restored revision.** The restored session lives in the
  same `worldStore` the services are bound to; no rewiring is needed.
- **`requestVersion` guard prevents stale bootstrap clobber.** Loading bumps the existing ref,
  matching the guard already present on the boot and prompt paths.
- **Log-safe.** `handleSave`/`handleLoad` log ids/counts/codes/enums only — never the SaveGame
  JSON, slot wrapper, seed name, event payloads, item names, room names, dialogue, prompt text,
  or any narrative/PII.
- **Known limitations:** one local slot only; no file import/export; no session list/browser; no
  backend/cloud sync; generated room content is not byte-restored; `RestoredPlay.roomCache` is
  App state and navigation still uses the existing acquisition seam — cache is not persisted.
- **Not yet:** multiple save slots, file export/import, session browser/menu, backend/cloud
  persistence, autosave, generated room content fidelity, memory/NPC/room-memory integration,
  or LLM replay.
