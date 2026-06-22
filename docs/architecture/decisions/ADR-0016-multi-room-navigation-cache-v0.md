# ADR-0016: Multi-Room Navigation & Cache v0 — entering rooms through `moved-to-room` with an in-memory session cache

- **Status:** Accepted — **design / not yet implemented** (implementation brief for Codex)
- **Date:** 2026-06-22
- **Deciders:** Project owner

> This ADR is an **approved design / implementation brief**, not yet built. It is
> the binding brief Codex implements; the maintainer commits manually. When the
> code lands, the final docs commit flips this status to *implemented* (mirroring
> [ADR-0014](./ADR-0014-object-interactions-v0.md) /
> [ADR-0015](./ADR-0015-encounter-system-v0.md)).

## Context

Everything renders **one room**. `RoomSource.getRoom()` yields a single
`LoadedRoom` ([RoomSource.ts](../../../apps/web/src/domain/ports/RoomSource.ts));
`StaticRoomSource` returns the hardcoded `throneRoom`, `GeneratedRoomSource`
returns a prompt-seeded one. A room's `shell.exits[]` is **geometric only**
(`{ side, width }`): [`buildShell`](../../../apps/web/src/renderer/engine/builders/shell.ts)
splits the north wall around a north exit to leave a walkable gap, and the
`arch` object is decorative scenery placed in that gap. **There is no way to
*enter* an exit.**

**World State & Event Log v0** ([ADR-0013](./ADR-0013-world-state-event-log-v0.md))
already models movement: `moved-to-room { fromRoomId?, toRoomId }` sets
`currentRoomId = toRoomId` and **marks `roomStates[toRoomId].visited = true`
(merge-preserving existing flags)**, and `session-started` marks the starting
room visited. The only write path is "append a typed, validated event, then
project" through `WorldSession.appendEvent`; `WorldSession.move()` is the
`moved-to-room` command builder.

**Object Interactions v0** ([ADR-0014](./ADR-0014-object-interactions-v0.md)) and
**Encounter System v0** ([ADR-0015](./ADR-0015-encounter-system-v0.md)) record
one-shot resolution under `state.roomStates[currentRoomId].flags[key]`. But both
slices start an **ephemeral session per room load** in `RoomViewer`'s effect —
so a re-mount or a room change starts a *fresh* session and loses those flags.

This slice adds the first **multi-room gameplay foundation**: an interactable
**door** can be entered; entering appends `moved-to-room` through `WorldSession`;
visited rooms are marked by the existing reducer; loaded `RoomSpec`s are
**cached in-memory for the session**; and **returning to a room reuses the
cached room and its accumulated world-state** (visited flag + interaction /
encounter resolution flags intact). It does this while preserving every existing
boundary — especially that the **renderer only emits intent and never mutates
world state** — and with **no new world-session event type**, **no real
backend / DB / HTTP / LLM**, and **no adjacent-room pre-generation**
([ADR-0009](./ADR-0009-adjacent-room-pre-generation.md) stays future).

## Maintainer-approved decisions (binding for this slice)

This brief was approved with these explicit choices:

1. **Engine reload mechanism (Q1):** **rebuild the engine per navigation.** Do
   **not** make `Engine.setRoom` re-entrant in this slice, and do not otherwise
   touch the trusted engine lifecycle. Navigation changes the active room, which
   re-runs `RoomViewer`'s existing engine effect (dispose old engine → build new
   engine → render the target room) — the same teardown/rebuild that already
   happens on a room-source change. **Zero engine change.**
2. **Exit trigger model (Q2):** reuse the existing E/F intent flow by turning a
   doorway (`arch`) into an **interactable object** that carries
   `interaction.exit: { toRoomId }`. **Do not** derive interactables from
   `shell.exits` wall gaps in this slice (that would require an engine change).
3. **Trigger precedence (Q3):** when an object carries more than one of these,
   resolve in the order **exit → encounter → effect**.
