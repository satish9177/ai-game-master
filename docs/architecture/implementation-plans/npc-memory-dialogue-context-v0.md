# Implementation Plan — `feature/npc-memory-dialogue-context-v0`

> Status: **APPROVED FOR SLICE 1 ONLY — pure helper, tests only, unwired.**
> Runtime wiring (Slice 2), prompt-content tightening, App/RoomViewer/dialogue
> changes, and FTS are **NOT approved** and are deferred to a separate plan.
>
> The **first and only approved implementation slice** is:
> **Slice 1 — a pure room-memory visibility selection helper
> (`selectVisibleRoomMemories`) plus tests, fully unwired, with no runtime
> behavior change.**

## 0. Locked decisions (maintainer-approved)

- **Q1 — Approve Slice 1 only.** Pure `selectVisibleRoomMemories` helper + tests,
  unwired, no runtime behavior change.
- **Q2 — Runtime Slice 2 is NOT approved.** Do **not** touch
  `app/recallRoomMemoryContext.ts`, do **not** touch `App.tsx`, do **not** change
  prompt content, do **not** wire into `RoomViewer` or the dialogue flow.
- **Q3 — Viewer `npcId`.** For the Slice 1 helper/tests, pass a **normal**
  `NPCFactViewer` (real `npcId`). For future runtime wiring, do **not** invent a
  fake production `npcId`: prefer **dialogue-request-time filtering** when the
  target NPC is known, or keep runtime wiring deferred to a separate plan.
- **Q4 — Prompt-content tightening.** Approved as the **intended future safety
  behavior** (hidden / player-known / player-claim room memories excluded from
  NPC dialogue context), but **not approved for Slice 1 implementation** — Slice 1
  changes no prompt content.
- **Q5 — Logs.** No `visibleCount`/`droppedCount` counters in Slice 1. Keep the
  log surface unchanged. (The Slice 1 helper is pure domain code and does not log
  at all.)
- **Q6 — FTS.** Fully deferred. Do **not** use `recallRelevant`/FTS in this
  feature slice.

## 1. Feature goal (full feature) and Slice 1 goal

**Full feature goal (future, not all approved):** make NPC dialogue context
*safer, not richer*, by inserting a fact-visibility gate between memory recall and
the dialogue prompt, so that **hidden** and **player-known** (including player
claims) room memories are provably excluded from any NPC's prompt context — with
no world-authority change, no new provider call, no FTS wiring, and no change to
the prompt template.

**Slice 1 goal (approved):** build and test the **pure** composition of the two
already-shipped, still-unwired functions — `deriveFactsFromRoomMemories`
(`domain/facts/fromMemory.ts`) and `filterVisibleFacts` (`domain/facts/visibility.ts`)
— into a single record-preserving helper. **Nothing calls it.** No runtime path,
prompt, provider, log surface, or contract changes.

## 2. Why this is the safest first slice

- It reuses two existing pure, tested `domain/facts/**` functions and adds only a
  thin composition + tests.
- It is a `domain → domain` module (`domain/facts` importing `domain/memory`
  contracts) that already matches the precedent set by `fromMemory.ts`; no new
  lint rule, no new dependency.
- Being **unwired**, it cannot change dialogue, prompts, provider calls, logs, or
  authority. Risk is confined to a pure function proven by unit tests.
- It leaves the deliberate (approved-in-principle, not-yet-implemented) prompt
  tightening for a later, separately reviewed runtime slice — where the
  behavioral change to what NPCs see can be evaluated on its own.

## 3. Current NPC dialogue memory/context call graph (context only — unchanged by Slice 1)

