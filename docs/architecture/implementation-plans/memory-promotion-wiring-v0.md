# Implementation Plan — `feature/memory-promotion-wiring-v0`

> Status: **Implemented.**
>
> **This is Slice E** of the reconciled adoption of the external *Memory & DB Design
> v1* doc — the maintainer's working name for this task, distinct from the original
> six-slice doc's "Slice E" (`npc_relationships`, still not built). This slice does
> **not** add any new promotion logic, event type, or memory schema. It wires the
> already-shipped, previously test-only pieces — the pure promotion mapper (Slice A),
> persisted importance/dedupe (Slice C3), display-name resolution (Slice C2), and the
> `item-discovered` semantic event (Slice D) — into the live committed-interaction
> flow for the first time.
>
> Companion docs: [ARCHITECTURE](../ARCHITECTURE.md) · [BOUNDARIES](../BOUNDARIES.md) ·
> [FAILURE-MODES](../FAILURE-MODES.md). Builds on:
> `memory-event-promotion-v0` (Slice A), `memory-context-ranking-v0` (Slice B),
> `memory-display-name-persistence-v0` (Slice C, C1–C3), `memory-semantic-events-v0`
> (Slice D).

## 1. What I inspected, and why this seam

- **`WorldSession.appendEvent`** returns `{ ok: true, state, event }` per call — the
  single committed event was already available, just discarded by every caller.
- **`applyCommands`** (`world-session/applyCommands.ts`) threads a planned
  `WorldCommand[]` through `appendEvent`, one call per command, but only returned the
  final `state` — every intermediate committed `WorldEvent` was dropped.
- **`InteractionService.resolve`** calls `applyCommands` and returns
  `{status:'applied', outcome, state}` — same gap.
- **A single `take-item` resolve() call commits three events** (`item-added`,
  `item-discovered`, `room-state-changed`), of which two are promotable — batching
  within one interaction is a real, common case, not hypothetical.
- **BOUNDARIES.md's dependency matrix**: `interactions/**` may **not** import
  `memory/**` (explicit ✗). Promotion cannot live inside `InteractionService` —
  it must live in the composition root (`App.tsx`/`app/**`), the only layer allowed
  to import both `interactions` and the headless `memory` layer.
- **Store-level C3 dedupe already does the idempotency job**:
  `RoomMemoryService.remember` → the store's `record()` looks up `dedupeKey` per
  `(sessionId, roomId)` and returns `{status:'deduplicated'}` instead of a second
  row. Since every event in one batch has a distinct `eventId` (⇒ distinct
  `dedupeKey`), no new in-batch dedupe logic was needed for this seam.
