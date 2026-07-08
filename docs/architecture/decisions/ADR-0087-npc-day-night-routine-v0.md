# ADR-0087: NPC day/night routine is a deterministic, same-room, movement-only policy layer over trusted authored config — opt-in only, no consumer of gameplay authority

- **Status:** Accepted (design) — **Slice 0 only: docs written, no code yet.**
- **Date:** 2026-07-08
- **Deciders:** Project owner
- **Builds on:** the deterministic event-log-derived world clock
  (`apps/web/src/domain/world/worldClock.ts`, `time-context-and-day-night-presentation-v0`,
  [ADR-0076](./ADR-0076-read-only-timeofday-dialogue-context-v0.md)), the presentation-only
  NPC movement stack and explicit `policy` discriminant established by
  [`npc-patrol-route-v0`](../implementation-plans/npc-patrol-route-v0.md)
  ([ADR-0080](./ADR-0080-npc-patrol-route-v0.md)), the advisory same-room proximity signal
  from [`npc-player-awareness-v0`](../implementation-plans/npc-player-awareness-v0.md)
  ([ADR-0083](./ADR-0083-npc-player-awareness-v0.md)), the movement-only pursuit override
  from [`hostile-npc-chase-lite-v0`](../implementation-plans/hostile-npc-chase-lite-v0.md)
  ([ADR-0084](./ADR-0084-hostile-npc-chase-lite-v0.md)), and the id-only, env-gated,
  closed-allowlist opt-in pattern from
  [`hostile-npc-chase-demo-opt-in-v0`](../implementation-plans/hostile-npc-chase-demo-opt-in-v0.md)
  ([ADR-0086](./ADR-0086-hostile-npc-chase-demo-opt-in-v0.md)).

> Full plan — routine model, config shape, motor/Engine integration, priority rules, test
> plan, and slices — lives in
> [`npc-day-night-routine-v0`](../implementation-plans/npc-day-night-routine-v0.md).
> This ADR records the decision and its boundaries. It is written **docs-first**, ahead of
> implementation, matching the `npc-patrol-route-v0` / `hostile-npc-chase-lite-v0` pattern
> of landing an approved, reviewed design before any code.

---

## Context

NPCs today move via three composed, presentation-only policies: idle/wander (baseline),
an opt-in generated deterministic patrol route (ADR-0080), and an opt-in home-leashed
chase pursuit driven by an advisory same-room awareness signal (ADR-0083/ADR-0084). None
of these vary by time of day, even though a deterministic time-of-day signal already
exists and already reaches the browser composition layer: `computeWorldClock` projects
the append-only `WorldEvent` log into a `TimeOfDay` bucket (`dawn | day | dusk | night`),
advancing only on `moved-to-room` events (never a wall clock), and `App.tsx` already
forwards `toPromptTimeContext(worldClock)` to `RoomViewer` for the NPC dialogue prompt
path.

A day/night routine is the natural next foundation: an NPC that patrols by day and rests
by night reads as alive without needing simulation, scheduling, or LLM control. The two
risks a naive version would introduce are the same ones ADR-0080 and ADR-0086 already
solved once each, and this feature reuses both solutions rather than re-deciding them:

1. **Where does routine metadata come from?** Deriving a schedule from NPC name, role,
   prompt text, generated room text, provider output, dialogue, relationship, or journal
   state would smuggle content-derived behavior into a movement-authority decision, and
   would be non-deterministic/unauditable. The honest, minimal, safe source is a
   **trusted static authored config, keyed by explicit NPC id** — the same shape as
   `DEMO_CHASE_NPC_IDS`, just carrying a schedule value instead of pure membership.
2. **How do we avoid every NPC suddenly having a routine?** `registerWanderNpcs`
   registers every `type: 'npc'` object for movement today. A routine feature must not
   silently reinterpret that population; it must activate **only** for ids that are both
   explicitly configured and present, behind a default-off gate — the same shape ADR-0086
   already established for chase.

Because the config map is itself a closed allowlist, and the gate defaults off, this
feature can be designed to introduce **zero behavior change** for every NPC in every real
room until a maintainer explicitly authors an entry and turns the gate on.

