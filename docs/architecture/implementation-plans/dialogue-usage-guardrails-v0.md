# Implementation Plan — `feature/dialogue-usage-guardrails-v0`

> Status: **Slice 1 in progress (this doc + ADR draft). Slices 2–4 not started.**
> ADR: [ADR-0068](../decisions/ADR-0068-dialogue-usage-guardrails-v0.md) (draft).
> Maintainer approved the design in-chat. Locked decisions (verbatim):
> (1) remove NPC provider auto-call on dialogue open; (2) opening NPC dialogue
> seeds/shows only the static greeting; (3) prompt buttons and Continue remain
> user-triggered provider call paths; (4) add `requestDialogueAttempt` callback
> from `App` to `RoomViewer`; (5) `App` owns usage state and guardrail decisions;
> (6) fake provider calls do not count and do not consume usage; (7) real provider
> dialogue calls share the existing session usage meter/cap; (8) use existing usage
> guard API (`canAttemptOptional` + `recordAttempt`); (9) if cap is reached, do not
> call provider; (10) show a calm safe in-panel message; (11) no provider/API
> key/prompt/dialogue text in logs; (12) no `WorldState` mutation; (13) no memory
> write; (14) no schema/save-load/persistence changes; (15) no
> `NPCDialogueService`/provider changes unless implementation review proves it
> unavoidable; (16) keep the `providerGateStatus`/`providerGate` carry bugfix
> separate.
>
> Companion docs: [ARCHITECTURE](../ARCHITECTURE.md) · [BOUNDARIES](../BOUNDARIES.md) ·
> [AGENTS.md](../../../AGENTS.md).
> Direct precedents this plan builds on:
> [ADR-0030](../decisions/ADR-0030-cost-usage-guardrails-v0.md) — the original
> per-session real-attempt meter and the pure `usageGuard` API this plan reuses;
> [ADR-0050](../decisions/ADR-0050-multi-call-usage-guardrails-v0.md) — the
> multi-call optional-budget model (`canAttemptOptional`) this plan extends to a
> new call class;
> [ADR-0065](../decisions/ADR-0065-real-npc-dialogue-room-memory-awareness-v0.md) —
> the opt-in real dialogue provider whose calls this plan brings under the meter;
> [ADR-0067](../decisions/ADR-0067-generated-npc-dialogue-spec-v0.md) — the
> greeting-plus-prompt-buttons `NPCDialoguePanel` contract that must not regress.

---

## 1. Goal

Bring real NPC dialogue provider calls under the existing session usage meter and
stop the unnecessary provider call fired just from opening a dialogue. Today, with
a complete real-provider config, pressing **F** on an NPC can spend real tokens
that the usage meter never counts, so the meter under-reports and never caps
dialogue spend.

This slice makes two changes with one shared intent — *no real provider spend the
player did not deliberately trigger, and every real dialogue call is metered*:

1. **Remove the auto-call on dialogue open.** Opening a dialogue shows only the
   static authored/generated greeting; it makes no provider call.
2. **Meter and cap the surviving user-triggered dialogue calls** (prompt buttons
   and Continue) against the existing session meter, via an `App`-owned
   `requestDialogueAttempt` gate. Fake-provider calls stay zero-cost and never
   count. At cap, the provider is not called and a calm in-panel message shows.

---

## 2. Current repo facts (verified against source)

- **Auto-call on open — `renderer/RoomViewer.tsx:220–259`.** The
  `engine.onRequestOpenInteraction` dialogue branch:
  - seeds the greeting turn from the static `dialogueTarget.dialogue.greeting`
    (`:226–229`),
  - sets pending (`:230–231`),
  - then **immediately** calls `npcDialogueService.reply(...)` with `history: []`,
    `playerLine: undefined` (`:234–257`).

  This is the "auto-request an NPC provider reply on dialogue open." For the real
  provider it is a network call/spend; for the fake it is a zero-cost in-process
  call.