```
App.refreshRoomMemoryContext(state)                     // fires on room entry, NPC-agnostic
  └─ recallRoomMemoryContext({worldId,sessionId,roomId}, RoomMemoryService, logger)
       └─ RoomMemoryService.recall(scope)               // scope-filtered, bounded
       └─ rankMemories(records, {currentRoomId})        // pure ordering
       └─ map → RoomMemoryDialogueContext {entries:[{text, kind}]}   // kind = MEMORY kind
  └─ setRoomMemoryContext(context)                      // React state → RoomViewer prop
        ▼
RoomViewer → npcDialogueReplyInput({ …, memoryContext })
  └─ buildDialogueContext(...) → NPCDialogueContext.memory
  └─ NPCDialogueService → provider
       └─ buildDialoguePromptMessages → buildMemorySection(entries)   // hedge-by-kind, single-line, clamp
          "BACKGROUND ROOM MEMORY - NON-AUTHORITATIVE"
```

Observations that shape the design:

- **Only room memory** is wired to dialogue today. `NpcMemoryService` is
  headless/unwired to dialogue.
- **No fact-visibility filtering exists in this runtime path today.** A
  `player_claim` room memory currently reaches the prompt as `"Someone claimed: …"`.
- The prompt hedge map (`generation/llmDialoguePrompt.ts`) is keyed by **memory**
  `kind` (`player_claim`, `room_observation`, `room_note`, `room_summary`), not by
  fact kind.
- `recallRoomMemoryContext` runs at **room entry**, before an NPC is chosen (it
  accepts an optional `activeNpcId` that `App` does not currently pass).
- FTS (`recallRelevant`) is **eval-only** and unwired.

**Slice 1 does not modify any node in this graph.** It only adds a new, unused
pure helper.

## 4. Slice 1 — the pure helper

New files only:

- `apps/web/src/domain/facts/selectVisibleRoomMemories.ts`
- `apps/web/src/domain/facts/selectVisibleRoomMemories.test.ts`

Proposed signature (record-preserving, so a future caller keeps the existing
`{ text, kind: record.kind }` entry representation and never touches the prompt
template):

```ts
import type { NPCFactViewer } from './visibility'
import type { RoomMemoryRecord } from '../memory/roomContracts'

export function selectVisibleRoomMemories(
  records: readonly RoomMemoryRecord[],
  viewer: NPCFactViewer,
): RoomMemoryRecord[]
```

Behavior:

1. `deriveFactsFromRoomMemories(records)` — 1:1, order-preserving, fail-closed
   (unknown/malformed → `hidden`). `factId` is `room-memory:${record.memoryId}`.
2. `filterVisibleFacts(facts, viewer)` — drops `hidden` and `player-known`, keeps
   `public`/matching `room-known`, and enforces `worldId`/`sessionId` match.
3. Return the **records** whose derived fact survived, in the input order.

Properties:

- **Pure, total, deterministic**: no `Date.now`, no `Math.random`, no I/O, no
  mutation, **no logging** (domain layer forbids the logger).
- **Record-preserving**: returns a subset of the input records (not `Fact`s), so
  facts remain ephemeral filter artifacts, never surfaced, stored, or logged.
- **Fail-closed**: any record that cannot be classified becomes a `hidden` fact
  (via `fromMemory`) and is dropped; the helper can only ever return a subset —
  never more than, and never a widened version of, its input.
