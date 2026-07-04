# Implementation Plan — Slice 2 (runtime wiring): `feature/npc-memory-dialogue-context-v0`

> Status: **IMPLEMENTED — Slice 2a and Slice 2b committed.** Feature closed.
>
> Parent feature plan:
> [npc-memory-dialogue-context-v0](./npc-memory-dialogue-context-v0.md)
> (Slice 1 — pure `selectVisibleRoomMemories` helper + tests, committed, unwired).
> Fact/visibility building blocks:
> [facts-and-fact-visibility-v0](./facts-and-fact-visibility-v0.md),
> [facts-and-fact-visibility-slice-2-from-memory-v0](./facts-and-fact-visibility-slice-2-from-memory-v0.md).
>
> **Closeout note.** Implemented exactly as designed below:
>
> - **Slice 2a (pure, no behavior change):** `RecalledRoomMemory { scope,
>   records }` type and `buildVisibleRoomMemoryContext(recalled, npcId)` —
>   composes `selectVisibleRoomMemories` + the dialogue-limit slice + the
>   `{text, kind}` map, unwired at this point.
> - **Slice 2b (runtime, behavior-changing):** `recallRoomMemoryContext` now
>   returns the ranked, unsliced `RecalledRoomMemory`; `App.tsx` holds it in
>   state (`recalledRoomMemory`) and exposes a stable
>   `getRoomMemoryContextForNpc(npcId)` callback (memory feedback stays
>   pre-visibility, per Decision 4); `RoomViewer.handleNPCSay` calls that
>   callback with the **real** `target.npcId` and forwards the result as
>   `memoryContext`. `RoomViewer` gained no `domain/facts`/`domain/memory`
>   import — its memory-decoupling is preserved.
> - **Runtime behavior change:** `player_claim` and any other
>   `player-known`/`hidden` room memory can no longer reach an NPC's dialogue
>   prompt context, for every NPC, unconditionally. `room_observation`,
>   `room_note`, and `room_summary` still enter the prompt context when visible
>   (same room, same world/session) — unchanged from today's behavior for those
>   kinds.
> - **Evaluation adapter:** existing `evaluation/**` gates that called
>   `recallRoomMemoryContext` directly and consumed the old `{entries}` shape
>   were updated to call the new
>   [`evaluation/recalledRoomMemoryAdapter.ts`](../../../apps/web/src/evaluation/recalledRoomMemoryAdapter.ts)'s
>   `toUngatedRoomMemoryDialogueContext(recalled)`, which reproduces the old
>   ranked/sliced/mapped shape exactly. This is a test-harness API-shape
>   adaptation only — those gates continue measuring the pre-existing
>   recall/ranking plateau behavior and are **not** routed through the new
>   visibility gate.
> - **Unchanged / explicitly deferred, confirmed at closeout:**
>   `generation/llmDialoguePrompt.ts` (prompt template, hedge map, caps,
>   system-prompt wording) and all dialogue provider code are untouched; no
>   FTS/`recallRelevant` runtime wiring; no NPC-memory→dialogue wiring or
>   `npc-known` visibility; no persistence/schema/server/`WorldState`/event-log
>   changes; no world/authority change of any kind (memory remains
>   supporting, non-authoritative context); no new logs or counters beyond the
>   two pre-existing `recallRoomMemoryContext` lines (`roomId` + a safe count).
> - **Build caveat.** `npm run build` (`tsc -b`) is currently red on `main`,
>   but the failing files (`domain/assembleRoom.test.ts`,
>   `domain/ensureGeneratedNpcPresence.ts`, `domain/npcMovementContract.test.ts`,
>   `domain/roomVisualTheme.test.ts`,
>   `generation/OpenAICompatibleNPCDialogueProvider.test.ts`, plus uncommitted
>   working-tree edits to `renderer/engine/Engine.ts` and
>   `renderer/engine/builders/lighting.ts`/`.test.ts`) are unrelated to this
>   feature — none import any symbol this feature added or changed, and
>   `domain/dialogue/contracts.ts` (`RoomMemoryDialogueContext`) was not
>   touched. This feature's own targeted tests (`selectVisibleRoomMemories`,
>   `buildVisibleRoomMemoryContext`, `recallRoomMemoryContext`, `RoomViewer`,
>   `App.test`, `evaluation`) and `npm run lint` are green.

