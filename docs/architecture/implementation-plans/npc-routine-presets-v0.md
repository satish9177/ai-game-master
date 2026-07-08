# Implementation Plan — `feature/npc-routine-presets-v0`

> Status: **IMPLEMENTED — Slices 0–3 shipped; Slice 4 (this closeout) complete.**
> Written **docs-first**, ahead of implementation, per `AGENTS.md`
> ("Design first. Do not implement until the maintainer approves.") and the
> `npc-day-night-routine-v0` precedent.
> See [ADR-0088](../decisions/ADR-0088-npc-routine-presets-v0.md).
>
> Companion docs: [ARCHITECTURE](../ARCHITECTURE.md) · [BOUNDARIES](../BOUNDARIES.md) ·
> [FAILURE-MODES](../FAILURE-MODES.md) · [CONVENTIONS](../CONVENTIONS.md) ·
> [/AGENTS.md](../../../AGENTS.md) ·
> [npc-day-night-routine-v0](./npc-day-night-routine-v0.md)
> ([ADR-0087](../decisions/ADR-0087-npc-day-night-routine-v0.md)).

---

## 0. Approval status and locked decision (read first)

This feature **extends** `npc-day-night-routine-v0` (ADR-0087) with reusable, closed
routine presets, so authored/demo NPCs can share a schedule by *type* instead of every
NPC needing its own hand-written per-id schedule entry.

The maintainer has made the following decisions. They may not be relaxed without
explicit re-approval:

1. **V0 implements option A only: authored id → closed NPC type → closed routine
   preset.** No RoomSpec/schema change. No generated-NPC classification.
2. **Explicit NPC id schedule still wins.** `NPC_ROUTINE_CONFIG` (ADR-0087) is checked
   first; the herald-asha entry resolves exactly as it does today, unchanged.
3. **Then** an authored `NPC_TYPE_BY_ID` mapping can supply a closed NPC type for an id
   that has no explicit schedule.
4. **Then** the type maps to a closed routine preset.
5. **Then** the preset maps to a closed time-bucket routine schedule — built only from
   the existing four closed modes (`idle | patrol | rest | passive`) from ADR-0087. No
   fifth mode.
6. **Unknown id, unknown type, or unknown/invalid preset all resolve to `null` (no
   routine)** — never a runtime error, never a default invented on the fly.
7. **Generated NPCs are not solved by this feature.** A generated NPC (e.g.
   `generated-npc-2`) receives a routine only if it is *also* explicitly authored into
   `NPC_TYPE_BY_ID` or `NPC_ROUTINE_CONFIG` by a maintainer — there is no automatic
   classification of generated NPCs in v0.
8. **Option B (optional closed `routineType`/`npcType` enum field on the RoomSpec `Npc`
   schema) is the recorded, separately-approved future V1** for scaling to generated
   NPCs. It is **not implemented in this feature** — see §16.
9. **Option E (LLM/provider-generated routine text or schedules) is permanently
   rejected.** See §17.

---

## 1. Title and status

- **Feature:** `npc-routine-presets-v0` — Closed NPC Type → Routine Preset Layer
  (authored-id-only, V0).
- **Lane:** worked on `main` directly (per current project convention — no feature
  branches), one slice at a time.
- **Status:** **Implemented.** Slices 0–3 shipped; Slice 4 (docs/ADR closeout) complete.
- **ADR:** [ADR-0088](../decisions/ADR-0088-npc-routine-presets-v0.md).

## 2. Problem statement

`npc-day-night-routine-v0` (ADR-0087) proved a deterministic, same-room, movement-only
routine layer, but its only metadata source is `NPC_ROUTINE_CONFIG`, a per-id schedule
map with exactly one entry (`herald-asha`). Every additional authored/demo NPC that
wants a routine currently needs its own hand-written four-bucket schedule, even when
many NPCs would share the same *kind* of day/night behavior (a guard patrols by day and
rests by night; a villager wanders by day and rests by night; and so on).

This feature adds a **reusable preset layer** — closed NPC types map to closed routine
presets, which map to closed schedules — so an authored NPC can opt into a routine by
naming its type once, instead of writing out a bespoke per-bucket schedule. It does
**not** attempt to solve routine assignment for arbitrary generated NPCs; that remains
blocked on the absence of any safe classification signal on generated NPC objects
(§16).

