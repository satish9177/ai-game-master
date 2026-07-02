# ADR-0068: Dialogue Usage Guardrails v0

- **Status:** Accepted — Implemented (Slices 1–4 complete; manual smoke checklist
  below pending maintainer verification)
- **Date:** 2026-07-02
- **Deciders:** Project owner
- **Extends:**
  [ADR-0030](./ADR-0030-cost-usage-guardrails-v0.md) (the per-session real-attempt
  meter and the pure `usageGuard` API — reused unchanged; this ADR adds dialogue as
  a new metered call class),
  [ADR-0050](./ADR-0050-multi-call-usage-guardrails-v0.md) (`canAttemptOptional`
  multi-call optional budget — extended to dialogue calls sharing the same session
  cap).
- **Related:**
  [ADR-0065](./ADR-0065-real-npc-dialogue-room-memory-awareness-v0.md) (the opt-in
  `OpenAICompatibleNPCDialogueProvider` whose calls this ADR brings under the meter
  — unchanged),
  [ADR-0067](./ADR-0067-generated-npc-dialogue-spec-v0.md) (the greeting-plus-two-
  prompt-buttons `NPCDialoguePanel` contract that must not regress),
  [ADR-0017](./ADR-0017-npc-dialogue-foundation-v0.md) (NPC dialogue is read-only
  display data — this ADR does not change that).

> Full pre-code design in the implementation plan
> [`dialogue-usage-guardrails-v0`](../implementation-plans/dialogue-usage-guardrails-v0.md).

> v0 closes a real-spend gap: with a complete real-provider config, opening an NPC
> dialogue auto-fires a provider reply, and every dialogue reply (open + each
> prompt/Continue click) is uncounted by the session usage meter — so the meter can
> claim the user is under cap while real dialogue spend accrues. This ADR removes
> the open-time provider call (the static greeting alone displays on open) and
> routes the surviving user-triggered dialogue calls through an `App`-owned
> `requestDialogueAttempt` gate backed by the existing `usageGuard` API. Fake calls
> stay zero-cost and uncounted; real calls share the existing session meter/cap; at
> cap the provider is not called and a calm in-panel message shows. No
> `NPCDialogueService`/provider change, no schema/save-load/persistence/memory
> change, no `WorldState` mutation.

---

## Context

`OpenAICompatibleNPCDialogueProvider` (ADR-0065) is opt-in and selected only when
the dev-only/BYOK `LlmConfig` is complete; `FakeNPCDialogueProvider` is the default.
Two things make real dialogue unsafe for spend today:

1. **Auto-call on open.** `RoomViewer`'s `onRequestOpenInteraction` dialogue branch
   (`renderer/RoomViewer.tsx:220–259`) seeds the static greeting turn from
   `dialogue.greeting`, then immediately calls `npcDialogueService.reply(...)` with
   `history: []` / `playerLine: undefined`. For the real provider this is a network
   call/spend fired merely by pressing **F** — before the player has said anything.

2. **Uncounted dialogue calls.** The existing session usage meter lives entirely in
   `App.tsx` (`usageCountRef`, `guardConfig`, `guardCap`) and gates room generation,
   objective generation, and gate generation. Dialogue provider calls happen deep in
   `RoomViewer` (the open auto-call and `handleNPCSay` for prompt buttons /
   "Continue"), which has no access to the usage state. `NPCDialogueService` and its
   provider are constructed at module scope (`App.tsx:121,131`), outside the React
   component, so they cannot read the live meter either. Result: every real dialogue
   `reply` is uncounted, so the meter under-reports and never caps dialogue spend.

The usage guard itself is a pure, reusable domain API — `canAttemptOptional`,
`recordAttempt`, `evaluate` in `domain/usage/usageGuard.ts` — and does not need to
change. `selectRoomGenerator` and `selectDialogueProvider` read the same config and
gate on the same `isRealProviderComplete`, so the room generator is real iff the
dialogue provider is real; the existing `guardEnabled` already tracks this, but this
ADR keys dialogue counting on the dialogue selection specifically for future safety.

---

## Decision

### 1. No provider call on dialogue open; greeting-only

The open-time `reply(...)` block in `RoomViewer.tsx:230–257` is removed. On opening
an NPC dialogue, `RoomViewer` seeds only the static authored/generated greeting turn
(from `dialogue.greeting`) and sets the target. No provider call, no pending state
from opening. The greeting is authored/generated data and always displays without
spend.

