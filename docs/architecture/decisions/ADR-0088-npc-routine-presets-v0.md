# ADR-0088: NPC routine presets are a closed authored-id → closed-type → closed-preset lookup layer — no schema change, no generated-NPC classification, in V0

- **Status:** **Accepted. Implemented — Slices 0–3 shipped; Slice 4 (docs closeout)
  complete.**
- **Date:** 2026-07-08
- **Deciders:** Project owner
- **Extends:** [`npc-day-night-routine-v0`](./ADR-0087-npc-day-night-routine-v0.md)
  (ADR-0087) — the deterministic, same-room, movement-only routine layer and its
  closed `idle | patrol | rest | passive` mode vocabulary. This ADR adds a reusable
  preset layer on top; it does not change ADR-0087's model, priority rules, or safety
  boundaries.

> Full plan — preset/type vocabulary, resolver priority, integration point, test plan,
> and slices — lives in
> [`npc-routine-presets-v0`](../implementation-plans/npc-routine-presets-v0.md).
> This ADR records the decision and its boundaries, written **docs-first**, ahead of
> implementation, per `AGENTS.md`.

---

## Context

`npc-day-night-routine-v0` (ADR-0087) shipped a working routine layer, but its only
metadata source is `NPC_ROUTINE_CONFIG` — a static, frozen, **per-NPC-id** schedule map
with exactly one entry, `herald-asha`. Every additional NPC that wants a routine needs
its own hand-authored four-bucket schedule, even when many NPCs would naturally share
the same *kind* of behavior (e.g., several guards should all patrol by day and rest by
night).

We want routines to scale beyond one-off per-id schedules — ideally to generated NPCs
too, since generated NPC ids are not known ahead of time and hardcoding every one is
not viable. Before writing code, five approaches were compared:

- **A. Authored id → closed NPC type → closed routine preset.** No schema change; only
  works for NPCs a maintainer explicitly maps by id.
- **B. Optional closed enum field on the RoomSpec `Npc` schema** (e.g. `npcType`),
  populated by trusted generated assembly. The only approach that can classify
  arbitrary generated NPCs — but it is an additive RoomSpec/schema change.
- **C. Ephemeral generated-pipeline enrichment without a public schema field.**
  Investigated and found to collapse either into a content-blind blanket default (no
  real per-NPC classification) or into secretly needing B's signal anyway.
- **D. Infer routine from NPC asset/object subtype** (e.g. a `guard` RoomObject type).
  No such subtype exists today; adding one is a schema change at least as large as B.
- **E. Let the LLM/provider generate routine text or a schedule at runtime.** Rejected
  outright — runtime provider control of a movement-authority decision, content-derived
  and non-deterministic by construction, and unloggable per the existing redaction
  rules.

Only A requires no schema change and ships entirely within the boundaries already
proven safe by ADR-0087. B is the only approach that genuinely solves generated NPCs,
but it moves a boundary (RoomSpec schema) that requires its own explicit, separate
approval and test coverage. The maintainer decided to ship A now and record B as an
approved-in-principle, separately-scheduled V1.

---

## Decision

Adopt a **closed, three-stage authored lookup**: NPC id → (optional) closed NPC type →
closed routine preset → closed time-bucket schedule (built only from ADR-0087's
existing four modes). Ship **option A only** in this feature.

