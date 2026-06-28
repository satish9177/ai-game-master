# ADR-0048: Generated Room Objective Target Enrichment v0 — promote one eligible object to objective-ready

- **Status:** Accepted / implemented 2026-06-28
- **Date:** 2026-06-28
- **Deciders:** Project owner
- **Extends:** [ADR-0047](./ADR-0047-generated-story-objective-contract-v0.md) (generated story
  objective contract),
  [ADR-0037](./ADR-0037-generated-room-object-purpose-v0.md) (generated room object purpose),
  [ADR-0040](./ADR-0040-generated-room-npc-presence-v0.md) (generated room NPC presence —
  same boolean-option gate pattern)
- **Related:** [ADR-0020](./ADR-0020-room-generation-repair-fallback-v0.md)
  (assemble→repair→drop discipline),
  [ADR-0028](./ADR-0028-demo-quest-loop-v0.md) (quest as derived lens),
  [ADR-0014](./ADR-0014-object-interactions-v0.md) (object interactions and `interaction:<id>`
  flag derivation)

> Full pre-code design in the implementation plan
> [`generated-room-objective-target-enrichment-v0`](../implementation-plans/generated-room-objective-target-enrichment-v0.md).

## Context

ADR-0047 (Generated Story Objective Contract v0) delivered `assembleObjective` — a pure
assembler that converts a validated `GeneratedObjectiveSpec` into a trusted `QuestSpec`. Its
satisfiability gate for `interact-object` conditions requires that the room contain an object
with **all three** of:

1. a stable `RoomObject.id`,
2. `interaction.effect` present (of a kind that sets a flag), and
3. `interaction.encounter == null`.

This predicate maps exactly onto the `interaction:<id>` flag path:
`planInspect` derives `oneShotFlag(effect.flag, ref) = interaction:${ref}` (where `ref` is the
object id), which is the same key `assembleObjective` stores in `condition.flag`. Without all
three properties on the same object, `assembleObjective` returns `null` with
`condition-unsatisfiable` — correctly, because the flag can never be set.

`FakeRoomGenerator` satisfies this deliberately: `asObjectiveTarget` stamps one document with
the constant id `'objective-document'` and `effect: { kind: 'inspect' }`. Real LLM-generated
rooms (DeepSeek/OpenAI) typically do **not**: they emit objects without stable ids, and
`assignGeneratedObjectPurpose` (ADR-0037) correctly adds only `{ key, prompt, title, body }` —
**no effect** — because object-purpose is presentation-only and must not set world-state flags.

The gap: after ADR-0047 ships, `assembleObjective` still returns `null` for virtually all
real-LLM rooms, so prompt-generated rooms remain without a quest tracker or NPC hint regardless
of provider.

## Decision

Add a **deterministic generated-room normalization stage** — `ensureGeneratedObjectiveTarget` —
that promotes exactly one eligible already-assembled generated-room object to be objective-ready:
it assigns a stable `id` (if missing) and adds `effect: { kind: 'inspect' }` to the object's
existing purpose-synthesized interaction. This is the same data shape the fake bakes in,
applied deterministically to real-LLM output in the trusted assembly pipeline.

### 1. Architecture

A new **pure domain helper** in `domain/generatedRoomObjectiveTarget.ts`:

```
ensureGeneratedObjectiveTarget(room: LoadedRoom):
  { room: LoadedRoom; objectiveTargetEnriched: boolean }
```

Invoked as a new **Stage 2.12.5** in `assembleRoom`, placed after `ensureGeneratedNpcPresence`
(Stage 2.12) and before `sanitizeGeneratedDisplayText` (Stage 2.13) / final `validateRoom`.
Gated by a new `AssembleRoomOptions.enrichObjectiveTarget?: boolean` (default `false`; `true`
only on the prompt-generated first-room path). This follows the exact pattern established by
`requestsNpc` → `ensureGeneratedNpcPresence` in ADR-0040.

