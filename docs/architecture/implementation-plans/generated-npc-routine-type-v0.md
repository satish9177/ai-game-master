# Implementation Plan — `feature/generated-npc-routine-type-v0`

> Status: **Slice 0 (this document + ADR-0090) — docs-only. Not yet implemented.**
> No `.ts`/`.tsx` source or test file, no schema, and no prompt code has been created
> or modified. Written **docs-first**, ahead of implementation, per `AGENTS.md`
> ("Design first. Do not implement until the maintainer approves.") and the
> `npc-routine-presets-v0` precedent.
>
> See [ADR-0090](../decisions/ADR-0090-generated-npc-routine-type-v0.md).
> Delivers the deferred **Option B** recorded in
> [ADR-0088](../decisions/ADR-0088-npc-routine-presets-v0.md) (§"Deferred: Option B") and
> [`npc-routine-presets-v0` §16](./npc-routine-presets-v0.md).
>
> Companion docs: [ARCHITECTURE](../ARCHITECTURE.md) · [BOUNDARIES](../BOUNDARIES.md) ·
> [FAILURE-MODES](../FAILURE-MODES.md) · [CONVENTIONS](../CONVENTIONS.md) ·
> [/AGENTS.md](../../../AGENTS.md) ·
> [npc-day-night-routine-v0](./npc-day-night-routine-v0.md)
> ([ADR-0087](../decisions/ADR-0087-npc-day-night-routine-v0.md)) ·
> [npc-routine-presets-v0](./npc-routine-presets-v0.md)
> ([ADR-0088](../decisions/ADR-0088-npc-routine-presets-v0.md)) ·
> [npc-routine-dialogue-context-v0](./npc-routine-dialogue-context-v0.md)
> ([ADR-0089](../decisions/ADR-0089-npc-routine-dialogue-context-v0.md)).

---

## 0. Approval status and locked decisions (read first)

This feature **delivers Option B** from ADR-0088: an optional, closed, validated
`npcType` enum field on the RoomSpec `Npc` schema, so **generated** NPCs can opt into the
existing routine presets without any hardcoded per-id map and without content-derived
classification.

The maintainer has made the following decisions. They may not be relaxed without
explicit re-approval:

1. **Schema approval granted.** Add an optional, closed-enum `npcType` field to the
   RoomSpec `Npc` object.
2. **Field name is `npcType`, not `routineType`.** It is data-only NPC metadata — a
   category, not a schedule and not a behavior command.
3. **Allowed values (reused from ADR-0088, no new values):**
   `guard | merchant | villager | noble | servant | wanderer | static_npc`.
4. **Invalid / missing / unknown / free-text / wrong-type / `null` values are dropped
   and treated as `undefined`.** Generated-room validation accepts the valid closed enum
   only. This is enforced **inside the schema** (field-level
   `z.enum(...).optional().catch(undefined)`), not by a new pipeline stage.
5. **Room prompt may include a minimal closed-enum category hint** so generated NPCs can
   populate `npcType`. The prompt may ask for a **category only**; it must **not** ask
   for schedules, routines, routine modes, time-of-day behavior, or custom routine text.
6. **Runtime behavior:** `npcType` → existing `NpcRoutineNpcType` → existing preset →
   existing schedule → current mode from `worldClock.timeOfDay`. **No new resolver, no
   custom schedule, no provider-controlled schedule.**
7. **Explicit `NPC_ROUTINE_CONFIG` id schedule wins first** (ADR-0087, unchanged).
8. **Authored `NPC_TYPE_BY_ID` map wins over the room field** (ADR-0088 fallback/fixture
   path preserved).
9. **Generated NPC routines remain behind `VITE_AIGM_DEMO_ROUTINE`** (default off).
10. **Dialogue context continues reading the existing `npcRoutineModes` map** — no
    dialogue changes expected.
11. **Option E (LLM/provider-generated routine text or schedules) remains permanently
    rejected** (ADR-0088 §17).

---

## 1. Title and status

- **Feature:** `generated-npc-routine-type-v0` — optional closed `npcType` field on the
  RoomSpec `Npc` schema so generated NPCs can use existing routine presets.