### 2. `App`-owned `requestDialogueAttempt` gate

`App` owns usage state and the guardrail decision. It exposes one stable callback to
`RoomViewer`:

```ts
requestDialogueAttempt?: () => boolean
```

Behavior:

- `dialogueGuardEnabled = dialogueProviderSelection.kind === 'real'`.
- **Fake provider** (`!dialogueGuardEnabled`): returns `true`, records nothing.
- **Real provider, below cap:** `canAttemptOptional({ count }, { cap: guardCap,
  enabled: true })` is `true` → `recordAttempt` + `setUsageCount`, returns `true`.
- **Real provider, at cap:** `canAttemptOptional` is `false` → returns `false`;
  nothing is recorded and the provider is not called.

The gate reuses the existing `App` usage refs (`usageCountRef`/`setUsageCount`),
`guardCap` (`= llmConfig.sessionCap`), and the pure `usageGuard` functions. Dialogue
shares the single session meter with room/objective/gate calls — one honest
per-session real-spend ceiling. A separate dialogue cap/meter is a deliberate
non-goal for v0.

### 3. Gated user-triggered calls

`RoomViewer`'s `handleNPCSay` (prompt buttons and the no-prompts "Continue" button)
calls `requestDialogueAttempt?.() ?? true` before `npcDialogueService.reply`:

- On `true`: proceeds exactly as today (prompt/Continue is a deliberate user
  action; "Continue" may call the provider).
- On `false`: sets a calm safe in-panel message via the existing
  `setNPCDialogueMessage` path, does not set pending, and does not call the
  provider. Greeting, prompt buttons, and Close/Esc remain usable. There is no
  "continue anyway" dialogue bypass in v0.

Room/quest/memory dialogue context, previously first sent on open, now flows on the
first prompt/Continue click — same context, later trigger.

### 4. Calm message

A new closed constant in `app/dialogue.ts` (co-located with `dialogueResultMessage`,
keeping message text out of the component):

```ts
export const DIALOGUE_AT_CAP_MESSAGE = 'They have nothing more to say right now.'
```

`RoomViewer` never learns real-vs-fake — `App` encapsulates that in the gate — so
`RoomViewer` stays presentation/intent-only and usage state stays single-sourced in
`App`.

---

## Final behavior

- Opening an NPC dialogue displays only the static greeting; no provider call for
  either provider.
- Prompt button / "Continue" call the provider only on deliberate user action, and
  only when the gate allows.
- Fake-provider dialogue is always allowed and never counts (zero-cost).
- Real-provider dialogue below cap increments the shared session meter by one per
  call; the `UsageMeter` re-renders.
- Real-provider dialogue at cap makes no provider call and shows the calm message;
  the panel stays usable.
- Room / objective / gate generation continue to use the same meter, unchanged.
- generated-npc-dialogue-spec-v0 (ADR-0067) is unaffected: generated NPCs still open
  `NPCDialoguePanel` with a greeting and two prompt buttons.

---

## Safety boundaries

- **No `WorldState` mutation.** The gate only reads/records the in-memory usage
  count; the dialogue path remains read-only over `WorldSession.getWorldState`
  (ADR-0017). No event is appended.
- **No memory write.** No `NpcMemoryService`/`RoomMemoryService` or store reference
  is added.
- **No schema / save-load / persistence change.** `RoomSpec`, `NPCDialogueSpec`,
  `SaveGame` `schemaVersion` all unchanged; no persistence adapter touched. The usage
  count remains App-lifetime only and is not persisted (unchanged from ADR-0030).
- **No `NPCDialogueService` / provider change.** The gate lives in `App`;
  `NPCDialogueService`, `FakeNPCDialogueProvider`, `OpenAICompatibleNPCDialogueProvider`,
  and `selectDialogueProvider` are byte-identical. (Implementation review may revisit
  only if the prop seam proves unworkable — not expected.)
- **Logging.** Dialogue-attempt logs carry only `{ count, cap, status }`
  counts/enums. No API key, prompt, seed, provider request/response body, or dialogue
  text — consistent with `AGENTS.md` logging rules and existing usage log lines.
- **Renderer/UI boundary.** `RoomViewer` gains only a plain callback prop and a
  string-constant import; it imports no new layer and still routes intent upward.
- **Deterministic fake path.** `FakeNPCDialogueProvider` is unchanged, remains
  zero-cost, and is never counted.

