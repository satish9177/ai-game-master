# Implementation Plan — `feature/session-save-load-v0`

> Status: **approved — pending implementation.** Design is locked (see §3); no
> source code exists yet. This plan is the docs-only artifact that must precede
> any code for this slice. **ADR-0027 is NOT written yet** — it is created in the
> docs closeout *after* the source implementation is reviewed (§17). Commits are
> made manually by the maintainer; agents do not commit.
>
> Companion docs: [ARCHITECTURE](../ARCHITECTURE.md) · [BOUNDARIES](../BOUNDARIES.md) ·
> [FAILURE-MODES](../FAILURE-MODES.md) · [CONVENTIONS](../CONVENTIONS.md). Direct
> precedent and dependencies:
> `world-state-event-log-v0` ([ADR-0013](../decisions/ADR-0013-world-state-event-log-v0.md))
> defines the authoritative `WorldState`/event-log model **and the `SaveGame`
> document, the integrity check, and the version gate this slice reuses unchanged**
> (FAILURE-MODES cases 10 / 11);
> `backend-sqlite-persistence-v0` ([ADR-0018](../decisions/ADR-0018-backend-sqlite-persistence-v0.md))
> and `backend-world-session-api-v0` ([ADR-0019](../decisions/ADR-0019-backend-world-session-api-v0.md))
> are the Node-only persistence/API that the browser **deliberately does not call**
> (no browser API client — a standing guardrail);
> `multi-room-navigation-cache-v0` ([ADR-0016](../decisions/ADR-0016-multi-room-navigation-cache-v0.md))
> and `adjacent-room-pregeneration-v0` ([ADR-0021](../decisions/ADR-0021-adjacent-room-pregeneration-v0.md))
> own the room-acquisition seam (`AdjacentRoomPregenerator.resolveRoom`) that restore
> re-uses to rebuild the current room;
> `room-generation-repair-fallback-v0` ([ADR-0020](../decisions/ADR-0020-room-generation-repair-fallback-v0.md))
> owns the static "safe room" notice restore reuses;
> `world-bible-seed-v0` ([ADR-0022](../decisions/ADR-0022-world-bible-seed-v0.md))
> establishes that the world bible is **never** a SaveGame/state and so is never
> saved;
> `inventory-health-ui-v0` ([ADR-0026](../decisions/ADR-0026-inventory-health-ui-v0.md))
> is the App-level overlay + `projectPlayerHud` precedent this UI mirrors.

## Goal

Let a player **save the current game session** and **load it later** in the browser,
restoring **only from authoritative truth** — the integrity-checked `SaveGame`
document (seed + append-only `WorldEvent` log + projected `WorldState`) — through the
**already-existing, already-tested** `SaveGameService` and `WorldStore.restoreSession`.

The defining property: **save/load round-trips authoritative state only.** The
`localStorage` slot is a byte parking spot, never truth; every load re-parses,
version-checks, integrity-checks, and reconstructs the snapshot from the event log
before anything is shown. The HUD, room cache, world bible, generated room JSON,
memories, prompts, and transient UI are **not truth and are not part of the save**.

The work is small and additive because the hard part already exists: the serialize/
deserialize boundary, the integrity check, the version gate, and `restoreSession` are
all built and tested today. The only gaps are (a) a durable browser byte store, (b) a
tiny UI control, and (c) the App glue that rebuilds `ActivePlay` after a load.

---

## 1. Status

**Approved — pending implementation.** Design locked; no source written. This
docs-only plan precedes code. ADR-0027 follows in closeout, not now (§17).

## 2. Current repo facts (verified against source)