- **Lane:** worked on `main` directly (per current project convention — no feature
  branches), one slice at a time.
- **Status:** **Slice 0 (docs-only) complete in this document. Slices 1–5 not started.**
- **ADR:** [ADR-0090](../decisions/ADR-0090-generated-npc-routine-type-v0.md).

## 2. Problem statement

`npc-routine-presets-v0` (ADR-0088) made routines reusable by *type*, but its only type
source is the authored, **per-NPC-id** `NPC_TYPE_BY_ID` map (one entry: `herald-asha ->
guard`). A generated NPC's id (`generated-npc`, `generated-npc-2`, …) is not known ahead
of time, so no authored id map can classify it — routines therefore only work for
authored/demo NPCs.

The validated `Npc` RoomSpec object has **no safe closed role/type/archetype field**
today, and its `name`/`persona`/`interaction.body`/dialogue fields are generated,
content-derived text that a domain boundary forbids parsing for behavior. This feature
adds the **one safe signal** that closes the gap: an optional, closed, validated
`npcType` enum on the NPC object, populated by validated generated data (or authored),
never derived from any text — Option B from ADR-0088.

## 3. Existing foundations this builds on (read-only reuse)

| Foundation | File(s) | What it gives us |
| --- | --- | --- |
| Routine modes + mapping | `apps/web/src/domain/npcRoutine.ts` | `NpcRoutineMode`, `NpcRoutineSchedule`, `selectRoutineMode`, `routineModeToMotorPolicy`. Unchanged. |
| Closed preset/type layer + resolver | `apps/web/src/domain/npcRoutinePresets.ts` | `NpcRoutineNpcType`, `NpcRoutinePreset`, `ROUTINE_PRESETS`, `NPC_TYPE_TO_ROUTINE_PRESET`, `resolveRoutineScheduleForNpc`, and the (currently module-private) `NPC_ROUTINE_NPC_TYPES` array + `isNpcRoutineNpcType` guard. Resolver reused **unchanged**; the array/guard get **exported** for schema + App reuse. |
| Explicit id config | `apps/web/src/domain/npcRoutineConfig.ts` | `NPC_ROUTINE_CONFIG` (frozen, `herald-asha` only). Unchanged; stays highest priority. |
| Authored type map | `apps/web/src/domain/npcRoutineTypeConfig.ts` | `NPC_TYPE_BY_ID` (frozen, `herald-asha -> guard`). Unchanged; stays the fallback/fixture path, above the room field. |
| Gate + selector | `apps/web/src/app/npcRoutine.ts` | `readRoutineEnabled` (`VITE_AIGM_DEMO_ROUTINE`), `selectNpcRoutineModes({ enabled, presentNpcIds, timeOfDay, config, typeConfig })`. Extended with an optional room-type source, not replaced. |
| Present-NPC derivation | `apps/web/src/App.tsx` (~L1405–1417) | Builds `presentNpcIds` from validated `room.objects` where `type === 'npc' && id !== undefined`, memoized on `activePlay.room` + time bucket. Extended to also derive a per-id `npcType` map from the same validated objects. |
| NPC schema | `apps/web/src/domain/roomSpec.ts` (`Npc`, ~L228; shared `transform`, ~L22) | `{ type: 'npc', name, interaction, color, id?, position, rotationY, scale }`. Gains one optional closed `npcType` field. |
| Generated-room prompt | `apps/web/src/generation/llmRoomPrompt.ts` | The system prompt / object allowlist. Gains one minimal closed-enum category hint line. |
| Dialogue routine context | `apps/web/src/renderer/RoomViewer.tsx`, `dialogue/contracts`, `generation/llmDialoguePrompt.ts` | Already reads the resolved `npcRoutineModes` map (ADR-0089). **Unchanged** — a newly-resolved generated-NPC mode surfaces automatically. |

**Key finding (re-confirmed):** the validated `Npc` object has no closed
type/role/archetype field today; `name`/`persona`/dialogue text may not be parsed for
behavior; generated NPC ids are unpredictable. A closed `npcType` on the object is the
only safe classification signal, exactly as ADR-0088 §16 predicted.

## 4. Explicit non-goals (v0)