- **User-triggered calls — `renderer/RoomViewer.tsx:370–425` (`handleNPCSay`).**
  Calls `npcDialogueService.reply(...)` (`:391–422`) on every prompt-button click
  and on the "Continue" button (`onSay(undefined)`). "Continue" is rendered only
  when no prompts remain (`renderer/ui/NPCDialoguePanel.tsx:96–104`).

- **Provider chain.** `NPCDialogueService.reply` (`dialogue/NPCDialogueService.ts:45`)
  → `this.provider.reply` → either `FakeNPCDialogueProvider` (deterministic, no I/O,
  no logging — `dialogue/FakeNPCDialogueProvider.ts:151–152`) or
  `OpenAICompatibleNPCDialogueProvider` (real `fetch` + spend —
  `generation/OpenAICompatibleNPCDialogueProvider.ts:59`).

- **Provider selection.** `app/selectDialogueProvider.ts:25` returns `kind: 'real'`
  only when `isRealProviderComplete(config)` (`app/llmConfig.ts:100–104`). Both
  `dialogueProviderSelection` and `npcDialogueService` are built at **module scope**
  in `App.tsx:121,131` — outside the React component, so they cannot read the live
  usage refs.

- **Usage guard is pure and already present — `domain/usage/usageGuard.ts`.**
  `canAttemptOptional(state, config)` (`:31–34`) returns `true` when
  `!config.enabled`, else `state.count < config.cap`; `recordAttempt(state)`
  (`:23–25`) returns `{ count: count + 1 }`; `evaluate(state, config)` (`:45–50`)
  maps to `inert | ok | approaching | at-cap`.

- **Usage state is component-scoped in `App.tsx`.** `usageCountRef` /
  `setUsageCount` (`:431–432`), `guardConfig` (`:437–440`),
  `guardEnabled = roomGeneratorSelectionLog.provider !== 'fake'` (`:111`),
  `guardCap = llmConfig.sessionCap` (`:112`). Existing consumers: room generation
  (`handlePrompt`, `:538–551`), objective generation (`:637–653` and
  `attachPerRoomObjectiveOnEnter`, `:964–983`), gate generation (`:641–644`).
  **Dialogue is not among them.**

- **`guardEnabled` equals dialogue-real today.** `selectRoomGenerator` and
  `selectDialogueProvider` both read the same `llmConfig` and gate on
  `isRealProviderComplete`, so the room generator is real **iff** the dialogue
  provider is real. This plan still keys dialogue counting on the dialogue
  selection (`dialogueProviderSelection.kind === 'real'`) so a future divergence
  stays correct.

- **Calm-message precedent — `app/dialogue.ts:34–39` (`dialogueResultMessage`).**
  Already returns short, safe strings for non-`replied` results
  ("They have nothing to say right now." / "This conversation is unavailable."),
  surfaced via `RoomViewer`'s `setNPCDialogueMessage` and rendered in the panel's
  `message` slot (`renderer/ui/NPCDialoguePanel.tsx:107`).

- **`RoomViewer` prop seam — `App.tsx:992–1006`.** `RoomViewer` already receives
  services and intent callbacks from `App`; adding one more callback prop matches
  the existing composition seam and keeps usage-state ownership in `App`.

**Confirmed problem:** with a real key, the meter counts room/objective/gate calls
but **every** dialogue `reply` (the open auto-call plus each prompt/Continue click)
is uncounted, so the meter under-reports real spend and dialogue is never capped.

---

## 3. Problem statement

1. **Uncounted spend.** Real dialogue provider calls bypass the session usage
   meter, so the meter can claim the user is under cap while real dialogue spend
   accrues.
2. **Unnecessary spend on open.** `RoomViewer` fires a provider reply the instant
   an NPC dialogue opens, before the player has said anything — pure overhead for
   the real provider and inconsistent with "the greeting is static, authored data."

---

## 4. Final behavior

- **On open:** the panel shows only the static `dialogue.greeting` turn. No
  provider call, no pending spinner from opening. (Locked decisions 1–2.)
