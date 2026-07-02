# ADR-0071: Room Memory Visible Feedback v0

- **Status:** Accepted - Implemented (manual smoke pending maintainer verification)
- **Date:** 2026-07-02
- **Deciders:** Project owner
- **Extends:**
  [ADR-0025](./ADR-0025-living-world-room-memory-v0.md) (room memory is inert,
  scoped supporting context),
  [ADR-0035](./ADR-0035-room-inspect-summary-v0.md) (precedent for a small
  dismissible/transient `role="status"` overlay driven by closed, hand-written
  text),
  [ADR-0070](./ADR-0070-runtime-room-memory-persistence-v0.md) (hard
  dependency — memories this feature reports on must survive Save/Continue/Load
  first).

> Full implementation closeout lives in
> [`room-memory-visible-feedback-v0`](../implementation-plans/room-memory-visible-feedback-v0.md).

---

## Context

Living-World Room Memory v0 and its successors (memory-event-promotion-v0,
Runtime Room Memory Persistence v0) made room memory durable and recallable,
but the system stayed entirely invisible to the player. A player who caused a
durable change never learned the world would remember it; recalled memories
only surfaced indirectly through NPC dialogue flavor text. This made the
memory system hard to trust or notice, and made it impossible to tell whether
a given action "mattered" without opening dialogue with an NPC.

The feature was explicitly sequenced after ADR-0070 landed: showing feedback
about a memory that could silently vanish on save/load would have been a false
promise to the player.

---

## Decision

Add brief, generic, non-spammy visual feedback at the two moments the
room-memory system already acts: when a durable memory is **created**
(interaction promotion) and when entering a room where memories are
**recalled**. All feedback text comes from two closed, hand-written constants.
Feedback is a pure, read-only projection of safe counts already produced by
the existing promotion/recall paths — it writes no memory, appends no event,
emits no command, and does not change memory truth semantics.

No `RoomMemoryStore`/`RoomMemoryService` port, memory schema,
`SaveGame`/`WorldState` schema, save-load sidecar, provider/LLM path, or
`WorldState` reducer changed.

---

## Closed Message Table

```ts
export const MEMORY_CREATED_MESSAGE = 'The room remembers this.'
export const MEMORY_RECALLED_MESSAGE = 'Something about this place feels remembered.'
```