## 0. Goal

Wire the already-committed, still-unwired pure helper
`selectVisibleRoomMemories(records, viewer)` into the room-memory → NPC dialogue
path so that room memories are **visibility-filtered before they enter an NPC
prompt**.

**Behavior change (Slice 2b only):** today a `player_claim` room memory can reach
an NPC prompt as background room memory (`"Someone claimed: …"`). After Slice 2b,
`player_claim` / player-known / hidden room memories are provably excluded from
any NPC's prompt context. No world-authority change, no new provider call, no FTS
wiring, no prompt-template change.

## 1. Locked decisions (maintainer-approved for this plan)

1. **Filter before slice.** `recallRoomMemoryContext` returns the ranked records
   **unsliced**; the `DEFAULT_ROOM_MEMORY_DIALOGUE_LIMIT` slice moves **after** the
   visibility filter, in the new app helper — so the candidates handed to the
   prompt are all visible (a `player_claim` never occupies a slot). The prompt's
   own cap of 3 is unchanged.
2. **Minimum change to `App` state.** Do **not** aggressively drop or refactor
   `App` state. Keep the existing recall → state flow, the monotonic latest-wins
   request id, and current feedback/render behavior. Changes to `App` are the
   smallest edits needed (a type/field adjustment plus an additive per-NPC
   callback), not a restructuring.
3. **Runtime filtering at dialogue-request time with the real target `npcId`.**
   Filter in the flow driven from `RoomViewer.handleNPCSay`, where the target NPC
   is actually known (`activeNPCDialogueRef.current.npcId`). **Do not invent a
   fake production `npcId`.**
4. **Memory feedback stays pre-visibility.** The "you recalled something"
   feedback continues to fire on the recalled (pre-filter) set, i.e. iff any room
   memory was recalled — even if every recalled memory is a `player_claim` no NPC
   will see. (A room signal, not a prompt signal.)
5. **No new logs or counters.** No `visibleCount` / `droppedCount`, no per-NPC log
   line. Existing recall logs stay (`roomId` + a safe count only).
6. **FTS / `recallRelevant` remains fully deferred.** The runtime path uses
   `recall()`; no FTS is wired.
7. **Prompt template, hedging, and caps remain unchanged.**
   `generation/llmDialoguePrompt.ts` is not touched.
8. **No test-only DI to force filter throws.** `selectVisibleRoomMemories` is
   total; fail-closed behavior is proven through **malformed / unknown memory
   kinds** (which fail closed to `hidden` in `deriveFactFromRoomMemory` and are
   dropped) and **naturally reachable `try/catch` / empty-context paths** (recall
   store-throw, ref not yet populated). No injected throwing seam is added solely
   to exercise the catch.

## 2. Current runtime call graph (context)

```
App.refreshDerivedViews(state)                                  // bootstrap / load / navigation / interaction+encounter resolve
  └─ refreshRoomMemoryContext(state)                            // NPC-AGNOSTIC (room entry)
       └─ recallRoomMemoryContext({worldId,sessionId,roomId}, RoomMemoryService, logger)   // app/
            └─ RoomMemoryService.recall(scope)                  // bounded, scope-filtered, read-only
            └─ rankMemories(records, {currentRoomId})           // pure ordering
            └─ .slice(0, 5) → map → { entries:[{text, kind}] }  // RoomMemoryDialogueContext  ← records DISCARDED here
       └─ setRoomMemoryContext(context)  (state)                // + memory-feedback via context.entries.length
                    ▼   (prop)
RoomViewer  roomMemoryContext ──► roomMemoryContextRef.current  // effect-synced
  └─ handleNPCSay(promptId?, freeText?)                         // TARGET NPC KNOWN HERE: activeNPCDialogueRef.current.npcId
       └─ buildNPCDialogueReplyInput({ …, memoryContext: roomMemoryContextRef.current })   // app/
            └─ NPCDialogueService.reply(input)
                 └─ buildDialogueContext(...) → NPCDialogueContext.memory = { entries }     // domain/dialogue
                 └─ provider → buildDialoguePromptMessages → buildMemorySection(entries)     // generation/
                      "BACKGROUND ROOM MEMORY - NON-AUTHORITATIVE", hedge-by-kind, single-line, cap 3
```