- **Prompt button / Continue:** still call the provider, now gated. `App` decides
  via `requestDialogueAttempt()`:
  - **Fake provider:** always allowed; **not counted** (zero-cost). (Decision 6.)
  - **Real provider, below cap:** allowed; the shared session meter increments by
    one via `recordAttempt`; the `UsageMeter` re-renders. (Decisions 7–8.)
  - **Real provider, at cap:** **not allowed**; the provider is **not called**; a
    calm safe in-panel message shows; greeting, prompt buttons, and Close/Esc
    remain usable. No "continue anyway" dialogue bypass in v0. (Decisions 9–10.)
- Room/quest/memory dialogue context (previously first sent on open) now flows on
  the **first** prompt/Continue click instead — same context, later trigger.
- Room/objective/gate generation continue to use the same meter, unchanged.
- generated-npc-dialogue-spec-v0 (ADR-0067) is unaffected: generated NPCs still
  open `NPCDialoguePanel` with a greeting and two prompt buttons.

---

## 5. Usage semantics

- **Which calls count:** only real-provider dialogue calls (prompt/Continue), each
  as one optional attempt.
- **Which do not:** fake-provider calls (any), and opening a dialogue (no call at
  all, for either provider).
- **Meter/cap:** the existing single session meter (`usageCountRef`/`guardCap` =
  `llmConfig.sessionCap`). Dialogue shares it with room/objective/gate calls — one
  honest per-session real-spend ceiling. Tradeoff (accepted for v0): heavy dialogue
  use consumes room-generation budget; a separate dialogue cap is a deliberate
  non-goal.
- **Gate flag:** `dialogueGuardEnabled = dialogueProviderSelection.kind === 'real'`.
  When false, `requestDialogueAttempt` returns `true` and never records. When true,
  it evaluates `canAttemptOptional({ count: usageCountRef.current }, { cap: guardCap,
  enabled: true })`; on allow it `recordAttempt`s + `setUsageCount`s and returns
  `true`; otherwise returns `false`.
- **Logging:** on each dialogue attempt `App` logs only a safe
  `{ count, cap, status }` shape (same as existing usage logs). No provider name in
  a way that identifies content, no key, no prompt, no dialogue text.

---

## 6. Architecture — `requestDialogueAttempt` gate

`App` owns the decision (Decision 5). It exposes one stable callback to
`RoomViewer`:

```ts
// App.tsx (inside the component)
const dialogueGuardEnabled = dialogueProviderSelection.kind === 'real'

const requestDialogueAttempt = useCallback((): boolean => {
  // Fake provider: zero-cost, never metered.
  if (!dialogueGuardEnabled) return true
  const config = { cap: guardCap, enabled: true }
  if (!canAttemptOptional({ count: usageCountRef.current }, config)) {
    logger.info('dialogue attempt blocked', {
      count: usageCountRef.current,
      cap: guardCap,
      status: evaluate({ count: usageCountRef.current }, config),
    })
    return false
  }
  const next = recordAttempt({ count: usageCountRef.current })
  usageCountRef.current = next.count
  setUsageCount(next.count)
  logger.info('dialogue attempt', { count: next.count, cap: guardCap })
  return true
}, [/* stable refs + guardCap; dialogueGuardEnabled is module-derived-constant */])
```

`RoomViewer` receives it as an optional prop and:

- **Deletes the open-time auto-call** (`RoomViewer.tsx:230–257`): on open, seed the
  greeting turn only and set the target; no `reply`, no pending.
- **Gates `handleNPCSay`:** before calling `npcDialogueService.reply`, call
  `requestDialogueAttempt?.() ?? true`. If it returns `false`, set the calm message
  via `setNPCDialogueMessage(DIALOGUE_AT_CAP_MESSAGE)`, do **not** set pending, and
  do **not** call the provider. Otherwise proceed exactly as today.

`RoomViewer` never learns whether the provider is real or fake — `App` encapsulates
that in the gate. This keeps `RoomViewer` presentation/intent-only and keeps a
single source of truth for usage state.

**New calm-message constant** in `app/dialogue.ts` (co-located with
`dialogueResultMessage`, keeping message text out of the component):

```ts
export const DIALOGUE_AT_CAP_MESSAGE = 'They have nothing more to say right now.'
```