- **`SaveGameService` already exists** (`apps/web/src/world-session/saveGame.ts`):
  - `saveSession(sessionId)` reads the snapshot + full event log, builds
    `{ schemaVersion:1, seed, log, snapshot }`, integrity-checks it, and returns a
    **JSON string** (typed `not-found` / `integrity-mismatch` on failure).
  - `loadSaveGame(json)` is the pure boundary: `invalid-json` → `invalid-schema` →
    `unsupported-version` → `integrity-mismatch`, then `{ ok:true, saveGame }`.
  - `loadSession(json)` validates via `loadSaveGame`, then calls
    `store.restoreSession(...)`, returning `{ ok:true, sessionId }`.
  - **Import surface is browser-safe**: domain contracts + `projectWorldState` +
    `jsonDeepEqual` + `validateEventLog` + the `Logger` **type** only. No `node:*`, no
    `persistence/**`, no SQLite. It works over **any** `WorldStore`. It is round-trip
    tested (`world-session/saveGame.test.ts`).
- **`WorldStore.restoreSession` already exists** (`domain/ports/WorldStore.ts`) and is
  implemented by both adapters. `InMemoryWorldStore.restoreSession`
  (`world-session/InMemoryWorldStore.ts`) returns typed `already-exists` if the
  `sessionId` is already present, and only **throws** on an empty log / mismatched
  `sessionId` — both **unreachable for a save that passed `loadSaveGame` integrity**.
- **The browser uses `InMemoryWorldStore`** (`App.tsx` constructs the singleton
  `worldStore` + `worldSession`; all services are bound to it). State is lost on
  refresh today.