- **Correlation**: map surviving `factId`s back to records by the deterministic
  `room-memory:${memoryId}` prefix (or by carrying `(record, fact)` pairs
  internally and filtering the pairs — implementer's choice; both are pure).

## 5. Representation of facts and memory text (Slice 1)

- **Facts are ephemeral.** They exist only inside `selectVisibleRoomMemories` to
  decide inclusion, then are discarded. No `Fact` is returned, stored, logged,
  persisted, or attached to any dialogue/context type.
- **The helper returns `RoomMemoryRecord[]`.** A future runtime caller would keep
  mapping to the unchanged `RoomMemoryContextEntry` shape (`{ text, kind }`), so
  the prompt's `hedgePrefix(kind)` (keyed on memory kinds) keeps working with no
  template edit. Slice 1 does not perform that mapping (it is unwired).

## 6. How hidden / player-known / player-claim are blocked (design intent, exercised by Slice 1 tests)

`filterVisibleFacts` (reused as-is) is the single choke point:

- `hidden` → excluded.
- `player-known` → excluded. `deriveFactFromRoomMemory` maps `player_claim` →
  `{ scope: 'player-known' }` **regardless of `roomId`**, so player claims can
  never reach an NPC viewer.
- `room_observation` / `room_note` / `room_summary` → `{ scope: 'room-known',
  roomId }`, kept only when `roomId === viewer.roomId`.
- Cross-`worldId`/`sessionId` records → excluded by the identity guard.
- Room memory **never produces `npc-known`**, so no NPC-specific leak is possible
  from this path.

Slice 1 asserts each of these via unit tests (§9). Because Slice 1 is unwired,
this is proven behavior of the helper, not yet an enforced runtime guarantee.

## 7. Fallback behavior (Slice 1 helper)

| Situation | Helper result |
| --- | --- |
| Empty input | `[]` (empty in → empty out) |
| No visible records | `[]` |
| Malformed / unknown-kind record | Dropped (fails closed to `hidden` in `fromMemory`, then filtered out); no throw |
| Mixed visible + non-visible | Only the visible subset, in input order |

The helper is total: it does not throw on any `RoomMemoryRecord[]` input. (Runtime
`try/catch` / empty-context degradation lives in the future Slice 2 bridge, which
is out of scope here.)

## 8. Logging / redaction (Slice 1)

- **No logging.** `domain/facts/**` must not import the logger. The helper returns
  data only.
- **No log-surface change anywhere.** `recallRoomMemoryContext` and all other
  callers are untouched, so their existing ids/counts/codes-only lines are
  byte-identical. No `visibleCount`/`droppedCount` counters (Q5).

## 9. Tests to add (Slice 1 — `selectVisibleRoomMemories.test.ts`)

Deterministic, pure, no I/O. Viewers use a **normal** `NPCFactViewer` with a real
`npcId` (Q3):

1. **Player-claim dropped** — a `player_claim` room memory is excluded for any
   `roomId` (player-known invariant).
2. **Room-known kept** — `room_observation`, `room_note`, and `room_summary` in
   the viewer's room are kept.
3. **Wrong-room room-known dropped** — a `room-known` record whose `roomId`
   differs from `viewer.roomId` is excluded.
4. **Cross-world / cross-session dropped** — a record with a mismatched
   `worldId`/`sessionId` is excluded.
5. **Malformed / unknown-kind fails closed** — an out-of-enum `kind` (via an
   unsafe cast) is dropped, no throw.
6. **Order + count preserved** — the surviving subset keeps input order; empty in
   → empty out; all-visible → all returned.
7. **Purity / no mutation** — input array and records are deep-equal before/after.

## 10. Files likely to change (Slice 1)

New only:

- `apps/web/src/domain/facts/selectVisibleRoomMemories.ts`
- `apps/web/src/domain/facts/selectVisibleRoomMemories.test.ts`

No `eslint.config.js` change (module sits in the existing `domain/**` block and
makes only `domain → domain` imports). No `package.json` change.

## 11. Files that must NOT change (Slice 1)

- `apps/web/src/app/recallRoomMemoryContext.ts` (runtime bridge — Q2)
- `apps/web/src/App.tsx` (Q2)
- `apps/web/src/renderer/RoomViewer.tsx` and `app/npcDialogueReplyInput.ts` (Q2)
- `apps/web/src/generation/llmDialoguePrompt.ts` (prompt template/hedging — Q4)
- `apps/web/src/domain/dialogue/contracts.ts`,
  `apps/web/src/domain/dialogue/buildDialogueContext.ts`
- `apps/web/src/domain/facts/contracts.ts`,
  `apps/web/src/domain/facts/visibility.ts`,
  `apps/web/src/domain/facts/fromMemory.ts` (reused as-is)
- `apps/web/src/memory/RoomMemoryService.ts`,
  `apps/web/src/memory/NpcMemoryService.ts` (recall unchanged; no FTS — Q6)
- `apps/web/src/dialogue/**` (service/providers)
- `apps/web/src/evaluation/**`, `apps/web/src/redteam/**`
- `persistence/**`, `migrations/**`, `server/**`, renderer/engine
- `WorldState` / `WorldEvent` / `SaveGame` / `RoomSpec` / `QuestSpec`
- `eslint.config.js`, `package.json`

## 12. Verification commands (from `apps/web`)

```bash
npm run test -- facts       # new selectVisibleRoomMemories + existing contracts/visibility/fromMemory
npm run lint                # domain boundary / no-console walls (no new rule expected)
npm run build               # typecheck + SQLite-free browser bundle unchanged
```

`npm run test -- dialogue` is optional extra regression (still unwired; no
dialogue-path change).

## 13. Interaction with FTS `recallRelevant` — fully deferred (Q6)

Not used in this feature slice. The runtime path uses `recall()`; wiring FTS would
change `recall` behavior and mix two features. The visibility gate is orthogonal
to retrieval order, so if FTS is wired later, `selectVisibleRoomMemories` slots in
unchanged after it.

## 14. Deferred to a separate plan (NOT this feature slice)

- **Slice 2 — runtime wiring** of `selectVisibleRoomMemories` into the
  room-memory→dialogue path. Locked constraint (Q3): do not invent a fake
  production `npcId`; prefer **dialogue-request-time filtering** where the target
  NPC is known, or keep runtime wiring deferred. This is where the approved-in-
  principle prompt-content tightening (Q4) would actually take effect and must be
  re-reviewed on its own.
- NPC-memory→dialogue wiring and `npc-known` visibility.
- FTS `recallRelevant` wiring.
- Any `Fact` persistence/store, `world-derived` authority projector, relationship
  state, semantic dialogue events, or structured dialogue effects.
- Log counters (`visibleCount`/`droppedCount`).

## 15. Safety / authority analysis (Slice 1)

- **No world-authority change.** The helper imports only `domain/facts` and
  `domain/memory` contract types — no `world-session`, `WorldCommand`, or
  `WorldEvent`. The event log / SQLite remain sole truth.
- **Memory firewall intact.** No write path; `recall` unchanged; `memory/**` lint
  wall untouched.
- **`source:'llm'` stays non-authoritative.** Derived facts are all
  `authority:'unverified'` (per `fromMemory`); nothing here earns `world-derived`.
- **Strictly reduces (never widens) exposure**, and it is **unwired**, so it
  cannot alter any prompt/provider/log/authority behavior in this slice.
- **Fail-closed** at both layers it composes: derive (→`hidden`) and filter
  (drops `hidden`/`player-known`).

## Minimum Safe Change Check

- **Reused:** `deriveFactsFromRoomMemories` + `filterVisibleFacts` +
  `NPCFactViewer` (`domain/facts/**`), `RoomMemoryRecord` (`domain/memory/roomContracts`),
  and the `domain → domain` parallel-file precedent from `fromMemory.ts`. No new
  dependency, no new lint rule, no edit to any existing file.
- **New code actually necessary:** `selectVisibleRoomMemories.ts` (one pure
  function) + its test file. That is all for Slice 1.
- **Safety boundaries unchanged:** world authority (event log sole truth), memory
  firewall (no truth path), no `world-derived` authority produced, player-claim /
  hidden exclusion proven by tests, fail-closed on malformed input, no logging, no
  persistence, no wiring, no prompt/provider change.
- **Tests that prove it:** §9 — player-claim dropped, room-known kept, wrong-room
  dropped, cross-world/session dropped, unknown-kind fail-closed, order/count
  preserved, purity/no-mutation.
