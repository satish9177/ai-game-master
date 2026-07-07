# ADR-0084: Hostile NPC chase is a deterministic, home-leashed, same-room movement override — opt-in only, no consumer of gameplay authority

- **Status:** Accepted (design approved, docs-first); implementation pending (Slices 1-4 planned)
- **Date:** 2026-07-07
- **Deciders:** Project owner
- **Builds on:** the existing presentation/runtime-only NPC movement stack and the two
  foundations landed directly ahead of it —
  the deterministic pure movement kernel and `WanderMotor`
  (`apps/web/src/domain/npcMovementContract.ts`,
  `apps/web/src/renderer/engine/npc/WanderMotor.ts`,
  `apps/web/src/renderer/engine/npc/wanderStep.ts`,
  `apps/web/src/renderer/engine/npc/patrolStep.ts`) from
  [`npc-patrol-route-v0`](../implementation-plans/npc-patrol-route-v0.md)
  ([ADR-0080](./ADR-0080-npc-patrol-route-v0.md)), and the advisory same-room proximity
  signal (`apps/web/src/domain/npcPlayerAwareness.ts`,
  `apps/web/src/renderer/engine/npc/awarenessTracker.ts`) from
  [`npc-player-awareness-v0`](../implementation-plans/npc-player-awareness-v0.md)
  ([ADR-0083](./ADR-0083-npc-player-awareness-v0.md)). It is the **first consumer** of the
  awareness signal that ADR-0083 named as deferred, and it reuses the internal opt-in test
  seam pattern (`SetRoomOptions.patrolOptInNpcIds`) established by ADR-0080.

> Full plan — chase model, activation rules, motor/Engine integration, test plan, manual
> smoke plan, and slices — lives in
> [`hostile-npc-chase-lite-v0`](../implementation-plans/hostile-npc-chase-lite-v0.md).
> This ADR records the decision and its boundaries. It is written **docs-first**, ahead of
> implementation.

---

## Context

NPCs now move (idle / wander / patrol — [ADR-0080](./ADR-0080-npc-patrol-route-v0.md)) and
a deterministic, ephemeral, same-room proximity signal
([ADR-0083](./ADR-0083-npc-player-awareness-v0.md)) already reports how close each NPC is to
the player as one of four tiers (`unaware` / `nearby` / `aware` / `alerted`). ADR-0083 shipped
that signal **advisory-only, with no consumer**, and explicitly deferred
`hostile-npc-chase-lite-v0` as the first consumer.

We want that first consumer now: an eligible "hostile" NPC that, when it is `aware` or
`alerted` of the player and in the same room, moves **toward** the player instead of
wandering/patrolling — and resumes normal movement when the player leaves. We want it as a
**movement/intent change only**, with none of the combat/encounter/damage machinery that the
word "hostile" might imply.

Several facts shape the safe design:

1. **No hostility metadata exists.** The `RoomSpec` `Npc` object is `type` / `name` /
   `interaction` / `color` / transform only — there is no hostility, faction, role, or
   disposition field, and schema changes are out of scope. So "eligible hostile NPC" cannot
   be read from room data in v0; it must come from the same **internal, test/fixture-only
   opt-in seam** that ADR-0080 used for patrol (`SetRoomOptions.patrolOptInNpcIds`), never
   wired through `App`/`RoomViewer`.
2. **The movement kernel is already safe and reusable.** `isWanderPositionAllowed` /
   `isWanderSegmentAllowed` clamp to playable bounds, clear object footprints, and leash to
   `NPC_WANDER.MAX_RADIUS_FROM_HOME = 2.5`; steps are capped at `NPC_WANDER.MAX_SPEED * dt`
   and every candidate is re-validated (illegal → hold, never teleport). Reusing these for
   chase gives us "no teleport" and "clean resume" for free.
3. **Resume-compatibility requires the same leash.** If chase let an NPC leave its
   wander-legal area, the wander/patrol reducer would see an out-of-bounds position on
   resume and stall (`!isWanderPositionAllowed → pauseSafely` forever). Leashing chase to the
   **existing** `MAX_RADIUS_FROM_HOME = 2.5` guarantees the NPC is always at a wander-legal
   position when chase deactivates, so wander/patrol resumes cleanly. The cost — chase is
   intentionally short-range/"lite" — is accepted (see Known limitations).
4. **Awareness is already computed per frame.** Chase can read the existing
   `NpcAwarenessTracker.levelOf(npcId)` rather than recompute proximity. Reading the
   **prior** frame's tier (the tracker updates later in `renderLoop`) is a one-frame
   staleness that is deterministic and harmless.

A naive v0 would (a) invent a hostility schema field, (b) give chase its own larger leash and
new legality surface (breaking clean resume), (c) let "contact" trigger damage/an encounter,
or (d) auto-enable chase in real rooms. Each is rejected below.

---

## Decision