4. **PromptBar / generation (Q4):** leave generation exactly as today. A
   generated room remains a **fresh single-room session** and is **not** wired
   into multi-room navigation. Do **not** disable the `PromptBar` unless
   implementation reveals a real conflict — **if there is a conflict, STOP and
   ask the maintainer.**
5. **No new world-session event type.** Navigation uses the existing
   `moved-to-room`; visited marking relies on the existing reducer behavior
   (`moved-to-room` / `session-started`). **No `room-state-changed` is emitted by
   navigation.** ADR-0013's seven-event closed union stays stable. *(If
   implementation appears to need a new event type, STOP and ask first.)*

## Decision

Add a thin navigation layer **between** the engine's "interaction-open intent"
and the world-session write path, and wire it at the composition root. A door is
just an interactable object whose `interaction` carries an `exit`; the engine is
untouched and still emits only a neutral object `id`.

```
 Engine (renderer)                 — emits intent only; no navigation/world-session import
   onRequestOpenInteraction(target: Interactable)        target carries a stable id
        │
        ▼  (composition root maps id → { toRoomId } from the LoadedRoom; exit wins over encounter/effect)
 NavigationService.navigate({ sessionId, toRoomId })     — APPLICATION (composition)
        │   1. resolveRoom(toRoomId): SessionRoomCache hit, else RoomRegistry → loadRoomSpec → cache.set
        │      (RESOLVE-BEFORE-APPEND — never record a move into a room we cannot render)
        │   2. session.getWorldState(sessionId)          read fresh currentRoomId + revision
        │   3. self-nav guard: toRoomId === currentRoomId → rejected: already-here (no append)
        │   4. session.move(sessionId, toRoomId, revision, fromRoomId = currentRoomId)
        ▼
 WorldSession.appendEvent → applyEvent → WorldStore.commit     (ADR-0013 write path; reducer marks visited)
        │
        ▼  typed NavigationResult → composition root sets the active room → RoomViewer rebuilds the engine
           and renders the CACHED LoadedRoom (no regeneration)
```

The **world-state change is a single existing `moved-to-room`**, so there is no
pure-domain planner here (unlike `planInteraction` / `planEncounter`, there is no
fixed-vocabulary effect mapping to make pure — see *Alternatives*). The new,
unit-testable logic is **room resolution (cache hit / miss → registry)**, the
**self-nav guard**, and the **resolve-before-append ordering**, all in the
composition-layer `NavigationService`. The **renderer is untouched** — it already
passes `target.id` through `onRequestOpenInteraction`, which is all the exit
trigger needs.

### Architectural rules (binding)

1. **The renderer only emits intent.** The engine never imports navigation, the
   registry, the cache, or `world-session`, never holds a `NavigationService`,
   and never mutates `WorldState`. **No engine change and no `Interactable`
   change** is required — `id` already flows through. **No re-entrant
   `setRoom`** (Q1). **No interactables derived from `shell.exits`** (Q2).
2. **All state changes go through `WorldSession.appendEvent`** — the ADR-0013
   single write path. Navigation appends only `moved-to-room` (via
   `WorldSession.move`). No new write path, no direct snapshot setters.
3. **No new world-session event type** (decision 5). Visited marking is left to
   the existing `moved-to-room` / `session-started` reducer behavior; navigation
   never emits `room-state-changed`.
4. **Resolve before append.** The target room is resolved (and, on a miss,
   loaded + validated through `loadRoomSpec`) **before** `moved-to-room` is
   appended, so a move into an unrenderable room is never recorded.
5. **One session per play session; rooms cached in-memory.** The `WorldSession`
   identity (`sessionId`) and the `SessionRoomCache` are created **once** and
   persist across every navigation, so `roomStates` (visited + resolution flags)
   accumulate and **returning to a room reuses the cached `LoadedRoom` and its
   prior flags**. They are **not** recreated when the engine rebuilds.
6. **Cache-first; no regeneration.** A cache hit reuses the stored `LoadedRoom`
   verbatim — no re-parse, no re-validate, no regeneration. Rebuilding the
   Three.js scene from a cached spec is **presentation**, not room regeneration.
