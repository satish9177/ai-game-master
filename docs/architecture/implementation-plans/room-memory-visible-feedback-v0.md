# Implementation Plan — `feature/room-memory-visible-feedback-v0`

> Status: **Implemented — manual smoke pending maintainer verification.**
> ADR: [ADR-0071](../decisions/ADR-0071-room-memory-visible-feedback-v0.md).
> Companion docs: [ARCHITECTURE](../ARCHITECTURE.md) · [BOUNDARIES](../BOUNDARIES.md) ·
> [AGENTS.md](../../../AGENTS.md).
> Direct precedents:
> [ADR-0025](../decisions/ADR-0025-living-world-room-memory-v0.md) — memory is
> inert context, never truth (feedback must not contradict this);
> memory-event-promotion-v0 — the promotion path whose outcomes this feature
> surfaces; [ADR-0035](../decisions/ADR-0035-room-inspect-summary-v0.md) — the
> precedent for a small dismissible/transient `role="status"` overlay driven by
> closed, hand-written text; [ADR-0070](../decisions/ADR-0070-runtime-room-memory-persistence-v0.md)
> — the hard dependency this feature sequences after.

## Summary

- **Why this feature exists.** The living-world memory system is invisible: a
  player who causes a durable change never learns the world will remember it,
  and recalled memories only surface indirectly through NPC dialogue flavor.
  Small, generic, safe feedback ("The room remembers this.") makes the system
  legible without exposing memory internals.
- **What it depends on.** `runtime-room-memory-persistence-v0` (feature 8) must
  be merged and smoke-verified first — feedback about memories that silently
  vanish on save/load would be a false promise. Uses only shipped promotion/
  recall wiring otherwise.
- **What it intentionally does not do.** No raw memory text, no ids/flag keys,
  no provider output, no implication that memory is authoritative, no memory
  browser/journal UI, no new memory writes or reads beyond what already runs.
- **Closeout status.** Implemented on branch
  `feature/room-memory-visible-feedback-v0`; manual smoke is pending maintainer
  verification. Feedback remains a read-only projection — no memory write,
  `WorldState` mutation, schema, save-load, or provider change.

---

## 1. Goal

Give the player brief, generic, non-spammy visual feedback at the two moments
the room-memory system already acts: when a durable memory is **created**
(interaction promotion) and when entering a room where memories are
**recalled**. All text comes from closed hand-written constants; the feedback is
a read-only projection of safe counts.

## 2. Current repo facts (verified against source)

- **Creation seam.** `App.tsx:514–536` `handleCommittedInteractionEvents` calls
  `promoteInteractionMemories(...)` (fire-and-forget, `Promise<void>` —
  `app/promoteInteractionMemories.ts:23–43`), then re-recalls. The promotion
  result (`recorded` vs `deduplicated` vs `rejected`/`failed`,
  `memory/RoomMemoryService.ts:26–30`) is currently discarded by the
  orchestrator.
- **Recall seam.** `App.tsx:420–431` `refreshRoomMemoryContext` receives the
  recalled `RoomMemoryDialogueContext` (`entries.length` is a safe count) and
  stores it for dialogue; nothing user-visible reacts to it.
- **Existing transient-overlay patterns to reuse:** the fallback notice
  (`App.tsx:200–225`, `room-notice`, dismiss button) and `RoomIntroPanel`
  (ADR-0035, `role="status"`, `aria-live="polite"`, reset keyed by
  `sessionId:room.id:entrySeq`). `roomEntrySeq` (`App.tsx:386`) already
  increments on every room entry — the natural anti-spam key.
- **Logging/leak rules:** memory `text` is never logged or displayed raw
  (AGENTS.md memory rules); `RoomMemoryService` logs ids/enums/counts only.
- **Fake/no-key demo:** promotion is driven by committed `WorldEvent`s from
  interactions (`domain/memory/promotion.ts` — `room-state-changed` with flags,
  `item-discovered`), fully provider-independent, so feedback works with no key.

## 3. Final behavior

- **Creation feedback:** when an interaction commit results in ≥1 *newly
  recorded* room memory (not `deduplicated`, not `rejected`/`failed`), a small
  transient status line appears: `MEMORY_CREATED_MESSAGE = 'The room remembers
  this.'` It auto-dismisses after ~4 s and is also cleared by room entry.