| Concern | Location |
| --- | --- |
| Room memory **recalled** | `app/recallRoomMemoryContext.ts` (from `App.refreshRoomMemoryContext`) |
| Recalled memory **held (React state/ref)** | `App.tsx` `roomMemoryContext` state → `RoomViewer` prop → `roomMemoryContextRef` |
| **Target NPC known** | `RoomViewer.handleNPCSay` — `activeNPCDialogueRef.current` (`target.npcId`) |
| Prompt context **built** | `domain/dialogue/buildDialogueContext.ts` → `generation/llmDialoguePrompt.ts` |

**The load-bearing constraint:** raw `RoomMemoryRecord[]` are required to derive
facts, but `recallRoomMemoryContext` currently discards them and only `{text,
kind}` survives to the point where the NPC is known. Recall is NPC-agnostic (room
entry); the NPC is known only in `RoomViewer.handleNPCSay`. Filtering with the
real `npcId` (Decision 3) therefore requires carrying raw records + the recall
scope forward to dialogue-request time.

## 3. Wiring point decision

**Filter in the flow driven from `RoomViewer.handleNPCSay`, using the real
`target.npcId`.** Alternatives at room-entry recall or in `App` state cannot see
which NPC will be addressed and would require inventing a fake `npcId`
(forbidden). `npcDialogueReplyInput` / `buildDialogueContext` are downstream of
where the records still exist and (for `buildDialogueContext`) are barred by the
`domain/dialogue ⇏ domain/memory` boundary.

**Preserving `RoomViewer`'s deliberate memory-decoupling.** `RoomViewer` imports
only the pure `domain/dialogue` contract type today and explicitly holds no
`memory/**` import (see its own comment). To keep that intact, `RoomViewer` does
**not** import `domain/facts`/`domain/memory` and does **not** receive raw records
as a typed prop. Instead:

- **`App`** (composition root — allowed to own memory) holds the recalled raw
  records + scope and exposes a **stable per-NPC callback prop**:
  `getRoomMemoryContextForNpc(npcId: string): RoomMemoryDialogueContext | undefined`.
- **`RoomViewer`** calls that callback at `handleNPCSay` with `target.npcId`,
  receives a plain `RoomMemoryDialogueContext` (a type it already imports), and
  forwards it as `memoryContext`. `RoomViewer`'s imports and prop *types* stay
  within `domain/dialogue` + app callbacks.

**Honest caveat (key review point).** For **room** memory the visibility outcome
is **independent of `npcId`**: room memory only ever derives `player-known`
(always dropped), `room-known` (kept iff `roomId` matches the recall scope, which
it always does), or `hidden` (dropped). It never derives `npc-known`. So the
behavioral change (blocking `player_claim`) is driven purely by the `player-known`
scope, not by NPC identity. Wiring with the real `target.npcId` (per Decision 3)
is chosen to (a) honor the no-fake-`npcId` rule and (b) be correct-by-construction
if NPC memory (`npc-known` facts) is later routed through the same seam — not
because room-memory filtering needs the id.

## 4. Proposed data flow

```
RoomMemoryService.recall(scope)
  → rankMemories(records, {currentRoomId})                     // recallRoomMemoryContext (app/), recall UNCHANGED
  → RecalledRoomMemory { scope, records }                      // NEW app-layer shape; carries ranked raw records + scope (UNSLICED, Decision 1)
  → App: latest-wins ref/state (Decision 2, minimum change)    // App.tsx
        │  getRoomMemoryContextForNpc(npcId) callback prop
        ▼
  → buildVisibleRoomMemoryContext(recalled, npcId)             // NEW app/ helper (Slice 2a)
        → selectVisibleRoomMemories(recalled.records,          // domain/facts (Slice 1, reused AS-IS)
             { kind:'npc', ...recalled.scope, npcId })
        → .slice(0, DEFAULT_ROOM_MEMORY_DIALOGUE_LIMIT)        // dialogue cap, AFTER filter (Decision 1)
        → map → RoomMemoryDialogueContext { entries:[{text, kind:record.kind}] }
        ▼
  → RoomViewer.handleNPCSay → buildNPCDialogueReplyInput({ …, memoryContext })   // signature UNCHANGED
  → buildDialogueContext(...) → NPCDialogueContext.memory                        // UNCHANGED
  → buildDialoguePromptMessages → buildMemorySection(entries)                    // template/hedge/caps UNCHANGED
```