Adopt a **deterministic, home-leashed, same-room chase movement override** that is
presentation/runtime-only, opt-in via an internal seam, and has **no gameplay authority**.

- **Eligibility is an internal opt-in seam only.** A new
  `SetRoomOptions.chaseOptInNpcIds?: ReadonlySet<string>` marks the "eligible hostile" NPCs,
  mirroring `patrolOptInNpcIds`. It is **not** `RoomSpec`/schema/save-game data and is
  **never** wired through `App`/`RoomViewer`. **No real room auto-enables chase in v0**; only
  ids explicitly placed in this set (by tests/fixtures) can ever chase.

- **Chase consumes the existing awareness tier.** For an eligible NPC, chase is active on a
  frame **iff** its current `NpcAwarenessTracker` tier is `aware` **or** `alerted`. When the
  tier is `nearby` or `unaware`, chase is inactive and the NPC resumes wander/patrol. The
  tier read is the prior frame's value (accepted, deterministic staleness).

- **Chase is a deterministic pursuit step, reusing the wander kernel.** While active, the NPC
  steps toward the player's current XZ by at most `NPC_WANDER.MAX_SPEED * dt`, only through
  positions/segments that pass the **existing, unchanged** `isWanderPositionAllowed` /
  `isWanderSegmentAllowed`. It uses **no randomness** — pure pursuit of a given target — so
  it is a deterministic function of the NPC position, the player position, and `dt`.

- **Leash reuses `NPC_WANDER.MAX_RADIUS_FROM_HOME = 2.5`.** Chase never leaves the NPC's
  existing wander-legal area, which keeps it in-bounds, obstacle-clear, resume-compatible,
  and short-range by design.

- **Contact standoff `CONTACT_STANDOFF = 0.8` with no consequence.** The NPC stops advancing
  once within `0.8 m` of the player (no jitter/overlap). Reaching the player — "contact" —
  does **nothing**: no damage, HP change, injury, item loss, capture, death, encounter, quest
  effect, event, command, memory, fact, or relationship change. Contact is a position, not an
  outcome.

- **Existing pause gates still apply.** Chase runs inside the same `WanderMotor.update` loop,
  after the existing `shouldPauseWander({ interactionLocked, npcTalking })` early-out, so a
  dialogue/interaction lock or an NPC "talking" pauses an active chase exactly as it pauses
  wander/patrol.

- **Non-opted NPCs remain behaviorally unchanged.** NPCs whose ids are not in
  `chaseOptInNpcIds` take the identical existing wander/patrol/idle path; this is asserted by
  regression tests (a non-eligible entry produces the same output with and without the chase
  context present), not claimed as byte-for-byte-identical source.

- **Hard boundaries preserved.** No combat / damage / HP / injury / item loss / capture /
  death / encounter / quest effect; no `WorldState` mutation; no `WorldEvent` /
  `WorldCommand`; no memory / fact / `fact_visibility` read or write; no persistence / schema /
  save-game / `RoomSpec` change and no `schemaVersion` bump; no LLM / provider / prompt
  change; no `App`/`RoomViewer`/UI change; no cross-room chase (the motor and the player only
  ever see same-room nodes). **Fail safe:** any illegal pursuit candidate → hold position
  that frame; awareness guards (different room / non-finite position) already yield `unaware`,
  which is inactive.

---

## Consequences

- **Safer by construction: no schema/save/authority changes.** v0 adds one pure pursuit
  reducer, an opt-in flag + chase context on `WanderMotor`, and one gated per-frame call in
  `Engine` — all presentation/runtime-only. No authoritative state, `RoomSpec`, persistence,
  migration, or `schemaVersion` bump is introduced.

- **No visible gameplay change in real rooms.** Because no real room populates
  `chaseOptInNpcIds`, players see no difference in v0; the value is a tested movement
  foundation exercised through the internal seam, not a shipped behavior.

- **The awareness signal gains its designed first consumer** with a small, low-risk change,
  exactly as ADR-0083 anticipated: chase only reads an existing tier.

- **Determinism and "no teleport" are inherited, not re-proven from scratch.** Reusing the
  capped, re-validated wander kernel means chase cannot skip through walls/obstacles or jump,
  and identical inputs yield identical motion.

### Known limitations

- **Chase is intentionally short-range / "lite".** Because the leash reuses
  `MAX_RADIUS_FROM_HOME = 2.5` and the `aware` band reaches `3.0 m` from the NPC, an eligible
  NPC can meaningfully close on a player only while the player is within ~2.5 m of the NPC's
  home; a player standing just outside cannot be reached, and the NPC will hold at its leash
  edge until the player re-enters or the tier drops. This is a deliberate safety/`resume`
  trade-off, not a defect. A larger dedicated chase radius (with explicit return-to-home
  handling) is deferred.

- **Distance-only awareness carries over.** Chase inherits ADR-0083's distance-only signal:
  it ignores walls, occluders, and facing, so an eligible NPC can become `aware`/`alerted`
  of a player who is close but behind a wall. Line-of-sight/facing gating is deferred.