**Why not gate inside `NPCDialogueService` or a provider decorator (Decision 15):**
both are constructed at module scope with no access to the live meter, and
`BOUNDARIES.md` scopes `NPCDialogueService` as a read-only coordinator; the meter
is a composition/UI concern. Implementation review may revisit only if the prop
seam proves unworkable — not expected.

---

## 7. File-level plan

### Changed

| File | Change |
|---|---|
| `apps/web/src/renderer/RoomViewer.tsx` | Remove the open-time auto-call (seed greeting only); add optional `requestDialogueAttempt?: () => boolean` prop; gate `handleNPCSay`; on block, show the calm message and skip the provider call. |
| `apps/web/src/App.tsx` | Add `dialogueGuardEnabled` + `requestDialogueAttempt` (reusing existing `usageCountRef`/`setUsageCount`/`guardCap` and the pure guard fns); pass it to `<RoomViewer>`. |
| `apps/web/src/app/dialogue.ts` | Add `DIALOGUE_AT_CAP_MESSAGE` constant. |
| `apps/web/src/renderer/RoomViewer.test.ts` | Move "context passed into `reply`" assertions from open-time to first prompt/Continue click; add open-makes-no-call, blocked-gate, and greeting-still-shows cases. |
| `apps/web/src/App.test.tsx` | Add gate behavior (fake no-count, real increments below cap, real blocks at cap) — or cover via the extracted decision if review favors a pure helper. |
| `apps/web/src/app/dialogue.test.ts` | Assert `DIALOGUE_AT_CAP_MESSAGE` is exported/used for the blocked path. |
| `docs/architecture/ARCHITECTURE.md` | Add a short "Dialogue Usage Guardrails v0" status paragraph at closeout (Slice 4). |

### New

| File | Purpose |
|---|---|
| `docs/architecture/implementation-plans/dialogue-usage-guardrails-v0.md` | This plan (Slice 1). |
| `docs/architecture/decisions/ADR-0068-dialogue-usage-guardrails-v0.md` | ADR draft (Slice 1). |

### NOT changed

`dialogue/NPCDialogueService.ts` · `dialogue/FakeNPCDialogueProvider.ts` ·
`generation/OpenAICompatibleNPCDialogueProvider.ts` · `app/selectDialogueProvider.ts` ·
`app/npcDialogueReplyInput.ts` · `domain/ports/NPCDialogueProvider.ts` ·
`domain/dialogue/**` · `domain/usage/usageGuard.ts` (reused as-is) ·
`renderer/ui/NPCDialoguePanel.tsx` · `renderer/ui/UsageMeter.tsx` · `app/llmConfig.ts` ·
`domain/roomSpec.ts` · `domain/world/**` · save-load · persistence · memory ·
`world-session/**` · `interactions/**` · `encounters/**` · `server/**` ·
`eslint.config.js` · `package.json`.

---

## 8. Safety boundaries (unchanged)

- **No `WorldState` mutation (Decision 12).** The gate reads/records only the
  in-memory usage count; the dialogue path remains read-only over
  `WorldSession.getWorldState` (`BOUNDARIES.md`: NPC dialogue is read-only display
  data). No event appended.
- **No memory write (Decision 13).** No `NpcMemoryService`/`RoomMemoryService` or
  store reference is added.
- **No schema/save-load/persistence change (Decision 14).** `RoomSpec`,
  `NPCDialogueSpec`, `SaveGame` `schemaVersion` unchanged; no persistence adapter
  touched. The usage count is App-lifetime only and is not persisted (unchanged
  from ADR-0030).
- **No provider/service change unless proven unavoidable (Decision 15).** The gate
  lives in `App`; `NPCDialogueService` and both providers stay byte-identical.
- **Logging safety (Decision 11).** Only `{ count, cap, status }` counts/enums are
  logged for dialogue attempts. No API key, prompt, seed, provider request/response
  body, or dialogue text — consistent with `AGENTS.md` logging rules and the
  existing usage log lines.