- **Recall feedback:** on room entry, if the recall for the new room returns ≥1
  entry, a subtler one-time line appears: `MEMORY_RECALLED_MESSAGE = 'Something
  about this place feels remembered.'` Shown at most **once per room entry**
  (keyed by `roomEntrySeq`), never re-shown by dialogue-driven re-recalls within
  the same entry.
- **Rejected vs. failed accounting:** promotion summaries track rejected records
  separately from failed records. Rejected means the memory firewall refused the
  draft; failed means the store/service failed unexpectedly. Neither produces
  feedback; only `recorded > 0` does.
- **Precedence/anti-spam:** one feedback slot; creation replaces recall;
  identical consecutive messages within one room entry do not re-trigger;
  deduplicated-only, rejected-only, and failed-only promotions show nothing.
  Once any memory feedback has been shown for a room entry, later recall refreshes
  in that same entry do not immediately show the recall message again.
- Feedback is purely presentational — dismissing/ignoring it changes nothing.
- Wording is deliberately epistemic-neutral ("remembers", "feels remembered") —
  it never asserts a world fact, quest change, or advantage.

## 4. Safety boundaries

- **Read-only projection.** Feedback derives from safe counts already produced
  by the promotion/recall paths. It writes no memory, appends no event, emits no
  command, and adds no new `memory/**` import to any UI/renderer module — the
  new component receives a plain `string | null` prop.
- **No content leakage.** Only the two closed constants are ever rendered. No
  memory `text`, `kind`, room/object/NPC names, object ids, flag keys, provider
  output, or counts-as-text ("3 memories") appear in the UI. Same for logs (at
  most a `memory feedback shown { kind: 'created' | 'recalled' }` info line —
  or no new logging at all; prefer none).
- **Not authoritative.** The strings avoid any claim about quests, items, or
  state; the ADR will record the wording as a reviewed, closed table.
- **No schema/save-load/persistence change.** Feedback state is component
  state; nothing is persisted; no `SlotWrapper` change.
- **No provider/cost impact.** Zero new LLM/network calls; works identically in
  the fake/no-key demo.

## 5. Non-goals

- ❌ A memory journal/browser or any list of memories.
- ❌ Showing memory text (even "intentionally safe" text — v0 keeps the closed
  generic strings only; a future feature may revisit with entity-snapshot names).
- ❌ Feedback for NPC memory (browser-unwired) or for memory *use inside a
  reply* (the dialogue text itself is the feedback there).
- ❌ Sounds, animations, or renderer/engine changes.
- ❌ Persisting "already shown" state across save/load.
- ❌ Per-memory badges/toast stacks — one slot, one line.

## 6. File-level change plan

| File | Change |
| --- | --- |
| `apps/web/src/app/promoteInteractionMemories.ts` | Return `Promise<PromotionSummary>` where `PromotionSummary = { recorded: number; deduplicated: number; rejected: number; failed: number }` (additive; existing behavior/logging unchanged; current caller ignores the value until App wiring lands). |
| `apps/web/src/app/promoteInteractionMemories.test.ts` | Cover the summary counts per outcome. |
| `apps/web/src/app/memoryFeedback.ts` (new) | Closed constants `MEMORY_CREATED_MESSAGE`, `MEMORY_RECALLED_MESSAGE`; pure `decideMemoryFeedback(input: { recorded?: number; rejected?: number; failed?: number; recalledCount?: number; alreadyShownForEntry: boolean }): string \| null` so precedence/anti-spam logic is unit-testable outside React. |
| `apps/web/src/app/memoryFeedback.test.ts` (new) | Pure decision tests. |
| `apps/web/src/renderer/ui/MemoryFeedback.tsx` (new) | Tiny presentational component: `{ message: string \| null }` → `role="status"` `aria-live="polite"` line; renders nothing when `null`. No timers inside (App owns lifetime), no imports beyond React. |
| `apps/web/src/renderer/ui/MemoryFeedback.test.tsx` (new) | Renders message / renders nothing. |
| `apps/web/src/App.tsx` | `memoryFeedback: string \| null` state + ~4 s auto-dismiss effect + clear on `roomEntrySeq` change; creation hook in `handleCommittedInteractionEvents` (consume `PromotionSummary`); recall hook in `refreshRoomMemoryContext` (first recall per entry with entries → recalled message, guarded by an entry-keyed ref). Render `<MemoryFeedback />` beside the existing overlays. |
| `apps/web/src/App.test.tsx` | Wiring assertions (see §10). |

### Minimum Safe Change Check