- No `schemaVersion` bump; no save-game/persistence/DB migration (default position — see
  §9; escalate only if a concrete compatibility break is found).
- No content-derived classification from NPC name, persona, dialogue text, room text,
  prompt text, generated text, provider output, relationship state, or journal state.
- No new resolver, routine mode, preset, motor policy, or authority surface.
- No custom/free-text routines or schedules; no provider/LLM-generated schedules; the
  prompt hint asks for a **category only**.
- No relationship-driven routine behavior.
- No combat/damage/HP/death/capture/injury/encounters/items/quests.
- No cross-room movement, no background simulation loop, no timers/`setInterval`/
  `setTimeout`.
- No `WorldState`/`WorldEvent`/`WorldCommand` read or write.
- No memory/fact/`fact_visibility` read or write. **`npcType` is not player memory.**
- No raw prompt/provider/dialogue/room/generated-text logging.
- No change to `VITE_AIGM_DEMO_ROUTINE` default-off behavior.
- No dialogue-layer change (the routine dialogue context of ADR-0089 is reused as-is).
- No weakening of ADR-0087/ADR-0088/ADR-0089 or any chase/patrol/awareness test.

## 5. Schema field (Slice 1)

Add to the `Npc` object in `domain/roomSpec.ts`:

```ts
// illustrative — final form confirmed in Slice 1
const Npc = z.object({
  type: z.literal('npc'),
  name: z.string().min(1),
  interaction: Interaction,
  color: Hex.default('#3a6ea5'),
  npcType: z.enum(NPC_ROUTINE_NPC_TYPES).optional().catch(undefined),
  ...transform,
})
```

- **Closed enum only.** `NPC_ROUTINE_NPC_TYPES` is exported from
  `domain/npcRoutinePresets.ts` (currently module-private) so the schema and the App
  narrow against the same single source of truth — no duplicated string list.
- **`.optional().catch(undefined)`** means: absent → `undefined`; any value outside the
  closed set (unknown string, `"GUARD"`, number, object, `null`, injection payload) →
  coerced to `undefined`, with the NPC and room still valid. Unknown object keys are
  already stripped by zod's default object behavior. The "drop invalid → undefined" rule
  is therefore **entirely inside the schema** — no `assembleRoom` normalizer, no repair
  change, no leakage.
- **Domain import direction is legal:** `roomSpec.ts` and `npcRoutinePresets.ts` are both
  in `domain/`; a domain→domain import is allowed by BOUNDARIES.

## 6. Prompt hint (Slice 2)

Add one minimal line to `llmRoomPrompt.ts`, e.g. (final wording confirmed in Slice 2):

> `An npc object MAY include "npcType" set to exactly one of:
> guard, merchant, villager, noble, servant, wanderer, static_npc. This is a category
> label only. Never include schedules, routines, times, or behavior text.`

- **Category only.** The hint names the closed set and explicitly forbids
  schedules/routines/times/behavior text.
- **Population aid, not a trust boundary.** The schema (`.catch(undefined)`) already
  drops anything invalid, so the field is safe with or without the hint; the hint only
  raises the rate at which generated NPCs carry a valid category.
- **Tests** assert the prompt mentions the closed category set and does **not** contain
  schedule/routine/mode/time-behavior instructions.

## 7. Resolver integration (Slice 3)

`resolveRoutineScheduleForNpc` (ADR-0088) already accepts an `npcType` argument and is
**not modified**. The wiring changes are:

- **`app/npcRoutine.ts`:** `selectNpcRoutineModes` gains an optional
  `roomNpcTypeById?: ReadonlyMap<string, NpcRoutineNpcType>` argument (validated,
  App-derived). For each **present** NPC id:
  - `orderedIds` expands to the union of `config` keys, `typeConfig` keys, **and**
    `roomNpcTypeById` keys, intersected with `presentNpcIds` (so generated ids that
    only appear in the room field are considered).
  - the per-id type passed to the resolver is `typeConfig[id] ?? roomNpcTypeById.get(id)`
    — **authored `NPC_TYPE_BY_ID` wins over the room field.**
  - `resolveRoutineScheduleForNpc({ npcId, npcType, explicitConfig: config })` still
    checks the explicit `NPC_ROUTINE_CONFIG` schedule first, so **`herald-asha` and any
    explicit id resolve unchanged.**
