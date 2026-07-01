# Implementation Plan — `feature/memory-room-recall-context-v0`

> Status: **Implemented.**
>
> **This is Slice F** of the reconciled adoption of the external *Memory & DB Design
> v1* doc. Room memories could already be **written** (`memory-event-promotion-v0`,
> Slice E) but nothing ever **read** them back — `RoomMemoryService.recall` and the
> Slice B ranker (`rankMemories`) existed and were tested in isolation, with zero
> non-test callers. This slice wires a bounded, read-only recall path so previously
> promoted room memories can inform NPC dialogue context, without ever becoming
> gameplay truth.
>
> Companion docs: [ARCHITECTURE](../ARCHITECTURE.md) · [BOUNDARIES](../BOUNDARIES.md).
> Builds on: `memory-event-promotion-v0` (Slice A), `memory-context-ranking-v0`
> (Slice B), `memory-display-name-persistence-v0` (Slice C), `memory-semantic-events-v0`
> (Slice D), `memory-promotion-wiring-v0` (Slice E).

## 1. Key boundary finding

- **`dialogue/**` may not import `memory/**`** (BOUNDARIES.md dependency matrix:
  Dialogue row → Memory column is `✗`). `domain/dialogue/**` was also kept clear of
  `domain/memory/**` types by explicit maintainer instruction during planning, even
  though the two are both `domain/**` and a domain-internal import would not have
  tripped lint — the dialogue-local `RoomMemoryDialogueContext` type keeps that
  coupling out entirely.