- **Renderer/UI boundary.** `RoomViewer` gains only a plain callback prop and a
  string constant import; it imports no new layer and still routes intent upward.
- **Determinism of the fake path.** `FakeNPCDialogueProvider` is unchanged and
  remains zero-cost; the gate never counts it.

---

## 9. Non-goals

- ❌ A separate dialogue-specific cap or meter (dialogue shares the session meter).
- ❌ Any "continue anyway" / confirm-to-spend bypass for dialogue at cap.
- ❌ Free-text player input or click-to-talk (still fixed prompts + Continue).
- ❌ Changing what a reply says, or any `FakeNPCDialogueProvider` content.
- ❌ Changes to `NPCDialogueService`, `OpenAICompatibleNPCDialogueProvider`,
  `selectDialogueProvider`, `NPCDialoguePanel`, or `usageGuard.ts` internals.
- ❌ Schema, save-load, persistence, memory, world-session, backend changes.
- ❌ The `providerGateStatus`/`providerGate` carry bugfix — tracked on its own
  branch (Decision 16; mechanical-gate provider area, ADR-0064).
- ❌ Metering the open path differently per provider beyond "no call at all."

---

## 10. Implementation slices

**Slice 1 — Docs (this plan + ADR draft).**
`docs: add implementation plan and ADR draft for dialogue usage guardrails v0`
No source code. Status: **in progress.**

---

**Slice 2 — Remove open-time auto-call; greeting-only on open.**
`feat(renderer): show only static greeting on NPC dialogue open (no provider call)`

Modified: `renderer/RoomViewer.tsx`, `renderer/RoomViewer.test.ts`.

Delete the `reply(...)` block in the open branch; seed the greeting turn only; do
not set pending on open. Update `RoomViewer` tests so the "context passed into
`reply`" assertions fire on the first prompt/Continue click, and add:
opening-makes-no-`reply`, greeting-still-shows.

Verification:
```bash
npm run test -- RoomViewer
npm run lint
npm run build
```

---

**Slice 3 — `App`-owned `requestDialogueAttempt` gate + at-cap message.**
`feat(app): meter and cap real NPC dialogue calls via requestDialogueAttempt gate`

Modified: `App.tsx`, `renderer/RoomViewer.tsx`, `app/dialogue.ts`,
`renderer/RoomViewer.test.ts`, `App.test.tsx`, `app/dialogue.test.ts`.

Add `dialogueGuardEnabled` + `requestDialogueAttempt` in `App`; wire the prop into
`RoomViewer`; gate `handleNPCSay`; add `DIALOGUE_AT_CAP_MESSAGE`; show it on block.
Tests per §11.

Verification:
```bash
npm run test -- RoomViewer
npm run test -- dialogue
npm run test -- App
npm run test -- usageGuard
npm run lint
npm run build
```

---

**Slice 4 — Docs closeout + final verification + manual smoke.**
`docs: close dialogue usage guardrails v0`

Modified: this plan (status), ADR-0068 (status → Implemented), `ARCHITECTURE.md`
(status paragraph). Manual smoke (§12) must pass before merge.

Verification:
```bash
npm run test
npm run lint
npm run build
```

---

## 11. Test plan

Maps one-to-one to the maintainer's required cases.

### `renderer/RoomViewer.test.ts`

| Test | Asserts |
|---|---|
| Opening NPC dialogue does not call `reply` | `npcDialogueService.reply` is not invoked when `onRequestOpenInteraction` opens an NPC dialogue |
| Greeting still displays on open | the seeded `dialogue.greeting` turn renders; panel is `NPCDialoguePanel` |
| Prompt button calls `reply` when gate allows | clicking a prompt with `requestDialogueAttempt` → `true` invokes `reply` with the expected room/quest/memory context |
| Continue calls `reply` when gate allows | `onSay(undefined)` (no-prompts case) with gate `true` invokes `reply` |
| Blocked gate does not call `reply` and shows calm message | with `requestDialogueAttempt` → `false`, `reply` is not called and `DIALOGUE_AT_CAP_MESSAGE` renders in the panel `message` slot |
| Context still flows post-change | room/quest/memory context (moved from open to first click) is present in the `reply` input |

