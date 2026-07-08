# ADR-0089: NPC dialogue may read the already-resolved routine mode as closed, read-only, advisory context — no second resolver, no routine mutation

- **Status:** **Accepted. Planned — Slice 0 (this ADR + implementation plan) only. No
  code written yet.**
- **Date:** 2026-07-09
- **Deciders:** Project owner
- **Extends:** [`npc-day-night-routine-v0`](./ADR-0087-npc-day-night-routine-v0.md)
  (ADR-0087) and [`npc-routine-presets-v0`](./ADR-0088-npc-routine-presets-v0.md)
  (ADR-0088) — the deterministic, same-room, movement-only routine layer and its closed
  `idle | patrol | rest | passive` mode vocabulary. This ADR does not change either
  ADR's model, resolution priority, gate, or safety boundaries; it adds a read-only
  consumer of the already-resolved mode on the dialogue side.
- **Related:** the `time`/`relationship`/`memory` optional-advisory-context precedent on
  `NPCDialogueContext` (`time-context-and-day-night-presentation-v0`,
  `npc-relationship-state-v0` Slice 3, `memory-room-recall-context-v0` Slice F).

> Full plan — closed vocabulary, resolution/threading path, provider behavior, test
> plan, and slices — lives in
> [`npc-routine-dialogue-context-v0`](../implementation-plans/npc-routine-dialogue-context-v0.md).
> This ADR records the decision and its boundaries, written **docs-first**, ahead of
> implementation, per `AGENTS.md`.

---

## Context