- **Closed vocabularies (new):**
  - `NpcRoutineNpcType = 'guard' | 'merchant' | 'villager' | 'noble' | 'servant' |
    'wanderer' | 'static_npc'`
  - `NpcRoutinePreset = 'stationary' | 'day_patrol_night_rest' | 'day_idle_night_rest' |
    'wander_day_rest_night' | 'patrol_morning_day_rest_night'`
  - Every preset resolves to an `NpcRoutineSchedule` (ADR-0087's type) built only from
    `idle | patrol | rest | passive` — no fifth mode, no new motor policy.
- **Resolution priority, pure and total, never throws:**
  1. Explicit `NPC_ROUTINE_CONFIG[npcId]` (ADR-0087, unchanged) — wins if present.
     `herald-asha` resolves exactly as it does today.
  2. Otherwise, if a closed type is available for the id via the new authored
     `NPC_TYPE_BY_ID` map, and that type maps to a valid preset, resolve that preset's
     schedule.
  3. Otherwise, `null` — no routine, existing wander/idle behavior.
- **NPC type source in V0: authored, id-keyed `NPC_TYPE_BY_ID` map only.** A frozen
  `Record<string, NpcRoutineNpcType>`, the same closed-allowlist shape as
  `NPC_ROUTINE_CONFIG` and `DEMO_CHASE_NPC_IDS` — never derived, discovered, inferred,
  or expanded at runtime from any content source (name, persona, dialogue, room text,
  prompt text, generated text, provider output).
- **No RoomSpec/schema/save-game/persistence change of any kind.** This is a pure
  in-memory, authored-data lookup layered under the existing `app/npcRoutine.ts`
  selector.
- **Generated NPCs are not solved by this feature.** A generated NPC id receives a
  routine only if a maintainer explicitly adds it to `NPC_TYPE_BY_ID` or
  `NPC_ROUTINE_CONFIG` by hand — there is no automatic classification path.
- **`VITE_AIGM_DEMO_ROUTINE` gate, present-NPC intersection, and every ADR-0087 safety
  property are unchanged and reused verbatim** — this feature only changes which
  schedule gets resolved for an id, not the gate, the eligibility rule, the motor
  integration, or the movement-priority order.

### Deferred: Option B (recorded future V1)

An optional, closed, validated enum field on the RoomSpec `Npc` schema (e.g.
`npcType?: NpcRoutineNpcType`), populated only by trusted generated-assembly code
(never trusted directly from provider output — any provider proposal would need
re-validation against the closed enum, dropped if invalid), is the recommended,
approved-in-principle path to scale routines to generated NPCs. It is an additive
RoomSpec change and therefore requires its own explicit maintainer approval, its own
ADR, and its own schema/save-load/redteam test coverage before any code is written. Not
started in this feature. See implementation plan §16 for the full requirements list
agreed for that future work.

### Rejected: Option E (permanent)

LLM/provider-generated routine text or schedules are permanently rejected, not
deferred — see implementation plan §17. No future version of this feature line should
reconsider this without a full renegotiation of the generation-safety boundaries in
`AGENTS.md`/`BOUNDARIES.md`.

---

## Consequences

- **herald-asha is unaffected.** Priority order guarantees the explicit config always
  wins; this feature cannot change its resolved schedule.
- **Real rooms keep zero behavior change by default.** The gate stays off; the new
  `NPC_TYPE_BY_ID` map is itself a closed allowlist requiring an explicit maintainer
  edit per id — no NPC newly receives a routine just because this feature ships.
- **Authored/demo NPCs can now share a schedule by type**, removing the need to
  hand-write a bespoke four-bucket schedule per NPC id for common cases (a guard, a
  merchant, a villager, …).
- **Generated NPCs remain unsolved**, by design, in this feature. This is a known,
  explicitly recorded gap, not an oversight — closing it is option B, a separate,
  larger, schema-touching feature requiring its own approval.
- **No new authority, motor policy, or pre-emption surface.** This feature only adds a
  lookup step ahead of the existing `selectRoutineMode` call; `WanderMotor`, `Engine`,
  `RoomViewer`, and `App`'s present-NPC derivation are all unchanged.
- **Fail-closed everywhere**, matching ADR-0087: unknown id, unknown type, or unmapped
  preset all degrade to no-routine, never a thrown error or a stall.

---

## Alternatives considered

- **Option B now (schema field for generated NPCs).** Rejected for this feature only
  (not permanently) — it is the right long-term answer but requires separate schema
  approval, its own validation/trust-boundary work, and its own test suite; bundling it
  here would mix a schema-changing feature with a pure-lookup one, against the
  Minimum Safe Change Rule.
- **Option C (ephemeral generated-pipeline enrichment without a schema field).**
  Rejected — without a safe classification signal, it either collapses to a
  content-blind blanket default for every generated NPC (not real classification) or it
  secretly requires option B's signal, making it a strictly worse version of B.
- **Option D (infer from an NPC asset/object subtype).** Rejected — no such subtype
  exists in the current RoomSpec vocabulary (only a single `npc` object type); adding
  one is a schema change at least as large as B, and one that also touches the trusted
  renderer's builder registry.
- **Option E (LLM/provider-generated schedules).** Rejected permanently — see above and
  implementation plan §17.
- **Skip the preset layer; keep hand-writing per-id schedules.** Rejected — does not
  scale even for authored/demo NPCs; the preset layer is small, closed, and pure, so
  the Minimum Safe Change ladder favors adding it now rather than continuing to hand-
  author every schedule from scratch.

---

## Verification

Implemented per this ADR's decision, with no relaxation: `NPC_ROUTINE_CONFIG` (ADR-0087)
still wins first; `NPC_TYPE_BY_ID` contains exactly `herald-asha -> guard` in v0; every
preset resolves only to ADR-0087's four closed modes; unknown id/type/preset resolves to
`null`; generated NPCs remain unsolved by this feature; option B stays deferred and
option E stays permanently rejected. Full detail and the closed-vocabulary/mapping record
live in the implementation plan's §19 Slice 4 closeout record.

- Full suite (`npm run test`, run from `apps/web`) — 216 files / 3726 tests passed.
- `npm run lint` — clean.
- `npm run build` — succeeded.
- Targeted safety/redteam/import-surface coverage
  (`src/redteam/npcRoutine.redteam.test.ts`, `src/domain/npcRoutinePresets.test.ts`,
  `src/domain/npcRoutineTypeConfig.test.ts`, `src/app/npcRoutine.test.ts`) passed, proving
  no content-derived classification path and no import surface onto provider/prompt/
  persistence/world-event/memory/fact modules.
- App/RoomViewer/routine/chase/patrol/awareness regressions
  (`src/App.test.tsx`, `src/renderer/RoomViewer.test.ts`, `src/domain/npcRoutine.test.ts`,
  `src/domain/npcRoutineConfig.test.ts`, `src/renderer/engine/npc/chaseStep.test.ts`,
  `src/renderer/engine/npc/patrolStep.test.ts`, `src/renderer/engine/npc/WanderMotor.test.ts`,
  `src/renderer/engine/Engine.test.ts`) passed with no weakening of ADR-0087/ADR-0084/
  ADR-0083/ADR-0080 behavior or tests.
