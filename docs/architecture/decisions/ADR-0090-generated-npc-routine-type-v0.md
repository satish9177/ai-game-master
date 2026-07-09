# ADR-0090: An optional closed `npcType` enum field on the RoomSpec `Npc` schema — data-only NPC metadata, not a schedule or behavior command — lets generated NPCs opt into existing routine presets

- **Status:** **Accepted. Slice 0 only (docs-only implementation plan + this ADR).
  Not yet implemented — no source, test, schema, or prompt code changed.**
- **Date:** 2026-07-09
- **Deciders:** Project owner
- **Delivers:** the deferred **Option B** recorded in
  [`npc-routine-presets-v0`](./ADR-0088-npc-routine-presets-v0.md) (ADR-0088 §"Deferred:
  Option B" and its implementation plan §16) — the approved-in-principle,
  separately-scheduled path to scale routines to generated NPCs via an additive,
  closed, optional RoomSpec field.
- **Extends / builds on:**
  [`npc-day-night-routine-v0`](./ADR-0087-npc-day-night-routine-v0.md) (ADR-0087) — the
  deterministic, same-room, movement-only routine layer and its closed
  `idle | patrol | rest | passive` mode vocabulary; and ADR-0088's closed
  `NpcRoutineNpcType` → `NpcRoutinePreset` → schedule lookup. This ADR reuses both
  verbatim; it adds one data source (a validated NPC field), not a new resolver, mode,
  preset, or authority surface.

> Full plan — schema shape, validation posture, prompt hint, resolver integration,
> priority order, test plan, and slices — lives in
> [`generated-npc-routine-type-v0`](../implementation-plans/generated-npc-routine-type-v0.md).
> This ADR records the decision and its boundaries, written **docs-first**, ahead of
> implementation, per `AGENTS.md`.

---

## Context

`npc-routine-presets-v0` (ADR-0088) shipped a reusable, closed authored id → closed NPC
type → closed routine preset → closed schedule lookup, so authored/demo NPCs can share a
routine by *type*. But its only type source is `NPC_TYPE_BY_ID`, a frozen, **per-NPC-id**
authored map with exactly one entry (`herald-asha -> guard`). A **generated** NPC's id
(`generated-npc`, `generated-npc-2`, …) is not known ahead of time and carries no
semantic meaning, so no authored id map can classify it. Consequently, routines still
only work for authored/demo NPCs.

The validated `Npc` RoomSpec object has **no safe closed role/type/archetype field**
today (`{ type: 'npc', name, interaction, color, id?, position, rotationY, scale }`).
`name`/`persona`/`interaction.body`/dialogue text are generated, content-derived text —
a domain boundary (`AGENTS.md`, `BOUNDARIES.md`) forbids parsing them to drive behavior.
So the only way to give an arbitrary generated NPC a routine without content-derived
classification is to add a **closed, optional, validated enum field** to the schema —
exactly Option B, which ADR-0088 recorded as approved-in-principle but deliberately did
not build, so as not to mix a schema-changing feature with a pure-lookup one.

The maintainer has now granted schema approval for that additive field and scheduled it
as this feature.

---

## Decision

Add one **optional, closed-enum, data-only** field, `npcType`, to the RoomSpec `Npc`
object, and feed a validated `npcType` from present generated-room NPC objects into the
**existing, unchanged** ADR-0088 resolver as a second, safe type source alongside the
authored `NPC_TYPE_BY_ID` map.

- **Field name: `npcType`** (not `routineType`). It describes *what an NPC is* (a
  data-only category), not *what routine it runs*. Naming it `routineType` would leak
  behavior naming into a data schema and read as "the provider chooses a routine,"
  edging toward the permanently-rejected "provider output controlling schedules." It
  reuses ADR-0088's existing `NpcRoutineNpcType` vocabulary and the `NPC_TYPE_BY_ID`
  naming convention.

- **Closed value set (reused from ADR-0088, no new values):**
  `guard | merchant | villager | noble | servant | wanderer | static_npc`.

- **`npcType` is data-only NPC metadata — not a schedule and not a behavior command.**
  It is a category label in the same class as `prop.shape` or `exit.side`: a validated
  closed enum that the *trusted, authored* mapping layer interprets. The provider
  proposes a **category**, never a routine, schedule, mode, or time behavior. This is
  the same trust posture as the provider proposing `prop.shape: 'cone'` that the trusted
  renderer maps to a cone mesh.

- **Validation posture — closed enum only, invalid dropped to `undefined`:** the field
  is declared so that any value outside the closed set — unknown string, wrong case
  (`"GUARD"`), free text, number, object, `null`, or an injection payload — is **dropped
  to `undefined`**, leaving the NPC and the room valid. Missing is `undefined`. Unknown
  object *keys* are already stripped by the schema's default behavior. The intended
  mechanism is a field-level `z.enum(...).optional().catch(undefined)` (confirmed in
  Slice 1), so the "drop invalid → undefined" rule is **self-contained in the schema** —
  no new `assembleRoom` normalizer stage, no repair-pipeline change, and even a hostile
  `npcType` value cannot fail the room or leak through.

- **No `schemaVersion` bump, no save-load/DB migration.** The field is additive and
  optional: rooms without it validate unchanged (absent → `undefined`), and existing
  save blobs / generated-room-cache entries re-validate through the same schema on load.
  If Slice 1 surfaces any real backward-compatibility reason for a version bump or
  migration, that is escalated for separate approval before proceeding — the default
  position is no bump and no migration.

- **Room prompt: a minimal closed-enum category hint only.** The generated-room prompt
  (`llmRoomPrompt.ts`) may add one short line telling the model that an NPC object *may*
  carry an `npcType` chosen from the closed list, so generated NPCs can actually
  populate the field. The prompt **must not** ask for schedules, routines, routine
  modes, time-of-day behavior, or any custom/free-text routine description. Because the
  schema drops anything invalid, the hint is a population aid, not a trust boundary — the
  field would still be safe with no prompt change at all.

- **Runtime maps `npcType` through the existing preset system — no new resolver:**
  `npcType` → existing `NpcRoutineNpcType` → existing `NpcRoutinePreset`
  (`NPC_TYPE_TO_ROUTINE_PRESET`) → existing `NpcRoutineSchedule` (`ROUTINE_PRESETS`,
  built only from ADR-0087's four closed modes) → current mode via `selectRoutineMode`
  on `worldClock.timeOfDay`. The pure `resolveRoutineScheduleForNpc` (ADR-0088) is
  reused unchanged; the only wiring change is where the per-id `npcType` comes from.

- **Resolution priority, pure and total, never throws (extends ADR-0088 §6):**
  1. Explicit `NPC_ROUTINE_CONFIG[npcId]` (ADR-0087) — wins if present. `herald-asha`
     resolves exactly as it does today, even if a room NPC with that id carried a
     different `npcType`.
  2. Otherwise, the authored `NPC_TYPE_BY_ID[npcId]` type (ADR-0088) — **wins over the
     room field**, keeping the authored/fixture path authoritative and stable.
  3. Otherwise, the validated `npcType` from the present generated-room NPC object.
  4. Otherwise, `null` — no routine, existing wander/idle behavior.

- **Generated NPC routines stay behind the default-off `VITE_AIGM_DEMO_ROUTINE` gate.**
  No NPC receives a routine unless the demo gate is on; with the gate off, behavior is
  byte-identical to today. The present-NPC intersection and every other ADR-0087/ADR-0088
  safety property are reused verbatim.

- **Dialogue context is unchanged.** `RoomViewer` already derives the advisory dialogue
  `routine` field from the resolved `npcRoutineModes` map (ADR-0089); once a generated
  NPC resolves a mode through the path above, that advisory context surfaces with **no
  dialogue-layer code change**. The provider/LLM still cannot mutate a routine mode, and
  dialogue does not control routines in either direction.

---

## Consequences

- **Generated NPCs can finally opt into routines** without any hardcoded per-id map and
  without content-derived classification — a validated closed enum on the NPC object is
  the only new signal.
- **herald-asha and every authored NPC are unaffected.** Priority steps 1–2 guarantee
  the explicit config and the authored type map both outrank the room field; this
  feature cannot change any authored NPC's resolved schedule.
- **Real rooms keep zero behavior change by default.** The gate stays off; even with the
  gate on, a generated NPC gets a routine only when the model supplied a *valid* closed
  `npcType` and a time bucket resolves.
- **No new authority, mode, preset, or motor policy.** This feature adds a data field
  and one type-source wiring step; `resolveRoutineScheduleForNpc`, `ROUTINE_PRESETS`,
  `WanderMotor`, `Engine`, and `RoomViewer`'s routine seam are all reused unchanged.
- **Fail-closed everywhere**, matching ADR-0087/ADR-0088: invalid/missing/absent
  `npcType`, unknown id, unmapped preset, disabled gate, or absent time bucket all
  degrade to no-routine — never a thrown error, never an invented default.
- **This is not player memory.** `npcType` is RoomSpec/room-NPC metadata (initial
  descriptive canon), never a memory/fact/`fact_visibility` record and never
  authoritative `WorldState`. It is not stored through any memory or truth path.

---

## Alternatives considered

- **`routineType` as the field name.** Rejected — names the behavior, not the data;
  implies provider control of routines. `npcType` matches ADR-0088's existing vocabulary
  and keeps the field a neutral category label.
- **Trust provider `npcType` output directly / add a dedicated `assembleRoom`
  normalizer.** Rejected as unnecessary — the field-level closed-enum-with-`catch`
  validation drops invalid values inside the schema itself, so no extra normalizer stage
  or provider-trust code is needed. The provider proposal is re-validated against the
  closed enum exactly like every other generated-content field.
- **Let the provider emit a schedule / routine text (Option E).** Rejected permanently,
  per ADR-0088 §17 — runtime provider control of a movement-authority decision,
  content-derived, non-deterministic, and unloggable. No line of this feature reads a
  schedule, mode, or time field off a room NPC.
- **Infer `npcType` from NPC name/persona/dialogue/room text.** Rejected — forbidden
  content-derived behavior. The field is set by the provider as validated data or by an
  authored map; it is never derived from any text.
- **Bump `schemaVersion` / add a migration defensively.** Rejected as default —
  additive optional fields are backward compatible; a bump/migration would be added only
  if Slice 1 surfaces a concrete compatibility break, under separate approval.

---

## Boundaries (hard, re-confirmed for this feature)

- Not player memory; no memory/fact/`fact_visibility` write or read of `npcType`.
- No content-derived classification from NPC name, persona, dialogue, room text, prompt
  text, generated text, provider output, relationship state, or journal state.
- No relationship-driven routines.
- No LLM/provider control of schedules; no LLM-generated schedules; no free-text routine
  names; the prompt hint asks for a **category only**.
- No combat/damage/HP/death/capture/injury/encounters/items/quests.
- No `WorldEvent`, no `WorldCommand`, no `WorldState` mutation.
- No timers / background simulation.
- No raw prompt/provider/dialogue/room-text/generated-text logging; any diagnostic is
  safe-value-only (boolean/enum/count).
- No save-game/database migration unless Slice 1 finds a real, documented reason
  (default: none), and no `schemaVersion` bump.
- `VITE_AIGM_DEMO_ROUTINE` default-off behavior preserved; full suite stays green.

---

## Verification

To be recorded at Slice 5 closeout, after implementation. Planned targeted coverage:
`roomSpec` schema tests (valid accepted; invalid/free-text/wrong-type/`null` dropped to
`undefined`; absent OK), `llmRoomPrompt` tests (category-only hint; no
schedule/routine/mode/time text), `npcRoutine` domain/app tests (generated `npcType`
resolves a mode; explicit `NPC_ROUTINE_CONFIG` wins; authored `NPC_TYPE_BY_ID` wins over
the room field; missing/invalid → no routine), `App` tests (room-derived type map from
validated present NPCs), redteam/safety tests (no text parsing, invalid dropped, no
schedule injection, no provider control of mode, no memory/world/event/command write, no
raw logging, gate-off preserved), plus `npm run lint`, `npm run build`, and the full
suite. Until then this ADR is **Slice 0 only**; ADR-0088's deferred Option B note stays
as-is and is flipped to "delivered" only at this feature's Slice 5 closeout.