`npc-day-night-routine-v0` (ADR-0087) and `npc-routine-presets-v0` (ADR-0088) shipped a
deterministic, closed, movement-only routine layer: each present NPC id resolves to a
closed mode (`idle | patrol | rest | passive`) for the current `TimeOfDay` bucket, and
that mode drives the renderer's `WanderMotor` policy. The resolved-mode map
(`app/npcRoutine.ts`'s `selectNpcRoutineModes`) already reaches `App.tsx`, which already
forwards it — and the current `TimeOfDay` bucket — to `RoomViewer`.

NPC dialogue, however, has no visibility into this state. `NPCDialogueContext`
(`domain/dialogue/contracts.ts`) already carries several optional, closed, advisory
fields projected from authoritative-adjacent state — `time` (ambient time-of-day hint),
`relationship` (bucketed familiarity hint), `memory` (bounded room-memory recall) — but
carries nothing about the NPC's own current activity. If a player asks an NPC "are you
resting right now?", the NPC has no way to know, even though the game engine itself
already knows the answer for movement purposes.

This is a narrow gap: the routine state already exists, is already deterministic and
closed, and is already threaded as far as `RoomViewer`. The only missing piece is
routing the *already-resolved* value one step further, into the same optional-context
pattern the codebase already uses for `time`/`relationship`/`memory`.

Two shapes were considered:

- **A. Read-only advisory context field, sourced from the existing resolved-mode map.**
  No second resolver; the dialogue side never independently decides a routine mode. Adds
  one closed contract field plus threading through the existing dialogue-context spine.
- **B. A dialogue-side routine query/service** that independently re-resolves a mode
  (e.g., by calling `resolveRoutineScheduleForNpc` again from within `dialogue/**`).
  Rejected: this would create two code paths that must agree on the same answer, risking
  drift between what the NPC *does* and what the NPC *says* it's doing, and it would
  require `dialogue/**` (or a new sibling layer) to import routine-resolution logic it
  has no current reason to own — against the Minimum Safe Change Rule's preference for
  reusing an already-computed value over re-deriving it.

Option A was chosen. It also determines provider behavior: the deterministic fake
provider does not parse player free text anywhere in the codebase today (its tiers route
by structural `promptId`/exact-match keys, never by semantic text analysis), so it gets
ambient surfacing only — a fixed line correlated with the closed `mode` value, not a
targeted answer to a detected question. The real provider, which already does
open-ended reasoning over an assembled prompt, gets a small hedged section (mirroring
the existing `time`/`relationship` sections) so it can answer a genuine "what are you
doing right now?" question in-character.

---

## Decision

Add a **closed, read-only, advisory `routine` field** to `NPCDialogueContext`, sourced
directly from the movement layer's already-resolved mode — never a second resolution.

- **Closed vocabulary (new):**
  - `NPCRoutineActivity = 'standing by' | 'patrolling' | 'resting' | 'keeping a quiet
    watch'` — one label per existing `NpcRoutineMode` value, fixed 1:1 mapping.
  - `RoutineDialogueContext = { mode: NpcRoutineMode; activity: NPCRoutineActivity;
    timeOfDay: TimeOfDay }` — reuses ADR-0087's `NpcRoutineMode` and the existing
    `TimeOfDay` union verbatim; no fifth mode, no new time bucket.
- **Single source of truth, no second resolver.** The `mode` value is read from the
  existing `npcRoutineModes` map (`app/npcRoutine.ts`'s `selectNpcRoutineModes` output),
  the same map that already drives `Engine.setRoom`'s `SetRoomOptions.npcRoutineModes`
  for movement. `domain/dialogue/buildRoutineDialogueContext.ts` (new, Slice 1) is a
  pure function of `{ mode, timeOfDay }` only — it does not call
  `resolveRoutineScheduleForNpc`, does not read `NPC_ROUTINE_CONFIG`/
  `NPC_TYPE_BY_ID`/`ROUTINE_PRESETS`, and does not import anything from
  `app/npcRoutine.ts`.
- **Present only when a valid mode and time bucket both resolve for the active NPC** —
  matching the existing gate/absence behavior of `npcRoutineModes` itself (empty map
  when `VITE_AIGM_DEMO_ROUTINE` is off or `timeOfDay` is unavailable). Absent, not a
  null placeholder, mirroring how `persona`/`room`/`quest`/`memory` are already
  conditionally spread onto `NPCDialogueContext`.
- **No schedule details.** Only the *current* resolved mode/activity/time-bucket is
  exposed — never the full four-bucket schedule, never adjacent-bucket previews, never
  the preset or NPC-type identifiers from ADR-0088.
- **Fake provider: ambient surfacing only, no semantic parsing.** One new lowest-
  priority-but-one fallback tier in `FakeNPCDialogueProvider`, keyed only by the closed
  `mode` value, placed below every existing content-aware tier. It never inspects
  `playerLine`/`promptId` text to detect an activity-related question — that would be
  the first instance of semantic free-text parsing anywhere in the fake provider, and is
  explicitly rejected for v0.
- **Real provider: one small hedged closed section.** `llmDialoguePrompt.ts` gains
  `buildRoutineSection`, mirroring `buildTimeSection`/`buildRelationshipSection`:
  renders only `activity`/`timeOfDay` labels, omitted when absent, with a hedge stating
  the section is ambient scene context only — never an instruction, never a claim the
  world or the NPC's routine changed.
- **Strictly one-directional and read-only.** `NPCDialogueService` gains no append
  capability (`Pick<WorldSession, 'getWorldState'>` is unchanged); no code path lets a
  provider response, `playerLine`, or `promptId` write back into `npcRoutineModes`,
  `WorldState`, or any routine config map. Dialogue construction gains no path into
  `WanderMotor`/chase/patrol, and routine resolution gains no path into dialogue
  availability — ADR-0087's "movement-only, never dialogue-blocking" property now holds
  in both directions, proven by a new redteam assertion.

---

## Consequences

- **NPCs can now describe their current activity in dialogue** (via the real provider in
  v0; the fake provider gets only ambient, non-targeted surfacing) without any new
  authority, mutation path, or second source of truth.
- **Movement behavior is completely unaffected.** This feature adds no code to
  `app/npcRoutine.ts`, `domain/npcRoutine*.ts`, `Engine.ts`, or `WanderMotor.ts` — it
  only reads a value those modules already produce.
- **`herald-asha` and any future routine-configured NPC** automatically gain dialogue-
  visible activity context with no per-NPC opt-in beyond already having a resolved
  routine mode — the same gate (`VITE_AIGM_DEMO_ROUTINE`) and present-NPC intersection
  that already govern movement now also govern dialogue-context presence, for free.
- **Real rooms keep zero behavior change by default.** With the gate off (the shipped
  default), `npcRoutineModes` is empty, so `routine` never appears on any
  `NPCDialogueContext`, and both providers behave byte-identically to before this
  feature.
- **No new schema, persistence, event, or memory surface.** This is a pure, in-memory,
  read-only projection layered onto the existing dialogue-context spine.
- **The fake provider's "no semantic parsing" boundary is now explicitly documented and
  tested**, not just an implicit property — a useful precedent for any future dialogue-
  context addition.
- **Deferred:** a prompt-button/UI affordance for asking about activity explicitly
  (v0 relies on existing free-text input or the real provider's own reasoning); any
  dialogue-driven modification of routine mode (permanently out of scope, not deferred —
  see Rejected Alternatives); exposing schedule/preset/NPC-type identifiers in dialogue
  context.

---

## Alternatives considered

- **Option B (dialogue-side independent re-resolution).** Rejected — see Context. Two
  resolvers for the same fact risk drift and violate the Minimum Safe Change Rule's
  preference for reusing an already-computed value.
- **Skip the fake-provider tier; only wire the real provider.** Considered and rejected
  as unnecessarily inconsistent — the fake provider already has an established pattern
  of low-priority ambient tiers correlated with closed context fields (room-focus,
  memory-awareness); adding a routine tier of the same shape is a small, safe, on-
  pattern addition, and its absence would make fake-mode dialogue silently ignore
  context every other closed field already surfaces in some form.
- **Semantic question-detection in the fake provider** (e.g., matching `playerLine`
  against "resting"/"patrol"/"doing" substrings to target a routine answer). Rejected —
  this would be the first free-text semantic parsing in the fake provider anywhere in
  the codebase, is exactly the kind of content-derived behavior `AGENTS.md`'s generation-
  safety rules guard against for player-authored text, and is unnecessary because the
  real provider already does this reasoning safely via its existing prompt/response
  boundary.
- **Expose the full routine schedule (all four buckets) instead of just the current
  mode.** Rejected — larger surface than needed for "what are you doing right now",
  and it would let a provider imply future/past NPC behavior ("I'll be resting at
  night") that the maintainer explicitly scoped out (§0 decision #2 in the
  implementation plan: "no schedule details").
- **Let dialogue (player line or provider response) change routine mode**, e.g. "please
  go on patrol" actually moving the NPC. Rejected outright — this would make dialogue an
  authority surface over movement, directly contradicting ADR-0087's model and this
  project's LLM/generation-safety boundaries (no provider control of movement/
  gameplay-affecting state).

---

## Verification

Not yet applicable — **Slice 0 status only.** This ADR and its implementation plan are
the entire Slice 0 deliverable; no `.ts`/`.tsx` source or test file has been created or
modified. Verification commands and the full test plan are recorded in the
implementation plan §12/§15, to be executed and reported at each subsequent slice, with
final results recorded here at Slice 5 closeout (mirroring ADR-0087/ADR-0088's closeout
pattern).
