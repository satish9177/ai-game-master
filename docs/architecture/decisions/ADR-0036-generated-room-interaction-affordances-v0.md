# ADR-0036 - Generated Room Interaction Affordances v0

**Status:** Implemented

## Context

Generated rooms already had generic interaction rings and E/F prompts, but those
cues did not reliably tell the player what kind of action was available. A chest,
corpse, NPC, exit, encounter, or use-item interaction could all appear as the same
ring plus a generated prompt. If the generated prompt was weak, ambiguous, or
overly decorative, the player had to infer intent from prose.

The project already had enough validated structure to describe the action class:
`interaction.exit`, `interaction.encounter`, `interaction.dialogue`,
`interaction.effect.kind`, and `RoomObject.type` for NPCs. The missing piece was a
deterministic presentation affordance, not a new gameplay system.

## Decision

Derive a fixed `Affordance` enum from validated interaction structure and surface
it through existing presentation paths.

The v0 affordance vocabulary is:

- `inspect`
- `talk`
- `take`
- `use`
- `exit`
- `approach`

Classification is deterministic and precedence-ordered:

1. `interaction.exit` -> `exit`
2. `interaction.encounter` -> `approach`
3. `interaction.dialogue` -> `talk`
4. `objectType === 'npc'` -> `talk`
5. `interaction.effect?.kind === 'inspect'` -> `inspect`
6. `interaction.effect?.kind === 'take-item'` -> `take`
7. `interaction.effect?.kind === 'use-item'` -> `use`
8. default -> `inspect`

**Affordance is view-model data, not RoomSpec data.** The derived value is added
to the neutral `Interactable` view-model produced from validated `RoomObject`
values. It is not stored in `RoomSpec`, `SaveGame`, `WorldState`, SQLite, memory,
or API payloads. `schemaVersion` remains `1`.

**HUD shows key + deterministic verb + existing prompt.** `Hud` keeps the existing
key chip and generated prompt text, and inserts a small verb chip using
`AFFORDANCE_LABEL[active.affordance]`. The generated prompt remains visible and
unchanged.

**Renderer tints the existing ring.** Interactable objects still get exactly one
existing floor ring named `interactable-indicator`. The renderer changes only that
ring material color using a fixed static `AFFORDANCE_RING_COLOR` map. It adds no
new meshes, labels, hover behavior, raycasting, click picking, or world-space text.

**No new gameplay semantics.** The categories describe already-existing
interaction capability. They do not create quests, inventory, loot, combat,
dialogue trees, encounter behavior, navigation behavior, world events, memory, or
backend state.

**No prose or raw-data inference.** Classification never parses
`interaction.prompt`, `interaction.title`, `interaction.body`, object names,
skipped objects, provider responses, or raw generated JSON. A chest with a
body-only interaction is `inspect`, not inferred as "open"; a zombie with an
encounter is `approach`; a zombie with body-only interaction is `inspect`.

**No fallback or repair behavior.** Missing or ambiguous affordance information
falls back to `inspect`. Affordance classification never triggers repair,
fallback, generated-room notices, room invalidation, or logging.

## Non-goals

- No RoomSpec schema change.
- No backend/API/memory/gameplay change.
- No quest, inventory, loot, combat, cooldown, or random reward system.
- No generated code.
- No parsing of prompt/title/body/object name/raw JSON.
- No new renderer meshes or world-space labels.
- No hover/raycast/click picking.
- No change to E/F input behavior.
- No change to interaction opening or resolution precedence.
- No fallback/repair behavior tied to affordances.

## Consequences

**Good:**

- Players get a deterministic action verb even when generated prompt prose is weak.
- The existing generated prompt remains visible, preserving authored/generated
  flavor while adding clarity.
- Ring tints provide a second small visual cue without changing object builders or
  gameplay behavior.
- The RoomSpec/data-only boundary remains unchanged.
- Tests can cover every category deterministically because classification reads
  only structured validated fields.

**Trade-offs and limitations:**

- The enum is intentionally coarse. `inspect` covers body-only flavor interactions
  and ambiguous cases.
- Color distinction is presentation-only and may be imperfect for some users or
  lighting conditions; the HUD verb chip remains the primary clarity cue.
- The classifier cannot infer richer intent from text by design. If a prompt says
  "open chest" but the structured interaction is body-only, the affordance is
  still `inspect`.
- Future gameplay systems may add new structured capabilities, but they must do so
  explicitly through validated data and separate ADRs.

## ADR relationship

| ADR | Relationship |
| --- | --- |
| [ADR-0001](./ADR-0001-data-only-room-spec-trusted-renderer.md) | Preserves data-only RoomSpec and trusted renderer boundaries |
| [ADR-0003](./ADR-0003-logging-abstraction.md) | Adds no logging; classification and presentation expose no raw/generated content |
| [ADR-0012](./ADR-0012-isometric-camera-foundation.md) | Reuses the existing renderer-internal floor indicator; tint is presentation-only |
| [ADR-0014](./ADR-0014-object-interactions-v0.md) | Describes existing interaction effects without changing resolution semantics |
| [ADR-0015](./ADR-0015-encounter-system-v0.md) | Maps structured encounters to `approach` while preserving encounter precedence |
| [ADR-0017](./ADR-0017-npc-dialogue-foundation-v0.md) | Maps structured dialogue and NPC interactables to `talk` without changing dialogue behavior |
| [ADR-0020](./ADR-0020-room-generation-repair-fallback-v0.md) | Missing/ambiguous affordance never triggers repair, fallback, or user notices |
| [ADR-0033](./ADR-0033-generated-room-visual-vocabulary-v0.md) | Uses validated object types only; no inference from generated nouns |
| [ADR-0035](./ADR-0035-room-inspect-summary-v0.md) | Complements deterministic room intro text with deterministic per-interaction verbs |