7. **Expected failures are typed results, never thrown** (`missing-exit`,
   `unknown-room`, `already-here`, `conflict`, `not-found`, `invalid-room`,
   `unavailable`). Genuine bugs may still throw.
8. **Exits are data only.** `exit: { toRoomId }` is a zod-validated descriptor —
   never code, never `eval`'d ([ADR-0001](./ADR-0001-data-only-room-spec-trusted-renderer.md)).
   `toRoomId` is a plain string; **the domain does not check room existence**
   (no room store in the domain — [ADR-0013](./ADR-0013-world-state-event-log-v0.md));
   existence is validated at the navigation boundary (registry / cache).
9. **Logs carry ids / codes / counts only** — `sessionId`, `toRoomId` (an
   authored id, like the existing `room received` log), `status`/`reason` code,
   `cacheHit`, `revision`. **Never** room `name` or any narrative/user content
   (ADR-0013 rule 10, [ADR-0003](./ADR-0003-logging-abstraction.md)).
10. **Ports + constructor injection; no new framework** (AGENTS.md rule 13).

## Scope (v0)

**In scope:**

- A `RoomSpec` change: optional `exit: { toRoomId }` on the shared `Interaction`,
  and optional `interaction` on the `Arch` object so a doorway can be triggered.
- `room/RoomRegistry.ts` (composition): resolves a `roomId` → a `LoadedRoom` over
  the example world via `loadRoomSpec` (the multi-room analog of
  `StaticRoomSource`).
- `room/SessionRoomCache.ts` (composition): an in-memory `Map<roomId, LoadedRoom>`
  for one play session.
- `app/NavigationService.ts` (composition): coordinates resolve (cache/registry)
  + `WorldSession.move`, returning a typed `NavigationResult`.
- `app/exits.ts` (pure composition helper): `buildExitLookup(room)` +
  `navigationResultMessage(result)`, mirroring `app/encounters.ts`.
- Composition wiring (commit 3): lift the session + cache to persist across
  navigations; `RoomViewer` builds the exit lookup and routes exit intent
  (precedence exit → encounter → effect) to an `onNavigate` callback instead of
  opening the panel, and stops starting its own session (uses the injected
  `sessionId`); connect the `throne-room` ⇄ `ruined-safehouse` north arches.
- ADR (this file, now) + architecture-doc / boundary / failure-mode / AGENTS
  updates (commit 4).

**Out of scope / non-goals (must NOT be built in this slice):**

- ❌ New world-session event types (decision 5) — **stop and ask** if one seems needed.
- ❌ Re-entrant `Engine.setRoom` or any trusted-engine lifecycle change (Q1).
- ❌ Interactables derived from `shell.exits` wall gaps (Q2).
- ❌ Entry-point / door-aligned spawn — the player arrives at the **target
  room's own `spawn`**; matching-door placement is deferred.
- ❌ Adjacent-room pre-generation, room status lifecycle, parallel jobs
  ([ADR-0009](./ADR-0009-adjacent-room-pre-generation.md) stays future).
- ❌ Real backend, DB/SQLite/Postgres, HTTP/`apps/api`, `packages/contracts`.
- ❌ Real LLM; wiring generated rooms into navigation (Q4).
- ❌ More than the two connected example rooms; directional / locked / conditional
  / secret exits; multi-exit-per-side modeling.
- ❌ Minimap, transition animation, "Opening the way…" status UI.
- ❌ HUD / inventory redesign; NPC dialogue; combat expansion.
- ❌ First-person / free-camera / camera work; GLTF/animation.
- ❌ Renderer importing navigation / registry / cache / world-session, or mutating state.

## Data model

Exact zod 4 calls are Codex's choice; the constraints below are binding.

### RoomSpec changes (`domain/roomSpec.ts`)

- Add `exit` to the **shared `Interaction`** object, alongside the existing
  `effect` and `encounter`:
  `exit: z.object({ toRoomId: z.string().min(1) }).strict().optional()`.
  Because `Interaction` is embedded in `scroll`/`npc` (required) and optional on
  `crate`/`barrel`/`debris`/`barricade`/`zombie`, any object that can carry an
  interaction can carry an exit — but in v0 the door is an `arch`.