- **The backend uses SQLite but the browser does not call it.** `server/**` +
  `persistence/**` are Node-only and browser-excluded (tsconfig excludes + lint walls).
  There is **no browser API client** (FAILURE-MODES §5: "the browser does not call it
  yet"), and adding one is a standing guardrail.
- **There is no backend save / load / list endpoint.** `server/routes/sessions.ts`
  exposes only `POST /sessions`, `GET …/state`, `GET …/events`, `POST …/move`.
  `SaveGameService` is **not** wired into the server or `bootstrap.ts`.
- **`WorldState` carries `currentRoomId` + `roomStates` (visited + flags), player
  health/status, inventory, revision, updatedAt — but never the room's `RoomSpec`.**
  Room *content* is not authoritative state.
- **Room content is reproduced by id through one seam.**
  `AdjacentRoomPregenerator.resolveRoom(id)` (`app/AdjacentRoomPregenerator.ts`) is
  cache → authored `RoomRegistry` → deterministic generated (`adjacent:${id}`) →
  fallback, and **never throws**. Its result is
  `{ ok:true; room; cacheHit; source:'cache'|'registry'|'generated' }` or
  `{ ok:false; reason:'invalid-room'|'unavailable' }`. Authored rooms come back via
  `source:'registry'`; everything non-authored via `source:'generated'`. (The result
  does **not** expose `provenance`, so restore keys its notice off `source`/failure —
  §9.)
- **Test environment is node, no DOM** (verified: `vite.config.ts` declares no `test`
  block; no `jsdom`/`happy-dom`/`@testing-library` deps). `localStorage` is
  unavailable in tests; there are no component tests today.

## 3. Locked decisions

1. **Browser-local manual save/load.** No backend, no API, no browser client, no
   browser SQLite, no autosave, no accounts/cloud/multi-user.
2. **Reuse the existing `SaveGameService` over the browser in-memory `WorldStore`.**
   No change to `saveGame.ts`, the `SaveGame` schema, `WorldStore`, or
   `InMemoryWorldStore`.
3. **Save medium = one named `localStorage` slot.** `localStorage` is **only a byte
   store, not truth**.
4. **Every load must parse → version-check → integrity-check → restore** through
   `SaveGameService` / `WorldStore`. Nothing is shown from unverified bytes.
5. **No persistence of:** generated `RoomSpec`, room cache, world bible, memories,
   prompts, HUD, or UI state.
6. **Load replaces the current `ActivePlay`;** unsaved current progress is lost (this
   is documented behavior, §11).
7. **Generated / non-authored current room on load:** restore authoritative state,
   then **re-resolve `currentRoomId`** through the existing seam and **show the static
   notice** when the room does not return through the authored path.
8. **Authored rooms restore faithfully.**
9. **`RoomViewer` stays unchanged** — a load just produces a new `ActivePlay`
   (`roomSource` + `sessionId`), which `RoomViewer` already remounts on.
10. **No renderer/Three.js change, no new dependency.**
11. **No DOM/component tests; no new test environment.**

## 4. Authority model

- **Truth (authoritative):** the per-session append-only `WorldEvent[]`, with
  `WorldState` as its reconstructable projection. A `SaveGame` document
  (`{ schemaVersion, seed, log, snapshot }`) is the *serialized form* of that truth;
  `loadSaveGame` re-asserts it (log validity, seed↔first-event equality, and
  `projectWorldState(log) === snapshot`) before any restore. The only write path
  remains `WorldSession.appendEvent → applyEvent → store.commit` (and `restoreSession`
  for a whole validated session).
- **Not truth (never saved, never trusted):**
  - the `localStorage` **slot wrapper metadata** (label / `savedAt` / display
    `currentRoomId`) — display hints only, ignored on load;
  - the **HUD** (`PlayerHudView`) — a render cache of the snapshot;
  - the **room cache** + any **generated room JSON** — generation caches;
  - the **world bible** — initial canon, never a SaveGame/state ([ADR-0022](../decisions/ADR-0022-world-bible-seed-v0.md));
  - **memories** (NPC/room), **prompts**, **LLM text**, and all **transient UI state**.

A load reads exactly one authoritative field from the slot — `saveGameJson` — and runs
it through the integrity boundary. Everything else in the slot is decoration.

## 5. v0 scope

Wire the existing `SaveGameService` into the browser composition root behind a tiny
injected slot store and a tiny presentational control:

1. **Save:** `saveGameService.saveSession(activePlay.sessionId)` → on `ok`, write the
   JSON into the named `localStorage` slot (with display-only wrapper metadata).
2. **Continue (load):** read the slot → `saveGameService.loadSession(json)` → on `ok`,
   `worldSession.getWorldState(sessionId)` → rebuild `ActivePlay` via the pure
   restore helper (re-resolve `currentRoomId`, project HUD) → `setActivePlay` /
   `setPlayerHud` / set the notice if degraded.
3. **Honest restoration:** authored current room → faithful; generated/non-authored or
   unresolvable current room → re-resolve/fallback + static notice.
4. New surface only: one **pure restore helper** + tests, one **injected
   `SaveSlotStore`** (in-memory-testable logic + a thin `localStorage` binding) +
   tests, **App wiring**, and a tiny **`SaveLoadBar`** UI control. No changes to
   domain, renderer engine, persistence, server, or `RoomViewer`.

## 6. Non-goals

This slice must **not**:

- Add **backend/API/persistence wiring**, a **browser→Node client/CORS**, a
  **save/load/list endpoint**, or **browser SQLite**.
- Add **autosave**, **accounts/cloud/multi-user**, a **session browser / menu system**,
  or **multiple save slots** (v0 is one named slot).
- Persist or restore **generated `RoomSpec` / room cache content**, the **world bible**,
  **NPC/room memories**, **prompts**, **LLM config**, the **HUD**, or **UI state**.
- Add **LLM replay** or any regeneration intended to "rebuild" the original generated
  room from the prompt.
- Change the **`SaveGame` schema**, `world-session/saveGame.ts`, `WorldStore`, or
  `InMemoryWorldStore`.
- Change the **domain** (`WorldEvent`/reducer/`WorldState`/`CanonSeed`/`RoomSpec`), the
  **renderer / engine / Three.js**, or **`RoomViewer`** behavior.
- Add a **heavy UI framework, state library, or any new package** (runtime or test).
- Treat `localStorage` as a **second source of truth**, or restore anything from it
  without the full integrity boundary.
- **Log** SaveGame JSON, seed `name`, event payloads, item names, room names, dialogue,
  prompt text, or any narrative/PII (§12).

## 7. Data model

**Authoritative payload — the existing `SaveGame` document only** (unchanged,
`domain/world/saveGame.ts`):

```jsonc
{
  "schemaVersion": 1,
  "seed":     { /* CanonSeed: worldId, name, startingRoomId, initialPlayer */ },
  "log":      [ /* WorldEvent[], append-only, seq-ordered */ ],
  "snapshot": { /* WorldState: currentRoomId, player, inventory, roomStates, revision, … */ }
}
```

Produced and integrity-checked by `SaveGameService.saveSession`; re-validated by
`loadSaveGame` on every load. This is the **only** thing that crosses the truth
boundary.

**Slot wrapper — display metadata only, NOT truth** (new, browser-local):

```jsonc
{
  "label":         "Save",          // user-facing slot label (display only)
  "savedAt":       "2026-06-24T…Z", // wall-clock of the save (display only)
  "currentRoomId": "throne-room",   // optional list hint (display only)
  "saveGameJson":  "{…SaveGame…}"    // the ONLY field parsed on load
}
```

- The wrapper is what lives under the `localStorage` key (e.g. `aigm.save.slot`).
- On load, **only `saveGameJson`** is read and fed to `SaveGameService.loadSession`;
  `label`/`savedAt`/`currentRoomId` are never trusted and are re-derivable from the
  SaveGame. A garbage/missing wrapper, or a wrapper whose `saveGameJson` fails the
  integrity boundary, is a calm "couldn't load" (§11) — never a partial restore.

## 8. Restore model

A single deterministic sequence; the only new logic is a **pure** helper that turns a
restored snapshot + a room-resolve result into an `ActivePlay` descriptor.

```
Continue clicked
  └─ SaveSlotStore.read()                     → wrapper | null            (byte store)
       └─ saveGameService.loadSession(wrapper.saveGameJson)
            • loadSaveGame: JSON.parse → version gate → schema → integrity
            • store.restoreSession({ sessionId, log, snapshot })
            └─ { ok:true, sessionId }
       └─ worldSession.getWorldState(sessionId) → restored WorldState     (authoritative re-read)
       └─ adjacentPregenerator.resolveRoom(state.currentRoomId)           (existing seam)
            → { ok, room, source } | { ok:false, reason }
       └─ buildRestoredPlay(state, resolveResult, fallbackRoom)           (PURE, new)
            • roomSource    = preloadedRoomSource(resolvedRoom)
            • sessionId     = state.sessionId
            • navigation    = exampleNavigation                            (existing singleton)
            • initialPlayer = projectPlayerHud(state)                      (existing pure fn)
            • degraded      = !resolveResult.ok || resolveResult.source !== 'registry'
       └─ App: setActivePlay(play); setPlayerHud(play.initialPlayer)
               if (degraded) setNotice(FALLBACK_NOTICE)
```

- **No room cache is restored.** The seam (`AdjacentRoomPregenerator`) owns the
  module-scoped cache; after a real page reload it is empty, so restore naturally seeds
  only the resolved current room and neighbours warm/resolve on demand exactly as in
  normal play (no cache persistence — §6).
- **HUD is recomputed**, never restored: `projectPlayerHud(restoredState)`.
- **`requestVersion` guard.** `handleLoad` bumps the existing `requestVersion` ref (as
  the boot/prompt paths do) so a stale in-flight bootstrap cannot clobber the restored
  `ActivePlay`.
- **`RoomViewer` unchanged.** It receives a new `roomSource` + `sessionId` and remounts
  via its existing `useEffect` deps, rebuilding the engine and the exit/encounter/
  dialogue/effect lookups from the resolved room.
- The restored session lives in the same `worldStore` the services are bound to, so
  subsequent interaction/encounter/navigation appends continue from the restored
  revision with no rewiring.

## 9. Generated-room limitation (stated plainly)

`WorldState` never carries a `RoomSpec`, and generated room content is **not truth**,
so it is never saved. On load the current room is re-resolved **by id**:

- **Authored rooms restore faithfully.** `resolveRoom` returns `source:'registry'` and
  the player sees the exact authored room (e.g. `throne-room`, `ruined-safehouse`). No
  notice.
- **Deterministically-generated adjacents** re-resolve to the same content in v0
  (the offline `FakeRoomGenerator` is a pure function of the `adjacent:${id}` seed), but
  this is an implementation property we do not *prove* from authoritative data.
- **The prompt-generated current room (and any non-deterministic / future real-LLM
  generation) cannot be byte-faithfully restored.** Its original content came from a
  prompt-derived seed that is not in authoritative state; re-resolution yields a
  different generated room or the trusted fallback.

To stay honest, restore shows the existing static, prompt-free notice
(`FALLBACK_NOTICE`, [ADR-0020](../decisions/ADR-0020-room-generation-repair-fallback-v0.md))
**whenever the current room does not come back through the authored path** —
i.e. `degraded = !resolveResult.ok || resolveResult.source !== 'registry'`. In every
case the player resumes at the correct `currentRoomId` with the correct
inventory/health/status/`roomStates`; only the room's *visuals* are best-effort. This
is conservative on purpose (it may show the notice for a deterministically-identical
adjacent), because faithfulness of generated content cannot be asserted from truth.

## 10. UX

- **Where:** a tiny presentational `SaveLoadBar` rendered at the App level, a sibling of
  `PromptBar` / `StatusHud` / `notice` (the established overlay pattern from
  [ADR-0026](../decisions/ADR-0026-inventory-health-ui-v0.md)). All logic lives in
  `App`; the bar receives `{ canSave, hasSave, busy, error, onSave, onContinue }`.
- **Save:** enabled only when `activePlay != null`. Click → save; transient "Saved"
  confirmation. No save content is shown.
- **Continue:** enabled only when a slot exists (`hasSave`). Hidden/disabled otherwise
  (empty state — no false "Continue").
- **Busy:** both actions disabled during the async save/load.
- **Errors:** a calm `role="alert"` message ("This save could not be loaded." /
  "Couldn't save your game.") on any typed failure; never raw error text, never save
  content. Current play is untouched on a failed load.
- **No session id display in v0** (no user value; avoids needless id surfacing).
- **One named slot** in v0 (label + `savedAt` for the wrapper); multi-slot and file
  export/import are explicit follow-ups, not v0.

## 11. Failure behavior

| Situation | Detection | Handling / result | Logging |
| --- | --- | --- | --- |
| **Corrupt save** (bad JSON / wrong shape) | `loadSaveGame`: `invalid-json` / `invalid-schema` | calm "couldn't load"; **nothing restored**; current play untouched (FAILURE-MODES §10) | error `code` only |
| **Unsupported version** | `loadSaveGame`: `unsupported-version` (envelope version gate) | calm "couldn't load"; no silent migration (FAILURE-MODES §11) | `code` only |
| **Integrity mismatch** (log/seed/snapshot disagree) | `loadSaveGame`: `integrity-mismatch` | reject whole save; nothing restored | `code` (+ `sessionId` if known) |
| **Same session already loaded** | `restoreSession` → `already-exists` (mapped by `SaveGameService`) | calm "this session is already loaded"; no-op (unreachable after a real reload — store starts empty) | `sessionId` / `code` |
| **Generated room cache missing** | by design — content was never saved | re-resolve via seam; safe/fallback room + static notice; correct authoritative state | seam ids/`source` only |
| **Current room cannot be resolved** | `resolveRoom` → `{ ok:false }` (`invalid-room`/`unavailable`) | substitute trusted fallback under `currentRoomId`; `degraded = true` → notice; state still correct | `roomId` / `reason` |
| **Load while a session is active** | always true after boot (an example session exists) | a *different* `sessionId` restores alongside it and `ActivePlay` is **replaced**; unsaved current progress is lost (documented, §3.6) | `sessionId` only |
| **localStorage unavailable / blocked** | `SaveSlotStore` get/set wrapped in try/catch | reads → treat as no slot (Continue hidden); writes → calm "couldn't save"; never throws into render | `code` only |
| **localStorage quota exceeded on save** | write throws `QuotaExceededError` | calm "couldn't save your game"; existing slot (if any) left intact | `code` only |

No path lets a load show unverified bytes, and no UI action has a write path to the
event log or store beyond the normal validated `appendEvent`/`restoreSession`.

## 12. Log safety

- **May log:** ids/counts/codes/enums only — `sessionId`, `revision`, `eventCount`, the
  typed error `code`, the seam's `roomId`/`source`, a `restored:'authored'|'degraded'`
  flag, and `hasSave` booleans. (`SaveGameService` already logs codes/ids/counts only,
  per FAILURE-MODES §10 / §11.)
- **Never log:** the SaveGame JSON or slot wrapper, `seed.name`, event payloads, item
  names/ids, `status` strings, health values, `currentRoomId` *content* beyond the
  structural id the seam already logs, room/NPC display names, dialogue, prompt/seed
  text, or any narrative/PII. The pure restore helper and `SaveLoadBar` log nothing; the
  slot store logs codes only.

## 13. Tests (Vitest; co-located; pure only; no DOM, no new deps)

- **Reuse:** `world-session/saveGame.test.ts` already covers the serialize/deserialize/
  integrity/version boundary — **unchanged**.
- **Pure restore helper (`app/buildRestoredPlay.test.ts`):**
  - authored resolve (`source:'registry'`) → `degraded:false`, `roomSource` wraps the
    resolved room, `sessionId`/`navigation` set, `initialPlayer === projectPlayerHud(state)`;
  - generated resolve (`source:'generated'`) → `degraded:true`;
  - failed resolve (`{ ok:false }`) → `degraded:true`, room is the injected fallback
    under `currentRoomId`;
  - **no-mutation / truth-authority:** the input `WorldState` is deep-equal before and
    after; the helper imports no store/service and produces only an `ActivePlay`
    descriptor (no `WorldCommand`/`WorldEvent`).
- **Slot store logic (`app/saveSlotStore.test.ts`) over an in-memory `KeyValueStore`
  fake:**
  - write→read round-trips the wrapper; **only `saveGameJson` is returned for loading**
    (metadata is display-only and ignored by the load path);
  - key namespacing; `has()` / `clear()`; absent slot → `null`;
  - a **throwing** fake (unavailable / quota) maps to typed results, never throws.
- **No DOM/component tests, no App-wiring tests.** Env is node with no `jsdom`; the thin
  `localStorage` binding stays behind the injected `SaveSlotStore` interface and is
  exercised manually in the running app. **No test dependency is added.**

## 14. Proposed source slices

Each slice keeps `npm run build` / `npm run lint` / `npm run test` (in `apps/web`)
green; the maintainer commits each manually.

1. **`feat(app): pure session restore helper`** — `app/buildRestoredPlay.ts`
   (+ `buildRestoredPlay.test.ts`). Pure; takes `(state, resolveResult, fallbackRoom)`
   → `ActivePlay` descriptor + `degraded` flag. Not yet wired.
2. **`feat(app): browser save-slot store`** — `app/saveSlotStore.ts`: a `SaveSlotStore`
   interface + a small `KeyValueStore` seam, the wrapper read/write logic, and a thin
   `LocalStorageSaveSlotStore` binding. Logic tested via an in-memory fake
   (+ `saveSlotStore.test.ts`); the `localStorage` binding untested by design.
3. **`feat(app): wire manual save/load`** — `App.tsx` constructs `SaveGameService` over
   the existing `worldStore` and a `SaveSlotStore`; adds `handleSave` / `handleLoad`
   (with `requestVersion` guarding and typed-error → calm-message mapping); renders
   `<SaveLoadBar>` as an App-level overlay. No domain/service/renderer/`RoomViewer`
   change.
4. **`feat(ui): SaveLoadBar control`** *(may merge with slice 3)* —
   `renderer/ui/SaveLoadBar.tsx` (presentational) + minimal `.save-load-bar*` styles in
   `index.css`.
5. **`docs(architecture): record session-save-load-v0`** *(closeout — after source
   review)* — **create ADR-0027**; add a FAILURE-MODES case (browser session save/load);
   note the slice in ARCHITECTURE and AGENTS.md; touch BOUNDARIES only if a rule
   actually changed (not anticipated — see §16); flip this plan and ADR-0027 to
   *implemented*.

## 15. Files likely to change

- **New (composition / app):** `app/buildRestoredPlay.ts` (+ test),
  `app/saveSlotStore.ts` (+ test).
- **New (UI):** `renderer/ui/SaveLoadBar.tsx`.
- **Edited (composition root):** `App.tsx` (construct `SaveGameService` + `SaveSlotStore`,
  `handleSave`/`handleLoad`, render the overlay); `index.css` (`.save-load-bar*` styles).
- **Docs (slice 5, closeout):** new `ADR-0027`; `FAILURE-MODES.md` (new case);
  `ARCHITECTURE.md` + `AGENTS.md` (short status); `BOUNDARIES.md` only if needed; this
  plan flipped to *implemented*.
- **Deliberately NOT changed:** `domain/world/saveGame.ts` and the `SaveGame` schema,
  `world-session/saveGame.ts`, `domain/ports/WorldStore.ts`,
  `world-session/InMemoryWorldStore.ts` (`restoreSession` already exists),
  `persistence/**`, `server/**`, `renderer/engine/**` (no Three.js change),
  `renderer/RoomViewer.tsx` (a load is just a new `ActivePlay`), `eslint.config.js`
  (no new rule expected — §16), `package.json` (no new dependency).

## 16. Wording risks (called out deliberately)

- **"save / load" ≠ persistence engine.** v0 is **one manual `localStorage` slot**
  round-tripping the existing authoritative `SaveGame`. It is **not** autosave, **not**
  multi-slot, **not** a session browser, **not** backend/cloud persistence. The byte
  store is incidental; the truth is the event-log-derived `SaveGame`.
- **"restore the session" ≠ "restore the room you saw."** Authoritative *state* is
  restored faithfully; generated room *content* is best-effort (§9). The plan and UI
  must not imply pixel-faithful room restoration for generated rooms.
- **"localStorage" must never read as a source of truth.** It holds a wrapper whose only
  authoritative field (`saveGameJson`) is re-validated on every load; the metadata is
  decoration.
- **Restore wires `navigation` via the existing example seam.** A restored session
  becomes navigable through `exampleNavigation` even if it was originally a prompt
  session (which had no navigation). This is a deliberate, minimal reuse of existing
  singletons (adds nothing); the alternative (restore with `navigation` undefined,
  matching prompt sessions) is noted here in case review prefers it.
- **`localStorage` access lives in `app/`** (browser composition). It is a browser/DOM
  global, **not** `persistence/**` / `node:*`, so it crosses **no** boundary rule; no
  `eslint.config.js` change is anticipated. If implementation surfaces a real rule gap,
  the smallest necessary edit is made and recorded in closeout.

## 17. ADR timing (explicit)

**ADR-0027 is NOT created now.** Per the established cadence (mirrored in
[ADR-0026](../decisions/ADR-0026-inventory-health-ui-v0.md)'s plan), the ADR is written
in the **docs closeout, after the source implementation has been reviewed** — so it
records what was actually built, not a forecast. This plan is the pre-code artifact;
ADR-0027 + the ARCHITECTURE/FAILURE-MODES/AGENTS updates land in slice 5.
