# Implementation Plan — `feature/npc-behavior-state-v0`

> Status: **Docs-only design plan. No implementation approved yet.**
> Second feature of the NPC life/movement stack:
> [`npc-idle-animation-v0`](./npc-idle-animation-v0.md) → `npc-behavior-state-v0` →
> [`npc-movement-safety-contract-v0`](./npc-movement-safety-contract-v0.md) →
> [`npc-local-wander-v0`](./npc-local-wander-v0.md).
>
> Companion docs: [ARCHITECTURE](../ARCHITECTURE.md) · [BOUNDARIES](../BOUNDARIES.md) ·
> [CONVENTIONS](../CONVENTIONS.md).
>
> Global stack invariants: presentation-only; no `RoomSpec` position mutation; no
> `WorldState` mutation per tick; no `WorldEvent`s for idle/wander; no save/load of
> NPC runtime state; no provider/LLM calls; no memory writes; no
> quest/gate/objective authority; no dialogue/memory text logging; deterministic
> test paths first.

---

## 1. Problem statement

The NPC stack needs a shared, **closed** notion of "what is this NPC doing right
now" so presentation systems can coordinate: the idle animation (previous feature)
should calm or pause while the player is talking to that NPC, and the wander motor
(two features ahead) needs a state to occupy that never collides with talking.
Today no such concept exists — the engine has only a global boolean interaction
lock (`Engine.locked`, `renderer/engine/Engine.ts:55,181-184`), and `RoomViewer`
knows which NPC's dialogue panel is open but has no seam to tell the engine.
Without a closed contract now, later features would invent ad-hoc booleans that
drift toward gameplay state.

## 2. Goals

- A closed presentation-state vocabulary per NPC: `idle | talking | wandering`.
  Closed union type; no free strings, no extension without a plan/ADR.
- Presentation-only, engine-internal storage; the state exists nowhere outside the
  renderer's runtime memory.
- Dialogue open/close drives `talking` through a **neutral engine seam** at the
  approved React ↔ engine host interface (imperative method, same family as
  `setInteractionLock` / `setRoom`).
- The idle animation reads the behavior state to scale its intensity (closed
  per-state intensity table), so a talking NPC stops bobbing.
- `wandering` is reserved and resolvable now (the tracker knows the state) but has
  no producer until `npc-local-wander-v0`.
- Deterministic pure unit tests for state resolution and precedence.

## 3. Non-goals

- No movement — `wandering` gains a producer only in `npc-local-wander-v0`.
- No AI, schedules, moods, needs, or LLM-driven behavior selection.
- Never `WorldState`, `WorldEvent`s, save blobs, quests, gates, or objectives:
  behavior state is not serialized, not persisted, not consulted by any gameplay
  decision, and carries no authority.
- No UI display of the state (no "talking…" bubbles); no React state mirror.
- No per-NPC dialogue behavior change: dialogue flow, providers, services, usage
  guardrails are untouched.
- No engine → React callback for behavior changes (one-way: composition → engine).
- No new dependency; no schema change; no logging of NPC ids/names (count-only if
  any logging at all — likely none).

## 4. Data/authority boundary

- **Where the state lives:** a private tracker inside the `Engine`
  (renderer layer). It dies with `Engine.dispose()` — which also means every room
  change resets all behavior state, since `RoomViewer` recreates the engine per
  room (`renderer/RoomViewer.tsx:134-342`).
- **Who may write:** the composition layer (`RoomViewer`) may set/clear only the
  externally-driven `talking` slot via the neutral seam; the engine itself owns
  `wandering` (later feature). Nothing else writes.
- **Who may read:** renderer-internal systems only (idle animator now, wander
  motor later). No projection to UI, save, world-session, or logs.
- **Shared vocabulary location:** the closed type lives in `domain/ports/`
  (the documented home for shared React ↔ engine view-model contracts,
  BOUNDARIES.md "approved host interface"), so `RoomViewer` and the engine share
  it without importing each other's internals.
- **Authority:** none. Deleting the tracker at any moment must change nothing but
  presentation smoothness.

## 5. Current repo facts (verified against source)

- `Engine.setInteractionLock(locked)` (`Engine.ts:181-184`) is the existing
  imperative seam `RoomViewer` calls when panels open/close — precedent for a
  sibling `setTalkingNpc` method.
- `RoomViewer.onRequestOpenInteraction` (`RoomViewer.tsx:172-269`) resolves the
  NPC dialogue branch with `target.id` in hand (`npcDialogueLookupRef`); the close
  paths are `closeNPCDialogue` (`RoomViewer.tsx:412-421`) and `resetNPCDialogue`
  (`RoomViewer.tsx:157-165`). All the call sites needed to drive `talking`
  already exist, with the object id available.