## 3. Existing foundations this builds on (read-only reuse)

| Foundation | File(s) | What it gives us |
| --- | --- | --- |
| Routine modes + mapping | `apps/web/src/domain/npcRoutine.ts` | `NpcRoutineMode = 'idle' \| 'patrol' \| 'rest' \| 'passive'`, `NpcRoutineSchedule = Partial<Record<TimeOfDay, NpcRoutineMode>>`, `selectRoutineMode`, `routineModeToMotorPolicy`. Unchanged. |
| Explicit id config | `apps/web/src/domain/npcRoutineConfig.ts` | `NPC_ROUTINE_CONFIG` (frozen, `herald-asha` only), `getRoutineSchedule(npcId)`. Unchanged; stays the highest-priority source. |
| Gate + selector | `apps/web/src/app/npcRoutine.ts` | `readRoutineEnabled` (`VITE_AIGM_DEMO_ROUTINE`), `selectNpcRoutineModes({enabled, presentNpcIds, timeOfDay, config})`. Extended, not replaced. |
| Present-NPC derivation | `apps/web/src/App.tsx` (~L1405–1417) | Builds `presentNpcIds` from validated `room.objects` where `type === 'npc' && id !== undefined`. Unchanged. |
| NPC schema | `apps/web/src/domain/roomSpec.ts` (`Npc`, ~L228) | `{ type: 'npc', name, interaction, color, id?, position, rotationY, scale }` — **no closed type/role/archetype field exists.** Unchanged; this feature adds none. |
| Opt-in gate/allowlist pattern | `apps/web/src/app/demoChaseOptIn.ts` | The exact shape being mirrored again: pure selector = frozen allowlist/map ∩ present ids, gated by a default-off env var. |

**Key finding carried over from the design discussion (unchanged, re-confirmed here):**
the validated `Npc` RoomSpec object has no closed type/role/archetype/disposition field
today. `name` is generated/content-derived text (a domain boundary forbids parsing it
for behavior). Generated NPC ids (`generated-npc`, `generated-npc-2`, …) are not
predictable ahead of time and carry no semantic meaning. This means a closed NPC type
can only be supplied today by **explicit authored mapping (option A)** — there is no
safe signal to derive it automatically for a generated NPC in this feature.

## 4. Explicit non-goals (v0)

- No RoomSpec/schema/`schemaVersion` change of any kind.
- No save-game/persistence change.
- No provider/prompt/LLM behavior change.
- No generated-NPC classification, inference, or type assignment of any kind.
- No free-text routines or schedules.
- No content-derived classification from NPC name, persona, dialogue text, room text,
  prompt text, generated text, or provider output.
- No relationship-driven routine behavior.
- No combat/damage/HP/death/capture/injury/encounters/items/quests.
- No cross-room movement, no background simulation loop, no timers/`setInterval`/
  `setTimeout`.
- No `WorldState`/`WorldEvent`/`WorldCommand` read or write.
- No memory/fact/`fact_visibility` read or write.
- No raw prompt/provider/dialogue/room/generated-text logging.
- No change to `VITE_AIGM_DEMO_ROUTINE` default-off behavior.
- No weakening of `npc-day-night-routine-v0` (ADR-0087) or any chase/patrol/awareness
  test or behavior.
- No fifth routine mode; presets are built only from the existing four closed modes.

## 5. Closed vocabulary (new, this feature)

```ts
// domain/npcRoutinePresets.ts (Slice 1)

export type NpcRoutineNpcType =
  | 'guard'
  | 'merchant'
  | 'villager'
  | 'noble'
  | 'servant'
  | 'wanderer'
  | 'static_npc'

export type NpcRoutinePreset =
  | 'stationary'
  | 'day_patrol_night_rest'
  | 'day_idle_night_rest'
  | 'wander_day_rest_night'
  | 'patrol_morning_day_rest_night'
```