- **`App.tsx`:** extend the existing present-NPC `useMemo` to also build
  `roomNpcTypeById` from the same validated `room.objects` — for each `type === 'npc'`
  object with a defined `id` and a defined validated `npcType`, add
  `id -> npcType`. No new render inputs, no second time source, no reading of
  `name`/`persona`/text. Pass it into `selectNpcRoutineModes`.

Priority order (pure, total, never throws):

```
1. NPC_ROUTINE_CONFIG[npcId]            → explicit schedule (ADR-0087)   [wins]
2. NPC_TYPE_BY_ID[npcId]                → authored type → preset schedule (ADR-0088)
3. room object's validated npcType      → type → preset schedule (this feature)
4. otherwise                           → null (no routine)
```

No change to `RoomViewer.tsx`, `Engine.ts`, `WanderMotor.ts`, the
`SetRoomOptions.npcRoutineModes` seam, or the dialogue routine context (ADR-0089) — all
reused verbatim.

## 8. Safety / authority model

- **Data-only category → authored mapping.** Behavior derives solely from a validated
  closed enum interpreted by frozen authored tables — the same trust class as
  `prop.shape` → cone mesh. The provider proposes a category; the trusted mapping owns
  the routine.
- **No content-derived behavior.** The resolver/selector inputs are: an id string, a
  closed-enum type from a frozen authored map or a *validated* room field, and frozen
  preset/schedule tables. `name`, `persona`, `interaction.body`, dialogue, room text,
  and prompt text are never read to assign a type.
- **No provider control of schedules.** Only the closed `npcType` category is read off a
  room NPC; no `schedule`/`mode`/`timeOfDay` field is ever read from provider output.
- **Fail-closed everywhere.** Invalid/missing/absent `npcType`, unknown id, unmapped
  preset, disabled gate, or absent time bucket all degrade to no-routine.
- **Not player memory / no truth path.** `npcType` is inert RoomSpec metadata: no
  `WorldState`/`WorldEvent`/`WorldCommand`, no memory/fact/`fact_visibility`, no
  persistence write.
- **Gate preserved.** `VITE_AIGM_DEMO_ROUTINE` default-off; present-NPC intersection and
  every ADR-0087/ADR-0088/ADR-0089 property reused verbatim.

## 9. Schema / save-load / persistence impact

- **Additive optional field; no `schemaVersion` bump.** Rooms without `npcType` validate
  unchanged (absent → `undefined`).
- **No save-game/DB migration.** Save blobs and the generated-room cache store validated
  RoomSpec data; on load they re-validate through the same schema, so an absent or
  invalid `npcType` is handled identically to a fresh generation. A pre-existing save
  simply has no `npcType` on its NPCs → no routine change.
- **Escalation clause.** If Slice 1 surfaces a concrete backward-compatibility break that
  genuinely needs a version bump or migration, stop and get separate approval before
  proceeding. Default expectation: none needed.

## 10. Logging / debug safety

No new logging is planned. If a diagnostic is added it must be logger-abstraction-only
and safe-value-only (boolean/enum/count) — never an NPC id, name, `npcType` string, room
name/text, prompt, or provider body. `npcType` values, being a closed 7-value enum, are
themselves non-sensitive, but the default remains "log less."

## 11. Test plan

**`domain/roomSpec.test.ts` (Slice 1):**
- Each of the seven valid `npcType` values is accepted and preserved on the parsed NPC.
- Invalid values are dropped to `undefined`, room still valid: unknown string
  (`"guardian"`), wrong case (`"GUARD"`), number, boolean, object, array, empty string,
  `null`, and an injection-shaped string.
- Absent `npcType` → `undefined`, room valid (backward compatibility).
- Data-only round-trip: parse → serialize preserves a valid `npcType` and never emits an
  invalid one.

**`generation/llmRoomPrompt.test.ts` (Slice 2):**
- The prompt mentions the closed `npcType` category set.
- The prompt does **not** contain schedule/routine/mode/time-of-day/behavior-text
  instructions for `npcType` (category-only assertion).