### `App.test.tsx` (gate behavior)

| Test | Asserts |
|---|---|
| Fake provider path does not count usage | with fake dialogue selection, `requestDialogueAttempt` returns `true` and `usageCount` stays unchanged |
| Real provider path increments when below cap | with real dialogue selection and count `< cap`, gate returns `true` and `usageCount` increments by 1 |
| Real provider path blocks at cap | with count `>= cap`, gate returns `false` and `usageCount` is unchanged |

### `app/dialogue.test.ts`

| Test | Asserts |
|---|---|
| Calm message constant | `DIALOGUE_AT_CAP_MESSAGE` is a non-empty safe string used for the blocked path |

### Regression

| Test | Asserts |
|---|---|
| generated-npc-dialogue-spec-v0 intact | generated NPCs still open `NPCDialoguePanel` with greeting + two prompt buttons (existing `assembleRoom`/`ensureGeneratedNpcPresence` suites unchanged) |
| No unsafe logging | dialogue-attempt log lines contain only `{ count, cap, status }`; no provider text/API key/raw prompt/dialogue text (assert via captured logger in the gate/RoomViewer tests) |

---

## 12. Manual smoke checklist

1. **Fake provider (default):** press **F** on an NPC → greeting shows, **no**
   network request on open; click prompts / Continue → replies appear; `UsageMeter`
   hidden/inert; count stays 0.
2. **Real provider (BYOK `.env.local`):** open dialogue → greeting shows, **no**
   network request on open (verify Network tab); click a prompt → exactly one
   request, meter increments by 1.
3. **Cap reached:** keep clicking prompts to the cap → the next click shows the
   calm message, fires **no** request, and the count stays at cap; Close/Esc still
   work.
4. Room / objective / gate generation still count against the **same** meter;
   prompt "Generate anyway" still works.
5. Generated NPCs still open `NPCDialoguePanel` (greeting + two prompt buttons);
   authored/demo NPC dialogue unchanged.
6. Dev tools / console show no API key, prompt, provider body, or dialogue text in
   any log line.

This checklist requires driving the running app in a browser and is **pending
maintainer verification** at closeout.

---

## 13. Rollback notes

- Fully reversible in one revert. Changes are additive/local:
  `requestDialogueAttempt` + `dialogueGuardEnabled` in `App.tsx`, one prop plus a
  gated branch and a deleted auto-call block in `RoomViewer.tsx`, one exported
  constant in `app/dialogue.ts`, and their tests.
- Reverting Slice 3 restores uncounted dialogue calls; reverting Slice 2 restores
  the open-time auto-call. Either can be reverted independently (Slice 2 is
  self-contained and could ship first).
- Nothing is persisted: the usage count is App-lifetime only, and no schema,
  save-load, or migration is touched, so no data rollback is required.
- The `providerGateStatus`/`providerGate` carry bugfix is intentionally not part of
  this branch (Decision 16), so a revert here has no interaction with it.

---

## 14. Minimum Safe Change Check

- **Reused:** `domain/usage/usageGuard.ts` (`canAttemptOptional`, `recordAttempt`,
  `evaluate`) unchanged; existing `App` usage state (`usageCountRef`,
  `setUsageCount`, `guardCap`); existing `RoomViewer` prop/callback seam; existing
  `setNPCDialogueMessage` + panel `message` slot for the calm message;
  `dialogueResultMessage` co-location pattern in `app/dialogue.ts`.
- **New code actually necessary:** one `App` callback + one derived boolean; one
  `RoomViewer` prop + gated branch (and deletion of the auto-call); one exported
  string constant; the tests above.
- **Safety boundaries unchanged:** no `WorldState`/memory/schema/save-load/
  persistence change; dialogue stays read-only; providers and service byte-
  identical; logging stays counts/enums-only.
- **Targeted tests prove it:** open-makes-no-call, gate allow/block, fake-no-count,
  real-increments/blocks, and the ADR-0067 regression, all listed in §11.