Both are closed string-literal unions — no free text, no open enum, no runtime
extension. Every `NpcRoutinePreset` resolves to an `NpcRoutineSchedule` built **only**
from `idle | patrol | rest | passive` (ADR-0087's closed modes) — this feature adds no
new motor policy and no new mode.

Example (final mapping confirmed in Slice 1, illustrative here):

| Type | Preset |
| --- | --- |
| `guard` | `day_patrol_night_rest` |
| `merchant` | `day_idle_night_rest` |
| `villager` | `wander_day_rest_night` |
| `noble` | `day_idle_night_rest` |
| `servant` | `day_idle_night_rest` |
| `wanderer` | `wander_day_rest_night` |
| `static_npc` | `stationary` |

## 6. Resolution priority (pure, total, never throws)

```
resolveRoutineScheduleForNpc({ npcId, npcType, explicitConfig, typePresetMap, presets }):
  1. explicitConfig[npcId] present            → return that schedule (unchanged herald-asha path)
  2. npcType is a valid closed NpcRoutineNpcType
     AND typePresetMap[npcType] is a valid closed NpcRoutinePreset
     AND presets[preset] is a valid schedule  → return that schedule
  3. otherwise                                → return null (no routine)
```

- Step 1 is byte-identical to today's `getRoutineSchedule(npcId)` lookup — priority
  order guarantees `herald-asha` is untouched by this feature.
- Step 2 only ever consults **closed, in-repo, authored data** — never NPC name,
  persona, dialogue, room text, prompt text, generated text, or provider output.
- Any unknown/free-text/malformed `npcType` string, any id absent from both maps, or
  any (theoretically impossible, defensively checked) invalid preset value all fall
  through to `null` — never a thrown error, never a default mode invented on the fly.

## 7. NPC type source for V0 (option A only)

A new, frozen, authored, **id-keyed** map — the only closed-type source in this
feature:

```ts
// domain/npcRoutineTypeConfig.ts (Slice 2)
export const NPC_TYPE_BY_ID: Readonly<Record<string, NpcRoutineNpcType>> = Object.freeze({
  // authored/demo NPC ids only — confirmed in Slice 2
})
```

This map is itself a closed allowlist, exactly like `NPC_ROUTINE_CONFIG` and
`DEMO_CHASE_NPC_IDS`: only ids present as keys can ever resolve a type, and the map is
never derived, discovered, inferred, or expanded at runtime from any content source.
Generated NPC ids are not added to this map automatically by any part of this feature —
if a generated id is ever added, that is a separate, explicit maintainer edit, not
automatic classification.

## 8. Integration point (Slice 2)

`app/npcRoutine.ts`'s `selectNpcRoutineModes` currently does:

```ts
for (const [npcId, schedule] of Object.entries(config)) {
  if (!presentNpcIds.has(npcId)) continue
  const mode = selectRoutineMode(schedule, timeOfDay)
  if (mode !== null) selected.set(npcId, mode)
}
```

This iterates only ids present as keys in `NPC_ROUTINE_CONFIG`. Slice 2 changes the
resolution to: for each **present** NPC id, call
`resolveRoutineScheduleForNpc({ npcId, npcType: NPC_TYPE_BY_ID[npcId], explicitConfig,
typePresetMap: NPC_TYPE_TO_ROUTINE_PRESET, presets: ROUTINE_PRESETS })`, then
`selectRoutineMode` on the resolved schedule as before. This means the loop iterates
present ids (not just config keys), but the resolver still returns `null` for any id
that is in neither map — so behavior for every currently-unconfigured NPC is unchanged
(no schedule → no mode → not added to the result map).

No change to `App.tsx`'s present-id derivation, `RoomViewer.tsx`, `Engine.ts`,
`WanderMotor.ts`, or the `SetRoomOptions.npcRoutineModes` seam — all of that is reused
verbatim from ADR-0087.

## 9. Safety / authority model

- **Presentation/runtime-only**, identical in kind to ADR-0087: this feature only
  changes *which schedule* is resolved for an NPC id: it does not touch the pause,
  chase, or motor-policy-application layers at all.
- **Fail closed everywhere:** unknown id, unknown type, unmapped preset, disabled gate,
  or absent time bucket all degrade to no-routine (existing wander/idle behavior) —
  never a stall, never a thrown error.
- **No new authority surface.** No `WorldState`/`WorldEvent`/`WorldCommand`, no
  persistence/schema/save-game change, no memory/fact write, no LLM/provider change.
- **No content-derived classification.** The resolver's only inputs are: an id string,
  an optional closed-enum type value looked up from a frozen authored map, and frozen
  authored preset/schedule tables. It never reads `name`, `interaction`, `color`,
  `position`, or any dialogue/persona field.
- **herald-asha preserved.** Priority step 1 (§6) guarantees the existing explicit
  schedule always wins; this feature cannot change herald-asha's resolved behavior.

## 10. Logging/debug safety

No new logging is planned. If any diagnostic is added, it must be logger-abstraction-
only and safe-value-only (e.g., a boolean/enum/count), never an NPC id, name, type
string, room name/text, prompt, or provider body — mirroring ADR-0087 §13.

## 11. Test plan

**`domain/npcRoutinePresets.test.ts` (Slice 1):**
- `ROUTINE_PRESETS` and `NPC_TYPE_TO_ROUTINE_PRESET` are frozen.
- Every preset's schedule contains only the four closed modes (`idle | patrol | rest |
  passive`) — a runtime guard test, not just a type check.
- Every closed `NpcRoutineNpcType` has an entry in `NPC_TYPE_TO_ROUTINE_PRESET`
  resolving to a valid closed `NpcRoutinePreset`.
- `resolveRoutineScheduleForNpc`:
  - Explicit id config present → returns that schedule verbatim, ignoring any type.
  - No explicit config, valid type present in `typePresetMap` → returns the preset's
    schedule.
  - No explicit config, unknown/free-text/hostile-looking type string → returns `null`.
  - No explicit config, no type → returns `null`.
  - Unknown npc id in neither map → returns `null`.
  - Never throws for any input shape (malformed/undefined/empty string).

**`domain/npcRoutineTypeConfig.test.ts` (Slice 2):**
- `NPC_TYPE_BY_ID` is frozen.
- Every value is one of the seven closed `NpcRoutineNpcType` values (runtime guard).

**`app/npcRoutine.test.ts` (extend, Slice 2):**
- An id with no explicit `NPC_ROUTINE_CONFIG` entry but a type mapping in
  `NPC_TYPE_BY_ID` resolves to the expected mode for the current time bucket.
- `herald-asha` still resolves via its explicit schedule, unchanged, even if (in a test
  double) it were also given a type mapping — explicit config wins.
- An id present in the room but absent from both maps is not present in the result
  (unchanged skip behavior).
- Gate off → empty map (unchanged).

**Safety/redteam tests (Slice 3):**
- A scan/property test asserting a free-text or unrecognized `npcType` string never
  resolves to a non-null schedule.
- A scan test proving the new modules import no `setInterval`/`setTimeout`, no
  `WorldEvent`/`WorldCommand`/`WorldState`-mutating helper, no provider/network code —
  mirroring `npcRoutine.redteam.test.ts` (ADR-0087) and the "dry/no-side-effect scan"
  pattern from `room-environment-transition-model-dry-v0` (ADR-0078).
- A test asserting the resolver's output is unaffected by any NPC `name`/`persona`/
  dialogue field — i.e., two fixture NPCs with identical id/type but different
  name/persona resolve identically.
- Full regression run of the unmodified `npc-day-night-routine-v0` test suite
  (`npcRoutine.test.ts`, `npcRoutineConfig.test.ts`, `app/npcRoutine.test.ts`,
  `WanderMotor.test.ts`, `Engine.test.ts`, `redteam/npcRoutine.redteam.test.ts`) plus
  chase/patrol/awareness suites, proving no weakening.

## 12. Implementation slices

1. **Slice 1 — Pure preset/type model + resolver + tests.** `domain/npcRoutinePresets.ts`
   (closed enums, `ROUTINE_PRESETS`, `NPC_TYPE_TO_ROUTINE_PRESET`,
   `resolveRoutineScheduleForNpc`) + `domain/npcRoutinePresets.test.ts`. **Dry** — no
   caller yet, no App/Engine/RoomViewer change.
2. **Slice 2 — Authored type map + integration.** `domain/npcRoutineTypeConfig.ts`
   (`NPC_TYPE_BY_ID`) + its test; `app/npcRoutine.ts` routes through the resolver per
   §8; extend `app/npcRoutine.test.ts`. No `App.tsx`/`RoomViewer.tsx`/`Engine.ts`/
   `WanderMotor.ts` change.
3. **Slice 3 — Safety/redteam/eval tests.** Prove no content/schema/provider side
   effects per §11; full regression run of ADR-0087's suite plus chase/patrol/awareness.
4. **Slice 4 — Docs closeout.** Flip this plan and ADR-0088 to Implemented, add the
   `ARCHITECTURE.md` implemented-status line, record verification results.

Each slice is independently reviewable and keeps the full suite green. **Generated-NPC
schema/type work (option B) is explicitly out of scope for all slices in this
feature** (§16).

## 13. Risk analysis

| Risk | Mitigation |
| --- | --- |
| herald-asha regression | Explicit id config checked first in resolver priority (§6); Slice 2 test asserts unchanged resolution even with a hypothetical competing type entry. |
| Silent blanket activation via type map | `NPC_TYPE_BY_ID` is itself a closed, hand-authored id allowlist — an id must still be explicitly added by a maintainer; gate stays default-off; present-NPC intersection unchanged. |
| Content-derived classification creeping in | Resolver takes only id + type-enum-lookup + frozen tables as input; redteam test in Slice 3 asserts name/persona independence. |
| New motor policy / authority surface | None added — presets resolve only to the four existing closed modes; no `WanderMotor`/`Engine` change in this feature. |
| Schema/persistence creep | No RoomSpec/save-game field added; this is a pure in-memory authored-data lookup. |
| Free-text schedule | Impossible — `NpcRoutinePreset`/`NpcRoutineNpcType` are closed unions; resolver has no free-text branch. |
| Confusing this feature with generated-NPC support | Explicitly documented as unsolved in this feature (§3, §16); no code path in this feature reads a generated NPC's id and assigns it a type. |

## 14. Verification commands (run from `apps/web`, later)

```bash
npx vitest run src/domain/npcRoutinePresets.test.ts
npx vitest run src/domain/npcRoutinePresets.test.ts src/domain/npcRoutineTypeConfig.test.ts src/app/npcRoutine.test.ts
npx vitest run src/domain/npcRoutine.test.ts src/domain/npcRoutineConfig.test.ts src/redteam/npcRoutine.redteam.test.ts
npx vitest run src/renderer/engine/npc/chaseStep.test.ts src/renderer/engine/npc/patrolStep.test.ts src/renderer/engine/npc/WanderMotor.test.ts src/renderer/engine/Engine.test.ts
npx vitest run src/App.test.tsx src/renderer/RoomViewer.test.ts
npm run lint
npm run build
npm run test
```

## 15. Minimum Safe Change Check

- **Reused:** `NpcRoutineMode`/`NpcRoutineSchedule`/`selectRoutineMode`/
  `routineModeToMotorPolicy` (`domain/npcRoutine.ts`, unmodified), `NPC_ROUTINE_CONFIG`/
  `getRoutineSchedule` (unmodified, stays highest priority), the
  `selectNpcRoutineModes`/`readRoutineEnabled` gate shape (`app/npcRoutine.ts`,
  extended not replaced), the `demoChaseOptIn.ts`/`NPC_ROUTINE_CONFIG` closed-allowlist
  pattern, the existing present-NPC-id derivation in `App.tsx` (untouched).
- **Minimum new code:** one closed preset/type domain module + resolver
  (`domain/npcRoutinePresets.ts`), one frozen authored id→type config
  (`domain/npcRoutineTypeConfig.ts`), a small routing change inside
  `selectNpcRoutineModes`'s existing loop.
- **Safety boundaries unchanged:** renderer trust boundary; chase/patrol/awareness logic
  and tests; `WorldState`/`WorldEvent`/`WorldCommand`/event-log authority; memory
  firewall; schema/save-game/persistence; provider/prompt path; logging redaction;
  `VITE_AIGM_DEMO_ROUTINE` default-off behavior; herald-asha's resolved schedule.
- **Tests prove it:** §11, anchored by the resolver priority tests, the frozen-map
  runtime guards, the content-independence redteam test, and an unmodified regression
  run of the full `npc-day-night-routine-v0` suite plus chase/patrol/awareness.

## 16. Deferred: Option B — generated-NPC classification (separate future feature)

**Not implemented in this feature.** Recorded here so the boundary is explicit and the
next feature doesn't need to re-derive this reasoning.

The only way to give **arbitrary generated NPCs** (ids like `generated-npc-2`, unknown
ahead of time) a routine without content-derived classification is to add a **closed,
optional enum field to the RoomSpec `Npc` schema** — e.g. `npcType?: NpcRoutineNpcType`
(naming TBD) — populated only by the trusted generated-assembly pipeline (mirroring how
`ensureGeneratedNpcPresence`/`ensureGeneratedNpcDialogue` already attach trusted,
deterministic fields to a generated NPC object), never copied from raw provider output
without validation.

Requirements for that future feature, agreed in this design round:

- The field must be a **closed, validated enum** — never free text. A lenient-loader
  pass must drop any value outside the closed set (exactly like existing generated-room
  normalizers drop invalid optional fields).
- It must **never** be trusted directly from provider/LLM output — any provider
  proposal for this field must be re-validated against the closed enum and dropped if
  invalid, the same trust posture as every other generated-content boundary in this
  repo (`AGENTS.md` generation-safety rules).
- It must **never** gate dialogue availability, combat, or any other gameplay
  consequence — movement-only, exactly like the existing routine modes.
- It is additive to `RoomSpec`; `schemaVersion` would stay at its current value (an
  additive optional field), but it is still a schema change and therefore requires its
  own explicit maintainer approval and its own ADR before any code is written.
- It needs its own save/load, redteam, and provider-distrust test coverage before it can
  be considered safe to ship.

This feature (`npc-routine-presets-v0`) deliberately stops short of this: it ships the
preset/type reuse machinery so that **when** option B is approved, the resolver in §6
needs no change — a generated NPC's validated `npcType` field would simply become a
second, safe source of `npcType` for `resolveRoutineScheduleForNpc`, alongside (not
replacing) the authored `NPC_TYPE_BY_ID` map.

## 17. Rejected: Option E — LLM/provider-generated routine schedules

**Permanently rejected, not deferred.** Letting an LLM/provider propose routine
text/schedules at runtime would violate multiple hard boundaries simultaneously:

- It is runtime provider control of a movement-authority decision — explicitly
  prohibited by this feature and by ADR-0087.
- It would make routine schedules content-derived and non-deterministic, exactly the
  risk the authored-config approach (ADR-0087 and this ADR) was designed to avoid.
- It would be unbounded/free-text in practice (or require yet another closed-enum
  validation layer to constrain it — at which point it degenerates into option B, minus
  the safety of trusted-assembly-only population).
- It could not be logged safely (provider-proposed schedule content would be
  generated/provider output, which the logging-redaction rules in `AGENTS.md` forbid
  logging raw).

No version of this feature line should reconsider option E without a full renegotiation
of the generation-safety boundaries in `AGENTS.md`/`BOUNDARIES.md`.

## 18. Slice 0 record

This document and [ADR-0088](../decisions/ADR-0088-npc-routine-presets-v0.md) are the
entire Slice 0 deliverable. No `.ts`/`.tsx` source or test file was created or modified
in Slice 0. `docs/architecture/ARCHITECTURE.md` gains one planned-status bullet line
pointing at this plan and ADR-0088, to be replaced at Slice 4 closeout by an
implemented-status line, per the `npc-day-night-routine-v0` precedent.

## 19. Slice 4 closeout record (this update)

**Implemented, option A only.** A reusable, closed authored id → closed NPC type →
closed routine preset → closed time-bucket schedule layer now sits ahead of the existing
per-id routine lookup, unchanged in priority or safety posture from ADR-0087.

- **Resolution priority, exactly as designed (§6):** an explicit
  `NPC_ROUTINE_CONFIG[npcId]` entry (ADR-0087, unchanged) still wins first — `herald-asha`
  resolves exactly as it did before this feature. Only when no explicit entry exists does
  `resolveRoutineScheduleForNpc` (`domain/npcRoutinePresets.ts`) consult a closed
  `npcType` looked up from the authored `NPC_TYPE_BY_ID` map
  (`domain/npcRoutineTypeConfig.ts`) and map it through a closed preset to a schedule.
  Any unknown id, unknown/free-text type, or unmapped preset returns `null` — no routine,
  never a thrown error, never an invented default.
- **`NPC_TYPE_BY_ID` (`domain/npcRoutineTypeConfig.ts`) currently contains exactly one
  entry in v0: `'herald-asha': 'guard'`.** It is a frozen, id-keyed allowlist in the same
  closed-map shape as `NPC_ROUTINE_CONFIG` and `DEMO_CHASE_NPC_IDS` — never derived,
  discovered, or expanded at runtime from any content source.
- **Closed vocabularies shipped as planned (§5):** `NpcRoutineNpcType` (`guard | merchant
  | villager | noble | servant | wanderer | static_npc`) and `NpcRoutinePreset`
  (`stationary | day_patrol_night_rest | day_idle_night_rest | wander_day_rest_night |
  patrol_morning_day_rest_night`) are both closed string-literal unions with runtime
  type-guard checks (`isNpcRoutineNpcType`/`isNpcRoutinePreset`) in
  `domain/npcRoutinePresets.ts` — no free text, no open enum.
- **`ROUTINE_PRESETS` uses only the four existing closed modes** (`idle | patrol | rest |
  passive`) from ADR-0087. No fifth mode and no new motor policy were added.
- **Unknown id, unknown type, or unknown/invalid preset all resolve to `null`** (no
  routine) — proven by the Slice 1/2 unit tests and the Slice 3 redteam coverage; the
  resolver never throws.
- **Generated NPCs are not solved by this feature**, exactly as scoped: a generated NPC
  id (e.g. `generated-npc-2`) receives a routine only if a maintainer explicitly adds it
  to `NPC_TYPE_BY_ID` or `NPC_ROUTINE_CONFIG` by hand. No automatic classification path
  was added.
- **Option B (optional closed `routineType`/`npcType` enum field on the RoomSpec `Npc`
  schema) remains deferred**, exactly as recorded in §16/ADR-0088 — not started in this
  feature. It would be populated only by trusted generated-assembly code, never trusted
  directly from provider output, and requires its own separate schema approval and ADR
  before any code is written.
- **Option E (LLM/provider-generated routine text or schedules) remains permanently
  rejected**, per §17/ADR-0088 — no code path in this feature lets an LLM or provider
  propose routine text or a schedule.

Safety/non-goals re-confirmed at closeout (all still hold):

- No RoomSpec/schema/save-game/persistence change of any kind; no `schemaVersion` bump.
- No generated-NPC classification, inference, or type assignment of any kind.
- No provider/prompt/LLM change.
- No content-derived behavior from NPC name, persona, dialogue, room text, prompt text,
  provider output, generated text, relationship state, or journal state — the resolver's
  only inputs are an id string, a closed-enum type value looked up from a frozen authored
  map, and frozen authored preset/schedule tables.
- No relationship-driven routine behavior.
- No new routine modes or motor policies; `ROUTINE_PRESETS` is built only from
  ADR-0087's existing four closed modes.
- No combat/damage/HP/death/capture/injury/encounters/items/quests.
- No cross-room movement.
- No timers or background simulation of any kind.
- No `WorldState`/`WorldEvent`/`WorldCommand` read or write.
- No memory/fact/`fact_visibility` read or write.
- No raw prompt/provider/dialogue/room-text/generated-text logging.
- `VITE_AIGM_DEMO_ROUTINE` default-off behavior is unchanged and unaffected by this
  feature — the gate, present-NPC intersection, and every ADR-0087 safety property are
  reused verbatim.

### Verification (run from `apps/web`)

- Full suite (`npm run test`) — 216 files / 3726 tests passed.
- `npm run lint` — clean.
- `npm run build` — succeeded.
- Targeted safety/redteam/import-surface coverage
  (`src/redteam/npcRoutine.redteam.test.ts`, `src/domain/npcRoutinePresets.test.ts`,
  `src/domain/npcRoutineTypeConfig.test.ts`, `src/app/npcRoutine.test.ts`) — passed
  (part of the full-suite run above).
- App/RoomViewer/routine/chase/patrol/awareness regressions
  (`src/App.test.tsx`, `src/renderer/RoomViewer.test.ts`, `src/domain/npcRoutine.test.ts`,
  `src/domain/npcRoutineConfig.test.ts`, `src/renderer/engine/npc/chaseStep.test.ts`,
  `src/renderer/engine/npc/patrolStep.test.ts`, `src/renderer/engine/npc/WanderMotor.test.ts`,
  `src/renderer/engine/Engine.test.ts`) — passed (part of the full-suite run above), no
  weakening of ADR-0087/ADR-0084/ADR-0083/ADR-0080 behavior or tests.

Boundaries re-confirmed at closeout (all still hold): see the safety/non-goals list
above; every item was true before this feature and remains true after it.