**`app/npcRoutine.test.ts` + `domain/npcRoutine*` (Slice 3):**
- A generated NPC id absent from both authored maps but carrying a valid room `npcType`
  resolves to the expected mode for the current time bucket.
- `herald-asha` still resolves via its explicit `NPC_ROUTINE_CONFIG` schedule even when a
  same-id room NPC carries a different `npcType` (explicit wins).
- An id present in both `NPC_TYPE_BY_ID` and the room field resolves via the authored map
  (authored wins over room field).
- An NPC with missing/invalid/absent `npcType` and no authored entry gets no routine.
- Gate off → empty map; absent time bucket → empty map (unchanged).

**Safety/redteam tests (Slice 4, under `src/redteam/`):**
- Two fixture NPCs with identical id/`npcType` but different `name`/`persona`/dialogue
  resolve identically (no text parsing).
- An NPC whose `name`/`persona` contains a type word (e.g. "guard") but has no `npcType`
  field gets **no** routine (we don't parse text).
- Free-text / unrecognized `npcType` never resolves to a non-null schedule.
- No `schedule`/`mode`/`time` field on a room NPC is ever consumed (no schedule
  injection); provider cannot control the resolved mode.
- Import-surface scan: the touched modules import no `setInterval`/`setTimeout`, no
  `WorldEvent`/`WorldCommand`/`WorldState`-mutating helper, no memory/fact module, no
  provider/network code.
- Gate-off behavior preserved; no raw text logged.

**Regression:** full unmodified runs of ADR-0087/ADR-0088/ADR-0089 suites plus
chase/patrol/awareness, proving no weakening.

## 12. Implementation slices

1. **Slice 1 — Schema field + exports + validation tests.** Export
   `NPC_ROUTINE_NPC_TYPES` / `isNpcRoutineNpcType` from `domain/npcRoutinePresets.ts`;
   add optional `npcType` to the `Npc` schema in `domain/roomSpec.ts`; add
   `domain/roomSpec.test.ts` coverage (valid accepted; invalid/free-text/wrong-type/
   `null` dropped to `undefined`; absent OK). **Dry** — no caller reads the field yet.
2. **Slice 2 — Minimal prompt hint.** Add the category-only `npcType` line to
   `generation/llmRoomPrompt.ts`; extend `llmRoomPrompt.test.ts` to prove
   category-only (no schedules/routine modes/custom behavior).
3. **Slice 3 — Resolver wiring.** `app/npcRoutine.ts` gains optional `roomNpcTypeById`;
   `App.tsx` derives it from validated present NPC objects and passes it in; extend
   `app/npcRoutine.test.ts` (+ `domain/npcRoutine*` as needed) for the priority order:
   explicit `NPC_ROUTINE_CONFIG` wins, authored `NPC_TYPE_BY_ID` wins over room field,
   generated valid `npcType` gets a mode, missing/invalid/absent gets none.
4. **Slice 4 — Safety/redteam/eval tests.** Prove no text parsing, invalid dropped, no
   schedule injection, no provider control of mode, no memory/world/event/command write,
   no raw logging, gate-off preserved; full regression run.
5. **Slice 5 — Docs/ADR closeout.** Flip this plan and ADR-0090 to Implemented, add the
   `ARCHITECTURE.md` implemented-status line, record verification results, and update
   ADR-0088's deferred Option B note to "delivered by ADR-0090" **only when this feature
   is complete**.

Each slice is independently reviewable and keeps the full suite green.

## 13. Risk analysis

| Risk | Mitigation |
| --- | --- |
| Invalid/hostile `npcType` fails the room or leaks | Field-level `z.enum(...).optional().catch(undefined)` drops any invalid value to `undefined` inside the schema; NPC/room stay valid; Slice 1 tests cover string/number/object/`null`/injection shapes. |
| herald-asha / authored regression | Resolver priority checks explicit `NPC_ROUTINE_CONFIG` first, then authored `NPC_TYPE_BY_ID`, before the room field; Slice 3 tests assert both outrank a competing room `npcType`. |
| Content-derived classification creeping in | App derives the type map only from the validated `npcType` field of present NPC objects — never `name`/`persona`/dialogue/text; Slice 4 redteam asserts name/persona independence and "type word in name → no routine." |
| Provider controlling schedules | Only the closed category is read; no schedule/mode/time field is consumed from provider output; Option E stays permanently rejected. |
| Schema/persistence creep | Additive optional field, no `schemaVersion` bump, no migration; escalation clause (§9) if a real break appears. |
| Silent blanket activation | `VITE_AIGM_DEMO_ROUTINE` stays default-off; present-NPC intersection unchanged; a routine appears only for a valid category with a resolvable time bucket. |
| Dialogue coupling | None — ADR-0089's dialogue routine context reads the resolved `npcRoutineModes` map and needs no change; a newly-resolved mode surfaces automatically. |

## 14. Verification commands (run from `apps/web`, later)

```bash
npx vitest run src/domain/roomSpec.test.ts
npx vitest run src/generation/llmRoomPrompt.test.ts
npx vitest run src/app/npcRoutine.test.ts src/domain/npcRoutinePresets.test.ts src/domain/npcRoutine.test.ts src/domain/npcRoutineConfig.test.ts src/domain/npcRoutineTypeConfig.test.ts
npx vitest run src/App.test.tsx src/renderer/RoomViewer.test.ts
npx vitest run src/redteam/npcRoutine.redteam.test.ts
npx vitest run src/renderer/engine/npc/chaseStep.test.ts src/renderer/engine/npc/patrolStep.test.ts src/renderer/engine/npc/WanderMotor.test.ts src/renderer/engine/Engine.test.ts
npm run lint
npm run build
npm run test
```

## 15. Minimum Safe Change Check

- **Reused:** `resolveRoutineScheduleForNpc`, `ROUTINE_PRESETS`,
  `NPC_TYPE_TO_ROUTINE_PRESET`, `NpcRoutineNpcType`, `NPC_ROUTINE_NPC_TYPES`,
  `isNpcRoutineNpcType` (`domain/npcRoutinePresets.ts`); `NPC_ROUTINE_CONFIG`
  (highest priority, unchanged); `NPC_TYPE_BY_ID` (fallback/fixture, unchanged);
  `selectNpcRoutineModes`/`readRoutineEnabled` gate shape (extended, not replaced);
  the present-NPC derivation in `App.tsx`; the `RoomViewer`→`Engine` routine seam and
  the ADR-0089 dialogue routine context (both untouched); the `.catch`-based
  lenient-drop posture used by existing generated-room normalizers.
- **Minimum new code:** one optional closed-enum schema field; two exports made public;
  one optional `roomNpcTypeById` selector argument + merge/order step; one App map
  derivation; one minimal prompt line.
- **Safety boundaries unchanged:** renderer trust boundary; `assembleRoom` repair/
  fallback; chase/patrol/awareness logic and tests; `WorldState`/`WorldEvent`/
  `WorldCommand`/event-log authority; memory firewall (no memory/fact write); no
  `schemaVersion`/save-game/persistence change; logging redaction;
  `VITE_AIGM_DEMO_ROUTINE` default-off; herald-asha and authored resolutions.
- **Tests prove it:** §11 — schema drop-invalid, prompt category-only, resolver priority,
  content-independence redteam, plus unmodified ADR-0087/ADR-0088/ADR-0089 regressions.

## 16. Slice 0 record

This document and [ADR-0090](../decisions/ADR-0090-generated-npc-routine-type-v0.md) are
the entire Slice 0 deliverable. No `.ts`/`.tsx` source or test file, no schema, and no
prompt code was created or modified in Slice 0. `docs/architecture/ARCHITECTURE.md` gains
one planned-status bullet line pointing at this plan and ADR-0090, to be replaced at
Slice 5 closeout by an implemented-status line, per the `npc-routine-presets-v0`
precedent. ADR-0088's deferred Option B note is **not** flipped in Slice 0 — it is
cross-linked here as a planned follow-up and will be updated to "delivered by ADR-0090"
only at this feature's Slice 5 closeout, once the feature is complete.