- Only **one** NPC dialogue panel can be open at a time (`npcDialogueTarget`
  single state slot) — so the external `talking` input is a single nullable slot,
  not a set.
- `IdleAnimator` (from `npc-idle-animation-v0`) registers entries keyed by node
  with phase/base transforms; adding a per-entry intensity read is a small
  extension of that module.
- Engine tests avoid WebGL and test pure helpers/duck-typed prototype calls
  (`Engine.test.ts:217-264`) — the tracker must be a standalone pure class.

## 6. File-level change plan

**New files:**

- `apps/web/src/domain/ports/npcBehavior.ts` —
  ```ts
  /** Closed, presentation-only NPC behavior vocabulary. Never authoritative. */
  export type NpcBehaviorState = 'idle' | 'talking' | 'wandering'
  ```
  Plus the closed intensity table used by the idle animation:
  `IDLE_INTENSITY_BY_STATE: Readonly<Record<NpcBehaviorState, number>>` =
  `{ idle: 1, talking: 0, wandering: 1 }` (values maintainer-tunable; `talking: 0`
  means the bob pauses cleanly while conversing).
- `apps/web/src/renderer/engine/npc/behaviorTracker.ts` — pure class
  `NpcBehaviorTracker`:
  - `setTalking(objectId: string | null)` — single external slot (open panel sets
    the id, close sets null);
  - `setWandering(objectId: string, wandering: boolean)` — engine-internal
    producer, unused until `npc-local-wander-v0` but specified and tested now;
  - `stateOf(objectId: string): NpcBehaviorState` — precedence
    **talking > wandering > idle** (externally-driven talking always wins);
  - `clear()`.
  No imports beyond the domain port type. No logger, no I/O.
- `apps/web/src/renderer/engine/npc/behaviorTracker.test.ts`.

**Modified files:**

- `apps/web/src/renderer/engine/Engine.ts` —
  - private `behavior = new NpcBehaviorTracker()`;
  - public `setTalkingNpc(objectId: string | null): void` delegating to the
    tracker (the new approved host-interface method — narrow by design: callers
    cannot inject arbitrary states);
  - `dispose()` calls `behavior.clear()`;
  - the idle-animation update passes each registered NPC's
    `IDLE_INTENSITY_BY_STATE[behavior.stateOf(objectId)]` into the animator (see
    next bullet). Requires the animator registration to keep the `objectId`
    (already available from the plan-1 `userData` tagging).
- `apps/web/src/renderer/engine/Engine.test.ts` — may need the duck-typed
  fake-engine fixture extended when `Engine` gains the constructor-initialized
  `behavior` field (the prototype-call fake has no field initializers; update
  only if the touched `setRoom`/registration path now references it).
- `apps/web/src/renderer/engine/animation/idleAnimation.ts` — `IdleAnimator.update`
  gains a per-entry intensity multiplier (default 1): offsets scale by the factor;
  at 0 the node rests exactly at its base transforms (no frozen mid-bob pose —
  returning to base avoids a "levitating pause"). Small, pure change.
- `apps/web/src/renderer/engine/animation/idleAnimation.test.ts` — intensity
  scaling cases.
- `apps/web/src/renderer/RoomViewer.tsx` —
  - NPC-dialogue open branch: `engine.setTalkingNpc(target.id ?? null)` right
    where `setNPCDialogueTarget(dialogueTarget)` is set;
  - `closeNPCDialogue` and `resetNPCDialogue`: `engine.setTalkingNpc(null)`
    (mirrors the existing `setInteractionLock(false)` placement).
  ~4 lines total; no new state, refs, or props.

**Files NOT to touch:** `domain/roomSpec.ts` and all schemas · `world-session/**` ·
`interactions/**` · `encounters/**` · `dialogue/**` (service/providers) ·
`memory/**` · `persistence/**` · `server/**` · `generation/**` · `app/**` ·
`App.tsx` · `renderer/ui/**` (panels unchanged) · save/load modules ·
`eslint.config.js` · `package.json`.

### Minimum Safe Change Check

- **Reused:** existing `setInteractionLock` seam pattern · existing dialogue
  open/close call sites with `target.id` in hand · plan-1 `IdleAnimator` and
  `userData` object tagging · `domain/ports/` as the documented shared-contract
  home.
- **Minimum new code:** one closed type + one closed table, one small pure tracker
  class, one narrow engine method, ~4 lines in `RoomViewer`, intensity multiplier
  in the animator.