- **`RoomViewer.tsx`** (physically under `src/renderer/`, but composition root per
  BOUNDARIES.md's layer table) is the actual call site:
  `interactionService.resolve(...).then((result) => {...})`.
- **Memory was wired nowhere outside tests before this slice.** `RoomMemoryService`/
  `NpcMemoryService` had zero non-test callers in the repo.

## 2. Scope (implemented)

In:

- `world-session/applyCommands.ts` — `ApplyCommandsResult`'s `ok:true` branch gains
  `events: WorldEvent[]` (the ordered committed events).
- `interactions/InteractionService.ts` — the `'applied'` `InteractionResult` variant
  gains `events: WorldEvent[]`, sourced from `applyCommands`.
- `app/promoteInteractionMemories.ts` (new) — thin composition-root orchestrator:
  maps each committed event through the existing `promoteWorldEvent`, best-effort
  `remember()`s the result, swallows/logs any failure.
- `renderer/RoomViewer.tsx` — new `onCommittedInteractionEvents` callback prop only;
  no memory import.
- `App.tsx` — owns `RoomMemoryService`/`InMemoryRoomMemoryStore` composition and the
  `DisplayNameResolver` construction; passes the callback to `RoomViewer`.
- Co-located tests for all of the above.

Out (explicit non-goals, unchanged from the approved plan):

- No `event_visibility`.
- No NPC memory promotion (`npc` arm).
- No FTS/vector/Chroma.
- No facts/`fact_visibility`.
- No schema/migration change; no `schemaVersion` bump anywhere.
- No `server/**`/`persistence/**` change — this wiring is browser/in-memory only,
  same as the rest of the memory layer today.
- No change to `EncounterService.ts` (shares `applyCommands` but destructures
  explicit fields rather than spreading the result, so it is unaffected).

## 3. Two maintainer-required adjustments (locked before coding)

1. **Promotion orchestration stays in `App.tsx`, not `RoomViewer`.** `RoomViewer`
   must not import `app/promoteInteractionMemories`, `RoomMemoryService`, or any
   `domain/memory/**` module. Instead: `App.tsx` composes `RoomMemoryService` and
   imports `promoteInteractionMemories`; it passes a callback
   (`onCommittedInteractionEvents`) down to `RoomViewer`; `RoomViewer` calls that
   callback with only raw, neutral data (`events`, `state`, current room name, taken
   item name) after `result.status === 'applied'`.
2. **Stable React lifetime for the in-memory store/service.** `RoomMemoryService`/
   `InMemoryRoomMemoryStore` must not be reconstructed on every `App` re-render.
   Built via a single `useRef` (not module scope, not `useMemo` over two separate
   refs) so the store survives renders for the life of the component. The first
   attempt (two separate refs, one reading the other's `.current` during render)
   was rejected by the `react-hooks/refs` ESLint rule ("Cannot access ref value
   during render") and fixed by constructing the store and the service together in
   one `useRef` initializer.

## 4. Minimum Safe Change Check

- **Reused:** `promoteWorldEvent`, `RoomMemoryService.remember`,
  `InMemoryRoomMemoryStore`, `createDisplayNameResolver`, the already-shipped
  persisted C3 dedupe, and the existing `applyCommands`/`InteractionService.resolve`
  control flow. Nothing in the pure mapper or the memory firewall was touched.
- **Minimum new code:** one additive field on `ApplyCommandsResult` and
  `InteractionResult`, one new orchestrator function
  (`app/promoteInteractionMemories.ts`), one new callback prop on `RoomViewer`, and
  composition wiring in `App.tsx`.
- **Safety boundaries unchanged:** the event log/`WorldSession` commit happens
  strictly before any promotion attempt; `interactions/**` still imports no
  `memory/**`; `domain/memory/**` still exports no `WorldCommand`/`WorldEvent`-
  producing function; no LLM in this path (`source:'game'` only); no schema/
  migration/version change anywhere.
- **Tests prove it:** §5.

## 5. Test plan / what was added

- `world-session/applyCommands.test.ts` — the two existing `toEqual({ok:true,
  state:...})` assertions updated to include `events`; a new case proves event
  order is preserved independent of the final state (distinct events per command).
- `interactions/InteractionService.test.ts` — the take-item test now asserts
  `result.events` matches the three committed events, in order, and equals the
  event log tail.
- `app/promoteInteractionMemories.test.ts` (new) — covers all four required cases:
  successful promotion (durable `room-state-changed` → recorded), no promotion for
  a non-promotable event (`moved-to-room`), duplicate replay dedupe (same event
  promoted twice across two calls → one stored record, via the real
  `InMemoryRoomMemoryStore`, not a mock), and promotion failure not breaking the
  caller (a store that rejects → the orchestrator resolves normally and logs a safe
  `promotion-threw` code only, no leaked error detail). Also covers named text via
  `DisplayNameResolver` and multiple events from one interaction promoted in order.

## 6. Verification (from `apps/web`)

```bash
npm run test -- applyCommands
npm run test -- InteractionService
npm run test -- promoteInteractionMemories
npm run test -- memory
npm run lint
npm run build
```

## 7. Files added / changed

- **Edited:** `world-session/applyCommands.ts`,
  `world-session/applyCommands.test.ts`, `interactions/InteractionService.ts`,
  `interactions/InteractionService.test.ts`, `renderer/RoomViewer.tsx`, `App.tsx`.
- **New:** `app/promoteInteractionMemories.ts`,
  `app/promoteInteractionMemories.test.ts`.
- **Deliberately NOT changed:** `domain/world/**`, `domain/memory/{promotion,
  roomFirewall,displayNames,roomContracts,recallMetadata}.ts`, `WorldSession.ts`,
  `EncounterService.ts`, `persistence/**`, `server/**`, `eslint.config.js`,
  `package.json`, any `schemaVersion`.

## 8. Implementation closeout

- `applyCommands` now returns the ordered committed `WorldEvent[]` alongside the
  final `state`, on the `ok:true` branch only.
- `InteractionService`'s `'applied'` result carries those committed events through
  unchanged, so a caller can promote memories without re-deriving events from
  commands.
- `App.tsx` owns all memory composition (`RoomMemoryService` +
  `InMemoryRoomMemoryStore`) and constructs it via a single stable `useRef` — no
  reconstruction on re-render, no cross-ref `.current` read during render.
- `RoomViewer` remains fully decoupled from the memory layer: it imports no
  `RoomMemoryService`, no `promoteInteractionMemories`, no `domain/memory/**`. It
  only calls the injected `onCommittedInteractionEvents` callback with raw data
  (`events`, `state`, current room name, taken-item name) after
  `result.status === 'applied'`.
- `app/promoteInteractionMemories.ts` promotes each committed event through the
  existing `promoteWorldEvent` mapper and calls `RoomMemoryService.remember`
  best-effort, one event at a time, in order.
- A promotion failure (rejected/failed result, or an unexpected thrown/rejected
  `remember()` call) is caught in the orchestrator, logged as a safe fixed code
  (`promotion-threw`) with no event text/ids beyond the event type, and never
  rethrown — gameplay/the interaction's promise chain is unaffected either way.
- Store-level C3 dedupe (keyed on `dedupeKey` per `(sessionId, roomId)`) handles
  replay: promoting the same committed event twice yields one stored record, not
  two.
- `DisplayNameResolver` is built in `App.tsx`'s callback only when **both** a room
  name and an item name are available from `RoomViewer`'s raw payload; otherwise
  `displayNames` is `undefined` and `promoteWorldEvent` falls back to its existing
  generic, id-free text.
- No `event_visibility`, no NPC memory promotion, no FTS/vector/Chroma, no
  migration, no `schemaVersion` bump, and no `server/**`/`persistence/**` changes.

### Verification (from `apps/web`)

```
npm run test   # 136 files, 2442 tests passed
npm run lint   # clean, no errors/warnings
npm run build  # tsc -b + vite build succeeded
```

All three checks passed.