---

## Non-goals

- ❌ A separate dialogue-specific cap or meter (dialogue shares the session meter).
- ❌ Any "continue anyway" / confirm-to-spend bypass for dialogue at cap.
- ❌ Free-text player input or click-to-talk (still fixed prompts + Continue).
- ❌ Changing reply content or any `FakeNPCDialogueProvider` content.
- ❌ Changes to `NPCDialogueService`, `OpenAICompatibleNPCDialogueProvider`,
  `selectDialogueProvider`, `NPCDialoguePanel`, `UsageMeter`, or `usageGuard.ts`
  internals.
- ❌ Schema, save-load, persistence, memory, world-session, or backend changes.
- ❌ The `providerGateStatus`/`providerGate` carry bugfix — tracked on its own
  branch (mechanical-gate provider area, ADR-0064).

---

## Consequences

- Real NPC dialogue spend is now visible in and bounded by the same session meter as
  every other real provider call, so the meter no longer under-reports.
- Opening a dialogue is free again — the static greeting carries the "someone is
  here to talk" affordance without a speculative provider call.
- Because dialogue shares the single session budget, heavy dialogue use consumes
  room-generation budget; this is the accepted v0 tradeoff (one honest ceiling over
  two independent counters). A dedicated dialogue budget can be a later slice if
  play data warrants it.
- `App` remains the single owner of usage state and guardrail decisions;
  `RoomViewer` stays presentation/intent-only via a one-callback seam, matching the
  existing composition pattern.

---

## Rollback

- Fully reversible in one revert. Changes are additive/local: `requestDialogueAttempt`
  + `dialogueGuardEnabled` in `App.tsx`, one prop plus a gated branch and a deleted
  auto-call block in `RoomViewer.tsx`, one exported constant in `app/dialogue.ts`,
  and their tests. Reverting restores the prior behavior exactly (open-time auto-call
  returns; dialogue calls become uncounted again).
- Slice 2 (open-time auto-call removal) and Slice 3 (the gate) are independently
  revertible; Slice 2 is self-contained.
- No migration or schema rollback is needed — no `schemaVersion` changed and nothing
  is persisted.

---

## Testing / manual smoke

### Automated (targeted)

- `renderer/RoomViewer.test.ts` — opening dialogue does not call
  `npcDialogueService.reply`; the greeting turn still displays on open; a prompt
  button calls `reply` when the gate allows; "Continue" calls `reply` when the gate
  allows; a blocked gate does not call `reply` and renders `DIALOGUE_AT_CAP_MESSAGE`;
  room/quest/memory context now flows on the first click.
- `App.test.tsx` — fake provider path does not count usage; real provider path
  increments `usageCount` when below cap; real provider path returns blocked and
  leaves `usageCount` unchanged at cap.
- `app/dialogue.test.ts` — `DIALOGUE_AT_CAP_MESSAGE` is a non-empty safe string used
  for the blocked path.
- Regression — generated-npc-dialogue-spec-v0 still opens generated NPCs in
  `NPCDialoguePanel` (existing `assembleRoom`/`ensureGeneratedNpcPresence` suites);
  captured-logger assertions confirm no provider text/API key/raw prompt/dialogue
  text in dialogue-attempt logs.
- Closeout commands run at Slice 4 (from `apps/web`): `npm run test -- RoomViewer
  dialogue App usageGuard` (44 files / 658 tests passed), `npm run lint` (clean),
  `npx tsc --noEmit -p .` (clean). Full `npm run test` and `npm run build` were not
  run this pass (targeted run already covers every touched file); see the
  implementation plan §15 for the full closeout verification table.

### Manual smoke checklist

1. Fake provider: press **F** on an NPC → greeting shows, no network call on open;
   prompt/Continue replies work; meter inert, count 0.
2. Real provider (BYOK): open dialogue → greeting shows, no network request on open;
   click a prompt → exactly one request, meter increments by 1.
3. Cap reached: next click shows the calm message, fires no request, count stays at
   cap; Close/Esc still work.
4. Room / objective / gate generation still count against the same meter;
   "Generate anyway" still works.
5. Generated NPCs still open `NPCDialoguePanel`; authored/demo dialogue unchanged.
6. Console shows no API key, prompt, provider body, or dialogue text.

This checklist requires driving the running app in a browser and is **pending
maintainer verification**.