- **`RoomViewer.tsx`** (physically under `src/renderer/`, composition root per
  BOUNDARIES.md's layer table) established in Slice E that it must stay decoupled
  from the memory layer. That precedent holds here: `RoomViewer` imports no
  `memory/**` and no `domain/memory/**`, only the plain `domain/dialogue` contract
  types.
- Only `App.tsx` (composition root) may import `RoomMemoryService`. Recall is
  therefore composed in `App.tsx`, exactly mirroring how `questStage` is computed
  there and passed down to `RoomViewer` as a prop.

## 2. Scope (implemented)

In:

- `app/recallRoomMemoryContext.ts` (new) — composition-root recall orchestrator.
- `domain/dialogue/contracts.ts` — dialogue-local `RoomMemoryContextEntry` /
  `RoomMemoryDialogueContext` types; `memory?` sibling field on `NPCDialogueContext`.
- `domain/dialogue/buildDialogueContext.ts`, `dialogue/NPCDialogueService.ts`,
  `app/npcDialogueReplyInput.ts`, `renderer/RoomViewer.tsx` — thread `memoryContext`
  through, mirroring the existing `quest`/`room` pattern.
- `App.tsx` — owns `refreshRoomMemoryContext(state)` and wires it into
  `refreshDerivedViews` and `handleCommittedInteractionEvents`.
- Co-located tests for all of the above.

Out (explicit non-goals):

- No `event_visibility`.
- No NPC memory promotion.
- No facts / `fact_visibility`.
- No FTS/vector/Chroma.
- No `schemaVersion` bump; no migration.
- No `FakeNPCDialogueProvider` behavior change — wiring the data path end-to-end is
  the deliverable, not changing NPC reply behavior.

## 3. Minimum Safe Change Check

- **Reused:** `RoomMemoryService.recall`, `rankMemories`, `RoomMemoryScope`, the
  existing `questStage` prop-threading pattern end to end, the existing
  `promoteInteractionMemories.ts` orchestrator shape/logging convention, the
  existing `copyRoomDialogueContext` copy-on-compose pattern, and the existing
  `requestVersion`-style stale-async guard used elsewhere in `App.tsx`.
- **Minimum new code:** one small app-layer orchestrator function, two dialogue-local
  domain types, and one optional param threaded through four existing
  functions/components. No new service, store, port, or schema.
- **Safety boundaries unchanged:** `dialogue/**` still does not import `memory/**`;
  `domain/dialogue/**` still does not import `domain/memory/**`; `RoomViewer`/
  `renderer/**` still does not import `memory/**`; only `App.tsx` touches
  `RoomMemoryService`; recall has no `WorldSession` reference and cannot mutate
  `WorldState`/flags/inventory; a failed recall degrades to `{ entries: [] }` and
  never blocks dialogue or interaction; logs stay ids/counts/status-only.

## 4. Test plan / what was added

- `app/recallRoomMemoryContext.test.ts` (new) — bounded recall (top 5), degraded/empty
  recall on a throwing store (safe log code only, never memory text), same-room
  filtering across two rooms, ranking order (`activeNpcId` match ranks first via
  `rankMemories`), and no write to the store during a recall-only path.
- `domain/dialogue/buildDialogueContext.test.ts` — attaches provided `memoryContext`
  (copied, not aliased), omits the field entirely when absent, and does not leak
  persona/history into `context.memory`.
- `dialogue/NPCDialogueService.test.ts` — `memoryContext` on `NPCDialogueInput` reaches
  the built `NPCDialogueContext` passed to the provider; omitted when absent.
- `app/npcDialogueReplyInput.test.ts` — includes/omits `memoryContext` on the built
  `NPCDialogueInput`.
- `renderer/RoomViewer.test.ts` — `roomMemoryContext` prop passed through into both
  NPC dialogue-reply call sites (initial open and `handleNPCSay`); omitted when the
  prop is absent.

## 5. Verification (from `apps/web`)

```bash
npm run test -- recallRoomMemoryContext
npm run test -- buildDialogueContext
npm run test -- NPCDialogueService
npm run test -- RoomViewer
npm run test -- npcDialogueReplyInput
npm run lint
npm run build
```

## 6. Files added / changed

- **New:** `app/recallRoomMemoryContext.ts`, `app/recallRoomMemoryContext.test.ts`.
- **Edited:** `domain/dialogue/contracts.ts`, `domain/dialogue/buildDialogueContext.ts`,
  `domain/dialogue/buildDialogueContext.test.ts`, `dialogue/NPCDialogueService.ts`,
  `dialogue/NPCDialogueService.test.ts`, `app/npcDialogueReplyInput.ts`,
  `app/npcDialogueReplyInput.test.ts`, `renderer/RoomViewer.tsx`,
  `renderer/RoomViewer.test.ts`, `App.tsx`.
- **Deliberately NOT changed:** `memory/RoomMemoryService.ts`,
  `domain/memory/{roomFirewall,roomContracts,recallMetadata,ranking,promotion,
  displayNames}.ts`, `dialogue/FakeNPCDialogueProvider.ts`, `memory/NpcMemoryService.ts`,
  `persistence/**`, `server/**`, `eslint.config.js`, `package.json`, any
  `schemaVersion`.

## 7. Implementation closeout

- `app/recallRoomMemoryContext.ts` added as the composition-root recall orchestrator.
- Uses `RoomMemoryService.recall` + `rankMemories` (Slice B) — no new retrieval or
  ranking logic.
- Bounded to the top 5 entries (`DEFAULT_ROOM_MEMORY_DIALOGUE_LIMIT`).
- Maps recalled `RoomMemoryRecord`s to a dialogue-local `{ text, kind }` context; no
  `domain/memory` type ever crosses into `domain/dialogue`.
- A failed recall (including a throwing store, which `RoomMemoryService.recall` does
  not itself catch) degrades to `{ entries: [] }` instead of propagating.
- Logs only `{ roomId, count }` on success and `{ roomId, code: 'recall-threw' }` on
  failure — never memory text or kind values.
- `NPCDialogueContext` now has an optional `memory?` sibling field next to the
  existing `room?`/`quest?` fields.
- `buildDialogueContext`, `NPCDialogueService`, `npcDialogueReplyInput`, and
  `RoomViewer` all thread `memoryContext` through unchanged from the existing
  `roomContext`/`questStage` pattern.
- `RoomViewer` remains fully decoupled from `memory/**`: it only holds a
  `roomMemoryContextRef` synced from the new `roomMemoryContext` prop, mirroring the
  existing `questStageRef` pattern exactly.
- `App.tsx` owns `refreshRoomMemoryContext(state)`: it clears `roomMemoryContext` to
  `undefined` immediately on every call (so a previous room's memories can never
  linger while a newer recall is pending), then applies the async result only if a
  monotonic request id still matches — the same stale-response guard pattern already
  used elsewhere in this file (e.g. `requestVersion`, `npcDialogueRequestRef`).
- `App.tsx` calls `refreshRoomMemoryContext` from the existing `refreshDerivedViews`
  seam (bootstrap, navigation, interaction/encounter resolve) **and again** after
  `promoteInteractionMemories` settles inside `handleCommittedInteractionEvents`
  (`.catch(() => {}).finally(...)`), so a room memory promoted from the just-committed
  interaction is picked up even when promotion completes after the first recall.
  Promotion failure is still swallowed/logged by `promoteInteractionMemories` itself
  and never breaks gameplay.
- No schema/migration/backend changes; `schemaVersion` untouched everywhere.
- No `event_visibility`, no NPC memory promotion, no facts/`fact_visibility`, no
  FTS/vector/Chroma.
- `FakeNPCDialogueProvider` untouched — wiring the recall path end-to-end was the
  deliverable, not new NPC reply behavior.

### Verification (from `apps/web`)

```
npm run test -- recallRoomMemoryContext buildDialogueContext NPCDialogueService RoomViewer npcDialogueReplyInput
  # 5 files, 48 tests passed
npm run test -- --run
  # 137 files, 2456 tests passed
npm run lint
  # clean, no errors/warnings
npm run build
  # tsc -b + vite build succeeded
```

All four checks passed.
