# ADR-0037 - Generated Room Object Purpose v0

**Status:** Implemented

## Context

Generated rooms can now be spatially safe, composed, visually recognizable, and
decorated with deterministic affordance labels. But many valid generated objects
still arrive without `interaction` data. Those objects render correctly, yet they
do not receive interaction rings or HUD prompts because the downstream renderer
and HUD consume only validated interactions.

This is a purpose/affordance gap, not a gameplay gap. A generated room may include
a bare book, chest, map, altar, or machine that should be readable as something
the player can inspect, but v0 should not infer quests, loot, dialogue, combat, or
world-state effects from that object. It only needs a safe presentation prompt
for a small allowlist of already-validated object types.

## Decision

Add deterministic, type-based generated-object purpose assignment in the generated
`assembleRoom` path.

The pure domain helper is:

```ts
assignGeneratedObjectPurpose(room: LoadedRoom): {
  room: LoadedRoom
  purposesAssigned: number
}
```

`assembleRoom` runs it only for generated rooms, after generated-room composition,
spawn repair, and exit repair, and before final `validateRoom`.

```
clampGeneratedShell
  -> repairGeneratedObjects
  -> composeGeneratedRoom
  -> repairGeneratedSpawn
  -> repairGeneratedExits
  -> assignGeneratedObjectPurpose
  -> validateRoom
```

The helper adds only presentation-only interactions to allowlisted objects that
currently lack an interaction. It never overwrites an existing interaction.

The allowlist is:

| Object type | Prompt |
| --- | --- |
| `book`, `paper`, `map` | `Read` |
| `chest`, `crate`, `barrel`, `corpse`, `table`, `machine` | `Inspect` |
| `altar`, `statue`, `artifact` | `Examine` |

The synthesized interaction is exactly:

```ts
{ key: 'E', prompt: 'Read' | 'Inspect' | 'Examine' }
```

It contains no `effect`, `encounter`, `dialogue`, `exit`, item, inventory, quest,
combat, or event-writing data. It creates no authoritative world-state behavior.

Explicit exclusions:

- `throne`
- `arch`
- `pillar`
- `rug`
- `torch`
- `candle`
- `prop`
- `debris`
- `barricade`
- `zombie`
- `scroll`
- `npc`

`scroll` and `npc` are excluded because they already require explicit validated
interactions. Object types such as `torch` and `candle` are excluded because they
do not legally carry `interaction` in the current `RoomSpec` union.

## Safety

- **Generated-room-only.** Authored/static/default/restored rooms use
  `loadRoomSpec` directly and are unchanged. The trusted fallback room is never
  enriched.
- **No schema change.** `RoomSpec.schemaVersion` remains `1`; no purpose field,
  role field, or affordance field is stored.
- **Validated data only.** The helper receives `LoadedRoom` and reads only
  validated `RoomObject.type` plus presence/absence of `interaction`.
- **No generated text inference.** It does not read object names,
  `interaction.title`, `interaction.body`, `interaction.prompt`, skipped objects,
  provider output, raw generated JSON, or user prompts.
- **No content leakage.** Diagnostics are count-only (`purposesAssigned`). Logs
  must not include object names, object ids, prompt text, provider text, raw JSON,
  generated text, or free-form parse/schema details.
- **Best effort.** Unsupported or missing purpose leaves the object unchanged.
  Missing purpose never triggers repair, fallback, a user notice, or room
  invalidation.
- **Fallback paths are zero.** JSON parse failure, schema failure, semantic
  fallback, and generator-unavailable paths report `purposesAssigned: 0`.

## Diagnostics

`RoomDiagnostics` gains:

```ts
purposesAssigned: number
```

This is the number of generated objects that received a synthesized safe
presentation interaction. It is a count-only value and is safe to log.

Important semantic note: `composeGeneratedRoom` computes `lacksAnchor` and
`lacksInteractable` before object-purpose assignment. Therefore
`lacksInteractable` describes the raw generated/composed model output, not
necessarily the final room after safe synthesized purpose interactions. Future
host or UI code must not treat `lacksInteractable` as "the final room has no
interactable" without also considering `purposesAssigned` and/or the final
`LoadedRoom`.

## Consequences

**Good:**

- More generated objects produce existing interaction rings and HUD prompts.
- The downstream affordance/ring/HUD systems remain consumers of validated
  interactions; they do not invent interactions themselves.
- Existing authored/default interactions are unchanged.
- Existing generated interactions are preserved.
- Missing purpose is non-fatal and invisible except for the count diagnostic.
- The feature stays deterministic, pure, testable, and renderer-agnostic.

**Trade-offs and limitations:**

- The allowlist is intentionally small and type-based. It does not infer a richer
  purpose from prose or generated names.
- `Inspect` is coarse. A chest or crate is not inferred as "open" and receives no
  loot or inventory behavior.
- Purpose assignment can make the final room interactable even when
  `lacksInteractable` is true, because composition diagnostics are computed
  earlier.

## Non-goals

- No RoomSpec schema change.
- No backend, API, persistence, or memory change.
- No quest, inventory, loot, combat, encounter, dialogue, event write, or
  world-state mutation.
- No generated code.
- No raw prompt/provider/generated JSON/object name reading or logging.
- No renderer or HUD invention of interactions.
- No fallback or repair behavior tied to missing purpose.

## ADR relationship

| ADR | Relationship |
| --- | --- |
| [ADR-0001](./ADR-0001-data-only-room-spec-trusted-renderer.md) | Preserves data-only `RoomSpec`; synthesized interactions are validated data consumed by trusted renderer code |
| [ADR-0003](./ADR-0003-logging-abstraction.md) | Adds count-only diagnostics; no generated/user content enters logs |
| [ADR-0010](./ADR-0010-generation-foundation-v0.md) | Adds one deterministic enrichment stage to the generated assembly pipeline |
| [ADR-0014](./ADR-0014-object-interactions-v0.md) | Creates presentation-only interactions with no effect or world-state command path |
| [ADR-0020](./ADR-0020-room-generation-repair-fallback-v0.md) | Missing purpose never triggers repair, fallback, or user notices |
| [ADR-0031](./ADR-0031-generated-room-layout-contract-v0.md) | Runs after generated spawn/exit/layout safety finalizers |
| [ADR-0032](./ADR-0032-generated-room-composition-v0.md) | Runs after composition; composition diagnostics still describe pre-purpose output |
| [ADR-0033](./ADR-0033-generated-room-visual-vocabulary-v0.md) | Uses the expanded validated visual object vocabulary |
| [ADR-0036](./ADR-0036-generated-room-interaction-affordances-v0.md) | Provides safe interactions that downstream affordance/ring/HUD systems can consume |