- **Safety boundaries unchanged:** state is renderer-runtime-only, never
  serialized/logged/authoritative · dialogue flow and guardrails untouched ·
  no schema/save/provider/memory change · React still talks to the engine only
  through the approved imperative surface.
- **Targeted tests:** tracker precedence/clearing; animator intensity scaling;
  (optional) a `RoomViewer`-level assertion if an existing harness makes it cheap,
  else manual smoke.

## 7. Tests

1. `behaviorTracker.test.ts` —
   - default state is `idle` for unknown ids;
   - `setTalking('a')` → `stateOf('a') === 'talking'`, `stateOf('b') === 'idle'`;
   - `setTalking('b')` replaces the slot (a returns to idle — single panel);
   - `setTalking(null)` clears;
   - `setWandering('a', true)` → `wandering`; with talking also set on `'a'` →
     `talking` wins; clearing talking reveals `wandering` again;
   - `clear()` resets everything.
2. `idleAnimation.test.ts` (extended) —
   - intensity 1 reproduces plan-1 behavior byte-for-byte;
   - intensity 0 leaves the node at exactly `baseY`/`baseRotY` after update;
   - intensity 0.5 halves the bound (offsets ≤ half amplitude).
3. Closed-vocabulary guard: a type-level test (or exhaustive-switch helper) so
   adding a state without updating the intensity table is a compile error
   (`satisfies Record<NpcBehaviorState, number>` achieves this for free).

## 8. Manual smoke (dev, local run)

1. Approach the demo NPC — idle bob visible (plan-1 behavior).
2. Press F to open dialogue — the NPC settles to its base pose (bob pauses) while
   the panel is open.
3. Close the panel (button and Escape both) — bob resumes.
4. Open a **non-NPC** dialogue (inspect a scroll) — the NPC keeps idling
   (talking is per-NPC, not global lock).
5. Navigate rooms, save, load — no behavior-state residue; everything resets to
   idle (engine recreation).
6. Generated room: same open/close pause behavior on the generated NPC.

## 9. Risks

- **Seam creep:** a per-NPC state seam could tempt future gameplay reads.
  Mitigated by the domain-port doc comment ("presentation-only, never
  authoritative") and by keeping the engine method narrow
  (`setTalkingNpc(objectId | null)` — no generic state setter is exposed).
- **Id-less NPCs:** `Interactable.id` is optional; an id-less NPC cannot be
  tracked and simply keeps idling during dialogue (same as v0 idle behavior).
  Accepted; generated NPCs always get ids via `ensureGeneratedNpcDialogue`.
- **Ordering with `resetNPCDialogue`:** open-interaction resets dialogue state
  before branching; the `setTalkingNpc(null)` there must precede the possible
  re-set for the new target (call order specified in §6).

## 10. Slice breakdown

- **Slice 1 — Docs (this file).** `docs: plan NPC behavior state v0`.
- **Slice 2 — Contract + tracker (unwired).** `feat(renderer): closed NPC
  behavior tracker`. New: `domain/ports/npcBehavior.ts`,
  `renderer/engine/npc/behaviorTracker.ts` + test. No behavior change.
- **Slice 3 — Engine seam + idle intensity.** `feat(renderer): talking NPCs pause
  idle animation`. Modified: `Engine.ts`, `idleAnimation.ts` + test, and
  `Engine.test.ts` if the duck-typed fake needs the new `behavior` field.
  Engine-internal only; still no caller of `setTalkingNpc`.
- **Slice 4 — Composition wiring + smoke.** `feat(app): drive NPC talking state
  from dialogue open/close`. Modified: `RoomViewer.tsx`. Run §8; update status.

## 11. Verification commands

```bash
# Slice 1: docs-only — no build/test run required (report as skipped).

# Slice 2
npm.cmd run test -- behaviorTracker

# Slice 3
npm.cmd run test -- behaviorTracker idleAnimation

# Slice 4 — regression
npm.cmd run test -- behaviorTracker idleAnimation Engine App
npm.cmd run lint
npx.cmd tsc --noEmit -p .
```

Run from `apps/web`.

## 12. Decisions needing maintainer approval

1. Seam shape: narrow `setTalkingNpc(objectId | null)` (recommended) vs. generic
   `setNpcBehavior(objectId, state)` (rejected in this plan: would let composition
   inject `wandering`, which must stay engine-owned).
2. `talking` intensity `0` (full pause, settle to base — recommended) vs. a
   reduced-but-nonzero calm bob.
3. Whether the closed type lives in `domain/ports/npcBehavior.ts` (recommended,
   matches the interaction view-model precedent) vs. renderer-internal only
   (rejected: `RoomViewer` needs no type today, but the table/type belong with
   the seam contract).