**Why inside `assembleRoom` as a gated stage, not after or in the composition root:**
- Must run before final `validateRoom` so the promoted object is validated with the rest.
- Reuses the same diagnostics surface and `AssembleRoomOptions` seam already in place.
- Adjacent warming and the prompt-generated path share one `assembleRoom` call; the option gate
  cleanly separates the two.

### 2. Selection algorithm

Operates on validated `LoadedRoom.objects` only. Never reads object names, generated text,
`interaction.title`, `interaction.body`, `interaction.prompt`, or `room.skipped`.

**Step 1 — Already-eligible short-circuit.**
If any object already satisfies: `id != null` **and** `interaction.effect != null` **and**
`interaction.encounter == null` → **no-op**, return same reference, `objectiveTargetEnriched:
false`. This covers every `FakeRoomGenerator` room (baked `objective-document`) and any LLM
room that already emitted an effect+id object.

**Step 2 — Build candidate set.**
Objects where all hold:
- `interaction` is present and non-null
- `interaction.effect == null` (purpose-synthesized or blank)
- `interaction.encounter == null`
- `interaction.exit == null`
- `type !== 'npc'`
- `type` is in the object-purpose allowlist:
  `book / paper / map / chest / crate / barrel / corpse / table / machine / altar / statue / artifact`

In practice these are the objects `assignGeneratedObjectPurpose` just gave a synthesized
read/inspect/examine interaction.

**Step 3 — Pick one deterministically.**
Apply the existing story-anchor type ranking:
`altar > statue > corpse > machine/artifact > chest > table/map/book/paper`.
Within a tier, choose the lowest object index. This makes the selection stable and consistent
with the focal-object priority already established by `composeGeneratedRoom`.

**Step 4 — No candidate → no-op.**
If the candidate set is empty, return unchanged room, `objectiveTargetEnriched: false`. The
room plays without an objective — identical to today. **Never invent a new object.**

### 3. Stable id strategy

- If the chosen object **already has an `id`**, keep it unchanged (only the effect is added).
- If it has **no `id`**, assign the constant `'generated-objective-target'`.
- **Collision avoidance:** scan all existing `room.objects[].id` values (and defensively
  `room.skipped` raw ids). If the constant collides, append a deterministic numeric suffix
  (`-2`, `-3`, …) derived from the object's list index until unique. Uniqueness is mandatory
  because `findObjectById` uses first-match `.find`.
- The assigned id is a fixed structural string; it does not match the structural-id regex
  `gen-[0-9a-f]{8}` used by Stage 2.13 sanitization, so the display-text sanitizer will not
  alter it.

### 4. Safe interaction/effect

- Preserve the chosen object's existing `interaction.key`, `.prompt`, `.title`, `.body` exactly.
- Add **only** `effect: { kind: 'inspect' }` to the existing interaction object.
- **Never set `effect.flag`.** `planInspect` derives `interaction:<id>` from `ref` when no
  explicit flag is present; `assembleObjective` derives the same key from `objectId`. An
  explicit `effect.flag` would break this key-match guarantee.
- If (defensively) the object somehow has no interaction, synthesize
  `{ key: 'E', prompt: 'Inspect', title: 'Inspect', body: 'You inspect it carefully.', effect: { kind: 'inspect' } }`
  using only fixed authored text — never object names or generated content.

### 5. `interaction:<objectId>` flag compatibility — end-to-end proof

- Renderer emits object `id` as interaction `ref`.
- `planInspect` computes `oneShotFlag(undefined, ref) = 'interaction:' + ref`.
- `assembleObjective` for `interact-object` derives flag `'interaction:' + objectId`.
- Both use the same `object.id`; pressing E sets exactly that key; `evaluateQuest` checks it.
- Confirmed: `assembleObjective.hasInteractionEffect` returns `true` (effect present, no
  encounter); `FakeObjectiveGenerator.isEligibleInteractObject` returns `true` (id + effect +
  no encounter); the fake and the real provider both discover the promoted object.