- **Reused:** existing promotion/recall seams, `roomEntrySeq`, the
  notice/intro-panel overlay conventions, existing CSS panel/status classes
  where possible.
- **New code:** one pure decision module, one ~20-line presentational
  component, small App state.
- **Boundaries unchanged:** memory firewall, read-only projection rule, logging
  redaction, no persistence.
- **Targeted tests:** §10.

## 7. Data/state model changes

None persisted. New transient App state: `memoryFeedback: string | null` plus a
per-entry "recall feedback shown" ref. `PromotionSummary` is a new in-memory
return type only.

## 8. Save/load implications

None. Feedback state is never saved; after a load, recall feedback naturally
fires for the restored room's first entry if restored memories exist — which is
correct and only possible because feature 8 landed first.

## 9. Provider/LLM implications

None. No prompt, provider, or usage-meter change. (Recall feedback keys off
`entries.length` before any provider ever sees the entries.)

## 10. Tests required

- `decideMemoryFeedback`: recorded>0 → created message; recalled>0 &&
  !alreadyShown → recalled message; created wins over recalled; deduplicated/
  rejected/failed-only → null; alreadyShown suppresses recall; zero everything
  → null.
- `promoteInteractionMemories`: summary counts for recorded / deduplicated /
  rejected / store-throw outcomes, with rejected counted separately from failed;
  existing swallow-and-log behavior unchanged.
- `MemoryFeedback`: message renders with `role="status"`; `null` renders
  nothing.
- App-level: committed interaction with a promotable event → created message
  appears then auto-dismisses; entering a room with restored/recalled memories →
  recalled message once, not re-shown on dialogue re-recall in the same entry;
  once any memory feedback has shown for a room entry, a later recall refresh in
  that same entry does not immediately duplicate the recall feedback;
  room entry clears any visible feedback; no-memory flows show nothing; captured
  logger gains no memory text.
- Leak sweep: assert the two constants are the only strings the component can
  ever receive from the decision function (exhaustive return-value test).

## 11. Manual smoke checklist

**Status: pending maintainer verification.** Automated coverage exists for the
decision logic, `PromotionSummary` counts, the presentational component, and
App-level wiring/state transitions (see §13a); the live browser experience
below has not yet been exercised by the maintainer.

1. Demo world, no key: take the tribute coin → "The room remembers this."
   appears briefly, then fades; no spam on further interactions with no durable
   effect.
2. Re-doing the same interaction (already-resolved / deduplicated) shows
   nothing.
3. Save → Continue → walk back into the remembered room → recall line shows
   once; opening/closing dialogue repeatedly does not re-show it.
4. Generated play behaves the same.
5. Screen reader (or DOM inspection): line is `role="status"`,
   `aria-live="polite"`.
6. No memory text, ids, or counts in the UI or console.
7. Visual z-order/overlap pass on a fresh generated-room entry: confirm
   `MemoryFeedback` does not visually collide with `RoomIntroPanel`, the
   fallback/repair notice, or the HUD when more than one can appear at once.

## 12. Rollback notes

Single revert removes the component, constants, and App state. The
`promoteInteractionMemories` return-type change is additive (callers may ignore
it) — revert restores `Promise<void>`. Nothing persisted, no schema, no
migration.

## 13. Implementation slices

1. **Docs (this plan)** — complete in `3eeebea` (planning commit on `main`,
   shared with `runtime-room-memory-persistence-v0`).
2. **Pure logic** — complete in `81545ec` (`feat: add room memory feedback
   decisions`): `apps/web/src/app/memoryFeedback.ts` adds
   `MEMORY_CREATED_MESSAGE`, `MEMORY_RECALLED_MESSAGE`,
   `MEMORY_FEEDBACK_AUTO_DISMISS_MS`, `PromotionSummary`/
   `EMPTY_PROMOTION_SUMMARY`, and the pure `decideMemoryFeedback` gate.
3. **`PromotionSummary` return** — complete in `49fc014` (`feat: summarize room
   memory promotion results`): `promoteInteractionMemories` now returns
   `Promise<PromotionSummary>` (recorded/deduplicated/rejected/failed counts);
   the swallow-and-log behavior for a per-event `remember` failure/throw is
   unchanged.