`selectVisibleRoomMemories` is reused exactly as committed (returns the surviving
`RoomMemoryRecord[]` in input order). Only the app-layer bridge is new.

## 5. Context shapes — new internal type, no domain-contract change

- **`RoomMemoryDialogueContext`** (`domain/dialogue/contracts.ts`) stays
  `{ entries:[{text, kind?}] }` and remains what crosses into the prompt. It
  **cannot** hold `RoomMemoryRecord[]` (the `domain/dialogue ⇏ domain/memory`
  boundary). **Unchanged.**
- **New app-layer type** (in `app/recallRoomMemoryContext.ts`, which already
  imports `RoomMemoryScope`):
  ```ts
  export type RecalledRoomMemory = {
    scope: RoomMemoryScope
    records: RoomMemoryRecord[]   // ranked; bounded by the store's recall firewall; UNSLICED
  }
  ```
- `recallRoomMemoryContext` returns `RecalledRoomMemory`. The `{text, kind}`
  mapping and the dialogue-limit slice move out of recall and into
  `buildVisibleRoomMemoryContext`, **after** the visibility filter.

No `Fact` is ever stored, returned to React, or attached to a domain type — facts
remain ephemeral inside `selectVisibleRoomMemories`. The record → entry mapping is
unchanged (`{ text: record.text, kind: record.kind }`), so the prompt's
`hedgePrefix(kind)` (keyed on memory kinds) keeps working with no template edit.

## 6. `App` changes — minimum, non-aggressive (Decision 2)

Guiding rule: keep the existing recall → state flow, latest-wins request id, and
feedback/render behavior; make only additive/small edits.

- Keep the recall call site and the monotonic `roomMemoryRequestRef` latest-wins
  discipline.
- `recallRoomMemoryContext` now yields `RecalledRoomMemory`. **Memory feedback
  stays pre-visibility (Decision 4):** the feedback gate fires on the recalled
  record count (`recalled.records.length > 0`) — behaviorally identical to today's
  `entries.length > 0` (the pre-filter map was 1:1), just reading the record count.
- Expose a **stable** `getRoomMemoryContextForNpc(npcId)` callback that reads the
  latest recalled value (via the existing effect/ref pattern `RoomViewer` already
  uses for `roomMemoryContext`) and returns
  `buildVisibleRoomMemoryContext(recalled, npcId)` — or `undefined` when nothing
  is recalled yet.
- Pass `getRoomMemoryContextForNpc` to `RoomViewer` in place of the
  `roomMemoryContext` value prop. Visible render output is unchanged (memory
  context only affects the dialogue prompt, never on-screen render).

The implementer should keep `App`'s existing state/refs where they still serve
feedback/latest-wins and avoid removing or restructuring them; the goal is the
smallest diff that carries records to dialogue time.

## 7. `RoomViewer` changes — memory-decoupling preserved

- Swap the prop `roomMemoryContext?: RoomMemoryDialogueContext` for
  `getRoomMemoryContextForNpc?: (npcId: string) => RoomMemoryDialogueContext | undefined`.
- Sync it into a ref via the existing effect pattern (same as today's
  `roomMemoryContextRef`), so the stable `handleNPCSay` callback reads the latest
  without re-creating.
- In `handleNPCSay`, after the target is known, compute
  `const memoryContext = getRoomMemoryContextForNpcRef.current?.(target.npcId)` and
  pass it to `buildNPCDialogueReplyInput`.
- `RoomViewer` gains **no** `domain/facts` / `domain/memory` import; its prop
  types stay within `domain/dialogue` + app callbacks.

## 8. Preserving prompt hedging / caps (Decision 7)

`generation/llmDialoguePrompt.ts` is not touched. Preserved:

- **`MAX_MEMORY_ENTRIES = 3`** — unchanged.
- **Single-line clamp / `toSingleLine` / `MAX_MEMORY_LINE_CHARS`** — unchanged;
  entries remain `{text, kind}` through the same path.