- **One-frame awareness staleness.** Chase reads the prior frame's tier. This is accepted and
  deterministic; it is not a correctness issue at frame rate.

### Deferred (each its own maintainer-approved feature/ADR)

- **Real hostility source** (a trusted, closed `RoomSpec`/world metadata that marks NPCs
  hostile, replacing the internal opt-in seam) and any `App`/`RoomViewer` wiring.
- **Longer-range chase** with a dedicated chase leash and explicit return-to-home path.
- **Combat / damage / encounter / capture on contact** — any gameplay outcome of reaching the
  player.
- **Line-of-sight / facing / occlusion** gating of chase activation.
- **Relationship-driven or time-of-day-driven hostility.**
- **Cross-room pursuit** (following the player through exits).
- **Chase tuning surfaces** (per-NPC speed/leash/standoff profiles).

---

## Alternatives considered

- **Add a hostility field to `RoomSpec` / a real hostility source now.** Rejected: schema
  change is out of scope, and it would couple a movement foundation to content/authoring
  design. The internal opt-in seam (ADR-0080 precedent) lets chase land and be tested without
  any schema or gameplay-wiring change.
- **Give chase its own larger leash + new legality predicate.** Rejected for v0: it breaks
  clean resume (an NPC left outside its wander-legal area stalls the wander/patrol reducer)
  and adds a new legality surface. Reusing `MAX_RADIUS_FROM_HOME` and the existing predicates
  is the Minimum Safe Change; longer-range chase is deferred with its own return-to-home work.
- **Let "contact" deal damage / trigger an encounter.** Rejected: that is combat/encounter
  authority and out of scope. v0 is movement/intent only; contact is inert.
- **Recompute proximity inside the chase step.** Rejected: awareness is already computed per
  frame by `NpcAwarenessTracker`; chase reads `levelOf` to avoid a second distance pass and
  a second source of truth for "is the player close".
- **Reorder `renderLoop` so awareness is computed before movement.** Rejected as unnecessary:
  reading the prior frame's tier is deterministic and harmless, and leaving the loop order
  alone keeps the diff smaller and avoids perturbing the advisory awareness timing.
- **Auto-enable chase for some NPCs in real rooms.** Rejected: v0 must not change real-room
  behavior. No real room populates the opt-in set.
- **Put the pursuit step in `domain/` as a pure contract like the detector.** Considered;
  the pursuit reducer sits with its wander/patrol siblings under
  `renderer/engine/npc/` (it mirrors `wanderStep`/`patrolStep`, which already live there and
  own the per-frame stepping), while the reusable geometry/legality it calls stays in the
  pure `domain/npcMovementContract.ts`. This keeps the split consistent with the existing
  movement stack.
- **Plan-only, no ADR.** Rejected: chase-lite is the first behavior to **consume** the
  awareness signal and the first NPC movement that targets the player, so the authority
  boundary (opt-in only, movement-only, inert contact, no cross-room) warrants a decision
  record.

---

## Verification

Not yet implemented. This ADR is docs-first, ahead of code.

Planned files (Slices 1-3; working names may shift, as with ADR-0083):

- `apps/web/src/renderer/engine/npc/chaseStep.ts` (new; pure pursuit reducer + `CONTACT_STANDOFF`).
- `apps/web/src/renderer/engine/npc/chaseStep.test.ts` (new).
- `apps/web/src/renderer/engine/npc/WanderMotor.ts` (extended; opt-in flag + chase context).
- `apps/web/src/renderer/engine/npc/WanderMotor.test.ts` (extended).
- `apps/web/src/renderer/engine/Engine.ts` (extended; `chaseOptInNpcIds` seam + gated chase call).
- `apps/web/src/renderer/engine/Engine.test.ts` (extended).

The full test plan, manual smoke plan, file list, and verification commands live in
[`hostile-npc-chase-lite-v0`](../implementation-plans/hostile-npc-chase-lite-v0.md). At
closeout, this ADR and that plan flip to Implemented and the ARCHITECTURE.md status line moves
from planned to implemented (implemented-only convention), and the following boundaries are
re-confirmed:

- No combat / damage / HP / injury / item loss / capture / death / encounter / quest effect.
- No `WorldState` / `WorldEvent` / `WorldCommand` / `applyEvent` change.
- No persistence / schema / save-game / `RoomSpec` mutation; no `schemaVersion` bump.
- No memory / fact / `fact_visibility` read or write.
- No LLM / provider / prompt change.
- No `App` / `RoomViewer` / UI change; eligibility stays behind the internal `chaseOptInNpcIds` seam.
- No cross-room chase.
- Non-opted NPCs remain behaviorally unchanged, proven by regression tests.
- Chase remains presentation/runtime-only, deterministic, home-leashed, and non-teleporting;
  contact is inert.