4. **UI + wiring** — complete in `f9d087d` (`feat: show room memory
   feedback`): `apps/web/src/renderer/ui/MemoryFeedback.tsx` (presentational,
   React-only import) plus App state/hooks. The App-side precedence/anti-spam
   wrapper (`MemoryFeedbackState`, `memoryFeedbackAfterPromotion`,
   `memoryFeedbackAfterRecall`, `memoryFeedbackOnRoomEntry`) landed in the
   existing `apps/web/src/app/App.helpers.ts` composition-root helper module
   rather than inline in `App.tsx`, reusing the file already holding sibling
   save/restore/objective helpers (Minimum Safe Change Rule — smaller `App.tsx`
   diff, no new file). `App.tsx` owns only the `useState`/`useRef`/`useEffect`
   wiring and the auto-dismiss timer.
5. **Docs closeout** — this update: `ARCHITECTURE.md` status entry, ADR-0071,
   verification results, and manual smoke checklist. Manual smoke remains
   pending maintainer verification.

## 13a. Verification results

- `npm.cmd run test -- MemoryFeedback App memoryFeedback promoteInteractionMemories memory`
  - Passed: 49 files, 819 tests.
- `npm.cmd run lint`
  - Passed.
- `npx.cmd tsc --noEmit -p tsconfig.app.json`
  - Failed only in unrelated baseline locations:
    `src/domain/assembleRoom.test.ts`, `src/domain/ensureGeneratedNpcPresence.ts`,
    and `src/generation/OpenAICompatibleNPCDialogueProvider.test.ts`. No
    failures referenced any Slice 2–4 changed file.
- `git diff --check`
  - Passed, no whitespace errors.

## 14. Dependencies on earlier/later features

- **Hard dependency:** feature 8 (`runtime-room-memory-persistence-v0`) merged
  and verified — explicitly sequenced after it.
- Independent of features 7 and 11. Feature 9 (redteam) should add a check
  that feedback strings are closed constants (no interpolation path).

## 15. Open questions / risks

- **Exact wording** of the two constants shipped as originally drafted
  (`MEMORY_CREATED_MESSAGE`, `MEMORY_RECALLED_MESSAGE`); recorded as the
  closed table in ADR-0071. No maintainer wording change requested during
  implementation.
- **Recall-feedback fatigue:** if every remembered room triggers a line, dense
  play may still feel noisy despite once-per-entry gating. Fallback lever:
  show recall feedback only when `entries.length` crosses a small threshold, or
  only on the first entry per session per room — left as a future tuning
  option, not implemented in v0.
- **Placement/z-order** with `RoomIntroPanel` + fallback notice + HUD: accepted
  non-blocking for v0. `MemoryFeedback` renders after `AppRoomEntryOverlay`
  (intro/fallback notice) and before `PromptBar`/`UsageMeter` in `App.tsx`'s
  render tree; a live visual pass is part of the manual smoke checklist below
  rather than a blocking closeout item.
- Auto-dismiss timer in React StrictMode/test environments follows the
  existing `QuestTracker` cleanup idiom (single `useEffect`, timer cleared on
  every re-run and on unmount) — no dangling-timer behavior observed in the
  App test suite.

## 16. Accepted non-blocking v0 notes

- **Creation feedback uses a captured `roomEntrySeq`.** `handleCommittedInteractionEvents`
  reads `roomEntrySeqRef.current` once at the start of the promotion call and
  passes that captured value into `memoryFeedbackAfterPromotion` after the
  promotion promise settles. If the player navigates to a new room while a
  promotion is still in flight, the created-message decision is keyed to the
  room entry active *when the interaction was committed*, not whichever entry
  is current when the promise resolves — this is intentional (matches the
  gameplay action that caused it) but means a same-tick race with navigation
  is not separately covered by an App-level test beyond the existing
  stale-recall guard.
- **Recall has a stale-request guard.** `refreshRoomMemoryContext` discards a
  recall result whose `roomMemoryRequestRef` no longer matches the latest
  request before applying either `roomMemoryContext` or the recall feedback
  decision, so a slow recall from a since-abandoned room entry cannot surface
  a recall message for the wrong room.
- **`MemoryFeedback.test.tsx` imports app-layer constants** (`MEMORY_CREATED_MESSAGE`,
  `MEMORY_RECALLED_MESSAGE` from `app/memoryFeedback`) for readable assertions.
  The component itself (`renderer/ui/MemoryFeedback.tsx`) imports nothing
  beyond React — the runtime UI/app-layer import boundary stays clean; only the
  test file crosses it for readability.
- **Manual smoke should check z-order/overlap** with `RoomIntroPanel`, the
  fallback notice, and the HUD on a fresh generated-room entry — see item 7 in
  the checklist above (§11).
