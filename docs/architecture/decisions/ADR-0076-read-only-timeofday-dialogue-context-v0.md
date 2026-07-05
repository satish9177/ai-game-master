# ADR-0076: Read-only `timeOfDay` exposure for NPC dialogue context

> Status: **PROPOSED** (design approved, not implemented).
> Feature: `feature/time-context-and-day-night-presentation-v0`.
> Companion plan:
> [time-context-and-day-night-presentation-v0](../implementation-plans/time-context-and-day-night-presentation-v0.md).
> Builds on `world-clock-v0`
> ([implementation plan](../implementation-plans/world-clock-v0.md)) and the
> authoritative event-log model
> ([ADR-0013](./ADR-0013-world-state-event-log-v0.md)).

---

## Context

- `world-clock-v0` is **complete and closed**. It derives a pure, deterministic
  `WorldClock` (`{ day, hour, timeOfDay }`) as a **read-only projection** over the
  authoritative `WorldEvent` log — counting `moved-to-room` events, starting at
  Day 1 / Hour 8, and bucketing the hour into a closed `timeOfDay` enum
  (`dawn | day | dusk | night`). It holds no `WorldState` field, mints no
  event/command, uses no wall clock, and requires no schema/save change.
- Today, time is **HUD-only**: `App` refreshes a `worldClock` state and
  `StatusHud` renders it presentationally. Nothing in the provider/prompt path
  reads it.
- `world-clock-v0` **explicitly deferred** "dialogue/provider/context injection of
  time" and predicted that it "would likely be its own ADR." This ADR closes that
  specific deferral.
- The repo already has an exact structural precedent for exposing bounded,
  enum-only, non-authoritative context to the NPC dialogue prompt: the NPC
  relationship hint, which flows from the composition root through
  `buildNPCDialogueReplyInput` → `NPCDialogueService` → `buildDialogueContext` →
  `llmDialoguePrompt` and renders as a hedged, bucket-only section.

The question this ADR answers: **how, and how far, may in-fiction time be exposed
to NPC dialogue context — without giving the provider any control over time and
without leaking numeric day/hour into prompts?**

---

## Decision

1. **Expose only the closed `timeOfDay` enum** (`dawn | day | dusk | night`) to
   NPC dialogue prompt context. A pure chokepoint `toPromptTimeContext(clock)`
   (added during implementation) returns `{ timeOfDay }` and is the single place
   that strips `day`/`hour` before anything provider-facing.
2. **`day` and `hour` remain HUD-only** and **never** enter provider/prompt
   payloads. They are not placed on any dialogue-facing type, so leakage is
   prevented structurally, not merely by convention.
3. **Time context is read-only, non-authoritative, and ambient/tone-only.** It is
   rendered as one small, bounded prompt section under an explicit
   "AMBIENT, READ-ONLY, NOT AUTHORITATIVE" header, always included when a valid
   `timeOfDay` is present (v0 does not omit `day`). A single system-prompt line
   reinforces that time of day must never be claimed to pass, change, or be
   instructed.
4. **No schema / save / event / command / state changes.** Time stays a derived
   projection of the already-persisted event log; nothing authoritative is added
   or mutated. `buildDialogueContext` must not import `worldClock` / session / log
   or fetch the clock itself — the derived enum is passed in from the composition
   root.
5. **No renderer lighting, no lazy room/object transitions, no NPC
   routines/schedules.** HUD day/night presentation is DOM/CSS only (a data
   attribute / band class + `index.css`). Room/object time context is
   presentation-only in v0; time is not fed into room/object generation. NPC
   dialogue is the **only** provider-facing time consumer in v0.

---

## Consequences

- **NPCs may refer to `dawn` / `day` / `dusk` / `night` atmospherically** as a
  tone cue in their replies.
- **The provider cannot set, advance, or read back time.** Advancement remains
  travel-only inside `world-clock-v0`; the prompt section is read-only and the
  system prompt forbids claiming or instructing time changes.
- **No numeric time reaches the provider.** Only the four-value enum is exposed;
  `day`/`hour` are structurally excluded from the dialogue data flow.
- **Prompt budget increases by only one bounded section** (a fixed header plus one
  enum line), guarded by the existing prompt-budget evaluation.
- **Determinism and safety are preserved.** The exposed value is a closed enum
  from pure domain (not free text), so it cannot fabricate a section header or
  carry an injected payload; logging remains enum-only.
- **Future work requires separate features/ADRs:** room/object time context or
  ambient inspect text; day/night renderer lighting; NPC routines/schedules;
  configurable start hour via `CanonSeed`; a `rest`/`wait` action. None are
  authorized by this ADR.

---

## Alternatives considered

- **Expose full `{ day, hour, timeOfDay }` to prompts.** Rejected: numeric day/hour
  invite the model to invent precise temporal claims, widen the injection/budget
  surface, and provide no v0 value. Only the coarse band is needed for tone.
- **Omit the section at the `day` baseline** (mirroring the neutral-relationship
  omission). Deferred: v0 always includes the section when valid for determinism
  and testability; the one-line cost is bounded. Omission can be revisited if
  budget pressure appears.
- **Plan-only, no ADR** (matching how the relationship hint shipped). Rejected for
  this feature: `world-clock-v0` explicitly flagged time-in-provider-context as a
  boundary to record, and this is the first world-derived (non-entity) context to
  reach the provider, establishing a new invariant worth an explicit decision
  record.
- **Renderer day/night lighting.** Rejected for v0: it touches the trusted
  Three.js renderer (ADR-0001/ADR-0002), a far larger surface with no context
  value; HUD presentation is DOM/CSS only.