These are the **only two strings** `MemoryFeedback` can ever render in real
wiring. Both are deliberately epistemic-neutral ("remembers", "feels
remembered") — neither asserts a world fact, quest change, item state, or
player advantage. No raw memory `text`, `kind`, room/object/NPC name, object
id, flag key, provider output, or count-as-text ("3 memories") is ever
rendered or logged. A dedicated leak-sweep test
(`renderer/ui/MemoryFeedback.test.tsx`) proves the component does not surface
arbitrary strings beyond these two in its real usage shape.

---

## PromotionSummary Plumbing

`promoteInteractionMemories` (`apps/web/src/app/promoteInteractionMemories.ts`)
now returns `Promise<PromotionSummary>` instead of `Promise<void>`:

```ts
type PromotionSummary = Readonly<{
  recorded: number
  deduplicated: number
  rejected: number
  failed: number
}>
```

The change is additive: existing swallow-and-log behavior for a per-event
`remember` failure or store throw is unchanged, and a caller that ignores the
return value observes no behavior change. `rejected` (the memory firewall
refused the draft) and `failed` (the store/service failed unexpectedly) are
tracked as separate counts — both are safe, closed-enum-derived numbers, never
memory content.

---

## Feedback Decision Gate

A pure function owns all precedence/anti-spam logic so it is unit-testable
outside React:

```ts
// apps/web/src/app/memoryFeedback.ts
function decideMemoryFeedback(input: {
  promotionSummary: PromotionSummary
  hasRecalledMemory: boolean
  roomEntrySeq: number
  shownForRoomEntrySeq: number | null
}): MemoryFeedbackMessage | null
```

Rules:

- `recorded > 0` → `MEMORY_CREATED_MESSAGE` (creation always wins over recall).
- Otherwise, `hasRecalledMemory && shownForRoomEntrySeq !== roomEntrySeq` →
  `MEMORY_RECALLED_MESSAGE`.
- Otherwise `null`. Deduplicated-only, rejected-only, and failed-only
  promotions never produce feedback.

The composition root (`apps/web/src/app/App.helpers.ts`) wraps this gate in a
small `MemoryFeedbackState` reducer set (`memoryFeedbackAfterPromotion`,
`memoryFeedbackAfterRecall`, `memoryFeedbackOnRoomEntry`) so `App.tsx` folds
promotion/recall outcomes into one feedback slot without duplicating the
precedence rule. `shownForRoomEntrySeq` is the anti-spam key: once any
feedback has shown for a room entry, a later recall refresh in that same entry
does not immediately re-trigger the recall message, and it resets only when
`roomEntrySeq` advances (a new room entry).

This logic landed in the pre-existing `app/App.helpers.ts` composition-root
helper module — which already held sibling save/restore/objective helper
functions — rather than as new code inlined in `App.tsx`, per the Minimum Safe
Change Rule.

---

## roomEntrySeq Spam Suppression

`roomEntrySeq` (already used by `RoomIntroPanel`, ADR-0035) is the shared
anti-spam/reset key. `App` tracks it in both `useState` (for render) and a
mirrored `useRef` (`roomEntrySeqRef`) so callbacks that fire before a state
flush — including a promotion callback whose promise resolves after a room
change — can still read the entry that was active at commit time. Every new
room entry (`enterActivePlay`, `handleNavigate`) increments the sequence and
clears any currently visible feedback via `memoryFeedbackOnRoomEntry`.

---

## Auto-Dismiss Behavior

Creation and recall feedback both auto-dismiss after
`MEMORY_FEEDBACK_AUTO_DISMISS_MS = 4000` via a single `useEffect` in `App.tsx`
that resets whenever `memoryFeedbackState.message` changes and always clears
its `setTimeout` on cleanup/unmount — the same idiom already used by
`QuestTracker`'s recently-completed timer. Feedback is also cleared
immediately by room entry, independent of the timer.

---

## Purely Presentational

`MemoryFeedback` (`apps/web/src/renderer/ui/MemoryFeedback.tsx`) is a ~13-line
component: `{ message: string | null } → role="status" aria-live="polite"`
line, or nothing when `null`. It imports nothing beyond React — no
`memory/**`, `domain/memory/**`, renderer-engine, or Three.js import. Dismissal
or auto-dismissal changes nothing else in the app: no memory write, no
`WorldState` mutation, no event, no command, no persisted "already shown"
state.

---

## No Raw Memory Text/Ids/Names/Count Text

Reaffirming the existing memory firewall (ADR-0024, ADR-0025): this feature
adds no new read of memory `text`, and the only two strings it can display are
the closed constants above. Diagnostics/logging add no new surface; existing
`RoomMemoryService`/promotion logging (ids, enums, counts only) is unchanged
and this feature adds no additional log line.

---

## No WorldState Mutation / No Memory Authority Change

Feedback is derived entirely from values already produced by the existing
promotion (`promoteWorldEvent` → `RoomMemoryService.remember`) and recall
(`recallRoomMemoryContext`) paths. It reads no `WorldState`, appends no
`WorldEvent`, issues no `WorldCommand`, and does not change what counts as a
"recorded" vs. "deduplicated"/"rejected"/"failed" promotion outcome. Room
memory remains supporting context only, never truth.

---

## No Save/Load/Schema/Provider Changes

- `SaveGame`, `WorldState`, `RoomSpec`, and `QuestSpec` `schemaVersion` fields
  are unchanged.
- `SlotWrapper` gained no new field; `roomMemoryJson` (ADR-0070) is untouched.
- `memoryFeedbackState` is transient component state only — never persisted,
  never restored. After a Save/Continue/Load, recall feedback naturally fires
  again on the restored room's first entry if restored memories exist, which
  is expected and only possible because ADR-0070 landed first.
- No new LLM/provider/network call; recall feedback keys off
  `entries.length` before any provider ever sees the recalled entries, so the
  feature behaves identically in the fake/no-key demo and works with zero cost
  impact.

---

## Limitations / Non-Blocking Notes

- **Captured `roomEntrySeq` for creation feedback.** The creation-feedback
  decision is keyed to the room entry active when the interaction committed
  (captured via `roomEntrySeqRef.current` at the start of promotion), not
  necessarily the entry current when the promotion promise resolves. This
  matches the gameplay action that caused the memory rather than wherever the
  player has since navigated.
- **Recall stale-request guard.** `refreshRoomMemoryContext`'s existing
  monotonic request-id guard (pre-dating this feature) also gates the recall
  feedback decision, so a slow recall from an abandoned room entry cannot
  surface a recall message for the wrong room.
- **`MemoryFeedback.test.tsx` imports app-layer constants** from
  `app/memoryFeedback` for readable assertions. The component itself imports
  only React; the runtime UI/app-layer import boundary is unaffected — only
  the test file crosses it.
- **Placement/z-order** with `RoomIntroPanel`, the fallback/repair notice, and
  the HUD has not had a dedicated visual QA pass; `MemoryFeedback` renders
  after `AppRoomEntryOverlay` and before `PromptBar`/`UsageMeter` in the
  render tree. This is accepted as non-blocking for v0 and is part of the
  manual smoke checklist.
- **Recall-feedback fatigue** (a line on every remembered room re-entry,
  despite once-per-entry gating) is a known future tuning risk; no threshold
  or session-scoped suppression was added in v0.
- Manual smoke is pending maintainer verification.

---

## Manual Smoke Pending

The implementation has automated coverage for the decision gate
(`decideMemoryFeedback`), `PromotionSummary` counts per outcome, the
presentational component (message rendering, `null` rendering, accessible
role, leak sweep), and App-level wiring (state transitions, auto-dismiss
effect cleanup, room-entry clearing, no duplicate recall re-trigger within one
entry). Maintainer manual smoke remains pending for the live browser
experience: visible timing/fade, no-spam behavior on repeated/deduplicated
interactions, Save/Continue/Load recall re-trigger, generated play, the
`role="status"`/`aria-live="polite"` screen-reader contract, console log
review, and the z-order visual pass noted above.