- **`BACKGROUND ROOM MEMORY - NON-AUTHORITATIVE`** header — unchanged.
- **"Current and authoritative facts override background memory"** system rule —
  unchanged.
- **Hedge map** — still keyed on memory `kind`. Surviving entries carry only
  `room_observation` / `room_note` / `room_summary` (all mapped). `player_claim` is
  filtered before the prompt, so `"Someone claimed …"` no longer appears for room
  memory via this route; the map entry stays (harmless).

`DEFAULT_ROOM_MEMORY_DIALOGUE_LIMIT` (5) is preserved as a number but applied
**after** filtering (Decision 1). The prompt's cap of 3 is untouched.

## 9. Fallback / failure behavior (fail-closed)

| Situation | Result |
| --- | --- |
| Nothing recalled (`records: []`) | `buildVisibleRoomMemoryContext` → `{ entries: [] }`; callback returns `undefined` → **no MEMORY section** |
| All memories filtered out (e.g. all `player_claim`) | `selectVisibleRoomMemories` → `[]` → `{ entries: [] }` → no section |
| Filter "throws" (impossible — helper is total) | `buildVisibleRoomMemoryContext` `try/catch` → `{ entries: [] }`; App callback also `try/catch` → `undefined`. **Empty, never unfiltered.** |
| Malformed / unknown memory `kind` | `deriveFactFromRoomMemory` fails closed to `hidden` → dropped; no throw. |
| Target NPC missing | `handleNPCSay` returns early before building input; callback never invoked. |
| Room mismatch (records' `roomId` ≠ viewer `roomId`) | Cannot happen (recall scoped to `roomId`; viewer `roomId = scope.roomId`); if it ever did, `room-known` facts drop → empty. Fail-closed by construction. |
| Recall not yet settled / ref empty | Callback returns `undefined` → no section (same as today's "no memory"). |
| Recall store throws | Existing `recallRoomMemoryContext` `try/catch` → `RecalledRoomMemory` with `records: []`, logging only a safe code. |

**Invariant:** every failure path can only *remove* entries, never surface
unfiltered ones — matching `recallRoomMemoryContext`'s existing degrade-to-empty
discipline and the parent §15 fail-closed rule.

## 10. Logging / redaction (Decision 5)

- **Kept:** `recallRoomMemoryContext`'s two lines — `info "room memory context
  recalled" {roomId, count}` (now `count = records.length`) and `warn "room memory
  context failed" {roomId, code:'recall-threw'}`.
- **New logs:** none. `buildVisibleRoomMemoryContext` logs nothing. No
  `visibleCount` / `droppedCount`, no per-NPC line.
- **Confirmed not logged:** memory `text`, player lines, NPC/room names, dialogue
  text, prompts, provider bodies, facts, tokens. Only `roomId` + a safe count.

## 11. Safety / authority analysis

- **Can only remove context, never add authority.** The bridge composes two pure,
  fail-closed domain functions (`deriveFactFromRoomMemory` → `filterVisibleFacts`)
  returning a **subset** of the recalled records. It imports no `world-session` /
  `WorldCommand` / `WorldEvent`; nothing can append events or mutate `WorldState`.
  The event log / SQLite remain sole truth.
- **Why `player_claim` is blocked:** `deriveFactFromRoomMemory` maps `player_claim`
  → `{ scope: 'player-known' }` **regardless of `roomId`**, and `filterVisibleFacts`
  returns `false` for `player-known` for every NPC viewer. Structural, not
  text-based.
- **Why hidden / player-known are blocked:** `filterVisibleFacts` returns `false`
  for both `hidden` and `player-known` unconditionally.
- **Why WorldState / event log stays sole truth:** memory remains supporting
  context; this slice only *narrows* what an NPC sees. Memory firewall untouched
  (`memory/**` unchanged; no write path; `recall` unchanged; no FTS).
- **`RoomViewer` memory-decoupling preserved:** raw records never enter
  `RoomViewer`'s import graph or prop types.
- **No fake `npcId`.** Real `target.npcId` only.

## 12. Tests

`buildVisibleRoomMemoryContext.test.ts` (new, pure — Slice 2a):

1. **`player_claim` absent** — a recalled `player_claim` record is excluded from
   `entries` for a real-`npcId` viewer.
2. **Observed room memory remains** — `room_observation` / `room_note` /
   `room_summary` for the scope's room are kept, in input order.
3. **All-filtered omits section** — all `player_claim` (or empty input) →
   `{ entries: [] }` (App then emits no MEMORY section).
4. **Malformed / unknown kind fails closed** — out-of-enum `kind` (unsafe cast) →
   dropped, no throw. (Fail-closed proven here, not via injected throws — Decision 8.)
5. **Slice after filter** — with more visible records than the limit, exactly
   `DEFAULT_ROOM_MEMORY_DIALOGUE_LIMIT` entries in ranked order; and a mix where
   `player_claim` records interleave shows the slice is taken from the *visible*
   set (a `player_claim` never consumes a slot).
6. **Real `npcId` used** — the constructed `NPCFactViewer` carries the passed
   `npcId`, not a placeholder.
7. **Entry shape / hedge compatibility** — surviving entries are
   `{ text: record.text, kind: record.kind }`; kinds are all in the prompt hedge map.
8. **Empty/undefined recalled input** — `undefined` or empty `records` →
   `undefined` / `{ entries: [] }` via the naturally reachable guard (Decision 8).

`recallRoomMemoryContext.test.ts` (update): assert the new `{scope, records}`
return (ranked, **unsliced**); recall still scope-filtered and read-only
(`never writes`); store-throw degrades to `{scope, records:[]}` logging only a
safe code. Move the old "bounds to top-N" assertion to
`buildVisibleRoomMemoryContext` (the slice lives there now).

`RoomViewer.test.ts` (update): `handleNPCSay` invokes
`getRoomMemoryContextForNpc(target.npcId)` and forwards its result as
`memoryContext`; when the prop is absent, no `memoryContext` is sent.

`App.test.tsx` (update / add): end-to-end — a `player_claim` room memory does not
reach the captured `NPCDialogueInput.memoryContext`, while an observed room memory
does; memory feedback still fires pre-visibility (Decision 4).

Regression (no source edits expected): `generation/llmDialoguePrompt` tests
(template/hedge/caps unchanged); `evaluation/logSafety` + `redteam/logLeak`
(no raw text logged); `memory` (recall/firewall unchanged).

## 13. Files likely to change

New (Slice 2a):
- `apps/web/src/app/buildVisibleRoomMemoryContext.ts`
- `apps/web/src/app/buildVisibleRoomMemoryContext.test.ts`

Edited (Slice 2b):
- `apps/web/src/app/recallRoomMemoryContext.ts` (return `RecalledRoomMemory`;
  export the type; stop mapping/slicing; `count` log = `records.length`)
- `apps/web/src/App.tsx` (minimum change per Decision 2: pre-visibility feedback
  via record count; stable `getRoomMemoryContextForNpc` callback; prop swap)
- `apps/web/src/renderer/RoomViewer.tsx` (prop swap + ref sync + `handleNPCSay`
  call with `target.npcId`)
- `apps/web/src/app/recallRoomMemoryContext.test.ts`
- `apps/web/src/renderer/RoomViewer.test.ts`
- `apps/web/src/App.test.tsx`

## 14. Files that must NOT change

- `apps/web/src/generation/llmDialoguePrompt.ts` (template / hedge / caps / system
  prompt) — Decision 7
- `apps/web/src/domain/facts/**` (`selectVisibleRoomMemories`, `visibility`,
  `fromMemory`, `contracts`) — reused as-is
- `apps/web/src/domain/dialogue/contracts.ts`, `buildDialogueContext.ts`
  (`RoomMemoryDialogueContext` shape unchanged)
- `apps/web/src/app/npcDialogueReplyInput.ts` (still takes `memoryContext?:
  RoomMemoryDialogueContext`)
- `apps/web/src/domain/memory/**`, `apps/web/src/memory/**` (recall unchanged; no
  FTS / `recallRelevant` — Decision 6)
- `apps/web/src/dialogue/**` (services / providers),
  `apps/web/src/renderer/engine/**`, `renderer/ui/**`
- `persistence/**`, `server/**`, `migrations/**`
- `WorldState` / `WorldEvent` / `SaveGame` / `RoomSpec` / `QuestSpec`
- `eslint.config.js`, `package.json` (no new dependency; `app/**` may already
  import `domain/facts` + `domain/memory` types — no new lint rule)
- `redteam/**` (no source change expected; must stay green)
- `evaluation/**` (no behavior change expected except API-shape test harness
  adaptation if a direct `recallRoomMemoryContext` caller needs the legacy
  ungated `{ entries }` context for an existing evaluation gate)

## 15. Verification commands (from `apps/web`)

```bash
npm run test -- facts
npm run test -- recallRoomMemoryContext buildVisibleRoomMemoryContext
npm run test -- RoomViewer
npm run test -- App
npm run test -- dialogue
npm run test -- memory
npm run lint
npm run build
```

## 16. Implementation slices

- **Slice 2a — pure app helper + tests (no behavior change).** Add
  `RecalledRoomMemory` type + `buildVisibleRoomMemoryContext` + its tests. Nothing
  calls it yet; `recall` / `App` / `RoomViewer` untouched. Proves compose + map +
  fail-closed in isolation. May be implemented/reviewed on its own.
- **Slice 2b — runtime hook (behavior-changing, separate review).** Change
  `recallRoomMemoryContext`'s return, `App`'s feedback/callback/prop (minimum
  change), `RoomViewer`'s prop/`handleNPCSay`, and update the three runtime test
  files. **This is where `player_claim` stops reaching NPC prompts** — implement
  and review separately from 2a.

## 17. Implementation note — evaluation API-shape adaptation

Some `evaluation/**` tests directly called `recallRoomMemoryContext` and consumed
the old `{ entries }` dialogue-context shape. Slice 2b intentionally changes that
helper to return `RecalledRoomMemory { scope, records }`, so those evaluation
callers are adapted with an evaluation-local helper that maps the ranked records
back to the legacy ungated context shape (`records -> slice(5) -> { text, kind }`)
only for the existing plateau/budget/log-safety gates that are not testing
visibility filtering.

This is a test harness/API-shape update only. Evaluation semantics remain
unchanged: the old gates continue measuring the existing recall/ranking plateau
behavior, not the new visibility gate. No runtime FTS wiring is added, and no
prompt-template or provider behavior changes are made.

## 18. Open questions

None blocking — Decisions 1–8 resolve the shaping questions. Deferred (not this
slice): NPC-memory → dialogue wiring and `npc-known` visibility; FTS
`recallRelevant` wiring; any `Fact` persistence/store; a `world-derived` authority
projector; log counters.

## Minimum Safe Change Check

- **Reused:** `selectVisibleRoomMemories` + `filterVisibleFacts` +
  `deriveFactFromRoomMemory` + `NPCFactViewer` (`domain/facts`, committed);
  `RoomMemoryRecord` / `RoomMemoryScope` (`domain/memory`); `rankMemories` and the
  existing `recallRoomMemoryContext` recall/degrade discipline; the existing
  `RoomViewer` effect/ref prop pattern; the unchanged prompt hedge/caps. No new
  dependency, no new lint rule.
- **New code actually necessary:** `RecalledRoomMemory` type +
  `buildVisibleRoomMemoryContext` (Slice 2a); a return-shape change in
  `recallRoomMemoryContext`, an additive `App` callback + pre-visibility feedback
  read, and a `RoomViewer` prop swap (Slice 2b). Nothing more.
- **Safety boundaries unchanged:** world authority (event log sole truth), memory
  firewall (no truth path, `recall` unchanged, no FTS), no `world-derived`
  authority produced, `player_claim` / hidden / player-known exclusion by
  `filterVisibleFacts`, fail-closed on malformed input and empty context, no new
  logging, no persistence/schema change, prompt template/hedge/caps unchanged,
  `RoomViewer` memory-decoupling preserved, no fake `npcId`.
- **Tests that prove it:** §12 — `player_claim` absent, observed kept, all-filtered
  omits section, unknown-kind fail-closed, slice-after-filter, real-`npcId` wiring,
  entry-shape/hedge compatibility, and end-to-end that a `player_claim` never
  reaches `NPCDialogueInput.memoryContext`.
</content>
</invoke>