### 6. Scope boundary

- **Adjacent pregeneration:** `enrichObjectiveTarget` defaults to `false`; adjacent rooms are
  never enriched. `assembleObjective` is already gated on `result.provenance === 'generated'`
  in `App`, so adjacents have no consumer anyway.
- **`repaired`/`fallback` rooms:** App already gates `buildGeneratedObjectiveAttachment` on the
  `generated` provenance branch. The enrichment on those paths is harmless but unreachable.
- **Authored/static/fallback rooms:** never enter `assembleRoom`'s generated stages.
- **`FakeRoomGenerator` rooms:** covered by the already-eligible short-circuit → byte-identical
  to today.

## Boundaries

All new and modified code lives inside existing lint blocks:

- `domain/generatedRoomObjectiveTarget.ts` — under `domain/**`. Imports only domain types.
  Pure: no logger, no I/O, no `Date.now`, no `Math.random`.
- `domain/assembleRoom.ts` — new option field, new stage, new diagnostic field. Existing
  boundaries unchanged.
- `app/buildPromptGeneratedRoomSource.ts` — sets `enrichObjectiveTarget: true`. One line,
  no new imports.

No new lint block. No `eslint.config.js` change. No new layer. No new dependency.

## Log safety

`objectiveTargetEnriched` is a boolean diagnostic only. Logs must not contain the promoted
object's id, type string, name, interaction prompt/title/body, generated JSON, room name, or
provider output.

## Consequences

- **Real-LLM rooms get objectives.** A DeepSeek/OpenAI room whose objects lack ids and effects
  now has one object promoted to objective-ready. `assembleObjective` attaches a validated
  `QuestSpec`; the quest tracker and NPC hint appear.
- **Fake rooms byte-identical.** The short-circuit covers every `FakeRoomGenerator` room;
  existing fake objective tests pass without change.
- **`assembleObjective` not weakened.** Its satisfiability gate is unchanged. The enrichment
  guarantees the preconditions are met beforehand; the gate still exercises them on every call.
- **No content invention.** A room with no eligible inspectable object plays with no objective.
- **Provenance stays `generated`.** Benign normalization: no notice, no `repaired`/`fallback`
  upgrade.
- **Adjacent rooms unchanged.** Adjacent pregeneration, adjacent NPC wiring, and authored
  adjacent rooms are all untouched.
- **Authored demo unchanged.** `demoQuestSpec`, `evaluateExitGate`, authored NPCs, demo
  bootstrap — all unaffected.
- **Known limitation:** only the `interact-object` condition kind is enriched in v0. A future
  slice could promote encounter objects (`resolve-encounter`) or verify exit presence
  (`visit-room`) — both require their own enrichment rule and test coverage.
- **Save/load transience:** unchanged from ADR-0047 — the generated `QuestSpec` and hints are
  not persisted; progress flags survive but the tracker/hint do not reappear after reload.

### What is deliberately not changed

`domain/roomSpec.ts` · `domain/quests/assembleObjective.ts` ·
`domain/quests/generatedObjectiveSpec.ts` · `domain/quests/questSpec.ts` ·
`domain/quests/evaluateQuest.ts` · `domain/generatedRoomObjectPurpose.ts` ·
`generation/FakeObjectiveGenerator.ts` · `generation/FakeRoomGenerator.ts` ·
`domain/interactions/**` · `interactions/**` · `encounters/**` · `world-session/**` ·
`domain/world/**` · reducers · `domain/world/saveGame.ts` · `world-session/saveGame.ts` ·
`app/exitGate.ts` · `app/gatedNavigation.ts` · `app/NavigationService.ts` ·
`memory/**` · `persistence/**` · `server/**` · `renderer/engine/**` ·
`eslint.config.js` · `package.json`.