---

## Decision

Adopt a **deterministic, same-room, movement-only NPC routine layer**, selected from a
trusted static authored config and composing with — never replacing or weakening — the
existing wander/patrol/chase/pause stack.

- **Closed routine modes:** `idle | patrol | rest | passive`. No fifth mode without a
  separate approval.
  - `patrol` maps to the existing generated deterministic patrol policy (ADR-0080),
    unchanged, fail-closed to wander if no valid route builds.
  - `passive` maps to the existing gentle wander policy. It is **movement/presentation-
    only**: it must not block dialogue, imply unavailability, trigger hostility, or
    change any gameplay consequence.
  - `idle` and `rest` both map to a new **stationary hold** motor policy in v0. They are
    behaviorally identical in this version; a distinct `rest` presentation (e.g. a
    sleep/lie-down state) is explicitly deferred, not designed here.
- **Routine metadata source: trusted static authored config, keyed by explicit NPC id,
  only.** A frozen `Record<npcId, Partial<Record<TimeOfDay, NpcRoutineMode>>>` living in
  the domain layer. This map **is** the allowlist — no id outside it can ever receive a
  routine, and no id's schedule is inferred, generated, or expanded at runtime from NPC
  name/type/prompt/room text/provider output/dialogue/relationship/journal state.
- **Default-off env gate:** `VITE_AIGM_DEMO_ROUTINE`, mirroring
  `VITE_AIGM_DEMO_CHASE`/`llmConfig.ts`. With the gate unset/off (the production default),
  behavior is byte-identical to today for every NPC.
- **Deterministic selection, resolved once per room entry.** Because the world clock
  advances only via `moved-to-room` (which remounts the engine through a fresh room
  load), the resolved `TimeOfDay` is stable for the lifetime of one engine mount. Routine
  mode is resolved once at registration from `NPC_ROUTINE_CONFIG[npcId][timeOfDay]` —
  no per-frame re-evaluation, no timer, no `setInterval`/`setTimeout`.
- **Movement priority is unchanged in structure — routine only supplies the base
  policy that composes underneath the two existing pre-emption layers:**
  1. Dialogue/interaction lock (`shouldPauseWander`) — unchanged, pauses every policy
     including the new stationary hold.
  2. Chase override (ADR-0084) — unchanged; activates only when `chaseEligible &&
     isChaseActive` (driven by unchanged awareness `aware`/`alerted`); still pre-empts
     whatever base policy — wander, patrol, or now a routine-selected policy — is active.
  3. Routine-selected base policy (this feature): `patrol` / `wander` (`passive`) /
     stationary hold (`idle`/`rest`).
  4. Existing wander fallback when no routine applies.
  5. Missing/invalid time bucket, missing config, missing NPC id, invalid mode, or the
     gate off — all degrade to (4), never to an error or a stall.
- **No blanket activation.** Real rooms keep every NPC on the existing wander/patrol/idle
  path unless the NPC id is a config key **and** present in the room **and** the demo
  gate is on. Routine composes independently with the pre-existing `patrolOptInNpcIds`/
  `chaseOptInNpcIds` fixture/test seams — an NPC may be both routine- and chase-eligible,
  with chase still winning per the priority order above.
- **Same-room, presentation/runtime-only.** No cross-room movement, no background
  simulation loop. Routine writes no authoritative state: no `WorldState`/`WorldEvent`/
  `WorldCommand`, no persistence/schema/save-game change, no `schemaVersion` bump, no
  memory/fact/`fact_visibility` write.
- **No LLM/provider control.** Routine selection is a pure lookup over authored data and
  the existing deterministic clock projection; no provider/prompt/LLM call is added or
  changed anywhere in this feature.

---

## Consequences

- **Zero behavior change by default.** The env gate defaults off and the config map is
  empty of any NPC until explicitly authored, so shipping this feature changes nothing
  for real gameplay until a maintainer opts a specific id in — the same safety property
  ADR-0086 established for chase.