- Add `interaction: Interaction.optional()` to the **`Arch`** object (today
  `Arch` has no `interaction`). An `arch` with no `interaction` stays decorative
  (today's behavior); an `arch` with `interaction.exit` is a usable door.
- An `Interaction` with `exit` and no `effect`/`encounter` is valid (a pure
  door). An `Interaction` with none of the three stays valid (presentation-only).
- `exit` is defined **inline** in `roomSpec.ts` (like the existing `shell.exits`
  array schema) — **no new domain file, no new import, no import cycle.**
- **No `shell.exits` schema change** in this slice (it stays geometric; the door
  is an object).

### `Interactable` view-model (`domain/ports/interaction.ts`)

- **No change.** The engine already passes `target.id`; the composition root maps
  the id to an exit. **No `exit` field is added to `Interactable`** — the engine
  and UI never learn about navigation.

## Room registry (`room/RoomRegistry.ts`)

Composition-layer adapter; the multi-room analog of `StaticRoomSource`. For v0 it
holds the example world `{ 'throne-room': throneRoom, 'ruined-safehouse':
ruinedRoom }` and runs each through the same `loadRoomSpec` boundary every source
uses (trusted authored data, so — like `StaticRoomSource` — it does **not** run
`validateRoom`).

```
resolve(roomId: string):
  | { ok: true; room: LoadedRoom }
  | { ok: false; reason: 'unknown-room' | 'invalid-room' }
```

- `unknown-room`: the id is not registered.
- `invalid-room`: `loadRoomSpec` threw (a bad envelope). The example rooms are
  valid, so this can't fire today, but the contract models it (mirrors
  `StaticRoomSource`'s try/catch). A future room store / LLM swaps in behind this
  same shape with no caller change.

## Session room cache (`room/SessionRoomCache.ts`)

A dumb in-memory holder for one play session — `get(roomId)`, `set(roomId, room)`,
`has(roomId)` over a `Map<string, LoadedRoom>`. Cache hits reuse the stored
`LoadedRoom` verbatim. A fresh cache is created per play session (e.g. a new game
or a prompt-driven generated room). Resolve-or-load coordination lives in
`NavigationService`, keeping the cache single-responsibility.

## Application service (`app/NavigationService.ts`)

Composition-layer coordinator (it legitimately needs **both** room loading and
the world session, so it is composition, not a headless `world-session`-only
layer). Constructor-injected with a `WorldSession` (the
`Pick<WorldSession, 'getWorldState' | 'move'>` shape is sufficient), a
`RoomRegistry`, a `SessionRoomCache`, and a `Logger` (DI = constructor params).

**`resolveRoom(roomId)`** (cache-first; used by `navigate` and reusable by the
App bootstrap):

1. `cache.get(roomId)` present → `{ ok: true, room, cacheHit: true }`.
2. else `registry.resolve(roomId)`:
   - `ok` → `cache.set(roomId, room)` → `{ ok: true, room, cacheHit: false }`.
   - `unknown-room` / `invalid-room` → `{ ok: false, reason }`.

**`navigate({ sessionId, toRoomId })` → `Promise<NavigationResult>`:**

1. `r = await resolveRoom(toRoomId)` (**resolve-before-append**). Not ok →
   `unknown-room` → `rejected: unknown-room`; `invalid-room` → `failed: invalid-room`.
   *(A future async/throwing source maps to `failed: unavailable`.)*
2. `cur = await session.getWorldState(sessionId)`; not ok → `failed: not-found`.
3. `toRoomId === cur.state.currentRoomId` → `rejected: already-here` (no append).
4. `moved = await session.move(sessionId, toRoomId, cur.state.revision, cur.state.currentRoomId)`;
   not ok → map `conflict` → `failed: conflict`, `not-found` → `failed: not-found`,
   other → `failed: conflict`.
5. → `{ status: 'navigated', room: r.room, state: moved.state, cacheHit: r.cacheHit }`.

```
type NavigationResult =
  | { status: 'navigated'; room: LoadedRoom; state: WorldState; cacheHit: boolean }
  | { status: 'rejected'; reason: 'missing-exit' | 'unknown-room' | 'already-here' }
  | { status: 'failed';   reason: 'conflict' | 'not-found' | 'invalid-room' | 'unavailable' }
```

`missing-exit` is produced by the **caller / composition** when an interactable
object has no `exit` (the lookup miss) — the navigation peer of
`missing-effect` / `missing-encounter`; document it as a composition-level
rejection. `WorldSession.move` already validates `fromRoomId === currentRoomId`,
which step 4 satisfies by construction.

**Logging:** `sessionId`, `toRoomId`, result `status`/`reason` code, `cacheHit`,
and `revision` only — never room `name` or any narrative/user content (rule 9).

## Composition-root wiring (commit 3)

Keep it small; the renderer stays import-clean and the engine is untouched.

- **Pure helper (`app/exits.ts`):** `buildExitLookup(room): ReadonlyMap<string, {
  toRoomId: string }>` from `room.objects` (objects whose `interaction.exit` is
  present **and** that have an `id`; skip id-less / exit-less; dedup first-wins —
  mirrors `buildEncounterLookup`). Add `navigationResultMessage(result)` for any
  transient line (display strings live here, e.g. `unknown-room`/`missing-exit` →
  "The way is blocked."). Keep both pure and unit-testable without the DOM.
- **`App.tsx` (composition root):**
  - Construct **once** (persisting across navigations): the `RoomRegistry`, a
    `SessionRoomCache`, and a `NavigationService` (reusing the existing
    module-scope `WorldSession`).
  - **Bootstrap once:** `resolveRoom(startingRoomId)` (caching the starting
    room), then `startSession(canon)` derived from that room (`startingRoomId =
    room.id`, defaults as today). Hold `sessionId`; **do not recreate it on
    navigation.** This moves session-start **out of** `RoomViewer`'s per-room
    effect — the key structural change that lets `roomStates` survive transitions.
  - Hold the **active room** and expose `navigate(toRoomId)`:
    `NavigationService.navigate({ sessionId, toRoomId })` → on `navigated`, set
    the active room to the returned cached `LoadedRoom` (a new identity so
    `RoomViewer`'s engine effect re-runs and rebuilds — the Q1 mechanism); on
    `rejected`/`failed`, surface a calm message and **do not** change the room.
  - The active room may be passed to `RoomViewer` either as a tiny preloaded
    `RoomSource` wrapping the cached `LoadedRoom` (smallest `RoomViewer` diff,
    reuses its existing load/fallback path) or as the `LoadedRoom` directly —
    Codex's choice, provided the session is **not** recreated per navigation.
- **`RoomViewer.tsx` (composition root):**
  - **Stop starting the session** (`startRoomSession`); use the **injected
    `sessionId`**. The world session now outlives any single engine.
  - Build the **exit lookup** alongside the existing effect/encounter lookups.
  - In `onRequestOpenInteraction(target)`, apply **precedence exit → encounter →
    effect** (Q3): if `target.id` resolves to an **exit**, call
    `onNavigate(toRoomId)` and **do not open the dialogue panel** (a door is not
    a dialogue); otherwise fall through to today's encounter, then effect, paths.
  - The engine effect is **unchanged in shape**; it disposes and rebuilds when the
    active room changes (Q1). No engine import of navigation.
- **Engine (`renderer/engine/Engine.ts`): no change.**
- **`DialoguePanel` / `Hud`: no change** (no door panel, no redesign).
- **Example rooms (`throneRoom.ts`, `ruinedRoom.ts`), data only:** give each
  room's north `arch` an `id` and `interaction.exit`:
  - `throne-room` north arch → `{ id: 'north-door', interaction: { key: 'E',
    prompt: 'Press E to leave through the north arch', exit: { toRoomId:
    'ruined-safehouse' } } }`.
  - `ruined-safehouse` north arch → the mirror, `exit.toRoomId: 'throne-room'`.
  This forms a two-room loop. The player arrives at the **target room's own
  spawn** (entry-point placement is out of scope).
- **PromptBar / generation: unchanged** (Q4). A generated room has no exits;
  submitting a prompt remains a fresh single-room session with its own fresh
  cache. **If wiring reveals a real conflict between the generation path and the
  persistent session/cache, STOP and ask the maintainer** rather than disabling
  the `PromptBar`.

## Failure modes (to add to [FAILURE-MODES.md](../FAILURE-MODES.md))

New case **14 — Multi-room navigation** (peer of cases 12 / 13):

| Situation | Detection | Handling / result | Logging |
| --- | --- | --- | --- |
| Object is not a door (no `exit`) | composition exit-lookup miss | `rejected: missing-exit`; fall through to encounter/effect or plain panel | code only |
| Exit targets an unregistered/uncached room | registry/cache miss | `rejected: unknown-room`; **no `moved-to-room` appended**; calm "the way is blocked" | code, toRoomId |
| Target spec fails to load | registry `loadRoomSpec` throw | `failed: invalid-room`; no move appended; safe message | code |
| Navigate to the current room | self-nav guard | `rejected: already-here`; no move appended | code |
| Stale `expectedRevision` on the move | `appendEvent` → `conflict` | `failed: conflict`; no retry; caller may re-read | code, revision |
| Missing session on the move | `getWorldState`/`move` → not-found | `failed: not-found` | code |
| Return to a visited room | cache hit + persistent session | cached `LoadedRoom` reused; `roomStates` flags (visited + interaction/encounter resolution) intact; no regeneration | code, cacheHit |

**Resolve-before-append (consistency rule):** the target room is resolved (and
loaded/validated on a miss) **before** `moved-to-room` is appended, so the log
never records a move into a room that cannot be rendered. **Single-writer:** v0
has one in-process writer and `navigate` reads the fresh `revision` via
`getWorldState` immediately before `move`, so a `conflict` cannot occur in
practice (mirrors cases 12/13); if it ever did, the typed `failed: conflict`
reports it without a retry. **Visited marking** is the existing reducer's job
(`moved-to-room` / `session-started`); navigation adds no `room-state-changed`.

## Boundaries (encoded with the shipped code)

- The `domain/roomSpec.ts` change (inline `exit` + `Arch.interaction`) is covered
  by the existing `src/domain/**` lint block (zod only; no React/Three/renderer/
  UI/platform). **No new domain file and no domain lint change.**
- `room/RoomRegistry.ts`, `room/SessionRoomCache.ts`, `app/NavigationService.ts`,
  and `app/exits.ts` are **composition layer** (`App.tsx`/`RoomViewer.tsx`/`app/`/
  `room/` per [BOUNDARIES](../BOUNDARIES.md)), which may import everything. **No
  new `no-restricted-imports` block is added** — and this is deliberate:
  navigation legitimately needs both room loading and the world session, so it
  belongs in composition, not in a headless folder like `interactions/` /
  `encounters/`. (Contrast ADR-0014/0015, which *did* add headless lint blocks.)
- The engine is untouched, so its existing lint block (forbidding `react`/
  `react-dom`, `**/world-session/**`, `**/interactions/**`, `**/encounters/**`)
  stays as-is. The renderer-intent-only rule holds **by construction** — the
  engine emits `target.id` and the composition root owns navigation, exactly as
  it already owns the effect/encounter lookups the engine never imports.
- No engine objects ever enter the `exit` descriptor, the registry/cache, or the
  `NavigationResult` ([ADR-0008](./ADR-0008-renderer-portability-strategy.md)).

## Commit plan

Small, independently buildable/testable commits (AGENTS.md rule 12). Codex
implements; the maintainer commits manually. Each commit must leave `npm run
build`, `npm run lint`, and `npm run test` (in `apps/web`) passing. **This ADR is
created first (now), as accepted design / not yet implemented.**

1. **`feat(domain): add room-exit field to the interaction contract`** — inline
   `exit: { toRoomId }` on the shared `Interaction`; optional `interaction` on
   `Arch`; schema tests. Backward-compatible; no behavior, no wiring.
2. **`feat(app): add room registry, session cache, and navigation service`** —
   `room/RoomRegistry.ts`, `room/SessionRoomCache.ts`, `app/NavigationService.ts`,
   `app/exits.ts`, and unit tests (fake registry/cache + `InMemoryWorldStore` +
   fake `Clock`/`IdGenerator`). No renderer wiring.
3. **`feat(app): wire multi-room navigation and connect the example rooms`** —
   lift the session + cache to `App` (created once); `App.navigate` swaps the
   active room; `RoomViewer` builds the exit lookup, applies precedence
   (exit → encounter → effect), routes exit intent to `onNavigate`, and stops
   starting its own session; connect the `throne-room` ⇄ `ruined-safehouse`
   arches; pure-helper tests. **No engine change.**
4. **`docs(architecture): record multi-room navigation v0`** — flip this ADR to
   *implemented*; add the navigation layer to [ARCHITECTURE.md](../ARCHITECTURE.md),
   [BOUNDARIES.md](../BOUNDARIES.md) (composition note), [FAILURE-MODES.md](../FAILURE-MODES.md)
   (case 14), and the [AGENTS.md](../../../AGENTS.md) status paragraph.

## Files likely to change

- **New:** `apps/web/src/room/RoomRegistry.ts` (+`.test.ts`),
  `apps/web/src/room/SessionRoomCache.ts` (+`.test.ts`),
  `apps/web/src/app/NavigationService.ts` (+`.test.ts`),
  `apps/web/src/app/exits.ts` (+`.test.ts`), this ADR.
- **Edited (core):** `apps/web/src/domain/roomSpec.ts`,
  `apps/web/src/domain/roomSpec.test.ts`.
- **Edited (wiring, commit 3):** `apps/web/src/App.tsx`,
  `apps/web/src/renderer/RoomViewer.tsx`,
  `apps/web/src/domain/examples/throneRoom.ts`,
  `apps/web/src/domain/examples/ruinedRoom.ts`.
- **Docs (commit 4):** `ARCHITECTURE.md`, `BOUNDARIES.md`, `FAILURE-MODES.md`, `AGENTS.md`.
- **Not changed:** `apps/web/src/renderer/engine/Engine.ts` (no re-entrant
  `setRoom`, no new callback), `apps/web/src/domain/ports/interaction.ts`,
  `apps/web/src/domain/world/**` (no new event type),
  `apps/web/src/world-session/**`, `apps/web/eslint.config.js` (no new block),
  `apps/web/src/renderer/ui/**`.

## Tests (Vitest; co-located; no browser/e2e)

- **Schema (`roomSpec.test.ts`):** `interaction.exit` parses and is optional; an
  `Arch` with and without `interaction` both parse; an `Interaction` carrying
  `exit` + `encounter` + `effect` together parses (precedence is a composition
  concern); the updated example rooms still `loadRoomSpec` clean.
- **`RoomRegistry`:** known id → `ok` with the expected room; unknown id →
  `unknown-room`.
- **`SessionRoomCache`:** miss → `set` → hit returns the **identical**
  `LoadedRoom` reference; instances are isolated.
- **`NavigationService` (fake registry/cache + `InMemoryWorldStore`):** cache
  miss → registry load + `set` + `cacheHit:false`; second navigate to the same
  room → `cacheHit:true`, no reload; `navigated` appends **exactly one**
  `moved-to-room`, bumps `revision`, and sets `roomStates[toRoomId].visited`;
  **resolve-before-append** (load failure → **no** event appended); self-nav →
  `already-here`, nothing appended; unknown room → `rejected`, nothing appended;
  `not-found`/`conflict` mapping; **returning preserves resolution flags** (set a
  flag in room A's `roomStates`, navigate A→B→A, assert the flag is still set and
  `projectWorldState(log) deepEquals snapshot`); **log-safety** (assert room
  `name`/narrative never reach the logger — mirrors ADR-0013/0014/0015).
- **`app/exits.ts`:** `buildExitLookup` maps `id → { toRoomId }`, skips id-less /
  exit-less objects, dedup first-wins; `navigationResultMessage` per status.
- **Composition:** do **not** add WebGL/DOM e2e tests (consistent with
  `RoomViewer` having no unit test) — coverage is via the pure helpers + service.

## Consequences

- The game becomes **multi-room**: an interactable door appends a real
  `moved-to-room` through the unchanged ADR-0013 write path, the existing reducer
  marks the room visited, and returning reuses the cached room **and** the
  accumulated `roomStates` flags — so an interaction/encounter resolved in a room
  stays resolved on return. The renderer still emits only intent.
- The event union and the world-session write path are untouched (no new event
  type), so this slice adds **no domain risk** to the authoritative-truth layer.
- Lifting the session + cache out of `RoomViewer`'s per-room effect fixes the
  ephemeral-session limitation that ADR-0014/0015 left in place, giving multi-room
  state a single persistent home without a DB.
- Rebuilding the engine per navigation (Q1) keeps the trusted engine untouched at
  the cost of a per-transition WebGL re-init — acceptable for a two-room v0; a
  smoother re-entrant `setRoom` can be revisited later behind the same boundary.
- The `RoomRegistry` is the seam where a real room store / LLM-backed source
  later slots in (behind the same `resolve(roomId)` shape), and adjacent-room
  pre-generation ([ADR-0009](./ADR-0009-adjacent-room-pre-generation.md)) layers
  on top of the cache without changing the navigation contract.

## Alternatives considered

- **Derive interactables from `shell.exits` wall gaps** — rejected (Q2): would
  require the engine to synthesize interactables from geometry (an engine change);
  turning an `arch` into an interactable door reuses the existing E/F intent flow
  with **zero** engine change.
- **Re-entrant `Engine.setRoom` / one persistent engine across rooms** — deferred
  (Q1): smoother (no WebGL re-init) but modifies the trusted engine lifecycle and
  fixes a latent once-only-`setRoom` assumption; v0 rebuilds the engine per
  navigation instead. Revisit behind the same boundary later.
- **A new `room-visited` event, or emitting `room-state-changed { visited }`
  alongside `moved-to-room`** — rejected (decision 5): `moved-to-room` already
  marks `toRoomId` visited and `session-started` marks the start room; an extra
  event is redundant and would expand/duplicate ADR-0013's behavior.
- **A pure `planNavigation` domain planner** (peer of `planInteraction`/
  `planEncounter`) — rejected: there is no fixed-vocabulary effect mapping to make
  pure; the entire world-state change is the single existing `moved-to-room`. A
  planner would be ceremony with nothing to decide. The genuinely new logic
  (cache hit/miss, self-nav guard, resolve-before-append) is composition, and is
  unit-tested in `NavigationService`.
- **Model the exit as an `InteractionEffect` of kind `move-to-room` routed
  through `InteractionService`** — rejected: navigation also drives a
  *presentation* reload (swap the rendered room), which interactions never do;
  folding it into `InteractionService` conflates two responsibilities and would
  make that service detect "this outcome was a navigation" to trigger the reload.
  A separate `NavigationService` keeps SRP.
- **Append `moved-to-room` first, then resolve the room** — rejected: a resolve
  failure would leave the log asserting the player is in a room that cannot be
  rendered. Resolve-before-append guarantees consistency.
- **A headless `navigation/` folder with its own lint block** (mirroring
  `interactions/`/`encounters/`) — rejected: navigation inherently needs room
  loading (`loadRoomSpec`, the registry/cache) *and* the world session, so it is
  composition by nature; forcing it headless would invert a dependency. It lives
  in `app/`/`room/`, which already may import everything.
- **Entry-point / door-aligned spawn on arrival** — deferred: the player arrives
  at the target room's own `spawn` in v0; placing them at the matching door is a
  later refinement and is out of scope.
- **Wire generated rooms into navigation now** — rejected (Q4): generation stays a
  fresh single-room session; multi-room navigation operates over the example-room
  registry this slice.
```