- **Composes cleanly with existing safety-critical behavior.** Dialogue/interaction pause,
  chase override, and awareness detection are all reused **unmodified**; their existing
  test suites are re-run as regression proof, not touched or relaxed.
- **One new motor policy value, not a new authority surface.** The stationary-hold
  addition to `WanderMotor` is presentation-only, following the same `syncXZ`/pause
  pattern as wander and patrol; it introduces no new pre-emption path around chase or
  dialogue locking.
- **`rest` and `idle` are intentionally identical in v0.** This avoids inventing new
  presentation (sleep pose, etc.) ahead of approval; a future slice can differentiate them
  without touching this feature's authority/priority model.
- **`passive` cannot regress dialogue or gameplay.** It is defined, in this ADR, as
  strictly equivalent to the existing gentle wander policy — no new semantics are attached
  to the name.
- **Fail-closed everywhere.** Every missing/invalid input (config, NPC id, mode, time
  bucket, unbuildable patrol route, disabled gate) degrades to existing behavior, never to
  a stall or a surfaced error.

### Deferred (each its own maintainer-approved feature/ADR)

- Distinct `rest` presentation (sleep/lie-down state, different from `idle`).
- Authored routine metadata beyond the closed four-mode vocabulary (e.g. per-NPC custom
  behaviors, activity animations).
- Real gameplay (non-demo/dev) activation of routine — this stays a fixture/opt-in-gated
  demo path in v0, mirroring ADR-0086's chase precedent.
- Relationship-driven or dialogue-driven routine changes.
- Cross-room routine/scheduling, background simulation, or any timer-driven behavior.
- A visual/debug indicator for the active routine mode (optional Slice 4; likely skipped
  unless the maintainer separately approves it, mirroring ADR-0086 Slice 3's outcome).

---

## Alternatives considered

- **Derive routine from NPC name/role/prompt/generated text.** Rejected: non-deterministic
  in practice (depends on content that can change), unauditable, and exactly the kind of
  content-derived behavior the memory/generation boundaries in `AGENTS.md`/`BOUNDARIES.md`
  guard against. The authored, id-keyed config is the honest minimal-safe source.
- **Auto-assign a routine to every NPC with a `home` position.** Rejected: same "villagers
  become guards" risk ADR-0080 rejected for patrol; an id-keyed allowlist avoids it by
  construction.
- **Give routine its own chase-like override / priority mechanism.** Rejected: routine is
  a base-policy selector only; reusing the existing chase pre-emption unmodified avoids a
  second, parallel pre-emption path that could drift out of sync with awareness/chase
  safety guarantees.
- **Distinguish `rest` from `idle` now with a new sleep presentation.** Rejected for v0:
  future-proofing without current approval; both map to the same stationary hold until a
  separate slice is approved.
- **Make `passive` gate dialogue availability (e.g., "the NPC is resting, can't talk").**
  Rejected: explicitly out of scope per the maintainer's decision (§0 of the
  implementation plan) — movement/presentation-only, no gameplay consequence.
- **Read time-of-day per frame instead of once at room entry.** Rejected: unnecessary —
  the clock only changes on room move (which already remounts the engine), so resolving
  once at registration is both simpler and avoids any per-frame branching cost or drift
  risk.
- **Ship code directly without a docs-first ADR.** Rejected: this establishes a new
  movement-priority composition point (routine sitting between chase and wander/patrol)
  and a new metadata-source boundary (authored-config-only), both of which warrant a
  decision record before implementation, per `AGENTS.md`.

---

## Verification

**Not yet run — Slice 0 is docs-only.** This section will be completed at Slice 6
closeout with the same shape as ADR-0080/ADR-0086: files changed per slice, verification
commands actually executed, and results (test counts, `tsc`/`eslint` status), plus a
re-confirmed safety boundary checklist. Until then:

- No `.ts`/`.tsx` source or test file has been created or modified by this ADR or its
  companion implementation plan.
- `docs/architecture/ARCHITECTURE.md` gained one planned-status line pointing at this ADR
  and the implementation plan; it will be replaced by an implemented-status line at
  closeout.
